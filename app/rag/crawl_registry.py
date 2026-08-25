import os, re, time, json
from typing import List, Dict, Any, Optional
import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

TERRAFORM_REGISTRY_BASE_URL = "https://registry.terraform.io"
AWS_RESOURCES_LIST_ENDPOINT = f"{TERRAFORM_REGISTRY_BASE_URL}/providers/hashicorp/aws/latest/docs/resources"
AWS_DATA_SOURCES_LIST_ENDPOINT = f"{TERRAFORM_REGISTRY_BASE_URL}/providers/hashicorp/aws/latest/docs/data-sources"

HTTP_USER_AGENT_HEADERS = {"User-Agent": "Driftbox-crawler/1.0 (+https://driftbox.com)"}

def _fetch_page_content(page_url: str) -> Optional[str]:
    try:
        http_response = requests.get(page_url, headers=HTTP_USER_AGENT_HEADERS, timeout=20)
        if http_response.status_code == 200:
            return http_response.text
        return None
    except Exception:
        return None

def _convert_to_absolute_url(relative_href: str) -> str:
    if relative_href.startswith("http"):
        return relative_href
    if relative_href.startswith("/"):
        return TERRAFORM_REGISTRY_BASE_URL + relative_href
    return relative_href

def _extract_aws_resource_documentation_links(registry_list_html: str) -> List[str]:
    html_parser = BeautifulSoup(registry_list_html, "html.parser")

    # Primary extraction: CSS selector with quoted attribute value
    resource_links = [anchor_tag.get("href","") for anchor_tag in html_parser.select("a[href^=\"/providers/hashicorp/aws/latest/docs/resources/\"]")]

    # Fallback extraction: manual filtering if CSS selector differs
    if not resource_links:
        for anchor_tag in html_parser.find_all("a", href=True):
            anchor_href = anchor_tag["href"]
            if anchor_href.startswith("/providers/hashicorp/aws/latest/docs/resources/"):
                resource_links.append(anchor_href)

    # Filter to leaf documentation pages only (exclude category pages), normalize and deduplicate
    resource_links = [_convert_to_absolute_url(href) for href in resource_links if href.count("/") >= 9]
    return sorted(set(resource_links))

def _extract_aws_data_source_documentation_links(registry_list_html: str) -> List[str]:
    html_parser = BeautifulSoup(registry_list_html, "html.parser")

    # Primary extraction: CSS selector with quoted attribute value
    data_source_links = [anchor_tag.get("href","") for anchor_tag in html_parser.select("a[href^=\"/providers/hashicorp/aws/latest/docs/data-sources/\"]")]

    # Fallback extraction: manual filtering if CSS selector differs
    if not data_source_links:
        for anchor_tag in html_parser.find_all("a", href=True):
            anchor_href = anchor_tag["href"]
            if anchor_href.startswith("/providers/hashicorp/aws/latest/docs/data-sources/"):
                data_source_links.append(anchor_href)

    # Filter to leaf documentation pages only (exclude category pages), normalize and deduplicate
    data_source_links = [_convert_to_absolute_url(href) for href in data_source_links if href.count("/") >= 9]
    return sorted(set(data_source_links))

def _parse_aws_resource_documentation_page(page_html: str, documentation_url: str) -> Dict[str, Any]:
    html_parser = BeautifulSoup(page_html, "html.parser")

    # Extract page title from <h1> element
    h1_element = html_parser.find("h1")
    page_title = (h1_element.get_text(strip=True) if h1_element else documentation_url.rstrip("/").split("/")[-1])

    # Extract Argument Reference section
    documented_arguments: List[Dict[str, str]] = []
    argument_section_header = html_parser.find(lambda tag: tag.name in ["h2","h3"] and "argument" in tag.get_text(strip=True).lower())
    if argument_section_header:
        # Collect following <li> items until next header encountered
        for sibling_element in argument_section_header.find_all_next():
            if sibling_element.name in ["h2","h3"]:
                break
            if sibling_element.name == "li":
                list_item_text = sibling_element.get_text(" ", strip=True)
                argument_pattern_match = re.match(r"^([a-zA-Z0-9_]+)\s*[-:]\s*(.*)$", list_item_text)
                if argument_pattern_match:
                    documented_arguments.append({"arg": argument_pattern_match.group(1), "desc": argument_pattern_match.group(2)})
                else:
                    documented_arguments.append({"arg": "", "desc": list_item_text})

    # Extract code examples from <pre><code> blocks
    code_examples: List[str] = []
    for pre_code_block in html_parser.select("pre code"):
        extracted_code = pre_code_block.get_text()
        if extracted_code and len(extracted_code) > 20:
            code_examples.append(extracted_code[:8000])  # Apply character limit

    return {
        "provider": "aws",
        "type": page_title.strip(),
        "url": documentation_url,
        "args": documented_arguments,
        "examples": code_examples[:8],
    }

def crawl_terraform_provider_resources(cloud_provider: str = "aws", maximum_pages: Optional[int] = None, include_data_sources: bool = True) -> List[Dict[str, Any]]:
    """
    Crawl Terraform provider documentation for resources and optionally data sources.
    
    Args:
        cloud_provider: Provider to crawl (only "aws" currently supported)
        maximum_pages: Max pages to crawl (None = unlimited, gets all resources)
        include_data_sources: Whether to also crawl data sources
    
    Returns:
        List of parsed documentation records
    """
    if cloud_provider != "aws":
        raise ValueError("Only AWS provider supported in current crawler implementation")

    # Crawl resources
    all_resource_documentation_links: List[str] = []
    page_number = 1
    
    # If maximum_pages is None, we'll keep going until we run out of pages
    while maximum_pages is None or page_number <= maximum_pages:
        paginated_list_url = AWS_RESOURCES_LIST_ENDPOINT + (f"?page={page_number}" if page_number > 1 else "")
        list_page_html = _fetch_page_content(paginated_list_url)
        if not list_page_html:
            break
        page_resource_links = _extract_aws_resource_documentation_links(list_page_html)
        if not page_resource_links:
            break
        all_resource_documentation_links.extend(page_resource_links)
        time.sleep(0.3)
        page_number += 1

    all_resource_documentation_links = sorted(set(all_resource_documentation_links))
    print(f"Found {len(all_resource_documentation_links)} unique AWS resource pages")

    # Crawl data sources if requested
    if include_data_sources:
        all_data_source_documentation_links: List[str] = []
        page_number = 1
        
        while maximum_pages is None or page_number <= maximum_pages:
            paginated_list_url = AWS_DATA_SOURCES_LIST_ENDPOINT + (f"?page={page_number}" if page_number > 1 else "")
            list_page_html = _fetch_page_content(paginated_list_url)
            if not list_page_html:
                break
            page_data_source_links = _extract_aws_data_source_documentation_links(list_page_html)
            if not page_data_source_links:
                break
            all_data_source_documentation_links.extend(page_data_source_links)
            time.sleep(0.3)
            page_number += 1
        
        all_data_source_documentation_links = sorted(set(all_data_source_documentation_links))
        print(f"Found {len(all_data_source_documentation_links)} unique AWS data source pages")
    else:
        all_data_source_documentation_links = []

    # Combine all documentation links
    all_documentation_links = all_resource_documentation_links + all_data_source_documentation_links
    
    # Parse all documentation pages
    parsed_documentation_results: List[Dict[str, Any]] = []
    for documentation_url in tqdm(all_documentation_links, desc="Crawling AWS documentation"):
        documentation_html = _fetch_page_content(documentation_url)
        if not documentation_html:
            continue
        try:
            parsed_documentation_results.append(_parse_aws_resource_documentation_page(documentation_html, documentation_url))
        except Exception:
            continue
        time.sleep(0.2)

    print(f"✅ Successfully fetched {len(parsed_documentation_results)} AWS documentation pages ({len(all_resource_documentation_links)} resources, {len(all_data_source_documentation_links)} data sources)")
    return parsed_documentation_results
