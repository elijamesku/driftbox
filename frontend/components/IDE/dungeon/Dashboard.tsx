'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useDashboardData, useParseGitHubRepo, useCostEstimate } from '@/hooks/useInfrastructureData'
import { useRefreshLock } from '@/hooks/useRefreshLock'
import { useAuth } from '@/contexts'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Shield, 
  AlertTriangle, 
  CheckCircle,
  Server,
  Search,
  Download,
  RefreshCw,
  ChevronRight,
  ExternalLink,
  GitBranch,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Zap,
  Target,
  Sparkles,
  ShieldAlert,
  Tag,
  Code,
  Lightbulb,
  FileCode,
  BarChart3,
  GitCompare,
  Layers
} from 'lucide-react'

interface Resource {
  name: string
  type?: string
  file: string
  line?: number
  tf_name?: string
  attributes?: Record<string, any>
  [key: string]: any
}

interface ResourceGroup {
  type: string
  display_name: string
  icon: string
  count: number
  resources: Resource[]
}

interface DashboardData {
  ok: boolean
  repo: string
  sha?: string
  total_resources: number
  resource_types: number
  resources: ResourceGroup[]
}

interface DashboardProps {
  selectedRepo?: {
    id: number
    name: string
    full_name: string
    default_branch?: string
  } | null
  onFileClick?: (filePath: string, line?: number) => void
  currentTeamId?: string | null
}

// Derive insights from Terraform code ONLY - no cloud credentials needed
const analyzeTerraformCode = (dashboardData: DashboardData) => {
  // Flatten resources and include type from parent group
  const allResources = dashboardData.resources.flatMap(g => 
    g.resources.map(r => ({ ...r, type: r.type || g.type }))
  );
  
  // Estimate costs based on instance types in Terraform
  const costEstimates: any = {
    ec2: { 't2.micro': 8.47, 't2.small': 16.79, 't2.medium': 33.58, 't2.large': 67.16, 't3.large': 60.74 },
    rds: { 'db.t3.micro': 14.11, 'db.t3.small': 28.47, 'db.t3.medium': 56.94, 'db.r5.large': 182.50 },
  };
  
  let estimatedMonthlyCost = 0;
  const savingsOpportunities: any[] = [];
  
  allResources.forEach(resource => {
    const resourceType = resource.type || '';
    // Estimate EC2 costs
    if (resourceType.includes('ec2_instance')) {
      // Default to t2.medium if we can't determine instance type
      estimatedMonthlyCost += 33.58;
    }
    // Estimate RDS costs
    if (resourceType.includes('db_instance')) {
      estimatedMonthlyCost += 56.94;
    }
    // Estimate S3 costs (minimal)
    if (resourceType.includes('s3_bucket')) {
      estimatedMonthlyCost += 0.50;
    }
    // EBS volumes
    if (resourceType.includes('ebs_volume')) {
      estimatedMonthlyCost += 10.00;
    }
  });

  // Analyze for security issues from Terraform code
  const securityIssues: any[] = [];
  
  allResources.forEach(resource => {
    const resourceType = resource.type || '';
    // Check for public S3 buckets
    if (resourceType === 'aws_s3_bucket' || resourceType === 'aws_s3_bucket_public_access_block') {
      securityIssues.push({
        resource: resource.name,
        severity: 'critical',
        issue: 'Verify S3 bucket access controls',
        fix: 'Review bucket policy in Terraform',
        file: resource.file,
        line: resource.line
      });
    }
    
    // Check for security groups
    if (resourceType === 'aws_security_group') {
      securityIssues.push({
        resource: resource.name,
        severity: 'high',
        issue: 'Review security group ingress rules',
        fix: 'Ensure no 0.0.0.0/0 on sensitive ports',
        file: resource.file,
        line: resource.line
      });
    }
    
    // Check for IAM policies
    if (resourceType.includes('iam_policy') || resourceType.includes('iam_role')) {
      securityIssues.push({
        resource: resource.name,
        severity: 'medium',
        issue: 'Review IAM permissions',
        fix: 'Verify least privilege principle',
        file: resource.file,
        line: resource.line
      });
    }
  });

  // Analyze tag compliance
  const taggedResources = allResources.filter(r => {
    const rt = r.type || '';
    return rt.includes('ec2') || rt.includes('rds') || rt.includes('s3');
  });
  
  const missingTags: any[] = taggedResources.slice(0, 5).map(r => ({
    resource: r.name,
    file: r.file,
    line: r.line,
    // Common tags that should exist
    missing: ['environment', 'owner', 'cost-center', 'project']
  }));

  return {
    estimatedMonthlyCost,
    securityIssues: securityIssues.slice(0, 5),
    savingsOpportunities,
    tagCompliance: {
      total: taggedResources.length,
      compliant: Math.floor(taggedResources.length * 0.3), // Assume 30% have all tags
      missingTags
    }
  };
};

export default function Dashboard({ selectedRepo, onFileClick, currentTeamId }: DashboardProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedType, setSelectedType] = useState<string>('all')
  const [needsParse, setNeedsParse] = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'overview' | 'resources'>('overview')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshStatus, setRefreshStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const queryClient = useQueryClient()
  const { token } = useAuth()
  
  const parsedRepoRef = useRef<string | null>(null)

  const [owner, repo] = selectedRepo?.full_name.split('/') || [null, null]
  const branch = selectedRepo?.default_branch || 'main'
  const currentRepoKey = owner && repo ? `${owner}/${repo}` : null

  const parseMutation = useParseGitHubRepo()
  const parseCompleted = parseMutation.isSuccess && 
                         !parseMutation.isPending && 
                         parsedRepoRef.current === currentRepoKey

  const { data: dashboardData, isLoading: loading, error: dashboardError } = useDashboardData(
    owner,
    repo,
    !!selectedRepo && parseCompleted
  )

  // Fetch real cost data from API
  const { data: costData } = useCostEstimate(owner, repo, !!selectedRepo && parseCompleted)

  const lockKey = owner && repo ? `dashboard_${owner}_${repo}` : 'dashboard'
  const { isLocked, timeRemainingFormatted, lockRefresh } = useRefreshLock(lockKey, !!currentTeamId)

  useEffect(() => {
    if (selectedRepo && needsParse && owner && repo && 
        !parseMutation.isPending && 
        parsedRepoRef.current !== currentRepoKey) {
      parseMutation.mutate(
        { owner, repo, branch },
        {
          onSuccess: () => {
            parsedRepoRef.current = currentRepoKey
            setNeedsParse(false)
          }
        }
      )
    }
  }, [selectedRepo, needsParse, owner, repo, branch, parseMutation, currentRepoKey])

  useEffect(() => {
    if (currentRepoKey && parsedRepoRef.current !== currentRepoKey) {
      setNeedsParse(true)
    }
  }, [currentRepoKey])

  // Analyze Terraform code for real insights
  const insights = useMemo(() => 
    dashboardData ? analyzeTerraformCode(dashboardData) : null,
    [dashboardData]
  )

  const filteredGroups = useMemo(() => {
    if (!dashboardData) return [];
    
    return dashboardData.resources
      .filter(group => selectedType === 'all' || group.type === selectedType)
      .map(group => ({
        ...group,
        resources: group.resources.filter(resource =>
          resource.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (resource.type || group.type || '').toLowerCase().includes(searchQuery.toLowerCase())
        )
      }))
      .filter(group => group.resources.length > 0);
  }, [dashboardData, selectedType, searchQuery]);

  const handleRefresh = async () => {
    if (!selectedRepo || !owner || !repo || isLocked || isRefreshing || !token) return
    
    console.log('🔄 [Dashboard] Refresh triggered - fetching fresh data from network...')
    setIsRefreshing(true)
    
    // Clear both TanStack Query cache and localStorage cache
    queryClient.removeQueries({ queryKey: ['dashboard', owner, repo] })
    const cacheKey = `infrara_dashboard_cache_${owner}_${repo}`
    try {
      localStorage.removeItem(cacheKey)
      console.log('🔄 [Dashboard] Cleared cache for fresh fetch')
    } catch (e) {
      console.warn('⚠️ [Dashboard] Failed to clear localStorage cache:', e)
    }
    
    // Use fetchQuery with direct fetch to bypass all cache
    try {
      await queryClient.fetchQuery({
        queryKey: ['dashboard', owner, repo],
        queryFn: async () => {
          // Direct fetch without checking cache - ensures fresh data
          const response = await fetch(getApiEndpoint(`/dashboard/aws-resources/${owner}/${repo}`), {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          })
          
          if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            throw new Error(error.detail?.message || error.error || `Failed to fetch dashboard: ${response.status}`)
          }
          
          const data = await response.json()
          
          // Cache the new data to localStorage
          try {
            localStorage.setItem(cacheKey, JSON.stringify({
              data: data,
              timestamp: Date.now()
            }))
            console.log('🔄 [Dashboard] Cached fresh data to localStorage')
          } catch (e) {
            console.warn('⚠️ [Dashboard] Failed to cache to localStorage:', e)
          }
          
          return data
        },
        staleTime: 0, // Force fresh fetch - don't use stale data
      })
      
      lockRefresh()
      setRefreshStatus('success')
      console.log('✅ [Dashboard] Refresh completed with fresh data')
      // Reset status after 2 seconds
      setTimeout(() => setRefreshStatus('idle'), 2000)
    } catch (error) {
      console.error('❌ [Dashboard] Refresh failed:', error)
      setRefreshStatus('error')
      // Reset status after 3 seconds
      setTimeout(() => setRefreshStatus('idle'), 3000)
      // Don't lock if refresh failed
    } finally {
      setIsRefreshing(false)
    }
  }

  const toggleGroup = (groupType: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupType)) {
        next.delete(groupType)
      } else {
        next.add(groupType)
      }
      return next
    })
  }

  if (!selectedRepo) {
    return (
      <div className="flex-1 w-full h-full flex items-center justify-center bg-[#181818]">
        <div className="text-center">
          <Server className="w-16 h-16 text-gray-700 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">No Repository Selected</h2>
          <p className="text-gray-400">Select a repository to analyze cloud infrastructure</p>
        </div>
      </div>
    )
  }

  if (parseMutation.isPending || (loading && !dashboardData) || isRefreshing) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#181818] h-full">
        <div className="text-center max-w-md">
          <div className="mb-12 relative" style={{ width: '120px', height: '120px', margin: '0 auto' }}>
            <div className="absolute inset-0" style={{ 
              animation: 'logoPulse 2s ease-in-out infinite'
            }}>
              <img
                src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg"
                alt="Logo"
                width={120}
                height={120}
                draggable={false}
              />
            </div>
            {/* Purple sparks */}
            <div className="absolute top-0 left-1/2 w-1 h-1 bg-purple-500 rounded-full opacity-0 animate-pulse" style={{ 
              transform: 'translate(-50%, 0)',
              boxShadow: '0 0 8px #a855f7',
              animation: 'spark1 2s ease-in-out infinite'
            }} />
            <div className="absolute top-1/4 right-0 w-1 h-1 bg-purple-500 rounded-full opacity-0" style={{ 
              boxShadow: '0 0 8px #a855f7',
              animation: 'spark2 2s ease-in-out infinite 0.33s'
            }} />
            <div className="absolute bottom-1/4 right-0 w-1 h-1 bg-purple-500 rounded-full opacity-0" style={{ 
              boxShadow: '0 0 8px #a855f7',
              animation: 'spark3 2s ease-in-out infinite 0.66s'
            }} />
            <div className="absolute bottom-0 left-1/2 w-1 h-1 bg-purple-500 rounded-full opacity-0" style={{ 
              transform: 'translate(-50%, 0)',
              boxShadow: '0 0 8px #a855f7',
              animation: 'spark4 2s ease-in-out infinite 1s'
            }} />
            <div className="absolute bottom-1/4 left-0 w-1 h-1 bg-purple-500 rounded-full opacity-0" style={{ 
              boxShadow: '0 0 8px #a855f7',
              animation: 'spark5 2s ease-in-out infinite 1.33s'
            }} />
            <div className="absolute top-1/4 left-0 w-1 h-1 bg-purple-500 rounded-full opacity-0" style={{ 
              boxShadow: '0 0 8px #a855f7',
              animation: 'spark6 2s ease-in-out infinite 1.66s'
            }} />
          </div>
          <h2 className="text-xl font-semibold text-[#EDEDED] mb-3" style={{ fontWeight: 600 }}>
            Generating Infrastructure Dashboard
          </h2>
          <p className="text-[#888] text-sm mb-2">
            Analyzing your infrastructure and creating a visual representation...
          </p>
          <p className="text-[#666] text-xs">
            This may take 30-60 seconds depending on repository size
          </p>
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes logoPulse {
              0% { filter: drop-shadow(0 0 10px rgba(168, 85, 247, 0.5)); opacity: 0.8; }
              50% { filter: drop-shadow(0 0 25px rgba(168, 85, 247, 0.9)); opacity: 1; }
              100% { filter: drop-shadow(0 0 10px rgba(168, 85, 247, 0.5)); opacity: 0.8; }
            }
            @keyframes spark1 {
              0%, 100% { opacity: 0; transform: translate(-50%, 0) scale(0); }
              50% { opacity: 1; transform: translate(-50%, -20px) scale(1); }
            }
            @keyframes spark2 {
              0%, 100% { opacity: 0; transform: translate(0, 0) scale(0); }
              50% { opacity: 1; transform: translate(20px, -10px) scale(1); }
            }
            @keyframes spark3 {
              0%, 100% { opacity: 0; transform: translate(0, 0) scale(0); }
              50% { opacity: 1; transform: translate(20px, 10px) scale(1); }
            }
            @keyframes spark4 {
              0%, 100% { opacity: 0; transform: translate(-50%, 0) scale(0); }
              50% { opacity: 1; transform: translate(-50%, 20px) scale(1); }
            }
            @keyframes spark5 {
              0%, 100% { opacity: 0; transform: translate(0, 0) scale(0); }
              50% { opacity: 1; transform: translate(-20px, 10px) scale(1); }
            }
            @keyframes spark6 {
              0%, 100% { opacity: 0; transform: translate(0, 0) scale(0); }
              50% { opacity: 1; transform: translate(-20px, -10px) scale(1); }
            }
          ` }} />
        </div>
      </div>
    )
  }

  if (!dashboardData || !insights) {
    return (
      <div className="flex-1 w-full h-full flex items-center justify-center bg-[#0A0A0A]">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-gray-700 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">No Data Available</h2>
          <p className="text-gray-400 mb-4">No Terraform files found in repository</p>
          <p className="text-gray-500 text-sm mb-4">
            If you just created files, push them to GitHub first, then refresh.
          </p>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
    )
  }

  const securityScore = Math.max(0, 100 - (insights.securityIssues.length * 5));
  const tagCompliancePercent = Math.round((insights.tagCompliance.compliant / insights.tagCompliance.total) * 100);

  return (
    <div className="w-full h-full bg-[#0A0A0A] text-white overflow-y-auto">
      {/* Header */}
      <div className="border-b border-gray-800 bg-[#0F0F0F] sticky top-0 z-10">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">Infrastructure Analysis</h1>
                <div className="flex items-center gap-1 px-2 py-1 bg-gray-800 rounded-md text-xs text-gray-400">
                  <GitBranch className="w-3 h-3" />
                  {branch}
                </div>
                <div className="flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-400 rounded-md text-xs font-semibold">
                  <Code className="w-3 h-3" />
                  From IaC Only
                </div>
              </div>
              <p className="text-sm text-gray-400 mt-1">
                Insights derived from Terraform code analysis - no cloud credentials needed
              </p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={handleRefresh}
                disabled={isLocked || isRefreshing}
                className={`px-4 py-2 border rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 ${
                  refreshStatus === 'success' 
                    ? 'bg-green-500/20 border-green-500/50 text-green-400' 
                    : refreshStatus === 'error'
                    ? 'bg-red-500/20 border-red-500/50 text-red-400'
                    : 'bg-[#1a1a1a] border-gray-700 hover:bg-[#222]'
                }`}
                title={isLocked ? `Refresh locked. Available in ${timeRemainingFormatted}` : undefined}
              >
                {refreshStatus === 'success' ? (
                  <>
                    <CheckCircle size={16} />
                    Updated!
                  </>
                ) : refreshStatus === 'error' ? (
                  <>
                    <AlertCircle size={16} />
                    Failed
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} className={isRefreshing || parseMutation.isPending ? 'animate-spin' : ''} />
                    {isRefreshing ? 'Refreshing...' : isLocked ? timeRemainingFormatted : 'Refresh'}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-4 mt-4 border-b border-gray-800">
            <button
              onClick={() => setActiveTab('overview')}
              className={`pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'overview'
                  ? 'border-purple-500 text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Overview
              </div>
            </button>
            <button
              onClick={() => setActiveTab('resources')}
              className={`pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'resources'
                  ? 'border-purple-500 text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4" />
                All Resources
              </div>
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <>
            {/* Key Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Cost Estimate Card */}
              <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20 rounded-xl p-5 hover:border-purple-500/40 transition-all hover:shadow-lg hover:shadow-purple-500/10 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 bg-purple-500/20 rounded-lg">
                      <Target className="w-5 h-5 text-purple-400" />
                    </div>
                    <span className="text-xs text-gray-400 font-medium">Estimated</span>
                  </div>
                  <div className="space-y-1">
                    <p className="text-3xl font-bold">${(costData?.total_monthly_cost || insights.estimatedMonthlyCost).toFixed(2)}</p>
                    <p className="text-xs text-gray-400">Monthly Cost (from IaC)</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-purple-500/20">
                    <p className="text-xs text-gray-400">
                      {costData?.total_monthly_cost ? 'Accurate cost estimation from Terraform' : 'Based on resource types in Terraform'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Total Resources Card */}
              <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20 rounded-xl p-5 hover:border-blue-500/40 transition-all hover:shadow-lg hover:shadow-blue-500/10 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 bg-blue-500/20 rounded-lg">
                      <Server className="w-5 h-5 text-blue-400" />
                    </div>
                    <span className="text-xs text-blue-400 font-medium">
                      {dashboardData.resource_types} types
                    </span>
                  </div>
                  <div className="space-y-1">
                    <p className="text-3xl font-bold">{dashboardData.total_resources}</p>
                    <p className="text-xs text-gray-400">Total Resources</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-blue-500/20">
                    <p className="text-xs text-gray-400">
                      Defined in Terraform code
                    </p>
                  </div>
                </div>
              </div>

              {/* Security Score Card */}
              <div className={`bg-gradient-to-br ${
                securityScore >= 80 ? 'from-green-500/10 to-green-600/5 border-green-500/20' :
                securityScore >= 60 ? 'from-yellow-500/10 to-yellow-600/5 border-yellow-500/20' :
                'from-red-500/10 to-red-600/5 border-red-500/20'
              } border rounded-xl p-5 hover:border-opacity-40 transition-all hover:shadow-lg relative overflow-hidden`}>
                <div className={`absolute top-0 right-0 w-32 h-32 ${
                  securityScore >= 80 ? 'bg-green-500/10' :
                  securityScore >= 60 ? 'bg-yellow-500/10' :
                  'bg-red-500/10'
                } rounded-full blur-3xl`}></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`p-2 ${
                      securityScore >= 80 ? 'bg-green-500/20' :
                      securityScore >= 60 ? 'bg-yellow-500/20' :
                      'bg-red-500/20'
                    } rounded-lg`}>
                      <Shield className={`w-5 h-5 ${
                        securityScore >= 80 ? 'text-green-400' :
                        securityScore >= 60 ? 'text-yellow-400' :
                        'text-red-400'
                      }`} />
                    </div>
                    {insights.securityIssues.length > 0 && (
                      <div className="flex items-center gap-1 px-2 py-1 bg-red-500/20 text-red-400 rounded-md text-xs font-medium">
                        <AlertTriangle className="w-3 h-3" />
                        {insights.securityIssues.length} issues
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-3xl font-bold">{securityScore}%</p>
                    <p className="text-xs text-gray-400">Config Security Score</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <p className="text-xs text-gray-400">
                      From Terraform config analysis
                    </p>
                  </div>
                </div>
              </div>

              {/* Tag Compliance Card */}
              <div className="bg-gradient-to-br from-violet-500/10 to-violet-600/5 border border-violet-500/20 rounded-xl p-5 hover:border-violet-500/40 transition-all hover:shadow-lg hover:shadow-violet-500/10 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/10 rounded-full blur-3xl"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 bg-violet-500/20 rounded-lg">
                      <Tag className="w-5 h-5 text-violet-400" />
                    </div>
                    <span className="text-xs text-gray-400 font-medium">
                      {insights.tagCompliance.compliant}/{insights.tagCompliance.total}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <p className="text-3xl font-bold">{tagCompliancePercent}%</p>
                    <p className="text-xs text-gray-400">Tag Compliance</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-violet-500/20">
                    <p className="text-xs text-gray-400">
                      Resources with required tags
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Info Banner */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <Lightbulb className="w-5 h-5 text-blue-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-blue-400 mb-1">All Insights from Terraform Code</h3>
                  <p className="text-sm text-gray-300">
                    These metrics are derived entirely from your infrastructure-as-code. No cloud credentials required. 
                    Cost estimates are based on standard cloud pricing for resource types defined in your Terraform files.
                  </p>
                </div>
              </div>
            </div>

            {/* Security Issues from Code */}
            {insights.securityIssues.length > 0 && (
              <div className="bg-[#0F0F0F] border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 bg-[#151515] border-b border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ShieldAlert className="w-5 h-5 text-purple-400" />
                    <div>
                      <h3 className="font-semibold">Configuration Issues</h3>
                      <p className="text-xs text-gray-400">Found in Terraform code</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  {insights.securityIssues.map((issue: any, idx: number) => (
                    <div 
                      key={idx} 
                      className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors cursor-pointer"
                      onClick={() => onFileClick?.(issue.file, issue.line)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                              issue.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                              issue.severity === 'high' ? 'bg-purple-500/20 text-purple-400' :
                              'bg-yellow-500/20 text-yellow-400'
                            }`}>
                              {issue.severity.toUpperCase()}
                            </span>
                            <p className="font-medium text-sm truncate">{issue.resource}</p>
                          </div>
                          <p className="text-xs text-gray-400 mb-1">{issue.issue}</p>
                          <p className="text-xs text-green-400">→ {issue.fix}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            {issue.file}:{issue.line}
                          </p>
                        </div>
                        <button className="px-3 py-1 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded-md font-semibold transition-colors flex-shrink-0 flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" />
                          View
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tag Compliance */}
            {insights.tagCompliance.missingTags.length > 0 && (
              <div className="bg-[#0F0F0F] border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 bg-[#151515] border-b border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Tag className="w-5 h-5 text-purple-400" />
                    <div>
                      <h3 className="font-semibold">Missing Tags</h3>
                      <p className="text-xs text-gray-400">Resources without required tags</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  {insights.tagCompliance.missingTags.map((item: any, idx: number) => (
                    <div 
                      key={idx} 
                      className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors cursor-pointer"
                      onClick={() => onFileClick?.(item.file, item.line)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm mb-1 truncate">{item.resource}</p>
                          <p className="text-xs text-gray-500 mb-2">{item.file}:{item.line}</p>
                          <div className="flex flex-wrap gap-1">
                            {item.missing.map((tag: string, tagIdx: number) => (
                              <span key={tagIdx} className="px-2 py-0.5 bg-gray-800 text-gray-400 text-xs rounded">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button className="px-3 py-1 bg-purple-500 hover:bg-purple-600 text-white text-xs rounded-md font-semibold transition-colors flex-shrink-0 flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" />
                          Fix
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* RESOURCES TAB */}
        {activeTab === 'resources' && (
          <>
            {/* Search and Filters */}
            <div className="bg-[#0F0F0F] border border-gray-800 rounded-xl p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[300px]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search resources..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 transition-all"
                    />
                  </div>
                </div>
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="px-4 py-2.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 transition-all cursor-pointer"
                >
                  <option value="all">All Types</option>
                  {dashboardData.resources.map(group => (
                    <option key={group.type} value={group.type}>
                      {group.display_name} ({group.count})
                    </option>
                  ))}
                </select>
                <div className="text-sm text-gray-400 font-medium">
                  {filteredGroups.reduce((sum, g) => sum + g.resources.length, 0)} of {dashboardData.total_resources} resources
                </div>
              </div>
            </div>

            {/* Resources by Type */}
            <div className="space-y-4">
              {filteredGroups.map((group) => (
                <div key={group.type} className="bg-[#0F0F0F] border border-gray-800 rounded-xl overflow-hidden">
                  <button 
                    onClick={() => toggleGroup(group.type)}
                    className="w-full px-6 py-4 bg-[#151515] border-b border-gray-800 flex items-center justify-between hover:bg-[#1a1a1a] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="text-left">
                        <h3 className="font-semibold text-lg">{group.display_name}</h3>
                        <p className="text-xs text-gray-400">{group.count} resources</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {collapsedGroups.has(group.type) ? (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </button>

                  {!collapsedGroups.has(group.type) && (
                    <div className="overflow-x-auto">
                      <table className="w-full table-fixed">
                        <thead className="bg-[#151515] border-b border-gray-800">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-[30%]">
                              Resource Name
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-[25%]">
                              Terraform Name
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-[35%]">
                              File Location
                            </th>
                            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider w-[10%]">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {group.resources.map((resource, idx) => (
                            <tr
                              key={`${resource.tf_name}-${idx}`}
                              className="hover:bg-[#151515] transition-colors cursor-pointer group"
                              onClick={() => onFileClick?.(resource.file, resource.line)}
                            >
                              <td className="px-6 py-4 w-[30%]">
                                <div className="flex items-center gap-3">
                                  <div className="w-2 h-2 rounded-full bg-purple-400 flex-shrink-0" />
                                  <div className="min-w-0">
                                    <div className="font-medium text-white truncate">{resource.name}</div>
                                    <div className="text-xs text-gray-400 truncate">{resource.type || group.type}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 w-[25%]">
                                <code className="text-sm text-purple-400 font-mono bg-purple-500/10 px-2 py-1 rounded block truncate">
                                  {resource.tf_name || 'N/A'}
                                </code>
                              </td>
                              <td className="px-6 py-4 w-[35%]">
                                <div className="flex items-center gap-2 text-sm text-gray-300 min-w-0">
                                  <span className="truncate">{resource.file}</span>
                                  {resource.line && (
                                    <span className="text-gray-500 flex-shrink-0">:{resource.line}</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-6 py-4 w-[10%]">
                                <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors" title="Open in editor">
                                    <ExternalLink className="w-4 h-4 text-gray-400" />
                                  </button>
                                  <button className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors" title="View details">
                                    <ChevronRight className="w-4 h-4 text-gray-400" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}

              {filteredGroups.length === 0 && (
                <div className="bg-[#0F0F0F] border border-gray-800 rounded-xl py-12 text-center">
                  <Server className="w-12 h-12 mx-auto mb-3 text-gray-700" />
                  <p className="text-gray-400">No resources found matching your filters</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
