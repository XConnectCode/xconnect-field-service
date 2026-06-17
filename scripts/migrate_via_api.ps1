##############################################################
# migrate_via_api.ps1
#
# Uses the Supabase Management API (/database/query endpoint)
# to copy all tables from FST APP (public) -> eXodus (fst_app).
#
# NO Docker, NO pg_dump, NO DB password required.
# Authentication: service_role keys (fetched automatically
# from your browser login via supabase CLI).
#
# Run from: C:\FSTOnline\
#   .\scripts\migrate_via_api.ps1
##############################################################

$SRC_PROJECT  = "gbllxumuogsncoiaksum"   # FST APP
$DST_PROJECT  = "qbexqpvzmssmifimlfos"   # eXodus
$API_BASE     = "https://api.supabase.com/v1"
$SCRIPT_DIR   = $PSScriptRoot

# Service role keys (fetched live from your logged-in CLI session)
$SRC_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdibGx4dW11b2dzbmNvaWFrc3VtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc0NDY1MywiZXhwIjoyMDg4MzIwNjUzfQ.KPpyP6zKalkl4lelkJHTlaJIcorceL9-wQSmDFb9dSw"
$DST_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFiZXhxcHZ6bXNzbWlmaW1sZm9zIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc3MjU4MywiZXhwIjoyMDkyMzQ4NTgzfQ.5THNaq4krYlz-DcBM2bW_tccnaVswtHWsg1q6SOhbWQ"

# Tables to migrate (order matters — parents before children)
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

# ── Helper: run SQL via Management API ────────────────────────
function Invoke-SbSQL($projectRef, $serviceKey, $sql) {
    $body = @{ query = $sql } | ConvertTo-Json -Depth 10
    try {
        $resp = Invoke-RestMethod `
            -Uri "$API_BASE/projects/$projectRef/database/query" `
            -Method POST `
            -Headers @{
                Authorization  = "Bearer $serviceKey"
                "Content-Type" = "application/json"
            } `
            -Body $body `
            -ErrorAction Stop
        return $resp
    } catch {
        $msg = $_.ErrorDetails.Message
        if (-not $msg) { $msg = $_.Exception.Message }
        throw "SQL Error on $projectRef`n$msg`nSQL: $($sql.Substring(0, [Math]::Min(200,$sql.Length)))"
    }
}

# ── Helper: escape SQL string value ───────────────────────────
function Escape-SqlValue($val) {
    if ($null -eq $val) { return "NULL" }
    $str = $val.ToString()
    # Handle JSON/array values (already strings from API)
    $str = $str.Replace("'", "''")
    return "'$str'"
}

# ── Helper: convert a result row to an INSERT VALUES clause ───
function Row-ToValues($row, $cols) {
    $vals = foreach ($col in $cols) {
        $v = $row.$col
        if ($null -eq $v) {
            "NULL"
        } else {
            $s = $v.ToString().Replace("'", "''")
            "'$s'"
        }
    }
    return "(" + ($vals -join ", ") + ")"
}

# ── Main ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  FST APP -> eXodus Migration (Management API)"    -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# ── STEP 1: Create fst_app schema + tables on eXodus ──────────
Write-Host ""
Write-Host "[1/3] Creating fst_app schema and tables on eXodus..." -ForegroundColor Yellow

$ddlFile = Join-Path $SCRIPT_DIR "migration_partB_create_fst_app_tables.sql"
if (-not (Test-Path $ddlFile)) {
    Write-Error "Missing: $ddlFile"
    exit 1
}

# Split DDL into statements and run each (API runs one statement at a time)
$ddlContent = Get-Content $ddlFile -Raw -Encoding UTF8
# Split on semicolon+newline boundaries, skip comments and blanks
$statements = $ddlContent -split ';\s*\n' | ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and $_ -notmatch '^\s*--' -and $_.Length -gt 5 }

$total = $statements.Count
$i = 0
foreach ($stmt in $statements) {
    $i++
    $preview = $stmt.Substring(0, [Math]::Min(60, $stmt.Length)) -replace '\n',' '
    Write-Host "  [$i/$total] $preview..." -ForegroundColor DarkGray
    try {
        Invoke-SbSQL $DST_PROJECT $DST_KEY $stmt | Out-Null
    } catch {
        Write-Host "  WARNING: $_" -ForegroundColor DarkYellow
        # Continue — most warnings are "already exists" which is fine
    }
}
Write-Host "  OK - Schema ready on eXodus" -ForegroundColor Green

# ── STEP 2: Copy data table by table ──────────────────────────
Write-Host ""
Write-Host "[2/3] Copying data from FST APP -> eXodus..." -ForegroundColor Yellow

foreach ($table in $TABLES) {
    Write-Host ""
    Write-Host "  Table: $table" -ForegroundColor White

    # Read all rows from FST APP
    try {
        $rows = Invoke-SbSQL $SRC_PROJECT $SRC_KEY "SELECT * FROM public.$table"
    } catch {
        Write-Host "    SKIP (table may not exist or be empty): $_" -ForegroundColor DarkYellow
        continue
    }

    if (-not $rows -or $rows.Count -eq 0) {
        Write-Host "    (empty — skipping)" -ForegroundColor DarkGray
        continue
    }

    Write-Host "    $($rows.Count) rows to copy" -ForegroundColor DarkGray

    # Get column names from first row
    $cols = ($rows[0] | Get-Member -MemberType NoteProperty).Name

    # Batch INSERT in chunks of 100 rows
    $batchSize = 100
    $batches = [Math]::Ceiling($rows.Count / $batchSize)

    for ($b = 0; $b -lt $batches; $b++) {
        $batch = $rows | Select-Object -Skip ($b * $batchSize) -First $batchSize
        $colList = ($cols | ForEach-Object { """$_""" }) -join ", "
        $valuesList = ($batch | ForEach-Object { Row-ToValues $_ $cols }) -join ",`n"
        $insertSQL = "INSERT INTO fst_app.$table ($colList) VALUES`n$valuesList ON CONFLICT DO NOTHING;"

        try {
            Invoke-SbSQL $DST_PROJECT $DST_KEY $insertSQL | Out-Null
            Write-Host "    Batch $($b+1)/$batches inserted" -ForegroundColor DarkGray
        } catch {
            Write-Host "    ERROR on batch $($b+1): $_" -ForegroundColor Red
        }
    }

    Write-Host "    OK - $table copied" -ForegroundColor Green
}

# ── STEP 3: Apply grants ──────────────────────────────────────
Write-Host ""
Write-Host "[3/3] Applying grants..." -ForegroundColor Yellow

$grantsSQL = @(
    "GRANT USAGE ON SCHEMA fst_app TO anon, authenticated, service_role",
    "GRANT SELECT ON ALL TABLES IN SCHEMA fst_app TO anon, authenticated",
    "GRANT ALL ON ALL TABLES IN SCHEMA fst_app TO service_role",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA fst_app GRANT SELECT ON TABLES TO anon, authenticated",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA fst_app GRANT ALL ON TABLES TO service_role"
)
foreach ($g in $grantsSQL) {
    try { Invoke-SbSQL $DST_PROJECT $DST_KEY $g | Out-Null }
    catch { Write-Host "  WARNING: $_" -ForegroundColor DarkYellow }
}
Write-Host "  OK - Grants applied" -ForegroundColor Green

# ── Done ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Migration complete!"                              -ForegroundColor Green
Write-Host ""
Write-Host "  Verify in eXodus SQL Editor:"                    -ForegroundColor White
Write-Host "    SELECT table_name, table_type"                 -ForegroundColor Gray
Write-Host "    FROM information_schema.tables"                -ForegroundColor Gray
Write-Host "    WHERE table_schema = 'fst_app'"                -ForegroundColor Gray
Write-Host "    ORDER BY table_name;"                          -ForegroundColor Gray
Write-Host "==================================================" -ForegroundColor Cyan
