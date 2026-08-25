"""
Terraform Registry Module Crawler
Crawls popular Terraform modules for best practices and reusable patterns.
"""
import os, re, time, json
from typing import List, Dict, Any, Optional
import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

TERRAFORM_REGISTRY_BASE_URL = "https://registry.terraform.io"
HTTP_USER_AGENT_HEADERS = {"User-Agent": "Driftbox-crawler/1.0 (+https://driftbox.com)"}

# Popular AWS modules that represent best practices
POPULAR_AWS_MODULES = [
    "terraform-aws-modules/vpc/aws",
    "terraform-aws-modules/eks/aws",
    "terraform-aws-modules/rds/aws",
    "terraform-aws-modules/s3-bucket/aws",
    "terraform-aws-modules/security-group/aws",
    "terraform-aws-modules/alb/aws",
    "terraform-aws-modules/autoscaling/aws",
    "terraform-aws-modules/iam/aws",
    "terraform-aws-modules/lambda/aws",
    "terraform-aws-modules/acm/aws",
    "terraform-aws-modules/cloudfront/aws",
    "terraform-aws-modules/ec2-instance/aws",
    "terraform-aws-modules/rds-aurora/aws",
    "terraform-aws-modules/ecs/aws",
    "terraform-aws-modules/elb/aws",
    "terraform-aws-modules/kms/aws",
    "terraform-aws-modules/route53/aws",
    "terraform-aws-modules/dynamodb-table/aws",
    "terraform-aws-modules/apigateway-v2/aws",
    "terraform-aws-modules/cloudwatch/aws",
]

def _fetch_page_content(page_url: str) -> Optional[str]:
    """Fetch HTML content from a URL with error handling"""
    try:
        http_response = requests.get(page_url, headers=HTTP_USER_AGENT_HEADERS, timeout=20)
        if http_response.status_code == 200:
            return http_response.text
        return None
    except Exception:
        return None

def _parse_module_page(page_html: str, module_url: str, module_name: str) -> Dict[str, Any]:
    """
    Parse a Terraform module page to extract:
    - Module description
    - Input variables
    - Output values
    - Usage examples
    - README content
    """
    html_parser = BeautifulSoup(page_html, "html.parser")
    
    # Extract module title/name
    h1_element = html_parser.find("h1")
    title = h1_element.get_text(strip=True) if h1_element else module_name
    
    # Extract description (usually in a <p> tag near the top)
    description = ""
    desc_element = html_parser.find("p", class_=re.compile(".*description.*", re.I))
    if not desc_element:
        # Try finding the first paragraph after h1
        if h1_element:
            desc_element = h1_element.find_next("p")
    if desc_element:
        description = desc_element.get_text(strip=True)
    
    # Extract input variables (usually in a table or list)
    inputs: List[Dict[str, str]] = []
    
    # Look for "Inputs" section
    inputs_header = html_parser.find(lambda tag: tag.name in ["h2", "h3", "h4"] and "input" in tag.get_text(strip=True).lower())
    if inputs_header:
        # Find table after inputs header
        table = inputs_header.find_next("table")
        if table:
            rows = table.find_all("tr")[1:]  # Skip header row
            for row in rows[:50]:  # Limit to 50 inputs
                cells = row.find_all(["td", "th"])
                if len(cells) >= 2:
                    input_name = cells[0].get_text(strip=True)
                    input_desc = cells[1].get_text(strip=True) if len(cells) > 1 else ""
                    inputs.append({"name": input_name, "description": input_desc})
    
    # Extract output values
    outputs: List[Dict[str, str]] = []
    outputs_header = html_parser.find(lambda tag: tag.name in ["h2", "h3", "h4"] and "output" in tag.get_text(strip=True).lower())
    if outputs_header:
        table = outputs_header.find_next("table")
        if table:
            rows = table.find_all("tr")[1:]
            for row in rows[:50]:
                cells = row.find_all(["td", "th"])
                if len(cells) >= 1:
                    output_name = cells[0].get_text(strip=True)
                    output_desc = cells[1].get_text(strip=True) if len(cells) > 1 else ""
                    outputs.append({"name": output_name, "description": output_desc})
    
    # Extract code examples from <pre><code> blocks
    code_examples: List[str] = []
    for pre_code_block in html_parser.select("pre code"):
        extracted_code = pre_code_block.get_text()
        # Filter for HCL/Terraform code (contains "module", "resource", or "data")
        if extracted_code and len(extracted_code) > 50 and any(keyword in extracted_code.lower() for keyword in ["module", "source", "version"]):
            code_examples.append(extracted_code[:8000])  # Limit to 8000 chars
    
    return {
        "type": "module",
        "name": module_name,
        "title": title,
        "url": module_url,
        "description": description,
        "inputs": inputs[:50],  # Limit to 50
        "outputs": outputs[:50],  # Limit to 50
        "examples": code_examples[:5],  # Limit to 5 examples
    }

def crawl_terraform_modules(module_list: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """
    Crawl Terraform module documentation pages.
    
    Args:
        module_list: List of module identifiers (e.g., ["terraform-aws-modules/vpc/aws"])
                    If None, uses POPULAR_AWS_MODULES
    
    Returns:
        List of parsed module documentation records
    """
    modules_to_crawl = module_list if module_list is not None else POPULAR_AWS_MODULES
    
    parsed_module_results: List[Dict[str, Any]] = []
    
    for module_name in tqdm(modules_to_crawl, desc="Crawling Terraform modules"):
        # Construct URL: https://registry.terraform.io/modules/{namespace}/{name}/{provider}/latest
        module_url = f"{TERRAFORM_REGISTRY_BASE_URL}/modules/{module_name}/latest"
        
        module_html = _fetch_page_content(module_url)
        if not module_html:
            print(f"⚠️ Failed to fetch {module_name}")
            continue
        
        try:
            parsed_module = _parse_module_page(module_html, module_url, module_name)
            parsed_module_results.append(parsed_module)
        except Exception as e:
            print(f"⚠️ Failed to parse {module_name}: {e}")
            continue
        
        time.sleep(0.3)  # Rate limiting
    
    print(f"✅ Successfully fetched {len(parsed_module_results)} Terraform module pages")
    return parsed_module_results

if __name__ == "__main__":
    # Test the crawler
    print("Testing module crawler...")
    results = crawl_terraform_modules(POPULAR_AWS_MODULES[:3])  # Test with 3 modules
    
    for module in results:
        print(f"\nModule: {module['name']}")
        print(f"  Inputs: {len(module['inputs'])}")
        print(f"  Outputs: {len(module['outputs'])}")
        print(f"  Examples: {len(module['examples'])}")

