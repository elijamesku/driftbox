"""
Smart query chunking for large infrastructure requests.
Splits massive queries into logical chunks that process fast.
"""
from typing import List, Tuple
import re


def should_chunk_query(prompt: str) -> bool:
    """
    Detect if query is large enough to benefit from chunking.
    
    Large query indicators:
    - Multiple major services (VPC + ECS + RDS + Redis + ALB)
    - Words like "production-ready", "complete", "full stack"
    - 3+ availability zones
    - Auto-scaling + load balancing + database clusters
    """
    prompt_lower = prompt.lower()
    
    # Count major infrastructure components
    components = {
        'networking': any(word in prompt_lower for word in ['vpc', 'subnet', 'nat gateway', 'internet gateway', 'route table']),
        'load_balancing': any(word in prompt_lower for word in ['alb', 'load balancer', 'application load balancer']),
        'compute': any(word in prompt_lower for word in ['ecs', 'fargate', 'ec2', 'auto-scaling', 'autoscaling']),
        'database': any(word in prompt_lower for word in ['rds', 'aurora', 'postgresql', 'mysql', 'dynamodb']),
        'caching': any(word in prompt_lower for word in ['redis', 'elasticache', 'memcached']),
        'monitoring': any(word in prompt_lower for word in ['cloudwatch', 'alarms', 'monitoring']),
        'security': any(word in prompt_lower for word in ['iam role', 'security group', 'ssl', 'certificate']),
        'storage': any(word in prompt_lower for word in ['s3', 'bucket', 'ebs', 'efs']),
    }
    
    component_count = sum(components.values())
    
    # Keywords that indicate massive deployment
    massive_indicators = [
        'production-ready', 'production ready', 'full stack', 'complete platform',
        'microservice platform', 'entire infrastructure', '3 tier', 'three tier',
        'high availability', 'highly available', 'multi-az', 'across 3 az'
    ]
    
    is_massive = any(indicator in prompt_lower for indicator in massive_indicators)
    
    # Chunk if 4+ components OR massive deployment keywords
    return component_count >= 4 or is_massive


def chunk_query_with_claude(prompt: str) -> List[Tuple[str, str]]:
    """
    DYNAMIC: Use Claude to intelligently split ANY large query.
    Works with Lambda, EKS, serverless, anything.
    """
    from app.config import _anthropic_instance, CLAUDE_MODEL_NAME
    
    if not _anthropic_instance:
        # Fallback to static chunking
        return chunk_query(prompt)
    
    split_prompt = f"""Split this infrastructure request into 3-6 logical sub-queries (10-15 resources each).
Each sub-query should be independently executable.

Rules:
- Group by infrastructure layer (network, compute, data, monitoring)
- Dependencies first (VPC before ECS, ECS before ALB targets)
- 10-15 resources per chunk max
- Output ONLY JSON array: [{{"name": "networking", "query": "Create VPC..."}}, ...]

User request: {prompt}

JSON array of sub-queries:"""

    try:
        response = _anthropic_instance.messages.create(
            model=CLAUDE_MODEL_NAME,
            max_tokens=2000,
            messages=[{"role": "user", "content": split_prompt}],
            temperature=0
        )
        
        import json
        text = response.content[0].text.strip()
        # Remove markdown if present
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1])
        
        chunks_data = json.loads(text)
        return [(c["name"], c["query"]) for c in chunks_data]
    except:
        # Fallback to static chunking
        return chunk_query(prompt)


def chunk_query(prompt: str) -> List[Tuple[str, str]]:
    """
    STATIC: Fallback for hardcoded patterns.
    
    Returns:
        List of (chunk_name, chunk_query) tuples
    """
    prompt_lower = prompt.lower()
    chunks = []
    
    # Extract key details
    region_match = re.search(r'(us-[a-z]+-\d+|eu-[a-z]+-\d+|ap-[a-z]+-\d+)', prompt_lower)
    region = region_match.group(1) if region_match else "us-east-1"
    
    az_match = re.search(r'(\d+)\s+(availability zones?|azs?)', prompt_lower)
    num_azs = int(az_match.group(1)) if az_match else 3
    
    # CHUNK 1: Networking (fastest, ~15-20s)
    if any(word in prompt_lower for word in ['vpc', 'subnet', 'nat', 'internet gateway']):
        networking_query = f"Create VPC infrastructure in {region}:\n"
        networking_query += f"- VPC with CIDR 10.0.0.0/16\n"
        networking_query += f"- {num_azs} public subnets across {num_azs} AZs\n"
        networking_query += f"- {num_azs} private subnets across {num_azs} AZs\n"
        networking_query += "- Internet gateway for public subnets\n"
        networking_query += f"- {num_azs} NAT gateways (one per AZ) for private subnets\n"
        networking_query += "- Route tables for public and private subnets"
        chunks.append(("networking", networking_query))
    
    # CHUNK 2: Load Balancing & Security (~15-20s)
    if any(word in prompt_lower for word in ['alb', 'load balancer', 'ssl']):
        alb_query = f"Create Application Load Balancer in {region}:\n"
        alb_query += "- ALB in public subnets\n"
        alb_query += "- Target group for ECS tasks\n"
        alb_query += "- HTTP/HTTPS listeners\n"
        if 'ssl' in prompt_lower or 'certificate' in prompt_lower:
            alb_query += "- SSL/TLS certificate (placeholder ARN)\n"
        alb_query += "- Security group allowing HTTP/HTTPS from internet"
        chunks.append(("load_balancing", alb_query))
    
    # CHUNK 3: Compute (ECS/Fargate) (~20-30s)
    if any(word in prompt_lower for word in ['ecs', 'fargate', 'container', 'api']):
        ecs_query = f"Create ECS Fargate cluster in {region}:\n"
        ecs_query += "- ECS cluster\n"
        
        # Extract container details
        if 'nginx' in prompt_lower:
            ecs_query += "- Task definition with nginx:latest container\n"
        else:
            ecs_query += "- Task definition with containerized API\n"
        
        # Extract scaling details
        min_tasks = 2
        max_tasks = 10
        if 'auto-scaling' in prompt_lower or 'autoscaling' in prompt_lower:
            scale_match = re.search(r'(\d+)-(\d+)\s+tasks?', prompt_lower)
            if scale_match:
                min_tasks = int(scale_match.group(1))
                max_tasks = int(scale_match.group(2))
        
        ecs_query += f"- ECS service with auto-scaling ({min_tasks}-{max_tasks} tasks)\n"
        ecs_query += "- IAM roles for ECS task execution\n"
        ecs_query += "- Security group for ECS tasks\n"
        ecs_query += "- CloudWatch log group for container logs"
        chunks.append(("compute", ecs_query))
    
    # CHUNK 4: Database (RDS/Aurora) (~20-30s)
    if any(word in prompt_lower for word in ['rds', 'aurora', 'postgresql', 'mysql', 'database']):
        db_query = f"Create Aurora PostgreSQL cluster in {region}:\n"
        db_query += "- Aurora PostgreSQL cluster in private subnets\n"
        db_query += "- DB subnet group\n"
        
        # Extract instance count
        instance_count = 2
        instance_match = re.search(r'(\d+)\s+instances?', prompt_lower)
        if instance_match:
            instance_count = int(instance_match.group(1))
        
        db_query += f"- {instance_count} Aurora instances (writer + readers)\n"
        db_query += "- Security group allowing PostgreSQL from ECS tasks\n"
        db_query += "- IAM role for RDS monitoring"
        chunks.append(("database", db_query))
    
    # CHUNK 5: Caching (Redis) (~15-20s)
    if any(word in prompt_lower for word in ['redis', 'elasticache', 'caching']):
        cache_query = f"Create ElastiCache Redis cluster in {region}:\n"
        cache_query += "- ElastiCache Redis cluster in private subnets\n"
        cache_query += "- Subnet group for Redis\n"
        cache_query += "- Security group allowing Redis from ECS tasks"
        chunks.append(("caching", cache_query))
    
    # CHUNK 6: Monitoring & Storage (~10-15s)
    if any(word in prompt_lower for word in ['cloudwatch', 'monitoring', 's3', 'logs']):
        extras_query = "Create monitoring and storage:\n"
        if 'cloudwatch' in prompt_lower or 'monitoring' in prompt_lower:
            extras_query += "- CloudWatch alarms for CPU and memory\n"
        if 's3' in prompt_lower or 'logs' in prompt_lower or 'bucket' in prompt_lower:
            extras_query += "- S3 bucket for application logs with versioning"
        chunks.append(("monitoring", extras_query))
    
    # If no chunks identified, return original query as single chunk
    if not chunks:
        chunks.append(("complete", prompt))
    
    return chunks


def estimate_chunk_time(chunk_name: str) -> int:
    """Estimate processing time in seconds for a chunk"""
    time_estimates = {
        "networking": 20,
        "load_balancing": 15,
        "compute": 30,
        "database": 25,
        "caching": 15,
        "monitoring": 10,
        "complete": 180  # Full query fallback
    }
    return time_estimates.get(chunk_name, 20)

