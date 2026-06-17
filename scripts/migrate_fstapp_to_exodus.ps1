##############################################################
# migrate_fstapp_to_exodus.ps1
#
# Copies all tables + data from:
#   FST APP project  (gbllxumuogsncoiaksum) — public schema
# into:
#   eXodus project   (qbexqpvzmssmifimlfos) — fst_app schema
#
# Prerequisites:
#   - PostgreSQL client tools installed (pg_dump, psql)
#     https://www.postgresql.org/download/windows/
#   - Service-role passwords for both projects
#     (Settings > Database > Connection string in Supabase dashboard)
##############################################################

# ── CONFIG — fill these in before running ─────────────────────
# FST APP (source) — public schema
$SRC_HOST     = "db.gbllxumuogsncoiaksum.supabase.co"
$SRC_PORT     = "5432"
$SRC_DB       = "postgres"
$SRC_USER     = "postgres"
$SRC_PASSWORD = "REPLACE_WITH_FSTAPP_DB_PASSWORD"

# eXodus (destination) — fst_app schema
$DST_HOST     = "db.qbexqpvzmssmifimlfos.supabase.co"
$DST_PORT     = "5432"
$DST_DB       = "postgres"
$DST_USER     = "postgres"
$DST_PASSWORD = "REPLACE_WITH_EXODUS_DB_PASSWORD"

# Output directory for dump files
$DUMP_DIR     = "$PSScriptRoot\dump"
# ──────────────────────────────────────────────────────────────

# Tables to migrate (public schema → fst_app schema)
$TABLES = @(
    "customers",
    "districts",
    "fieldvisits",
    "incidents",
    "panels",
    "kv_store_64775d98",
    "incident_updates",
    "qc_pallets",
    "qc_guns",
    "qc_gun_checks",
    "driver_loads",
    "driver_load_items"
)

# ── Setup ──────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $DUMP_DIR | Out-Null

$env:PGPASSWORD = $SRC_PASSWORD

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  FST APP → eXodus Migration" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# ── STEP 1: Dump schema (DDL only) from FST APP public ────────
Write-Host "`n[1/4] Dumping schema from FST APP (public)..." -ForegroundColor Yellow

$schemaArgs = @(
    "--host=$SRC_HOST",
    "--port=$SRC_PORT",
    "--username=$SRC_USER",
    "--dbname=$SRC_DB",
    "--schema=public",
    "--schema-only",
    "--no-owner",
    "--no-privileges",
    "--no-comments",
    "--file=$DUMP_DIR\schema_public.sql"
)
foreach ($t in $TABLES) {
    $schemaArgs += "--table=public.$t"
}

pg_dump @schemaArgs
if ($LASTEXITCODE -ne 0) { Write-Error "Schema dump failed"; exit 1 }
Write-Host "  ✓ Schema dumped → $DUMP_DIR\schema_public.sql" -ForegroundColor Green

# ── STEP 2: Dump data (INSERT statements) from FST APP public ─
Write-Host "`n[2/4] Dumping data from FST APP (public)..." -ForegroundColor Yellow

$dataArgs = @(
    "--host=$SRC_HOST",
    "--port=$SRC_PORT",
    "--username=$SRC_USER",
    "--dbname=$SRC_DB",
    "--schema=public",
    "--data-only",
    "--inserts",
    "--no-owner",
    "--no-privileges",
    "--file=$DUMP_DIR\data_public.sql"
)
foreach ($t in $TABLES) {
    $dataArgs += "--table=public.$t"
}

pg_dump @dataArgs
if ($LASTEXITCODE -ne 0) { Write-Error "Data dump failed"; exit 1 }
Write-Host "  ✓ Data dumped  → $DUMP_DIR\data_public.sql" -ForegroundColor Green

# ── STEP 3: Transform dumps for fst_app schema ────────────────
Write-Host "`n[3/4] Transforming dumps (public → fst_app)..." -ForegroundColor Yellow

# Read & rewrite schema: replace "public." with "fst_app."
$schemaSQL = Get-Content "$DUMP_DIR\schema_public.sql" -Raw
$schemaSQL = $schemaSQL -replace 'SET search_path = public', 'SET search_path = fst_app'
$schemaSQL = $schemaSQL -replace '"public"\.', '"fst_app".'
$schemaSQL = $schemaSQL -replace '\bpublic\.', 'fst_app.'
# Prepend schema creation
$schemaSQL = "CREATE SCHEMA IF NOT EXISTS fst_app;`nSET search_path = fst_app, public;`n`n" + $schemaSQL
$schemaSQL | Set-Content "$DUMP_DIR\schema_fst_app.sql" -Encoding UTF8

# Read & rewrite data: replace "public." with "fst_app."
$dataSQL = Get-Content "$DUMP_DIR\data_public.sql" -Raw
$dataSQL  = $dataSQL  -replace 'SET search_path = public', 'SET search_path = fst_app'
$dataSQL  = $dataSQL  -replace '"public"\.', '"fst_app".'
$dataSQL  = $dataSQL  -replace '\bpublic\.', 'fst_app.'
$dataSQL | Set-Content "$DUMP_DIR\data_fst_app.sql" -Encoding UTF8

Write-Host "  ✓ Schema → $DUMP_DIR\schema_fst_app.sql" -ForegroundColor Green
Write-Host "  ✓ Data   → $DUMP_DIR\data_fst_app.sql" -ForegroundColor Green

# ── STEP 4: Apply to eXodus ────────────────────────────────────
Write-Host "`n[4/4] Applying to eXodus (fst_app schema)..." -ForegroundColor Yellow

$env:PGPASSWORD = $DST_PASSWORD

# Apply grants script first, then schema, then data
$grantSQL = @"
CREATE SCHEMA IF NOT EXISTS fst_app;
GRANT USAGE  ON SCHEMA fst_app TO anon, authenticated, service_role;
"@
$grantSQL | psql --host=$DST_HOST --port=$DST_PORT --username=$DST_USER --dbname=$DST_DB
if ($LASTEXITCODE -ne 0) { Write-Error "Grant failed"; exit 1 }

psql --host=$DST_HOST --port=$DST_PORT --username=$DST_USER --dbname=$DST_DB `
     --file="$DUMP_DIR\schema_fst_app.sql"
if ($LASTEXITCODE -ne 0) { Write-Error "Schema apply failed"; exit 1 }
Write-Host "  ✓ Schema applied" -ForegroundColor Green

psql --host=$DST_HOST --port=$DST_PORT --username=$DST_USER --dbname=$DST_DB `
     --file="$DUMP_DIR\data_fst_app.sql"
if ($LASTEXITCODE -ne 0) { Write-Error "Data apply failed"; exit 1 }
Write-Host "  ✓ Data applied" -ForegroundColor Green

# ── STEP 5: Apply permissions ──────────────────────────────────
$permSQL = @"
SET search_path = fst_app;
GRANT SELECT ON ALL TABLES IN SCHEMA fst_app TO anon, authenticated;
GRANT ALL    ON ALL TABLES IN SCHEMA fst_app TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA fst_app GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA fst_app GRANT ALL    ON TABLES TO service_role;
"@

$permSQL | psql --host=$DST_HOST --port=$DST_PORT --username=$DST_USER --dbname=$DST_DB
if ($LASTEXITCODE -ne 0) { Write-Error "Permissions apply failed"; exit 1 }
Write-Host "  ✓ Permissions applied" -ForegroundColor Green

Write-Host "`n==================================================" -ForegroundColor Cyan
Write-Host "  Migration complete!" -ForegroundColor Green
Write-Host "  Dump files saved in: $DUMP_DIR" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
