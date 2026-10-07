"""Build data/research.json from the local Indonesia broker-report archive.

Runs locally (the PDFs never leave the PC; only metadata is published):
    uv run --with pymupdf python scripts/build_research.py
Folder layout (made by indo-sort.ps1):
    Desktop/Indonesia Related Reports/<Company | Indonesia Sector>/[YYMMDD] [Broker] <Name> - <Title>.pdf
"""
import json, os, re, sys
import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHIVE = os.environ.get("INDO_ARCHIVE", os.path.join(os.path.expanduser("~"), "Desktop", "Indonesia Related Reports"))
OUT = os.path.join(ROOT, "data", "research.json")
TICKERS = os.path.join(os.path.expanduser("~"), ".claude", "sorting-folder-rename", "indo-tickers.json")

FNAME = re.compile(r"^\[(\d{6})\] \[([^\]]+)\] (.+?) - (.+)\.pdf$", re.I)
HOUSE = {"UOBKayHian": "UOB Kay Hian", "BNISekuritas": "BNI Sekuritas", "GoldmanSachs": "Goldman Sachs",
         "MorganStanley": "Morgan Stanley", "JPMorgan": "JPMorgan", "CGS": "CGS International"}
RATING_WORDS = r"(HIGH CONVICTION OUTPERFORM|OUTPERFORM|UNDERPERFORM|OVERWEIGHT|UNDERWEIGHT|NEUTRAL|BUY|ADD|HOLD|REDUCE|SELL|NOT RATED|NON-RATED|N-R)"
NORM = {"OVERWEIGHT": "OW", "UNDERWEIGHT": "UW", "NEUTRAL": "N", "HIGH CONVICTION OUTPERFORM": "HC O-PF",
        "OUTPERFORM": "O-PF", "UNDERPERFORM": "U-PF", "NON-RATED": "NOT RATED", "N-R": "NOT RATED"}
BULL = {"BUY", "ADD", "OW", "O-PF", "HC O-PF"}
BEAR = {"SELL", "REDUCE", "UW", "U-PF"}
RANK = {"SELL": 0, "U-PF": 0, "UW": 0, "REDUCE": 1, "HOLD": 2, "N": 2, "NOT RATED": 2, "ADD": 3, "BUY": 4, "OW": 4, "O-PF": 4, "HC O-PF": 5}
CUR = r"(?:IDR|Rp)\s?"
NUM = r"([\d]{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)"

def num(s):
    try:
        return float(s.replace(",", ""))
    except Exception:
        return None

def norm_rating(r):
    r = r.upper().strip()
    return NORM.get(r, r)

def extract(text, house):
    t = re.sub(r"\s+", " ", text)
    res = {}
    # --- explicit rating change: "Downgrade from Add to Hold" / "upgrade to Buy from Hold"
    m = re.search(r"\b(upgrad\w*|downgrad\w*)\b[^.]{0,40}?\bfrom\s+" + RATING_WORDS + r"\s+to\s+" + RATING_WORDS, t, re.I)
    if m:
        res.update(action=m.group(1)[:2].lower() == "up" and "upgrade" or "downgrade", prev=norm_rating(m.group(2)), rating=norm_rating(m.group(3)))
    else:
        m = re.search(r"\b(upgrad\w*|downgrad\w*)\b[^.]{0,30}?\bto\s+(?:an?\s+)?" + RATING_WORDS + r"(?:\s+from\s+" + RATING_WORDS + r")?", t, re.I)
        if m:
            res.update(action=m.group(1)[:2].lower() == "up" and "upgrade" or "downgrade", rating=norm_rating(m.group(2)))
            if m.group(3): res["prev"] = norm_rating(m.group(3))
    if "rating" not in res:
        m = re.search(r"\b(initiat\w*)\b[^.]{0,60}?\b(?:with\s+(?:an?\s+)?)?" + RATING_WORDS + r"\b", t, re.I)
        if m:
            res.update(action="initiate", rating=norm_rating(m.group(2)))
    if "rating" not in res:
        m = re.search(r"\b(?:maintain\w*|reiterat\w*|retain\w*|keep\w*|stay)\s+(?:our\s+|an?\s+)?" + RATING_WORDS + r"\b", t, re.I)
        if m:
            res.update(action="maintain", rating=norm_rating(m.group(1)))
    if "rating" not in res:
        # Nomura sidebar "Rating Remains Buy" / "Rating Changed from Hold to Buy"
        m = re.search(r"\bRating (?:Remains|Maintained|Unchanged) " + RATING_WORDS + r"\b", t, re.I)
        if m:
            res.update(action="maintain", rating=norm_rating(m.group(1)))
        else:
            m = re.search(r"\bRating (?:Changed|Upgraded|Downgraded|Raised|Lowered|Cut) from " + RATING_WORDS + r" to " + RATING_WORDS, t, re.I)
            if m:
                res.update(prev=norm_rating(m.group(1)), rating=norm_rating(m.group(2)))
    if "rating" not in res:
        # JPM cover "stay OW Overweight ADMR.JK" / CLSA "Rec N-R" / UOB "NOT RATED Share Price"
        m = (re.search(r"\b(Overweight|Neutral|Underweight|Not Rated)\s+[A-Z]{4}\.JK", t)
             or re.search(r"\bRec\s+" + RATING_WORDS + r"\b", t, re.I)
             or re.search(r"\b(NOT RATED)\s+Share Price", t))
        if m:
            res["rating"] = norm_rating(m.group(1))
    if "rating" not in res:
        # CLSA cover "Rp1,540 - HIGH CONVICTION OUTPERFORM"; JPM/others "Rating: Buy"
        m = re.search(CUR + NUM + r"\s*-\s*" + RATING_WORDS + r"\b", t) or re.search(r"\b(?:rating|recommendation)\s*[:\-]?\s*" + RATING_WORDS + r"\b", t, re.I)
        if m:
            res["rating"] = norm_rating(m.group(m.lastindex))
    # --- target price
    m = (re.search(r"\b(?:TP|target price|price target|PT)\b[^.]{0,25}?\bfrom\s+" + CUR + NUM + r"\s+to\s+" + CUR + NUM, t, re.I)
         or re.search(r"\b(?:cut|lower|raise|trim|increase|reduce)\w*\s+(?:our\s+)?(?:TP|target price|price target)\s+(?:by\s+[\d.]+%\s+)?from\s+" + CUR + NUM + r"\s+to\s+" + CUR + NUM, t, re.I))
    jpm = re.search(r"Price Target \([A-Za-z]{3}-\d\d\):\s*" + CUR + NUM + r"(?:\s*Prior \([A-Za-z]{3}-\d\d\):\s*" + CUR + NUM + ")?", t)
    nom = re.search(r"Target price (?:Raised|Lowered|Cut|Increased|Reduced|Changed) from " + CUR + NUM + r" to " + CUR + NUM, t, re.I)
    if m:
        res["ptp"], res["tp"] = num(m.group(1)), num(m.group(2))
    elif jpm:
        res["tp"] = num(jpm.group(1))
        if jpm.group(2): res["ptp"] = num(jpm.group(2))
    elif nom:
        res["ptp"], res["tp"] = num(nom.group(1)), num(nom.group(2))
    else:
        m = re.search(r"\b(?:TP|target price|price target|PT)\b[^.]{0,25}?\bto\s+" + CUR + NUM + r"\s+(?:\(?from\s+)" + CUR + NUM, t, re.I)
        if m:
            res["tp"], res["ptp"] = num(m.group(1)), num(m.group(2))
        else:
            m = re.search(r"\b(?:TP|target price|price target|PT|12m TP|Target)\b\s*(?:of|at|is|:|to|unchanged at)?\s*(?:our\s+)?" + CUR + NUM, t, re.I)
            if m:
                res["tp"] = num(m.group(1))
    if res.get("rating") == "NOT RATED":
        res.pop("tp", None); res.pop("ptp", None)
    if res.get("tp") is not None and res["tp"] < 10:   # catches "Rp2" style garbage
        res.pop("tp"); res.pop("ptp", None)
    if res.get("prev") and res.get("rating") and "action" not in res:
        res["action"] = "upgrade" if RANK.get(res["rating"], 2) > RANK.get(res["prev"], 2) else "downgrade"
    return res

def main():
    tick_map = {}
    try:
        with open(TICKERS, encoding="utf-8-sig") as f:
            for k, v in json.load(f).items():
                tick_map[(v if isinstance(v, str) else v.get("name", "")).lower()] = k
    except Exception:
        pass
    notes = []
    for folder in sorted(os.listdir(ARCHIVE)):
        fp = os.path.join(ARCHIVE, folder)
        if not os.path.isdir(fp) or folder.lower().startswith("indo sorting"):
            continue
        is_sector = folder.startswith("Indonesia ")
        kind = "company"
        if is_sector:
            kind = {"Indonesia Macro": "macro", "Indonesia Strategy": "strategy"}.get(folder, "sector")
        for fn in sorted(os.listdir(fp)):
            m = FNAME.match(fn)
            if not m:
                continue
            ymd, house, name, title = m.groups()
            rec = {"d": f"20{ymd[:2]}-{ymd[2:4]}-{ymd[4:]}", "h": HOUSE.get(house, house), "co": name, "f": folder,
                   "k": kind, "t": title.strip()}
            text = ""
            try:
                doc = pymupdf.open(os.path.join(fp, fn))
                text = " ".join(doc[i].get_text() for i in range(min(2, len(doc))))
            except Exception as e:
                print("  unreadable", fn, e)
            tk = None
            m2 = re.search(r"\(([A-Z]{4}) IJ\b", text) or re.search(r"\b([A-Z]{4})\.JK\b", text) or re.search(r"\b([A-Z]{4}) IJ\b", text)
            if kind == "company":
                tk = tick_map.get(name.lower()) or (m2.group(1) if m2 else None)
                rec.update(extract(text[:6000], house))
            if tk:
                rec["tk"] = tk
            notes.append(rec)
    notes.sort(key=lambda r: (r["d"], r["h"]), reverse=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"notes": notes}, f, ensure_ascii=False, indent=0)
    co = [n for n in notes if n["k"] == "company"]
    print(f"{len(notes)} notes; {len(co)} company; rating {sum('rating' in n for n in co)}; tp {sum('tp' in n for n in co)}; ticker {sum('tk' in n for n in co)}")
    if "-v" in sys.argv:
        for n in co:
            print(n["d"], n["h"][:10].ljust(10), n.get("tk", "----"), n["co"][:28].ljust(28), n.get("action", ""), n.get("prev", ""), n.get("rating", "?"), n.get("ptp", ""), n.get("tp", "?"))

if __name__ == "__main__":
    main()
