"""
Enhanced NLP processor supporting complex multi-resource infrastructure operations.
Capable of parsing compound prompts like: "Create VPC, update S3, delete Lambda" in single request.
"""
import json
import re
from app.services.dependency_rules import check_missing_dependencies, get_required_dependencies, get_dependency_explanation
from typing import Dict, Any, List, Optional
from app.config import AI_PROVIDER, CLAUDE_AGENT_MODEL, _anthropic_instance
from app.services.nlp_processor import generate_mock_ir, process_nl_to_ir_with_openai
from app.services.llm_failover import llm_failover_service
import asyncio


def get_aws_docs_link(resource_type: str) -> str:
    """Generate AWS documentation URL for a resource type."""
    # Map AWS resource types to their AWS documentation URLs
    aws_service_map = {
        "aws_vpc": "https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html",
        "aws_subnet": "https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html",
        "aws_security_group": "https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html",
        "aws_instance": "https://docs.aws.amazon.com/ec2/latest/userguide/Instances.html",
        "aws_lb": "https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html",
        "aws_alb": "https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html",
        "aws_db_instance": "https://docs.aws.amazon.com/rds/latest/userguide/Overview.DBInstance.html",
        "aws_db_subnet_group": "https://docs.aws.amazon.com/rds/latest/userguide/USER_VPC.WorkingWithRDSInstanceinaVPC.html",
        "aws_s3_bucket": "https://docs.aws.amazon.com/s3/latest/userguide/UsingBucket.html",
        "aws_iam_role": "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html",
        "aws_lambda_function": "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html",
        "aws_ecs_cluster": "https://docs.aws.amazon.com/ecs/latest/developerguide/clusters.html",
        "aws_ecs_service": "https://docs.aws.amazon.com/ecs/latest/developerguide/ecs_services.html",
        "aws_ecs_task_definition": "https://docs.aws.amazon.com/ecs/latest/developerguide/task_definitions.html",
        "aws_eks_cluster": "https://docs.aws.amazon.com/eks/latest/userguide/clusters.html",
        "aws_internet_gateway": "https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html",
        "aws_nat_gateway": "https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html",
        "aws_route_table": "https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html",
        "aws_eip": "https://docs.aws.amazon.com/vpc/latest/userguide/vpc-eips.html",
        "aws_autoscaling_group": "https://docs.aws.amazon.com/autoscaling/ec2/userguide/auto-scaling-groups.html",
        "aws_launch_template": "https://docs.aws.amazon.com/autoscaling/ec2/userguide/launch-templates.html",
        "aws_rds_cluster": "https://docs.aws.amazon.com/rds/latest/AuroraUserGuide/Aurora.Overview.html",
        "aws_elasticache_cluster": "https://docs.aws.amazon.com/elasticache/latest/redis-ug/WhatIs.html",
        "aws_api_gateway_rest_api": "https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html",
        "aws_dynamodb_table": "https://docs.aws.amazon.com/dynamodb/latest/developerguide/Introduction.html",
    }
    
    return aws_service_map.get(resource_type, f"https://docs.aws.amazon.com/")


def get_terraform_docs_link(resource_type: str) -> str:
    """Generate Terraform documentation URL for a resource type."""
    # All Terraform AWS provider resources follow this pattern
    return f"https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/{resource_type.replace('aws_', '')}"


def analyze_complex_infrastructure_prompt(user_prompt: str) -> Dict[str, Any]:
    """
    Parse complex multi-resource prompts into structured operations taxonomy.
    
    Example: "Create VPC, update S3 bucket, delete Lambda function"
    Returns: {"operations": [{"action": "create", "resource": "vpc", ...}, ...]}
    """
    normalized_prompt = user_prompt.lower()
    
    # Detect multiple distinct operations
    identified_operations = []
    
    # CREATE operation patterns
    create_operation_patterns = [
        r'create\s+(?:a\s+)?(?:new\s+)?(\w+)',
        r'add\s+(?:a\s+)?(?:new\s+)?(\w+)',
        r'provision\s+(?:a\s+)?(\w+)',
    ]
    
    # UPDATE operation patterns
    update_operation_patterns = [
        r'update\s+(?:the\s+)?(?:existing\s+)?(\w+)',
        r'modify\s+(?:the\s+)?(\w+)',
        r'enable\s+(\w+)\s+(?:on|for)',
        r'add\s+(\w+)\s+to\s+(?:the\s+)?(\w+)',
    ]
    
    # DELETE operation patterns
    delete_operation_patterns = [
        r'delete\s+(?:the\s+)?(\w+)',
        r'remove\s+(?:the\s+)?(\w+)',
        r'destroy\s+(?:the\s+)?(\w+)',
    ]
    
    # Detect target environment
    target_environment = "staging"
    if "production" in normalized_prompt or "prod" in normalized_prompt:
        target_environment = "production"
    elif "dev" in normalized_prompt or "development" in normalized_prompt:
        target_environment = "development"
    
    return {
        "prompt": user_prompt,
        "environment": target_environment,
        "complexity": "multi_resource" if any(connector in normalized_prompt for connector in ["also", "and", "then", "finally"]) else "single_resource",
        "requires_llm_parsing": True
    }


async def process_multi_resource_nl_to_ir_with_claude(user_prompt: str, existing_resources_context: str = "", cloud_provider: str = "aws"):
    """
    Convert complex natural language to multi-resource IR using LLM with automatic Claude -> OpenAI failover.
    
    Handles compound prompts like:
    "Create VPC with subnets, update S3 bucket versioning, delete Lambda function"
    
    Args:
        user_prompt: User's natural language request
        existing_resources_context: Context about existing resources
        cloud_provider: 'aws' or 'digitalocean'
    """
    print(f"☁️  [IR Processor] Using cloud provider: {cloud_provider}")
    
    # SPEED OPTIMIZATION: Analyze query complexity (not just word count!)
    normalized_prompt = user_prompt.lower()
    
    # Detect complexity indicators
    complexity_score = 0
    
    # HIGH COMPLEXITY: Production/complete systems
    if any(word in normalized_prompt for word in ['production', 'prod', 'complete', 'full', 'entire', 'whole']):
        complexity_score += 3
    
    # HIGH COMPLEXITY: Multi-tier architectures
    if any(word in normalized_prompt for word in ['app', 'application', 'infrastructure', 'system', 'architecture']):
        complexity_score += 2
    
    # MEDIUM COMPLEXITY: Multiple resources
    if any(word in normalized_prompt for word in [' and ', ' with ', ' including ', 'also', 'plus']):
        complexity_score += 1
    
    # MEDIUM COMPLEXITY: Specific services that imply multi-resource
    if any(word in normalized_prompt for word in ['eks', 'ecs', 'kubernetes', 'rds', 'database', 'load balancer', 'alb', 'elb', 'redshift', 'warehouse', 'data lake', 'datalake', 'analytics']):
        complexity_score += 2  # Increased from 1 to 2 for data services
    
    # LOW COMPLEXITY: Single simple resource
    if any(word in normalized_prompt for word in ['bucket', 'lambda', 'function', 'table', 'role', 'policy']):
        if complexity_score == 0:  # Only if no other complexity indicators
            complexity_score = -1
    
    # Map complexity to token limits and prompt style
    if complexity_score >= 4:
        # MASSIVE: Full production systems
        max_tokens = 12000  # Increased for very large responses
        use_minimal_prompt = False
        complexity_label = "massive"
        print(f"⚡ [Speed] MASSIVE request detected (score={complexity_score}) - using max_tokens={max_tokens}")
    elif complexity_score >= 3:
        # COMPLEX: Multi-resource with dependencies
        max_tokens = 8192  # Increased from 4096
        use_minimal_prompt = False
        complexity_label = "complex"
        print(f"⚡ [Speed] COMPLEX request detected (score={complexity_score}) - using max_tokens={max_tokens}")
    elif complexity_score >= 1:
        # MEDIUM: Multiple related resources
        max_tokens = 4096  # Increased from 2048
        use_minimal_prompt = False
        complexity_label = "medium"
        print(f"⚡ [Speed] MEDIUM request detected (score={complexity_score}) - using max_tokens={max_tokens}")
    else:
        # SIMPLE: Single resource
        max_tokens = 2048  # Increased from 1024
        use_minimal_prompt = True
        complexity_label = "simple"
        print(f"⚡ [Speed] SIMPLE request detected (score={complexity_score}) - using max_tokens={max_tokens}, minimal_prompt=True")
    
    print(f"🎯 [Complexity Analysis] Query: '{user_prompt[:60]}...' → {complexity_label.upper()}")
    
    # OPTIMIZED: Concise system instructions for SPEED
    if use_minimal_prompt:
        # ULTRA-MINIMAL for simple requests (50% of normal prompt)
        if cloud_provider == 'digitalocean':
            ai_system_instructions = """Terraform IR generator for DigitalOcean. Output ONLY JSON:
{
  "ops": [{
    "action": "create",
    "selector": {"type": "digitalocean_type", "name": "name"},
    "changes": [{"op": "set", "path": "attr", "value": "..."}],
    "file_hint": "file.tf"
  }]
}

Rules:
1. Use DigitalOcean types: digitalocean_droplet, digitalocean_database_cluster, digitalocean_spaces_bucket, digitalocean_loadbalancer, digitalocean_vpc, digitalocean_kubernetes_cluster, digitalocean_firewall
2. Droplet sizes: s-1vcpu-1gb, s-1vcpu-2gb, s-2vcpu-4gb, s-4vcpu-8gb
3. Database sizes: db-s-1vcpu-1gb, db-s-1vcpu-2gb
4. Regions: nyc1, nyc3, sfo3, ams3, sgp1, lon1, fra1
5. Use ${resource.name.id} for references
6. Add tags where supported
7. ONLY JSON output
8. Choose simplest resource for the job - only use kubernetes_cluster when user explicitly mentions k8s/kubernetes/container orchestration

Now convert:"""
        else:
            ai_system_instructions = """Terraform IR generator. Output ONLY JSON:
{
  "ops": [{
    "action": "create",
    "selector": {"type": "aws_type", "name": "name"},
    "changes": [{"op": "set", "path": "attr", "value": "..."}],
    "file_hint": "file.tf"
  }]
}

Rules:
1. Use proper AWS types (aws_s3_bucket, aws_vpc, etc.)
2. Include required fields (bucket name, CIDR blocks, etc.)
3. Add tags: Name, Environment, ManagedBy
4. Use ${resource.name.id} for references
5. System auto-adds dependencies to semantic files (vpc.tf, iam.tf, etc) with educational comments
6. **JSON fields** (policy, container_definitions) → Use dict/array NOT quoted strings. System adds jsonencode()
7. **aws_lb**: Use "internal": false (internet-facing) NOT "scheme". Load balancer NO "scheme" argument!
8. **CRITICAL - ALB SUBNET REQUIREMENT**: If creating aws_lb (ALB), you MUST create AT LEAST 2 subnets in DIFFERENT availability zones, even if user says "one subnet". ALB will fail validation with only 1 subnet. Create: aws_subnet.public_1 (us-east-1a) AND aws_subnet.public_2 (us-east-1b)
9. **NO DUPLICATE NAMES**: Each resource type+name combo MUST be unique. Track names you've used!
10. **UNIQUE VALUES**: S3 bucket names, IAM role names, etc. must be globally unique. If creating multiple, append suffix: "my-bucket-1", "my-bucket-2", NOT all "my-bucket"
11. ONLY JSON output

Now convert:"""
    else:
        # FULL PROMPT for complex requests - check provider
        if cloud_provider == 'digitalocean':
            ai_system_instructions = """Terraform IR generator for DigitalOcean. Output ONLY JSON:
{
  "ops": [{
    "action": "create|update|delete",
    "selector": {"type": "digitalocean_type", "name": "name"},
    "changes": [{"op": "set", "path": "attr", "value": "..."}],
    "file_hint": "file.tf"
  }],
  "summary": "..."
}

**DigitalOcean Resource Types:**
- digitalocean_droplet (VMs)
- digitalocean_database_cluster (managed databases: mysql, pg, redis, mongodb)
- digitalocean_spaces_bucket (S3-compatible storage)
- digitalocean_loadbalancer (load balancers)
- digitalocean_vpc (virtual private cloud)
- digitalocean_kubernetes_cluster (managed K8s)
- digitalocean_firewall (firewall rules)
- digitalocean_domain, digitalocean_record (DNS)
- digitalocean_volume (block storage)
- digitalocean_project (resource grouping)

**Resource Selection Principle:**
Choose the SIMPLEST resource that meets requirements. Only use complex resources when explicitly needed:
- digitalocean_kubernetes_cluster → Only when user mentions: kubernetes, k8s, container orchestration, helm, pods, microservices architecture
- digitalocean_droplet → For general compute, servers, VMs, applications
- Don't assume complexity - if unsure, use simpler resources

**Droplet Sizes:** s-1vcpu-1gb, s-1vcpu-2gb, s-2vcpu-2gb, s-2vcpu-4gb, s-4vcpu-8gb, s-8vcpu-16gb
**Database Sizes:** db-s-1vcpu-1gb, db-s-1vcpu-2gb, db-s-2vcpu-4gb
**Kubernetes Sizes:** s-1vcpu-2gb, s-2vcpu-2gb, s-2vcpu-4gb, s-4vcpu-8gb
**Regions:** nyc1, nyc3, sfo3, ams3, sgp1, lon1, fra1, blr1, tor1

**CRITICAL Rules:**
1. Use ${resource.name.id} for resource references
2. Droplet requires: name, size, image, region
3. Database requires: name, engine, size, region, node_count
4. Kubernetes requires: name, region, version, node_pool
5. VPC requires: name, region, ip_range
6. Loadbalancer requires: name, region, forwarding_rule
7. Firewall requires: name, droplet_ids OR tags, inbound_rule/outbound_rule
8. Add tags where supported for organization
9. ONLY emit JSON, no markdown, no explanations

**Dependency Rules:**
- digitalocean_droplet in VPC → NEEDS digitalocean_vpc
- digitalocean_database_cluster → Optional VPC (private_network_uuid)
- digitalocean_kubernetes_cluster → Optional VPC (vpc_uuid)
- digitalocean_firewall → NEEDS droplet_ids or tags

**Example:**
User: "Create a 2GB droplet named web-server"
Output:
{
  "ops": [{
    "action": "create",
    "selector": {"type": "digitalocean_droplet", "name": "web_server"},
    "changes": [
      {"op": "set", "path": "name", "value": "web-server"},
      {"op": "set", "path": "size", "value": "s-1vcpu-2gb"},
      {"op": "set", "path": "image", "value": "ubuntu-22-04-x64"},
      {"op": "set", "path": "region", "value": "nyc3"},
      {"op": "set", "path": "tags", "value": ["web", "server"]}
    ],
    "file_hint": "droplets.tf"
  }],
  "summary": "Create 2GB Ubuntu droplet named web-server in NYC3"
}

Now convert this user request:"""
        else:
            # AWS FULL PROMPT
            ai_system_instructions = """Terraform IR generator. Output ONLY JSON:
{
  "ops": [{
    "action": "create|update|delete",
    "selector": {"type": "aws_type", "name": "name"},
    "changes": [{"op": "set", "path": "attr", "value": "..."}],
    "file_hint": "file.tf"
  }],
  "summary": "..."
}

**CRITICAL: Terraform Syntax Rules**
- aws_route_table "route" MUST be ARRAY: [{"cidr_block": "...", "gateway_id": "..."}]
- Security group ingress/egress MUST be ARRAY
- Any attribute accepting multiple entries MUST use array format
- **JSON fields (policy, assume_role_policy, container_definitions) → Use DICT/ARRAY, NOT quoted JSON strings**
  * WRONG: "container_definitions": "\\"[{...}]\\""
  * CORRECT: "container_definitions": [{"name": "nginx", "image": "nginx:latest", ...}]
  * The HCL generator will automatically wrap with jsonencode()
- **IAM policies** → Use nested dicts: {"Version": "2012-10-17", "Statement": [...]}
- **ECS container_definitions** → Use array of dicts: [{"name": "app", "image": "...", "portMappings": [...]}]
- **Load Balancer (aws_lb) rules - CRITICAL**:
  * NEVER use "scheme" argument (does not exist!)
  * Use "internal": false for internet-facing ALB
  * Use "internal": true for internal ALB
  * Required: "load_balancer_type": "application"|"network", "subnets": [...], "security_groups": [...]
  * aws_lb_target_group: "port", "protocol", "vpc_id", "target_type"
  * aws_lb_listener: "load_balancer_arn", "port", "protocol", "default_action"
  * **MANDATORY**: ALB MUST have AT LEAST 2 subnets in DIFFERENT AZs (e.g., public_1 in us-east-1a, public_2 in us-east-1b). Even if user says "one subnet", create 2+ for ALB or validation will fail!
- **NO DUPLICATE RESOURCE NAMES - CRITICAL**:
  * EVERY resource MUST have a UNIQUE name within its type
  * Track all resource names: {"aws_s3_bucket": ["main", "logs"], "aws_vpc": ["main"]}
  * Before creating a resource, check if that type+name combo already exists
  * If duplicate, use a different unique name (e.g., "main" → "main_secondary", "logs" → "logs_backup")
  * Example: If you already have `resource "aws_s3_bucket" "main"`, do NOT create another one - use "main_app" or "main_data" instead
- **UNIQUE RESOURCE VALUES - CRITICAL**:
  * S3 bucket names MUST be globally unique: "my-bucket-1", "my-bucket-2", NOT all "my-bucket"
  * IAM role/policy names must be unique: "app-role-1", "app-role-2"
  * If creating multiple S3 buckets, each bucket value must be different

**CRITICAL: Dependency Rules (ENFORCED)**
The system will AUTO-ADD missing dependencies, but you should include them:

VPC-Related (always need VPC):
- aws_subnet, aws_internet_gateway, aws_route_table, aws_security_group → NEED aws_vpc

Compute:
- aws_instance → NEEDS aws_vpc, aws_subnet, aws_security_group
- aws_autoscaling_group → NEEDS aws_vpc, aws_subnet, aws_launch_template

Serverless:
- aws_lambda_function → NEEDS aws_iam_role (execution role)
- Lambda in VPC → ALSO NEEDS aws_vpc, aws_subnet, aws_security_group

Databases:
- aws_db_instance (RDS) → NEEDS aws_vpc, 2x aws_subnet, aws_db_subnet_group, aws_security_group
- aws_rds_cluster (Aurora) → NEEDS aws_vpc, 2x aws_subnet, aws_db_subnet_group, aws_security_group

Load Balancers:
- aws_lb/aws_alb → NEEDS aws_vpc, 2x aws_subnet (different AZs), aws_security_group

Containers:
- aws_ecs_service → NEEDS aws_ecs_cluster, aws_ecs_task_definition, aws_vpc, aws_subnet, aws_security_group
- aws_eks_cluster → NEEDS aws_vpc, 2x aws_subnet, aws_iam_role (role_arn: ${aws_iam_role.eks_cluster_role.arn})
- aws_eks_node_group → NEEDS aws_eks_cluster, aws_subnet, aws_iam_role (node_role_arn: ${aws_iam_role.eks_node_group_role.arn})

**RULE: Generate COMPLETE, SELF-CONTAINED infrastructure with ALL dependencies**

**Supported AWS Resources:**
- aws_vpc, aws_subnet, aws_internet_gateway, aws_route_table
- aws_s3_bucket, aws_s3_bucket_versioning, aws_s3_bucket_server_side_encryption_configuration
- aws_lambda_function, aws_lambda_permission
- aws_ec2_instance, aws_security_group
- aws_rds_instance, aws_db_subnet_group
- aws_dynamodb_table
- aws_iam_role, aws_iam_policy, aws_iam_user

**Important Rules:**
1. Parse the ENTIRE prompt - don't skip any operations
2. Create separate ops for each distinct action (create VPC, update S3, delete Lambda)
3. Use proper Terraform resource types (aws_vpc, not just "vpc")
4. Include ALL specified attributes (CIDR blocks, availability zones, names, etc.)
5. For creates: set all required attributes
6. For updates: only include the attributes being changed
7. For deletes: just the selector, no changes needed
8. Extract environment tags from context (staging, production, dev)
9. ONLY emit JSON, no markdown, no explanations

**CRITICAL: INTELLIGENT FILE PLACEMENT**
10. **Check existing file structure** - If files exist, ADD to them instead of creating new ones:
    - EXISTING vpc.tf with aws_vpc.main? → Add new subnets to vpc.tf
    - EXISTING iam.tf with roles? → Add new IAM resources to iam.tf  
    - EXISTING ecs.tf with cluster? → Add new ECS resources to ecs.tf
11. **Use semantic file hints** based on resource type:
    - Networking: vpc.tf, networking.tf, network/
    - Compute: ecs.tf, ec2.tf, compute/
    - Storage: storage.tf, s3.tf
    - Security: security.tf, iam.tf
    - Databases: database.tf, rds.tf
12. **Preserve folder structure** - If existing files are in folders, continue that pattern:
    - EXISTING: networking/vpc.tf → NEW: networking/vpc.tf
    - EXISTING: compute/ecs.tf → NEW: compute/ecs.tf
13. **Semantic file naming** - Group resources by type in semantic files:
    - User-requested resources: Use semantic file hints from prompt
    - Auto-injected deps: Place in semantic files (vpc.tf, iam.tf, security.tf, etc)

**CRITICAL: Required Fields (MUST be included for creates):**
- aws_s3_bucket: MUST have "bucket" (the bucket name)
- aws_vpc: MUST have "cidr_block"
- aws_subnet: MUST have "vpc_id" and "cidr_block"
- aws_security_group: MUST have "name" or "name_prefix"
- aws_instance: MUST have "ami" and "instance_type"
- aws_iam_role: MUST have "assume_role_policy"
- aws_db_instance: MUST have "allocated_storage", "engine", "instance_class"

**CRITICAL: Reference & Interpolation Rules:**
- Resource references MUST use format: "${resource_type.name.attribute}"
- Example: "${aws_vpc.main.id}" NOT "${aws_vpc.main_vpc.id}"
- NEVER nest interpolations: NO "${prefix-${aws_s3_bucket.id}}"
- If you need dynamic names, use ONLY the reference: "${random_id.suffix.hex}"
- For static prefixes, use plain strings: "my-bucket-name" (no ${})

**Example Input:**
"Create an S3 bucket named logs-bucket with versioning"

**Example Output:**
```json
{
  "ops": [
    {
      "action": "create",
      "selector": {"type": "aws_s3_bucket", "name": "logs_bucket"},
      "changes": [
        {"op": "set", "path": "bucket", "value": "logs-bucket"},
        {"op": "set", "path": "tags.Name", "value": "logs-bucket"}
      ],
      "file_hint": "storage.tf"
    },
    {
      "action": "create",
      "selector": {"type": "aws_s3_bucket_versioning", "name": "logs_bucket_versioning"},
      "changes": [
        {"op": "set", "path": "bucket", "value": "${aws_s3_bucket.logs_bucket.id}"},
        {"op": "set", "path": "versioning_configuration.status", "value": "Enabled"}
      ],
      "file_hint": "storage.tf"
    }
  ],
  "summary": "Create S3 bucket logs-bucket with versioning enabled"
}
```

Now convert this user request:"""
    
    # Append existing resources context if provided
    if existing_resources_context:
        ai_system_instructions += f"\n\n{existing_resources_context}"
    
    try:
        # Use failover service with async streaming
        response_text = ""
        
        print(f"🔄 [IR Gen] Starting LLM call with max_tokens={max_tokens}", flush=True)
        
        # Stream directly from failover service
        async for token in llm_failover_service.stream_chat_completion(
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=ai_system_instructions,
            model=CLAUDE_AGENT_MODEL,
            max_tokens=max_tokens,  # Dynamic based on prompt complexity
            temperature=0
        ):
            response_text += token
            # Yield progress every 100 characters
            if len(response_text) % 100 == 0:
                yield {"type": "progress", "text": token, "total_length": len(response_text)}
        
        print(f"🔄 [IR Gen] LLM streaming complete. Response length: {len(response_text)}", flush=True)
        print(f"🔄 [IR Gen] Response preview: {response_text[:500]}...", flush=True)
        
        response_text = response_text.strip()
        
        # Remove markdown code fences if present
        if response_text.startswith("```"):
            text_lines = response_text.split("\n")
            # Strip first line (```json) and last line (```)
            response_text = "\n".join(text_lines[1:-1]) if len(text_lines) > 2 else response_text
            response_text = response_text.strip()
            print(f"🔄 [IR Gen] Stripped markdown fences. New length: {len(response_text)}", flush=True)
        
        # Parse JSON intermediate representation
        print(f"🔄 [IR Gen] Parsing JSON...", flush=True)
        parsed_ir = json.loads(response_text)
        print(f"🔄 [IR Gen] JSON parsed successfully. Keys: {list(parsed_ir.keys())}", flush=True)
        
        # Validate IR structure
        if "ops" not in parsed_ir:
            print(f"❌ [IR Gen] No 'ops' in parsed_ir! Full response: {response_text}", flush=True)
            raise ValueError("Intermediate representation must contain 'ops' array")
        
        print(f"✅ [IR Gen] Valid IR with {len(parsed_ir.get('ops', []))} ops", flush=True)
        
        # AUTO-INJECT missing dependencies (deterministic rules)
        parsed_ir = auto_inject_missing_dependencies(parsed_ir)
        
        yield {"type": "complete", "ir": parsed_ir}
    
    except json.JSONDecodeError as json_error:
        print(f"❌ [IR Gen] JSON decode error: {json_error}", flush=True)
        print(f"❌ [IR Gen] Raw response: {response_text}", flush=True)
        raise Exception(f"Failed to parse LLM response as valid JSON: {str(json_error)}\nResponse preview: {response_text[:500]}")
    
    except Exception as processing_error:
        print(f"❌ [IR Gen] Processing error: {processing_error}", flush=True)
        import traceback
        print(f"❌ [IR Gen] Traceback: {traceback.format_exc()}", flush=True)
        raise Exception(f"LLM API processing error with failover: {str(processing_error)}")


def auto_inject_missing_dependencies(ir: dict, parent_resource_type: Optional[str] = None, _depth: int = 0) -> dict:
    """
    Automatically inject missing dependencies into IR operations.
    Ensures all required dependencies are present BEFORE code generation.
    
    Args:
        ir: Intermediate representation with ops array
        parent_resource_type: The main resource type being created (for explanations)
        _depth: Internal recursion depth counter (prevents infinite loops)
    
    Returns:
        Enhanced IR with missing dependencies injected
    """
    # Prevent infinite recursion
    if _depth > 5:
        print(f"⚠️  [Dependency Injection] Max recursion depth reached, stopping")
        return ir
    
    operations = ir.get("ops", [])
    
    # Check for missing dependencies
    missing_deps = check_missing_dependencies(operations)
    
    if not missing_deps:
        print("✅ [Dependency Check] All dependencies satisfied")
        return ir
    
    prefix = "  " * _depth
    print(f"{prefix}🔧 [Dependency Injection] Found {len(missing_deps)} resources with missing dependencies (depth {_depth})")
    
    # Track which parent resource triggered each dependency (for explanations)
    dependency_sources = {}
    
    # Inject missing dependencies at the START of operations list
    injected_ops = []
    injected_resources = set()
    
    for resource_key, deps in missing_deps.items():
        # Extract parent resource type from key (e.g., "aws_instance.web" -> "aws_instance")
        parent_type = resource_key.split('.')[0]
        
        for dep in deps:
            dep_type = dep["type"]
            dep_name = dep["name"]
            dep_key = f"{dep_type}.{dep_name}"
            
            # Only inject once (avoid duplicates)
            if dep_key in injected_resources:
                continue
            
            print(f"{prefix}  ➕ Injecting: {dep_type}.{dep_name} ({dep['reason']})")
            
            # Track which parent resource needed this dependency
            dependency_sources[dep_key] = parent_type
            
            # Create minimal operation for this dependency with explanation
            injected_op = create_minimal_resource_op(dep_type, dep_name, parent_type)
            if injected_op:
                injected_ops.append(injected_op)
                injected_resources.add(dep_key)
    
    # Combine: injected dependencies FIRST, then original operations
    enhanced_ops = injected_ops + operations
    
    ir["ops"] = enhanced_ops
    if injected_ops:
        ir["summary"] = f"{ir.get('summary', '')} (+ {len(injected_ops)} auto-injected dependencies)"
    
    print(f"{prefix}✅ [Dependency Injection] Added {len(injected_ops)} missing dependencies")
    
    # RECURSIVE CHECK: The injected dependencies might have dependencies themselves!
    # (e.g., aws_iam_role_policy_attachment needs aws_iam_role)
    if injected_ops:
        print(f"{prefix}🔄 [Dependency Check] Recursively checking injected dependencies...")
        ir = auto_inject_missing_dependencies(ir, parent_resource_type, _depth + 1)
    
    return ir


def create_minimal_resource_op(resource_type: str, resource_name: str, parent_resource_type: str = None) -> dict:
    """
    Create a minimal operation for a missing dependency with detailed explanation.
    
    Args:
        resource_type: AWS resource type
        resource_name: Resource name
        parent_resource_type: The parent resource that triggered this dependency
    
    Returns:
        Operation dict with minimal required attributes and explanation comments
    """
    # Get detailed explanation for this dependency
    explanation = ""
    if parent_resource_type:
        explanation = get_dependency_explanation(parent_resource_type, resource_type)
    
    # Get AWS documentation link for this resource
    aws_docs_link = get_aws_docs_link(resource_type)
    terraform_docs_link = get_terraform_docs_link(resource_type)
    
    # Format explanation as HCL comment block with educational content
    comment_block = f"""
# ============================================================================
# 📚 AUTO-GENERATED DOCUMENTATION by Driftbox
# ============================================================================
# Resource: {resource_type}.{resource_name}
# Created for: {parent_resource_type if parent_resource_type else 'Required dependency'}
#
# 🎓 WHAT IS THIS?
#{explanation.replace(chr(10), chr(10) + '# ')}
#
# 📖 LEARN MORE:
# - AWS Documentation: {aws_docs_link}
# - Terraform Resource: {terraform_docs_link}
#
# 🛠️ CUSTOMIZATION GUIDE:
# This file was auto-generated to satisfy infrastructure dependencies.
# You can modify any values below to fit your specific requirements:
#   • Resource names (e.g., change "{resource_name}" to something meaningful)
#   • Network CIDRs (e.g., change "10.0.0.0/16" to your preferred range)
#   • Tags (e.g., add Environment, Team, CostCenter tags)
#   • Region/AZ (e.g., change "us-east-1a" to your preferred zone)
#
# 💡 PRO TIP: If you already have an existing {resource_type}, you can:
#    1. Delete this file
#    2. Reference your existing resource instead: ${{{resource_type}.YOUR_EXISTING_NAME.id}}
#    3. Use Terraform data sources to import existing infrastructure
#
# 🔗 RELATED RESOURCES:
# This resource is referenced by: {parent_resource_type if parent_resource_type else 'other resources'}
# ============================================================================
"""
    
    # Base operation with comment
    op = {
        "action": "create",
        "selector": {"type": resource_type, "name": resource_name},
        "changes": [],
        "file_hint": f"{resource_type.replace('aws_', '')}.tf",  # Place in semantic files like vpc.tf, iam.tf
        "explanation_comment": comment_block.strip()
    }
    
    # Add minimal required attributes based on resource type
    if resource_type == "aws_vpc":
        op["changes"] = [
            {"op": "set", "path": "cidr_block", "value": "10.0.0.0/16"},
            {"op": "set", "path": "enable_dns_hostnames", "value": True},
            {"op": "set", "path": "enable_dns_support", "value": True},
            {"op": "set", "path": "tags.Name", "value": resource_name},
            {"op": "set", "path": "tags.ManagedBy", "value": "Driftbox"}
        ]
    
    elif resource_type == "aws_subnet":
        op["changes"] = [
            {"op": "set", "path": "vpc_id", "value": "${aws_vpc.main.id}"},
            {"op": "set", "path": "cidr_block", "value": "10.0.1.0/24"},
            {"op": "set", "path": "availability_zone", "value": "us-east-1a"},
            {"op": "set", "path": "map_public_ip_on_launch", "value": True},
            {"op": "set", "path": "tags.Name", "value": resource_name},
            {"op": "set", "path": "tags.ManagedBy", "value": "Driftbox"}
        ]
    
    elif resource_type == "aws_security_group":
        op["changes"] = [
            {"op": "set", "path": "vpc_id", "value": "${aws_vpc.main.id}"},
            {"op": "set", "path": "name", "value": resource_name},
            {"op": "set", "path": "description", "value": f"Security group for {resource_name} - Auto-created by Driftbox"},
            {"op": "set", "path": "tags.Name", "value": resource_name},
            {"op": "set", "path": "tags.ManagedBy", "value": "Driftbox"}
        ]
    
    elif resource_type == "aws_iam_role":
        # Determine the AWS service based on the parent resource type or role name
        service_principal = "lambda.amazonaws.com"  # default
        
        if parent_resource_type == "aws_eks_cluster" or "eks_cluster" in resource_name:
            service_principal = "eks.amazonaws.com"
        elif parent_resource_type == "aws_eks_node_group" or "eks_node" in resource_name:
            service_principal = "ec2.amazonaws.com"
        elif parent_resource_type == "aws_ecs_task_definition" or "ecs_task" in resource_name:
            service_principal = "ecs-tasks.amazonaws.com"
        elif parent_resource_type == "aws_lambda_function" or "lambda" in resource_name:
            service_principal = "lambda.amazonaws.com"
        
        policy_doc = {
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": {"Service": service_principal},
                "Action": "sts:AssumeRole"
            }]
        }
        policy_value = {
            "__terraform_jsonencode__": True,
            "data": policy_doc
        }
        
        op["changes"] = [
            {"op": "set", "path": "name", "value": resource_name},
            {"op": "set", "path": "assume_role_policy", "value": policy_value},
            {"op": "set", "path": "tags.Name", "value": resource_name},
            {"op": "set", "path": "tags.ManagedBy", "value": "Driftbox"}
        ]
    
    elif resource_type == "aws_db_subnet_group":
        op["changes"] = [
            {"op": "set", "path": "name", "value": resource_name},
            {"op": "set", "path": "subnet_ids", "value": ["${aws_subnet.db_1.id}", "${aws_subnet.db_2.id}"]},
            {"op": "set", "path": "tags.Name", "value": resource_name},
            {"op": "set", "path": "tags.ManagedBy", "value": "Driftbox"}
        ]
    
    elif resource_type == "aws_ecs_cluster":
        op["changes"] = [
            {"op": "set", "path": "name", "value": resource_name},
            {"op": "set", "path": "tags.Name", "value": resource_name},
            {"op": "set", "path": "tags.ManagedBy", "value": "Driftbox"}
        ]
    
    elif resource_type == "aws_launch_template":
        op["changes"] = [
            {"op": "set", "path": "name", "value": resource_name},
            {"op": "set", "path": "image_id", "value": "ami-0c55b159cbfafe1f0"},  # Amazon Linux 2
            {"op": "set", "path": "instance_type", "value": "t3.micro"},
            {"op": "set", "path": "tag_specifications", "value": [{"resource_type": "instance", "tags": {"Name": resource_name, "ManagedBy": "Driftbox"}}]}
        ]
    
    elif resource_type == "aws_eip":
        op["changes"] = [
            {"op": "set", "path": "domain", "value": "vpc"},
            {"op": "set", "path": "tags.Name", "value": resource_name},
            {"op": "set", "path": "tags.ManagedBy", "value": "Driftbox"}
        ]
    
    elif resource_type == "aws_s3_bucket":
        # S3 buckets MUST have a bucket name
        bucket_name = resource_name.replace("_", "-")  # Convert underscores to hyphens for valid bucket names
        op["changes"] = [
            {"op": "set", "path": "bucket", "value": bucket_name},
            {"op": "set", "path": "tags.Name", "value": resource_name},
            {"op": "set", "path": "tags.ManagedBy", "value": "Driftbox"}
        ]
    
    elif resource_type == "aws_ecs_task_definition":
        # ECS task definitions need more specific attributes
        # Use jsonencode() in Terraform for proper JSON handling
        container_def = [{
            "name": resource_name,
            "image": "nginx:latest",
            "essential": True,
            "portMappings": [{
                "containerPort": 80,
                "protocol": "tcp"
            }]
        }]
        # Use special marker for jsonencode() - will be rendered as jsonencode(...) in HCL
        container_value = {
            "__terraform_jsonencode__": True,
            "data": container_def
        }
        
        op["changes"] = [
            {"op": "set", "path": "family", "value": resource_name},
            {"op": "set", "path": "network_mode", "value": "awsvpc"},
            {"op": "set", "path": "requires_compatibilities", "value": ["FARGATE"]},
            {"op": "set", "path": "cpu", "value": "256"},
            {"op": "set", "path": "memory", "value": "512"},
            {"op": "set", "path": "container_definitions", "value": container_value},
            {"op": "set", "path": "tags.Name", "value": resource_name},
            {"op": "set", "path": "tags.ManagedBy", "value": "Driftbox"}
        ]
    
    elif resource_type == "aws_iam_role_policy_attachment":
        # Determine which policy ARN to attach based on resource name
        policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"  # default
        role_name = "eks_cluster_role"  # default
        
        if "eks_cluster_policy" in resource_name:
            policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
            role_name = "eks_cluster_role"
        elif "eks_worker_node_policy" in resource_name or "worker_node" in resource_name:
            policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
            role_name = "eks_node_group_role"
        elif "eks_cni_policy" in resource_name or "cni" in resource_name:
            policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
            role_name = "eks_node_group_role"
        elif "eks_container_registry" in resource_name or "container_registry" in resource_name or "ecr" in resource_name:
            policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
            role_name = "eks_node_group_role"
        
        op["changes"] = [
            {"op": "set", "path": "role", "value": f"${{aws_iam_role.{role_name}.name}}"},
            {"op": "set", "path": "policy_arn", "value": policy_arn}
        ]
    
    else:
        # Generic minimal op
        op["changes"] = [
            {"op": "set", "path": "tags.Name", "value": resource_name},
            {"op": "set", "path": "tags.ManagedBy", "value": "Driftbox"}
        ]
    
    return op


async def process_multi_resource_nl_to_ir(user_prompt: str) -> dict:
    """
    Primary entry point for multi-resource NLP processing.
    Routes to appropriate AI provider or mock implementation.
    NON-STREAMING version - waits for complete result.
    """
    # Fast path: mock mode for testing
    if AI_PROVIDER == "mock":
        # Generate simple multi-operation IR for demonstration
        return {
            "ops": [
                {
                    "action": "create",
                    "selector": {"type": "aws_s3_bucket", "name": "demo_bucket"},
                    "changes": [
                        {"op": "set", "path": "bucket", "value": "demo-bucket"},
                        {"op": "set", "path": "tags.Environment", "value": "staging"}
                    ],
                    "file_hint": "main.tf"
                }
            ],
            "summary": "Mock: Create S3 bucket"
        }
    
    # Leverage Claude for sophisticated parsing (non-streaming)
    if AI_PROVIDER == "claude":
        # Consume the generator and return the final result
        result_ir = None
        async for event in process_multi_resource_nl_to_ir_with_claude(user_prompt):
            if event["type"] == "complete":
                result_ir = event["ir"]
                break
        return result_ir if result_ir else {"ops": [], "summary": "Failed to generate"}
    
    # Fallback to OpenAI (requires similar enhancement)
    elif AI_PROVIDER == "openai":
        # Use existing single-resource processor, wrap result
        single_resource_ir = process_nl_to_ir_with_openai(user_prompt)
        return {
            "ops": [
                {
                    "action": single_resource_ir.get("actions", ["plan"])[0],
                    "selector": {
                        "type": single_resource_ir.get("resource"),
                        "name": single_resource_ir.get("name")
                    },
                    "changes": [
                        {"op": "set", "path": attribute_key, "value": attribute_value}
                        for attribute_key, attribute_value in single_resource_ir.get("properties", {}).items()
                    ],
                    "file_hint": "main.tf"
                }
            ],
            "summary": f"{single_resource_ir.get('actions', ['plan'])[0]} {single_resource_ir.get('resource')}"
        }
    
    raise Exception(f"Unknown AI_PROVIDER configuration: {AI_PROVIDER}")


async def nl_to_multi_resource_ir(user_prompt: str) -> dict:
    """Entry point for multi-resource IR generation. Alias for process_multi_resource_nl_to_ir."""
    return await process_multi_resource_nl_to_ir(user_prompt)