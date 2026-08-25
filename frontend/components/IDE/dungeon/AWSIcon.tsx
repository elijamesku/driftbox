'use client'

import React from 'react'

// AWS Architecture Icons - Official AWS service icons
// Using AWS CDN for icons or we can use a local icon library

interface AWSIconProps {
  service: string
  size?: number
  className?: string
  variant?: 'light' | 'dark'
}

// Map Terraform resource types to AWS service names for icon lookup
const AWS_SERVICE_MAP: Record<string, string> = {
  // Compute
  'aws_ec2_instance': 'EC2',
  'aws_instance': 'EC2',
  'aws_lambda_function': 'Lambda',
  'aws_ecs_cluster': 'ECS',
  'aws_ecs_service': 'ECS',
  'aws_ecs_task_definition': 'ECS',
  'aws_eks_cluster': 'EKS',
  'aws_eks_node_group': 'EKS',
  
  // Storage
  'aws_s3_bucket': 'S3',
  'aws_ebs_volume': 'EBS',
  'aws_efs_file_system': 'EFS',
  'aws_glacier_vault': 'Glacier',
  
  // Database
  'aws_rds_instance': 'RDS',
  'aws_rds_cluster': 'RDS',
  'aws_db_instance': 'RDS',
  'aws_dynamodb_table': 'DynamoDB',
  'aws_elasticache_cluster': 'ElastiCache',
  'aws_redshift_cluster': 'Redshift',
  'aws_neptune_cluster': 'Neptune',
  
  // Networking
  'aws_vpc': 'VPC',
  'aws_subnet': 'VPC',
  'aws_security_group': 'VPC',
  'aws_internet_gateway': 'Internet-Gateway',
  'aws_nat_gateway': 'NAT-Gateway',
  'aws_alb': 'Elastic-Load-Balancing',
  'aws_lb': 'Elastic-Load-Balancing',
  'aws_elb': 'Elastic-Load-Balancing',
  'aws_route_table': 'VPC',
  'aws_vpc_peering_connection': 'VPC',
  'aws_vpn_gateway': 'VPC',
  
  // IAM
  'aws_iam_role': 'IAM',
  'aws_iam_user': 'IAM',
  'aws_iam_policy': 'IAM',
  'aws_iam_instance_profile': 'IAM',
  
  // API
  'aws_api_gateway_rest_api': 'API-Gateway',
  'aws_apigatewayv2_api': 'API-Gateway',
  
  // Monitoring
  'aws_cloudwatch_log_group': 'CloudWatch',
  'aws_cloudwatch_metric_alarm': 'CloudWatch',
  'aws_cloudwatch_dashboard': 'CloudWatch',
  
  // Messaging
  'aws_sns_topic': 'SNS',
  'aws_sqs_queue': 'SQS',
  
  // CDN
  'aws_cloudfront_distribution': 'CloudFront',
  
  // Security
  'aws_kms_key': 'Key-Management-Service',
  'aws_secretsmanager_secret': 'Secrets-Manager',
  
  // Analytics
  'aws_athena_database': 'Athena',
  'aws_glue_catalog_database': 'Glue',
}

// Map Terraform resource types to DigitalOcean service names for icon lookup
const DO_SERVICE_MAP: Record<string, string> = {
  // Compute
  'digitalocean_droplet': 'Droplet',
  'digitalocean_kubernetes_cluster': 'Kubernetes',
  'digitalocean_kubernetes_node_pool': 'Kubernetes',
  'digitalocean_app': 'App Platform',
  'digitalocean_function': 'Functions',
  
  // Storage
  'digitalocean_spaces_bucket': 'Spaces',
  'digitalocean_spaces_bucket_object': 'Spaces',
  'digitalocean_volume': 'Block Storage',
  'digitalocean_volume_attachment': 'Block Storage',
  'digitalocean_volume_snapshot': 'Snapshot',
  
  // Database
  'digitalocean_database_cluster': 'Database',
  'digitalocean_database_db': 'Database',
  'digitalocean_database_user': 'Database',
  'digitalocean_database_replica': 'Database',
  'digitalocean_database_connection_pool': 'Database',
  'digitalocean_database_firewall': 'Database',
  
  // Networking
  'digitalocean_vpc': 'VPC',
  'digitalocean_firewall': 'Firewall',
  'digitalocean_loadbalancer': 'Load Balancer',
  'digitalocean_floating_ip': 'Floating IP',
  'digitalocean_floating_ip_assignment': 'Floating IP',
  'digitalocean_reserved_ip': 'Reserved IP',
  'digitalocean_reserved_ip_assignment': 'Reserved IP',
  
  // DNS
  'digitalocean_domain': 'DNS',
  'digitalocean_record': 'DNS',
  'digitalocean_certificate': 'Certificate',
  
  // Container Registry
  'digitalocean_container_registry': 'Container Registry',
  'digitalocean_container_registry_docker_credentials': 'Container Registry',
  
  // Monitoring
  'digitalocean_monitor_alert': 'Monitoring',
  'digitalocean_uptime_check': 'Uptime',
  'digitalocean_uptime_alert': 'Uptime',
  
  // Project Management
  'digitalocean_project': 'Project',
  'digitalocean_project_resources': 'Project',
  'digitalocean_tag': 'Tag',
  
  // SSH & Access
  'digitalocean_ssh_key': 'SSH Key',
  
  // CDN
  'digitalocean_cdn': 'CDN',
}

// Detect if resource is AWS or DigitalOcean
const getProvider = (service: string): 'aws' | 'digitalocean' | 'unknown' => {
  if (service.startsWith('aws_')) return 'aws'
  if (service.startsWith('digitalocean_')) return 'digitalocean'
  return 'unknown'
}

// AWS official color scheme by service category
const getAWSServiceColor = (service: string): string => {
  const serviceLower = service.toLowerCase()
  
  // Compute - Orange
  if (serviceLower.includes('ec2') || serviceLower.includes('lambda') || 
      serviceLower.includes('ecs') || serviceLower.includes('eks') ||
      serviceLower.includes('fargate') || serviceLower.includes('batch')) {
    return '#ec7211' // AWS Orange
  }
  
  // Storage - Green
  if (serviceLower.includes('s3') || serviceLower.includes('ebs') || 
      serviceLower.includes('efs') || serviceLower.includes('glacier') ||
      serviceLower.includes('storage')) {
    return '#4fa53f' // AWS Green
  }
  
  // Database - Purple
  if (serviceLower.includes('rds') || serviceLower.includes('dynamodb') || 
      serviceLower.includes('elasticache') || serviceLower.includes('redshift') ||
      serviceLower.includes('neptune') || serviceLower.includes('database')) {
    return '#3f48cc' // AWS Blue-Purple
  }
  
  // Networking - Orange-Red
  if (serviceLower.includes('vpc') || serviceLower.includes('subnet') || 
      serviceLower.includes('security_group') || serviceLower.includes('gateway') ||
      serviceLower.includes('alb') || serviceLower.includes('lb') || 
      serviceLower.includes('elb') || serviceLower.includes('route')) {
    return '#de5e1f' // AWS Orange-Red
  }
  
  // Security/IAM - Red
  if (serviceLower.includes('iam') || serviceLower.includes('kms') || 
      serviceLower.includes('secrets') || serviceLower.includes('security')) {
    return '#dd344c' // AWS Red
  }
  
  // API - Purple
  if (serviceLower.includes('api_gateway') || serviceLower.includes('appsync')) {
    return '#8c4fff' // AWS Purple
  }
  
  // Monitoring - Orange
  if (serviceLower.includes('cloudwatch') || serviceLower.includes('xray')) {
    return '#f45900' // AWS Orange
  }
  
  // Messaging - Pink
  if (serviceLower.includes('sns') || serviceLower.includes('sqs')) {
    return '#c925d1' // AWS Pink
  }
  
  // CDN - Orange
  if (serviceLower.includes('cloudfront')) {
    return '#f45900' // AWS Orange
  }
  
  // Analytics - Purple
  if (serviceLower.includes('athena') || serviceLower.includes('glue') ||
      serviceLower.includes('kinesis')) {
    return '#3f48cc' // AWS Blue-Purple
  }
  
  // Default - Gray
  return '#6b7280'
}

// DigitalOcean official color scheme by service category
const getDOServiceColor = (service: string): string => {
  const serviceLower = service.toLowerCase()
  
  // Compute - Blue (DO brand color)
  if (serviceLower.includes('droplet') || serviceLower.includes('kubernetes') || 
      serviceLower.includes('app') || serviceLower.includes('function')) {
    return '#0080FF' // DO Blue
  }
  
  // Storage - Green
  if (serviceLower.includes('spaces') || serviceLower.includes('volume') || 
      serviceLower.includes('snapshot') || serviceLower.includes('storage')) {
    return '#00B386' // DO Green
  }
  
  // Database - Purple
  if (serviceLower.includes('database')) {
    return '#7B61FF' // DO Purple
  }
  
  // Networking - Cyan
  if (serviceLower.includes('vpc') || serviceLower.includes('firewall') || 
      serviceLower.includes('loadbalancer') || serviceLower.includes('floating') ||
      serviceLower.includes('reserved_ip')) {
    return '#00A0D2' // DO Cyan
  }
  
  // DNS - Blue
  if (serviceLower.includes('domain') || serviceLower.includes('record') || 
      serviceLower.includes('certificate')) {
    return '#0069FF' // DO Bright Blue
  }
  
  // Container Registry - Teal
  if (serviceLower.includes('container_registry')) {
    return '#00B5AD' // Teal
  }
  
  // Monitoring - Orange
  if (serviceLower.includes('monitor') || serviceLower.includes('uptime')) {
    return '#FF6B35' // Orange
  }
  
  // Project Management - Gray-Blue
  if (serviceLower.includes('project') || serviceLower.includes('tag')) {
    return '#6772E5' // Gray-Blue
  }
  
  // SSH - Red
  if (serviceLower.includes('ssh_key')) {
    return '#E83E8C' // Pink-Red
  }
  
  // CDN - Purple
  if (serviceLower.includes('cdn')) {
    return '#9B59B6' // Purple
  }
  
  // Default - DO Blue
  return '#0080FF'
}

// Get service color based on provider
const getServiceColor = (service: string): string => {
  const provider = getProvider(service)
  if (provider === 'digitalocean') {
    return getDOServiceColor(service)
  }
  return getAWSServiceColor(service)
}

// Get service abbreviation for display
const getServiceAbbr = (service: string): string => {
  const provider = getProvider(service)
  let serviceName: string
  
  if (provider === 'digitalocean') {
    serviceName = DO_SERVICE_MAP[service] || service.replace('digitalocean_', '').replace(/_/g, ' ')
  } else {
    serviceName = AWS_SERVICE_MAP[service] || service.replace('aws_', '').replace(/_/g, ' ')
  }
  
  const words = serviceName.split(/[\s-]/)
  if (words.length === 1) {
    return words[0].substring(0, 3).toUpperCase()
  }
  return words.map(w => w[0]).join('').toUpperCase().substring(0, 3)
}

export default function AWSIcon({ 
  service, 
  size = 48, 
  className = '',
  variant = 'dark' 
}: AWSIconProps) {
  const provider = getProvider(service)
  let serviceName: string
  
  if (provider === 'digitalocean') {
    serviceName = DO_SERVICE_MAP[service] || service.replace('digitalocean_', '').replace(/_/g, ' ')
  } else {
    serviceName = AWS_SERVICE_MAP[service] || service.replace('aws_', '').replace(/_/g, ' ')
  }
  
  const bgColor = getServiceColor(service)
  const abbr = getServiceAbbr(service)
  
  // AWS-style icon: colored box with white icon/abbreviation
  return (
    <div
      className={`flex items-center justify-center rounded border-2 border-white/30 shadow-lg ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: bgColor,
        minWidth: size,
        minHeight: size,
        position: 'relative',
      }}
      title={serviceName}
    >
      {/* AWS-style icon - white text/icon on colored background */}
      <div className="flex flex-col items-center justify-center">
        <span 
          className="font-bold text-white leading-tight"
          style={{ 
            fontSize: size * 0.25,
            lineHeight: 1,
            fontWeight: 600,
          }}
        >
          {abbr}
        </span>
      </div>
      
      {/* Subtle gradient overlay for AWS-style depth */}
      <div
        className="absolute inset-0 rounded opacity-20"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.3) 0%, rgba(0,0,0,0.1) 100%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
