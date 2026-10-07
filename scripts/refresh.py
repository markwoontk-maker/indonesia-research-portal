"""Indonesia Research Portal - data refresher.

Free, keyless sources only:
  * IDX stock summary (idx.co.id, fetched with curl_cffi browser impersonation)
    -> per-stock close, value traded and FOREIGN buy/sell volume for every listed stock.
  * Yahoo Finance chart/spark -> indices, IDX-IC sector indices, USD/IDR, stock returns.
  * Google News RSS -> Indonesia news buckets.

Usage:  python scripts/refresh.py [idx] [yahoo] [news] [build]   (default: all)
"""
import csv, datetime as dt, email.utils, gzip, io, json, math, os, re, sys, time
import xml.etree.ElementTree as ET
from urllib.parse import quote

from curl_cffi import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
RAW = os.path.join(DATA, "idx")
WIB = dt.timezone(dt.timedelta(hours=7))
BACKFILL_FROM = dt.date(2025, 10, 1)
FLOWS_FROM = "2025-10-01"
S = requests.Session(impersonate="chrome")

# ---------------------------------------------------------------- helpers
def now_wib():
    return dt.datetime.now(WIB)

def jdump(name, obj):
    path = os.path.join(DATA, name)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)
    print(f"  wrote {name} ({os.path.getsize(path)//1024} KB)")

def jload(name, default=None):
    try:
        with open(os.path.join(DATA, name), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default

def get(url, tries=3, **kw):
    for i in range(tries):
        try:
            r = S.get(url, timeout=40, **kw)
            if r.status_code == 200:
                return r
            print(f"  HTTP {r.status_code} {url[:110]}")
            if r.status_code in (404,):
                return None
        except Exception as e:
            print(f"  ERR {e} {url[:110]}")
        time.sleep(2 + 3 * i)
    return None

def rnd(x, n=2):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(x, n)

# ---------------------------------------------------------------- IDX
SECTOR_EN = {
    "Energi": "Energy",
    "Barang Baku": "Basic Materials",
    "Perindustrian": "Industrials",
    "Barang Konsumen Primer": "Consumer Non-Cyclicals",
    "Barang Konsumen Non-Primer": "Consumer Cyclicals",
    "Kesehatan": "Healthcare",
    "Keuangan": "Financials",
    "Properti & Real Estat": "Property & Real Estate",
    "Teknologi": "Technology",
    "Infrastruktur": "Infrastructure",
    "Transportasi & Logistik": "Transportation & Logistics",
}
RAW_COLS = ["code", "name", "prev", "close", "high", "low", "vol", "val", "freq", "fbuy", "fsell", "listed"]

def raw_path(d):
    return os.path.join(RAW, d.strftime("%Y"), d.strftime("%Y%m%d") + ".csv.gz")

def fetch_idx_day(d):
    url = f"https://www.idx.co.id/primary/TradingSummary/GetStockSummary?length=9999&start=0&date={d:%Y%m%d}"
    r = get(url)
    if r is None:
        return None
    try:
        rows = r.json().get("data") or []
    except Exception:
        print("  non-JSON IDX response (blocked?)", r.text[:200])
        return None
    return rows

def refresh_companies():
    meta = jload("companies.json", {})
    if meta and time.time() - meta.get("_ts", 0) < 6 * 86400:
        return meta
    r = get("https://www.idx.co.id/primary/ListedCompany/GetCompanyProfiles?start=0&length=9999")
    if r is None:
        return meta
    out = {"_ts": int(time.time())}
    for c in r.json().get("data", []):
        code = (c.get("KodeEmiten") or "").strip()
        if not code:
            continue
        name = re.sub(r"^PT\.?\s+|\s+Tbk\.?$|\s*\(Persero\)", "", (c.get("NamaEmiten") or "").strip())
        out[code] = {
            "n": name.strip(),
            "s": SECTOR_EN.get((c.get("Sektor") or "").strip(), c.get("Sektor") or ""),
            "ss": c.get("SubSektor") or "",
            "ind": c.get("Industri") or "",
            "b": c.get("PapanPencatatan") or "",
        }
    jdump("companies.json", out)
    return out

def refresh_idx():
    print("IDX: companies")
    refresh_companies()
    print("IDX: daily stock summaries")
    today = now_wib().date()
    have = set()
    for root, _, files in os.walk(RAW):
        have.update(f[:8] for f in files if f.endswith(".csv.gz"))
    # non-trading days we already probed (holidays/weekends) so backfill doesn't re-hit them
    empty = set(jload("idx_empty_days.json", []))
    d = BACKFILL_FROM
    fetched = 0
    while d <= today:
        key = d.strftime("%Y%m%d")
        recent = (today - d).days <= 3          # always re-pull the last few days (late corrections)
        if d.weekday() < 5 and (recent or (key not in have and key not in empty)):
            rows = fetch_idx_day(d)
            if rows is None:
                print(f"  {key}: fetch failed")
            elif not rows:
                if not recent:
                    empty.add(key)
            else:
                os.makedirs(os.path.dirname(raw_path(d)), exist_ok=True)
                # mtime=0 keeps the gzip bytes deterministic, so unchanged days don't create commits
                with io.TextIOWrapper(gzip.GzipFile(raw_path(d), "wb", mtime=0), newline="", encoding="utf-8") as f:
                    w = csv.writer(f)
                    w.writerow(RAW_COLS)
                    for x in rows:
                        w.writerow([x.get("StockCode"), (x.get("StockName") or "").strip(), x.get("Previous"), x.get("Close"),
                                    x.get("High"), x.get("Low"), x.get("Volume"), x.get("Value"), x.get("Frequency"),
                                    x.get("ForeignBuy"), x.get("ForeignSell"), x.get("ListedShares")])
                fetched += 1
            time.sleep(0.6)
        d += dt.timedelta(days=1)
    jdump("idx_empty_days.json", sorted(empty))
    print(f"  fetched {fetched} day files")
    refresh_idx_indices(empty)

INDEX_FROM = dt.date(2021, 1, 25)   # IDX-IC sector indices launch date

def refresh_idx_indices(empty):
    """Daily closes for all IDX indices -> data/index_hist.json {code: {"d": [...], "c": [...]}}.
    Yahoo has no daily history for IDX30/IDX80/sector indices, so these feed the charts."""
    print("IDX: index summaries")
    hist = jload("index_hist.json", {}) or {}
    have = set()
    for v in hist.values():
        have.update(v["d"])
    today = now_wib().date()
    d = INDEX_FROM
    n = 0
    while d <= today:
        iso = d.isoformat(); key = d.strftime("%Y%m%d")
        recent = (today - d).days <= 3
        if d.weekday() < 5 and (recent or (iso not in have and key not in empty)):
            r = get(f"https://www.idx.co.id/primary/TradingSummary/GetIndexSummary?length=9999&start=0&date={key}")
            rows = None                      # None = fetch failed (429 etc.); [] = genuine non-trading day
            if r is not None:
                try:
                    rows = r.json().get("data") or []
                except Exception:
                    rows = None
            if rows:
                for x in rows:
                    h = hist.setdefault(x["IndexCode"], {"d": [], "c": []})
                    if iso in h["d"]:
                        h["c"][h["d"].index(iso)] = x["Close"]
                    else:
                        h["d"].append(iso); h["c"].append(x["Close"])
                n += 1
            elif rows == [] and not recent:
                empty.add(key)
            time.sleep(0.4)
        d += dt.timedelta(days=1)
    for h in hist.values():
        z = sorted(zip(h["d"], h["c"]))
        h["d"] = [a for a, _ in z]; h["c"] = [b for _, b in z]
    jdump("index_hist.json", hist)
    jdump("idx_empty_days.json", sorted(empty))
    print(f"  fetched {n} index days")

def load_raw_days():
    days = []
    for root, _, files in os.walk(RAW):
        for f in files:
            if f.endswith(".csv.gz"):
                days.append(os.path.join(root, f))
    days.sort(key=lambda p: os.path.basename(p))
    out = []
    for p in days:
        d = os.path.basename(p)[:8]
        rows = {}
        with gzip.open(p, "rt", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                try:
                    vol = float(r["vol"] or 0); val = float(r["val"] or 0); close = float(r["close"] or 0)
                    rows[r["code"]] = {
                        "name": r["name"], "prev": float(r["prev"] or 0), "close": close, "vol": vol, "val": val,
                        "fb": float(r["fbuy"] or 0), "fs": float(r["fsell"] or 0), "listed": float(r["listed"] or 0),
                        "vwap": (val / vol) if vol > 0 else close,
                    }
                except ValueError:
                    pass
        if rows:
            out.append((f"{d[:4]}-{d[4:6]}-{d[6:]}", rows))
    return out

# ---------------------------------------------------------------- Yahoo
INDICES = [
    # sym, label, group
    ("^JKSE", "JCI", "core"), ("^JKLQ45", "LQ45", "core"), ("IDX30.JK", "IDX30", "core"),
    ("IDX80.JK", "IDX80", "core"), ("KOMPAS100.JK", "Kompas100", "core"),
    ("IDXSMC-LIQ.JK", "IDX SMC Liquid", "core"), ("IDXHIDIV20.JK", "IDX High Div 20", "core"),
    ("ISSI.JK", "ISSI Sharia", "core"), ("IDR=X", "USD/IDR", "fx"), ("EIDO", "MSCI Indonesia ETF (USD)", "fx"),
    ("IDXENERGY.JK", "Energy", "sector"), ("IDXBASIC.JK", "Basic Materials", "sector"),
    ("IDXINDUST.JK", "Industrials", "sector"), ("IDXNONCYC.JK", "Consumer Non-Cyclicals", "sector"),
    ("IDXCYCLIC.JK", "Consumer Cyclicals", "sector"), ("IDXHEALTH.JK", "Healthcare", "sector"),
    ("IDXFINANCE.JK", "Financials", "sector"), ("IDXPROPERT.JK", "Property & Real Estate", "sector"),
    ("IDXTECHNO.JK", "Technology", "sector"), ("IDXINFRA.JK", "Infrastructure", "sector"),
    ("IDXTRANS.JK", "Transportation & Logistics", "sector"),
]

def ychart(sym, rng, interval):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(sym)}?range={rng}&interval={interval}&includePrePost=false"
    r = get(url)
    if r is None:
        return None
    try:
        return r.json()["chart"]["result"][0]
    except Exception:
        return None

def series_of(res):
    if not res or not res.get("timestamp"):
        return None
    ts = res["timestamp"]; cl = res["indicators"]["quote"][0].get("close") or []
    t, c = [], []
    for a, b in zip(ts, cl):
        if b is not None:
            t.append(a); c.append(round(b, 4 if b < 100 else 2))
    return {"t": t, "c": c}

def period_returns(t, c, now_ts=None):
    """Returns over 1D/1W/1M/6M/YTD/1Y from a daily close series."""
    if not c:
        return {}
    last = c[-1]
    def back(n):
        return c[-1 - n] if len(c) > n else None
    def pct(a):
        return rnd((last / a - 1) * 100) if a else None
    yr = dt.datetime.fromtimestamp(t[-1], WIB).year
    ytd_base = None
    for a, b in zip(t, c):
        if dt.datetime.fromtimestamp(a, WIB).year < yr:
            ytd_base = b
    return {"1D": pct(back(1)), "1W": pct(back(5)), "1M": pct(back(21)), "6M": pct(back(126)),
            "YTD": pct(ytd_base), "1Y": pct(c[0])}

def idx_hist_series(hist, code):
    """(daily-1y, weekly-all) series from IDX's own index closes, timestamped 16:00 WIB."""
    h = hist.get(code)
    if not h or len(h["d"]) < 30:
        return None, None
    ts = [int(dt.datetime.fromisoformat(d + "T16:00:00+07:00").timestamp()) for d in h["d"]]
    cut = ts[-1] - 366 * 86400
    daily = {"t": [t for t in ts if t >= cut], "c": [c for t, c in zip(ts, h["c"]) if t >= cut]}
    wk = {}
    for d, t, c in zip(h["d"], ts, h["c"]):
        wk[dt.date.fromisoformat(d).isocalendar()[:2]] = (t, c)
    weekly = {"t": [v[0] for v in wk.values()], "c": [v[1] for v in wk.values()]}
    return daily, weekly

def refresh_yahoo():
    print("Yahoo: indices")
    quotes, series = {}, {}
    hist = jload("index_hist.json", {}) or {}
    for sym, label, grp in INDICES:
        d1 = ychart(sym, "1d", "5m")
        y1 = ychart(sym, "1y", "1d")
        y10 = ychart(sym, "10y", "1wk")
        w1 = ychart(sym, "5d", "30m")
        if not y1:
            print("  missing", sym); continue
        m = y1["meta"]
        sy = series_of(y1)
        sy10 = series_of(y10)
        if not sy or len(sy["c"]) < 30:
            # Yahoo only carries intraday for most IDX indices -> fall back to IDX's own daily closes
            code = {"^JKLQ45": "LQ45", "^JKSE": "COMPOSITE"}.get(sym, sym.replace(".JK", ""))
            hd, hw = idx_hist_series(hist, code)
            if hd:
                # append today's live print if the IDX file hasn't got today's close yet
                if d1 and d1.get("timestamp") and m.get("regularMarketPrice"):
                    tday = dt.datetime.fromtimestamp(d1["timestamp"][-1], WIB).date()
                    if tday > dt.datetime.fromtimestamp(hd["t"][-1], WIB).date():
                        hd = {"t": hd["t"] + [d1["timestamp"][-1]], "c": hd["c"] + [m["regularMarketPrice"]]}
                sy, sy10 = hd, hw
        price = m.get("regularMarketPrice")
        prev = sy["c"][-2] if sy and len(sy["c"]) > 1 else m.get("chartPreviousClose")
        # if today's bar isn't in the daily series yet, prev is the last daily close
        if sy and d1 and d1.get("timestamp"):
            last_day = dt.datetime.fromtimestamp(sy["t"][-1], WIB).date()
            intraday_day = dt.datetime.fromtimestamp(d1["timestamp"][-1], WIB).date()
            if intraday_day > last_day:
                prev = sy["c"][-1]
        rets = period_returns(sy["t"], sy["c"]) if sy else {}
        if price and prev:
            rets["1D"] = rnd((price / prev - 1) * 100)
        quotes[sym] = {"n": label, "g": grp, "p": price, "pc": prev, "ch": rnd(price - prev, 4) if price and prev else None,
                       "r": rets, "dh": m.get("regularMarketDayHigh"), "dl": m.get("regularMarketDayLow"),
                       "h52": m.get("fiftyTwoWeekHigh"), "l52": m.get("fiftyTwoWeekLow"), "ts": m.get("regularMarketTime")}
        series[sym] = {"d1": series_of(d1), "w1": series_of(w1), "y1": sy, "y10": sy10}
        time.sleep(0.3)
    jdump("quotes.json", {"updated": now_wib().isoformat(timespec="minutes"), "q": quotes})
    jdump("series.json", series)

    # ---- stock universe returns (top N by market cap from latest IDX day)
    print("Yahoo: stock universe")
    days = load_raw_days()
    comp = jload("companies.json", {})
    if not days:
        return
    asof, last = days[-1]
    ranked = sorted(last.items(), key=lambda kv: -kv[1]["close"] * kv[1]["listed"])
    universe = [k for k, v in ranked if v["val"] > 0][:260]
    # always cover names that the research/strategy tabs reference, plus any manual extras
    wl = list(jload("watchlist_seed.json", []))
    wl += [n["tk"] for n in (jload("research.json", {}) or {}).get("notes", []) if n.get("tk")]
    wl += [p["c"] for h in (jload("strategy.json", {}) or {}).get("houses", []) for p in h.get("picks", [])]
    for w in dict.fromkeys(wl):
        if w not in universe:
            universe.append(w)
    stocks = {}
    for i in range(0, len(universe), 20):
        chunk = universe[i:i + 20]
        url = "https://query1.finance.yahoo.com/v7/finance/spark?range=1y&interval=1d&symbols=" + ",".join(c + ".JK" for c in chunk)
        r = get(url)
        if r is None:
            continue
        try:
            res = r.json()["spark"]["result"]
        except Exception:
            continue
        for item in res:
            code = item["symbol"].replace(".JK", "")
            try:
                rr = item["response"][0]
                sy = series_of(rr)
            except Exception:
                sy = None
            if not sy or len(sy["c"]) < 5:
                continue
            stocks[code] = {"r": period_returns(sy["t"], sy["c"]), "h52": max(sy["c"]), "l52": min(sy["c"]),
                            "px": sy["c"][-1], "spark": sy["c"][-30:]}
        time.sleep(0.4)
    jdump("yahoo_stocks.json", {"updated": now_wib().isoformat(timespec="minutes"), "s": stocks})

# ---------------------------------------------------------------- News
NEWS_BUCKETS = {
    "POL": ("Policy", 'Indonesia (Prabowo OR government OR regulation OR minister OR parliament OR "Danantara" OR OJK) -cricket', "en"),
    "ECON": ("Economy", 'Indonesia ("Bank Indonesia" OR rupiah OR inflation OR GDP OR budget OR "bond yields" OR exports OR "trade balance")', "en"),
    "MKT": ("Markets", '("Jakarta Composite" OR JCI OR "Indonesia stock" OR "Indonesian stocks" OR "IDX" OR MSCI Indonesia)', "en"),
    "EARN": ("Earnings", 'Tbk (profit OR earnings OR revenue OR "net income" OR results) Indonesia', "en"),
    "CORP": ("Corporate", 'Tbk (acquisition OR "rights issue" OR stake OR IPO OR dividend OR buyback OR merger OR bonds)', "en"),
    "FLOW": ("Foreign flows", '(IHSG OR saham) ("net sell" OR "net buy" OR "jual bersih" OR "beli bersih") asing', "id"),
}
OPINION = re.compile(r"\b(should you|top \d+ stocks|stocks to buy|price prediction|forecast \d{4}|horoscope|zodiac|live updates)\b", re.I)

def gnews(q, lang, days=2):
    hl, ceid = ("en-ID", "ID:en") if lang == "en" else ("id", "ID:id")
    url = f"https://news.google.com/rss/search?q={quote(q + f' when:{days}d')}&hl={hl}&gl=ID&ceid={ceid}"
    r = get(url)
    if r is None:
        return []
    try:
        root = ET.fromstring(r.content)
    except ET.ParseError:
        return []
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        src = (it.find("source").text if it.find("source") is not None else "") or ""
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3]
        try:
            pub = email.utils.parsedate_to_datetime(it.findtext("pubDate")).astimezone(dt.timezone.utc)
        except Exception:
            continue
        items.append({"t": title, "l": it.findtext("link"), "d": pub.isoformat(timespec="minutes"), "s": src})
    return items

def refresh_news():
    print("News: Google News RSS")
    out, seen = {}, set()
    for key, (label, q, lang) in NEWS_BUCKETS.items():
        items = gnews(q, lang, days=3 if key in ("EARN", "CORP") else 2)
        keep = []
        for x in sorted(items, key=lambda x: x["d"], reverse=True):
            norm = re.sub(r"[^a-z0-9]", "", x["t"].lower())[:70]
            if norm in seen or OPINION.search(x["t"]):
                continue
            seen.add(norm); x["c"] = key; keep.append(x)
        out[key] = keep[:25]
        print(f"  {key}: {len(out[key])}")
        time.sleep(1)
    jdump("news.json", {"updated": now_wib().isoformat(timespec="minutes"), "labels": {k: v[0] for k, v in NEWS_BUCKETS.items()}, "b": out})

# ---------------------------------------------------------------- Build derived market/flows files
def build():
    print("Build: market + flows")
    days = load_raw_days()
    if not days:
        print("  no IDX data"); return
    comp = jload("companies.json", {})
    ys = (jload("yahoo_stocks.json", {}) or {}).get("s", {})
    asof, last = days[-1]

    def sector(code):
        return (comp.get(code) or {}).get("s") or "Other"

    # ---- breadth / turnover (latest session)
    adv = sum(1 for v in last.values() if v["vol"] > 0 and v["close"] > v["prev"])
    dec = sum(1 for v in last.values() if v["vol"] > 0 and v["close"] < v["prev"])
    unch = sum(1 for v in last.values() if v["vol"] > 0 and v["close"] == v["prev"])
    turnover = sum(v["val"] for v in last.values())

    # ---- stock table (all stocks with a trade today, or in the Yahoo universe)
    rows = []
    for code, v in last.items():
        mcap = v["close"] * v["listed"]
        if v["vol"] <= 0 and code not in ys:
            continue
        y = ys.get(code, {})
        rows.append({
            "c": code, "n": (comp.get(code) or {}).get("n") or v["name"], "s": sector(code),
            "p": v["close"], "d1": rnd((v["close"] / v["prev"] - 1) * 100) if v["prev"] else None,
            "mc": round(mcap / 1e9), "val": round(v["val"] / 1e9, 2),
            "fn": round((v["fb"] - v["fs"]) * v["vwap"] / 1e9, 2),
            "r": y.get("r"), "h52": y.get("h52"), "l52": y.get("l52"), "yp": y.get("px"), "sp": y.get("spark"),
        })
    rows.sort(key=lambda r: -r["mc"])
    jdump("stocks.json", {"asof": asof, "rows": rows})

    # ---- foreign flows
    fdays = [(d, r) for d, r in days if d >= FLOWS_FROM]
    daily = []
    sectors = {}
    per_stock_daily = []
    for i, (d, r) in enumerate(fdays):
        buy = sell = 0.0
        sec = {}
        ps = {}
        for code, v in r.items():
            b = v["fb"] * v["vwap"]; s_ = v["fs"] * v["vwap"]
            buy += b; sell += s_
            n = b - s_
            if n:
                ps[code] = n
                k = sector(code); sec[k] = sec.get(k, 0) + n
        daily.append({"d": d, "b": round(buy / 1e9, 1), "s": round(sell / 1e9, 1), "n": round((buy - sell) / 1e9, 1)})
        for k, val in sec.items():
            sectors.setdefault(k, [0.0] * len(fdays))[i] = round(val / 1e9, 1)
        per_stock_daily.append(ps)
    for k in sectors:
        sectors[k] += [0.0] * (len(fdays) - len(sectors[k]))

    def window_top(n_days=None, since=None):
        idx = [i for i, (d, _) in enumerate(fdays) if (since and d >= since)] if since else list(range(max(0, len(fdays) - n_days), len(fdays)))
        if not idx:
            return {"buy": [], "sell": []}
        agg = {}
        for i in idx:
            for code, n in per_stock_daily[i].items():
                agg[code] = agg.get(code, 0) + n
        first = fdays[idx[0]][1]
        def mk(code, n):
            p0 = (first.get(code) or {}).get("prev") or None
            p1 = (last.get(code) or {}).get("close")
            return {"c": code, "n": (comp.get(code) or {}).get("n") or (last.get(code) or {}).get("name", code), "s": sector(code),
                    "f": round(n / 1e9, 1), "px": rnd((p1 / p0 - 1) * 100) if p0 and p1 else None}
        srt = sorted(agg.items(), key=lambda kv: kv[1])
        return {"buy": [mk(c, n) for c, n in srt[::-1][:15] if n > 0], "sell": [mk(c, n) for c, n in srt[:15] if n < 0],
                "from": fdays[idx[0]][0], "to": fdays[idx[-1]][0]}

    y0 = asof[:4] + "-01-01"
    m0 = asof[:7] + "-01"
    top = {"1D": window_top(1), "1W": window_top(5), "1M": window_top(21), "MTD": window_top(since=m0), "YTD": window_top(since=y0)}
    jdump("flows.json", {"asof": asof, "unit": "IDR bn", "daily": daily, "sectors": sectors, "top": top})

    # ---- strategy top-pick performance since each house's report date (IDX closes, unadjusted)
    strat = jload("strategy.json", {}) or {}
    perf = {}
    for h in strat.get("houses", []):
        base = None
        for d, r in days:
            if d <= h["d"]:
                base = r
        if base is None:
            continue
        perf[h["h"]] = {p["c"]: [base[p["c"]]["close"], last[p["c"]]["close"]]
                        for p in h.get("picks", []) if p["c"] in base and p["c"] in last}
    jdump("strategy_perf.json", {"asof": asof, "p": perf})

    jdump("market.json", {"asof": asof, "adv": adv, "dec": dec, "unch": unch, "turnover": round(turnover / 1e12, 2),
                          "fnet": daily[-1]["n"] if daily else None, "listed": len(last)})


if __name__ == "__main__":
    jobs = sys.argv[1:] or ["idx", "yahoo", "news", "build"]
    os.makedirs(RAW, exist_ok=True)
    if "idx" in jobs: refresh_idx()
    if "yahoo" in jobs: refresh_yahoo()
    if "news" in jobs: refresh_news()
    if "build" in jobs: build()
