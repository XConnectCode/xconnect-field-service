##############################################################
# migrate_fstapp_to_exodus_cli.ps1
#
# Completely AUTOMATED, PASSWORD-FREE, DOCKER-FREE migration.
#
# Uses PostgREST API with service role key to fetch data from FST APP.
# Uses Supabase CLI link + query command to apply schema and batch inserts to eXodus.
#
# Run: .\scripts\migrate_fstapp_to_exodus_cli.ps1
##############################################################

$SRC_PROJECT = "gbllxumuogsncoiaksum"
$DST_PROJECT = "qbexqpvzmssmifimlfos"
$SRC_URL     = "https://$SRC_PROJECT.supabase.co/rest/v1"
$SRC_KEY     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdibGx4dW11b2dzbmNvaWFrc3VtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc0NDY1MywiZXhwIjoyMDg4MzIwNjUzfQ.KPpyP6zKalkl4lelkJHTlaJIcorceL9-wQSmDFb9dSw"

$SCRIPT_DIR  = $PSScriptRoot
$SCHEMA_FILE = Join-Path $SCRIPT_DIR "migration_partB_create_fst_app_tables.sql"
$DUMP_DIR    = Join-Path $SCRIPT_DIR "dump"
$DATA_FILE   = Join-Path $DUMP_DIR "data_inserts_fst_app.sql"

# ── Pre-flight ────────────────────────────────────────────────
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    Write-Error "supabase CLI not found. Run: winget install Supabase.CLI"
    exit 1
}

if (-not (Test-Path $SCHEMA_FILE)) {
    Write-Error "Missing schema file: $SCHEMA_FILE"
    exit 1
}

New-Item -ItemType Directory -Force -Path $DUMP_DIR | Out-Null

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  FST APP -> eXodus Auto-Migration (Docker-Free)"  -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Source : FST APP ($SRC_PROJECT)" -ForegroundColor Gray
Write-Host "  Dest   : eXodus  ($DST_PROJECT)" -ForegroundColor Gray
Write-Host "==================================================" -ForegroundColor Cyan

# ── Verify already logged in ──────────────────────────────────
Write-Host ""
Write-Host "[1/4] Verifying Supabase login..." -ForegroundColor Yellow
$projList = supabase projects list 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Not logged in - opening browser..." -ForegroundColor Yellow
    supabase login
    if ($LASTEXITCODE -ne 0) { Write-Error "Login failed"; exit 1 }
}
Write-Host "  OK - Authenticated" -ForegroundColor Green

# ── Link to destination project ───────────────────────────────
Write-Host ""
Write-Host "[2/4] Linking to eXodus ($DST_PROJECT)..." -ForegroundColor Yellow
$null = supabase link --project-ref $DST_PROJECT --password dummy 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to link destination project"
    exit 1
}
Write-Host "  OK - Linked" -ForegroundColor Green

# ── Apply Schema DDL ──────────────────────────────────────────
Write-Host ""
Write-Host "[3/4] Applying Schema to eXodus..." -ForegroundColor Yellow
$res = supabase db query --linked -f $SCHEMA_FILE 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAILED to apply schema!" -ForegroundColor Red
    Write-Host $res
    exit 1
}
Write-Host "  OK - Schema created/verified" -ForegroundColor Green

# ── Fetch & Apply Data ────────────────────────────────────────
Write-Host ""
Write-Host "[4/4] Migrating table data via PostgREST..." -ForegroundColor Yellow

$HEADERS = @{
    "apikey"        = $SRC_KEY
    "Authorization" = "Bearer $SRC_KEY"
    "Accept"        = "application/json"
    "Prefer"        = "count=exact"
}

# Tables in dependency order
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

# SQL value formatter
function To-SqlValue($val) {
    if ($null -eq $val) { return "NULL" }
    if ($val -is [System.Management.Automation.PSCustomObject] -or $val -is [System.Object[]]) {
        $json = $val | ConvertTo-Json -Compress -Depth 10
        if ($null -eq $json) { return "NULL" }
        return "'" + $json.Replace("'", "''") + "'"
    }
    $t = $val.GetType().Name
    switch ($t) {
        "Boolean" { if ($val) { return "true" } else { return "false" } }
        "Int32"   { return "$val" }
        "Int64"   { return "$val" }
        "Double"  { return "$val" }
        "Decimal" { return "$val" }
        default {
            $s = $val.ToString().Replace("'", "''")
            return "'$s'"
        }
    }
}

# Fetch pages
function Get-AllRows($table) {
    $allRows = @()
    $pageSize = 1000
    $offset   = 0
    do {
        $uri = "$SRC_URL/$table`?select=*&limit=$pageSize&offset=$offset"
        try {
            $page = Invoke-RestMethod -Uri $uri -Headers $HEADERS -Method GET -ErrorAction Stop
        } catch {
            Write-Host "    ERROR fetching ${table}: $_" -ForegroundColor Red
            return @()
        }
        if (-not $page -or $page.Count -eq 0) { break }
        $allRows += $page
        $offset  += $pageSize
    } while ($page.Count -eq $pageSize)
    return $allRows
}

$totalRows = 0
$insertLines = [System.Collections.Generic.List[string]]::new()

foreach ($table in $TABLES) {
    Write-Host "  Fetching data for $table..." -ForegroundColor Gray
    $rows = Get-AllRows $table
    if (-not $rows -or $rows.Count -eq 0) {
        Write-Host "    0 rows" -ForegroundColor DarkGray
        continue
    }
    Write-Host "    Found $($rows.Count) rows. Preparing inserts..." -ForegroundColor DarkGray
    $totalRows += $rows.Count

    $cols = ($rows[0] | Get-Member -MemberType NoteProperty).Name
    $colList = ($cols | ForEach-Object { """$_""" }) -join ", "

    foreach ($row in $rows) {
        $vals = ($cols | ForEach-Object { To-SqlValue $row.$_ }) -join ", "
        $insertLines.Add("INSERT INTO fst_app.$table ($colList) VALUES ($vals) ON CONFLICT DO NOTHING;")
    }
}

# Save dump for record-keeping/local reference
$insertLines | Set-Content $DATA_FILE -Encoding UTF8

if ($insertLines.Count -eq 0) {
    Write-Host "  No data rows found to migrate." -ForegroundColor Yellow
} else {
    Write-Host "  Applying $($insertLines.Count) rows in batches..." -ForegroundColor Yellow
    $batchSize = 400
    $batch = [System.Collections.Generic.List[string]]::new()
    $count = 0

    for ($i = 0; $i -lt $insertLines.Count; $i++) {
        $batch.Add($insertLines[$i])
        if ($batch.Count -eq $batchSize -or $i -eq $insertLines.Count - 1) {
            $query = "SET search_path = fst_app, public;`n" + ($batch -join "`n")
            $count++
            Write-Host "    Batch $count ($($batch.Count) lines)... " -NoNewline
            $res = supabase db query --linked $query 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Host "FAILED!" -ForegroundColor Red
                Write-Host $res
                exit 1
            }
            Write-Host "OK" -ForegroundColor Green
            $batch.Clear()
        }
    }
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Migration completed successfully! $totalRows rows." -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
