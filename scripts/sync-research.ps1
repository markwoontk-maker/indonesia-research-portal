# Rebuild data/research.json from the local Indonesia report archive and push it.
# PDFs never leave this PC; only metadata (date, house, company, title, rating, TP) is published.
# Intended to run daily after the 12:00 "Indonesia Sorting Folder Rename" task.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$log = Join-Path $repo 'scripts\sync-research.log'
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Add-Content -Path $log -Encoding utf8 }

try {
    git pull --rebase --autostash -q 2>&1 | Out-Null
    $out = & uv run --with pymupdf python scripts\build_research.py 2>&1 | Where-Object { $_ -notmatch 'deprecated' }
    Log ($out -join ' ')
    git add data/research.json
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
        git commit -q -m "research: sync notes $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
        git push -q 2>&1 | Out-Null
        Log 'pushed'
    } else { Log 'no changes' }
} catch {
    Log "ERROR $($_.Exception.Message)"
    exit 1
}
