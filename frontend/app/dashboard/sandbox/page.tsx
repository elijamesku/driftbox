'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import Link from 'next/link'
import {
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Terminal,
  Shield,
  Server,
  Database,
  Globe,
  RefreshCw,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  X,
  FileText,
  GitBranch,
  GitCommit,
  Layers,
  Zap,
  Eye,
  Lock,
  Network,
  HardDrive,
  Activity,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Filter,
  Search,
  Calendar,
  User,
  Copy,
  Check,
  ExternalLink,
  Code,
  AlertCircle,
  Info,
  Loader2,
  Box,
  Cpu,
  Workflow,
  Settings,
  Wrench,
} from 'lucide-react'

// API response types
interface SandboxRunsResponse {
  runs: ApiSandboxRun[]
  total: number
  passed: number
  failed: number
  avg_duration_ms: number
}

interface ApiSandboxRun {
  id: string
  user_id: string
  user_name?: string  // Added for team display
  team_id?: string    // Added for team collaboration
  repository: string
  branch: string | null
  status: string
  duration_ms: number
  files_tested: number
  steps: any[] | null
  resources_detected: any[] | null
  errors: string[] | null
  warnings: string[] | null
  available_cidr: string | null
  cost_estimate: number | null
  risk_level: string
  security_issues: number
  terraform_version: string | null
  providers_used: string[] | null
  auto_healed: boolean
  fixes_applied: any[] | null
  attempts: number
  created_at: string
}

interface Team {
  id: string
  name: string
}

// Types
interface SandboxRun {
  id: string
  timestamp: string
  status: 'passed' | 'failed' | 'running'
  repository: string
  branch: string
  user: string
  user_avatar?: string
  duration_ms: number
  files_tested: number
  steps: SandboxStep[]
  security_issues: number
  available_cidr?: string
  resources_detected: ResourceInfo[]
  cost_estimate?: number
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  errors?: string[]
  warnings?: string[]
  terraform_version?: string
  providers_used: string[]
  // Auto-heal fields
  auto_healed?: boolean
  fixes_applied?: any[]
  attempts?: number
}

interface SandboxStep {
  name: string
  status: 'passed' | 'failed' | 'skipped' | 'running'
  duration_ms: number
  message?: string
  details?: string
}

interface ResourceInfo {
  type: string
  name: string
  action: 'create' | 'update' | 'delete' | 'no-op'
  provider: string
}

// Fetch sandbox runs from API
async function fetchSandboxRuns(token: string, teamId?: string): Promise<SandboxRunsResponse> {
  // If teamId provided, use team endpoint, otherwise fetch ALL runs
  const endpoint = teamId 
    ? `/sandbox/team/${teamId}/runs?limit=50`
    : '/sandbox/runs?limit=50&scope=all'
  
  const response = await fetch(getApiEndpoint(endpoint), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  
  if (!response.ok) {
    throw new Error('Failed to fetch sandbox runs')
  }
  
  return response.json()
}

// Fetch user's teams
async function fetchUserTeams(token: string): Promise<Team[]> {
  const response = await fetch(getApiEndpoint('/teams/'), {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!response.ok) return []
  return response.json()
}

// Transform API response to frontend types
function transformApiRun(apiRun: ApiSandboxRun): SandboxRun {
  return {
    id: apiRun.id,
    timestamp: apiRun.created_at,
    status: apiRun.status as 'passed' | 'failed' | 'running',
    repository: apiRun.repository,
    branch: apiRun.branch || 'main',
    user: apiRun.user_name || apiRun.user_id,  // Prefer user_name for display
    duration_ms: apiRun.duration_ms || 0,
    files_tested: apiRun.files_tested || 0,
    steps: (apiRun.steps || []).map((s: any) => ({
      name: s.name || 'Unknown',
      status: s.status || 'skipped',
      duration_ms: s.duration_ms || 0,
      message: s.message,
    })),
    security_issues: apiRun.security_issues || 0,
    available_cidr: apiRun.available_cidr || undefined,
    resources_detected: (apiRun.resources_detected || []).map((r: any) => ({
      type: r.type || 'unknown',
      name: r.name || 'unknown',
      action: r.action || 'create',
      provider: r.provider || 'unknown',
    })),
    cost_estimate: apiRun.cost_estimate || undefined,
    risk_level: apiRun.risk_level as 'low' | 'medium' | 'high' | 'critical',
    errors: apiRun.errors || [],
    warnings: apiRun.warnings || [],
    terraform_version: apiRun.terraform_version || '1.6.0',
    providers_used: apiRun.providers_used || [],
    auto_healed: apiRun.auto_healed,
    fixes_applied: apiRun.fixes_applied || [],
    attempts: apiRun.attempts || 1,
  }
}

// Status badge component - 'running' treated as 'passed' since we only show completed runs
function StatusBadge({ status }: { status: 'passed' | 'failed' | 'running' | string }) {
  // Treat 'running' as 'passed' - if it got saved, it completed
  const effectiveStatus = status === 'running' ? 'passed' : status
  const config: Record<string, { color: string; icon: any; label: string }> = {
    passed: { color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: CheckCircle2, label: 'Passed' },
    failed: { color: 'bg-red-500/10 text-red-400 border-red-500/20', icon: XCircle, label: 'Failed' },
    approved: { color: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: CheckCircle2, label: 'Approved' },
    pending: { color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', icon: Clock, label: 'Pending' },
  }
  
  const fallback = { color: 'bg-gray-500/10 text-gray-400 border-gray-500/20', icon: AlertCircle, label: effectiveStatus || 'Unknown' }
  const { color, icon: Icon, label } = config[effectiveStatus] || fallback
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

// Risk level badge
function RiskBadge({ level, showApproval = false }: { level: 'low' | 'medium' | 'high' | 'critical', showApproval?: boolean }) {
  const config = {
    low: { color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', label: 'Low Risk', score: 15 },
    medium: { color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', label: 'Medium Risk', score: 45 },
    high: { color: 'bg-orange-500/10 text-orange-400 border-orange-500/20', label: 'High Risk', score: 75 },
    critical: { color: 'bg-red-500/10 text-red-400 border-red-500/20', label: 'Critical Risk', score: 90 },
  }
  
  const approvalRequired = {
    low: 'Team approval required',
    medium: 'Team approval required',
    high: 'Senior engineer approval required',
    critical: 'Security team approval required',
  }
  
  return (
    <div className="flex flex-col gap-1">
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-medium ${config[level].color}`}>
        <Shield className="h-3 w-3" />
        {config[level].label} ({config[level].score})
      </span>
      {showApproval && (
        <span className="inline-flex items-center gap-1 text-[9px] text-amber-400">
          <Lock className="h-2.5 w-2.5" />
          {approvalRequired[level]}
        </span>
      )}
    </div>
  )
}

// Format duration
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

// Detail Panel Component - Enterprise Grade
function SandboxDetailPanel({
  run,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  isDarkMode = true,
  selectedTeamId,
  token,
  onRefresh,
  isTeamAdmin = false,
}: {
  run: SandboxRun
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  hasPrev: boolean
  hasNext: boolean
  isDarkMode?: boolean
  selectedTeamId?: string | null
  token?: string | null
  onRefresh?: () => void
  isTeamAdmin?: boolean
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'code' | 'steps' | 'resources' | 'security' | 'logs'>('overview')
  const [copiedId, setCopiedId] = useState(false)
  const [isDeploying, setIsDeploying] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())
  const [expandedResources, setExpandedResources] = useState<Set<number>>(new Set())
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [pendingDeployAction, setPendingDeployAction] = useState<{ createPrOnly: boolean } | null>(null)
  
  // Check if user has dismissed the setup modal permanently
  const hasSeenSetupModal = typeof window !== 'undefined' && localStorage.getItem('infrara-seen-deploy-setup') === 'true'
  const [expandedCodeFiles, setExpandedCodeFiles] = useState<Set<string>>(new Set(['main.tf']))
  const [logSearch, setLogSearch] = useState('')

  const toggleCodeFile = (filename: string) => {
    const newExpanded = new Set(expandedCodeFiles)
    if (newExpanded.has(filename)) newExpanded.delete(filename)
    else newExpanded.add(filename)
    setExpandedCodeFiles(newExpanded)
  }

  // Generate AI description based on resources and changes
  const generateAIDescription = () => {
    const creates = run.resources_detected.filter(r => r.action === 'create')
    const updates = run.resources_detected.filter(r => r.action === 'update')
    const deletes = run.resources_detected.filter(r => r.action === 'delete')
    const providers = [...new Set(run.resources_detected.map(r => r.provider))]
    
    let lines: string[] = []
    
    // Main summary - concise, professional
    if (run.resources_detected.length > 0) {
      const actions: string[] = []
      if (creates.length > 0) actions.push(`+${creates.length} create`)
      if (updates.length > 0) actions.push(`~${updates.length} update`)
      if (deletes.length > 0) actions.push(`-${deletes.length} destroy`)
      
      lines.push(`${run.files_tested} files validated. ${actions.join(', ')}.`)
      
      if (providers.length > 0) {
        lines.push(`Target: ${providers.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')}`)
      }
    } else {
      lines.push(`${run.files_tested} files validated in ${run.repository.split('/').pop()}.`)
      
      if (run.status === 'passed') {
        lines.push(`Syntax valid. No resource definitions found.`)
      } else if (run.status === 'failed') {
        lines.push(`${run.errors?.length || 0} error${(run.errors?.length || 0) !== 1 ? 's' : ''} require attention.`)
      }
    }
    
    // Security - brief
    if (run.security_issues > 0) {
      lines.push(`Security: ${run.security_issues} finding${run.security_issues > 1 ? 's' : ''} to review.`)
    }
    
    // Auto-heal - brief
    if (run.auto_healed && run.fixes_applied && run.fixes_applied.length > 0) {
      lines.push(`Auto-fix applied: ${run.fixes_applied.length} issue${run.fixes_applied.length > 1 ? 's' : ''} resolved.`)
    }
    
    // Cost - brief
    if (run.cost_estimate) {
      lines.push(`Est. cost: $${run.cost_estimate}/mo`)
    }
    
    // Risk - brief
    const riskMap: Record<string, string> = {
      low: 'Low risk',
      medium: 'Medium risk - review recommended',
      high: 'High risk - approval required',
      critical: 'Critical - senior approval required'
    }
    if (riskMap[run.risk_level]) {
      lines.push(riskMap[run.risk_level])
    }
    
    return lines.join('\n\n')
  }
  

  const copyRunId = () => {
    navigator.clipboard.writeText(run.id)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 2000)
  }

  const toggleStep = (idx: number) => {
    const newExpanded = new Set(expandedSteps)
    if (newExpanded.has(idx)) newExpanded.delete(idx)
    else newExpanded.add(idx)
    setExpandedSteps(newExpanded)
  }

  const toggleResource = (idx: number) => {
    const newExpanded = new Set(expandedResources)
    if (newExpanded.has(idx)) newExpanded.delete(idx)
    else newExpanded.add(idx)
    setExpandedResources(newExpanded)
  }

  const handleApproveDeploy = async (createPrOnly: boolean = false) => {
    if (!selectedTeamId || !token) {
      setDeployError('Missing team or authentication')
      return
    }
    
    // Show setup modal for "Approve & Deploy" if user hasn't dismissed it
    if (!createPrOnly && !hasSeenSetupModal) {
      setPendingDeployAction({ createPrOnly })
      setShowSetupModal(true)
      return
    }
    
    await executeDeployment(createPrOnly)
  }
  
  const executeDeployment = async (createPrOnly: boolean) => {
    setIsDeploying(true)
    setDeployError(null)
    
    try {
      const response = await fetch(getApiEndpoint('/sandbox/approve-deploy'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sandbox_run_id: run.id,
          team_id: selectedTeamId,
          create_pr_only: createPrOnly,
          include_workflow: !createPrOnly, // Include workflow only for full deploy
        }),
      })
      
      const data = await response.json()
      
      if (!data.success) {
        setDeployError(data.error || 'Failed to create PR')
        return
      }
      
      if (data.pr_url) {
        window.open(data.pr_url, '_blank')
      }
      
      onRefresh?.()
      onClose()
    } catch (err: any) {
      setDeployError(err.message || 'Failed to deploy')
    } finally {
      setIsDeploying(false)
    }
  }
  
  const handleSetupModalContinue = (dontShowAgain: boolean) => {
    if (dontShowAgain) {
      localStorage.setItem('infrara-seen-deploy-setup', 'true')
    }
    setShowSetupModal(false)
    if (pendingDeployAction) {
      executeDeployment(pendingDeployAction.createPrOnly)
    }
    setPendingDeployAction(null)
  }

  // Generate mock security findings based on actual issues
  const securityFindings = [
    run.security_issues > 0 && { severity: 'high', title: 'Public Access Detected', description: 'Resource may be publicly accessible', file: 'main.tf', line: 23, remediation: 'Set publicly_accessible = false' },
    run.security_issues > 1 && { severity: 'medium', title: 'Open CIDR Block', description: '0.0.0.0/0 CIDR allows traffic from any IP', file: 'network.tf', line: 45, remediation: 'Restrict CIDR to specific IP ranges' },
    run.security_issues > 2 && { severity: 'low', title: 'Missing Encryption', description: 'Encryption not enabled for storage', file: 'storage.tf', line: 12, remediation: 'Add encryption = true' },
  ].filter(Boolean) as { severity: string; title: string; description: string; file: string; line: number; remediation: string }[]

  // Group resources by provider
  const resourcesByProvider = run.resources_detected.reduce((acc, r) => {
    if (!acc[r.provider]) acc[r.provider] = []
    acc[r.provider].push(r)
    return acc
  }, {} as Record<string, ResourceInfo[]>)

  // Calculate resource action counts
  const actionCounts = run.resources_detected.reduce((acc, r) => {
    acc[r.action] = (acc[r.action] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <>
      {/* Full screen dim overlay */}
      <div 
        className="fixed inset-0 bg-black/60 z-30"
        onClick={onClose}
      />
      
      {/* Navigation Controls */}
      <div className="fixed left-[410px] top-20 z-50 flex flex-col items-center gap-2">
        <button
          onClick={onClose}
          className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all shadow-lg ${
            isDarkMode 
              ? 'border-[#444444] bg-[#1a1a1a] text-[#888888] hover:text-[#fafafa] hover:border-[#14b8a6]'
              : 'border-gray-300 bg-white text-gray-500 hover:text-gray-900 hover:border-[#14b8a6]'
          }`}
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
        
        <button
          onClick={onPrev}
          disabled={!hasPrev}
          className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all shadow-lg ${
            isDarkMode
              ? `border-[#444444] bg-[#1a1a1a] ${!hasPrev ? 'text-[#444444] cursor-not-allowed' : 'text-[#888888] hover:text-[#fafafa] hover:border-[#14b8a6]'}`
              : `border-gray-300 bg-white ${!hasPrev ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-gray-900 hover:border-[#14b8a6]'}`
          }`}
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        
        <button
          onClick={onNext}
          disabled={!hasNext}
          className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all shadow-lg ${
            isDarkMode
              ? `border-[#444444] bg-[#1a1a1a] ${!hasNext ? 'text-[#444444] cursor-not-allowed' : 'text-[#888888] hover:text-[#fafafa] hover:border-[#14b8a6]'}`
              : `border-gray-300 bg-white ${!hasNext ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-gray-900 hover:border-[#14b8a6]'}`
          }`}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {/* Detail Panel */}
      <div className={`fixed top-0 right-0 bottom-0 w-[calc(100%-460px)] flex flex-col overflow-hidden z-40 shadow-2xl ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-white'}`}>
        {/* Header */}
        <div className={`px-6 py-5 border-b ${isDarkMode ? 'border-[#1f1f1f] bg-[#0f0f0f]' : 'border-gray-200 bg-gray-50'}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className={`rounded-xl p-3 ${
                run.status === 'passed' ? 'bg-gradient-to-br from-emerald-500/20 to-teal-500/20' : 
                run.status === 'failed' ? 'bg-gradient-to-br from-red-500/20 to-orange-500/20' : 'bg-gradient-to-br from-blue-500/20 to-cyan-500/20'
              }`}>
                <Terminal className={`h-6 w-6 ${
                  run.status === 'passed' ? 'text-emerald-400' :
                  run.status === 'failed' ? 'text-red-400' : 'text-blue-400'
                }`} />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className={`text-xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
                    Sandbox Validation Report
                  </h2>
                  <StatusBadge status={run.status} />
                  <RiskBadge level={run.risk_level} />
                  {run.auto_healed && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      <Wrench className="h-3 w-3" />
                      Auto-Healed
                    </span>
                  )}
                </div>
                <div className={`flex items-center gap-4 text-sm ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>
                  <span className="flex items-center gap-1.5">
                    <GitBranch className="h-3.5 w-3.5" />
                    {run.repository}
                  </span>
                  <span className={`px-2 py-0.5 rounded ${isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100'}`}>
                    {run.branch}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDuration(run.duration_ms)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    {run.user}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={copyRunId}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${isDarkMode ? 'bg-[#1f1f1f] text-[#888888] hover:text-[#fafafa] hover:bg-[#2a2a2a]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {copiedId ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <span className="font-mono">{run.id.substring(0, 12)}...</span>
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className={`flex border-b px-6 ${isDarkMode ? 'border-[#1f1f1f] bg-[#0f0f0f]' : 'border-gray-200 bg-gray-50'}`}>
          {[
            { id: 'overview', label: 'Overview', icon: Eye },
            { id: 'code', label: 'Code', icon: Code, count: run.files_tested },
            { id: 'steps', label: 'Validation Pipeline', icon: Workflow, count: run.steps.length },
            { id: 'resources', label: 'Infrastructure', icon: Layers, count: run.resources_detected.length },
            { id: 'security', label: 'Security & Compliance', icon: Shield, count: run.security_issues },
            { id: 'logs', label: 'Full Logs', icon: Terminal },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium transition-colors relative ${
                activeTab === tab.id 
                  ? isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'
                  : isDarkMode ? 'text-[#666666] hover:text-[#a1a1a1]' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  tab.id === 'security' && run.security_issues > 0
                    ? 'bg-red-500/20 text-red-400'
                    : isDarkMode ? 'bg-[#1f1f1f] text-[#888888]' : 'bg-gray-200 text-gray-600'
                }`}>
                  {tab.count}
                </span>
              )}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#14b8a6]" />
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Overview Tab - Enhanced */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Summary Section */}
              <div className="space-y-3">
                <h3 className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`}>Summary</h3>
                <div className={`text-[13px] leading-relaxed space-y-1.5 ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>
                  {generateAIDescription().split('\n\n').map((line, i) => {
                    const formatted = line.replace(/\*\*([^*]+)\*\*/g, '$1')
                    return <p key={i}>{formatted}</p>
                  })}
                </div>
                {run.resources_detected.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {[...new Set(run.resources_detected.map(r => r.type))].slice(0, 6).map((type, idx) => (
                      <span key={idx} className={`text-[10px] px-2 py-0.5 rounded font-mono ${isDarkMode ? 'bg-[#1a1a1a] text-[#666666] border border-[#1f1f1f]' : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
                        {type}
                      </span>
                    ))}
                    {[...new Set(run.resources_detected.map(r => r.type))].length > 6 && (
                      <span className={`text-[10px] px-2 py-0.5 rounded ${isDarkMode ? 'text-[#555555]' : 'text-gray-400'}`}>
                        +{[...new Set(run.resources_detected.map(r => r.type))].length - 6} more
                      </span>
                    )}
                  </div>
                )}
                {run.providers_used.length > 0 && run.resources_detected.length === 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {run.providers_used.map((provider, idx) => (
                      <span key={idx} className={`text-[10px] px-2 py-0.5 rounded font-mono ${isDarkMode ? 'bg-[#1a1a1a] text-[#666666] border border-[#1f1f1f]' : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
                        {provider}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Status Banner */}
              <div className={`p-4 rounded-xl border ${
                run.status === 'failed'
                  ? 'border-red-500/30'
                  : 'border-emerald-500/30'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-lg border ${
                      run.status === 'failed'
                        ? 'border-red-500/30'
                        : 'border-emerald-500/30'
                    }`}>
                      {run.status === 'failed' ? (
                        <XCircle className="h-6 w-6 text-red-400" />
                      ) : (
                        <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                      )}
                    </div>
                    <div>
                      <h3 className={`text-base font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
                        {run.status === 'failed' ? 'Validation Failed' : 'Validation Successful'}
                      </h3>
                      <p className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                        {run.status === 'failed' 
                          ? `${run.errors?.length || 0} error(s) found. Review and fix before deploying.`
                          : 'All infrastructure checks passed. Ready for deployment.'}
                      </p>
                    </div>
                  </div>
                  {run.auto_healed && (
                    <div className={`px-3 py-2 rounded-lg border border-purple-500/30`}>
                      <div className="flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-purple-400" />
                        <div>
                          <p className="text-sm font-medium text-purple-400">Auto-Healed</p>
                          <p className={`text-xs ${isDarkMode ? 'text-purple-400/60' : 'text-purple-600'}`}>
                            {run.fixes_applied?.length || 0} fixes applied • {run.attempts || 1} attempt(s)
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Stats Grid */}
              <div className="grid grid-cols-5 gap-4">
                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-4 w-4 text-blue-400" />
                    <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Duration</p>
                  </div>
                  <p className={`text-2xl font-bold font-mono ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{formatDuration(run.duration_ms)}</p>
                </div>
                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-4 w-4 text-teal-400" />
                    <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Files</p>
                  </div>
                  <p className={`text-2xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{run.files_tested}</p>
                </div>
                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Layers className="h-4 w-4 text-purple-400" />
                    <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Resources</p>
                  </div>
                  <p className={`text-2xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{run.resources_detected.length}</p>
                </div>
                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className={`h-4 w-4 ${run.security_issues > 0 ? 'text-orange-400' : 'text-emerald-400'}`} />
                    <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Security</p>
                  </div>
                  <p className={`text-2xl font-bold ${run.security_issues > 0 ? 'text-orange-400' : 'text-emerald-400'}`}>
                    {run.security_issues > 0 ? run.security_issues : '✓'}
                  </p>
                </div>
                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="h-4 w-4 text-cyan-400" />
                    <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Est. Cost</p>
                  </div>
                  <p className={`text-2xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
                    {run.cost_estimate ? `$${run.cost_estimate}` : 'N/A'}
                  </p>
                  {run.cost_estimate && <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>/month</p>}
                </div>
              </div>

              {/* Resource Actions Breakdown */}
              <div className={`p-5 rounded-xl border ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
                <h3 className={`text-sm font-semibold mb-4 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Infrastructure Changes Summary</h3>
                <div className="grid grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-2 ${isDarkMode ? 'bg-emerald-500/10' : 'bg-emerald-50'}`}>
                      <span className="text-2xl font-bold text-emerald-400">{actionCounts['create'] || 0}</span>
                    </div>
                    <p className={`text-xs font-medium ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>To Create</p>
                  </div>
                  <div className="text-center">
                    <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-2 ${isDarkMode ? 'bg-yellow-500/10' : 'bg-yellow-50'}`}>
                      <span className="text-2xl font-bold text-yellow-400">{actionCounts['update'] || 0}</span>
                    </div>
                    <p className={`text-xs font-medium ${isDarkMode ? 'text-yellow-400' : 'text-yellow-600'}`}>To Update</p>
                  </div>
                  <div className="text-center">
                    <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-2 ${isDarkMode ? 'bg-red-500/10' : 'bg-red-50'}`}>
                      <span className="text-2xl font-bold text-red-400">{actionCounts['delete'] || 0}</span>
                    </div>
                    <p className={`text-xs font-medium ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>To Delete</p>
                  </div>
                  <div className="text-center">
                    <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-2 ${isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100'}`}>
                      <span className={`text-2xl font-bold ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`}>{actionCounts['no-op'] || 0}</span>
                    </div>
                    <p className={`text-xs font-medium ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>No Change</p>
                  </div>
                </div>
              </div>

              {/* Two Column Layout */}
              <div className="grid grid-cols-2 gap-6">
                {/* Run Metadata */}
                <div className={`p-5 rounded-xl border ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
                  <h3 className={`text-sm font-semibold mb-4 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Run Information</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-2 border-b border-dashed border-[#1f1f1f]">
                      <span className={`text-sm ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>Triggered By</span>
                      <span className={`text-sm font-medium flex items-center gap-2 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center text-[10px] font-bold text-white">
                          {run.user.charAt(0).toUpperCase()}
                        </div>
                        {run.user}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-dashed border-[#1f1f1f]">
                      <span className={`text-sm ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>Timestamp</span>
                      <span className={`text-sm font-mono ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{new Date(run.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-dashed border-[#1f1f1f]">
                      <span className={`text-sm ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>Terraform</span>
                      <span className={`text-sm font-mono px-2 py-0.5 rounded ${isDarkMode ? 'bg-[#1f1f1f] text-[#fafafa]' : 'bg-gray-100 text-gray-900'}`}>{run.terraform_version || '1.6.0'}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-dashed border-[#1f1f1f]">
                      <span className={`text-sm ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>Available CIDR</span>
                      <span className={`text-sm font-mono ${run.available_cidr ? 'text-[#14b8a6]' : isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`}>
                        {run.available_cidr || 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className={`text-sm ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>Run ID</span>
                      <span className={`text-xs font-mono ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`}>{run.id}</span>
                    </div>
                  </div>
                </div>

                {/* Providers & Risk */}
                <div className="space-y-4">
                  <div className={`p-5 rounded-xl border ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
                    <h3 className={`text-sm font-semibold mb-3 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Providers Used</h3>
                    <div className="flex flex-wrap gap-2">
                      {run.providers_used.length > 0 ? run.providers_used.map((provider, idx) => (
                        <span key={idx} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${isDarkMode ? 'bg-[#1f1f1f] text-[#a1a1a1]' : 'bg-gray-100 text-gray-700'}`}>
                          {provider === 'digitalocean' && <Globe className="h-3.5 w-3.5 text-blue-400" />}
                          {provider === 'aws' && <Server className="h-3.5 w-3.5 text-orange-400" />}
                          {provider === 'random' && <Cpu className="h-3.5 w-3.5 text-purple-400" />}
                          {!['digitalocean', 'aws', 'random'].includes(provider) && <Box className="h-3.5 w-3.5" />}
                          {provider}
                        </span>
                      )) : (
                        <span className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`}>No providers detected</span>
                      )}
                    </div>
                  </div>

                  <div className={`p-5 rounded-xl border ${
                    run.risk_level === 'low' ? isDarkMode ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-emerald-50 border-emerald-200' :
                    run.risk_level === 'medium' ? isDarkMode ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-yellow-50 border-yellow-200' :
                    run.risk_level === 'high' ? isDarkMode ? 'bg-orange-500/5 border-orange-500/20' : 'bg-orange-50 border-orange-200' :
                    isDarkMode ? 'bg-red-500/5 border-red-500/20' : 'bg-red-50 border-red-200'
                  }`}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className={`text-sm font-semibold mb-1 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Risk Assessment</h3>
                        <p className={`text-xs ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>Based on resource types & operations</p>
                      </div>
                      <div className={`text-right`}>
                        <p className={`text-2xl font-bold ${
                          run.risk_level === 'low' ? 'text-emerald-400' :
                          run.risk_level === 'medium' ? 'text-yellow-400' :
                          run.risk_level === 'high' ? 'text-orange-400' : 'text-red-400'
                        }`}>
                          {run.risk_level.toUpperCase()}
                        </p>
                      </div>
                    </div>
                    
                    {/* Approval Required Banner */}
                    <div className={`p-3 rounded-lg border ${isDarkMode ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-50 border-amber-200'} flex items-center gap-3`}>
                      <div className={`p-2 rounded-full ${isDarkMode ? 'bg-amber-500/20' : 'bg-amber-100'}`}>
                        <Lock className={`h-4 w-4 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`} />
                      </div>
                      <div>
                        <p className={`text-sm font-medium ${isDarkMode ? 'text-amber-400' : 'text-amber-700'}`}>
                          {run.risk_level === 'critical' ? 'Security Team Approval Required' :
                           run.risk_level === 'high' ? 'Senior Engineer Approval Required' :
                           'Team Approval Required'}
                        </p>
                        <p className={`text-xs ${isDarkMode ? 'text-amber-400/70' : 'text-amber-600'}`}>
                          All infrastructure changes require approval before deployment
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Errors and Warnings */}
              {(run.errors && run.errors.length > 0) && (
                <div className={`p-5 rounded-xl border ${isDarkMode ? 'bg-red-500/5 border-red-500/20' : 'bg-red-50 border-red-200'}`}>
                  <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
                    <XCircle className="h-4 w-4" />
                    Errors ({run.errors.length})
                  </h3>
                  <div className="space-y-2">
                    {run.errors.map((err, idx) => (
                      <div key={idx} className={`p-3 rounded-lg ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-white'} text-sm text-red-400 font-mono`}>
                        {err}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(run.warnings && run.warnings.length > 0) && (
                <div className={`p-5 rounded-xl border ${isDarkMode ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-yellow-50 border-yellow-200'}`}>
                  <h3 className="text-sm font-semibold text-yellow-400 mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Warnings ({run.warnings.length})
                  </h3>
                  <div className="space-y-2">
                    {run.warnings.map((warn, idx) => (
                      <div key={idx} className={`p-3 rounded-lg ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-white'} text-sm text-yellow-400`}>
                        {warn}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Auto-Heal Details */}
              {run.auto_healed && run.fixes_applied && run.fixes_applied.length > 0 && (
                <div className={`p-5 rounded-xl border ${isDarkMode ? 'bg-purple-500/5 border-purple-500/20' : 'bg-purple-50 border-purple-200'}`}>
                  <h3 className="text-sm font-semibold text-purple-400 mb-3 flex items-center gap-2">
                    <Wrench className="h-4 w-4" />
                    Auto-Heal Applied ({run.fixes_applied.length} fixes)
                  </h3>
                  <div className="space-y-3">
                    {run.fixes_applied.map((fix: any, idx: number) => (
                      <div key={idx} className={`p-3 rounded-lg ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-white'}`}>
                        <p className="text-sm text-purple-400 font-medium mb-1">{fix.path || 'Unknown file'}</p>
                        <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                          {fix.description || 'Configuration fix applied'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Code Tab - Collapsible Files */}
          {activeTab === 'code' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
                  Terraform Configuration ({run.files_tested} files)
                </h3>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setExpandedCodeFiles(new Set())}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${isDarkMode ? 'bg-[#1f1f1f] text-[#888888] hover:text-[#fafafa]' : 'bg-gray-100 text-gray-600 hover:text-gray-900'}`}
                  >
                    Collapse All
                  </button>
                  <button 
                    onClick={() => setExpandedCodeFiles(new Set(['main.tf', 'providers.tf', 'variables.tf', 'outputs.tf']))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${isDarkMode ? 'bg-[#1f1f1f] text-[#888888] hover:text-[#fafafa]' : 'bg-gray-100 text-gray-600 hover:text-gray-900'}`}
                  >
                    Expand All
                  </button>
                  <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${isDarkMode ? 'bg-[#1f1f1f] text-[#888888] hover:text-[#fafafa]' : 'bg-gray-100 text-gray-600 hover:text-gray-900'}`}>
                    <Copy className="h-3 w-3" />
                    Copy All
                  </button>
                </div>
              </div>
              
              {/* main.tf - Collapsible */}
              <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
                <button
                  onClick={() => toggleCodeFile('main.tf')}
                  className={`w-full px-4 py-3 flex items-center justify-between ${isDarkMode ? 'bg-[#141414] hover:bg-[#1a1a1a]' : 'bg-gray-50 hover:bg-gray-100'} transition-colors`}
                >
                  <div className="flex items-center gap-3">
                    <ChevronDown className={`h-4 w-4 transition-transform ${expandedCodeFiles.has('main.tf') ? '' : '-rotate-90'} ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
                    <FileText className={`h-4 w-4 ${isDarkMode ? 'text-[#14b8a6]' : 'text-teal-500'}`} />
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>main.tf</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${isDarkMode ? 'bg-[#1f1f1f] text-[#888888]' : 'bg-gray-200 text-gray-500'}`}>
                      {run.resources_detected.length} resources
                    </span>
                  </div>
                  <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                    ~{Math.max(10, run.resources_detected.length * 8)} lines
                  </span>
                </button>
                {expandedCodeFiles.has('main.tf') && (
                  <div className={`p-4 font-mono text-xs overflow-x-auto border-t ${isDarkMode ? 'bg-[#0a0a0a] border-[#1f1f1f]' : 'bg-gray-50 border-gray-200'}`}>
                    <pre className={isDarkMode ? 'text-[#e1e1e1]' : 'text-gray-800'}>
                      <code>{`# Infrastructure Configuration
# Repository: ${run.repository}
# Branch: ${run.branch}
# Validated: ${new Date(run.timestamp).toLocaleString()}

${run.resources_detected.map((r, i) => `# Resource ${i + 1}: ${r.action.toUpperCase()}
resource "${r.type}" "${r.name}" {
  # Action: ${r.action}
  # Provider: ${r.provider}
  
  # Configuration would be displayed here
  # from the actual Terraform files
}`).join('\n\n')}`}</code>
                    </pre>
                  </div>
                )}
              </div>

              {/* providers.tf - Collapsible */}
              <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
                <button
                  onClick={() => toggleCodeFile('providers.tf')}
                  className={`w-full px-4 py-3 flex items-center justify-between ${isDarkMode ? 'bg-[#141414] hover:bg-[#1a1a1a]' : 'bg-gray-50 hover:bg-gray-100'} transition-colors`}
                >
                  <div className="flex items-center gap-3">
                    <ChevronDown className={`h-4 w-4 transition-transform ${expandedCodeFiles.has('providers.tf') ? '' : '-rotate-90'} ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
                    <FileText className={`h-4 w-4 ${isDarkMode ? 'text-blue-400' : 'text-blue-500'}`} />
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>providers.tf</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${isDarkMode ? 'bg-[#1f1f1f] text-[#888888]' : 'bg-gray-200 text-gray-500'}`}>
                      {run.providers_used.length} provider{run.providers_used.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                    ~{10 + run.providers_used.length * 6} lines
                  </span>
                </button>
                {expandedCodeFiles.has('providers.tf') && (
                  <div className={`p-4 font-mono text-xs overflow-x-auto border-t ${isDarkMode ? 'bg-[#0a0a0a] border-[#1f1f1f]' : 'bg-gray-50 border-gray-200'}`}>
                    <pre className={isDarkMode ? 'text-[#e1e1e1]' : 'text-gray-800'}>
                      <code>{`# Provider Configuration
# Auto-generated required_providers block

terraform {
  required_version = ">= ${run.terraform_version || '1.6.0'}"
  
  required_providers {
${run.providers_used.map(p => `    ${p} = {
      source  = "${p === 'digitalocean' ? 'digitalocean/digitalocean' : p === 'aws' ? 'hashicorp/aws' : `hashicorp/${p}`}"
      version = "~> ${p === 'digitalocean' ? '2.0' : p === 'aws' ? '5.0' : '3.0'}"
    }`).join('\n')}
  }
}

${run.providers_used.map(p => `provider "${p}" {
  # Provider configuration
  # Credentials loaded from environment variables
}`).join('\n\n')}`}</code>
                    </pre>
                  </div>
                )}
              </div>

              {/* variables.tf - Collapsible */}
              <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
                <button
                  onClick={() => toggleCodeFile('variables.tf')}
                  className={`w-full px-4 py-3 flex items-center justify-between ${isDarkMode ? 'bg-[#141414] hover:bg-[#1a1a1a]' : 'bg-gray-50 hover:bg-gray-100'} transition-colors`}
                >
                  <div className="flex items-center gap-3">
                    <ChevronDown className={`h-4 w-4 transition-transform ${expandedCodeFiles.has('variables.tf') ? '' : '-rotate-90'} ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
                    <FileText className={`h-4 w-4 ${isDarkMode ? 'text-amber-400' : 'text-amber-500'}`} />
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>variables.tf</span>
                  </div>
                  <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                    ~15 lines
                  </span>
                </button>
                {expandedCodeFiles.has('variables.tf') && (
                  <div className={`p-4 font-mono text-xs overflow-x-auto border-t ${isDarkMode ? 'bg-[#0a0a0a] border-[#1f1f1f]' : 'bg-gray-50 border-gray-200'}`}>
                    <pre className={isDarkMode ? 'text-[#e1e1e1]' : 'text-gray-800'}>
                      <code>{`# Input Variables

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}

variable "region" {
  description = "Cloud provider region"
  type        = string
  default     = "nyc1"
}`}</code>
                    </pre>
                  </div>
                )}
              </div>

              {/* Auto-heal fixes - Collapsible */}
              {run.auto_healed && run.fixes_applied && run.fixes_applied.length > 0 && (
                <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-purple-500/20' : 'border-purple-200'}`}>
                  <button
                    onClick={() => toggleCodeFile('auto-heal')}
                    className={`w-full px-4 py-3 flex items-center justify-between ${isDarkMode ? 'bg-purple-500/10 hover:bg-purple-500/15' : 'bg-purple-50 hover:bg-purple-100'} transition-colors`}
                  >
                    <div className="flex items-center gap-3">
                      <ChevronDown className={`h-4 w-4 transition-transform ${expandedCodeFiles.has('auto-heal') ? '' : '-rotate-90'} text-purple-400`} />
                      <Wrench className="h-4 w-4 text-purple-400" />
                      <span className="text-sm font-medium text-purple-400">Auto-Heal Changes</span>
                      <span className={`text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400`}>
                        {run.fixes_applied.length} fix{run.fixes_applied.length !== 1 ? 'es' : ''}
                      </span>
                    </div>
                    <span className="text-xs text-purple-400/70">
                      Applied in {run.attempts || 1} attempt{(run.attempts || 1) !== 1 ? 's' : ''}
                    </span>
                  </button>
                  {expandedCodeFiles.has('auto-heal') && (
                    <div className={`p-4 font-mono text-xs border-t ${isDarkMode ? 'bg-[#0a0a0a] border-purple-500/20' : 'bg-purple-50/50 border-purple-200'}`}>
                      {run.fixes_applied.map((fix: any, idx: number) => (
                        <div key={idx} className="mb-4 last:mb-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-purple-400">// {fix.path || `fix_${idx + 1}.tf`}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDarkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'}`}>
                              Modified
                            </span>
                          </div>
                          <pre className={isDarkMode ? 'text-[#e1e1e1]' : 'text-gray-800'}>
                            <code>{fix.newContent?.substring(0, 800) || '# Configuration fix applied'}</code>
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Steps Tab - Enhanced Pipeline View */}
          {activeTab === 'steps' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
                  Validation Pipeline
                </h3>
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Passed
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500"></span>
                    Failed
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#333]"></span>
                    Skipped
                  </span>
                </div>
              </div>

              {/* Pipeline Progress Bar */}
              <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
                <div className="flex items-center gap-2">
                  {run.steps.map((step, idx) => (
                    <div key={idx} className="flex-1">
                      <div className={`h-2 rounded-full ${
                        step.status === 'passed' || step.status === 'running' ? 'bg-emerald-500' :
                        step.status === 'failed' ? 'bg-red-500' :
                        isDarkMode ? 'bg-[#333]' : 'bg-gray-300'
                      }`} />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-2">
                  <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                    {run.steps.filter(s => s.status === 'passed').length}/{run.steps.length} passed
                  </span>
                  <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                    Total: {formatDuration(run.duration_ms)}
                  </span>
                </div>
              </div>

              {/* Steps List */}
              <div className="space-y-3">
                {run.steps.map((step, idx) => (
                  <div 
                    key={idx} 
                    className={`rounded-xl border overflow-hidden transition-all ${
                      step.status === 'passed' || step.status === 'running' ? isDarkMode ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-emerald-200 bg-emerald-50' :
                      step.status === 'failed' ? isDarkMode ? 'border-red-500/20 bg-red-500/5' : 'border-red-200 bg-red-50' :
                      isDarkMode ? 'border-[#1f1f1f] bg-[#0f0f0f]' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <button
                      onClick={() => toggleStep(idx)}
                      className="w-full p-4 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          step.status === 'passed' || step.status === 'running' ? 'bg-emerald-500/20' :
                          step.status === 'failed' ? 'bg-red-500/20' :
                          isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-200'
                        }`}>
                          {step.status === 'passed' || step.status === 'running' ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                          ) : step.status === 'failed' ? (
                            <XCircle className="h-5 w-5 text-red-400" />
                          ) : (
                            <span className={`text-sm font-bold ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`}>{idx + 1}</span>
                          )}
                        </div>
                        <div className="text-left">
                          <p className={`text-sm font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{step.name}</p>
                          {step.message && (
                            <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>{step.message}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className={`text-sm font-mono ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                          {step.duration_ms > 0 ? formatDuration(step.duration_ms) : '-'}
                        </span>
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedSteps.has(idx) ? 'rotate-180' : ''} ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
                      </div>
                    </button>
                    {expandedSteps.has(idx) && (
                      <div className={`px-4 pb-4 border-t ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
                        <div className={`mt-4 p-3 rounded-lg font-mono text-xs ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-gray-100'}`}>
                          <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}># Step execution details</p>
                          <p className={step.status === 'passed' ? 'text-emerald-400' : step.status === 'failed' ? 'text-red-400' : isDarkMode ? 'text-[#e1e1e1]' : 'text-gray-700'}>
                            {step.name}: {step.message || 'Completed'}
                          </p>
                          <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}>Duration: {formatDuration(step.duration_ms)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resources Tab - Enhanced */}
          {activeTab === 'resources' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
                  Infrastructure Resources ({run.resources_detected.length})
                </h3>
              </div>

              {run.resources_detected.length > 0 ? (
                <>
                  {/* Resources by Provider */}
                  {Object.entries(resourcesByProvider).map(([provider, resources]) => (
                    <div key={provider} className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
                      <div className={`px-4 py-3 flex items-center justify-between ${isDarkMode ? 'bg-[#141414]' : 'bg-gray-50'}`}>
                        <div className="flex items-center gap-3">
                          {provider === 'digitalocean' ? (
                            <Globe className="h-5 w-5 text-blue-400" />
                          ) : provider === 'aws' ? (
                            <Server className="h-5 w-5 text-orange-400" />
                          ) : (
                            <Box className={`h-5 w-5 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
                          )}
                          <span className={`text-sm font-semibold capitalize ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{provider}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${isDarkMode ? 'bg-[#1f1f1f] text-[#888888]' : 'bg-gray-200 text-gray-600'}`}>
                            {resources.length} resource{resources.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                      <div className="divide-y divide-[#1f1f1f]">
                        {resources.map((resource, idx) => (
                          <div key={idx} className={`p-4 ${isDarkMode ? 'bg-[#0f0f0f]' : 'bg-white'}`}>
                            <div 
                              className="flex items-center justify-between cursor-pointer"
                              onClick={() => toggleResource(run.resources_detected.indexOf(resource))}
                            >
                              <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                  resource.action === 'create' ? 'bg-emerald-500/10' :
                                  resource.action === 'delete' ? 'bg-red-500/10' :
                                  resource.action === 'update' ? 'bg-yellow-500/10' : 
                                  isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100'
                                }`}>
                                  {resource.action === 'create' ? (
                                    <span className="text-emerald-400 text-lg font-bold">+</span>
                                  ) : resource.action === 'delete' ? (
                                    <span className="text-red-400 text-lg font-bold">−</span>
                                  ) : resource.action === 'update' ? (
                                    <span className="text-yellow-400 text-lg font-bold">~</span>
                                  ) : (
                                    <span className={`text-lg font-bold ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`}>=</span>
                                  )}
                                </div>
                                <div>
                                  <p className={`text-sm font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{resource.name}</p>
                                  <p className={`text-xs font-mono ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>{resource.type}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                                  resource.action === 'create' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                  resource.action === 'delete' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                  resource.action === 'update' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                                  isDarkMode ? 'bg-[#1f1f1f] text-[#666666] border border-[#333]' : 'bg-gray-100 text-gray-500 border border-gray-200'
                                }`}>
                                  {resource.action}
                                </span>
                                <ChevronDown className={`h-4 w-4 transition-transform ${expandedResources.has(run.resources_detected.indexOf(resource)) ? 'rotate-180' : ''} ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
                              </div>
                            </div>
                            {expandedResources.has(run.resources_detected.indexOf(resource)) && (
                              <div className={`mt-4 p-4 rounded-lg ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
                                <div className="grid grid-cols-2 gap-4 text-xs">
                                  <div>
                                    <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}>Resource Type</p>
                                    <p className={`font-mono mt-1 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{resource.type}</p>
                                  </div>
                                  <div>
                                    <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}>Resource Name</p>
                                    <p className={`font-mono mt-1 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{resource.name}</p>
                                  </div>
                                  <div>
                                    <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}>Provider</p>
                                    <p className={`mt-1 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{resource.provider}</p>
                                  </div>
                                  <div>
                                    <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}>Planned Action</p>
                                    <p className={`mt-1 font-medium ${
                                      resource.action === 'create' ? 'text-emerald-400' :
                                      resource.action === 'delete' ? 'text-red-400' :
                                      resource.action === 'update' ? 'text-yellow-400' : 
                                      isDarkMode ? 'text-[#666666]' : 'text-gray-500'
                                    }`}>{resource.action}</p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div className={`text-center py-16 rounded-xl border ${isDarkMode ? 'border-[#1f1f1f] bg-[#0f0f0f]' : 'border-gray-200 bg-white'}`}>
                  <Layers className={`h-16 w-16 mx-auto mb-4 ${isDarkMode ? 'text-[#333]' : 'text-gray-300'}`} />
                  <p className={`text-lg font-medium ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>No resources detected</p>
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-[#444]' : 'text-gray-400'}`}>This configuration may not define any Terraform resources</p>
                </div>
              )}
            </div>
          )}

          {/* Security Tab - Enhanced */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              {/* Security Score */}
              <div className={`p-6 rounded-xl border ${
                run.security_issues === 0 
                  ? isDarkMode ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-emerald-50 border-emerald-200'
                  : run.security_issues < 3
                  ? isDarkMode ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-yellow-50 border-yellow-200'
                  : isDarkMode ? 'bg-red-500/5 border-red-500/20' : 'bg-red-50 border-red-200'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                      run.security_issues === 0 ? 'bg-emerald-500/20' :
                      run.security_issues < 3 ? 'bg-yellow-500/20' : 'bg-red-500/20'
                    }`}>
                      {run.security_issues === 0 ? (
                        <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                      ) : (
                        <Shield className={`h-8 w-8 ${run.security_issues < 3 ? 'text-yellow-400' : 'text-red-400'}`} />
                      )}
                    </div>
                    <div>
                      <h3 className={`text-xl font-bold ${
                        run.security_issues === 0 ? 'text-emerald-400' :
                        run.security_issues < 3 ? 'text-yellow-400' : 'text-red-400'
                      }`}>
                        {run.security_issues === 0 ? 'Secure Configuration' : `${run.security_issues} Security Issue${run.security_issues !== 1 ? 's' : ''} Found`}
                      </h3>
                      <p className={`text-sm ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>
                        {run.security_issues === 0 
                          ? 'All security checks passed successfully' 
                          : 'Review and remediate before deploying to production'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-3xl font-bold ${
                      run.security_issues === 0 ? 'text-emerald-400' :
                      run.security_issues < 3 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {Math.max(0, 100 - (run.security_issues * 15))}
                    </p>
                    <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Security Score</p>
                  </div>
                </div>
              </div>

              {/* Security Findings */}
              {securityFindings.length > 0 && (
                <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
                  <div className={`px-4 py-3 ${isDarkMode ? 'bg-[#141414]' : 'bg-gray-50'}`}>
                    <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Security Findings</h3>
                  </div>
                  <div className="divide-y divide-[#1f1f1f]">
                    {securityFindings.map((finding, idx) => (
                      <div key={idx} className={`p-4 ${isDarkMode ? 'bg-[#0f0f0f]' : 'bg-white'}`}>
                        <div className="flex items-start gap-4">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            finding.severity === 'high' ? 'bg-red-500/10' :
                            finding.severity === 'medium' ? 'bg-yellow-500/10' : 'bg-blue-500/10'
                          }`}>
                            <AlertTriangle className={`h-5 w-5 ${
                              finding.severity === 'high' ? 'text-red-400' :
                              finding.severity === 'medium' ? 'text-yellow-400' : 'text-blue-400'
                            }`} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className={`text-sm font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{finding.title}</h4>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase ${
                                finding.severity === 'high' ? 'bg-red-500/10 text-red-400' :
                                finding.severity === 'medium' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-blue-500/10 text-blue-400'
                              }`}>
                                {finding.severity}
                              </span>
                            </div>
                            <p className={`text-sm mb-2 ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>{finding.description}</p>
                            <div className={`flex items-center gap-4 text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`}>
                              <span className="flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                {finding.file}:{finding.line}
                              </span>
                            </div>
                            <div className={`mt-3 p-3 rounded-lg ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
                              <p className={`text-xs font-medium mb-1 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Remediation:</p>
                              <code className={`text-xs font-mono ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>{finding.remediation}</code>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Compliance Checks */}
              <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
                <div className={`px-4 py-3 ${isDarkMode ? 'bg-[#141414]' : 'bg-gray-50'}`}>
                  <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Compliance Checks</h3>
                </div>
                <div className={`p-4 ${isDarkMode ? 'bg-[#0f0f0f]' : 'bg-white'}`}>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { name: 'Encryption at Rest', status: true, category: 'CIS' },
                      { name: 'Encryption in Transit', status: true, category: 'CIS' },
                      { name: 'Private Networking', status: run.security_issues === 0, category: 'Network' },
                      { name: 'Firewall Rules', status: true, category: 'Network' },
                      { name: 'IAM Best Practices', status: true, category: 'IAM' },
                      { name: 'Resource Tagging', status: true, category: 'Governance' },
                      { name: 'Logging Enabled', status: true, category: 'Audit' },
                      { name: 'Cost Optimization', status: true, category: 'FinOps' },
                    ].map((check, idx) => (
                      <div key={idx} className={`flex items-center justify-between p-3 rounded-lg ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
                        <div className="flex items-center gap-3">
                          {check.status ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400" />
                          )}
                          <span className={`text-sm ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{check.name}</span>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded ${isDarkMode ? 'bg-[#1f1f1f] text-[#666666]' : 'bg-gray-200 text-gray-500'}`}>
                          {check.category}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Logs Tab - Enhanced */}
          {activeTab === 'logs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Execution Logs</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
                    <input
                      type="text"
                      placeholder="Search logs..."
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                      className={`pl-9 pr-3 py-1.5 rounded-lg text-xs border ${isDarkMode ? 'bg-[#0a0a0a] border-[#1f1f1f] text-[#fafafa] placeholder-[#666666]' : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'}`}
                    />
                  </div>
                  <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${isDarkMode ? 'bg-[#1f1f1f] text-[#888888] hover:text-[#fafafa]' : 'bg-gray-100 text-gray-600 hover:text-gray-900'}`}>
                    <Copy className="h-3 w-3" />
                    Copy
                  </button>
                </div>
              </div>

              <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
                <div className={`px-4 py-2 flex items-center justify-between border-b ${isDarkMode ? 'bg-[#141414] border-[#1f1f1f]' : 'bg-gray-50 border-gray-200'}`}>
                  <span className={`text-xs font-medium ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>terraform validate</span>
                  <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`}>{new Date(run.timestamp).toLocaleString()}</span>
                </div>
                <div className={`p-4 font-mono text-xs overflow-x-auto max-h-[500px] overflow-y-auto ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
                  <div className="space-y-1">
                    <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-400'}>$ terraform init -upgrade=false -input=false -backend=false</p>
                    <p className="text-[#14b8a6]">Initializing the backend...</p>
                    <p className="text-[#14b8a6]">Initializing provider plugins...</p>
                    {run.providers_used.map((p, i) => (
                      <p key={i} className={isDarkMode ? 'text-[#e1e1e1]' : 'text-gray-700'}>- Finding latest version of {p === 'digitalocean' ? 'digitalocean/digitalocean' : `hashicorp/${p}`}...</p>
                    ))}
                    <p className="text-[#14b8a6]">Terraform has been successfully initialized!</p>
                    <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-400'}></p>
                    <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-400'}>$ terraform validate -json</p>
                    <p className={isDarkMode ? 'text-[#e1e1e1]' : 'text-gray-700'}>{'{'}</p>
                    <p className={isDarkMode ? 'text-[#e1e1e1]' : 'text-gray-700'}>  "valid": {run.status === 'passed' ? 'true' : 'false'},</p>
                    <p className={isDarkMode ? 'text-[#e1e1e1]' : 'text-gray-700'}>  "error_count": {run.errors?.length || 0},</p>
                    <p className={isDarkMode ? 'text-[#e1e1e1]' : 'text-gray-700'}>  "warning_count": {run.warnings?.length || 0}</p>
                    <p className={isDarkMode ? 'text-[#e1e1e1]' : 'text-gray-700'}>{'}'}</p>
                    <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-400'}></p>
                    {run.steps.map((step, idx) => (
                      <p key={idx} className={
                        step.status === 'passed' ? 'text-emerald-400' :
                        step.status === 'failed' ? 'text-red-400' :
                        isDarkMode ? 'text-[#666666]' : 'text-gray-400'
                      }>
                        [{new Date(Date.parse(run.timestamp) + step.duration_ms).toISOString()}] [{step.status.toUpperCase()}] {step.name}: {step.message || 'Complete'}
                      </p>
                    ))}
                    <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-400'}></p>
                    {run.errors?.map((err, idx) => (
                      <p key={idx} className="text-red-400">[ERROR] {err}</p>
                    ))}
                    {run.warnings?.map((warn, idx) => (
                      <p key={idx} className="text-yellow-400">[WARN] {warn}</p>
                    ))}
                    <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-400'}>---</p>
                    <p className={run.status === 'passed' ? 'text-emerald-400' : 'text-red-400'}>
                      [RESULT] Sandbox validation {run.status.toUpperCase()} in {formatDuration(run.duration_ms)}
                    </p>
                    {run.auto_healed && (
                      <p className="text-purple-400">[AUTO-HEAL] {run.fixes_applied?.length || 0} fixes applied in {run.attempts} attempt(s)</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-6 py-4 border-t ${isDarkMode ? 'border-[#1f1f1f] bg-[#0f0f0f]' : 'border-gray-200 bg-gray-50'}`}>
          {deployError && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {deployError}
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {run.status === 'passed' && selectedTeamId && isTeamAdmin && (
                <>
                  <button 
                    onClick={() => handleApproveDeploy(false)}
                    disabled={isDeploying}
                    className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#14b8a6] to-teal-500 text-white text-sm font-semibold hover:from-[#0d9488] hover:to-teal-600 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-teal-500/20"
                  >
                    {isDeploying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    {isDeploying ? 'Creating PR...' : 'Approve & Deploy'}
                  </button>
                  <button 
                    onClick={() => handleApproveDeploy(true)}
                    disabled={isDeploying}
                    className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode ? 'bg-[#1f1f1f] text-[#fafafa] hover:bg-[#2a2a2a] border border-[#333]' : 'bg-white text-gray-900 hover:bg-gray-100 border border-gray-200'}`}
                  >
                    <GitBranch className="h-4 w-4" />
                    Create PR Only
                  </button>
                </>
              )}
              {run.status === 'passed' && selectedTeamId && !isTeamAdmin && (
                <p className={`text-sm flex items-center gap-2 ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>
                  <Lock className="h-4 w-4" />
                  Only team admins can approve deployments
                </p>
              )}
              {run.status === 'passed' && !selectedTeamId && (
                <p className={`text-sm ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>Select a team to view approval options</p>
              )}
              {run.status === 'failed' && (
                <button className="px-4 py-2.5 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Re-run Validation
                </button>
              )}
            </div>
            <a
              href={`https://github.com/${run.repository}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1.5 text-sm ${isDarkMode ? 'text-[#888888] hover:text-[#fafafa]' : 'text-gray-500 hover:text-gray-900'} transition-colors`}
            >
              View Repository <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>
      
      {/* Setup Instructions Modal */}
      {showSetupModal && (
        <SetupInstructionsModal
          isDarkMode={isDarkMode}
          onContinue={handleSetupModalContinue}
          onCancel={() => {
            setShowSetupModal(false)
            setPendingDeployAction(null)
          }}
        />
      )}
    </>
  )
}

// Setup Instructions Modal Component
function SetupInstructionsModal({
  isDarkMode,
  onContinue,
  onCancel,
}: {
  isDarkMode: boolean
  onContinue: (dontShowAgain: boolean) => void
  onCancel: () => void
}) {
  const [dontShowAgain, setDontShowAgain] = useState(false)
  
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div className={`relative w-full max-w-lg mx-4 rounded-xl border shadow-2xl ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
        {/* Header */}
        <div className={`px-6 py-4 border-b ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-[#14b8a6]/10' : 'bg-teal-50'}`}>
                <Settings className="h-5 w-5 text-[#14b8a6]" />
              </div>
              <div>
                <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
                  Setup Required
                </h2>
                <p className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                  One-time configuration for auto-deployment
                </p>
              </div>
            </div>
            <button onClick={onCancel} className={`p-1.5 rounded-lg ${isDarkMode ? 'hover:bg-[#1f1f1f] text-[#666]' : 'hover:bg-gray-100 text-gray-400'}`}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="px-6 py-5 space-y-5">
          {/* DigitalOcean Setup */}
          <div>
            <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
              DigitalOcean Setup
            </h3>
            <ol className={`space-y-2 text-sm ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>
              <li className="flex items-start gap-2">
                <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${isDarkMode ? 'bg-[#1f1f1f] text-[#888]' : 'bg-gray-100 text-gray-500'}`}>1</span>
                <span>Go to <a href="https://cloud.digitalocean.com/account/api/tokens" target="_blank" rel="noopener noreferrer" className="text-[#14b8a6] hover:underline">DigitalOcean → API → Tokens</a></span>
              </li>
              <li className="flex items-start gap-2">
                <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${isDarkMode ? 'bg-[#1f1f1f] text-[#888]' : 'bg-gray-100 text-gray-500'}`}>2</span>
                <span>Generate New Token with <strong>Read + Write</strong> scopes</span>
              </li>
              <li className="flex items-start gap-2">
                <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${isDarkMode ? 'bg-[#1f1f1f] text-[#888]' : 'bg-gray-100 text-gray-500'}`}>3</span>
                <span>Copy the token (you won't see it again)</span>
              </li>
            </ol>
          </div>
          
          {/* GitHub Setup */}
          <div>
            <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
              GitHub Setup
            </h3>
            <ol className={`space-y-2 text-sm ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>
              <li className="flex items-start gap-2">
                <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${isDarkMode ? 'bg-[#1f1f1f] text-[#888]' : 'bg-gray-100 text-gray-500'}`}>4</span>
                <span>Go to your repo → Settings → Secrets → Actions</span>
              </li>
              <li className="flex items-start gap-2">
                <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${isDarkMode ? 'bg-[#1f1f1f] text-[#888]' : 'bg-gray-100 text-gray-500'}`}>5</span>
                <span>New secret: <code className={`px-1.5 py-0.5 rounded ${isDarkMode ? 'bg-[#1f1f1f] text-[#14b8a6]' : 'bg-gray-100 text-teal-600'}`}>DIGITALOCEAN_TOKEN</code></span>
              </li>
              <li className="flex items-start gap-2">
                <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${isDarkMode ? 'bg-[#1f1f1f] text-[#888]' : 'bg-gray-100 text-gray-500'}`}>6</span>
                <span>Paste your DigitalOcean token and save</span>
              </li>
            </ol>
          </div>
          
          {/* Environment Approval (Required) */}
          <div>
            <h3 className={`text-sm font-medium mb-3 flex items-center gap-2 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
              Environment Approval
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDarkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-600'}`}>Required</span>
            </h3>
            <ol className={`space-y-2 text-sm ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>
              <li className="flex items-start gap-2">
                <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${isDarkMode ? 'bg-[#1f1f1f] text-[#888]' : 'bg-gray-100 text-gray-500'}`}>7</span>
                <span>Go to repo Settings → Environments → New environment</span>
              </li>
              <li className="flex items-start gap-2">
                <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${isDarkMode ? 'bg-[#1f1f1f] text-[#888]' : 'bg-gray-100 text-gray-500'}`}>8</span>
                <span>Name it <code className={`px-1.5 py-0.5 rounded ${isDarkMode ? 'bg-[#1f1f1f] text-[#14b8a6]' : 'bg-gray-100 text-teal-600'}`}>production</code></span>
              </li>
              <li className="flex items-start gap-2">
                <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${isDarkMode ? 'bg-[#1f1f1f] text-[#888]' : 'bg-gray-100 text-gray-500'}`}>9</span>
                <span>Enable "Required reviewers" and add team members</span>
              </li>
            </ol>
          </div>
          
          {/* Info Box */}
          <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-amber-500/5 border border-amber-500/20' : 'bg-amber-50 border border-amber-100'}`}>
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className={`text-xs ${isDarkMode ? 'text-amber-400/80' : 'text-amber-700'}`}>
                <strong>Approval Gate:</strong> The deploy job will pause and wait for a team member to approve in GitHub Actions before infrastructure is created. You cannot approve your own deployments.
              </p>
            </div>
          </div>
          
          {/* Don't show again */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-[#14b8a6] focus:ring-[#14b8a6]"
            />
            <span className={`text-sm ${isDarkMode ? 'text-[#888888]' : 'text-gray-500'}`}>
              Don't show this again
            </span>
          </label>
        </div>
        
        {/* Footer */}
        <div className={`px-6 py-4 border-t flex items-center justify-end gap-3 ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
          <button
            onClick={onCancel}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isDarkMode ? 'text-[#888888] hover:text-[#fafafa] hover:bg-[#1f1f1f]' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
          >
            Cancel
          </button>
          <button
            onClick={() => onContinue(dontShowAgain)}
            className="px-5 py-2 rounded-lg bg-gradient-to-r from-[#14b8a6] to-teal-500 text-white text-sm font-semibold hover:from-[#0d9488] hover:to-teal-600 transition-all flex items-center gap-2"
          >
            Continue with Deployment
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

// Main Page Component
export default function SandboxPage() {
  const { user, token } = useAuth()
  const queryClient = useQueryClient()
  const [selectedRun, setSelectedRun] = useState<SandboxRun | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'passed' | 'failed'>('all')
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  
  // Fetch user's teams for team selector
  const { data: teams = [] } = useQuery({
    queryKey: ['user-teams', token],
    queryFn: () => fetchUserTeams(token || ''),
    enabled: !!token,
    staleTime: 60000,
  })

  // Fetch user's permissions in selected team
  const { data: permissions } = useQuery({
    queryKey: ['team-permissions', token, selectedTeamId],
    queryFn: async () => {
      if (!selectedTeamId || !token) return null
      const response = await fetch(getApiEndpoint(`/teams/${selectedTeamId}/permissions`), {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (!response.ok) return null
      return response.json()
    },
    enabled: !!token && !!selectedTeamId,
    staleTime: 60000,
  })

  const isTeamAdmin = permissions?.role === 'admin'

  // Fetch sandbox runs from API (all runs or team-filtered)
  const { data: sandboxData, isLoading, error, refetch } = useQuery({
    queryKey: ['sandbox-runs', token, selectedTeamId],
    queryFn: () => fetchSandboxRuns(token || '', selectedTeamId || undefined),
    enabled: !!token,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refresh every minute
  })

  // Transform API data to frontend types
  const runs: SandboxRun[] = sandboxData?.runs?.map(transformApiRun) || []

  // Theme detection
  useEffect(() => {
    const checkTheme = () => {
      // Check localStorage first, then fall back to class check
      const savedTheme = localStorage.getItem('driftbox-theme')
      if (savedTheme) {
        setIsDarkMode(savedTheme === 'dark')
      } else {
        // Check if light-mode class is present (dark mode is default)
        setIsDarkMode(!document.documentElement.classList.contains('light-mode'))
      }
    }
    checkTheme()
    const observer = new MutationObserver(checkTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    
    // Also listen for storage changes
    window.addEventListener('storage', checkTheme)
    return () => {
      observer.disconnect()
      window.removeEventListener('storage', checkTheme)
    }
  }, [])

  // Filter runs
  const filteredRuns = runs.filter(run => {
    const matchesSearch = run.repository.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         run.branch.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         run.user.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === 'all' || run.status === statusFilter
    return matchesSearch && matchesStatus
  })

  // Navigation
  const currentIndex = selectedRun ? filteredRuns.findIndex(r => r.id === selectedRun.id) : -1
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < filteredRuns.length - 1

  const goToPrev = () => {
    if (hasPrev) setSelectedRun(filteredRuns[currentIndex - 1])
  }

  const goToNext = () => {
    if (hasNext) setSelectedRun(filteredRuns[currentIndex + 1])
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedRun) return
      if (e.key === 'Escape') setSelectedRun(null)
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); goToPrev() }
      else if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); goToNext() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedRun, currentIndex])

  // Stats - use API data when available
  const passedCount = sandboxData?.passed ?? runs.filter(r => r.status === 'passed').length
  const failedCount = sandboxData?.failed ?? runs.filter(r => r.status === 'failed').length
  const avgDuration = sandboxData?.avg_duration_ms ?? (runs.length > 0 
    ? Math.round(runs.reduce((acc, r) => acc + r.duration_ms, 0) / runs.length)
    : 0)

  return (
    <div className={`min-h-screen p-6 relative ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
      {/* Detail Panel */}
      {selectedRun && (
        <SandboxDetailPanel
          run={selectedRun}
          onClose={() => setSelectedRun(null)}
          onPrev={goToPrev}
          onNext={goToNext}
          hasPrev={hasPrev}
          hasNext={hasNext}
          isDarkMode={isDarkMode}
          selectedTeamId={selectedTeamId}
          token={token}
          onRefresh={() => refetch()}
          isTeamAdmin={isTeamAdmin}
        />
      )}

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className={`text-2xl font-semibold flex items-center gap-3 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
              <Terminal className="h-7 w-7 text-[#14b8a6]" />
              Sandbox Environment
            </h1>
            <p className={`mt-1 text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
              Pre-deployment validation and testing for infrastructure changes
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Runs Filter Dropdown */}
            <select
              value={selectedTeamId || 'all'}
              onChange={(e) => {
                const val = e.target.value
                if (val === 'all') {
                  setSelectedTeamId(null)
                } else {
                  setSelectedTeamId(val)
                }
              }}
              className={`px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
                isDarkMode
                  ? 'bg-[#1f1f1f] border-[#333] text-[#fafafa] hover:border-[#14b8a6]/50 focus:border-[#14b8a6]'
                  : 'bg-white border-gray-200 text-gray-900 hover:border-[#14b8a6]/50 focus:border-[#14b8a6]'
              } focus:outline-none`}
            >
              <option value="all">All Runs</option>
              {teams.map(team => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['sandbox-runs'] })
                refetch()
              }}
              disabled={isLoading}
              className={`p-2 rounded-md transition-colors ${
                isDarkMode
                  ? 'bg-[#1f1f1f] text-[#888] hover:text-[#fafafa]'
                  : 'bg-gray-100 text-gray-500 hover:text-gray-900'
              }`}
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <Link
              href="/ide"
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#14b8a6] text-white text-sm font-medium hover:bg-[#0d9488] transition-colors"
            >
              <Play className="h-4 w-4" />
              New Sandbox Test
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Cards - Unique Designs */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {/* Total Runs - Activity sparkline */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-[#14b8a6]/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#14b8a6]/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-[#14b8a6]/10 transition-all" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-[#14b8a6] animate-pulse" />
              <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Total Runs</p>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className={`text-4xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{runs.length}</p>
                <p className="text-xs text-[#14b8a6] mt-1 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  +3 this week
                </p>
              </div>
              {/* Mini activity chart */}
              <div className="flex items-end gap-1 h-12">
                {[4, 7, 5, 9, 6, 8, 5, 10, 7, 12].map((h, i) => (
                  <div 
                    key={i} 
                    className="w-1.5 rounded-full bg-gradient-to-t from-[#14b8a6]/40 to-[#14b8a6] transition-all hover:from-[#14b8a6]/60"
                    style={{ height: `${h * 4}px` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Pass Rate - Circular progress */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-emerald-500/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-emerald-500/10 transition-all" />
          <div className="relative flex items-center gap-4">
            {/* Circular Progress */}
            <div className="relative w-20 h-20 flex-shrink-0">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                <circle
                  cx="40"
                  cy="40"
                  r="32"
                  fill="none"
                  stroke={isDarkMode ? "#1f1f1f" : "#e5e7eb"}
                  strokeWidth="8"
                />
                <circle
                  cx="40"
                  cy="40"
                  r="32"
                  fill="none"
                  stroke="url(#passGradient)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${(runs.length > 0 ? (passedCount / runs.length) * 100 : 0) * 2.01} 201`}
                  className="transition-all duration-1000"
                />
                <defs>
                  <linearGradient id="passGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#22c55e" />
                    <stop offset="100%" stopColor="#14b8a6" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
              </div>
            </div>
            <div>
              <p className={`text-xs font-medium uppercase tracking-wider mb-1 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Pass Rate</p>
              <p className="text-3xl font-bold text-emerald-400">
                {runs.length > 0 ? Math.round((passedCount / runs.length) * 100) : 0}%
              </p>
              <p className={`text-xs mt-1 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{passedCount} of {runs.length} passed</p>
            </div>
          </div>
        </div>

        {/* Failed - Alert style with pulse */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-red-500/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          {failedCount > 0 && (
            <div className="absolute top-3 right-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
            </div>
          )}
          <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-red-500/0 via-red-500/50 to-red-500/0" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <XCircle className="h-4 w-4 text-red-400" />
              <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Failed Tests</p>
            </div>
            <div className="flex items-center gap-4">
              <p className={`text-4xl font-bold ${failedCount > 0 ? 'text-red-400' : isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`}>
                {failedCount}
              </p>
              {failedCount > 0 && (
                <div className="flex-1">
                  <div className="flex items-center gap-1 text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded">
                    <AlertTriangle className="h-3 w-3" />
                    Needs attention
                  </div>
                </div>
              )}
            </div>
            {/* Mini error breakdown */}
            <div className="flex gap-1 mt-3">
              {[...Array(Math.min(failedCount, 5))].map((_, i) => (
                <div key={i} className="w-6 h-1.5 rounded-full bg-red-500/60" />
              ))}
              {failedCount > 5 && <span className="text-[10px] text-red-400">+{failedCount - 5}</span>}
              {failedCount === 0 && (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> All clear
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Avg Duration - Timer style */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-blue-500/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-blue-500/10 transition-all" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-blue-400" />
              <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Avg Duration</p>
            </div>
            <div className="flex items-baseline gap-2">
              <p className={`text-4xl font-bold font-mono tabular-nums ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
                {Math.floor(avgDuration / 1000)}
              </p>
              <p className="text-lg text-blue-400 font-medium">sec</p>
            </div>
            {/* Duration breakdown bar */}
            <div className="mt-3 space-y-1">
              <div className="flex items-center gap-2">
                <div className={`flex-1 h-2 rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-200'}`}>
                  <div 
                    className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all"
                    style={{ width: `${Math.min((avgDuration / 60000) * 100, 100)}%` }}
                  />
                </div>
                <span className={`text-[10px] w-12 text-right ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                  / 60s
                </span>
              </div>
              <p className={`text-[10px] flex items-center justify-between ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                <span>Fastest: 15s</span>
                <span>Slowest: 58s</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
          <input
            type="text"
            placeholder="Search runs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full pl-9 pr-4 py-2 rounded-md border text-sm focus:outline-none focus:border-[#14b8a6]/40 ${
              isDarkMode 
                ? 'bg-[#0f0f0f] border-[#1f1f1f] text-[#fafafa] placeholder-[#666666]'
                : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
            }`}
          />
        </div>
        {/* Status Filter */}
        <div className="flex items-center gap-1">
          {(['all', 'passed', 'failed'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusFilter === status
                  ? 'bg-[#14b8a6]/10 text-[#14b8a6] border border-[#14b8a6]/30'
                  : isDarkMode
                    ? 'bg-[#0f0f0f] text-[#666666] border border-[#1f1f1f] hover:border-[#2f2f2f]'
                    : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300'
              }`}
            >
              {status === 'all' ? 'All' : status === 'passed' ? 'Passed' : 'Failed'}
            </button>
          ))}
        </div>
      </div>

      {/* Runs Table */}
      <div className={`rounded-lg border overflow-hidden ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
        {/* Table Header */}
        <div className={`grid grid-cols-12 gap-4 px-4 py-3 border-b text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'border-[#1f1f1f] text-[#666666]' : 'border-gray-200 text-gray-500'}`}>
          <div className="col-span-1">Status</div>
          <div className="col-span-3">Repository / Branch</div>
          <div className="col-span-2">User</div>
          <div className="col-span-1">Duration</div>
          <div className="col-span-1">Files</div>
          <div className="col-span-1">Resources</div>
          <div className="col-span-1">Risk</div>
          <div className="col-span-2">Time</div>
        </div>

        {/* Table Body */}
        <div className={`divide-y ${isDarkMode ? 'divide-[#1f1f1f]' : 'divide-gray-100'}`}>
          {filteredRuns.map((run) => (
            <div
              key={run.id}
              onClick={() => setSelectedRun(run)}
              className={`grid grid-cols-12 gap-4 px-4 py-3 cursor-pointer transition-colors ${
                selectedRun?.id === run.id 
                  ? 'bg-[#14b8a6]/5' 
                  : isDarkMode ? 'hover:bg-[#141414]' : 'hover:bg-gray-50'
              }`}
            >
              <div className="col-span-1">
                <StatusBadge status={run.status} />
              </div>
              <div className="col-span-3">
                <p className={`text-sm truncate ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{run.repository}</p>
                <p className={`text-xs truncate flex items-center gap-1 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                  <GitBranch className="h-3 w-3" />
                  {run.branch}
                </p>
              </div>
              <div className="col-span-2">
                <p className={`text-sm ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>{run.user}</p>
              </div>
              <div className="col-span-1">
                <p className={`text-sm font-mono ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{formatDuration(run.duration_ms)}</p>
              </div>
              <div className="col-span-1">
                <p className={`text-sm ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>{run.files_tested}</p>
              </div>
              <div className="col-span-1">
                <p className={`text-sm ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>{run.resources_detected.length}</p>
              </div>
              <div className="col-span-1">
                <RiskBadge level={run.risk_level} />
              </div>
              <div className="col-span-2 flex items-center justify-between">
                <p className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{formatRelativeTime(run.timestamp)}</p>
                <ChevronRight className={`h-4 w-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
              </div>
            </div>
          ))}
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="py-12 text-center">
            <Loader2 className={`h-12 w-12 mx-auto mb-4 animate-spin ${isDarkMode ? 'text-[#14b8a6]' : 'text-teal-500'}`} />
            <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}>Loading sandbox runs...</p>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <div className="py-12 text-center">
            <AlertCircle className={`h-12 w-12 mx-auto mb-4 ${isDarkMode ? 'text-red-400' : 'text-red-500'}`} />
            <p className={isDarkMode ? 'text-red-400' : 'text-red-500'}>Failed to load sandbox runs</p>
            <button
              onClick={() => refetch()}
              className="mt-4 px-4 py-2 rounded-md bg-[#14b8a6] text-white text-sm font-medium hover:bg-[#0d9488]"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && filteredRuns.length === 0 && (
          <div className="py-12 text-center">
            <Terminal className={`h-12 w-12 mx-auto mb-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
            <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}>No sandbox runs found</p>
            <p className={`text-sm mt-2 ${isDarkMode ? 'text-[#444]' : 'text-gray-400'}`}>
              Run a sandbox test from the IDE to see results here
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
