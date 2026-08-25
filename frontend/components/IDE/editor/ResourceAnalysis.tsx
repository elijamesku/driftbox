'use client'

/**
 * Resource Analysis Panel
 * Shows cost estimates, security checks, and dependencies for Terraform resources
 */

import { useState, useEffect } from 'react'
import { X, DollarSign, Shield, GitBranch, AlertTriangle, CheckCircle, Info, Loader2, ExternalLink } from 'lucide-react'
import { getApiEndpoint } from '@/utils/apiEndpoint'

// Cost estimates for common resources (monthly USD)
const RESOURCE_COSTS: Record<string, { base: number; unit: string; notes: string }> = {
  // AWS Compute
  'aws_instance': { base: 8.50, unit: '/month (t2.micro)', notes: 'Varies by instance type. t2.micro is free tier eligible.' },
  'aws_launch_template': { base: 0, unit: '/month', notes: 'Launch templates are free. You pay for instances launched.' },
  'aws_autoscaling_group': { base: 0, unit: '/month', notes: 'Auto Scaling is free. You pay for EC2 instances.' },
  'aws_lambda_function': { base: 0.20, unit: '/1M requests', notes: 'Plus $0.0000166667/GB-second. Free tier: 1M requests/month.' },
  'aws_ecs_cluster': { base: 0, unit: '/month', notes: 'ECS cluster is free. You pay for EC2/Fargate resources.' },
  'aws_ecs_service': { base: 0, unit: '/month', notes: 'ECS services are free. You pay for underlying compute.' },
  'aws_ecs_task_definition': { base: 0, unit: '/month', notes: 'Task definitions are free.' },
  'aws_eks_cluster': { base: 73.00, unit: '/month', notes: 'Control plane cost. Plus node costs.' },
  'aws_eks_node_group': { base: 8.50, unit: '/node/month (t3.micro)', notes: 'Varies by instance type.' },
  
  // AWS Storage
  'aws_s3_bucket': { base: 0.023, unit: '/GB/month', notes: 'Standard storage. Plus request costs ($0.0004/1K requests).' },
  'aws_s3_bucket_policy': { base: 0, unit: '/month', notes: 'Bucket policies are free.' },
  'aws_s3_bucket_versioning': { base: 0, unit: '/month', notes: 'Versioning config is free. You pay for stored versions.' },
  'aws_s3_object': { base: 0.023, unit: '/GB/month', notes: 'Standard storage rate.' },
  'aws_ebs_volume': { base: 0.10, unit: '/GB/month', notes: 'gp2 storage. gp3 is $0.08/GB.' },
  'aws_efs_file_system': { base: 0.30, unit: '/GB/month', notes: 'Standard storage class. Infrequent Access is $0.016/GB.' },
  
  // AWS Networking
  'aws_vpc': { base: 0, unit: '/month', notes: 'VPCs are free. NAT Gateways and VPN connections cost extra.' },
  'aws_subnet': { base: 0, unit: '/month', notes: 'Subnets are free.' },
  'aws_internet_gateway': { base: 0, unit: '/month', notes: 'Internet Gateways are free. You pay for data transfer.' },
  'aws_nat_gateway': { base: 32.40, unit: '/month', notes: 'Plus $0.045/GB data processed.' },
  'aws_route_table': { base: 0, unit: '/month', notes: 'Route tables are free.' },
  'aws_route': { base: 0, unit: '/month', notes: 'Routes are free.' },
  'aws_route_table_association': { base: 0, unit: '/month', notes: 'Associations are free.' },
  'aws_elastic_ip': { base: 3.60, unit: '/month (if unused)', notes: 'Free when attached to running instance.' },
  'aws_lb': { base: 16.20, unit: '/month', notes: 'Application Load Balancer. Plus $0.008/LCU-hour.' },
  'aws_lb_target_group': { base: 0, unit: '/month', notes: 'Target groups are free.' },
  'aws_lb_listener': { base: 0, unit: '/month', notes: 'Listeners are free.' },
  'aws_route53_zone': { base: 0.50, unit: '/hosted zone/month', notes: 'Plus $0.40/1M queries.' },
  'aws_route53_record': { base: 0, unit: '/month', notes: 'Records are free. Zone charges apply.' },
  'aws_cloudfront_distribution': { base: 0, unit: '/month', notes: 'Pay per request: $0.0085-0.02/10K requests + data transfer.' },
  'aws_api_gateway_rest_api': { base: 0, unit: '/month', notes: '$3.50/1M requests. First 1M free for 12 months.' },
  
  // AWS Security
  'aws_security_group': { base: 0, unit: '/month', notes: 'Security groups are free.' },
  'aws_security_group_rule': { base: 0, unit: '/month', notes: 'Rules are free.' },
  'aws_iam_role': { base: 0, unit: '/month', notes: 'IAM is free.' },
  'aws_iam_policy': { base: 0, unit: '/month', notes: 'IAM policies are free.' },
  'aws_iam_role_policy_attachment': { base: 0, unit: '/month', notes: 'Attachments are free.' },
  'aws_iam_user': { base: 0, unit: '/month', notes: 'IAM users are free.' },
  'aws_iam_instance_profile': { base: 0, unit: '/month', notes: 'Instance profiles are free.' },
  'aws_kms_key': { base: 1.00, unit: '/key/month', notes: 'Plus $0.03/10K requests.' },
  'aws_secretsmanager_secret': { base: 0.40, unit: '/secret/month', notes: 'Plus $0.05/10K API calls.' },
  'aws_acm_certificate': { base: 0, unit: '/month', notes: 'Public SSL/TLS certificates are free.' },
  
  // AWS Database
  'aws_db_instance': { base: 12.50, unit: '/month (db.t3.micro)', notes: 'Single-AZ. Multi-AZ doubles cost.' },
  'aws_rds_instance': { base: 12.50, unit: '/month (db.t3.micro)', notes: 'Single-AZ. Multi-AZ doubles cost.' },
  'aws_db_subnet_group': { base: 0, unit: '/month', notes: 'Subnet groups are free.' },
  'aws_rds_cluster': { base: 29.00, unit: '/month (db.t3.small)', notes: 'Aurora Serverless v2 starts at $0.12/ACU-hour.' },
  'aws_dynamodb_table': { base: 0, unit: '/month', notes: 'On-demand: $1.25/1M writes, $0.25/1M reads. Free tier: 25GB.' },
  'aws_elasticache_cluster': { base: 12.50, unit: '/month (cache.t3.micro)', notes: 'Varies by node type and engine.' },
  
  // AWS Monitoring
  'aws_cloudwatch_log_group': { base: 0.50, unit: '/GB ingested', notes: 'Plus $0.03/GB stored after 5GB.' },
  'aws_cloudwatch_metric_alarm': { base: 0.10, unit: '/alarm/month', notes: 'Standard resolution. High-res is $0.30/alarm.' },
  'aws_sns_topic': { base: 0, unit: '/month', notes: '$0.50/1M requests. First 1M free.' },
  'aws_sqs_queue': { base: 0, unit: '/month', notes: '$0.40/1M requests. First 1M free.' },
  
  // DigitalOcean Compute
  'digitalocean_droplet': { base: 4.00, unit: '/month (s-1vcpu-512mb)', notes: 'Smallest size. Larger sizes cost more.' },
  'digitalocean_kubernetes_cluster': { base: 0, unit: '/month', notes: 'Control plane is free. You pay for worker nodes.' },
  'digitalocean_kubernetes_node_pool': { base: 12.00, unit: '/node/month (s-1vcpu-2gb)', notes: 'Varies by droplet size.' },
  'digitalocean_app': { base: 5.00, unit: '/month (basic)', notes: 'App Platform pricing varies by resources.' },
  
  // DigitalOcean Storage
  'digitalocean_spaces_bucket': { base: 5.00, unit: '/month (250GB)', notes: 'Includes 250GB storage + 1TB transfer.' },
  'digitalocean_spaces_bucket_object': { base: 0, unit: '/month', notes: 'Objects count toward bucket storage.' },
  'digitalocean_volume': { base: 0.10, unit: '/GB/month', notes: 'Block storage volumes.' },
  'digitalocean_volume_attachment': { base: 0, unit: '/month', notes: 'Attachments are free.' },
  
  // DigitalOcean Networking
  'digitalocean_loadbalancer': { base: 12.00, unit: '/month', notes: 'Includes 10k connections/min.' },
  'digitalocean_vpc': { base: 0, unit: '/month', notes: 'VPCs are free.' },
  'digitalocean_domain': { base: 0, unit: '/month', notes: 'DNS management is free.' },
  'digitalocean_record': { base: 0, unit: '/month', notes: 'DNS records are free.' },
  'digitalocean_floating_ip': { base: 4.00, unit: '/month (if unused)', notes: 'Free when attached to a Droplet.' },
  'digitalocean_reserved_ip': { base: 4.00, unit: '/month (if unused)', notes: 'Free when attached to a Droplet.' },
  'digitalocean_cdn': { base: 0, unit: '/month', notes: 'Free for Spaces. Pay for bandwidth over 1TB.' },
  
  // DigitalOcean Security
  'digitalocean_firewall': { base: 0, unit: '/month', notes: 'Cloud Firewalls are free.' },
  'digitalocean_ssh_key': { base: 0, unit: '/month', notes: 'SSH keys are free.' },
  'digitalocean_certificate': { base: 0, unit: '/month', notes: 'Certificates are free (including Let\'s Encrypt).' },
  
  // DigitalOcean Database
  'digitalocean_database_cluster': { base: 15.00, unit: '/month (db-s-1vcpu-1gb)', notes: 'Smallest managed database.' },
  'digitalocean_database_db': { base: 0, unit: '/month', notes: 'Databases within cluster are free.' },
  'digitalocean_database_user': { base: 0, unit: '/month', notes: 'Database users are free.' },
  'digitalocean_database_firewall': { base: 0, unit: '/month', notes: 'Database firewalls are free.' },
  'digitalocean_database_replica': { base: 15.00, unit: '/month (db-s-1vcpu-1gb)', notes: 'Same price as primary node.' },
  
  // DigitalOcean Monitoring
  'digitalocean_monitor_alert': { base: 0, unit: '/month', notes: 'Monitoring alerts are free.' },
  'digitalocean_uptime_check': { base: 0, unit: '/month', notes: 'Uptime checks are free.' },
  'digitalocean_uptime_alert': { base: 0, unit: '/month', notes: 'Uptime alerts are free.' },
  
  // DigitalOcean Management
  'digitalocean_project': { base: 0, unit: '/month', notes: 'Projects are free.' },
  'digitalocean_tag': { base: 0, unit: '/month', notes: 'Tags are free.' },
}

// Security rules by resource type
const SECURITY_RULES: Record<string, { id: string; severity: 'high' | 'medium' | 'low'; check: (block: string) => boolean; message: string; fix: string }[]> = {
  // AWS S3
  'aws_s3_bucket': [
    {
      id: 'S3_PUBLIC_ACL',
      severity: 'high',
      check: (block) => /acl\s*=\s*"public-read"/.test(block) || /acl\s*=\s*"public-read-write"/.test(block),
      message: 'S3 bucket has public ACL enabled',
      fix: 'Set acl = "private" or remove the acl attribute'
    },
    {
      id: 'S3_NO_VERSIONING',
      severity: 'medium',
      check: (block) => !/versioning\s*{/.test(block),
      message: 'S3 bucket versioning is not enabled',
      fix: 'Add versioning { enabled = true } block'
    },
    {
      id: 'S3_NO_ENCRYPTION',
      severity: 'medium',
      check: (block) => !/server_side_encryption_configuration/.test(block),
      message: 'S3 bucket encryption is not configured',
      fix: 'Add server_side_encryption_configuration block'
    }
  ],
  
  // AWS Security Group
  'aws_security_group': [
    {
      id: 'SG_OPEN_INGRESS',
      severity: 'high',
      check: (block) => /cidr_blocks\s*=\s*\[\s*"0\.0\.0\.0\/0"\s*\]/.test(block) && /from_port\s*=\s*0/.test(block),
      message: 'Security group allows all traffic from anywhere',
      fix: 'Restrict cidr_blocks to specific IPs or ranges'
    },
    {
      id: 'SG_SSH_OPEN',
      severity: 'high',
      check: (block) => /from_port\s*=\s*22/.test(block) && /cidr_blocks\s*=\s*\[\s*"0\.0\.0\.0\/0"\s*\]/.test(block),
      message: 'SSH (port 22) is open to the world',
      fix: 'Restrict SSH access to specific IPs'
    },
    {
      id: 'SG_RDP_OPEN',
      severity: 'high',
      check: (block) => /from_port\s*=\s*3389/.test(block) && /cidr_blocks\s*=\s*\[\s*"0\.0\.0\.0\/0"\s*\]/.test(block),
      message: 'RDP (port 3389) is open to the world',
      fix: 'Restrict RDP access to specific IPs'
    },
    {
      id: 'SG_DB_OPEN',
      severity: 'high',
      check: (block) => /(from_port\s*=\s*3306|from_port\s*=\s*5432|from_port\s*=\s*1433)/.test(block) && /cidr_blocks\s*=\s*\[\s*"0\.0\.0\.0\/0"\s*\]/.test(block),
      message: 'Database port is open to the world',
      fix: 'Restrict database access to specific IPs or security groups'
    }
  ],
  
  // AWS EC2
  'aws_instance': [
    {
      id: 'EC2_NO_METADATA_HOP',
      severity: 'medium',
      check: (block) => !/http_put_response_hop_limit\s*=\s*1/.test(block),
      message: 'Instance metadata hop limit not restricted',
      fix: 'Add metadata_options { http_put_response_hop_limit = 1 }'
    },
    {
      id: 'EC2_PUBLIC_IP',
      severity: 'low',
      check: (block) => /associate_public_ip_address\s*=\s*true/.test(block),
      message: 'Instance has public IP address',
      fix: 'Consider using a bastion host or VPN instead'
    },
    {
      id: 'EC2_NO_IAM_PROFILE',
      severity: 'medium',
      check: (block) => !/iam_instance_profile/.test(block),
      message: 'Instance has no IAM instance profile',
      fix: 'Add iam_instance_profile for secure AWS API access'
    }
  ],
  
  // AWS RDS
  'aws_rds_instance': [
    {
      id: 'RDS_PUBLIC',
      severity: 'high',
      check: (block) => /publicly_accessible\s*=\s*true/.test(block),
      message: 'RDS instance is publicly accessible',
      fix: 'Set publicly_accessible = false'
    },
    {
      id: 'RDS_NO_ENCRYPTION',
      severity: 'high',
      check: (block) => !/storage_encrypted\s*=\s*true/.test(block),
      message: 'RDS storage encryption is not enabled',
      fix: 'Add storage_encrypted = true'
    },
    {
      id: 'RDS_NO_BACKUP',
      severity: 'medium',
      check: (block) => /backup_retention_period\s*=\s*0/.test(block),
      message: 'RDS backups are disabled',
      fix: 'Set backup_retention_period to at least 7'
    }
  ],
  'aws_db_instance': [
    {
      id: 'RDS_PUBLIC',
      severity: 'high',
      check: (block) => /publicly_accessible\s*=\s*true/.test(block),
      message: 'RDS instance is publicly accessible',
      fix: 'Set publicly_accessible = false'
    },
    {
      id: 'RDS_NO_ENCRYPTION',
      severity: 'high',
      check: (block) => !/storage_encrypted\s*=\s*true/.test(block),
      message: 'RDS storage encryption is not enabled',
      fix: 'Add storage_encrypted = true'
    },
    {
      id: 'RDS_NO_BACKUP',
      severity: 'medium',
      check: (block) => /backup_retention_period\s*=\s*0/.test(block),
      message: 'RDS backups are disabled',
      fix: 'Set backup_retention_period to at least 7'
    },
    {
      id: 'RDS_NO_MULTI_AZ',
      severity: 'low',
      check: (block) => !/multi_az\s*=\s*true/.test(block),
      message: 'RDS is not configured for Multi-AZ deployment',
      fix: 'Add multi_az = true for high availability'
    }
  ],
  
  // AWS Lambda
  'aws_lambda_function': [
    {
      id: 'LAMBDA_NO_VPC',
      severity: 'low',
      check: (block) => !/vpc_config/.test(block),
      message: 'Lambda function is not in a VPC',
      fix: 'Add vpc_config to run in a VPC for network isolation'
    },
    {
      id: 'LAMBDA_HIGH_TIMEOUT',
      severity: 'low',
      check: (block) => /timeout\s*=\s*(\d{3,})/.test(block),
      message: 'Lambda timeout is very high (>100s)',
      fix: 'Consider reducing timeout to prevent runaway executions'
    }
  ],
  
  // AWS EKS
  'aws_eks_cluster': [
    {
      id: 'EKS_PUBLIC_ENDPOINT',
      severity: 'medium',
      check: (block) => /endpoint_public_access\s*=\s*true/.test(block) && !/endpoint_private_access\s*=\s*true/.test(block),
      message: 'EKS cluster has only public endpoint enabled',
      fix: 'Enable endpoint_private_access = true and consider disabling public access'
    },
    {
      id: 'EKS_NO_LOGGING',
      severity: 'medium',
      check: (block) => !/enabled_cluster_log_types/.test(block),
      message: 'EKS cluster logging is not enabled',
      fix: 'Add enabled_cluster_log_types = ["api", "audit", "authenticator"]'
    }
  ],
  
  // AWS KMS
  'aws_kms_key': [
    {
      id: 'KMS_NO_ROTATION',
      severity: 'medium',
      check: (block) => !/enable_key_rotation\s*=\s*true/.test(block),
      message: 'KMS key rotation is not enabled',
      fix: 'Add enable_key_rotation = true'
    }
  ],
  
  // AWS IAM
  'aws_iam_policy': [
    {
      id: 'IAM_WILDCARD_ACTION',
      severity: 'high',
      check: (block) => /"Action"\s*:\s*"\*"/.test(block) || /"Action"\s*:\s*\[\s*"\*"\s*\]/.test(block),
      message: 'IAM policy has wildcard (*) action',
      fix: 'Specify explicit actions instead of using "*"'
    },
    {
      id: 'IAM_WILDCARD_RESOURCE',
      severity: 'medium',
      check: (block) => /"Resource"\s*:\s*"\*"/.test(block),
      message: 'IAM policy has wildcard (*) resource',
      fix: 'Specify explicit resources instead of using "*"'
    }
  ],
  
  // AWS EBS
  'aws_ebs_volume': [
    {
      id: 'EBS_NO_ENCRYPTION',
      severity: 'high',
      check: (block) => !/encrypted\s*=\s*true/.test(block),
      message: 'EBS volume is not encrypted',
      fix: 'Add encrypted = true'
    }
  ],
  
  // AWS ELB
  'aws_lb': [
    {
      id: 'ALB_NO_ACCESS_LOGS',
      severity: 'medium',
      check: (block) => !/access_logs/.test(block),
      message: 'Load balancer access logs are not enabled',
      fix: 'Add access_logs block to enable logging'
    },
    {
      id: 'ALB_INTERNAL_FALSE',
      severity: 'low',
      check: (block) => /internal\s*=\s*false/.test(block),
      message: 'Load balancer is internet-facing',
      fix: 'Consider if internal = true is more appropriate'
    }
  ],
  
  // AWS CloudFront
  'aws_cloudfront_distribution': [
    {
      id: 'CF_NO_WAF',
      severity: 'medium',
      check: (block) => !/web_acl_id/.test(block),
      message: 'CloudFront distribution has no WAF protection',
      fix: 'Add web_acl_id to associate a WAF ACL'
    },
    {
      id: 'CF_HTTP_ALLOWED',
      severity: 'medium',
      check: (block) => /viewer_protocol_policy\s*=\s*"allow-all"/.test(block),
      message: 'CloudFront allows HTTP connections',
      fix: 'Set viewer_protocol_policy = "redirect-to-https"'
    }
  ],
  
  // AWS DynamoDB
  'aws_dynamodb_table': [
    {
      id: 'DYNAMO_NO_ENCRYPTION',
      severity: 'medium',
      check: (block) => !/server_side_encryption/.test(block),
      message: 'DynamoDB table encryption not explicitly configured',
      fix: 'Add server_side_encryption { enabled = true } for explicit encryption'
    },
    {
      id: 'DYNAMO_NO_PITR',
      severity: 'medium',
      check: (block) => !/point_in_time_recovery/.test(block),
      message: 'DynamoDB point-in-time recovery is not enabled',
      fix: 'Add point_in_time_recovery { enabled = true }'
    }
  ],
  
  // DigitalOcean Droplet
  'digitalocean_droplet': [
    {
      id: 'DO_NO_VPC',
      severity: 'medium',
      check: (block) => !/vpc_uuid/.test(block),
      message: 'Droplet is not in a VPC',
      fix: 'Add vpc_uuid to isolate the droplet'
    },
    {
      id: 'DO_NO_SSH_KEYS',
      severity: 'high',
      check: (block) => !/ssh_keys/.test(block),
      message: 'Droplet has no SSH keys configured',
      fix: 'Add ssh_keys to enable secure access'
    },
    {
      id: 'DO_NO_BACKUPS',
      severity: 'medium',
      check: (block) => !/backups\s*=\s*true/.test(block),
      message: 'Droplet backups are not enabled',
      fix: 'Add backups = true for automated backups'
    }
  ],
  
  // DigitalOcean Spaces
  'digitalocean_spaces_bucket': [
    {
      id: 'SPACES_PUBLIC',
      severity: 'high',
      check: (block) => /acl\s*=\s*"public-read"/.test(block),
      message: 'Spaces bucket is publicly readable',
      fix: 'Set acl = "private"'
    }
  ],
  
  // DigitalOcean Database
  'digitalocean_database_cluster': [
    {
      id: 'DO_DB_NO_VPC',
      severity: 'medium',
      check: (block) => !/private_network_uuid/.test(block),
      message: 'Database cluster is not in a private network',
      fix: 'Add private_network_uuid for network isolation'
    }
  ],
  
  // DigitalOcean Kubernetes
  'digitalocean_kubernetes_cluster': [
    {
      id: 'DO_K8S_NO_VPC',
      severity: 'medium',
      check: (block) => !/vpc_uuid/.test(block),
      message: 'Kubernetes cluster is not in a VPC',
      fix: 'Add vpc_uuid for network isolation'
    },
    {
      id: 'DO_K8S_AUTO_UPGRADE',
      severity: 'low',
      check: (block) => /auto_upgrade\s*=\s*false/.test(block),
      message: 'Kubernetes auto-upgrade is disabled',
      fix: 'Consider enabling auto_upgrade = true for security patches'
    }
  ],
  
  // DigitalOcean Firewall
  'digitalocean_firewall': [
    {
      id: 'DO_FW_OPEN_INGRESS',
      severity: 'high',
      check: (block) => /source_addresses\s*=\s*\[\s*"0\.0\.0\.0\/0"[^}]*port_range\s*=\s*"1-65535"/.test(block),
      message: 'Firewall allows all traffic from anywhere',
      fix: 'Restrict source_addresses and port_range'
    },
    {
      id: 'DO_FW_SSH_OPEN',
      severity: 'high',
      check: (block) => /port_range\s*=\s*"22"[^}]*source_addresses\s*=\s*\[\s*"0\.0\.0\.0\/0"/.test(block) || /source_addresses\s*=\s*\[\s*"0\.0\.0\.0\/0"[^}]*port_range\s*=\s*"22"/.test(block),
      message: 'SSH is open to the world',
      fix: 'Restrict SSH access to specific IPs'
    }
  ],
  
  // DigitalOcean Load Balancer
  'digitalocean_loadbalancer': [
    {
      id: 'DO_LB_NO_HEALTHCHECK',
      severity: 'medium',
      check: (block) => !/healthcheck/.test(block),
      message: 'Load balancer has no health check configured',
      fix: 'Add healthcheck block for proper health monitoring'
    },
    {
      id: 'DO_LB_HTTP_ONLY',
      severity: 'medium',
      check: (block) => /entry_protocol\s*=\s*"http"/.test(block) && !/entry_protocol\s*=\s*"https"/.test(block),
      message: 'Load balancer only accepts HTTP (no HTTPS)',
      fix: 'Add HTTPS forwarding rule with a certificate'
    }
  ]
}

interface ResourceAnalysisProps {
  type: 'cost' | 'security' | 'dependencies'
  resourceType: string
  resourceName: string
  resourceBlock?: string
  allCode?: string
  onClose: () => void
}

export default function ResourceAnalysis({
  type,
  resourceType,
  resourceName,
  resourceBlock = '',
  allCode = '',
  onClose
}: ResourceAnalysisProps) {
  const [loading, setLoading] = useState(false)
  
  // Cost analysis
  const costInfo = RESOURCE_COSTS[resourceType]
  
  // Security analysis
  const securityRules = SECURITY_RULES[resourceType] || []
  const securityFindings = securityRules
    .filter(rule => rule.check(resourceBlock))
    .map(rule => ({
      id: rule.id,
      severity: rule.severity,
      message: rule.message,
      fix: rule.fix
    }))
  
  // Dependency analysis - find references in the code
  const findDependencies = () => {
    const resourceAddress = `${resourceType}.${resourceName}`
    const dependencies: { type: 'uses' | 'used-by'; resource: string; attribute?: string }[] = []
    
    // Find what this resource references (uses)
    const refPattern = /\$\{([a-z_]+\.[a-z0-9_]+)\.([a-z_]+)\}|([a-z_]+\.[a-z0-9_]+)\.([a-z_]+)/gi
    let match
    while ((match = refPattern.exec(resourceBlock)) !== null) {
      const ref = match[1] || match[3]
      const attr = match[2] || match[4]
      if (ref && ref !== resourceAddress) {
        dependencies.push({ type: 'uses', resource: ref, attribute: attr })
      }
    }
    
    // Find what uses this resource (used-by)
    const addressPattern = new RegExp(`${resourceType}\\.${resourceName}\\.(\\w+)`, 'g')
    const codeWithoutThisResource = allCode.replace(resourceBlock, '')
    while ((match = addressPattern.exec(codeWithoutThisResource)) !== null) {
      // Find which resource block contains this reference
      const beforeMatch = codeWithoutThisResource.substring(0, match.index)
      const resourceDefMatch = beforeMatch.match(/resource\s+"([^"]+)"\s+"([^"]+)"\s*\{[^}]*$/s)
      if (resourceDefMatch) {
        dependencies.push({ 
          type: 'used-by', 
          resource: `${resourceDefMatch[1]}.${resourceDefMatch[2]}`,
          attribute: match[1]
        })
      }
    }
    
    return dependencies
  }
  
  const dependencies = type === 'dependencies' ? findDependencies() : []
  const usesResources = dependencies.filter(d => d.type === 'uses')
  const usedByResources = dependencies.filter(d => d.type === 'used-by')
  
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'text-red-400 bg-red-500/20'
      case 'medium': return 'text-amber-400 bg-amber-500/20'
      case 'low': return 'text-blue-400 bg-blue-500/20'
      default: return 'text-white/60 bg-white/10'
    }
  }
  
  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'high': return <AlertTriangle className="w-4 h-4" />
      case 'medium': return <Info className="w-4 h-4" />
      case 'low': return <Info className="w-4 h-4" />
      default: return <CheckCircle className="w-4 h-4" />
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-black/95 border border-white/10 rounded-2xl shadow-2xl w-[550px] max-h-[80vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              type === 'cost' ? 'bg-emerald-500/20 text-emerald-400' :
              type === 'security' ? 'bg-orange-500/20 text-orange-400' :
              'bg-purple-500/20 text-purple-400'
            }`}>
              {type === 'cost' && <DollarSign className="w-5 h-5" />}
              {type === 'security' && <Shield className="w-5 h-5" />}
              {type === 'dependencies' && <GitBranch className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                {type === 'cost' && 'Cost Estimate'}
                {type === 'security' && 'Security Check'}
                {type === 'dependencies' && 'Dependencies'}
              </h2>
              <p className="text-xs text-white/40 font-mono">{resourceType}.{resourceName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-4 h-4 text-white/40" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-5 overflow-y-auto max-h-[calc(80vh-140px)]">
          {/* Cost Analysis */}
          {type === 'cost' && (
            <div className="space-y-4">
              {costInfo ? (
                <>
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-3xl font-bold text-emerald-400">
                        ${costInfo.base.toFixed(2)}
                      </span>
                      <span className="text-sm text-emerald-300/70">{costInfo.unit}</span>
                    </div>
                    <p className="text-sm text-white/60">{costInfo.notes}</p>
                  </div>
                  
                  <div className="p-3 bg-white/5 rounded-xl">
                    <p className="text-xs text-white/40 mb-2">Cost factors that may affect pricing:</p>
                    <ul className="text-xs text-white/60 space-y-1">
                      <li>• Region selection</li>
                      <li>• Reserved vs on-demand pricing</li>
                      <li>• Data transfer costs</li>
                      <li>• Additional features enabled</li>
                    </ul>
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <p className="text-white/60">No cost estimate available for this resource type.</p>
                  <p className="text-sm text-white/40 mt-2">Check the provider's pricing page for details.</p>
                </div>
              )}
            </div>
          )}
          
          {/* Security Analysis */}
          {type === 'security' && (
            <div className="space-y-4">
              {securityFindings.length > 0 ? (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      securityFindings.some(f => f.severity === 'high') 
                        ? 'bg-red-500/20 text-red-400' 
                        : securityFindings.some(f => f.severity === 'medium')
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-blue-500/20 text-blue-400'
                    }`}>
                      {securityFindings.length} issue{securityFindings.length !== 1 ? 's' : ''} found
                    </span>
                  </div>
                  
                  <div className="space-y-3">
                    {securityFindings.map((finding, idx) => (
                      <div key={idx} className="p-4 bg-white/5 border border-white/10 rounded-xl">
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg ${getSeverityColor(finding.severity)}`}>
                            {getSeverityIcon(finding.severity)}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-xs uppercase font-medium px-1.5 py-0.5 rounded ${getSeverityColor(finding.severity)}`}>
                                {finding.severity}
                              </span>
                              <span className="text-xs text-white/40 font-mono">{finding.id}</span>
                            </div>
                            <p className="text-sm text-white/90 mb-2">{finding.message}</p>
                            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                              <p className="text-xs text-emerald-300">
                                <strong>Fix:</strong> {finding.fix}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 mx-auto mb-4 flex items-center justify-center">
                    <CheckCircle className="w-8 h-8 text-emerald-400" />
                  </div>
                  <p className="text-emerald-400 font-medium">No security issues found!</p>
                  <p className="text-sm text-white/40 mt-2">This resource follows security best practices.</p>
                </div>
              )}
            </div>
          )}
          
          {/* Dependency Analysis */}
          {type === 'dependencies' && (
            <div className="space-y-5">
              {/* Uses */}
              <div>
                <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
                  This resource uses ({usesResources.length})
                </h3>
                {usesResources.length > 0 ? (
                  <div className="space-y-2">
                    {usesResources.map((dep, idx) => (
                      <div key={idx} className="p-3 bg-white/5 border border-white/10 rounded-xl flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-purple-400" />
                        <code className="text-sm text-purple-300">{dep.resource}</code>
                        {dep.attribute && (
                          <span className="text-xs text-white/40">.{dep.attribute}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-white/40 italic">No dependencies found</p>
                )}
              </div>
              
              {/* Used by */}
              <div>
                <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
                  Used by ({usedByResources.length})
                </h3>
                {usedByResources.length > 0 ? (
                  <div className="space-y-2">
                    {usedByResources.map((dep, idx) => (
                      <div key={idx} className="p-3 bg-white/5 border border-white/10 rounded-xl flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-cyan-400" />
                        <code className="text-sm text-cyan-300">{dep.resource}</code>
                        {dep.attribute && (
                          <span className="text-xs text-white/40">(uses .{dep.attribute})</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-white/40 italic">No resources depend on this</p>
                )}
              </div>
              
              {dependencies.length === 0 && (
                <div className="text-center py-4">
                  <p className="text-white/60">This resource has no dependencies.</p>
                  <p className="text-sm text-white/40 mt-1">It can be created or destroyed independently.</p>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/5 flex items-center justify-between">
          <span className="text-[10px] text-white/30">Press Escape to close</span>
        </div>
      </div>
    </div>
  )
}

