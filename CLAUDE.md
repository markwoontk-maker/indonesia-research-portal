# Indonesia Research Portal: project notes

Sister site to `India-Research-Portal`. It uses the same look and the same tabs, minus Company, Charts and Settings.

## Hosting
- Static GitHub Pages site. Public repo `markwoontk-maker/indonesia-research-portal`, branch `main`, served from the root (`.nojekyll`).
- Live URL: https://markwoontk-maker.github.io/indonesia-research-portal/
- There is no build step. The page is `index.html` + `assets/style.css` + `assets/app.js`, with Chart.js and Google Fonts from CDNs. The page only reads the pre-baked JSON in `data/`.
- **Always commit + push on any change**, so the live site stays current.

## Data pipeline (all free, keyless)
**idx.co.id returns 403 to GitHub Actions runners**, so the `idx` step (plus the research sync) runs on the PC via `scripts/local-refresh.ps1` (Windows task **"Indonesia Portal Data Refresh"**, weekdays 12:30 + 18:00 MYT, StartWhenAvailable; log `scripts/local-refresh.log`) and pushes the raw IDX files. `scripts/refresh.py yahoo news build` runs in GitHub Actions (`.github/workflows/refresh.yml`): every 30 min, 08:05-18:35 WIB on weekdays, plus news-only runs on evenings and weekends. Each run commits `data/`.
- **IDX** (`idx.co.id/primary/...`, behind Cloudflare). Fetched with `curl_cffi` Chrome impersonation; plain requests and curl get a 403.
  - `TradingSummary/GetStockSummary?date=YYYYMMDD` returns every stock's close, value and **ForeignBuy/ForeignSell (in shares)**. Raw files are stored as `data/idx/YYYY/YYYYMMDD.csv.gz`, backfilled from 1 Oct 2025.
  - Foreign net value = (fbuy − fsell) × VWAP, where VWAP = value/volume, summed over all boards. Check: 6 Oct 2026 came to −Rp601bn vs −Rp630bn in the press.
  - `TradingSummary/GetIndexSummary?date=` returns closes for all 45 IDX indices, kept in `data/index_hist.json` from 25 Jan 2021. **Yahoo has no daily history for IDX30/IDX80/Kompas100/SMC/sector indices (`IDX*.JK`)**, only intraday, so `refresh_yahoo()` swaps in the IDX history for those.
  - `ListedCompany/GetCompanyProfiles` gives the sector (Indonesian) per stock, mapped to English IDX-IC names in `SECTOR_EN` and saved as `data/companies.json` (refreshed weekly).
  - `data/idx_empty_days.json` lists holidays already probed, so the backfill doesn't re-request them.
- **Yahoo** v8 chart (indices, USD/IDR `IDR=X`, EIDO) and v7 spark (returns, 52W high/low and sparklines for the top ~260 stocks by market cap) → `quotes.json`, `series.json`, `yahoo_stocks.json`.
- **Google News RSS** buckets (Policy, Economy, Markets, Earnings, Corporate, plus a Bahasa "Foreign flows" bucket) → `news.json`.
- `build` derives `stocks.json`, `flows.json` (daily net, per-sector daily, top buy/sell windows), `market.json` (breadth) and `strategy_perf.json`.

## Local-only pieces
- **Research tab**: `scripts/build_research.py` (uv + pymupdf) reads `Desktop\Indonesia Related Reports\<folder>\[YYMMDD] [Broker] Name - Title.pdf`, auto-extracts rating/TP from pages 1-2 and writes `data/research.json`. The PDFs are never published. `scripts/local-refresh.ps1` runs it together with the IDX fetch, then commits and pushes. Tickers come from `~\.claude\sorting-folder-rename\indo-tickers.json`.
- **Strategy tab**: `data/strategy.json` is curated by hand from the house strategy PDFs (stance, JCI target, points, top picks with TPs, adds/removes). Update it when a new strategy note lands. Pick performance is computed automatically.

## Gotchas
- Don't probe with `python`/`python3` in Bash (Windows Store stub hangs). Use `uv run --with <pkg> python ...`.
- IDX closes are unadjusted, which is fine for short windows. Multi-period stock returns come from Yahoo, which adjusts for splits.
- Watchlist and holdings live in the viewer's localStorage (`idrp.watch`, `idrp.hold`).
