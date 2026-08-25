"""
Security Scanner Service
Analyzes Terraform code for security vulnerabilities and misconfigurations
NO AWS credentials needed - pure code analysis
"""

from typing import Dict, List, Any, Optional
import re
import json


class SecurityIssue:
    """Represents a security issue found in Terraform code"""
    
    def __init__(
        self,
        severity: str,  # critical, high, medium, low
        category: str,  # encryption, access_control, network, iam, logging
        title: str,
        description: str,
        resource_type: str,
        resource_name: str,
        file: str,
        line: int,
        remediation: str,
        compliance: List[str] = None  # e.g., ["SOC2", "HIPAA", "PCI-DSS"]
    ):
        self.severity = severity
        self.category = category
        self.title = title
        self.description = description
        self.resource_type = resource_type
        self.resource_name = resource_name
        self.file = file
        self.line = line
        self.remediation = remediation
        self.compliance = compliance or []
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "severity": self.severity,
            "category": self.category,
            "title": self.title,
            "description": self.description,
            "resource_type": self.resource_type,
            "resource_name": self.resource_name,
            "file": self.file,
            "line": self.line,
            "remediation": self.remediation,
            "compliance": self.compliance,
        }


class SecurityScanner:
    """Scans Terraform code for security issues"""
    
    def scan_resources(self, resources: List[Dict[str, Any]]) -> List[SecurityIssue]:
        """
        Scan a list of resources for security issues
        
        Args:
            resources: List of resources from INFRASTRUCTURE_CATALOG
        
        Returns:
            List of SecurityIssue objects
        """
        issues = []
        
        for resource in resources:
            if not isinstance(resource, dict):
                continue
            
            resource_type = resource.get("type", "")
            attrs = resource.get("attrs", {})
            name = resource.get("name", "")
            file = resource.get("file", "")
            line = resource.get("line", 1)
            
            # S3 Security Checks
            if resource_type == "aws_s3_bucket":
                issues.extend(self._check_s3_security(attrs, name, file, line))
            
            # Security Group Checks
            elif resource_type == "aws_security_group":
                issues.extend(self._check_security_group(attrs, name, file, line))
            
            # RDS Security Checks
            elif resource_type == "aws_db_instance":
                issues.extend(self._check_rds_security(attrs, name, file, line))
            
            # EBS Security Checks
            elif resource_type == "aws_ebs_volume":
                issues.extend(self._check_ebs_security(attrs, name, file, line))
            
            # IAM Policy Checks
            elif resource_type == "aws_iam_policy":
                issues.extend(self._check_iam_policy(attrs, name, file, line))
            
            # IAM Role Checks
            elif resource_type == "aws_iam_role":
                issues.extend(self._check_iam_role(attrs, name, file, line))
            
            # CloudWatch Log Group Checks
            elif resource_type == "aws_cloudwatch_log_group":
                issues.extend(self._check_cloudwatch_logs(attrs, name, file, line))
            
            # KMS Key Checks
            elif resource_type == "aws_kms_key":
                issues.extend(self._check_kms_key(attrs, name, file, line))
            
            # Lambda Security Checks
            elif resource_type == "aws_lambda_function":
                issues.extend(self._check_lambda_security(attrs, name, file, line))
            
            # ELB/ALB Security Checks
            elif resource_type in ["aws_lb", "aws_alb", "aws_elb"]:
                issues.extend(self._check_load_balancer_security(attrs, name, file, line, resource_type))
            
            # SNS Topic Checks
            elif resource_type == "aws_sns_topic":
                issues.extend(self._check_sns_security(attrs, name, file, line))
            
            # SQS Queue Checks
            elif resource_type == "aws_sqs_queue":
                issues.extend(self._check_sqs_security(attrs, name, file, line))
            
            # ECR Repository Checks
            elif resource_type == "aws_ecr_repository":
                issues.extend(self._check_ecr_security(attrs, name, file, line))
        
            # ===== DIGITALOCEAN SECURITY CHECKS =====
            
            # DigitalOcean Droplet Checks
            elif resource_type == "digitalocean_droplet":
                issues.extend(self._check_droplet_security(attrs, name, file, line))
            
            # DigitalOcean Firewall Checks
            elif resource_type == "digitalocean_firewall":
                issues.extend(self._check_do_firewall_security(attrs, name, file, line))
            
            # DigitalOcean Spaces Bucket Checks
            elif resource_type == "digitalocean_spaces_bucket":
                issues.extend(self._check_spaces_security(attrs, name, file, line))
            
            # DigitalOcean Database Cluster Checks
            elif resource_type == "digitalocean_database_cluster":
                issues.extend(self._check_do_database_security(attrs, name, file, line))
            
            # DigitalOcean Kubernetes Cluster Checks
            elif resource_type == "digitalocean_kubernetes_cluster":
                issues.extend(self._check_do_kubernetes_security(attrs, name, file, line))
            
            # DigitalOcean Load Balancer Checks
            elif resource_type == "digitalocean_loadbalancer":
                issues.extend(self._check_do_loadbalancer_security(attrs, name, file, line))
        
        return issues
    
    def _check_s3_security(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check S3 bucket security"""
        issues = []
        
        # Check for public ACL
        acl = attrs.get("acl", "")
        if acl in ["public-read", "public-read-write"]:
            issues.append(SecurityIssue(
                severity="critical",
                category="access_control",
                title="S3 Bucket Is Public",
                description=f"S3 bucket '{name}' has public ACL: {acl}",
                resource_type="aws_s3_bucket",
                resource_name=name,
                file=file,
                line=line,
                remediation="Remove public ACL. Use bucket policies with specific principals instead.",
                compliance=["SOC2", "HIPAA", "PCI-DSS"]
            ))
        
        # Check for encryption
        encryption = attrs.get("server_side_encryption_configuration")
        if not encryption:
            issues.append(SecurityIssue(
                severity="high",
                category="encryption",
                title="S3 Bucket Not Encrypted",
                description=f"S3 bucket '{name}' does not have encryption enabled",
                resource_type="aws_s3_bucket",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable server-side encryption with AES-256 or KMS",
                compliance=["SOC2", "HIPAA", "PCI-DSS"]
            ))
        
        # Check for versioning
        versioning = attrs.get("versioning", {})
        if not versioning or not versioning.get("enabled"):
            issues.append(SecurityIssue(
                severity="medium",
                category="logging",
                title="S3 Bucket Versioning Disabled",
                description=f"S3 bucket '{name}' does not have versioning enabled",
                resource_type="aws_s3_bucket",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable versioning to protect against accidental deletions",
                compliance=["SOC2"]
            ))
        
        # Check for logging
        logging_config = attrs.get("logging")
        if not logging_config:
            issues.append(SecurityIssue(
                severity="medium",
                category="logging",
                title="S3 Bucket Logging Disabled",
                description=f"S3 bucket '{name}' does not have access logging enabled",
                resource_type="aws_s3_bucket",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable server access logging to track bucket access",
                compliance=["SOC2", "PCI-DSS"]
            ))
        
        return issues
    
    def _check_security_group(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check security group rules"""
        issues = []
        
        # Check ingress rules
        ingress_rules = attrs.get("ingress", [])
        if isinstance(ingress_rules, list):
            for idx, rule in enumerate(ingress_rules):
                if not isinstance(rule, dict):
                    continue
                
                cidr_blocks = rule.get("cidr_blocks", [])
                from_port = rule.get("from_port")
                to_port = rule.get("to_port")
                protocol = rule.get("protocol", "")
                
                # Check for 0.0.0.0/0 on sensitive ports
                if "0.0.0.0/0" in cidr_blocks:
                    # SSH (22)
                    if from_port == 22 or to_port == 22:
                        issues.append(SecurityIssue(
                            severity="critical",
                            category="network",
                            title="SSH Open to Internet",
                            description=f"Security group '{name}' allows SSH (port 22) from 0.0.0.0/0",
                            resource_type="aws_security_group",
                            resource_name=name,
                            file=file,
                            line=line,
                            remediation="Restrict SSH access to specific IP ranges or use AWS Systems Manager Session Manager",
                            compliance=["SOC2", "PCI-DSS"]
                        ))
                    
                    # RDP (3389)
                    elif from_port == 3389 or to_port == 3389:
                        issues.append(SecurityIssue(
                            severity="critical",
                            category="network",
                            title="RDP Open to Internet",
                            description=f"Security group '{name}' allows RDP (port 3389) from 0.0.0.0/0",
                            resource_type="aws_security_group",
                            resource_name=name,
                            file=file,
                            line=line,
                            remediation="Restrict RDP access to specific IP ranges or use bastion host",
                            compliance=["SOC2", "PCI-DSS"]
                        ))
                    
                    # Database ports
                    elif from_port in [3306, 5432, 1433, 27017, 6379] or to_port in [3306, 5432, 1433, 27017, 6379]:
                        port_names = {3306: "MySQL", 5432: "PostgreSQL", 1433: "MSSQL", 27017: "MongoDB", 6379: "Redis"}
                        port_name = port_names.get(from_port or to_port, f"port {from_port or to_port}")
                        issues.append(SecurityIssue(
                            severity="critical",
                            category="network",
                            title="Database Port Open to Internet",
                            description=f"Security group '{name}' allows {port_name} from 0.0.0.0/0",
                            resource_type="aws_security_group",
                            resource_name=name,
                            file=file,
                            line=line,
                            remediation="Restrict database access to application security groups only",
                            compliance=["SOC2", "HIPAA", "PCI-DSS"]
                        ))
                    
                    # All traffic
                    elif protocol == "-1" or (from_port == 0 and to_port == 65535):
                        issues.append(SecurityIssue(
                            severity="critical",
                            category="network",
                            title="All Traffic Open to Internet",
                            description=f"Security group '{name}' allows all traffic from 0.0.0.0/0",
                            resource_type="aws_security_group",
                            resource_name=name,
                            file=file,
                            line=line,
                            remediation="Restrict to specific ports and protocols. Never allow all traffic from internet.",
                            compliance=["SOC2", "HIPAA", "PCI-DSS"]
                        ))
        
        return issues
    
    def _check_rds_security(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check RDS instance security"""
        issues = []
        
        # Check for encryption
        if not attrs.get("storage_encrypted"):
            issues.append(SecurityIssue(
                severity="high",
                category="encryption",
                title="RDS Instance Not Encrypted",
                description=f"RDS instance '{name}' does not have encryption enabled",
                resource_type="aws_db_instance",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable storage encryption using KMS",
                compliance=["SOC2", "HIPAA", "PCI-DSS"]
            ))
        
        # Check for public accessibility
        if attrs.get("publicly_accessible"):
            issues.append(SecurityIssue(
                severity="critical",
                category="access_control",
                title="RDS Instance Is Public",
                description=f"RDS instance '{name}' is publicly accessible",
                resource_type="aws_db_instance",
                resource_name=name,
                file=file,
                line=line,
                remediation="Set publicly_accessible = false and access via VPC only",
                compliance=["SOC2", "HIPAA", "PCI-DSS"]
            ))
        
        # Check for backup retention
        backup_retention = attrs.get("backup_retention_period", 0)
        if backup_retention < 7:
            issues.append(SecurityIssue(
                severity="medium",
                category="logging",
                title="RDS Backup Retention Too Low",
                description=f"RDS instance '{name}' has backup retention of only {backup_retention} days",
                resource_type="aws_db_instance",
                resource_name=name,
                file=file,
                line=line,
                remediation="Set backup_retention_period to at least 7 days (30 for production)",
                compliance=["SOC2"]
            ))
        
        # Check for deletion protection
        if not attrs.get("deletion_protection"):
            issues.append(SecurityIssue(
                severity="medium",
                category="access_control",
                title="RDS Deletion Protection Disabled",
                description=f"RDS instance '{name}' does not have deletion protection enabled",
                resource_type="aws_db_instance",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable deletion_protection = true to prevent accidental deletion",
                compliance=["SOC2"]
            ))
        
        return issues
    
    def _check_ebs_security(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check EBS volume security"""
        issues = []
        
        if not attrs.get("encrypted"):
            issues.append(SecurityIssue(
                severity="high",
                category="encryption",
                title="EBS Volume Not Encrypted",
                description=f"EBS volume '{name}' is not encrypted",
                resource_type="aws_ebs_volume",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable encryption using KMS",
                compliance=["SOC2", "HIPAA", "PCI-DSS"]
            ))
        
        return issues
    
    def _check_iam_policy(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check IAM policy for overly permissive permissions"""
        issues = []
        
        policy_doc = attrs.get("policy")
        if policy_doc:
            # Try to parse policy JSON
            try:
                if isinstance(policy_doc, str):
                    policy = json.loads(policy_doc)
                else:
                    policy = policy_doc
                
                statements = policy.get("Statement", [])
                for statement in statements:
                    if not isinstance(statement, dict):
                        continue
                    
                    effect = statement.get("Effect", "")
                    actions = statement.get("Action", [])
                    resources = statement.get("Resource", [])
                    
                    if isinstance(actions, str):
                        actions = [actions]
                    if isinstance(resources, str):
                        resources = [resources]
                    
                    # Check for wildcard actions
                    if effect == "Allow" and "*" in actions:
                        issues.append(SecurityIssue(
                            severity="critical",
                            category="iam",
                            title="IAM Policy Allows All Actions",
                            description=f"IAM policy '{name}' allows Action: * (all actions)",
                            resource_type="aws_iam_policy",
                            resource_name=name,
                            file=file,
                            line=line,
                            remediation="Restrict to specific actions following principle of least privilege",
                            compliance=["SOC2", "PCI-DSS"]
                        ))
                    
                    # Check for wildcard resources
                    if effect == "Allow" and "*" in resources:
                        issues.append(SecurityIssue(
                            severity="high",
                            category="iam",
                            title="IAM Policy Allows All Resources",
                            description=f"IAM policy '{name}' allows Resource: * (all resources)",
                            resource_type="aws_iam_policy",
                            resource_name=name,
                            file=file,
                            line=line,
                            remediation="Restrict to specific resource ARNs",
                            compliance=["SOC2", "PCI-DSS"]
                        ))
            except (json.JSONDecodeError, TypeError):
                pass
        
        return issues
    
    def _check_iam_role(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check IAM role trust policy"""
        issues = []
        
        assume_role_policy = attrs.get("assume_role_policy")
        if assume_role_policy:
            try:
                if isinstance(assume_role_policy, str):
                    policy = json.loads(assume_role_policy)
                else:
                    policy = assume_role_policy
                
                statements = policy.get("Statement", [])
                for statement in statements:
                    if not isinstance(statement, dict):
                        continue
                    
                    principal = statement.get("Principal", {})
                    if isinstance(principal, dict):
                        aws_principals = principal.get("AWS", [])
                        if isinstance(aws_principals, str):
                            aws_principals = [aws_principals]
                        
                        # Check for wildcard principals
                        if "*" in aws_principals:
                            issues.append(SecurityIssue(
                                severity="critical",
                                category="iam",
                                title="IAM Role Allows Any Principal",
                                description=f"IAM role '{name}' trusts Principal: * (any AWS account)",
                                resource_type="aws_iam_role",
                                resource_name=name,
                                file=file,
                                line=line,
                                remediation="Restrict to specific AWS account IDs or ARNs",
                                compliance=["SOC2", "PCI-DSS"]
                            ))
            except (json.JSONDecodeError, TypeError):
                pass
        
        return issues
    
    def _check_cloudwatch_logs(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check CloudWatch log group security"""
        issues = []
        
        # Check for encryption
        if not attrs.get("kms_key_id"):
            issues.append(SecurityIssue(
                severity="medium",
                category="encryption",
                title="CloudWatch Logs Not Encrypted",
                description=f"CloudWatch log group '{name}' is not encrypted with KMS",
                resource_type="aws_cloudwatch_log_group",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable encryption using a KMS key",
                compliance=["SOC2", "HIPAA"]
            ))
        
        # Check for retention
        retention = attrs.get("retention_in_days")
        if not retention:
            issues.append(SecurityIssue(
                severity="low",
                category="logging",
                title="CloudWatch Logs No Retention Policy",
                description=f"CloudWatch log group '{name}' has no retention policy (logs kept forever)",
                resource_type="aws_cloudwatch_log_group",
                resource_name=name,
                file=file,
                line=line,
                remediation="Set retention_in_days to comply with data retention policies",
                compliance=["SOC2"]
            ))
        
        return issues
    
    def _check_kms_key(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check KMS key configuration"""
        issues = []
        
        # Check for key rotation
        if not attrs.get("enable_key_rotation"):
            issues.append(SecurityIssue(
                severity="medium",
                category="encryption",
                title="KMS Key Rotation Disabled",
                description=f"KMS key '{name}' does not have automatic rotation enabled",
                resource_type="aws_kms_key",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable enable_key_rotation = true",
                compliance=["SOC2", "PCI-DSS"]
            ))
        
        return issues
    
    def _check_lambda_security(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check Lambda function security"""
        issues = []
        
        # Check for tracing
        tracing_config = attrs.get("tracing_config", {})
        if not tracing_config or tracing_config.get("mode") != "Active":
            issues.append(SecurityIssue(
                severity="low",
                category="logging",
                title="Lambda Tracing Disabled",
                description=f"Lambda function '{name}' does not have X-Ray tracing enabled",
                resource_type="aws_lambda_function",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable X-Ray tracing for better observability",
                compliance=["SOC2"]
            ))
        
        # Check for reserved concurrent executions (DoS protection)
        if "reserved_concurrent_executions" not in attrs:
            issues.append(SecurityIssue(
                severity="low",
                category="access_control",
                title="Lambda No Concurrency Limit",
                description=f"Lambda function '{name}' has no concurrency limit (potential DoS risk)",
                resource_type="aws_lambda_function",
                resource_name=name,
                file=file,
                line=line,
                remediation="Set reserved_concurrent_executions to prevent account-wide throttling",
                compliance=[]
            ))
        
        return issues
    
    def _check_load_balancer_security(self, attrs: Dict, name: str, file: str, line: int, resource_type: str) -> List[SecurityIssue]:
        """Check load balancer security"""
        issues = []
        
        # Check for access logs
        access_logs = attrs.get("access_logs", {})
        if not access_logs or not access_logs.get("enabled"):
            issues.append(SecurityIssue(
                severity="medium",
                category="logging",
                title="Load Balancer Access Logs Disabled",
                description=f"Load balancer '{name}' does not have access logs enabled",
                resource_type=resource_type,
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable access logs to track all requests",
                compliance=["SOC2", "PCI-DSS"]
            ))
        
        # Check for deletion protection
        if not attrs.get("enable_deletion_protection"):
            issues.append(SecurityIssue(
                severity="low",
                category="access_control",
                title="Load Balancer Deletion Protection Disabled",
                description=f"Load balancer '{name}' does not have deletion protection enabled",
                resource_type=resource_type,
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable enable_deletion_protection = true",
                compliance=[]
            ))
        
        return issues
    
    def _check_sns_security(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check SNS topic security"""
        issues = []
        
        if not attrs.get("kms_master_key_id"):
            issues.append(SecurityIssue(
                severity="medium",
                category="encryption",
                title="SNS Topic Not Encrypted",
                description=f"SNS topic '{name}' is not encrypted with KMS",
                resource_type="aws_sns_topic",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable encryption using a KMS key",
                compliance=["SOC2", "HIPAA"]
            ))
        
        return issues
    
    def _check_sqs_security(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check SQS queue security"""
        issues = []
        
        if not attrs.get("kms_master_key_id"):
            issues.append(SecurityIssue(
                severity="medium",
                category="encryption",
                title="SQS Queue Not Encrypted",
                description=f"SQS queue '{name}' is not encrypted with KMS",
                resource_type="aws_sqs_queue",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable encryption using a KMS key",
                compliance=["SOC2", "HIPAA"]
            ))
        
        return issues
    
    def _check_ecr_security(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check ECR repository security"""
        issues = []
        
        # Check for image scanning
        scan_config = attrs.get("image_scanning_configuration", {})
        if not scan_config or not scan_config.get("scan_on_push"):
            issues.append(SecurityIssue(
                severity="medium",
                category="access_control",
                title="ECR Image Scanning Disabled",
                description=f"ECR repository '{name}' does not scan images on push",
                resource_type="aws_ecr_repository",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable scan_on_push = true to detect vulnerabilities",
                compliance=["SOC2"]
            ))
        
        # Check for immutability
        if attrs.get("image_tag_mutability") != "IMMUTABLE":
            issues.append(SecurityIssue(
                severity="low",
                category="access_control",
                title="ECR Images Are Mutable",
                description=f"ECR repository '{name}' allows image tags to be overwritten",
                resource_type="aws_ecr_repository",
                resource_name=name,
                file=file,
                line=line,
                remediation="Set image_tag_mutability = IMMUTABLE to prevent tag overwriting",
                compliance=[]
            ))
        
        return issues
    
    def generate_summary(self, issues: List[SecurityIssue]) -> Dict[str, Any]:
        """Generate a summary of security findings"""
        by_severity = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        by_category = {}
        compliance_affected = set()
        
        for issue in issues:
            by_severity[issue.severity] += 1
            by_category[issue.category] = by_category.get(issue.category, 0) + 1
            compliance_affected.update(issue.compliance)
        
        # Calculate security score (100 - weighted penalties)
        score = 100
        score -= by_severity["critical"] * 20
        score -= by_severity["high"] * 10
        score -= by_severity["medium"] * 5
        score -= by_severity["low"] * 2
        score = max(0, score)
        
        return {
            "total_issues": len(issues),
            "by_severity": by_severity,
            "by_category": by_category,
            "security_score": score,
            "compliance_affected": sorted(list(compliance_affected)),
            "status": "critical" if by_severity["critical"] > 0 else
                     "warning" if by_severity["high"] > 0 else
                     "info" if by_severity["medium"] > 0 else
                     "pass"
        }
    
    # ===== DIGITALOCEAN SECURITY CHECK METHODS =====
    
    def _check_droplet_security(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check DigitalOcean Droplet security"""
        issues = []
        
        # Check if droplet is in a VPC
        if not attrs.get("vpc_uuid"):
            issues.append(SecurityIssue(
                severity="medium",
                category="network",
                title="Droplet Not in VPC",
                description=f"Droplet '{name}' is not placed in a VPC, exposing it to the public internet",
                resource_type="digitalocean_droplet",
                resource_name=name,
                file=file,
                line=line,
                remediation="Add 'vpc_uuid' to place the droplet in a private VPC network",
                compliance=["SOC2"]
            ))
        
        # Check if backups are enabled
        if not attrs.get("backups"):
            issues.append(SecurityIssue(
                severity="low",
                category="logging",
                title="Droplet Backups Disabled",
                description=f"Droplet '{name}' does not have automatic backups enabled",
                resource_type="digitalocean_droplet",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable 'backups = true' for disaster recovery",
                compliance=["SOC2"]
            ))
        
        # Check if monitoring is enabled
        if not attrs.get("monitoring"):
            issues.append(SecurityIssue(
                severity="low",
                category="logging",
                title="Droplet Monitoring Disabled",
                description=f"Droplet '{name}' does not have monitoring enabled",
                resource_type="digitalocean_droplet",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable 'monitoring = true' for visibility and alerting",
                compliance=[]
            ))
        
        # Check for SSH key usage
        if not attrs.get("ssh_keys"):
            issues.append(SecurityIssue(
                severity="high",
                category="access_control",
                title="Droplet Without SSH Keys",
                description=f"Droplet '{name}' does not have SSH keys configured, may rely on password auth",
                resource_type="digitalocean_droplet",
                resource_name=name,
                file=file,
                line=line,
                remediation="Add 'ssh_keys' to enforce key-based authentication",
                compliance=["SOC2", "PCI-DSS"]
            ))
        
        return issues
    
    def _check_do_firewall_security(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check DigitalOcean Firewall security"""
        issues = []
        
        # Check inbound rules for overly permissive access
        inbound_rules = attrs.get("inbound_rule", [])
        if isinstance(inbound_rules, dict):
            inbound_rules = [inbound_rules]
        
        sensitive_ports = {"22": "SSH", "3389": "RDP", "3306": "MySQL", "5432": "PostgreSQL", "27017": "MongoDB", "6379": "Redis"}
        
        for rule in inbound_rules:
            source_addresses = rule.get("source_addresses", [])
            port_range = str(rule.get("port_range", ""))
            
            # Check for 0.0.0.0/0 on sensitive ports
            if "0.0.0.0/0" in source_addresses or "::/0" in source_addresses:
                if port_range in sensitive_ports:
                    issues.append(SecurityIssue(
                        severity="critical",
                        category="network",
                        title=f"Firewall Exposes {sensitive_ports[port_range]} to Internet",
                        description=f"Firewall '{name}' allows {sensitive_ports[port_range]} (port {port_range}) from any IP address",
                        resource_type="digitalocean_firewall",
                        resource_name=name,
                        file=file,
                        line=line,
                        remediation=f"Restrict source_addresses to specific IPs or use a VPN for {sensitive_ports[port_range]} access",
                        compliance=["SOC2", "HIPAA", "PCI-DSS"]
                    ))
                elif port_range == "all" or port_range == "1-65535":
                    issues.append(SecurityIssue(
                        severity="critical",
                        category="network",
                        title="Firewall Allows All Ports from Internet",
                        description=f"Firewall '{name}' allows all ports from any IP address",
                        resource_type="digitalocean_firewall",
                        resource_name=name,
                        file=file,
                        line=line,
                        remediation="Restrict to only necessary ports and source IPs",
                        compliance=["SOC2", "HIPAA", "PCI-DSS"]
                    ))
        
        return issues
    
    def _check_spaces_security(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check DigitalOcean Spaces bucket security"""
        issues = []
        
        # Check for public ACL
        acl = attrs.get("acl", "")
        if acl in ["public-read", "public-read-write"]:
            issues.append(SecurityIssue(
                severity="critical",
                category="access_control",
                title="Spaces Bucket Is Public",
                description=f"Spaces bucket '{name}' has public ACL: {acl}",
                resource_type="digitalocean_spaces_bucket",
                resource_name=name,
                file=file,
                line=line,
                remediation="Remove public ACL. Use 'private' ACL and signed URLs for access",
                compliance=["SOC2", "HIPAA", "PCI-DSS"]
            ))
        
        # Check for CORS configuration (may indicate public access)
        cors_rules = attrs.get("cors_rule", [])
        for rule in cors_rules if isinstance(cors_rules, list) else [cors_rules]:
            if rule and "*" in rule.get("allowed_origins", []):
                issues.append(SecurityIssue(
                    severity="medium",
                    category="access_control",
                    title="Spaces CORS Allows All Origins",
                    description=f"Spaces bucket '{name}' CORS allows requests from any origin",
                    resource_type="digitalocean_spaces_bucket",
                    resource_name=name,
                    file=file,
                    line=line,
                    remediation="Restrict allowed_origins to specific domains",
                    compliance=["SOC2"]
                ))
        
        return issues
    
    def _check_do_database_security(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check DigitalOcean Database Cluster security"""
        issues = []
        
        # Check if database is in a private network
        if not attrs.get("private_network_uuid"):
            issues.append(SecurityIssue(
                severity="critical",
                category="network",
                title="Database Cluster Publicly Accessible",
                description=f"Database cluster '{name}' is accessible from the public internet",
                resource_type="digitalocean_database_cluster",
                resource_name=name,
                file=file,
                line=line,
                remediation="Add 'private_network_uuid' to restrict database access to VPC only",
                compliance=["SOC2", "HIPAA", "PCI-DSS"]
            ))
        
        # Check for maintenance window
        if not attrs.get("maintenance_window"):
            issues.append(SecurityIssue(
                severity="low",
                category="logging",
                title="Database Without Maintenance Window",
                description=f"Database cluster '{name}' does not have a maintenance window configured",
                resource_type="digitalocean_database_cluster",
                resource_name=name,
                file=file,
                line=line,
                remediation="Add 'maintenance_window' block to control when updates occur",
                compliance=[]
            ))
        
        # Check for SSL requirement (for PostgreSQL)
        engine = attrs.get("engine", "")
        if engine in ["pg", "mysql"] and not attrs.get("eviction_policy"):
            # Note: DO databases have SSL by default, but we check for trusted sources
            trusted_sources = attrs.get("database_firewall_rules", [])
            if not trusted_sources:
                issues.append(SecurityIssue(
                    severity="medium",
                    category="access_control",
                    title="Database Without Firewall Rules",
                    description=f"Database cluster '{name}' does not have firewall rules to restrict access",
                    resource_type="digitalocean_database_cluster",
                    resource_name=name,
                    file=file,
                    line=line,
                    remediation="Add 'database_firewall_rules' to restrict which resources can connect",
                    compliance=["SOC2"]
                ))
        
        return issues
    
    def _check_do_kubernetes_security(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check DigitalOcean Kubernetes Cluster security"""
        issues = []
        
        # Check for auto-upgrade
        if not attrs.get("auto_upgrade"):
            issues.append(SecurityIssue(
                severity="medium",
                category="access_control",
                title="Kubernetes Cluster Without Auto-Upgrade",
                description=f"Kubernetes cluster '{name}' does not have auto-upgrade enabled",
                resource_type="digitalocean_kubernetes_cluster",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable 'auto_upgrade = true' to receive security patches automatically",
                compliance=["SOC2"]
            ))
        
        # Check for surge upgrade
        if not attrs.get("surge_upgrade"):
            issues.append(SecurityIssue(
                severity="low",
                category="logging",
                title="Kubernetes Cluster Without Surge Upgrade",
                description=f"Kubernetes cluster '{name}' does not have surge upgrade enabled for zero-downtime updates",
                resource_type="digitalocean_kubernetes_cluster",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable 'surge_upgrade = true' for zero-downtime node upgrades",
                compliance=[]
            ))
        
        # Check if cluster is in VPC
        if not attrs.get("vpc_uuid"):
            issues.append(SecurityIssue(
                severity="medium",
                category="network",
                title="Kubernetes Cluster Not in VPC",
                description=f"Kubernetes cluster '{name}' is not placed in a VPC",
                resource_type="digitalocean_kubernetes_cluster",
                resource_name=name,
                file=file,
                line=line,
                remediation="Add 'vpc_uuid' to place the cluster in a private VPC network",
                compliance=["SOC2"]
            ))
        
        return issues
    
    def _check_do_loadbalancer_security(self, attrs: Dict, name: str, file: str, line: int) -> List[SecurityIssue]:
        """Check DigitalOcean Load Balancer security"""
        issues = []
        
        # Check forwarding rules for HTTPS
        forwarding_rules = attrs.get("forwarding_rule", [])
        if isinstance(forwarding_rules, dict):
            forwarding_rules = [forwarding_rules]
        
        has_https = False
        has_insecure_http = False
        
        for rule in forwarding_rules:
            entry_protocol = rule.get("entry_protocol", "")
            entry_port = rule.get("entry_port", 0)
            
            if entry_protocol == "https":
                has_https = True
            elif entry_protocol == "http" and entry_port == 80:
                has_insecure_http = True
        
        if has_insecure_http and not has_https:
            issues.append(SecurityIssue(
                severity="high",
                category="encryption",
                title="Load Balancer Without HTTPS",
                description=f"Load balancer '{name}' serves HTTP traffic but has no HTTPS configured",
                resource_type="digitalocean_loadbalancer",
                resource_name=name,
                file=file,
                line=line,
                remediation="Add HTTPS forwarding rule with TLS certificate",
                compliance=["SOC2", "HIPAA", "PCI-DSS"]
            ))
        
        # Check for sticky sessions without secure cookies
        if attrs.get("sticky_sessions") and not attrs.get("redirect_http_to_https"):
            issues.append(SecurityIssue(
                severity="medium",
                category="encryption",
                title="Load Balancer Sticky Sessions Without HTTPS Redirect",
                description=f"Load balancer '{name}' has sticky sessions but doesn't force HTTPS",
                resource_type="digitalocean_loadbalancer",
                resource_name=name,
                file=file,
                line=line,
                remediation="Enable 'redirect_http_to_https = true' to ensure session cookies are sent over HTTPS",
                compliance=["SOC2"]
            ))
        
        # Check health check configuration
        healthcheck = attrs.get("healthcheck")
        if not healthcheck:
            issues.append(SecurityIssue(
                severity="low",
                category="logging",
                title="Load Balancer Without Health Check",
                description=f"Load balancer '{name}' does not have a health check configured",
                resource_type="digitalocean_loadbalancer",
                resource_name=name,
                file=file,
                line=line,
                remediation="Add 'healthcheck' block to detect unhealthy targets",
                compliance=[]
            ))
        
        return issues


# Global instance
security_scanner = SecurityScanner()

