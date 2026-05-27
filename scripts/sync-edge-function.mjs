#!/usr/bin/env node
/**
 * Sync edge function source files into the deploy folder.
 *
 * The Supabase CLI deploys only files inside the function folder
 * (supabase/functions/make-server-64775d98/). Cross-folder imports
 * (e.g. `import ... from "../server/foo.tsx"`) are NOT bundled, which
 * caused IDLE_TIMEOUT 504s at runtime.
 *
 * Source of truth for editing: supabase/functions/server/*.tsx
 * Deploy target: supabase/functions/make-server-64775d98/*.tsx
 *
 * This script copies all *.tsx files from server/ into the deploy folder
 * so that all imports resolve as same-folder references. The entrypoint
 * `index.ts` is left alone (it imports `./index.tsx` and calls Deno.serve).
 */

import { copyFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const sourceDir = join(repoRoot, "supabase", "functions", "server");
const targetDir = join(repoRoot, "supabase", "functions", "make-server-64775d98");

if (!existsSync(sourceDir)) {
  console.error(`✗ Source folder not found: ${sourceDir}`);
  process.exit(1);
}
if (!existsSync(targetDir)) {
  mkdirSync(targetDir, { recursive: true });
}

const tsxFiles = readdirSync(sourceDir).filter((f) => f.endsWith(".tsx"));

if (tsxFiles.length === 0) {
  console.error(`✗ No .tsx files found in ${sourceDir}`);
  process.exit(1);
}

let copied = 0;
for (const file of tsxFiles) {
  const src = join(sourceDir, file);
  const dst = join(targetDir, file);
  copyFileSync(src, dst);
  copied++;
  console.log(`  copied  ${file}`);
}

console.log(`\n✓ Synced ${copied} file(s) from server/ → make-server-64775d98/`);
console.log("  Run `pnpm edge:deploy` to deploy (or `supabase functions deploy make-server-64775d98 --project-ref gbllxumuogsncoiaksum`).");
