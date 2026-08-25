import traceback
import re, json, requests, traceback
from bs4 import BeautifulSoup
from typing import List, Dict, Any

UA = {
    "User-Agent": "infrara-crawler/0.1 (+https://infrara.example)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}

def _fetch(url: str) -> str:
    r = requests.get(url, headers=UA, timeout=25)
    r.raise_for_status()
    return r.text

def _clean_spaces(s: str) -> str:
    # keep newlines; collapse internal spaces per line
    return "\n".join(" ".join(line.split()) for line in (s or "").splitlines())

def _chunk_text(raw: str, maxlen: int = 1200) -> List[str]:
    # paragraph-aware chunking; preserves newlines between paragraphs
    paras = [p.strip() for p in re.split(r"\n{2,}", raw) if p.strip()]
    chunks, buf = [], ""
    for p in paras:
        if not buf:
            buf = p
        elif len(buf) + 1 + len(p) <= maxlen:
            buf = buf + "\n" + p
        else:
            chunks.append(buf)
            buf = p
    if buf:
        chunks.append(buf)
    if not chunks and raw.strip():
        s = raw.strip()
        for i in range(0, len(s), maxlen):
            chunks.append(s[i:i+maxlen])
    return chunks

LIKELY_KEYS = {"content","body","markdown","mdx","html","text","children","value","description"}

def _collect_strings_from_json(obj: Any, out: List[str]) -> None:
    # Walk the JSON tree and collect substantial strings
    if isinstance(obj, str):
        s = obj.strip()
        # ignore tiny strings and JS chunks
        if len(s) >= 80 and not s.startswith("{") and not s.startswith("["):
            out.append(s)
    elif isinstance(obj, list):
        for v in obj:
            _collect_strings_from_json(v, out)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, (str, list, dict)) and (k in LIKELY_KEYS or True):
                _collect_strings_from_json(v, out)

def _extract_from_next_data(soup: BeautifulSoup) -> List[str]:
    tag = soup.find("script", id="__NEXT_DATA__", type="application/json")
    if not tag or not tag.string:
        return []
    try:
        data = json.loads(tag.string)
    except Exception:
        return []
    buf: List[str] = []
    _collect_strings_from_json(data, buf)
    # Join and lightly clean; a lot of duplicates can appear — de-dupe lines.
    if not buf:
        return []
    text = "\n".join(buf)
    # Remove obvious noise
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = _clean_spaces(text)
    # Heuristic: keep only “long” segments by splitting on two newlines and filtering
    segs = [s for s in re.split(r"\n{2,}", text) if len(s) > 120]
    return segs

def _extract_plain_html(soup: BeautifulSoup) -> List[str]:
    root = soup.select_one("main") or soup.select_one("article") or soup.body or soup
    # remove chrome
    for sel in ("nav","aside","footer","header"):
        for t in root.select(sel):
            t.decompose()
    # inline code blocks with fences
    for pre in root.select("pre"):
        pre.string = "\n```text\n" + pre.get_text() + "\n```\n"
    txt = root.get_text("\n")
    txt = _clean_spaces(txt)
    if not txt.strip():
        return []
    segs = [s for s in re.split(r"\n{2,}", txt) if len(s) > 80]
    return segs

def _extract(url: str) -> Dict:
    html = _fetch(url)
    soup = BeautifulSoup(html, "lxml")
    # prefer Next.js JSON
    segs = _extract_from_next_data(soup)
    if not segs:
        # fallback to plain HTML
        segs = _extract_plain_html(soup)

    # Title
    h1 = soup.find("h1")
    title = _clean_spaces(h1.get_text()) if h1 and h1.get_text(strip=True) else url.rstrip("/").split("/")[-1]

    # chunk into ~1200 char chunks
    text = "\n\n".join(segs)
    chunks = _chunk_text(text, 1200)
    return {"title": title, "url": url, "chunks": chunks}

def crawl_learn_pages(urls: List[str], verbose: bool = False) -> List[Dict]:
    out: List[Dict] = []
    for u in urls:
        try:
            rec = _extract(u)
            if verbose:
                print(f"[ok] {u} → {len(rec.get("chunks") or [])} chunks")
            out.append(rec)
        except Exception:
            if verbose:
                print(f"[err] {u}")
                traceback.print_exc()
    return out
