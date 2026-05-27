#!/usr/bin/env tsx
/**
 * Import images from rclone-downloaded AppSheet backup folder into Supabase.
 *
 * Source layout (downloaded with `rclone copy --drive-root-folder-id=<id> gdrive: ./.drive-backup`):
 *
 *   .drive-backup/
 *     Incident_Images/         -> incidents (Image1, Image2 row_id-prefixed; Evidence/Example skipped)
 *     Images_Images/           -> incidents (Pictures, row_id-prefixed -> images_legacy.event_id)
 *     Customers_Images/        -> customers (Customer Logo, row_id or name-prefixed)
 *     Customer Districts_Images/ -> districts (Customer Logo, row_id or name-prefixed)
 *
 * SCOPE = "Option 3":
 *   - Incident_Images: Image1, Image2 only.  Evidence, Example  -> SKIP.
 *   - Images_Images:   Pictures only (mapped via images_legacy.event_id).
 *   - Customers_Images / Customer Districts_Images: Customer Logo only.
 *       - If filename prefix is a 22-char row_id, match by row_id.
 *       - Otherwise, treat prefix as name and match against
 *         customers.customer / districts.customer_district (case-insensitive).
 *
 * Filename patterns:
 *   <row_id22>.<field>.<HHMMSS>.<ext>     (Image1, Image2, Pictures, Customer Logo)
 *   <name>.<field>.<HHMMSS>.<ext>          (Customer Logo where prefix is a name with spaces/etc.)
 *
 * For each kept file:
 *   1. Read bytes from disk.
 *   2. Upload to Supabase Storage bucket `make-64775d98-incident-images` at
 *      <parent_table>/<parent_row_id>/<uuid>.<ext>
 *   3. Insert row into public.images with:
 *        parent_table, parent_row_id, field_name,
 *        storage_path, source='appsheet-backfill',
 *        appsheet_row_id  (the row_id parsed from filename, or null for name-matched logos),
 *        appsheet_path    (the bare filename including subfolder, UNIQUE -> idempotent),
 *        mime_type, file_size_bytes.
 *
 * Usage:
 *   pnpm tsx scripts/import-images-from-drive.ts            # real run
 *   pnpm tsx scripts/import-images-from-drive.ts --dry-run  # report only
 *   pnpm tsx scripts/import-images-from-drive.ts --limit=10
 *   pnpm tsx scripts/import-images-from-drive.ts --dir=/path
 */
import { createClient } from "@supabase/supabase-js";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const [k, v] = a.startsWith("--") ? a.slice(2).split("=") : [a, ""];
  args.set(k, v ?? "true");
}
const DRY_RUN = args.has("dry-run");
const LIMIT = args.get("limit") ? parseInt(args.get("limit")!, 10) : Infinity;
const DIR =
  args.get("dir") ||
  path.resolve(process.cwd(), ".drive-backup");

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY env vars");
  process.exit(1);
}

const BUCKET = "make-64775d98-incident-images";

// ---------- Filename parsing ----------
//
// AppSheet writes images as "<prefix>.<Field Name>.<HHMMSS>.<ext>" where Field Name
// is the literal AppSheet column header. Field Name CAN contain spaces (e.g.
// "Customer Logo"). The prefix is either:
//   (a) a 22-char AppSheet RowID  (e.g. 05yRxaSZkkSg0ZynETdDdH)
//   (b) a free-form name          (e.g. "Diamondback Industries")
//
// We anchor on the field name + 6-digit timestamp + extension at the end of the
// filename and treat everything before as the prefix.
const KEPT_FIELDS = ["Image1", "Image2", "Pictures", "Customer Logo"] as const;
type KeptField = (typeof KEPT_FIELDS)[number];
const SKIP_FIELDS = ["Evidence", "Example"];

const FIELDS_RE_ALT = KEPT_FIELDS.map(f => f.replace(/ /g, "\\ ")).join("|");
// matches: <prefix>.<field>.<HHMMSS>.<ext>
const FILE_RE = new RegExp(
  `^(.+?)\\.(${FIELDS_RE_ALT})\\.(\\d{6})\\.(jpe?g|png|webp|gif|heic)$`,
  "i"
);
const ROW_ID_22_RE = /^[A-Za-z0-9_\-]{22}$/;
const SKIP_RE = new RegExp(`\\.(${SKIP_FIELDS.join("|")})\\.\\d{6}\\.`, "i");

// Subfolder -> default parent_table
const FOLDER_PARENT: Record<string, "incidents" | "customers" | "districts"> = {
  "Incident_Images": "incidents",
  "Images_Images": "incidents",
  "Customers_Images": "customers",
  "Customer Districts_Images": "districts",
};

interface ParsedFile {
  subfolder: string;
  filename: string;        // just the basename
  rel_path: string;        // "<subfolder>/<filename>"  -> stored as appsheet_path
  full_path: string;
  size: number;
  prefix: string;          // text before first ".<Field>"
  field_name: KeptField;
  prefix_is_row_id: boolean;
  ext: string;
}

interface PlannedImport extends ParsedFile {
  parent_table: "incidents" | "customers" | "districts";
  parent_row_id: string;   // resolved foreign key
  mime_type: string;
  appsheet_row_id: string | null; // 22-char prefix if it looked like a row_id
}

interface Skip {
  filename: string;
  reason: string;
}

const extToMime = (ext: string): string => {
  const e = ext.toLowerCase();
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  if (e === "heic") return "image/heic";
  return "application/octet-stream";
};

// Canonicalize for fuzzy name match: lowercase, strip non-alnum.
const canon = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function main() {
  console.log("=".repeat(60));
  console.log("AppSheet Drive Backfill -> Supabase images  (Option 3)");
  console.log("=".repeat(60));
  console.log(`Source dir: ${DIR}`);
  console.log(`Bucket:     ${BUCKET}`);
  console.log(`Mode:       ${DRY_RUN ? "DRY RUN (no writes)" : "REAL RUN"}`);
  if (LIMIT !== Infinity) console.log(`Limit:      ${LIMIT}`);
  console.log("");

  // 1. Verify source dir exists
  try {
    const s = await stat(DIR);
    if (!s.isDirectory()) throw new Error("not a directory");
  } catch (e) {
    console.error(`Source dir not found: ${DIR}`);
    console.error("Run rclone copy first. See script header for command.");
    process.exit(1);
  }

  // 2. Walk known subfolders + parse filenames
  const parsed: ParsedFile[] = [];
  const skipped: Skip[] = [];

  for (const sub of Object.keys(FOLDER_PARENT)) {
    const subPath = path.join(DIR, sub);
    let entries: string[] = [];
    try {
      entries = await readdir(subPath);
    } catch {
      console.log(`(missing subfolder, skipping: ${sub})`);
      continue;
    }

    let kept = 0;
    let skip = 0;
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = path.join(subPath, name);
      const st = await stat(full);
      if (!st.isFile()) continue;

      // Quick Evidence/Example reject
      if (SKIP_RE.test(name)) {
        skipped.push({ filename: `${sub}/${name}`, reason: "Evidence/Example (out of scope)" });
        skip++;
        continue;
      }

      const m = name.match(FILE_RE);
      if (!m) {
        skipped.push({ filename: `${sub}/${name}`, reason: "filename does not match pattern" });
        skip++;
        continue;
      }
      const [, prefix, fieldRaw, , extRaw] = m;
      // Normalise field name to canonical casing.
      const field = KEPT_FIELDS.find(
        f => f.toLowerCase() === fieldRaw.toLowerCase()
      ) as KeptField | undefined;
      if (!field) {
        skipped.push({ filename: `${sub}/${name}`, reason: `unknown field "${fieldRaw}"` });
        skip++;
        continue;
      }
      parsed.push({
        subfolder: sub,
        filename: name,
        rel_path: `${sub}/${name}`,
        full_path: full,
        size: st.size,
        prefix,
        field_name: field,
        prefix_is_row_id: ROW_ID_22_RE.test(prefix),
        ext: extRaw.toLowerCase(),
      });
      kept++;
    }
    console.log(`  ${sub.padEnd(30)} kept=${kept}  skipped=${skip}`);
  }

  console.log("");
  console.log(`Total parsable: ${parsed.length}`);
  console.log(`Total skipped:  ${skipped.length}`);
  const byField: Record<string, number> = {};
  for (const p of parsed) byField[p.field_name] = (byField[p.field_name] ?? 0) + 1;
  console.log(`By field:       ${JSON.stringify(byField)}`);
  console.log("");

  // 3. Connect to Supabase
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // 4. Build lookup tables
  //
  // KEY MAPPING NOTES (verified by probe):
  //   - Image1/Image2 filename prefix         == incidents.row_id
  //   - images_legacy.event_id                == incidents.event_id  (NOT incidents.row_id)
  //   - So for Pictures we need a 2-step lookup:
  //       legacy.row_id -> legacy.event_id -> incidents.event_id -> incidents.row_id
  //   - We store parent_row_id := incidents.row_id everywhere (consistent PK).
  const pictureRowIds = parsed
    .filter(p => p.field_name === "Pictures" && p.prefix_is_row_id)
    .map(p => p.prefix);
  const legacyEventIdMap = new Map<string, string>(); // legacy.row_id -> legacy.event_id (== incidents.event_id)
  if (pictureRowIds.length > 0) {
    console.log(`Resolving ${pictureRowIds.length} Pictures rows -> images_legacy.event_id ...`);
    const chunkSize = 500;
    for (let i = 0; i < pictureRowIds.length; i += chunkSize) {
      const slice = pictureRowIds.slice(i, i + chunkSize);
      const { data, error } = await sb
        .from("images_legacy")
        .select("row_id,event_id")
        .in("row_id", slice);
      if (error) {
        console.error("images_legacy lookup failed:", error);
        process.exit(1);
      }
      for (const r of data ?? []) {
        if (r.event_id) legacyEventIdMap.set(r.row_id, r.event_id);
      }
    }
    console.log(`  Resolved ${legacyEventIdMap.size}/${pictureRowIds.length}`);
  }

  // 4b. customers: row_id and customer-name -> row_id
  const { data: custRows, error: custErr } = await sb
    .from("customers")
    .select("row_id,customer");
  if (custErr) {
    console.error("customers lookup failed:", custErr);
    process.exit(1);
  }
  const customerRowIds = new Set<string>();
  const customerNameMap = new Map<string, string>(); // canon(name) -> row_id
  for (const r of custRows ?? []) {
    if (r.row_id) customerRowIds.add(r.row_id);
    if (r.customer && r.row_id) {
      customerNameMap.set(canon(r.customer), r.row_id);
    }
  }
  console.log(`Loaded ${custRows?.length ?? 0} customers (${customerNameMap.size} unique names)`);

  // 4c. districts: row_id and customer_district-name -> row_id
  const { data: distRows, error: distErr } = await sb
    .from("districts")
    .select("row_id,customer_district");
  if (distErr) {
    console.error("districts lookup failed:", distErr);
    process.exit(1);
  }
  const districtRowIds = new Set<string>();
  const districtNameMap = new Map<string, string>();
  for (const r of distRows ?? []) {
    if (r.row_id) districtRowIds.add(r.row_id);
    if (r.customer_district && r.row_id) {
      districtNameMap.set(canon(r.customer_district), r.row_id);
    }
  }
  console.log(`Loaded ${distRows?.length ?? 0} districts (${districtNameMap.size} unique names)`);

  // 4d. incidents: row_id set (for Image1/Image2 prefix lookup)
  //     + event_id -> row_id map (for Pictures step 2)
  const { data: incRows, error: incErr } = await sb
    .from("incidents")
    .select("row_id,event_id");
  if (incErr) {
    console.error("incidents lookup failed:", incErr);
    process.exit(1);
  }
  const incidentRowIds = new Set<string>();
  const incidentEventToRow = new Map<string, string>();
  for (const r of incRows ?? []) {
    if (r.row_id) incidentRowIds.add(r.row_id);
    if (r.event_id && r.row_id) incidentEventToRow.set(r.event_id, r.row_id);
  }
  console.log(`Loaded ${incidentRowIds.size} incidents  (${incidentEventToRow.size} with event_id)`);
  console.log("");

  // 5. Build planned imports
  const planned: PlannedImport[] = [];
  for (const p of parsed) {
    let parent_table: PlannedImport["parent_table"] = FOLDER_PARENT[p.subfolder];
    let parent_row_id: string | null = null;
    let appsheet_row_id: string | null = p.prefix_is_row_id ? p.prefix : null;

    if (p.subfolder === "Incident_Images") {
      // Image1 / Image2: prefix must be a 22-char row_id matching incidents.id
      if (!p.prefix_is_row_id) {
        skipped.push({ filename: p.rel_path, reason: "Incident image without row_id prefix" });
        continue;
      }
      if (!incidentRowIds.has(p.prefix)) {
        skipped.push({ filename: p.rel_path, reason: `no incident with id=${p.prefix}` });
        continue;
      }
      parent_table = "incidents";
      parent_row_id = p.prefix;

    } else if (p.subfolder === "Images_Images") {
      // Pictures: legacy.row_id -> legacy.event_id -> incidents.row_id (via incidents.event_id)
      if (!p.prefix_is_row_id) {
        skipped.push({ filename: p.rel_path, reason: "Pictures file without row_id prefix" });
        continue;
      }
      const eventId = legacyEventIdMap.get(p.prefix);
      if (!eventId) {
        skipped.push({
          filename: p.rel_path,
          reason: `no images_legacy.event_id for row_id=${p.prefix}`,
        });
        continue;
      }
      const incRowId = incidentEventToRow.get(eventId);
      if (!incRowId) {
        skipped.push({
          filename: p.rel_path,
          reason: `images_legacy.event_id=${eventId} has no matching incidents.row_id`,
        });
        continue;
      }
      parent_table = "incidents";
      parent_row_id = incRowId;

    } else if (p.subfolder === "Customers_Images") {
      parent_table = "customers";
      if (p.prefix_is_row_id && customerRowIds.has(p.prefix)) {
        parent_row_id = p.prefix;
      } else {
        const hit = customerNameMap.get(canon(p.prefix));
        if (hit) {
          parent_row_id = hit;
        } else {
          skipped.push({
            filename: p.rel_path,
            reason: `no customer match for prefix "${p.prefix}"`,
          });
          continue;
        }
      }

    } else if (p.subfolder === "Customer Districts_Images") {
      parent_table = "districts";
      if (p.prefix_is_row_id && districtRowIds.has(p.prefix)) {
        parent_row_id = p.prefix;
      } else {
        const hit = districtNameMap.get(canon(p.prefix));
        if (hit) {
          parent_row_id = hit;
        } else {
          skipped.push({
            filename: p.rel_path,
            reason: `no district match for prefix "${p.prefix}"`,
          });
          continue;
        }
      }
    }

    if (!parent_row_id) continue;
    planned.push({
      ...p,
      parent_table,
      parent_row_id,
      mime_type: extToMime(p.ext),
      appsheet_row_id,
    });
  }

  console.log(`Planned imports: ${planned.length}`);
  console.log(`Final skip list: ${skipped.length}`);
  const byParent: Record<string, number> = {};
  for (const p of planned) {
    const k = `${p.parent_table}/${p.field_name}`;
    byParent[k] = (byParent[k] ?? 0) + 1;
  }
  console.log(`Breakdown:       ${JSON.stringify(byParent)}`);
  console.log("");

  // 6. Find already-imported (appsheet_path UNIQUE) using rel_path
  console.log("Checking for existing rows in `images` table ...");
  const allPaths = planned.map(p => p.rel_path);
  const existing = new Set<string>();
  const chunkSize = 500;
  for (let i = 0; i < allPaths.length; i += chunkSize) {
    const slice = allPaths.slice(i, i + chunkSize);
    const { data, error } = await sb
      .from("images")
      .select("appsheet_path")
      .in("appsheet_path", slice);
    if (error) {
      console.error("existing-rows check failed:", error);
      process.exit(1);
    }
    for (const r of data ?? []) {
      if (r.appsheet_path) existing.add(r.appsheet_path);
    }
  }
  console.log(`  ${existing.size} already imported, will skip`);
  console.log("");

  // 7. Execute (or dry-run print)
  const todo = planned
    .filter(p => !existing.has(p.rel_path))
    .slice(0, LIMIT);
  console.log(`Will process ${todo.length} files\n`);

  if (DRY_RUN) {
    console.log("--- DRY RUN: first 15 planned ---");
    for (const t of todo.slice(0, 15)) {
      console.log(
        `  ${t.field_name.padEnd(14)} ${t.parent_table.padEnd(10)} parent=${t.parent_row_id}  ${t.rel_path}  (${t.size}B)`
      );
    }
    if (skipped.length > 0) {
      console.log(`\n--- SKIPPED (first 20) ---`);
      for (const s of skipped.slice(0, 20)) {
        console.log(`  ${s.reason}  -- ${s.filename}`);
      }
      // Show skip-reason histogram
      const reasonCounts: Record<string, number> = {};
      for (const s of skipped) {
        const key = s.reason.replace(/=[^ ]+/g, "=<id>").replace(/"[^"]*"/g, '"<prefix>"');
        reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
      }
      console.log(`\n--- Skip-reason histogram ---`);
      const sortedReasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
      for (const [reason, count] of sortedReasons) {
        console.log(`  ${count.toString().padStart(4)}  ${reason}`);
      }
    }
    console.log("\nDry-run complete. Re-run without --dry-run to import.");
    return;
  }

  let okCount = 0;
  let errCount = 0;
  const errors: Array<{ filename: string; phase: string; message: string }> = [];

  for (let i = 0; i < todo.length; i++) {
    const t = todo[i];
    const progress = `[${(i + 1).toString().padStart(4)}/${todo.length}]`;
    try {
      const bytes = await readFile(t.full_path);
      const uuid = crypto.randomUUID();
      const storage_path = `${t.parent_table}/${t.parent_row_id}/${uuid}.${t.ext}`;

      const up = await sb.storage.from(BUCKET).upload(storage_path, bytes, {
        contentType: t.mime_type,
        upsert: false,
      });
      if (up.error) {
        throw new Error(`storage.upload: ${up.error.message}`);
      }

      const ins = await sb.from("images").insert({
        parent_table: t.parent_table,
        parent_row_id: t.parent_row_id,
        field_name: t.field_name,
        storage_path,
        source: "appsheet-backfill",
        appsheet_row_id: t.appsheet_row_id,
        appsheet_path: t.rel_path,
        mime_type: t.mime_type,
        file_size_bytes: t.size,
      });
      if (ins.error) {
        // Roll back storage upload to keep things tidy
        await sb.storage.from(BUCKET).remove([storage_path]).catch(() => {});
        throw new Error(`db.insert: ${ins.error.message}`);
      }

      okCount++;
      if (okCount % 50 === 0 || okCount <= 5) {
        console.log(`${progress} OK   ${t.field_name.padEnd(14)} ${t.rel_path}`);
      }
    } catch (e: any) {
      errCount++;
      errors.push({
        filename: t.rel_path,
        phase: e.message?.split(":")[0] ?? "unknown",
        message: e.message ?? String(e),
      });
      console.error(`${progress} ERR  ${t.rel_path}  ${e.message}`);
    }
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(`Done.  OK: ${okCount}   ERR: ${errCount}   SKIPPED (pre-flight): ${skipped.length}`);
  console.log("=".repeat(60));

  if (errors.length > 0) {
    console.log("\nFirst 20 errors:");
    for (const e of errors.slice(0, 20)) {
      console.log(`  [${e.phase}] ${e.filename}: ${e.message}`);
    }
  }
  if (skipped.length > 0) {
    console.log("\nFirst 20 pre-flight skips:");
    for (const s of skipped.slice(0, 20)) {
      console.log(`  ${s.reason}  -- ${s.filename}`);
    }
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
