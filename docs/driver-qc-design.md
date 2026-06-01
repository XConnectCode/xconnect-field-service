# Driver Checklist + QC Modules — Design Doc

Status: **DRAFT for approval** · Target app: `xconnect-field-service` · Author: Computer
Last updated: 2026-06-01

This doc proposes two new operational modules that live natively inside the existing app
(Supabase tables → Hono edge routes → Tailwind React pages → role-gated sidebar nav, plus
the existing reusable image-upload system). Build order: **Drivers first, then QC.**

---

## 0. Business context (as captured)

XConnect manufactures **perforating guns**. Production flow:

```
materials received → assembly (single gun) → loading team (wire, shaped charges, det cord)
   → QC (visual inspection) → palletized build (~100 guns, varies) → hotshot driver delivery
```

- Some guns ship **"unloaded"** (no det cord, no shaped charges).
- **NetSuite** generates paperwork with a **Pallet Build #** + order info (charges, orientation, parts).
- A **QC-passed pallet** should flow into a **driver's load checklist** (the two modules are linked).

---

## 1. Roles (NEW)

Today the app has two roles: `admin`, `sqm`. We add **one** combined role: **`ops`**
(Driver + QC personnel share the same access — both see both new modules).

| Role     | Sees |
|----------|------|
| `admin`  | Everything (existing + both new modules) |
| `sqm`    | Existing operations pages (unchanged) |
| `ops`    | Driver module **and** QC module only (same views for both teams) |

Implementation touch points (small, contained):
- `auth-context.tsx` line ~44: widen role derivation to accept `'admin' | 'sqm' | 'ops'`
  (default still `sqm` = least privilege).
- `auth-context.tsx` line 23: widen the `User.role` union type.
- `sidebar.tsx` line ~26: widen the `Role` type and add a new "Production" nav group
  (Driver Loads, QC) with `roles: ['admin','ops']`.
- `routes.tsx`: generalize the existing `AdminOnly` guard → `RequireRole(roles=[...])`.

Roles are assigned in Supabase user metadata (`app_metadata.role`), same as admin today.

## 1.5 Shared XC location list (consistency fix)

Today the same concept is spelled three different ways:
- **Panels** → `XC_BASE_OPTS = ['Denver','Midland','Williston']` (dropdown, in PanelForm + PanelDetail).
- **Incidents** → `xc_district` is a **free-text Input** (placeholder "e.g. Permian Basin").
- New **Driver/QC origin** → needs the operational bases.

Fix: create `src/app/lib/xcLocations.ts` with TWO exports (per the Denver nuance — Denver is
Panels-only because inventory lives there; the two operational bases are Midland + Williston):
```ts
export const XC_BASES = ['Midland', 'Williston'] as const;          // Incidents + Driver/QC origin
export const XC_PANEL_BASES = ['Denver', 'Midland', 'Williston'] as const; // Panels keeps Denver
```
Adoption:
- **Panels** (PanelForm, PanelDetail): replace local `XC_BASE_OPTS` with `XC_PANEL_BASES`.
- **Incidents** (IncidentForm): convert `xc_district` Input → Select of `XC_BASES`. **Preserve** any
  existing non-standard value (e.g. "Permian Basin") by injecting it as an extra option when the
  current record's value isn't in `XC_BASES`, so historical incidents still render. Only new entries
  are constrained to the list.
- **Driver/QC origin district** uses `XC_BASES`.
> This is a separate small PR (no edge change) — ship before/alongside Module A roles plumbing.

---

## 2. MODULE A — Hotshot Driver Checklist (BUILD FIRST)

Replaces the existing AppSheet form (current fields shown in §2.0). Goal: before leaving, confirm the
**right items are loaded, paperwork + explosives are correct, the vehicle is secure, and the right
people signed off.**

### 2.0 Current AppSheet fields (source of truth, to be reproduced/improved)
Delivery Date · District · Packing Slip # · Mode of Delivery · Is a Trailer Connected · Picture of
Packing Slip · Hazmat Load · Picture of Hazmat · Document Correlation · Pallets · Ancillary Explosives ·
Explosives Pictures · Hardware · Hardware Pictures · Item's Secure · Driver side (photo) ·
Passenger Side (photo) · Inspector(+sig) · Driver(+sig) · Manager(+sig) · Receiver(sig).

### Decisions applied
- **3rd-party drivers**: `driver_type` toggle = Internal | 3rd-party. If 3rd-party, capture free-text
  `driver_name` + `driver_company` (no app login required).
- **Sign-offs**: three roles — **Driver, Inspector, Manager** — each a **drawn signature** (signature pad).
  (Receiver + duplicate Inspector from the old form dropped.)
- **Photos required where applicable** (conditional): if Hazmat=yes → hazmat photo required;
  if Ancillary Explosives present → explosives photo required; packing slip photo required;
  hardware photo required if hardware present; driver-side + passenger-side photos required.
  Missing a required photo **blocks sign-off**.
- **Hard blockers for departure**: `document_correlation` confirmed AND `items_secure` confirmed.

### Screens
- **`/driver` — My Loads** (list; status chips). Admin sees all; driver sees own.
- **`/driver/:id` — Load Checklist** (the working screen, sectioned below).

### Checklist sections
1. **Delivery info** — Delivery Date, **Origin District = XC base (Midland/Williston) the load departs
   from** (dropdown from `XC_BASES`), Packing Slip #, Mode of Delivery, Trailer Connected (y/n),
   Driver type (Internal/3rd-party + name/company). **Customer + customer district are NOT typed** —
   they auto-populate from the selected pallet / packing slip paperwork.
2. **Load / cargo** — Pallets line items (Build # from QC-passed pallets; selecting a pallet
   auto-fills customer + customer district + destination from its paperwork), qty expected vs loaded,
   Hardware (y/n + **required photo if present**).
3. **Paperwork** — Packing Slip (+ **required photo**), Hazmat Load (y/n; if yes **photo required**),
   **Document Correlation** (confirm — hard blocker).
4. **Ancillary explosives** — present? + types **Detonators / Power Charges / Igniters** (multi),
   + **required Explosives Pictures** if present.
5. **Vehicle / securing** — **Item's Secure** (confirm — hard blocker), Driver-side photo (required),
   Passenger-side photo (required).
6. **Sign-off** — Driver, Inspector, Manager drawn signatures + name + timestamp.

A load **cannot be marked "Ready to depart"** until: both hard blockers confirmed, all required
photos present, and the required signatures captured.

### Linkage to QC
Pallet line items are **populated from QC-passed pallets** (`qc_pallets.status='passed'`); selecting
one stamps Build # + destination. (Built in step 4 of the sequence.)

### Data model
```
driver_loads
  row_id (uuid pk)        load_number (text)        delivery_date (date)
  origin_district (text)  -- XC base the load departs from (Midland|Williston)
  customer (text)         customer_district (text)  -- AUTO-pulled from pallet/packing slip
  destination (text)      packing_slip_no (text)    mode_of_delivery (text)
  trailer_connected (bool)
  driver_type ('internal'|'third_party')   driver (text/email, internal)
  driver_name (text)      driver_company (text)     -- 3rd-party only
  hazmat_load (bool)      hardware_present (bool)
  ancillary_explosives (bool)   explosive_types (text[]: detonators|power_charges|igniters)
  document_correlation (bool)   items_secure (bool)
  driver_sig_url (text)   inspector_name (text)  inspector_sig_url (text)
  manager_name (text)     manager_sig_url (text)
  status ('draft'|'ready'|'departed'|'delivered')
  departed_by (text)      departed_at (timestamptz)
  notes (text)            updated_by (text)   created_at / updated_at

driver_load_items
  row_id (uuid pk)        load_row_id (fk → driver_loads)
  pallet_build_no (text, nullable)     description (text)
  qty_expected (int)      qty_loaded (int)     destination (text)
  checked (bool)          note (text)
  source_pallet_row_id (fk → qc_pallets, nullable)  ← the QC link
```
Photos (packing slip, hazmat, explosives, hardware, driver/passenger side) attach via the existing
image system: `POST /images/driver_loads/:rowId` with a `label` to distinguish each shot.
Signatures are stored as uploaded PNG data-URLs → same image bucket, referenced by `*_sig_url`.

### Backend routes (edge fn `make-server-64775d98`)
```
GET    /driver-loads            list (driver sees own; admin all)
POST   /driver-loads            create
PUT    /driver-loads/:id        update (incl. mark ready/departed; validates blockers)
DELETE /driver-loads/:id        (requireAdmin)
GET    /driver-loads/:id        detail (+ items + images)
POST   /driver-loads/:id/items  add/replace items
(reuse) /images/driver_loads/:rowId   photos + signatures
```
> Edge files change here → **edge deploy required** for Module A.

---

## 3. MODULE B — QC for Perforating Guns (BUILD SECOND)

Goal: make QC airtight — nothing missed, verified done, and a record of **who** did it.

### Inspection model (your call: per-gun, then pallet sign-off)
- A **pallet** (one NetSuite **Build #**) is the container.
- QC logs **per-gun** inspection results; the **pallet** is signed off only when every gun passes.
- Pallet **cannot be signed off** while any gun has an open/failed item (**flag + block**).

### Order-info verification (your call: upload NetSuite PDF)
- QC **uploads the NetSuite paperwork PDF** (and/or photos) to the pallet via the existing
  image/file upload system (`POST /images/:parentTable/:parentRowId`, reused with `parentTable='qc_pallets'`).
- QC verifies the physical build **against** that uploaded sheet (expected charges / orientation / parts).

### Per-gun checklist (loaded vs unloaded → your call: same checklist, items optional)
One checklist; load-specific items are marked **N/A** for unloaded guns:
1. Correct **parts** (per order)
2. Correct **orientation**
3. Correct **shaped charges** *(N/A if unloaded)*
4. **Det cord** correct/present *(N/A if unloaded)*
5. **Wiring** correct
6. **Built correctly** (overall visual)
+ optional **defect photo** per gun, + note.

Each item state: `pass` / `fail` / `n/a`. Any `fail` → gun = failed → pallet blocked.

### Screens
- **`/qc` — Pallets** (list: Build #, qty, passed/total guns, status, who signed off)
- **`/qc/:id` — Pallet Inspection** (upload NetSuite PDF; gun-by-gun checklist grid; progress bar; sign-off button)
- QC dashboard tile counts (open / passed / failed pallets).

### Sign-off & audit
- Per gun: `inspected_by`, `inspected_at`.
- Pallet: `signed_off_by`, `signed_off_at` — only enabled when `guns_passed == guns_total`
  and `guns_total > 0`. Status flips to `passed`, which makes it selectable in Module A.

### Data model
```
qc_pallets
  row_id (uuid pk)        build_no (text, from NetSuite)   customer / destination (text)
  load_type ('loaded'|'unloaded')        guns_total (int)
  status ('open'|'in_progress'|'passed'|'failed')
  signed_off_by (text)    signed_off_at (timestamptz)
  updated_by (text)       created_at / updated_at
  (NetSuite PDF + photos attached via existing images table, parentTable='qc_pallets')

qc_guns
  row_id (uuid pk)        pallet_row_id (fk → qc_pallets)
  gun_index (int)         serial / unit (text, nullable)
  result ('pending'|'pass'|'fail')
  inspected_by (text)     inspected_at (timestamptz)
  notes (text)

qc_gun_checks
  row_id (uuid pk)        gun_row_id (fk → qc_guns)
  item_key (text: parts|orientation|charges|detcord|wiring|build)
  state ('pass'|'fail'|'na')      note (text)
```

### Backend routes
```
GET/POST/PUT/DELETE  /qc-pallets[/:id]
GET                  /qc-pallets/:id                detail (+ guns + checks)
POST                 /qc-pallets/:id/guns           init N guns for a pallet
PUT                  /qc-guns/:id                   record gun result + checks
POST                 /qc-pallets/:id/signoff        validates all-pass, stamps signer
(reuse) /images/qc_pallets/:rowId                   NetSuite PDF + photos
```
> Edge files change here → **edge deploy required** for Module B.

---

## 4. Cross-cutting / standing-rules compliance
- **`updated_by`** stamped on create AND edit for all new tables (panels/fieldvisits rule). New tables include the column from day one.
- **Deploy**: Codespaces + pnpm; ship via PR → merge → sync Codespace → **edge deploy** (both modules touch edge files).
- Each new `.tsx` transpile-checked via esbuild before commit.
- Reuse existing `ui/` components (Card, Table, Select, Dialog, Button, Badge) — Tailwind, not inline styles, so these pages match the modern half of the app.

## 5. Open items to confirm at build time (not blockers)
- Exact paperwork checklist labels for drivers (BOL, packing slip, hazmat for loaded — confirm wording).
- Whether `driver` should be able to create a load from scratch or only work loads assigned by admin.
- Default required-vs-optional for each driver checklist item.

## 6. Proposed build sequence
1. **Migration 1**: roles plumbing (auth-context + sidebar + RequireRole guard). *(no edge change)*
2. **Migration 2 + edge + page**: Driver module (tables, routes, `/driver` + `/driver/:id`). Ship + edge deploy.
3. **Migration 3 + edge + page**: QC module (tables, routes, `/qc` + `/qc/:id`, PDF upload, sign-off). Ship + edge deploy.
4. Wire the QC→Driver link (QC-passed pallets selectable in driver load items).
```
