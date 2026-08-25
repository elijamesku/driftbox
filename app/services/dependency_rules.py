"""
AWS Resource Dependency Rules
Ensures all required dependencies are automatically created when generating infrastructure.
Works alongside Voyage RAG to provide deterministic + best-practice code generation.
"""
from typing import Dict, List, Set, Any, Optional


# Core dependency rules: resource_type -> [required dependencies]
AWS_DEPENDENCY_RULES: Dict[str, List[Dict[str, Any]]] = {
    # ============================================================================
    # COMPUTE
    # ============================================================================
    "aws_instance": [
        {"type": "aws_vpc", "name": "main", "reason": "EC2 requires VPC"},
        {"type": "aws_subnet", "name": "main", "reason": "EC2 requires subnet", "link": "subnet_id"},
        {"type": "aws_security_group", "name": "ec2", "reason": "EC2 needs security group", "link": "vpc_security_group_ids"},
    ],
    
    "aws_launch_template": [
        {"type": "aws_vpc", "name": "main", "reason": "Launch template needs VPC"},
        {"type": "aws_security_group", "name": "ec2", "reason": "Launch template needs security rules"},
    ],
    
    "aws_autoscaling_group": [
        {"type": "aws_vpc", "name": "main", "reason": "ASG requires VPC"},
        {"type": "aws_subnet", "name": "main", "reason": "ASG needs subnet", "link": "vpc_zone_identifier"},
        {"type": "aws_launch_template", "name": "main", "reason": "ASG requires launch template", "link": "launch_template"},
    ],
    
    # ============================================================================
    # SERVERLESS
    # ============================================================================
    "aws_lambda_function": [
        {"type": "aws_iam_role", "name": "lambda_execution", "reason": "Lambda requires execution role", "link": "role"},
    ],
    
    "aws_lambda_function_vpc": [  # Lambda in VPC (special case)
        {"type": "aws_vpc", "name": "main", "reason": "Lambda VPC config requires VPC"},
        {"type": "aws_subnet", "name": "main", "reason": "Lambda VPC needs subnets", "link": "subnet_ids"},
        {"type": "aws_security_group", "name": "lambda", "reason": "Lambda VPC needs security group", "link": "security_group_ids"},
        {"type": "aws_iam_role", "name": "lambda_execution", "reason": "Lambda requires execution role", "link": "role"},
    ],
    
    # ============================================================================
    # NETWORKING
    # ============================================================================
    "aws_subnet": [
        {"type": "aws_vpc", "name": "main", "reason": "Subnet requires VPC", "link": "vpc_id"},
    ],
    
    "aws_internet_gateway": [
        {"type": "aws_vpc", "name": "main", "reason": "IGW requires VPC", "link": "vpc_id"},
    ],
    
    "aws_nat_gateway": [
        {"type": "aws_vpc", "name": "main", "reason": "NAT Gateway requires VPC"},
        {"type": "aws_subnet", "name": "public", "reason": "NAT Gateway needs public subnet", "link": "subnet_id"},
        {"type": "aws_eip", "name": "nat", "reason": "NAT Gateway requires Elastic IP", "link": "allocation_id"},
    ],
    
    "aws_route_table": [
        {"type": "aws_vpc", "name": "main", "reason": "Route table requires VPC", "link": "vpc_id"},
    ],
    
    "aws_security_group": [
        {"type": "aws_vpc", "name": "main", "reason": "Security group requires VPC", "link": "vpc_id"},
    ],
    
    "aws_network_interface": [
        {"type": "aws_vpc", "name": "main", "reason": "ENI requires VPC"},
        {"type": "aws_subnet", "name": "main", "reason": "ENI requires subnet", "link": "subnet_id"},
    ],
    
    "aws_vpc_endpoint": [
        {"type": "aws_vpc", "name": "main", "reason": "VPC endpoint requires VPC", "link": "vpc_id"},
    ],
    
    # ============================================================================
    # LOAD BALANCERS
    # ============================================================================
    "aws_lb": [  # ALB/NLB
        {"type": "aws_vpc", "name": "main", "reason": "Load balancer requires VPC"},
        {"type": "aws_subnet", "name": "public_1", "reason": "LB needs at least 2 subnets in different AZs", "link": "subnets"},
        {"type": "aws_subnet", "name": "public_2", "reason": "LB needs at least 2 subnets in different AZs", "link": "subnets"},
        {"type": "aws_security_group", "name": "lb", "reason": "LB needs security group", "link": "security_groups"},
    ],
    
    "aws_alb": [  # Alias for aws_lb
        {"type": "aws_vpc", "name": "main", "reason": "ALB requires VPC"},
        {"type": "aws_subnet", "name": "public_1", "reason": "ALB needs at least 2 subnets", "link": "subnets"},
        {"type": "aws_subnet", "name": "public_2", "reason": "ALB needs at least 2 subnets", "link": "subnets"},
        {"type": "aws_security_group", "name": "alb", "reason": "ALB needs security group", "link": "security_groups"},
    ],
    
    "aws_lb_target_group": [
        {"type": "aws_vpc", "name": "main", "reason": "Target group requires VPC", "link": "vpc_id"},
    ],
    
    # ============================================================================
    # DATABASES
    # ============================================================================
    "aws_db_instance": [  # RDS
        {"type": "aws_vpc", "name": "main", "reason": "RDS requires VPC"},
        {"type": "aws_subnet", "name": "db_1", "reason": "RDS needs DB subnet group with 2+ subnets"},
        {"type": "aws_subnet", "name": "db_2", "reason": "RDS needs DB subnet group with 2+ subnets"},
        {"type": "aws_db_subnet_group", "name": "main", "reason": "RDS requires DB subnet group", "link": "db_subnet_group_name"},
        {"type": "aws_security_group", "name": "rds", "reason": "RDS needs security group", "link": "vpc_security_group_ids"},
    ],
    
    "aws_db_subnet_group": [
        {"type": "aws_vpc", "name": "main", "reason": "DB subnet group requires VPC"},
        {"type": "aws_subnet", "name": "db_1", "reason": "DB subnet group needs at least 2 subnets", "link": "subnet_ids"},
        {"type": "aws_subnet", "name": "db_2", "reason": "DB subnet group needs at least 2 subnets", "link": "subnet_ids"},
    ],
    
    "aws_rds_cluster": [  # Aurora
        {"type": "aws_vpc", "name": "main", "reason": "Aurora requires VPC"},
        {"type": "aws_subnet", "name": "db_1", "reason": "Aurora needs DB subnet group"},
        {"type": "aws_subnet", "name": "db_2", "reason": "Aurora needs DB subnet group"},
        {"type": "aws_db_subnet_group", "name": "main", "reason": "Aurora requires DB subnet group", "link": "db_subnet_group_name"},
        {"type": "aws_security_group", "name": "aurora", "reason": "Aurora needs security group", "link": "vpc_security_group_ids"},
    ],
    
    "aws_elasticache_cluster": [
        {"type": "aws_vpc", "name": "main", "reason": "ElastiCache requires VPC"},
        {"type": "aws_subnet", "name": "cache_1", "reason": "ElastiCache needs subnet group"},
        {"type": "aws_elasticache_subnet_group", "name": "main", "reason": "ElastiCache requires subnet group", "link": "subnet_group_name"},
        {"type": "aws_security_group", "name": "cache", "reason": "ElastiCache needs security group", "link": "security_group_ids"},
    ],
    
    # ============================================================================
    # CONTAINERS
    # ============================================================================
    "aws_ecs_service": [
        {"type": "aws_ecs_cluster", "name": "main", "reason": "ECS service requires cluster", "link": "cluster"},
        {"type": "aws_ecs_task_definition", "name": "app", "reason": "ECS service requires task definition", "link": "task_definition"},
        {"type": "aws_vpc", "name": "main", "reason": "ECS service with awsvpc needs VPC"},
        {"type": "aws_subnet", "name": "main", "reason": "ECS service needs subnets", "link": "network_configuration.subnets"},
        {"type": "aws_security_group", "name": "ecs", "reason": "ECS service needs security group", "link": "network_configuration.security_groups"},
    ],
    
    "aws_ecs_task_definition": [
        {"type": "aws_iam_role", "name": "ecs_task_execution", "reason": "ECS task needs execution role", "link": "execution_role_arn"},
    ],
    
    "aws_eks_cluster": [
        {"type": "aws_vpc", "name": "main", "reason": "EKS requires VPC"},
        {"type": "aws_subnet", "name": "eks_1", "reason": "EKS needs at least 2 subnets", "link": "vpc_config.subnet_ids"},
        {"type": "aws_subnet", "name": "eks_2", "reason": "EKS needs at least 2 subnets", "link": "vpc_config.subnet_ids"},
        {"type": "aws_iam_role", "name": "eks_cluster_role", "reason": "EKS requires cluster role", "link": "role_arn"},
    ],
    
    "aws_eks_node_group": [
        {"type": "aws_eks_cluster", "name": "main", "reason": "Node group requires EKS cluster", "link": "cluster_name"},
        {"type": "aws_subnet", "name": "main", "reason": "Node group needs subnets", "link": "subnet_ids"},
        {"type": "aws_iam_role", "name": "eks_node_group_role", "reason": "Node group requires IAM role", "link": "node_role_arn"},
    ],
    
    # ============================================================================
    # API & APPLICATION
    # ============================================================================
    "aws_api_gateway_rest_api": [],  # No dependencies
    
    "aws_api_gateway_resource": [
        {"type": "aws_api_gateway_rest_api", "name": "main", "reason": "API resource requires REST API", "link": "rest_api_id"},
    ],
    
    "aws_api_gateway_method": [
        {"type": "aws_api_gateway_rest_api", "name": "main", "reason": "API method requires REST API", "link": "rest_api_id"},
        {"type": "aws_api_gateway_resource", "name": "main", "reason": "API method requires resource", "link": "resource_id"},
    ],
    
    "aws_api_gateway_integration": [
        {"type": "aws_api_gateway_rest_api", "name": "main", "reason": "API integration requires REST API", "link": "rest_api_id"},
        {"type": "aws_lambda_function", "name": "main", "reason": "Lambda integration requires function", "link": "uri"},
    ],
    
    # ============================================================================
    # STORAGE
    # ============================================================================
    "aws_s3_bucket": [],  # No dependencies
    
    "aws_s3_bucket_versioning": [
        {"type": "aws_s3_bucket", "name": "main", "reason": "Versioning requires bucket", "link": "bucket"},
    ],
    
    "aws_s3_bucket_server_side_encryption_configuration": [
        {"type": "aws_s3_bucket", "name": "main", "reason": "Encryption requires bucket", "link": "bucket"},
    ],
    
    "aws_efs_file_system": [],  # No VPC dependency for creation
    
    "aws_efs_mount_target": [
        {"type": "aws_efs_file_system", "name": "main", "reason": "Mount target requires EFS", "link": "file_system_id"},
        {"type": "aws_subnet", "name": "main", "reason": "Mount target requires subnet", "link": "subnet_id"},
        {"type": "aws_security_group", "name": "efs", "reason": "Mount target needs security group", "link": "security_groups"},
    ],
    
}


def get_required_dependencies(resource_type: str) -> List[Dict[str, Any]]:
    """
    Get required dependencies for a resource type.
    
    Args:
        resource_type: AWS resource type (e.g., "aws_instance")
    
    Returns:
        List of dependency specifications
    """
    return AWS_DEPENDENCY_RULES.get(resource_type, [])


def get_dependency_explanation(resource_type: str, dependency_type: str) -> str:
    """
    Get detailed explanation for why a dependency is required.
    
    Args:
        resource_type: The resource being created (e.g., "aws_instance")
        dependency_type: The dependency it needs (e.g., "aws_vpc")
    
    Returns:
        Detailed explanation string
    """
    explanations = {
        ("aws_instance", "aws_vpc"): """
This VPC (Virtual Private Cloud) was automatically created because EC2 instances must run inside a VPC.
Think of a VPC as your own private network in AWS - it provides isolation and security for your resources.
Without a VPC, the EC2 instance cannot be launched.""",
        
        ("aws_instance", "aws_subnet"): """
This subnet was automatically created because EC2 instances need a subnet to define which part of the VPC they're in.
Subnets divide your VPC into smaller networks and determine which availability zone the instance runs in.
This subnet is configured to use the VPC created above.""",
        
        ("aws_instance", "aws_security_group"): """
This security group was automatically created to control network traffic to/from your EC2 instance.
Security groups act as virtual firewalls - they define which ports and protocols are allowed.
By default, this allows all outbound traffic but you'll need to add ingress rules for inbound access.""",
        
        ("aws_lambda_function", "aws_iam_role"): """
This IAM role was automatically created because Lambda functions require an execution role.
The role defines what permissions your Lambda function has to access other AWS services.
This includes basic Lambda execution permissions to write logs to CloudWatch.""",
        
        ("aws_db_instance", "aws_vpc"): """
This VPC was automatically created because RDS database instances must run inside a VPC for security.
Running databases in a VPC isolates them from public internet access and provides network-level security.""",
        
        ("aws_db_instance", "aws_db_subnet_group"): """
This DB subnet group was automatically created because RDS requires subnets in at least 2 availability zones.
This ensures high availability - if one AZ fails, your database can failover to another AZ.
The subnet group defines which subnets RDS can use for the database and its replicas.""",
        
        ("aws_db_instance", "aws_security_group"): """
This security group was automatically created to control network access to your RDS database.
It acts as a firewall determining which resources can connect to the database on which ports.
You'll need to add ingress rules to allow your application servers to connect.""",
        
        ("aws_lb", "aws_vpc"): """
This VPC was automatically created because load balancers must run inside a VPC.
The VPC provides the network infrastructure for the load balancer to distribute traffic.""",
        
        ("aws_lb", "aws_subnet"): """
These subnets were automatically created because load balancers require at least 2 subnets in different availability zones.
This ensures high availability - the load balancer can route traffic even if one AZ fails.
Load balancers automatically distribute traffic across all healthy targets in all subnets.""",
        
        ("aws_lb", "aws_security_group"): """
This security group was automatically created to control inbound/outbound traffic for your load balancer.
It determines which ports and protocols the load balancer accepts (typically 80/443 for HTTP/HTTPS).
You'll need to configure ingress rules based on your application's requirements.""",
        
        ("aws_ecs_service", "aws_ecs_cluster"): """
This ECS cluster was automatically created because ECS services must run within a cluster.
Think of a cluster as a logical grouping of tasks/services that share the same infrastructure.
Multiple services can share the same cluster to save resources and simplify management.""",
        
        ("aws_ecs_service", "aws_ecs_task_definition"): """
This task definition was automatically created to define how your ECS containers should run.
It specifies which Docker image to use, CPU/memory limits, environment variables, and more.
ECS services use task definitions as templates to launch and manage your containers.""",
        
        ("aws_eks_cluster", "aws_iam_role"): """
This IAM role was automatically created because EKS clusters require a service role.
The role allows EKS to manage AWS resources on your behalf (like creating load balancers, attaching ENIs).
Without this role, the EKS cluster cannot interact with other AWS services.""",
        
        ("aws_eks_cluster", "aws_iam_role_policy_attachment"): """
This IAM policy attachment was automatically created to grant the EKS cluster service role the necessary permissions.
The AmazonEKSClusterPolicy provides permissions for Kubernetes to manage AWS resources.
Without this policy, the EKS cluster cannot create load balancers, manage ENIs, or perform cluster operations.""",
        
        ("aws_eks_node_group", "aws_iam_role_policy_attachment"): """
This IAM policy attachment was automatically created to grant the EKS node group IAM role the necessary permissions.
These policies allow worker nodes to join the cluster, pull container images from ECR, and manage pod networking.
Without these policies, the nodes cannot function properly within the EKS cluster.""",
    }
    
    key = (resource_type, dependency_type)
    return explanations.get(key, f"""
This {dependency_type} was automatically created because {resource_type} requires it as a dependency.
AWS resource dependencies ensure all required infrastructure is in place before creating the main resource.
This helps prevent deployment errors and follows AWS best practices.""")


def check_missing_dependencies(operations: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Check which dependencies are missing from a set of operations.
    
    Args:
        operations: List of operations (IR format with action, selector, changes)
    
    Returns:
        Dict mapping resource types to their missing dependencies
    """
    # Build set of resources being created
    creating_resources: Set[str] = set()
    for op in operations:
        if op.get("action") == "create":
            selector = op.get("selector", {})
            resource_type = selector.get("type", "")
            resource_name = selector.get("name", "")
            if resource_type and resource_name:
                creating_resources.add(f"{resource_type}.{resource_name}")
    
    # Check each resource for missing dependencies
    missing_deps: Dict[str, List[Dict[str, Any]]] = {}
    
    for op in operations:
        if op.get("action") != "create":
            continue
        
        selector = op.get("selector", {})
        resource_type = selector.get("type", "")
        resource_name = selector.get("name", "")
        
        if not resource_type:
            continue
        
        required_deps = get_required_dependencies(resource_type)
        
        for dep in required_deps:
            dep_type = dep["type"]
            dep_name = dep["name"]
            dep_key = f"{dep_type}.{dep_name}"
            
            # Check if this dependency is being created
            if dep_key not in creating_resources:
                resource_key = f"{resource_type}.{resource_name}"
                if resource_key not in missing_deps:
                    missing_deps[resource_key] = []
                missing_deps[resource_key].append(dep)
    
    return missing_deps


def get_dependency_summary(resource_type: str) -> str:
    """
    Get human-readable summary of dependencies for a resource.
    
    Args:
        resource_type: AWS resource type
    
    Returns:
        Formatted string describing dependencies
    """
    deps = get_required_dependencies(resource_type)
    if not deps:
        return f"{resource_type}: No dependencies"
    
    dep_list = []
    for dep in deps:
        dep_list.append(f"  - {dep['type']} ({dep['reason']})")
    
    return f"{resource_type} requires:\n" + "\n".join(dep_list)


# For debugging and documentation
if __name__ == "__main__":
    print("AWS Resource Dependency Rules")
    print("=" * 80)
    
    # Group by category
    categories = {
        "Compute": ["aws_instance", "aws_launch_template", "aws_autoscaling_group"],
        "Serverless": ["aws_lambda_function"],
        "Networking": ["aws_subnet", "aws_internet_gateway", "aws_nat_gateway", "aws_security_group"],
        "Load Balancers": ["aws_lb", "aws_alb"],
        "Databases": ["aws_db_instance", "aws_rds_cluster"],
        "Containers": ["aws_ecs_service", "aws_eks_cluster"],
    }
    
    for category, resources in categories.items():
        print(f"\n{category}:")
        print("-" * 80)
        for resource_type in resources:
            deps = get_required_dependencies(resource_type)
            print(f"\n{resource_type}:")
            if deps:
                for dep in deps:
                    print(f"  ✓ {dep['type']}: {dep['reason']}")
            else:
                print(f"  (no dependencies)")

