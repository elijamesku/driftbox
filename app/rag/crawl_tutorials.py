import traceback
import re, json, requests, traceback
from bs4 import BeautifulSoup
from typing import List, Dict, Any

HTTP_CRAWLER_USER_AGENT_HEADERS = {
    "User-Agent": "infrara-crawler/0.1 (+https://infrara.example)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}

def _fetch_tutorial_page_content(page_url: str) -> str:
    http_response = requests.get(page_url, headers=HTTP_CRAWLER_USER_AGENT_HEADERS, timeout=25)
    http_response.raise_for_status()
    return http_response.text

def _normalize_whitespace(text_content: str) -> str:
    # Preserve newlines; collapse consecutive spaces within each line
    return "\n".join(" ".join(line.split()) for line in (text_content or "").splitlines())

def _partition_text_into_chunks(raw_text: str, maximum_chunk_length: int = 1200) -> List[str]:
    # Paragraph-aware chunking preserving paragraph boundaries
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", raw_text) if paragraph.strip()]
    text_chunks, accumulator_buffer = [], ""
    for paragraph_text in paragraphs:
        if not accumulator_buffer:
            accumulator_buffer = paragraph_text
        elif len(accumulator_buffer) + 1 + len(paragraph_text) <= maximum_chunk_length:
            accumulator_buffer = accumulator_buffer + "\n" + paragraph_text
        else:
            text_chunks.append(accumulator_buffer)
            accumulator_buffer = paragraph_text
    if accumulator_buffer:
        text_chunks.append(accumulator_buffer)
    if not text_chunks and raw_text.strip():
        sanitized_text = raw_text.strip()
        for chunk_start_index in range(0, len(sanitized_text), maximum_chunk_length):
            text_chunks.append(sanitized_text[chunk_start_index:chunk_start_index+maximum_chunk_length])
    return text_chunks

PROBABLE_CONTENT_JSON_KEYS = {"content","body","markdown","mdx","html","text","children","value","description"}

def _recursively_extract_strings_from_json(json_object: Any, extracted_strings: List[str]) -> None:
    # Traverse JSON structure to collect substantial text content
    if isinstance(json_object, str):
        sanitized_string = json_object.strip()
        # Filter out tiny strings and JavaScript code fragments
        if len(sanitized_string) >= 80 and not sanitized_string.startswith("{") and not sanitized_string.startswith("["):
            extracted_strings.append(sanitized_string)
    elif isinstance(json_object, list):
        for list_item in json_object:
            _recursively_extract_strings_from_json(list_item, extracted_strings)
    elif isinstance(json_object, dict):
        for dict_key, dict_value in json_object.items():
            if isinstance(dict_value, (str, list, dict)) and (dict_key in PROBABLE_CONTENT_JSON_KEYS or True):
                _recursively_extract_strings_from_json(dict_value, extracted_strings)

def _extract_content_from_nextjs_data(html_parser: BeautifulSoup) -> List[str]:
    nextjs_data_script = html_parser.find("script", id="__NEXT_DATA__", type="application/json")
    if not nextjs_data_script or not nextjs_data_script.string:
        return []
    try:
        parsed_next_data = json.loads(nextjs_data_script.string)
    except Exception:
        return []
    extracted_text_buffer: List[str] = []
    _recursively_extract_strings_from_json(parsed_next_data, extracted_text_buffer)
    # Consolidate and clean extracted text; deduplicate common lines
    if not extracted_text_buffer:
        return []
    consolidated_text = "\n".join(extracted_text_buffer)
    # Remove excessive blank lines
    consolidated_text = re.sub(r"\n{3,}", "\n\n", consolidated_text)
    consolidated_text = _normalize_whitespace(consolidated_text)
    # Heuristic: retain only substantial text segments by paragraph splitting and filtering
    substantial_segments = [segment for segment in re.split(r"\n{2,}", consolidated_text) if len(segment) > 120]
    return substantial_segments

def _extract_content_from_plain_html(html_parser: BeautifulSoup) -> List[str]:
    content_root = html_parser.select_one("main") or html_parser.select_one("article") or html_parser.body or html_parser
    # Remove navigation and structural elements
    for structural_element_tag in ("nav","aside","footer","header"):
        for structural_element in content_root.select(structural_element_tag):
            structural_element.decompose()
    # Wrap code blocks with markdown fences
    for preformatted_block in content_root.select("pre"):
        preformatted_block.string = "\n```text\n" + preformatted_block.get_text() + "\n```\n"
    extracted_text = content_root.get_text("\n")
    extracted_text = _normalize_whitespace(extracted_text)
    if not extracted_text.strip():
        return []
    substantial_segments = [segment for segment in re.split(r"\n{2,}", extracted_text) if len(segment) > 80]
    return substantial_segments

def _extract_tutorial_content(tutorial_url: str) -> Dict:
    tutorial_html = _fetch_tutorial_page_content(tutorial_url)
    html_parser = BeautifulSoup(tutorial_html, "lxml")
    # Prioritize Next.js embedded JSON extraction
    content_segments = _extract_content_from_nextjs_data(html_parser)
    if not content_segments:
        # Fallback to traditional HTML text extraction
        content_segments = _extract_content_from_plain_html(html_parser)

    # Extract page title
    title_heading = html_parser.find("h1")
    page_title = _normalize_whitespace(title_heading.get_text()) if title_heading and title_heading.get_text(strip=True) else tutorial_url.rstrip("/").split("/")[-1]

    # Partition content into manageable chunks (~1200 characters each)
    consolidated_content_text = "\n\n".join(content_segments)
    partitioned_chunks = _partition_text_into_chunks(consolidated_content_text, 1200)
    return {"title": page_title, "url": tutorial_url, "chunks": partitioned_chunks}

def crawl_learning_portal_tutorials(tutorial_urls: List[str], enable_verbose_logging: bool = False) -> List[Dict]:
    crawled_tutorials: List[Dict] = []
    for tutorial_url in tutorial_urls:
        try:
            extracted_tutorial_data = _extract_tutorial_content(tutorial_url)
            if enable_verbose_logging:
                print(f"[SUCCESS] {tutorial_url} → {len(extracted_tutorial_data.get("chunks") or [])} content chunks")
            crawled_tutorials.append(extracted_tutorial_data)
        except Exception:
            if enable_verbose_logging:
                print(f"[ERROR] {tutorial_url}")
                traceback.print_exc()
    return crawled_tutorials
