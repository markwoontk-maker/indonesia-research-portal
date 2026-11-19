# Local half of the data pipeline (runs on this PC via Task Scheduler):
#   1. IDX stock + index summaries (foreign flows, breadth, sector index history).
#      idx.co.id returns 403 to GitHub Actions runners, so this cannot run in the cloud.
#   2. Research notes index from the local Indonesia report archive (PDFs never leave the PC).
# GitHub Actions handles Yahoo quotes and news every 30 minutes and rebuilds from the committed IDX files.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$log = Join-Path $repo 'scripts\local-refresh.log'
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Add-Content -Path $log -Encoding utf8 }

git pull --rebase --autostash -q 2>&1 | Out-Null
# Keep curl_cffi current: on 2026-11-11 idx.co.id began returning 403 to the 0.16.x build; 0.17 works.
$idx = & uv run --with "curl_cffi>=0.17" python scripts\refresh.py idx build 2>&1 | Select-String 'fetched|HTTP|ERR'
Log ("idx: " + ($idx -join ' | '))
$rn = & uv run --with pymupdf python scripts\build_research.py 2>&1 | Where-Object { $_ -notmatch 'deprecated' }
Log ("research: " + ($rn -join ' '))

git add data
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -q -m "data: local IDX + research sync $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    for ($i = 0; $i -lt 3; $i++) {
        git pull --rebase -X theirs -q 2>&1 | Out-Null
        git push -q 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Log 'pushed'; break }
        Start-Sleep -Seconds 10
    }
} else { Log 'no changes' }
