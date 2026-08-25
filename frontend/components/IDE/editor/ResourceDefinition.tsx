'use client'

/**
 * Resource Definition Panel
 * Shows documentation for Terraform/cloud resources
 */

import { useState, useEffect } from 'react'
import { X, ExternalLink, BookOpen, Code, Server, Database, Shield, Globe, Loader2 } from 'lucide-react'

// Resource definitions for AWS and DigitalOcean
const RESOURCE_DEFINITIONS: Record<string, {
  provider: 'aws' | 'digitalocean' | 'google' | 'azure'
  name: string
  description: string
  category: string
  commonAttributes: { name: string; description: string; required?: boolean }[]
  docsUrl: string
}> = {
  // ============================================
  // AWS COMPUTE
  // ============================================
  'aws_instance': {
    provider: 'aws',
    name: 'EC2 Instance',
    description: 'Provides an EC2 instance resource. This allows instances to be created, updated, and deleted. Instances also support provisioning.',
    category: 'Compute',
    commonAttributes: [
      { name: 'ami', description: 'AMI ID to use for the instance', required: true },
      { name: 'instance_type', description: 'Type of instance to start (e.g., t2.micro)', required: true },
      { name: 'key_name', description: 'Key name of the Key Pair to use for the instance' },
      { name: 'vpc_security_group_ids', description: 'List of security group IDs to associate with' },
      { name: 'subnet_id', description: 'VPC Subnet ID to launch in' },
      { name: 'tags', description: 'Map of tags to assign to the resource' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/instance'
  },
  'aws_launch_template': {
    provider: 'aws',
    name: 'Launch Template',
    description: 'Provides an EC2 launch template resource. Can be used with Auto Scaling groups to configure EC2 instances.',
    category: 'Compute',
    commonAttributes: [
      { name: 'name', description: 'Name of the launch template' },
      { name: 'image_id', description: 'AMI ID to use for the instance' },
      { name: 'instance_type', description: 'Type of instance to launch' },
      { name: 'key_name', description: 'Key name for SSH access' },
      { name: 'vpc_security_group_ids', description: 'List of security group IDs' },
      { name: 'user_data', description: 'Base64-encoded user data script' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/launch_template'
  },
  'aws_autoscaling_group': {
    provider: 'aws',
    name: 'Auto Scaling Group',
    description: 'Provides an Auto Scaling Group resource for automatically scaling EC2 capacity.',
    category: 'Compute',
    commonAttributes: [
      { name: 'name', description: 'Name of the Auto Scaling Group' },
      { name: 'min_size', description: 'Minimum size of the Auto Scaling Group', required: true },
      { name: 'max_size', description: 'Maximum size of the Auto Scaling Group', required: true },
      { name: 'desired_capacity', description: 'Desired number of instances' },
      { name: 'launch_template', description: 'Launch template configuration' },
      { name: 'vpc_zone_identifier', description: 'List of subnet IDs to launch resources in' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/autoscaling_group'
  },
  'aws_lambda_function': {
    provider: 'aws',
    name: 'Lambda Function',
    description: 'Provides a Lambda Function resource. Lambda lets you run code without provisioning servers.',
    category: 'Compute',
    commonAttributes: [
      { name: 'function_name', description: 'Unique name for your Lambda Function', required: true },
      { name: 'role', description: 'IAM role ARN attached to the Lambda Function', required: true },
      { name: 'handler', description: 'Function entrypoint in your code' },
      { name: 'runtime', description: 'Runtime environment (nodejs18.x, python3.9, etc.)' },
      { name: 'memory_size', description: 'Amount of memory in MB (128-10240)' },
      { name: 'timeout', description: 'Execution timeout in seconds (max 900)' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_function'
  },
  'aws_ecs_cluster': {
    provider: 'aws',
    name: 'ECS Cluster',
    description: 'Provides an ECS cluster. Amazon ECS is a fully managed container orchestration service.',
    category: 'Compute',
    commonAttributes: [
      { name: 'name', description: 'Name of the cluster', required: true },
      { name: 'setting', description: 'Configuration block for cluster settings' },
      { name: 'tags', description: 'Map of tags to assign to the resource' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecs_cluster'
  },
  'aws_ecs_service': {
    provider: 'aws',
    name: 'ECS Service',
    description: 'Provides an ECS service for running and maintaining a specified number of task instances.',
    category: 'Compute',
    commonAttributes: [
      { name: 'name', description: 'Name of the service', required: true },
      { name: 'cluster', description: 'ARN of the ECS cluster', required: true },
      { name: 'task_definition', description: 'Family and revision or ARN of the task definition', required: true },
      { name: 'desired_count', description: 'Number of instances of the task definition' },
      { name: 'launch_type', description: 'Launch type (EC2 or FARGATE)' },
      { name: 'network_configuration', description: 'Network configuration for awsvpc mode' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecs_service'
  },
  'aws_ecs_task_definition': {
    provider: 'aws',
    name: 'ECS Task Definition',
    description: 'Provides an ECS task definition to describe how containers should be run.',
    category: 'Compute',
    commonAttributes: [
      { name: 'family', description: 'Unique name for your task definition', required: true },
      { name: 'container_definitions', description: 'JSON document describing containers', required: true },
      { name: 'cpu', description: 'CPU units for the task (Fargate)' },
      { name: 'memory', description: 'Memory for the task in MiB (Fargate)' },
      { name: 'network_mode', description: 'Docker networking mode (bridge, host, awsvpc)' },
      { name: 'execution_role_arn', description: 'ARN of the task execution role' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecs_task_definition'
  },
  'aws_eks_cluster': {
    provider: 'aws',
    name: 'EKS Cluster',
    description: 'Provides an EKS Cluster. Amazon EKS is a managed Kubernetes service.',
    category: 'Compute',
    commonAttributes: [
      { name: 'name', description: 'Name of the cluster', required: true },
      { name: 'role_arn', description: 'ARN of the IAM role for the EKS cluster', required: true },
      { name: 'vpc_config', description: 'VPC configuration for the cluster', required: true },
      { name: 'version', description: 'Kubernetes version' },
      { name: 'enabled_cluster_log_types', description: 'List of log types to enable' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/eks_cluster'
  },
  'aws_eks_node_group': {
    provider: 'aws',
    name: 'EKS Node Group',
    description: 'Provides an EKS Node Group for managed worker nodes in an EKS cluster.',
    category: 'Compute',
    commonAttributes: [
      { name: 'cluster_name', description: 'Name of the EKS cluster', required: true },
      { name: 'node_group_name', description: 'Name of the node group', required: true },
      { name: 'node_role_arn', description: 'ARN of the IAM role for the node group', required: true },
      { name: 'subnet_ids', description: 'List of subnet IDs for the node group', required: true },
      { name: 'scaling_config', description: 'Scaling configuration', required: true },
      { name: 'instance_types', description: 'List of instance types' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/eks_node_group'
  },

  // ============================================
  // AWS STORAGE
  // ============================================
  'aws_s3_bucket': {
    provider: 'aws',
    name: 'S3 Bucket',
    description: 'Provides an S3 bucket resource for storing objects. S3 buckets are globally unique containers for data.',
    category: 'Storage',
    commonAttributes: [
      { name: 'bucket', description: 'Name of the bucket. Must be globally unique.' },
      { name: 'acl', description: 'Canned ACL to apply (private, public-read, etc.)' },
      { name: 'versioning', description: 'Configuration block for versioning' },
      { name: 'tags', description: 'Map of tags to assign to the bucket' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket'
  },
  'aws_s3_bucket_policy': {
    provider: 'aws',
    name: 'S3 Bucket Policy',
    description: 'Attaches a policy to an S3 bucket resource to control access permissions.',
    category: 'Storage',
    commonAttributes: [
      { name: 'bucket', description: 'Name of the bucket to apply the policy to', required: true },
      { name: 'policy', description: 'JSON policy document', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_policy'
  },
  'aws_s3_bucket_versioning': {
    provider: 'aws',
    name: 'S3 Bucket Versioning',
    description: 'Provides an S3 bucket versioning resource for object version management.',
    category: 'Storage',
    commonAttributes: [
      { name: 'bucket', description: 'Name of the S3 bucket', required: true },
      { name: 'versioning_configuration', description: 'Versioning configuration block', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_versioning'
  },
  'aws_s3_object': {
    provider: 'aws',
    name: 'S3 Object',
    description: 'Provides an S3 object resource for uploading content to a bucket.',
    category: 'Storage',
    commonAttributes: [
      { name: 'bucket', description: 'Name of the bucket to put the file in', required: true },
      { name: 'key', description: 'Name of the object once in the bucket', required: true },
      { name: 'source', description: 'Path to the file to upload' },
      { name: 'content', description: 'Literal string value to use as the object content' },
      { name: 'content_type', description: 'Standard MIME type describing the format' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_object'
  },
  'aws_ebs_volume': {
    provider: 'aws',
    name: 'EBS Volume',
    description: 'Provides an EBS volume resource for persistent block-level storage.',
    category: 'Storage',
    commonAttributes: [
      { name: 'availability_zone', description: 'AZ where the volume will be created', required: true },
      { name: 'size', description: 'Size of the volume in GiB' },
      { name: 'type', description: 'Type of volume (gp2, gp3, io1, io2, st1, sc1)' },
      { name: 'iops', description: 'IOPS for the volume (io1/io2/gp3)' },
      { name: 'encrypted', description: 'Enable encryption on the volume' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ebs_volume'
  },
  'aws_efs_file_system': {
    provider: 'aws',
    name: 'EFS File System',
    description: 'Provides an Elastic File System (EFS) resource. Scalable, elastic file storage.',
    category: 'Storage',
    commonAttributes: [
      { name: 'creation_token', description: 'Unique name used as reference' },
      { name: 'performance_mode', description: 'File system performance mode (generalPurpose, maxIO)' },
      { name: 'throughput_mode', description: 'Throughput mode (bursting, provisioned)' },
      { name: 'encrypted', description: 'Enable encryption for the file system' },
      { name: 'tags', description: 'Map of tags to assign to the file system' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/efs_file_system'
  },

  // ============================================
  // AWS NETWORKING
  // ============================================
  'aws_vpc': {
    provider: 'aws',
    name: 'VPC',
    description: 'Provides a VPC resource. A VPC is a virtual network dedicated to your AWS account, logically isolated from other networks.',
    category: 'Networking',
    commonAttributes: [
      { name: 'cidr_block', description: 'The IPv4 CIDR block for the VPC', required: true },
      { name: 'enable_dns_hostnames', description: 'Enable DNS hostnames in the VPC' },
      { name: 'enable_dns_support', description: 'Enable DNS support in the VPC' },
      { name: 'tags', description: 'Map of tags to assign to the resource' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc'
  },
  'aws_subnet': {
    provider: 'aws',
    name: 'Subnet',
    description: 'Provides a VPC subnet resource. Subnets divide a VPC into smaller network segments.',
    category: 'Networking',
    commonAttributes: [
      { name: 'vpc_id', description: 'The VPC ID where the subnet will be created', required: true },
      { name: 'cidr_block', description: 'The IPv4 CIDR block for the subnet', required: true },
      { name: 'availability_zone', description: 'AZ for the subnet' },
      { name: 'map_public_ip_on_launch', description: 'Auto-assign public IP on launch' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/subnet'
  },
  'aws_internet_gateway': {
    provider: 'aws',
    name: 'Internet Gateway',
    description: 'Provides an Internet Gateway resource. Enables communication between VPC and the internet.',
    category: 'Networking',
    commonAttributes: [
      { name: 'vpc_id', description: 'VPC ID to create the gateway in', required: true },
      { name: 'tags', description: 'Map of tags to assign to the resource' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/internet_gateway'
  },
  'aws_nat_gateway': {
    provider: 'aws',
    name: 'NAT Gateway',
    description: 'Provides a NAT Gateway resource. Enables instances in private subnets to connect to the internet.',
    category: 'Networking',
    commonAttributes: [
      { name: 'allocation_id', description: 'Allocation ID of the Elastic IP for the gateway', required: true },
      { name: 'subnet_id', description: 'Subnet ID where the NAT gateway will be placed', required: true },
      { name: 'tags', description: 'Map of tags to assign to the resource' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/nat_gateway'
  },
  'aws_route_table': {
    provider: 'aws',
    name: 'Route Table',
    description: 'Provides a VPC route table resource for directing network traffic.',
    category: 'Networking',
    commonAttributes: [
      { name: 'vpc_id', description: 'VPC ID where the route table will be created', required: true },
      { name: 'route', description: 'List of route objects' },
      { name: 'tags', description: 'Map of tags to assign to the resource' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route_table'
  },
  'aws_route': {
    provider: 'aws',
    name: 'Route',
    description: 'Provides a resource to create a routing table entry (a route) in a VPC routing table.',
    category: 'Networking',
    commonAttributes: [
      { name: 'route_table_id', description: 'ID of the routing table', required: true },
      { name: 'destination_cidr_block', description: 'CIDR block of the route destination' },
      { name: 'gateway_id', description: 'ID of the internet gateway' },
      { name: 'nat_gateway_id', description: 'ID of the NAT gateway' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route'
  },
  'aws_route_table_association': {
    provider: 'aws',
    name: 'Route Table Association',
    description: 'Provides a resource to create an association between a route table and a subnet.',
    category: 'Networking',
    commonAttributes: [
      { name: 'subnet_id', description: 'Subnet ID to associate with', required: true },
      { name: 'route_table_id', description: 'Route table ID to associate', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route_table_association'
  },
  'aws_elastic_ip': {
    provider: 'aws',
    name: 'Elastic IP',
    description: 'Provides an Elastic IP resource. A static IPv4 address designed for dynamic cloud computing.',
    category: 'Networking',
    commonAttributes: [
      { name: 'domain', description: 'Domain for the EIP (vpc or standard)' },
      { name: 'instance', description: 'EC2 instance ID to associate with' },
      { name: 'tags', description: 'Map of tags to assign to the resource' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/eip'
  },
  'aws_lb': {
    provider: 'aws',
    name: 'Load Balancer',
    description: 'Provides a Load Balancer resource (Application, Network, or Gateway).',
    category: 'Networking',
    commonAttributes: [
      { name: 'name', description: 'Name of the LB' },
      { name: 'internal', description: 'If true, the LB will be internal' },
      { name: 'load_balancer_type', description: 'Type (application, network, gateway)' },
      { name: 'security_groups', description: 'List of security group IDs (ALB only)' },
      { name: 'subnets', description: 'List of subnet IDs to attach to the LB' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lb'
  },
  'aws_lb_target_group': {
    provider: 'aws',
    name: 'LB Target Group',
    description: 'Provides a Target Group resource for use with Load Balancers.',
    category: 'Networking',
    commonAttributes: [
      { name: 'name', description: 'Name of the target group' },
      { name: 'port', description: 'Port on which targets receive traffic', required: true },
      { name: 'protocol', description: 'Protocol to use for routing (HTTP, HTTPS, TCP)', required: true },
      { name: 'vpc_id', description: 'VPC ID where the target group will be created', required: true },
      { name: 'health_check', description: 'Health check configuration' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lb_target_group'
  },
  'aws_lb_listener': {
    provider: 'aws',
    name: 'LB Listener',
    description: 'Provides a Load Balancer Listener resource to define how the LB routes requests.',
    category: 'Networking',
    commonAttributes: [
      { name: 'load_balancer_arn', description: 'ARN of the load balancer', required: true },
      { name: 'port', description: 'Port on which the load balancer is listening', required: true },
      { name: 'protocol', description: 'Protocol for connections (HTTP, HTTPS, TCP)' },
      { name: 'default_action', description: 'Default action for routing', required: true },
      { name: 'certificate_arn', description: 'ARN of the SSL certificate (HTTPS only)' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lb_listener'
  },
  'aws_route53_zone': {
    provider: 'aws',
    name: 'Route53 Zone',
    description: 'Provides a Route53 Hosted Zone resource for managing DNS records.',
    category: 'Networking',
    commonAttributes: [
      { name: 'name', description: 'Domain name for the hosted zone', required: true },
      { name: 'comment', description: 'Comment for the hosted zone' },
      { name: 'vpc', description: 'Configuration for private hosted zones' },
      { name: 'tags', description: 'Map of tags to assign to the zone' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route53_zone'
  },
  'aws_route53_record': {
    provider: 'aws',
    name: 'Route53 Record',
    description: 'Provides a Route53 record resource for creating DNS records.',
    category: 'Networking',
    commonAttributes: [
      { name: 'zone_id', description: 'Hosted zone ID', required: true },
      { name: 'name', description: 'Name of the record', required: true },
      { name: 'type', description: 'Record type (A, AAAA, CNAME, MX, etc.)', required: true },
      { name: 'ttl', description: 'TTL of the record' },
      { name: 'records', description: 'List of record values' },
      { name: 'alias', description: 'Alias block for alias records' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route53_record'
  },
  'aws_cloudfront_distribution': {
    provider: 'aws',
    name: 'CloudFront Distribution',
    description: 'Provides a CloudFront distribution resource for content delivery.',
    category: 'Networking',
    commonAttributes: [
      { name: 'origin', description: 'Origin configuration', required: true },
      { name: 'enabled', description: 'Whether the distribution is enabled', required: true },
      { name: 'default_cache_behavior', description: 'Default cache behavior', required: true },
      { name: 'restrictions', description: 'Restrictions configuration', required: true },
      { name: 'viewer_certificate', description: 'SSL/TLS configuration', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudfront_distribution'
  },
  'aws_api_gateway_rest_api': {
    provider: 'aws',
    name: 'API Gateway REST API',
    description: 'Provides an API Gateway REST API resource for building REST APIs.',
    category: 'Networking',
    commonAttributes: [
      { name: 'name', description: 'Name of the REST API', required: true },
      { name: 'description', description: 'Description of the REST API' },
      { name: 'endpoint_configuration', description: 'Endpoint configuration type' },
      { name: 'body', description: 'OpenAPI specification of the REST API' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/api_gateway_rest_api'
  },

  // ============================================
  // AWS SECURITY
  // ============================================
  'aws_security_group': {
    provider: 'aws',
    name: 'Security Group',
    description: 'Provides a security group resource. Acts as a virtual firewall for your instances to control inbound and outbound traffic.',
    category: 'Security',
    commonAttributes: [
      { name: 'name', description: 'Name of the security group' },
      { name: 'description', description: 'Description of the security group' },
      { name: 'vpc_id', description: 'VPC ID where the security group will be created' },
      { name: 'ingress', description: 'Ingress rules (inbound traffic)' },
      { name: 'egress', description: 'Egress rules (outbound traffic)' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group'
  },
  'aws_security_group_rule': {
    provider: 'aws',
    name: 'Security Group Rule',
    description: 'Provides a security group rule resource for adding rules to an existing security group.',
    category: 'Security',
    commonAttributes: [
      { name: 'type', description: 'Type of rule (ingress or egress)', required: true },
      { name: 'from_port', description: 'Start port', required: true },
      { name: 'to_port', description: 'End port', required: true },
      { name: 'protocol', description: 'Protocol (tcp, udp, icmp, all)', required: true },
      { name: 'security_group_id', description: 'Security group ID to modify', required: true },
      { name: 'cidr_blocks', description: 'List of CIDR blocks' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group_rule'
  },
  'aws_iam_role': {
    provider: 'aws',
    name: 'IAM Role',
    description: 'Provides an IAM role. Roles define a set of permissions for making AWS service requests.',
    category: 'Security',
    commonAttributes: [
      { name: 'name', description: 'Name of the role' },
      { name: 'assume_role_policy', description: 'Policy that grants permission to assume the role', required: true },
      { name: 'description', description: 'Description of the role' },
      { name: 'tags', description: 'Map of tags to assign to the role' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role'
  },
  'aws_iam_policy': {
    provider: 'aws',
    name: 'IAM Policy',
    description: 'Provides an IAM policy. Policies define permissions that can be attached to users, groups, or roles.',
    category: 'Security',
    commonAttributes: [
      { name: 'name', description: 'Name of the policy' },
      { name: 'policy', description: 'JSON policy document', required: true },
      { name: 'description', description: 'Description of the policy' },
      { name: 'path', description: 'Path for the policy' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_policy'
  },
  'aws_iam_role_policy_attachment': {
    provider: 'aws',
    name: 'IAM Role Policy Attachment',
    description: 'Attaches a managed IAM Policy to an IAM Role.',
    category: 'Security',
    commonAttributes: [
      { name: 'role', description: 'Name of the IAM role', required: true },
      { name: 'policy_arn', description: 'ARN of the policy to attach', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role_policy_attachment'
  },
  'aws_iam_user': {
    provider: 'aws',
    name: 'IAM User',
    description: 'Provides an IAM user. IAM users represent a person or service that uses AWS.',
    category: 'Security',
    commonAttributes: [
      { name: 'name', description: 'Name of the IAM user', required: true },
      { name: 'path', description: 'Path for the IAM user' },
      { name: 'force_destroy', description: 'Destroy even if it has non-Terraform-managed IAM access keys' },
      { name: 'tags', description: 'Map of tags to assign to the user' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_user'
  },
  'aws_iam_instance_profile': {
    provider: 'aws',
    name: 'IAM Instance Profile',
    description: 'Provides an IAM instance profile for attaching IAM roles to EC2 instances.',
    category: 'Security',
    commonAttributes: [
      { name: 'name', description: 'Name of the instance profile' },
      { name: 'role', description: 'Name of the role to add to the profile' },
      { name: 'path', description: 'Path to the instance profile' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_instance_profile'
  },
  'aws_kms_key': {
    provider: 'aws',
    name: 'KMS Key',
    description: 'Provides a KMS key resource for creating and managing encryption keys.',
    category: 'Security',
    commonAttributes: [
      { name: 'description', description: 'Description of the key' },
      { name: 'key_usage', description: 'Usage of the key (ENCRYPT_DECRYPT, SIGN_VERIFY)' },
      { name: 'deletion_window_in_days', description: 'Days before key deletion (7-30)' },
      { name: 'enable_key_rotation', description: 'Enable automatic key rotation' },
      { name: 'policy', description: 'JSON key policy' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/kms_key'
  },
  'aws_secretsmanager_secret': {
    provider: 'aws',
    name: 'Secrets Manager Secret',
    description: 'Provides a Secrets Manager secret resource for storing sensitive information.',
    category: 'Security',
    commonAttributes: [
      { name: 'name', description: 'Name of the secret' },
      { name: 'description', description: 'Description of the secret' },
      { name: 'kms_key_id', description: 'ARN of the KMS key for encryption' },
      { name: 'recovery_window_in_days', description: 'Days before permanent deletion' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/secretsmanager_secret'
  },
  'aws_acm_certificate': {
    provider: 'aws',
    name: 'ACM Certificate',
    description: 'Provides an ACM certificate resource for managing SSL/TLS certificates.',
    category: 'Security',
    commonAttributes: [
      { name: 'domain_name', description: 'Domain name for the certificate', required: true },
      { name: 'validation_method', description: 'Validation method (DNS or EMAIL)' },
      { name: 'subject_alternative_names', description: 'Additional domain names' },
      { name: 'tags', description: 'Map of tags to assign to the certificate' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/acm_certificate'
  },

  // ============================================
  // AWS DATABASE
  // ============================================
  'aws_db_instance': {
    provider: 'aws',
    name: 'RDS Instance',
    description: 'Provides an RDS instance resource. Amazon RDS is a managed relational database service.',
    category: 'Database',
    commonAttributes: [
      { name: 'identifier', description: 'Name of the RDS instance' },
      { name: 'engine', description: 'Database engine (mysql, postgres, etc.)', required: true },
      { name: 'instance_class', description: 'Instance type (db.t3.micro, etc.)', required: true },
      { name: 'allocated_storage', description: 'Storage size in gibibytes' },
      { name: 'username', description: 'Master username for the database' },
      { name: 'password', description: 'Master password for the database' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_instance'
  },
  'aws_rds_instance': {
    provider: 'aws',
    name: 'RDS Instance',
    description: 'Provides an RDS instance resource. Amazon RDS is a managed relational database service.',
    category: 'Database',
    commonAttributes: [
      { name: 'identifier', description: 'Name of the RDS instance' },
      { name: 'engine', description: 'Database engine (mysql, postgres, etc.)', required: true },
      { name: 'instance_class', description: 'Instance type (db.t3.micro, etc.)', required: true },
      { name: 'allocated_storage', description: 'Storage size in gibibytes' },
      { name: 'username', description: 'Master username for the database' },
      { name: 'password', description: 'Master password for the database' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_instance'
  },
  'aws_db_subnet_group': {
    provider: 'aws',
    name: 'RDS Subnet Group',
    description: 'Provides an RDS DB subnet group resource for specifying VPC subnets for RDS.',
    category: 'Database',
    commonAttributes: [
      { name: 'name', description: 'Name of the DB subnet group' },
      { name: 'subnet_ids', description: 'List of VPC subnet IDs', required: true },
      { name: 'description', description: 'Description of the subnet group' },
      { name: 'tags', description: 'Map of tags to assign to the resource' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_subnet_group'
  },
  'aws_rds_cluster': {
    provider: 'aws',
    name: 'Aurora Cluster',
    description: 'Provides an RDS Aurora cluster resource. Aurora is a MySQL and PostgreSQL-compatible database.',
    category: 'Database',
    commonAttributes: [
      { name: 'cluster_identifier', description: 'Cluster identifier', required: true },
      { name: 'engine', description: 'Name of the database engine (aurora-mysql, aurora-postgresql)', required: true },
      { name: 'master_username', description: 'Master username for the cluster' },
      { name: 'master_password', description: 'Master password for the cluster' },
      { name: 'database_name', description: 'Name for an automatically created database' },
      { name: 'skip_final_snapshot', description: 'Skip final snapshot before deletion' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/rds_cluster'
  },
  'aws_dynamodb_table': {
    provider: 'aws',
    name: 'DynamoDB Table',
    description: 'Provides a DynamoDB table resource. DynamoDB is a managed NoSQL database service.',
    category: 'Database',
    commonAttributes: [
      { name: 'name', description: 'Name of the table', required: true },
      { name: 'billing_mode', description: 'Billing mode (PROVISIONED or PAY_PER_REQUEST)' },
      { name: 'hash_key', description: 'Attribute to use as the hash (partition) key', required: true },
      { name: 'range_key', description: 'Attribute to use as the range (sort) key' },
      { name: 'attribute', description: 'Attribute definitions', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/dynamodb_table'
  },
  'aws_elasticache_cluster': {
    provider: 'aws',
    name: 'ElastiCache Cluster',
    description: 'Provides an ElastiCache Cluster resource for Redis or Memcached.',
    category: 'Database',
    commonAttributes: [
      { name: 'cluster_id', description: 'Group identifier', required: true },
      { name: 'engine', description: 'Name of the cache engine (redis or memcached)', required: true },
      { name: 'node_type', description: 'Instance class (cache.t2.micro, etc.)', required: true },
      { name: 'num_cache_nodes', description: 'Number of cache nodes', required: true },
      { name: 'port', description: 'Port number' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/elasticache_cluster'
  },

  // ============================================
  // AWS MONITORING
  // ============================================
  'aws_cloudwatch_log_group': {
    provider: 'aws',
    name: 'CloudWatch Log Group',
    description: 'Provides a CloudWatch Log Group resource for storing and monitoring logs.',
    category: 'Monitoring',
    commonAttributes: [
      { name: 'name', description: 'Name of the log group' },
      { name: 'retention_in_days', description: 'Number of days to retain log events' },
      { name: 'kms_key_id', description: 'ARN of the KMS key for encryption' },
      { name: 'tags', description: 'Map of tags to assign to the resource' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_log_group'
  },
  'aws_cloudwatch_metric_alarm': {
    provider: 'aws',
    name: 'CloudWatch Alarm',
    description: 'Provides a CloudWatch Metric Alarm resource for monitoring metrics.',
    category: 'Monitoring',
    commonAttributes: [
      { name: 'alarm_name', description: 'Name of the alarm', required: true },
      { name: 'comparison_operator', description: 'Comparison operator', required: true },
      { name: 'evaluation_periods', description: 'Number of periods to evaluate', required: true },
      { name: 'metric_name', description: 'Name of the metric', required: true },
      { name: 'namespace', description: 'Namespace of the metric', required: true },
      { name: 'threshold', description: 'Value to compare against', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_metric_alarm'
  },
  'aws_sns_topic': {
    provider: 'aws',
    name: 'SNS Topic',
    description: 'Provides an SNS topic resource for pub/sub messaging.',
    category: 'Monitoring',
    commonAttributes: [
      { name: 'name', description: 'Name of the topic' },
      { name: 'display_name', description: 'Display name for SMS messages' },
      { name: 'kms_master_key_id', description: 'ARN of KMS key for encryption' },
      { name: 'tags', description: 'Map of tags to assign to the topic' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sns_topic'
  },
  'aws_sqs_queue': {
    provider: 'aws',
    name: 'SQS Queue',
    description: 'Provides an SQS queue resource for message queuing.',
    category: 'Monitoring',
    commonAttributes: [
      { name: 'name', description: 'Name of the queue' },
      { name: 'delay_seconds', description: 'Delay for message delivery' },
      { name: 'max_message_size', description: 'Maximum message size in bytes' },
      { name: 'message_retention_seconds', description: 'How long to retain messages' },
      { name: 'visibility_timeout_seconds', description: 'Visibility timeout' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sqs_queue'
  },

  // ============================================
  // DIGITALOCEAN COMPUTE
  // ============================================
  'digitalocean_droplet': {
    provider: 'digitalocean',
    name: 'Droplet',
    description: 'Provides a DigitalOcean Droplet resource. Droplets are Linux-based virtual machines that run on virtualized hardware.',
    category: 'Compute',
    commonAttributes: [
      { name: 'name', description: 'The Droplet name', required: true },
      { name: 'size', description: 'Droplet size slug (s-1vcpu-1gb, etc.)', required: true },
      { name: 'image', description: 'Droplet image slug or ID', required: true },
      { name: 'region', description: 'Region where the Droplet will be created', required: true },
      { name: 'ssh_keys', description: 'List of SSH key IDs or fingerprints' },
      { name: 'vpc_uuid', description: 'UUID of the VPC where the Droplet will be located' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/droplet'
  },
  'digitalocean_kubernetes_cluster': {
    provider: 'digitalocean',
    name: 'Kubernetes Cluster',
    description: 'Provides a DigitalOcean Kubernetes (DOKS) cluster resource. Managed Kubernetes service.',
    category: 'Compute',
    commonAttributes: [
      { name: 'name', description: 'Name of the cluster', required: true },
      { name: 'region', description: 'Region where the cluster will be created', required: true },
      { name: 'version', description: 'Kubernetes version slug', required: true },
      { name: 'node_pool', description: 'Node pool configuration', required: true },
      { name: 'vpc_uuid', description: 'UUID of the VPC for the cluster' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/kubernetes_cluster'
  },
  'digitalocean_kubernetes_node_pool': {
    provider: 'digitalocean',
    name: 'Kubernetes Node Pool',
    description: 'Provides a DigitalOcean Kubernetes node pool resource for additional worker nodes.',
    category: 'Compute',
    commonAttributes: [
      { name: 'cluster_id', description: 'ID of the Kubernetes cluster', required: true },
      { name: 'name', description: 'Name of the node pool', required: true },
      { name: 'size', description: 'Droplet size slug', required: true },
      { name: 'node_count', description: 'Number of nodes in the pool' },
      { name: 'auto_scale', description: 'Enable auto-scaling' },
      { name: 'min_nodes', description: 'Minimum number of nodes for auto-scaling' },
      { name: 'max_nodes', description: 'Maximum number of nodes for auto-scaling' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/kubernetes_node_pool'
  },
  'digitalocean_app': {
    provider: 'digitalocean',
    name: 'App Platform App',
    description: 'Provides a DigitalOcean App Platform application resource for deploying apps.',
    category: 'Compute',
    commonAttributes: [
      { name: 'spec', description: 'Application specification', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/app'
  },

  // ============================================
  // DIGITALOCEAN STORAGE
  // ============================================
  'digitalocean_spaces_bucket': {
    provider: 'digitalocean',
    name: 'Spaces Bucket',
    description: 'Provides a DigitalOcean Spaces bucket resource. Spaces is an S3-compatible object storage service.',
    category: 'Storage',
    commonAttributes: [
      { name: 'name', description: 'The name of the bucket', required: true },
      { name: 'region', description: 'Region where the bucket will be created', required: true },
      { name: 'acl', description: 'Canned ACL (private, public-read)' },
      { name: 'force_destroy', description: 'Delete all objects when destroying bucket' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/spaces_bucket'
  },
  'digitalocean_spaces_bucket_object': {
    provider: 'digitalocean',
    name: 'Spaces Object',
    description: 'Provides a DigitalOcean Spaces object resource for uploading files.',
    category: 'Storage',
    commonAttributes: [
      { name: 'region', description: 'Region of the bucket', required: true },
      { name: 'bucket', description: 'Name of the bucket', required: true },
      { name: 'key', description: 'Name of the object in the bucket', required: true },
      { name: 'source', description: 'Path to the file to upload' },
      { name: 'content', description: 'Literal string to use as content' },
      { name: 'acl', description: 'Canned ACL for the object' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/spaces_bucket_object'
  },
  'digitalocean_volume': {
    provider: 'digitalocean',
    name: 'Block Storage Volume',
    description: 'Provides a DigitalOcean Block Storage volume resource.',
    category: 'Storage',
    commonAttributes: [
      { name: 'region', description: 'Region where the volume will be created', required: true },
      { name: 'name', description: 'Name of the volume', required: true },
      { name: 'size', description: 'Size of the volume in GiB', required: true },
      { name: 'description', description: 'Description of the volume' },
      { name: 'initial_filesystem_type', description: 'Initial filesystem type (ext4, xfs)' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/volume'
  },
  'digitalocean_volume_attachment': {
    provider: 'digitalocean',
    name: 'Volume Attachment',
    description: 'Manages the attachment of a Block Storage volume to a Droplet.',
    category: 'Storage',
    commonAttributes: [
      { name: 'droplet_id', description: 'ID of the Droplet to attach to', required: true },
      { name: 'volume_id', description: 'ID of the volume to attach', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/volume_attachment'
  },

  // ============================================
  // DIGITALOCEAN NETWORKING
  // ============================================
  'digitalocean_loadbalancer': {
    provider: 'digitalocean',
    name: 'Load Balancer',
    description: 'Provides a DigitalOcean Load Balancer resource for distributing traffic across Droplets.',
    category: 'Networking',
    commonAttributes: [
      { name: 'name', description: 'Name of the Load Balancer', required: true },
      { name: 'region', description: 'Region where the LB will be created', required: true },
      { name: 'forwarding_rule', description: 'Forwarding rules configuration', required: true },
      { name: 'droplet_ids', description: 'List of Droplet IDs to add to the LB' },
      { name: 'healthcheck', description: 'Health check configuration' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/loadbalancer'
  },
  'digitalocean_vpc': {
    provider: 'digitalocean',
    name: 'VPC',
    description: 'Provides a DigitalOcean VPC resource. VPCs are virtual networks containing resources that can communicate securely.',
    category: 'Networking',
    commonAttributes: [
      { name: 'name', description: 'Name of the VPC', required: true },
      { name: 'region', description: 'Region where the VPC will be created', required: true },
      { name: 'ip_range', description: 'Range of IP addresses in CIDR notation' },
      { name: 'description', description: 'Description of the VPC' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/vpc'
  },
  'digitalocean_domain': {
    provider: 'digitalocean',
    name: 'Domain',
    description: 'Provides a DigitalOcean DNS domain resource for managing DNS zones.',
    category: 'Networking',
    commonAttributes: [
      { name: 'name', description: 'The domain name to manage', required: true },
      { name: 'ip_address', description: 'IP address of the domain (creates A record)' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/domain'
  },
  'digitalocean_record': {
    provider: 'digitalocean',
    name: 'DNS Record',
    description: 'Provides a DigitalOcean DNS record resource for creating DNS records.',
    category: 'Networking',
    commonAttributes: [
      { name: 'domain', description: 'Domain to add the record to', required: true },
      { name: 'type', description: 'Type of record (A, AAAA, CNAME, MX, TXT, etc.)', required: true },
      { name: 'name', description: 'Name of the record', required: true },
      { name: 'value', description: 'Value of the record', required: true },
      { name: 'ttl', description: 'TTL of the record' },
      { name: 'priority', description: 'Priority of the record (MX/SRV only)' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/record'
  },
  'digitalocean_floating_ip': {
    provider: 'digitalocean',
    name: 'Floating IP',
    description: 'Provides a DigitalOcean Floating IP resource. A static IP address.',
    category: 'Networking',
    commonAttributes: [
      { name: 'region', description: 'Region where the Floating IP will be created', required: true },
      { name: 'droplet_id', description: 'ID of the Droplet to assign the IP to' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/floating_ip'
  },
  'digitalocean_reserved_ip': {
    provider: 'digitalocean',
    name: 'Reserved IP',
    description: 'Provides a DigitalOcean Reserved IP resource. A static IPv4 address.',
    category: 'Networking',
    commonAttributes: [
      { name: 'region', description: 'Region where the Reserved IP will be created', required: true },
      { name: 'droplet_id', description: 'ID of the Droplet to assign the IP to' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/reserved_ip'
  },
  'digitalocean_cdn': {
    provider: 'digitalocean',
    name: 'CDN Endpoint',
    description: 'Provides a DigitalOcean CDN endpoint resource for content delivery.',
    category: 'Networking',
    commonAttributes: [
      { name: 'origin', description: 'Fully qualified domain name of the origin', required: true },
      { name: 'ttl', description: 'Time to live for cached content in seconds' },
      { name: 'custom_domain', description: 'Custom domain for the CDN endpoint' },
      { name: 'certificate_id', description: 'ID of a certificate for custom domain' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/cdn'
  },

  // ============================================
  // DIGITALOCEAN SECURITY
  // ============================================
  'digitalocean_firewall': {
    provider: 'digitalocean',
    name: 'Firewall',
    description: 'Provides a DigitalOcean Cloud Firewall resource for controlling traffic to Droplets.',
    category: 'Security',
    commonAttributes: [
      { name: 'name', description: 'Name of the Firewall', required: true },
      { name: 'droplet_ids', description: 'List of Droplet IDs to apply the Firewall to' },
      { name: 'inbound_rule', description: 'Inbound traffic rules' },
      { name: 'outbound_rule', description: 'Outbound traffic rules' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/firewall'
  },
  'digitalocean_ssh_key': {
    provider: 'digitalocean',
    name: 'SSH Key',
    description: 'Provides a DigitalOcean SSH key resource for Droplet authentication.',
    category: 'Security',
    commonAttributes: [
      { name: 'name', description: 'Name of the SSH key', required: true },
      { name: 'public_key', description: 'The public key contents', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/ssh_key'
  },
  'digitalocean_certificate': {
    provider: 'digitalocean',
    name: 'Certificate',
    description: 'Provides a DigitalOcean certificate resource for SSL/TLS certificates.',
    category: 'Security',
    commonAttributes: [
      { name: 'name', description: 'Name of the certificate', required: true },
      { name: 'type', description: 'Type of certificate (custom or lets_encrypt)', required: true },
      { name: 'domains', description: 'List of fully qualified domain names' },
      { name: 'private_key', description: 'PEM-formatted private key (custom only)' },
      { name: 'leaf_certificate', description: 'PEM-formatted certificate (custom only)' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/certificate'
  },

  // ============================================
  // DIGITALOCEAN DATABASE
  // ============================================
  'digitalocean_database_cluster': {
    provider: 'digitalocean',
    name: 'Database Cluster',
    description: 'Provides a DigitalOcean managed database cluster resource. Supports PostgreSQL, MySQL, Redis, and MongoDB.',
    category: 'Database',
    commonAttributes: [
      { name: 'name', description: 'Name of the database cluster', required: true },
      { name: 'engine', description: 'Database engine (pg, mysql, redis, mongodb)', required: true },
      { name: 'size', description: 'Droplet size slug for nodes', required: true },
      { name: 'region', description: 'Region where the cluster will be created', required: true },
      { name: 'node_count', description: 'Number of nodes in the cluster' },
      { name: 'version', description: 'Engine version' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/database_cluster'
  },
  'digitalocean_database_db': {
    provider: 'digitalocean',
    name: 'Database',
    description: 'Provides a DigitalOcean database resource within a cluster.',
    category: 'Database',
    commonAttributes: [
      { name: 'cluster_id', description: 'ID of the database cluster', required: true },
      { name: 'name', description: 'Name of the database', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/database_db'
  },
  'digitalocean_database_user': {
    provider: 'digitalocean',
    name: 'Database User',
    description: 'Provides a DigitalOcean database user resource for database authentication.',
    category: 'Database',
    commonAttributes: [
      { name: 'cluster_id', description: 'ID of the database cluster', required: true },
      { name: 'name', description: 'Name of the database user', required: true },
      { name: 'mysql_auth_plugin', description: 'MySQL auth plugin (MySQL only)' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/database_user'
  },
  'digitalocean_database_firewall': {
    provider: 'digitalocean',
    name: 'Database Firewall',
    description: 'Provides a DigitalOcean database firewall resource for access control.',
    category: 'Database',
    commonAttributes: [
      { name: 'cluster_id', description: 'ID of the database cluster', required: true },
      { name: 'rule', description: 'Firewall rule configuration', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/database_firewall'
  },
  'digitalocean_database_replica': {
    provider: 'digitalocean',
    name: 'Database Replica',
    description: 'Provides a DigitalOcean database read replica resource.',
    category: 'Database',
    commonAttributes: [
      { name: 'cluster_id', description: 'ID of the database cluster', required: true },
      { name: 'name', description: 'Name of the replica', required: true },
      { name: 'size', description: 'Droplet size slug for the replica' },
      { name: 'region', description: 'Region for the replica' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/database_replica'
  },

  // ============================================
  // DIGITALOCEAN MONITORING
  // ============================================
  'digitalocean_monitor_alert': {
    provider: 'digitalocean',
    name: 'Monitor Alert',
    description: 'Provides a DigitalOcean monitoring alert policy resource.',
    category: 'Monitoring',
    commonAttributes: [
      { name: 'alerts', description: 'Alert policy configuration', required: true },
      { name: 'compare', description: 'Comparison operator (GreaterThan, LessThan)', required: true },
      { name: 'description', description: 'Description of the alert policy', required: true },
      { name: 'type', description: 'Type of metric to alert on', required: true },
      { name: 'value', description: 'Threshold value', required: true },
      { name: 'window', description: 'Time window for evaluation', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/monitor_alert'
  },
  'digitalocean_uptime_check': {
    provider: 'digitalocean',
    name: 'Uptime Check',
    description: 'Provides a DigitalOcean Uptime Check resource for monitoring endpoints.',
    category: 'Monitoring',
    commonAttributes: [
      { name: 'name', description: 'Name of the check', required: true },
      { name: 'target', description: 'URL or IP to monitor', required: true },
      { name: 'type', description: 'Type of check (ping, http, https)', required: true },
      { name: 'regions', description: 'List of regions to run the check from' },
      { name: 'enabled', description: 'Whether the check is enabled' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/uptime_check'
  },
  'digitalocean_uptime_alert': {
    provider: 'digitalocean',
    name: 'Uptime Alert',
    description: 'Provides a DigitalOcean Uptime Alert resource for alerting on check failures.',
    category: 'Monitoring',
    commonAttributes: [
      { name: 'check_id', description: 'ID of the Uptime Check', required: true },
      { name: 'name', description: 'Name of the alert', required: true },
      { name: 'type', description: 'Type of alert (latency, down, down_global, ssl_expiry)' },
      { name: 'notifications', description: 'Notification configuration', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/uptime_alert'
  },

  // ============================================
  // DIGITALOCEAN PROJECTS
  // ============================================
  'digitalocean_project': {
    provider: 'digitalocean',
    name: 'Project',
    description: 'Provides a DigitalOcean Project resource for organizing resources.',
    category: 'Management',
    commonAttributes: [
      { name: 'name', description: 'Name of the project', required: true },
      { name: 'description', description: 'Description of the project' },
      { name: 'purpose', description: 'Purpose of the project' },
      { name: 'environment', description: 'Environment (Development, Staging, Production)' },
      { name: 'resources', description: 'List of resource URNs to assign' },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/project'
  },
  'digitalocean_tag': {
    provider: 'digitalocean',
    name: 'Tag',
    description: 'Provides a DigitalOcean Tag resource for labeling resources.',
    category: 'Management',
    commonAttributes: [
      { name: 'name', description: 'Name of the tag', required: true },
    ],
    docsUrl: 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/tag'
  },
}

// Get icon for category
function getCategoryIcon(category: string) {
  switch (category) {
    case 'Compute': return <Server className="w-4 h-4" />
    case 'Storage': return <Database className="w-4 h-4" />
    case 'Networking': return <Globe className="w-4 h-4" />
    case 'Security': return <Shield className="w-4 h-4" />
    case 'Database': return <Database className="w-4 h-4" />
    case 'Monitoring': return <BookOpen className="w-4 h-4" />
    case 'Management': return <Code className="w-4 h-4" />
    default: return <Code className="w-4 h-4" />
  }
}

// Get provider color
function getProviderColor(provider: string) {
  switch (provider) {
    case 'aws': return 'text-orange-400'
    case 'digitalocean': return 'text-blue-400'
    case 'google': return 'text-red-400'
    case 'azure': return 'text-cyan-400'
    default: return 'text-purple-400'
  }
}

interface ResourceDefinitionProps {
  resourceType: string | null
  onClose: () => void
}

export default function ResourceDefinition({ resourceType, onClose }: ResourceDefinitionProps) {
  const [loading, setLoading] = useState(false)
  
  if (!resourceType) return null
  
  const definition = RESOURCE_DEFINITIONS[resourceType]
  
  // If we don't have a definition, show a generic message
  if (!definition) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
        <div 
          className="bg-black/95 border border-white/10 rounded-2xl shadow-2xl w-[500px] max-h-[80vh] overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-white/60" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">{resourceType}</h2>
                <p className="text-xs text-white/40">Resource Definition</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
              <X className="w-4 h-4 text-white/40" />
            </button>
          </div>
          
          <div className="p-6 text-center">
            <p className="text-white/60 text-sm mb-4">
              No built-in definition found for <code className="text-purple-400">{resourceType}</code>
            </p>
            <a 
              href={`https://registry.terraform.io/search/providers?q=${resourceType}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-500/20 text-purple-400 rounded-lg hover:bg-purple-500/30 transition-colors text-sm"
            >
              <ExternalLink className="w-4 h-4" />
              Search Terraform Registry
            </a>
          </div>
        </div>
      </div>
    )
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
            <div className={`w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center ${getProviderColor(definition.provider)}`}>
              {getCategoryIcon(definition.category)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-white">{definition.name}</h2>
                <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full bg-white/10 ${getProviderColor(definition.provider)}`}>
                  {definition.provider}
                </span>
              </div>
              <p className="text-xs text-white/40 font-mono">{resourceType}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-4 h-4 text-white/40" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-5 overflow-y-auto max-h-[calc(80vh-140px)]">
          {/* Description */}
          <div className="mb-5">
            <p className="text-sm text-white/70 leading-relaxed">{definition.description}</p>
          </div>
          
          {/* Category */}
          <div className="mb-5 flex items-center gap-2">
            <span className="text-[10px] uppercase text-white/40">Category:</span>
            <span className="text-xs text-white/70 flex items-center gap-1.5">
              {getCategoryIcon(definition.category)}
              {definition.category}
            </span>
          </div>
          
          {/* Attributes */}
          <div className="mb-5">
            <h3 className="text-[10px] uppercase text-white/40 mb-3 tracking-wider">Common Attributes</h3>
            <div className="space-y-2">
              {definition.commonAttributes.map(attr => (
                <div key={attr.name} className="p-3 bg-white/5 rounded-xl">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-sm text-purple-400 font-mono">{attr.name}</code>
                    {attr.required && (
                      <span className="text-[9px] uppercase px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded">required</span>
                    )}
                  </div>
                  <p className="text-xs text-white/50">{attr.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/5 flex items-center justify-between">
          <span className="text-[10px] text-white/30">Press Escape to close</span>
          <a 
            href={definition.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-500/20 text-purple-400 rounded-lg hover:bg-purple-500/30 transition-colors text-xs"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Full Documentation
          </a>
        </div>
      </div>
    </div>
  )
}

