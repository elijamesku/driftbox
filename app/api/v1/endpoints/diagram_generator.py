from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from app.database.models import UserAccount
from app.services.auth import authentication_service
from app.api.v1.endpoints.github_parser import parse_github_repo
from app.utils.errors import sanitize_error_detail
from app.config import CLAUDE_MODEL_NAME
import anthropic
import os
import json

router = APIRouter()

@router.get("/generate/{owner}/{repo}")
async def generate_architecture_diagram(
    owner: str,
    repo: str,
    branch: str = "main",
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Generate a cloud architecture diagram from Terraform code (supports AWS and DigitalOcean).
    
    This endpoint:
    1. Queries the infrastructure index for resources (or parses if not indexed)
    2. Extracts resources and their relationships
    3. Generates diagram nodes and edges
    4. Uses AI to create architecture explanation
    """
    try:
        # Try to get resources from index first, fallback to parsing
        from app.services.infrastructure_query_service import infrastructure_query_service
        from app.services.codebase_indexing_service import codebase_indexing_service
        
        index_status = codebase_indexing_service.get_index_status(current_user.id, owner, repo)
        resources = []
        parsed_data = None
        
        if index_status.get("exists"):
            resources = infrastructure_query_service.get_all_resources(
                user_id=current_user.id,
                owner=owner,
                repo=repo,
                fallback_to_parse=False
            )
        
        # If no resources from index, parse (backward compatibility)
        if not resources:
            from app.api.v1.endpoints.github_parser import GitHubRepoRequest
            req = GitHubRepoRequest(owner=owner, repo=repo, branch=branch)
            parsed_data = await parse_github_repo(req, current_user)
            
            if not parsed_data.get("resources"):
                raise HTTPException(
                    status_code=404,
                    detail="No Terraform resources found in repository"
                )
            
            resources = parsed_data["resources"]
            # Store in index for future use (non-blocking)
            if resources:
                try:
                    from app.services.infrastructure_indexing_service import infrastructure_indexing_service
                    infrastructure_indexing_service.store_resources(
                        user_id=current_user.id,
                        owner=owner,
                        repo=repo,
                        resources=resources,
                        commit_sha=parsed_data.get("sha")
                    )
                except Exception as e:
                    print(f"⚠️ [Diagram] Failed to store resources in index (non-fatal): {e}")
        
        # Get relationships from index
        relationships = infrastructure_query_service.get_resource_relationships(
            user_id=current_user.id,
            owner=owner,
            repo=repo
        )
        
        # Modules not currently stored in index
        modules = parsed_data.get("modules", []) if parsed_data else []
        
        # Generate diagram nodes and edges
        nodes = []
        edges = []
        resource_map = {}
        
        # AWS Resource Categories
        AWS_CATEGORIES = {
            "aws_s3_bucket": "Storage",
            "aws_dynamodb_table": "Database",
            "aws_rds_instance": "Database",
            "aws_rds_cluster": "Database",
            "aws_lambda_function": "Compute",
            "aws_ec2_instance": "Compute",
            "aws_ecs_cluster": "Compute",
            "aws_ecs_service": "Compute",
            "aws_vpc": "Networking",
            "aws_subnet": "Networking",
            "aws_security_group": "Networking",
            "aws_route_table": "Networking",
            "aws_internet_gateway": "Networking",
            "aws_nat_gateway": "Networking",
            "aws_alb": "Networking",
            "aws_api_gateway_rest_api": "API",
            "aws_cloudfront_distribution": "Content Delivery",
            "aws_iam_role": "IAM",
            "aws_iam_policy": "IAM",
            "aws_sns_topic": "Messaging",
            "aws_sqs_queue": "Messaging",
            "aws_cloudwatch_log_group": "Monitoring",
        }
        
        # DigitalOcean Resource Categories
        DO_CATEGORIES = {
            "digitalocean_droplet": "Compute",
            "digitalocean_kubernetes_cluster": "Compute",
            "digitalocean_kubernetes_node_pool": "Compute",
            "digitalocean_app": "Compute",
            "digitalocean_spaces_bucket": "Storage",
            "digitalocean_volume": "Storage",
            "digitalocean_database_cluster": "Database",
            "digitalocean_database_db": "Database",
            "digitalocean_database_replica": "Database",
            "digitalocean_vpc": "Networking",
            "digitalocean_firewall": "Networking",
            "digitalocean_loadbalancer": "Networking",
            "digitalocean_floating_ip": "Networking",
            "digitalocean_reserved_ip": "Networking",
            "digitalocean_domain": "DNS",
            "digitalocean_record": "DNS",
            "digitalocean_certificate": "Security",
            "digitalocean_container_registry": "Container",
            "digitalocean_monitor_alert": "Monitoring",
            "digitalocean_uptime_check": "Monitoring",
            "digitalocean_project": "Management",
            "digitalocean_ssh_key": "Security",
            "digitalocean_cdn": "Content Delivery",
            "digitalocean_function": "Compute",
        }
        
        # Combine categories
        RESOURCE_CATEGORIES = {**AWS_CATEGORIES, **DO_CATEGORIES}
        
        CATEGORY_ICONS = {
            "Storage": "🗄️",
            "Database": "🗃️",
            "Compute": "⚙️",
            "Networking": "🌐",
            "API": "🔌",
            "Content Delivery": "📡",
            "IAM": "🔐",
            "Messaging": "📨",
            "Monitoring": "📊",
            "DNS": "🌐",
            "Security": "🔒",
            "Container": "🐳",
            "Management": "📁",
            "Other": "📦"
        }
        
        # Detect cloud provider from resources
        aws_count = sum(1 for r in resources if r.get("type", "").startswith("aws_"))
        do_count = sum(1 for r in resources if r.get("type", "").startswith("digitalocean_"))
        cloud_provider = "DigitalOcean" if do_count > aws_count else "AWS" if aws_count > 0 else "Cloud"
        provider_prefix = "digitalocean_" if cloud_provider == "DigitalOcean" else "aws_"
        
        # Process each resource
        for resource in resources:
            resource_type = resource.get("type", "")
            resource_name = resource.get("name", "")
            tf_name = resource.get("tf_name", "") or resource.get("name", "")
            file_path = resource.get("file", "")
            line = resource.get("line")
            attrs = resource.get("attrs", {})  # Get resource attributes
            
            category = RESOURCE_CATEGORIES.get(resource_type, "Other")
            icon = CATEGORY_ICONS.get(category, "📦")
            
            node_id = f"{resource_type}.{tf_name}"
            resource_map[node_id] = {
                "type": resource_type,
                "name": resource_name,
                "tf_name": tf_name,
                "attrs": attrs  # Store attributes for relationship detection
            }
            
            nodes.append({
                "id": node_id,
                "type": resource_type,
                "label": resource_name or tf_name,
                "icon": icon,
                "file": file_path,
                "line": line,
                "category": category
            })
        
        # Helper function to resolve Terraform references
        def resolve_reference(ref_value: Any) -> Optional[str]:
            """Extract resource reference from Terraform attribute value (AWS or DigitalOcean)"""
            if isinstance(ref_value, str):
                import re
                # Match AWS patterns like aws_vpc.main.id or aws_vpc.main
                match = re.search(r'(aws_\w+)\.(\w+)(?:\.\w+)?', ref_value)
                if match:
                    ref_type = match.group(1)
                    ref_name = match.group(2)
                    for node_id, res_data in resource_map.items():
                        if res_data["type"] == ref_type and res_data["tf_name"] == ref_name:
                            return node_id
                # Match DigitalOcean patterns like digitalocean_vpc.main.id
                match = re.search(r'(digitalocean_\w+)\.(\w+)(?:\.\w+)?', ref_value)
                if match:
                    ref_type = match.group(1)
                    ref_name = match.group(2)
                    for node_id, res_data in resource_map.items():
                        if res_data["type"] == ref_type and res_data["tf_name"] == ref_name:
                            return node_id
            return None
        
        # Detect relationships based on naming patterns and cloud conventions
        # This creates a more comprehensive diagram even when Terraform references aren't explicit
        
        # Build resource type indexes for faster lookup (supports both AWS and DigitalOcean)
        vpcs = [node_id for node_id, data in resource_map.items() if data["type"] in ["aws_vpc", "digitalocean_vpc"]]
        subnets = [node_id for node_id, data in resource_map.items() if data["type"] == "aws_subnet"]
        storage = [node_id for node_id, data in resource_map.items() if data["type"] in ["aws_s3_bucket", "digitalocean_spaces_bucket", "digitalocean_volume"]]
        s3_buckets = [node_id for node_id, data in resource_map.items() if data["type"] in ["aws_s3_bucket", "digitalocean_spaces_bucket"]]
        compute = [node_id for node_id, data in resource_map.items() if data["type"] in ["aws_lambda_function", "digitalocean_droplet", "digitalocean_app", "aws_instance"]]
        lambdas = [node_id for node_id, data in resource_map.items() if data["type"] in ["aws_lambda_function", "digitalocean_function"]]
        apis = [node_id for node_id, data in resource_map.items() if data["type"] in ["aws_api_gateway_rest_api", "aws_apigatewayv2_api"]]
        databases = [node_id for node_id, data in resource_map.items() if data["type"] in ["aws_dynamodb_table", "aws_rds_instance", "aws_rds_cluster", "digitalocean_database_cluster"]]
        iam_roles = [node_id for node_id, data in resource_map.items() if data["type"] == "aws_iam_role"]
        security_groups = [node_id for node_id, data in resource_map.items() if data["type"] in ["aws_security_group", "digitalocean_firewall"]]
        load_balancers = [node_id for node_id, data in resource_map.items() if data["type"] in ["aws_lb", "aws_alb", "digitalocean_loadbalancer"]]
        kubernetes = [node_id for node_id, data in resource_map.items() if data["type"] in ["aws_eks_cluster", "digitalocean_kubernetes_cluster"]]
        
        # Helper to check if two resource names are related (naming convention)
        def names_related(name1: str, name2: str) -> bool:
            """Check if resource names suggest they're related"""
            # Remove common prefixes/suffixes
            n1 = name1.lower().replace("_", "").replace("-", "")
            n2 = name2.lower().replace("_", "").replace("-", "")
            
            # Check for common substrings
            if len(n1) > 3 and len(n2) > 3:
                # Check if one contains the other
                if n1 in n2 or n2 in n1:
                    return True
                # Check for common words
                words1 = set(name1.lower().split("_") + name1.lower().split("-"))
                words2 = set(name2.lower().split("_") + name2.lower().split("-"))
                common = words1.intersection(words2)
                if common and any(len(w) > 3 for w in common):
                    return True
            return False
        
        # 1. VPC → Subnet relationships (if VPC exists, ALL subnets likely belong to it)
        if len(vpcs) > 0:
            vpc_id = vpcs[0]  # Use first VPC as default
            for subnet_id in subnets:
                edges.append({
                    "source": vpc_id,
                    "target": subnet_id,
                    "relationship": "contains"
                })
        
        # 2. Security Groups → VPC (security groups belong to VPCs)
        if len(vpcs) > 0:
            vpc_id = vpcs[0]
            for sg_id in security_groups:
                edges.append({
                    "source": vpc_id,
                    "target": sg_id,
                    "relationship": "contains"
                })
        
        # 3. Subnet → Compute/Database relationships (distribute resources across subnets)
        compute_resources = [node_id for node_id, data in resource_map.items() 
                           if data["type"] in ["aws_ec2_instance", "aws_ecs_service"]]
        
        if subnets and (compute_resources or databases or lambdas):
            # Distribute resources across subnets
            all_hosted = compute_resources + databases + lambdas
            for idx, resource_id in enumerate(all_hosted):
                subnet_id = subnets[idx % len(subnets)]  # Round-robin distribution
                edges.append({
                    "source": subnet_id,
                    "target": resource_id,
                    "relationship": "hosts"
                })
        
        # 4. API Gateway → Lambda relationships (APIs invoke Lambdas)
        if apis and lambdas:
            # Match APIs with Lambdas by naming or just connect first API to lambdas
            for api_id in apis:
                api_name = resource_map[api_id]["tf_name"]
                # Find related lambdas
                connected = False
                for lambda_id in lambdas:
                    lambda_name = resource_map[lambda_id]["tf_name"]
                    if names_related(api_name, lambda_name):
                        edges.append({
                            "source": api_id,
                            "target": lambda_id,
                            "relationship": "invokes"
                        })
                        connected = True
                # If no naming match, connect to first lambda
                if not connected and lambdas:
                    edges.append({
                        "source": api_id,
                        "target": lambdas[0],
                        "relationship": "invokes"
                    })
        
        # 5. Lambda → S3 relationships (Lambdas typically access S3)
        for lambda_id in lambdas:
            lambda_name = resource_map[lambda_id]["tf_name"]
            # Find related S3 buckets
            for s3_id in s3_buckets:
                s3_name = resource_map[s3_id]["tf_name"]
                if names_related(lambda_name, s3_name) or "s3" in lambda_name.lower():
                    edges.append({
                        "source": lambda_id,
                        "target": s3_id,
                        "relationship": "accesses"
                    })
                    break  # Only connect to one S3 bucket
        
        # 6. Lambda → Database relationships (Lambdas access databases)
        for lambda_id in lambdas:
            lambda_name = resource_map[lambda_id]["tf_name"]
            for db_id in databases:
                db_name = resource_map[db_id]["tf_name"]
                if names_related(lambda_name, db_name) or "db" in lambda_name.lower() or "data" in lambda_name.lower():
                    edges.append({
                        "source": lambda_id,
                        "target": db_id,
                        "relationship": "accesses"
                    })
                    break
        
        # 7. Lambda → IAM Role relationships (Lambdas use IAM roles)
        for lambda_id in lambdas:
            lambda_name = resource_map[lambda_id]["tf_name"]
            # Find related IAM role
            for role_id in iam_roles:
                role_name = resource_map[role_id]["tf_name"]
                if names_related(lambda_name, role_name) or "lambda" in role_name.lower():
                    edges.append({
                        "source": lambda_id,
                        "target": role_id,
                        "relationship": "assumes"
                    })
                    break
        
        # 8. EC2 → Database relationships (EC2 queries databases)
        compute_instances = [node_id for node_id, data in resource_map.items() 
                           if data["type"] == "aws_ec2_instance"]
        for ec2_id in compute_instances:
            if databases:
                # Connect EC2 to first database
                edges.append({
                    "source": ec2_id,
                    "target": databases[0],
                    "relationship": "accesses"
                })
        
        # 9. Now also detect relationships from actual Terraform attributes (if available)
        for node_id, node_data in resource_map.items():
            resource_type = node_data["type"]
            attrs = node_data.get("attrs", {})
            
            # Try to extract explicit references from attributes
            if attrs:
                # VPC relationships from explicit vpc_id
                if resource_type == "aws_subnet":
                    vpc_id_ref = attrs.get("vpc_id") or attrs.get("vpc")
                    if vpc_id_ref:
                        target_vpc = resolve_reference(vpc_id_ref)
                        if target_vpc:
                            # Check if edge already exists
                            if not any(e["source"] == target_vpc and e["target"] == node_id for e in edges):
                                edges.append({
                                    "source": target_vpc,
                                    "target": node_id,
                                    "relationship": "contains"
                                })
                
                # Lambda explicit environment variable references
                if resource_type == "aws_lambda_function":
                    env_vars = attrs.get("environment", {}) or {}
                    if isinstance(env_vars, dict):
                        env_vars_dict = env_vars.get("variables", {}) if isinstance(env_vars.get("variables"), dict) else env_vars
                        for var_value in env_vars_dict.values():
                            if isinstance(var_value, str):
                                ref = resolve_reference(var_value)
                                if ref and ref != node_id:
                                    # Check if edge already exists
                                    if not any(e["source"] == node_id and e["target"] == ref for e in edges):
                                        edges.append({
                                            "source": node_id,
                                            "target": ref,
                                            "relationship": "accesses"
                                        })
        
        # OPTIMIZATION: Run Claude calls in parallel for 2x speed improvement
        import asyncio
        
        # Start both AI operations in parallel
        claude_task = asyncio.create_task(generate_diagram_with_claude(nodes, edges, resource_map))
        explanation_task = asyncio.create_task(generate_architecture_explanation(nodes, edges, f"{owner}/{repo}"))
        
        # Wait for both to complete
        claude_enhanced, explanation = await asyncio.gather(claude_task, explanation_task)
        
        # Merge Claude's suggestions with parsed relationships
        enhanced_edges = merge_claude_suggestions(edges, claude_enhanced.get('suggested_connections', []), nodes)
        
        return {
            "ok": True,
            "repo": f"{owner}/{repo}",
            "branch": branch,
            "nodes": nodes,
            "edges": enhanced_edges,
            "explanation": explanation
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"❌ [Diagram] Error generating diagram: {e}")
        print(f"❌ [Diagram] Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500,
            detail=sanitize_error_detail(e, "Failed to generate diagram")
        )


async def generate_diagram_with_claude(nodes: List[Dict], edges: List[Dict], resource_map: Dict) -> Dict:
    """
    Use Claude to analyze infrastructure and generate diagram structure with relationships.
    Claude understands AWS patterns and can suggest connections we might miss.
    """
    try:
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        
        # Build comprehensive resource summary
        resources_summary = []
        for node in nodes:
            resources_summary.append({
                "id": node["id"],
                "type": node["type"],
                "label": node["label"],
                "category": node.get("category", "Other")
            })
        
        existing_connections = []
        for edge in edges:
            existing_connections.append({
                "from": edge['source'],
                "to": edge['target'],
                "relationship": edge.get('relationship', 'unknown')
            })
        
        prompt = f"""You are a {cloud_provider} architecture expert. Analyze this Terraform infrastructure and generate a comprehensive diagram structure.

Resources Found:
{json.dumps(resources_summary, indent=2)}

Existing Connections (from Terraform):
{json.dumps(existing_connections[:30], indent=2)}

Your task:
1. Analyze the infrastructure and identify logical connections that should be shown in a {cloud_provider} architecture diagram
2. Suggest missing relationships based on {cloud_provider} patterns and resource naming conventions
3. Identify data flows (e.g., compute → storage, API → compute, compute → database)
4. Identify security relationships (firewalls/security groups protecting resources)
5. Identify network relationships (resources in the same VPC)

Based on {cloud_provider} best practices, suggest additional connections. For example:
- If there's compute and storage with related names, they're likely connected
- If there's a load balancer and compute resources, they're connected
- Compute instances typically connect to databases in the same VPC
- Firewalls/security groups protect resources they're associated with

Return ONLY valid JSON in this exact format:
{{
  "suggested_connections": [
    {{
      "source": "aws_lambda_function.process_data",
      "target": "aws_s3_bucket.data_bucket",
      "relationship": "accesses",
      "confidence": "high",
      "reason": "Lambda function processes data from S3 bucket based on naming"
    }},
    {{
      "source": "aws_api_gateway_rest_api.api",
      "target": "aws_lambda_function.handler",
      "relationship": "invokes",
      "confidence": "high",
      "reason": "API Gateway typically invokes Lambda functions"
    }}
  ],
  "data_flows": [
    {{
      "from": "aws_ec2_instance.app_server",
      "to": "aws_rds_instance.database",
      "type": "queries",
      "confidence": "medium"
    }}
  ],
  "notes": "Brief analysis of the architecture pattern"
}}

Only suggest connections with medium or high confidence. Don't invent connections.
If no additional connections are needed, return empty arrays.
"""
        
        message = client.messages.create(
            model=CLAUDE_MODEL_NAME,
            max_tokens=4096,
            messages=[
                {"role": "user", "content": prompt}
            ],
            temperature=0.3  # Lower temperature for more consistent results
        )
        
        response_text = message.content[0].text.strip()
        
        # Remove markdown code fences if present
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            # Remove first line (```json) and last line (```)
            response_text = "\n".join(lines[1:-1]) if len(lines) > 2 else response_text
            response_text = response_text.strip()
            # Remove json language identifier
            if response_text.startswith("json"):
                response_text = response_text[4:].strip()
        
        # Parse Claude's response
        claude_result = json.loads(response_text)
        
        return claude_result
        
    except json.JSONDecodeError as e:
        print(f"Failed to parse Claude diagram response: {e}")
        print(f"Response preview: {response_text[:500]}")
        return {"suggested_connections": [], "data_flows": [], "notes": ""}
    except Exception as e:
        print(f"Claude diagram generation failed: {e}")
        return {"suggested_connections": [], "data_flows": [], "notes": ""}


def merge_claude_suggestions(existing_edges: List[Dict], claude_suggestions: List[Dict], nodes: List[Dict]) -> List[Dict]:
    """
    Merge Claude's suggested connections with existing edges, avoiding duplicates.
    """
    # Build set of existing connections
    existing_edge_keys = set()
    for edge in existing_edges:
        existing_edge_keys.add((edge['source'], edge['target']))
    
    # Create node ID lookup
    node_ids = {node['id'] for node in nodes}
    
    # Add Claude suggestions that don't already exist and have valid nodes
    enhanced_edges = existing_edges.copy()
    
    for suggestion in claude_suggestions:
        source = suggestion.get('source')
        target = suggestion.get('target')
        relationship = suggestion.get('relationship', 'connects')
        confidence = suggestion.get('confidence', 'low')
        
        # Only add high/medium confidence suggestions
        if confidence not in ['high', 'medium']:
            continue
        
        # Check if connection already exists
        if (source, target) in existing_edge_keys:
            continue
        
        # Verify both nodes exist
        if source in node_ids and target in node_ids:
            enhanced_edges.append({
                "source": source,
                "target": target,
                "relationship": relationship
            })
            existing_edge_keys.add((source, target))
    
    return enhanced_edges


async def enhance_diagram_with_claude(nodes: List[Dict], edges: List[Dict], resource_map: Dict) -> List[Dict]:
    """
    Use Claude to analyze infrastructure and suggest missing connections based on cloud best practices.
    """
    try:
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        
        # Build a summary of resources and existing connections
        resources_summary = {}
        for node in nodes:
            resource_type = node["type"]
            if resource_type not in resources_summary:
                resources_summary[resource_type] = []
            resources_summary[resource_type].append(node["label"])
        
        existing_connections = []
        for edge in edges:
            existing_connections.append(f"{edge['source']} -> {edge['target']} ({edge.get('relationship', 'unknown')})")
        
        # Detect cloud provider from resources
        aws_count = sum(1 for t in resources_summary.keys() if t.startswith("aws_"))
        do_count = sum(1 for t in resources_summary.keys() if t.startswith("digitalocean_"))
        cloud_provider = "DigitalOcean" if do_count > aws_count else "AWS" if aws_count > 0 else "Cloud"
        
        prompt = f"""You are a {cloud_provider} architecture expert. Analyze this Terraform infrastructure and suggest missing connections that should be shown in a {cloud_provider} architecture diagram.

Resources:
{json.dumps(resources_summary, indent=2)}

Existing Connections:
{chr(10).join(existing_connections[:20])}  # Limit to first 20 for brevity

Based on {cloud_provider} best practices and common patterns, suggest additional connections that should be shown. For example:
- If there's compute and storage with related names, they might be connected
- If there's a load balancer and compute, they should be connected
- If there's compute and a database, they likely connect
- Firewalls/security groups should be associated with resources they protect
- VPCs should be associated with resources that use them

Return ONLY a JSON array of suggested connections in this format:
[
  {{"source": "resource_type.my_resource", "target": "resource_type.other_resource", "relationship": "accesses", "reason": "Compute reads/writes to storage"}},
  {{"source": "resource_type.load_balancer", "target": "resource_type.compute", "relationship": "routes", "reason": "Load balancer routes to compute"}}
]

Only suggest connections that are likely based on resource names, types, and {cloud_provider} patterns. Don't invent connections that don't make sense.
Return an empty array [] if no additional connections are needed.
"""
        
        message = client.messages.create(
            model=CLAUDE_MODEL_NAME,
            max_tokens=2048,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )
        
        response_text = message.content[0].text.strip()
        
        # Remove markdown code fences if present
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            response_text = "\n".join(lines[1:-1]) if len(lines) > 2 else response_text
            response_text = response_text.strip()
            # Remove json language identifier
            if response_text.startswith("json"):
                response_text = response_text[4:].strip()
        
        # Parse suggested connections
        suggested_connections = json.loads(response_text)
        
        # Add suggested connections that don't already exist
        existing_edge_keys = set()
        for edge in edges:
            existing_edge_keys.add((edge['source'], edge['target']))
        
        enhanced_edges = edges.copy()
        for suggestion in suggested_connections:
            source = suggestion.get('source')
            target = suggestion.get('target')
            relationship = suggestion.get('relationship', 'connects')
            
            # Check if connection already exists
            if (source, target) not in existing_edge_keys:
                # Verify both nodes exist
                source_exists = any(node['id'] == source for node in nodes)
                target_exists = any(node['id'] == target for node in nodes)
                
                if source_exists and target_exists:
                    enhanced_edges.append({
                        "source": source,
                        "target": target,
                        "relationship": relationship
                    })
                    existing_edge_keys.add((source, target))
        
        return enhanced_edges
        
    except Exception as e:
        # If Claude fails, return original edges
        print(f"Claude diagram enhancement failed: {e}")
        return edges


async def generate_architecture_explanation(nodes: List[Dict], edges: List[Dict], repo: str) -> str:
    """
    Use Claude to generate a detailed architecture explanation.
    """
    try:
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        
        # Detect cloud provider from nodes
        aws_count = sum(1 for n in nodes if n.get("type", "").startswith("aws_"))
        do_count = sum(1 for n in nodes if n.get("type", "").startswith("digitalocean_"))
        cloud_provider = "DigitalOcean" if do_count > aws_count else "AWS" if aws_count > 0 else "Cloud"
        
        # Prepare context
        resources_summary = {}
        for node in nodes:
            category = node["category"]
            resources_summary[category] = resources_summary.get(category, 0) + 1
        
        prompt = f"""Analyze this {cloud_provider} architecture for repository {repo}:

Resources:
{resources_summary}

Total Resources: {len(nodes)}
Connections: {len(edges)}

Provide a deep, professional architecture explanation covering:
1. Overall architecture pattern (e.g., serverless, microservices, monolithic)
2. Key components and their roles
3. Data flow and interactions
4. Security considerations
5. Scalability and high availability
6. Best practices observed or missing

Keep it concise but comprehensive (4-6 paragraphs).

IMPORTANT: 
- Do NOT use markdown headers (## or #)
- Do NOT use horizontal rules (***)
- Bold formatting (**text**) is allowed for emphasis
- Write in clean paragraphs only"""
        
        message = client.messages.create(
            model=CLAUDE_MODEL_NAME,
            max_tokens=1024,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )
        
        return message.content[0].text
        
    except Exception as e:
        # Fallback explanation if AI fails
        return f"""This repository contains {len(nodes)} cloud resources across {len(resources_summary)} categories. 

The architecture includes: {', '.join([f"{v} {k} resource(s)" for k, v in resources_summary.items()])}.

The resources are interconnected through {len(edges)} relationships, forming a cohesive cloud infrastructure. This Terraform configuration defines the infrastructure as code for deploying and managing these cloud resources."""

