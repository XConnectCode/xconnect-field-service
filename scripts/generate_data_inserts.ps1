##############################################################
# generate_data_inserts.ps1
#
# Reads all data from FST APP (public schema) via PostgREST API
# (no Docker, no DB password, no pg_dump needed).
#
# Outputs a SQL file ready to paste into the eXodus SQL Editor.
#
# Run: .\scripts\generate_data_inserts.ps1
# Then: paste the output SQL into eXodus SQL Editor
##############################################################

$SRC_PROJECT = "gbllxumuogsncoiaksum"
$SRC_URL     = "https://$SRC_PROJECT.supabase.co/rest/v1"
$SRC_KEY     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdibGx4dW11b2dzbmNvaWFrc3VtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc0NDY1MywiZXhwIjoyMDg4MzIwNjUzfQ.KPpyP6zKalkl4lelkJHTlaJIcorceL9-wQSmDFb9dSw"
$SCRIPT_DIR  = $PSScriptRoot
$OUT_FILE    = Join-Path $SCRIPT_DIR "dump\data_inserts_fst_app.sql"

$HEADERS = @{
    "apikey"        = $SRC_KEY
    "Authorization" = "Bearer $SRC_KEY"
    "Accept"        = "application/json"
    "Prefer"        = "count=exact"
}

# Tables in dependency order (parents before children)
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

# ── SQL value formatter ────────────────────────────────────────
function To-SqlValue($val) {
    if ($null -eq $val) { return "NULL" }

    # PSCustomObject or array = JSONB → serialize to JSON string
    if ($val -is [System.Management.Automation.PSCustomObject] -or $val -is [System.Object[]]) {
        $json = $val | ConvertTo-Json -Compress -Depth 10
        if ($null -eq $json) { return "NULL" }
        return "'" + $json.Replace("'", "''") + "'"
    }

    $t = $val.GetType().Name
    switch ($t) {
        "Boolean" {
            if ($val) { return "true" } else { return "false" }
        }
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

# ── Fetch all rows with pagination ────────────────────────────
function Get-AllRows($table) {
    $allRows = @()
    $pageSize = 1000
    $offset   = 0

    do {
        $uri = "$SRC_URL/$table`?select=*&limit=$pageSize&offset=$offset"
        try {
            $page = Invoke-RestMethod -Uri $uri -Headers $HEADERS -Method GET -ErrorAction Stop
        } catch {
            Write-Host "    ERROR fetching $table : $_" -ForegroundColor Red
            return @()
        }
        if (-not $page -or $page.Count -eq 0) { break }
        $allRows += $page
        $offset  += $pageSize
    } while ($page.Count -eq $pageSize)

    return $allRows
}

# ── Main ──────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path (Split-Path $OUT_FILE) | Out-Null

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  FST APP Data Extractor (PostgREST)"             -ForegroundColor Cyan
Write-Host "  Source: $SRC_PROJECT (public schema)"           -ForegroundColor Cyan
Write-Host "  Target schema: fst_app"                         -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("-- =====================================================")
$lines.Add("-- FST APP Data Inserts -> eXodus fst_app schema")
$lines.Add("-- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
$lines.Add("-- Run in: eXodus SQL Editor")
$lines.Add("-- =====================================================")
$lines.Add("SET search_path = fst_app, public;")
$lines.Add("")

$totalRows = 0

foreach ($table in $TABLES) {
    Write-Host ""
    Write-Host "  Fetching: $table ..." -ForegroundColor Yellow

    $rows = Get-AllRows $table

    if (-not $rows -or $rows.Count -eq 0) {
        Write-Host "    (empty or not found)" -ForegroundColor DarkGray
        $lines.Add("-- $table : no rows")
        $lines.Add("")
        continue
    }

    Write-Host "    $($rows.Count) rows" -ForegroundColor Green
    $totalRows += $rows.Count

    $cols = ($rows[0] | Get-Member -MemberType NoteProperty).Name
    $colList = ($cols | ForEach-Object { """$_""" }) -join ", "

    $lines.Add("-- -------------------------------------------------")
    $lines.Add("-- $table ($($rows.Count) rows)")
    $lines.Add("-- -------------------------------------------------")

    foreach ($row in $rows) {
        $vals = ($cols | ForEach-Object { To-SqlValue $row.$_ }) -join ", "
        $lines.Add("INSERT INTO fst_app.$table ($colList) VALUES ($vals) ON CONFLICT DO NOTHING;")
    }
    $lines.Add("")
}

$lines.Add("-- Grants")
$lines.Add("GRANT SELECT ON ALL TABLES IN SCHEMA fst_app TO anon, authenticated;")
$lines.Add("GRANT ALL    ON ALL TABLES IN SCHEMA fst_app TO service_role;")

# Write output
$lines | Set-Content $OUT_FILE -Encoding UTF8

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Done! $totalRows total rows extracted."          -ForegroundColor Green
Write-Host ""
Write-Host "  Output file:" -ForegroundColor White
Write-Host "    $OUT_FILE"  -ForegroundColor Yellow
Write-Host ""
Write-Host "  NEXT STEPS:"  -ForegroundColor White
Write-Host "  1. In eXodus SQL Editor, run:"                   -ForegroundColor Gray
Write-Host "     migration_partB_create_fst_app_tables.sql"    -ForegroundColor Gray
Write-Host "  2. Then run: data_inserts_fst_app.sql"           -ForegroundColor Gray
Write-Host "     (paste into SQL Editor, or split if large)"   -ForegroundColor Gray
Write-Host "==================================================" -ForegroundColor Cyan
