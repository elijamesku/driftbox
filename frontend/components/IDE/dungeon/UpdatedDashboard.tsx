'use client'

import { useState, useEffect, useMemo, useRef} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useDashboardData, useParseGitHubRepo } from '@/hooks/useInfrastructureData'
import { useRefreshLock } from '@/hooks/useRefreshLock'
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Shield, 
  AlertTriangle, 
  CheckCircle,
  Server,
  Activity,
  Clock,
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
  Flame,
  Eye,
  TrendingDown as Optimize,
  ShieldAlert,
  Tag,
  Trash2,
  PlayCircle,
  StopCircle,
  RotateCcw,
  Lightbulb,
  Bell,
  BarChart3,
  GitCompare,
  Layers
} from 'lucide-react'

interface Resource {
  name: string
  type: string
  file: string
  line?: number
  tf_name?: string
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
}

// Mock data generators for demo - replace with real API calls
const generateCostInsights = (totalResources: number) => {
  return {
    currentMonthly: 1247.85,
    predictedMonthly: 1456.23,
    lastMonthly: 1198.44,
    trend: 8.5,
    anomalies: [
      { resource: 'prod-rds-cluster', change: '+340%', amount: 456.78, reason: 'High CPU usage detected' },
      { resource: 'staging-ec2-large', change: '+120%', amount: 89.23, reason: 'Running 24/7 (usually stopped)' }
    ],
    savingsOpportunities: [
      { resource: 'dev-ec2-xlarge', action: 'Downsize to large', savings: 124.50, confidence: 95 },
      { resource: 'unused-ebs-vol-3', action: 'Delete unused volume', savings: 45.60, confidence: 100 },
      { resource: 'old-snapshot-2023', action: 'Delete old snapshot', savings: 12.30, confidence: 100 }
    ]
  }
}

const generateSecurityInsights = (totalResources: number) => {
  return {
    score: 78,
    critical: 2,
    high: 5,
    medium: 12,
    issues: [
      { resource: 'public-bucket-logs', severity: 'critical', issue: 'S3 bucket publicly accessible', fix: 'Add bucket policy' },
      { resource: 'prod-sg-web', severity: 'critical', issue: 'Security group allows 0.0.0.0/0 on port 22', fix: 'Restrict SSH access' },
      { resource: 'prod-rds', severity: 'high', issue: 'Backup retention only 7 days', fix: 'Increase to 30 days' },
      { resource: 'api-key-dev', severity: 'high', issue: 'IAM key not rotated in 180 days', fix: 'Rotate access keys' },
      { resource: 'prod-ec2-web', severity: 'medium', issue: 'Missing encryption at rest', fix: 'Enable EBS encryption' }
    ]
  }
}

const generateResourceHealth = () => {
  return [
    { resource: 'prod-rds-cluster', health: 45, cpu: 85, memory: 78, disk: 92, status: 'warning' },
    { resource: 'prod-ec2-web-1', health: 92, cpu: 45, memory: 52, disk: 34, status: 'healthy' },
    { resource: 'staging-ec2', health: 98, cpu: 12, memory: 18, disk: 25, status: 'healthy' },
    { resource: 'cache-redis', health: 65, cpu: 72, memory: 88, disk: 45, status: 'warning' }
  ]
}

const generateDriftInsights = (totalResources: number) => {
  return {
    total: 7,
    resources: [
      { name: 'prod-sg-web', type: 'aws_security_group', changes: ['ingress rule added manually'], severity: 'high' },
      { name: 'prod-rds', type: 'aws_db_instance', changes: ['backup_retention changed from 7 to 14'], severity: 'medium' },
      { name: 'cache-redis', type: 'aws_elasticache_cluster', changes: ['node_type changed'], severity: 'low' }
    ]
  }
}

const generateTagCompliance = () => {
  return {
    compliant: 67,
    total: 104,
    missingTags: [
      { resource: 'dev-ec2-test', missing: ['owner', 'cost-center', 'environment'] },
      { resource: 'staging-rds', missing: ['owner', 'cost-center'] },
      { resource: 'prod-ebs-vol-5', missing: ['environment', 'backup'] }
    ]
  }
}

export default function GameChangingDashboard({ selectedRepo, onFileClick }: DashboardProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedType, setSelectedType] = useState<string>('all')
  const [needsParse, setNeedsParse] = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'overview' | 'resources' | 'insights'>('overview')
  const queryClient = useQueryClient()
  
  const parsedRepoRef = useRef<string | null>(null)

  const [owner, repo] = selectedRepo?.full_name.split('/') || [null, null]
  const branch = selectedRepo?.default_branch || 'main'
  const currentRepoKey = owner && repo ? `${owner}/${repo}` : null

  const parseMutation = useParseGitHubRepo()
  const parseCompleted = parseMutation.isSuccess && 
                         !parseMutation.isPending && 
                         parsedRepoRef.current === currentRepoKey

  const { data: dashboardData, isLoading: loading, error: dashboardError, refetch: refetchDashboard } = useDashboardData(
    owner,
    repo,
    !!selectedRepo && parseCompleted
  )

  const lockKey = owner && repo ? `dashboard_${owner}_${repo}` : 'dashboard'
  const { isLocked, timeRemainingFormatted, lockRefresh } = useRefreshLock(lockKey)

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

  const costInsights = useMemo(() => 
    dashboardData ? generateCostInsights(dashboardData.total_resources) : null,
    [dashboardData]
  )

  const securityInsights = useMemo(() => 
    dashboardData ? generateSecurityInsights(dashboardData.total_resources) : null,
    [dashboardData]
  )

  const resourceHealth = useMemo(() => generateResourceHealth(), [])
  const driftInsights = useMemo(() => 
    dashboardData ? generateDriftInsights(dashboardData.total_resources) : null,
    [dashboardData]
  )
  const tagCompliance = useMemo(() => generateTagCompliance(), [])

  const filteredGroups = useMemo(() => {
    if (!dashboardData) return [];
    
    return dashboardData.resources
      .filter(group => selectedType === 'all' || group.type === selectedType)
      .map(group => ({
        ...group,
        resources: group.resources.filter(resource =>
          resource.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          resource.type.toLowerCase().includes(searchQuery.toLowerCase())
        )
      }))
      .filter(group => group.resources.length > 0);
  }, [dashboardData, selectedType, searchQuery]);

  const handleRefresh = async () => {
    if (!selectedRepo || !owner || !repo || isLocked) return
    queryClient.removeQueries({ queryKey: ['dashboard', owner, repo] })
    await refetchDashboard()
    lockRefresh()
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
      <div className="flex-1 w-full h-full flex items-center justify-center bg-[#0A0A0A]">
        <div className="text-center">
          <Server className="w-16 h-16 text-gray-700 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">No Repository Selected</h2>
          <p className="text-gray-400">Select a repository to view AWS resources</p>
        </div>
      </div>
    )
  }

  if (parseMutation.isPending || (loading && !dashboardData)) {
    return (
      <div className="flex-1 w-full h-full flex items-center justify-center bg-[#0A0A0A]">
        <div className="text-center">
          <div className="mb-4 relative inline-block">
            <Server className="w-16 h-16 text-orange-500 animate-pulse" />
            <div className="absolute inset-0 bg-orange-500/20 rounded-full blur-xl animate-pulse" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">
            {parseMutation.isPending ? 'Analyzing Infrastructure' : 'Loading Dashboard'}
          </h2>
          <p className="text-gray-400">AI is scanning your AWS resources...</p>
        </div>
      </div>
    )
  }

  if (!dashboardData || !costInsights || !securityInsights || !driftInsights) {
    return (
      <div className="flex-1 w-full h-full flex items-center justify-center bg-[#0A0A0A]">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-gray-700 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">No Data Available</h2>
          <p className="text-gray-400">Parse your repository first</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full bg-[#0A0A0A] text-white overflow-y-auto">
      {/* Header */}
      <div className="border-b border-gray-800 bg-[#0F0F0F] sticky top-0 z-10">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">Infrastructure Command Center</h1>
                <div className="flex items-center gap-1 px-2 py-1 bg-gray-800 rounded-md text-xs text-gray-400">
                  <GitBranch className="w-3 h-3" />
                  {branch}
                </div>
                <div className="flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-400 rounded-md text-xs font-semibold">
                  <Activity className="w-3 h-3 animate-pulse" />
                  Live
                </div>
              </div>
              <p className="text-sm text-gray-400 mt-1">
                AI-powered infrastructure optimization and cost management
              </p>
            </div>
            <div className="flex gap-2">
              <button className="px-4 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg hover:bg-[#222] transition-colors flex items-center gap-2">
                <Bell className="w-4 h-4" />
                Alerts
                <span className="px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full">7</span>
              </button>
              <button 
                onClick={handleRefresh}
                disabled={isLocked}
                className="px-4 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg hover:bg-[#222] transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <RefreshCw size={16} className={parseMutation.isPending ? 'animate-spin' : ''} />
                {isLocked ? timeRemainingFormatted : 'Refresh'}
              </button>
              <button className="px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-lg transition-all flex items-center gap-2 font-semibold shadow-lg shadow-orange-500/20">
                <Download size={16} />
                Export Report
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-4 mt-4 border-b border-gray-800">
            <button
              onClick={() => setActiveTab('overview')}
              className={`pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'overview'
                  ? 'border-orange-500 text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Overview
              </div>
            </button>
            <button
              onClick={() => setActiveTab('insights')}
              className={`pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'insights'
                  ? 'border-orange-500 text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                AI Insights
                <span className="px-1.5 py-0.5 bg-orange-500 text-white text-xs rounded-full">12</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('resources')}
              className={`pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'resources'
                  ? 'border-orange-500 text-white'
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
            {/* Top Alert Banner */}
            {costInsights.anomalies.length > 0 && (
              <div className="bg-gradient-to-r from-red-500/10 via-orange-500/10 to-red-500/10 border-2 border-red-500/30 rounded-xl p-4">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-red-500/20 rounded-lg">
                    <Flame className="w-6 h-6 text-red-400 animate-pulse" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      <span className="text-red-400">Cost Anomalies Detected!</span>
                      <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">URGENT</span>
                    </h3>
                    <p className="text-sm text-gray-300 mt-1">
                      {costInsights.anomalies.length} resources showing unusual cost patterns
                    </p>
                    <div className="mt-3 space-y-2">
                      {costInsights.anomalies.slice(0, 2).map((anomaly, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-black/30 rounded-lg p-3">
                          <div className="flex items-center gap-3">
                            <Server className="w-4 h-4 text-red-400" />
                            <div>
                              <p className="font-medium text-sm">{anomaly.resource}</p>
                              <p className="text-xs text-gray-400">{anomaly.reason}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <p className="font-bold text-red-400">{anomaly.change}</p>
                              <p className="text-xs text-gray-400">${anomaly.amount.toFixed(2)}/mo</p>
                            </div>
                            <button className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded-md font-semibold transition-colors">
                              Investigate
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Key Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Predicted Cost Card */}
              <div className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border border-orange-500/20 rounded-xl p-5 hover:border-orange-500/40 transition-all hover:shadow-lg hover:shadow-orange-500/10 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-full blur-3xl"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 bg-orange-500/20 rounded-lg">
                      <Target className="w-5 h-5 text-orange-400" />
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      <TrendingUp className="w-3 h-3 text-red-400" />
                      <span className="text-red-400">+{costInsights.trend}%</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-3xl font-bold">${costInsights.predictedMonthly.toFixed(2)}</p>
                    <p className="text-xs text-gray-400">Predicted This Month</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-orange-500/20">
                    <p className="text-xs text-gray-400">
                      Current: <span className="text-white font-semibold">${costInsights.currentMonthly.toFixed(2)}</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Security Score Card */}
              <div className={`bg-gradient-to-br ${
                securityInsights.score >= 80 ? 'from-green-500/10 to-green-600/5 border-green-500/20' :
                securityInsights.score >= 60 ? 'from-yellow-500/10 to-yellow-600/5 border-yellow-500/20' :
                'from-red-500/10 to-red-600/5 border-red-500/20'
              } border rounded-xl p-5 hover:border-opacity-40 transition-all hover:shadow-lg relative overflow-hidden`}>
                <div className={`absolute top-0 right-0 w-32 h-32 ${
                  securityInsights.score >= 80 ? 'bg-green-500/10' :
                  securityInsights.score >= 60 ? 'bg-yellow-500/10' :
                  'bg-red-500/10'
                } rounded-full blur-3xl`}></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`p-2 ${
                      securityInsights.score >= 80 ? 'bg-green-500/20' :
                      securityInsights.score >= 60 ? 'bg-yellow-500/20' :
                      'bg-red-500/20'
                    } rounded-lg`}>
                      <Shield className={`w-5 h-5 ${
                        securityInsights.score >= 80 ? 'text-green-400' :
                        securityInsights.score >= 60 ? 'text-yellow-400' :
                        'text-red-400'
                      }`} />
                    </div>
                    {securityInsights.critical > 0 && (
                      <div className="flex items-center gap-1 px-2 py-1 bg-red-500/20 text-red-400 rounded-md text-xs font-medium">
                        <AlertTriangle className="w-3 h-3" />
                        {securityInsights.critical} critical
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-3xl font-bold">{securityInsights.score}%</p>
                    <p className="text-xs text-gray-400">Security Score</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <p className="text-xs text-gray-400">
                      {securityInsights.critical + securityInsights.high + securityInsights.medium} total issues
                    </p>
                  </div>
                </div>
              </div>

              {/* Drift Detection Card */}
              <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20 rounded-xl p-5 hover:border-purple-500/40 transition-all hover:shadow-lg hover:shadow-purple-500/10 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 bg-purple-500/20 rounded-lg">
                      <GitCompare className="w-5 h-5 text-purple-400" />
                    </div>
                    {driftInsights.total > 0 && (
                      <div className="flex items-center gap-1 px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded-md text-xs font-medium">
                        <AlertTriangle className="w-3 h-3" />
                        Alert
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-3xl font-bold">{driftInsights.total}</p>
                    <p className="text-xs text-gray-400">Resources with Drift</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-purple-500/20">
                    <button className="text-xs text-purple-400 hover:text-purple-300 font-semibold flex items-center gap-1">
                      Auto-fix with AI
                      <Zap className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Savings Opportunities Card */}
              <div className="bg-gradient-to-br from-green-500/10 to-green-600/5 border border-green-500/20 rounded-xl p-5 hover:border-green-500/40 transition-all hover:shadow-lg hover:shadow-green-500/10 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/10 rounded-full blur-3xl"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 bg-green-500/20 rounded-lg">
                      <Lightbulb className="w-5 h-5 text-green-400" />
                    </div>
                    <div className="text-xs text-green-400 font-medium">
                      {costInsights.savingsOpportunities.length} found
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-3xl font-bold text-green-400">
                      ${costInsights.savingsOpportunities.reduce((sum, s) => sum + s.savings, 0).toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-400">Potential Monthly Savings</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-green-500/20">
                    <button className="text-xs text-green-400 hover:text-green-300 font-semibold flex items-center gap-1">
                      View opportunities
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Resource Health Monitoring */}
            <div className="bg-[#0F0F0F] border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 bg-[#151515] border-b border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Activity className="w-5 h-5 text-orange-400" />
                  <div>
                    <h3 className="font-semibold">Resource Health</h3>
                    <p className="text-xs text-gray-400">Real-time performance monitoring</p>
                  </div>
                </div>
                <button className="px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-lg hover:bg-[#222] transition-colors text-sm">
                  View All
                </button>
              </div>
              <div className="p-6 space-y-4">
                {resourceHealth.map((resource, idx) => (
                  <div key={idx} className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${
                          resource.status === 'healthy' ? 'bg-green-400 animate-pulse' :
                          resource.status === 'warning' ? 'bg-yellow-400 animate-pulse' :
                          'bg-red-400 animate-pulse'
                        }`} />
                        <div>
                          <p className="font-medium">{resource.resource}</p>
                          <p className="text-xs text-gray-400">Health Score: {resource.health}%</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors" title="View metrics">
                          <Eye className="w-4 h-4 text-gray-400" />
                        </button>
                        <button className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors" title="Scale">
                          <TrendingUp className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-gray-400">CPU</span>
                          <span className={resource.cpu > 80 ? 'text-red-400' : 'text-gray-300'}>{resource.cpu}%</span>
                        </div>
                        <div className="w-full bg-gray-800 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${
                              resource.cpu > 80 ? 'bg-red-500' :
                              resource.cpu > 60 ? 'bg-yellow-500' :
                              'bg-green-500'
                            }`}
                            style={{ width: `${resource.cpu}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-gray-400">Memory</span>
                          <span className={resource.memory > 80 ? 'text-red-400' : 'text-gray-300'}>{resource.memory}%</span>
                        </div>
                        <div className="w-full bg-gray-800 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${
                              resource.memory > 80 ? 'bg-red-500' :
                              resource.memory > 60 ? 'bg-yellow-500' :
                              'bg-green-500'
                            }`}
                            style={{ width: `${resource.memory}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-gray-400">Disk</span>
                          <span className={resource.disk > 80 ? 'text-red-400' : 'text-gray-300'}>{resource.disk}%</span>
                        </div>
                        <div className="w-full bg-gray-800 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${
                              resource.disk > 80 ? 'bg-red-500' :
                              resource.disk > 60 ? 'bg-yellow-500' :
                              'bg-green-500'
                            }`}
                            style={{ width: `${resource.disk}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Two Column Layout - Security + Tag Compliance */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Security Issues */}
              <div className="bg-[#0F0F0F] border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 bg-[#151515] border-b border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ShieldAlert className="w-5 h-5 text-red-400" />
                    <div>
                      <h3 className="font-semibold">Security Issues</h3>
                      <p className="text-xs text-gray-400">{securityInsights.critical} critical, {securityInsights.high} high priority</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  {securityInsights.issues.slice(0, 5).map((issue, idx) => (
                    <div key={idx} className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                              issue.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                              issue.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                              'bg-yellow-500/20 text-yellow-400'
                            }`}>
                              {issue.severity.toUpperCase()}
                            </span>
                            <p className="font-medium text-sm truncate">{issue.resource}</p>
                          </div>
                          <p className="text-xs text-gray-400">{issue.issue}</p>
                          <p className="text-xs text-green-400 mt-1">→ {issue.fix}</p>
                        </div>
                        <button className="px-3 py-1 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded-md font-semibold transition-colors flex-shrink-0">
                          Fix
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tag Compliance */}
              <div className="bg-[#0F0F0F] border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 bg-[#151515] border-b border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Tag className="w-5 h-5 text-blue-400" />
                    <div>
                      <h3 className="font-semibold">Tag Compliance</h3>
                      <p className="text-xs text-gray-400">{tagCompliance.compliant} of {tagCompliance.total} resources compliant</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold">{Math.round((tagCompliance.compliant / tagCompliance.total) * 100)}%</p>
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  {tagCompliance.missingTags.slice(0, 5).map((item, idx) => (
                    <div key={idx} className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm mb-1 truncate">{item.resource}</p>
                          <div className="flex flex-wrap gap-1">
                            {item.missing.map((tag, tagIdx) => (
                              <span key={tagIdx} className="px-2 py-0.5 bg-gray-800 text-gray-400 text-xs rounded">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded-md font-semibold transition-colors flex-shrink-0">
                          Add Tags
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* AI INSIGHTS TAB */}
        {activeTab === 'insights' && (
          <div className="space-y-6">
            {/* Cost Optimization */}
            <div className="bg-[#0F0F0F] border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 bg-[#151515] border-b border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-500/20 rounded-lg">
                    <Optimize className="w-5 h-5 text-green-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Cost Optimization Recommendations</h3>
                    <p className="text-xs text-gray-400">Save ${costInsights.savingsOpportunities.reduce((sum, s) => sum + s.savings, 0).toFixed(2)}/month with these changes</p>
                  </div>
                </div>
              </div>
              <div className="p-6 space-y-4">
                {costInsights.savingsOpportunities.map((opportunity, idx) => (
                  <div key={idx} className="bg-gradient-to-r from-green-500/5 to-transparent border border-green-500/20 rounded-lg p-4 hover:border-green-500/40 transition-all">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Lightbulb className="w-4 h-4 text-green-400" />
                          <p className="font-semibold">{opportunity.resource}</p>
                          <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded font-semibold">
                            {opportunity.confidence}% confident
                          </span>
                        </div>
                        <p className="text-sm text-gray-300 mb-1">{opportunity.action}</p>
                        <p className="text-2xl font-bold text-green-400">${opportunity.savings.toFixed(2)}/mo savings</p>
                      </div>
                      <div className="flex flex-col gap-2">
                        <button className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg font-semibold transition-colors">
                          Apply Change
                        </button>
                        <button className="px-4 py-2 bg-[#1a1a1a] border border-gray-700 hover:bg-[#222] text-gray-300 text-sm rounded-lg transition-colors">
                          Learn More
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Drift Auto-Fix */}
            <div className="bg-[#0F0F0F] border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 bg-[#151515] border-b border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500/20 rounded-lg">
                    <RotateCcw className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Configuration Drift</h3>
                    <p className="text-xs text-gray-400">{driftInsights.total} resources out of sync with Terraform</p>
                  </div>
                </div>
                <button className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white text-sm rounded-lg font-semibold transition-colors flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Auto-Fix All
                </button>
              </div>
              <div className="p-6 space-y-4">
                {driftInsights.resources.map((drift, idx) => (
                  <div key={idx} className={`border rounded-lg p-4 ${
                    drift.severity === 'high' ? 'bg-red-500/5 border-red-500/20' :
                    drift.severity === 'medium' ? 'bg-yellow-500/5 border-yellow-500/20' :
                    'bg-blue-500/5 border-blue-500/20'
                  }`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                            drift.severity === 'high' ? 'bg-red-500/20 text-red-400' :
                            drift.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {drift.severity.toUpperCase()}
                          </span>
                          <p className="font-semibold">{drift.name}</p>
                        </div>
                        <p className="text-sm text-gray-400 mb-2">{drift.type}</p>
                        <div className="space-y-1">
                          {drift.changes.map((change, changeIdx) => (
                            <p key={changeIdx} className="text-sm text-gray-300">• {change}</p>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <button className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white text-sm rounded-lg font-semibold transition-colors whitespace-nowrap">
                          Generate Fix
                        </button>
                        <button className="px-4 py-2 bg-[#1a1a1a] border border-gray-700 hover:bg-[#222] text-gray-300 text-sm rounded-lg transition-colors whitespace-nowrap">
                          View Diff
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
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
                      className="w-full pl-10 pr-4 py-2.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/50 transition-all"
                    />
                  </div>
                </div>
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="px-4 py-2.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/50 transition-all cursor-pointer"
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
                      <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                        <span className="text-2xl">{group.icon}</span>
                      </div>
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
                                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
                                  <div className="min-w-0">
                                    <div className="font-medium text-white truncate">{resource.name}</div>
                                    <div className="text-xs text-gray-400 truncate">{resource.type}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 w-[25%]">
                                <code className="text-sm text-orange-400 font-mono bg-orange-500/10 px-2 py-1 rounded block truncate">
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}

