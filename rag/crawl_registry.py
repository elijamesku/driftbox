import os, re, time, json
from typing import List, Dict, Any, Optional
import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

BASE = "https://registry.terraform.io"
LIST_BASE = f"{BASE}/providers/hashicorp/aws/latest/docs/resources"

UA = {"User-Agent": "infrara-crawler/0.1 (+https://example.com)"}

def _get(url: str) -> Optional[str]:
    try:
        r = requests.get(url, headers=UA, timeout=20)
        if r.status_code == 200:
            return r.text
        return None
    except Exception:
        return None

def _abs(href: str) -> str:
    if href.startswith("http"):
        return href
    if href.startswith("/"):
        return BASE + href
    return href

def _extract_resource_links(list_html: str) -> List[str]:
    soup = BeautifulSoup(list_html, "html.parser")

    # Primary: correct SoupSieve selector (value quoted)
    links = [a.get("href","") for a in soup.select("a[href^=\"/providers/hashicorp/aws/latest/docs/resources/\"]")]

    # Fallback: manual filter if SoupSieve/HTML differs
    if not links:
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.startswith("/providers/hashicorp/aws/latest/docs/resources/"):
                links.append(href)

    # Keep only leaf pages (avoid category pages), normalize & dedupe
    links = [_abs(h) for h in links if h.count("/") >= 9]
    return sorted(set(links))

def _parse_resource_page(html: str, url: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")

    # Title usually in <h1>
    h1 = soup.find("h1")
    title = (h1.get_text(strip=True) if h1 else url.rstrip("/").split("/")[-1])

    # Argument Reference
    args: List[Dict[str, str]] = []
    arg_hdr = soup.find(lambda tag: tag.name in ["h2","h3"] and "argument" in tag.get_text(strip=True).lower())
    if arg_hdr:
        # collect following <li> items until the next header
        for el in arg_hdr.find_all_next():
            if el.name in ["h2","h3"]:
                break
            if el.name == "li":
                txt = el.get_text(" ", strip=True)
                m = re.match(r"^([a-zA-Z0-9_]+)\s*[-:]\s*(.*)$", txt)
                if m:
                    args.append({"arg": m.group(1), "desc": m.group(2)})
                else:
                    args.append({"arg": "", "desc": txt})

    # Examples: take code blocks
    examples: List[str] = []
    for pre in soup.select("pre code"):
        code_txt = pre.get_text()
        if code_txt and len(code_txt) > 20:
            examples.append(code_txt[:8000])  # cap

    return {
        "provider": "aws",
        "type": title.strip(),
        "url": url,
        "args": args,
        "examples": examples[:8],
    }

def crawl_provider_resources(provider: str = "aws", max_pages: int = 5) -> List[Dict[str, Any]]:
    if provider != "aws":
        raise ValueError("only aws supported in this crawler")

    all_links: List[str] = []
    for page in range(1, max_pages+1):
        list_url = LIST_BASE + (f"?page={page}" if page > 1 else "")
        html = _get(list_url)
        if not html:
            break
        batch = _extract_resource_links(html)
        if not batch:
            break
        all_links.extend(batch)
        time.sleep(0.3)

    all_links = sorted(set(all_links))

    results: List[Dict[str, Any]] = []
    for url in tqdm(all_links, desc="Crawling resources"):
        html = _get(url)
        if not html:
            continue
        try:
            results.append(_parse_resource_page(html, url))
        except Exception:
            continue
        time.sleep(0.2)

    print(f"Fetched {len(results)} aws resource docs")
    return results
