'use client'

/**
 * Governance & Compliance Dashboard
 * Enterprise-grade view of risk assessments, audit trails, and compliance status
 */

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import RiskBadge, { RiskIndicator } from '@/components/Governance/RiskBadge'
import LifecycleTimeline from '@/components/Governance/LifecycleTimeline'
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Activity,
  Clock,
  CheckCircle,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  FileText,
  Filter,
  ChevronRight,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Zap,
  Eye,
  GitBranch,
  GitCommit,
  GitMerge,
  X,
  ChevronUp,
  Lock,
  Unlock,
  AlertOctagon,
  Target,
  PieChart,
  Layers,
  Users,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  MoreVertical,
  Download,
  Settings,
  Bell,
  FileWarning,
  Scale,
  Gavel,
  Fingerprint,
  BadgeCheck,
  Timer,
  Gauge
} from 'lucide-react'

interface DiffSession {
  diff_id: string
  prompt: string
  status: string
  file_count: number
  created_at: string
  updated_at: string
  risk_assessment?: {
    risk_score: number
    risk_level: string
    risk_color: string
    auto_approve: boolean
    factors?: {
      resource_types: string[]
      operations: string[]
      environment: string
      policy_violations: number
    }
  }
  policy_results?: {
    passed: number
    failed: number
    warnings: number
  }
}

interface SandboxRun {
  id: string
  timestamp: string
  status: 'passed' | 'failed' | 'running' | 'approved' | 'pending'
  repository: string
  branch: string
  user: string
  risk_level?: 'low' | 'medium' | 'high' | 'critical'
  risk_assessment?: {
    risk_score: number
    risk_level: string
    risk_color: string
    auto_approve: boolean
  }
  files_tested?: number
  security_issues?: number
}

interface AuditEvent {
  id: string
  change_id: string
  event_type: string
  timestamp: string
  summary: string
  user_id?: string
  metadata?: any
}

interface ComplianceReport {
  total_changes: number
  compliant_changes: number
  compliance_rate: number
  changes: Array<{
    change_id: string
    current_status: string
    compliance_status: string
    has_policy_check: boolean
    has_risk_assessment: boolean
    has_approval: boolean
  }>
}

type UnifiedChange = {
  id: string
  type: 'diff' | 'sandbox'
  prompt: string
  status: string
  repository: string
  branch: string
  user: string
  created_at: string
  file_count: number
  risk_assessment?: {
    risk_score: number
    risk_level: string
    risk_color: string
    auto_approve: boolean
  }
  policy_results?: {
    passed: number
    failed: number
    warnings: number
  }
  original: DiffSession | SandboxRun
}

export default function GovernancePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [selectedChange, setSelectedChange] = useState<UnifiedChange | null>(null)
  const [eventFilter, setEventFilter] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [riskFilter, setRiskFilter] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'timeline' | 'risk' | 'policy' | 'history'>('timeline')
  const [isDarkMode, setIsDarkMode] = useState(true)

  // Theme detection
  useEffect(() => {
    const checkTheme = () => {
      const theme = localStorage.getItem('driftbox-theme')
      const isLight = theme === 'light' || document.documentElement.classList.contains('light-mode')
      setIsDarkMode(!isLight)
    }
    checkTheme()
    const observer = new MutationObserver(checkTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    window.addEventListener('storage', checkTheme)
    return () => {
      observer.disconnect()
      window.removeEventListener('storage', checkTheme)
    }
  }, [])

  // Fetch diff sessions with risk assessments
  const { 
    data: sessions, 
    isLoading: sessionsLoading,
    refetch: refetchSessions 
  } = useQuery({
    queryKey: ['diff-sessions'],
    queryFn: async () => {
      const token = localStorage.getItem('token')
      const response = await fetch(getApiEndpoint('/diff/sessions'), {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) throw new Error('Failed to fetch sessions')
      const data = await response.json()
      return data.sessions as DiffSession[]
    },
    staleTime: 30 * 1000,
  })

  // Fetch sandbox runs
  const { 
    data: sandboxRuns, 
    isLoading: sandboxLoading,
    refetch: refetchSandbox 
  } = useQuery({
    queryKey: ['sandbox-runs-governance'],
    queryFn: async () => {
      const token = localStorage.getItem('token')
      const response = await fetch(getApiEndpoint('/sandbox/runs?limit=100&scope=all'), {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) throw new Error('Failed to fetch sandbox runs')
      const data = await response.json()
      return (data.runs || []) as SandboxRun[]
    },
    staleTime: 30 * 1000,
  })

  // Combine diff sessions and sandbox runs into unified changes
  const allChanges = [
    ...(sessions || []).map(s => ({
      id: s.diff_id,
      type: 'diff' as const,
      prompt: s.prompt,
      status: s.status,
      repository: 'N/A',
      branch: 'N/A',
      user: 'N/A',
      created_at: s.created_at,
      file_count: s.file_count,
      risk_assessment: s.risk_assessment,
      policy_results: s.policy_results,
      original: s,
    })),
    ...(sandboxRuns || []).map(r => ({
      id: r.id,
      type: 'sandbox' as const,
      prompt: `Sandbox test: ${r.repository}/${r.branch}`,
      status: r.status === 'passed' ? 'approved' : r.status === 'failed' ? 'rejected' : r.status,
      repository: r.repository,
      branch: r.branch,
      user: r.user,
      created_at: r.timestamp,
      file_count: r.files_tested || 0,
      risk_assessment: r.risk_assessment || (r.risk_level ? {
        risk_score: r.risk_level === 'critical' ? 90 : r.risk_level === 'high' ? 70 : r.risk_level === 'medium' ? 50 : 30,
        risk_level: r.risk_level,
        risk_color: r.risk_level === 'critical' ? 'red' : r.risk_level === 'high' ? 'orange' : r.risk_level === 'medium' ? 'yellow' : 'green',
        auto_approve: false,
      } : undefined),
      policy_results: r.security_issues ? {
        passed: 0,
        failed: r.security_issues,
        warnings: 0,
      } : undefined,
      original: r,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // Fetch recent audit events
  const { 
    data: auditEvents, 
    isLoading: eventsLoading 
  } = useQuery({
    queryKey: ['audit-events', eventFilter],
    queryFn: async () => {
      const token = localStorage.getItem('token')
      // Use the new audit-logs API endpoint
      const url = eventFilter 
        ? getApiEndpoint(`/audit-logs/logs?action_type=${eventFilter}&limit=50`)
        : getApiEndpoint('/audit-logs/logs?limit=50')
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) {
        // Gracefully handle if audit logs table doesn't exist yet
        console.warn('Audit logs not available yet')
        return []
      }
      const data = await response.json()
      // Map from new audit_logs format to AuditEvent format
      return (data.logs || []).map((log: any) => ({
        id: log.id,
        event_type: log.actionType,
        timestamp: log.timestamp,
        user_id: log.userEmail,
        summary: log.action,
        details: { resource: log.resource, resourceType: log.resourceType },
      })) as AuditEvent[]
    },
    staleTime: 30 * 1000,
  })

  // Fetch compliance report
  const { 
    data: compliance, 
    isLoading: complianceLoading 
  } = useQuery({
    queryKey: ['compliance-report'],
    queryFn: async () => {
      const token = localStorage.getItem('token')
      const response = await fetch(getApiEndpoint('/audit-logs/report'), {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) throw new Error('Failed to fetch compliance report')
      const data = await response.json()
      return data.report as ComplianceReport
    },
    staleTime: 60 * 1000,
  })

  // Fetch detailed sandbox run info when selected
  const { 
    data: detailedSandboxRun, 
    isLoading: sandboxDetailLoading 
  } = useQuery({
    queryKey: ['sandbox-run-detail', selectedChange?.id],
    queryFn: async () => {
      if (!selectedChange || selectedChange.type !== 'sandbox') return null
      const token = localStorage.getItem('token')
      const response = await fetch(getApiEndpoint(`/sandbox/runs/${selectedChange.id}`), {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) throw new Error('Failed to fetch sandbox run details')
      const data = await response.json()
      return data.run
    },
    enabled: !!selectedChange && selectedChange.type === 'sandbox',
    staleTime: 30 * 1000,
  })

  // Fetch timeline for selected change
  const { 
    data: timeline, 
    isLoading: timelineLoading 
  } = useQuery({
    queryKey: ['audit-timeline', selectedChange?.id, selectedChange?.type],
    queryFn: async () => {
      if (!selectedChange) return null
      const token = localStorage.getItem('token')
      
      // For diff sessions, use lifecycle endpoint
      if (selectedChange.type === 'diff') {
        const response = await fetch(getApiEndpoint(`/audit/lifecycle/${selectedChange.id}`), {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        if (!response.ok) return null
        return response.json()
      }
      
      // For sandbox runs, fetch audit logs filtered by the run ID
      const response = await fetch(getApiEndpoint(`/audit-logs/logs?resource=${selectedChange.id}&limit=50`), {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) return null
      const data = await response.json()
      return {
        events: (data.logs || []).map((log: any) => ({
          event_type: log.actionType,
          timestamp: log.timestamp,
          user: log.userEmail,
          summary: log.action,
          details: log,
        }))
      }
    },
    enabled: !!selectedChange,
    staleTime: 30 * 1000,
  })

  // Calculate stats from combined changes
  const stats = {
    totalChanges: allChanges.length,
    autoApproved: allChanges.filter(c => c.risk_assessment?.auto_approve || c.status === 'auto_approved').length,
    lowRisk: allChanges.filter(c => c.risk_assessment?.risk_level === 'low').length,
    mediumRisk: allChanges.filter(c => c.risk_assessment?.risk_level === 'medium').length,
    highRisk: allChanges.filter(c => c.risk_assessment?.risk_level === 'high').length,
    criticalRisk: allChanges.filter(c => c.risk_assessment?.risk_level === 'critical').length,
    pending: allChanges.filter(c => c.status === 'pending' || c.status === 'running').length,
    approved: allChanges.filter(c => c.status === 'approved' || c.status === 'auto_approved' || c.status === 'passed').length,
    rejected: allChanges.filter(c => c.status === 'rejected' || c.status === 'failed').length,
    policyViolations: allChanges.reduce((acc, c) => acc + (c.policy_results?.failed || 0), 0),
  }

  const avgRiskScore = allChanges.length 
    ? Math.round(allChanges.reduce((acc, c) => acc + (c.risk_assessment?.risk_score || 0), 0) / allChanges.length)
    : 0

  // Filter changes
  const filteredChanges = allChanges.filter(c => {
    if (searchQuery && !c.prompt.toLowerCase().includes(searchQuery.toLowerCase())) return false
    if (statusFilter) {
      // Check both mapped status and original status for sandbox runs
      const originalStatus = c.type === 'sandbox' ? (c.original as SandboxRun).status : null
      if (c.status !== statusFilter && originalStatus !== statusFilter) return false
    }
    if (riskFilter && c.risk_assessment?.risk_level !== riskFilter) return false
    return true
  })

  // Navigation for detail panel
  const currentIndex = selectedChange ? filteredChanges.findIndex(c => c.id === selectedChange.id) : -1
  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      setSelectedChange(filteredChanges[currentIndex - 1])
    }
  }, [currentIndex, filteredChanges])
  const goToNext = useCallback(() => {
    if (currentIndex < filteredChanges.length - 1) {
      setSelectedChange(filteredChanges[currentIndex + 1])
    }
  }, [currentIndex, filteredChanges])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedChange) return
      if (e.key === 'Escape') setSelectedChange(null)
      if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); goToPrevious() }
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); goToNext() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedChange, goToPrevious, goToNext])

  // Theme colors
  const bgPrimary = isDarkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'
  const bgSecondary = isDarkMode ? 'bg-[#0f0f0f]' : 'bg-white'
  const bgTertiary = isDarkMode ? 'bg-[#141414]' : 'bg-gray-100'
  const borderColor = isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'
  const textPrimary = isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'
  const textSecondary = isDarkMode ? 'text-[#a0a0a0]' : 'text-gray-600'
  const textMuted = isDarkMode ? 'text-[#666666]' : 'text-gray-400'
  const hoverBg = isDarkMode ? 'hover:bg-[#141414]' : 'hover:bg-gray-50'

  return (
    <div className={`min-h-screen ${bgPrimary} p-6`}>
      {/* Dimming overlay when detail panel is open */}
      {selectedChange && (
        <div 
          className="fixed inset-0 bg-black/60 z-30"
          onClick={() => setSelectedChange(null)}
        />
      )}

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className={`text-2xl font-semibold flex items-center gap-3 ${textPrimary}`}>
              <Scale className="h-7 w-7 text-teal-500" />
              Governance & Compliance
            </h1>
            <p className={`mt-1 text-sm ${textSecondary}`}>
              Policy-driven infrastructure lifecycle control • Risk assessment • Audit trails
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button className={`flex items-center gap-2 rounded-lg border ${borderColor} ${bgSecondary} px-3 py-2 text-sm ${textSecondary} ${hoverBg} transition-colors`}>
              <Download className="h-4 w-4" />
              Export
            </button>
            <button
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['diff-sessions'] })
                queryClient.invalidateQueries({ queryKey: ['sandbox-runs-governance'] })
                queryClient.invalidateQueries({ queryKey: ['compliance-report'] })
                queryClient.invalidateQueries({ queryKey: ['audit-events'] })
                refetchSessions()
                refetchSandbox()
              }}
              className={`flex items-center gap-2 rounded-lg ${isDarkMode ? 'bg-teal-500/10 text-teal-400 hover:bg-teal-500/20' : 'bg-teal-50 text-teal-600 hover:bg-teal-100'} px-4 py-2 text-sm font-medium transition-colors`}
            >
              <RefreshCw className={`h-4 w-4 ${(sessionsLoading || sandboxLoading) ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Stats Grid - 6 cards */}
      <div className="grid grid-cols-6 gap-4 mb-6">
        {/* Compliance Rate - Circular Gauge */}
        <div className={`rounded-xl border ${borderColor} ${bgSecondary} p-4 relative overflow-hidden`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`text-xs font-medium uppercase tracking-wider ${textMuted}`}>Compliance</span>
            <ShieldCheck className="h-4 w-4 text-teal-500" />
          </div>
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16">
              <svg className="w-16 h-16 -rotate-90">
                <circle cx="32" cy="32" r="28" fill="none" stroke={isDarkMode ? '#1f1f1f' : '#e5e7eb'} strokeWidth="6" />
                <circle 
                  cx="32" cy="32" r="28" fill="none" stroke="#14b8a6" strokeWidth="6"
                  strokeDasharray={`${(compliance?.compliance_rate || 0) * 1.76} 176`}
                  strokeLinecap="round"
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-lg font-bold ${textPrimary}`}>
                  {compliance?.compliance_rate || 0}%
                </span>
              </div>
            </div>
            <div>
              <p className={`text-xs ${textSecondary}`}>
                {compliance?.compliant_changes || 0} of {compliance?.total_changes || 0}
              </p>
              <p className={`text-xs ${textMuted}`}>compliant</p>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-teal-500/50 to-cyan-500/50" />
        </div>

        {/* Risk Score Gauge */}
        <div className={`rounded-xl border ${borderColor} ${bgSecondary} p-4 relative overflow-hidden`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`text-xs font-medium uppercase tracking-wider ${textMuted}`}>Avg Risk Score</span>
            <Gauge className="h-4 w-4 text-amber-500" />
          </div>
          <div className="flex items-center gap-3">
            <div className={`text-3xl font-bold ${
              avgRiskScore <= 25 ? 'text-green-500' : 
              avgRiskScore <= 50 ? 'text-yellow-500' : 
              avgRiskScore <= 75 ? 'text-orange-500' : 'text-red-500'
            }`}>
              {avgRiskScore}
            </div>
            <div className="flex-1">
              <div className={`h-2 rounded-full ${isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-200'} overflow-hidden`}>
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${
                    avgRiskScore <= 25 ? 'bg-green-500' : 
                    avgRiskScore <= 50 ? 'bg-yellow-500' : 
                    avgRiskScore <= 75 ? 'bg-orange-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${avgRiskScore}%` }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className={`text-[10px] ${textMuted}`}>Low</span>
                <span className={`text-[10px] ${textMuted}`}>Critical</span>
              </div>
            </div>
          </div>
        </div>

        {/* High Risk Alert */}
        <div className={`rounded-xl border ${isDarkMode ? 'border-red-500/30' : 'border-red-200'} ${isDarkMode ? 'bg-red-500/5' : 'bg-red-50'} p-4 relative overflow-hidden`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>High Risk</span>
            <div className="relative">
              <ShieldAlert className="h-4 w-4 text-red-500" />
              {(stats.highRisk + stats.criticalRisk) > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-ping" />
              )}
            </div>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold text-red-500">{stats.highRisk + stats.criticalRisk}</p>
              <p className={`text-xs mt-1 ${isDarkMode ? 'text-red-400/70' : 'text-red-600/70'}`}>
                {stats.criticalRisk} critical
              </p>
            </div>
            <AlertOctagon className="h-12 w-12 text-red-500/20" />
          </div>
        </div>

        {/* Auto-Approved */}
        <div className={`rounded-xl border ${isDarkMode ? 'border-green-500/30' : 'border-green-200'} ${isDarkMode ? 'bg-green-500/5' : 'bg-green-50'} p-4 relative overflow-hidden`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>Auto-Approved</span>
            <Zap className="h-4 w-4 text-green-500" />
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold text-green-500">{stats.autoApproved}</p>
              <p className={`text-xs mt-1 ${isDarkMode ? 'text-green-400/70' : 'text-green-600/70'}`}>
                {stats.totalChanges ? Math.round(stats.autoApproved / stats.totalChanges * 100) : 0}% auto-approved
              </p>
            </div>
            <div className="flex flex-col gap-0.5">
              {[...Array(5)].map((_, i) => (
                <div 
                  key={i} 
                  className={`w-6 h-1.5 rounded-full ${i < Math.ceil((stats.autoApproved / (stats.totalChanges || 1)) * 5) ? 'bg-green-500' : isDarkMode ? 'bg-green-500/20' : 'bg-green-200'}`} 
                />
              ))}
            </div>
          </div>
        </div>

        {/* Policy Violations */}
        <div className={`rounded-xl border ${borderColor} ${bgSecondary} p-4 relative overflow-hidden`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`text-xs font-medium uppercase tracking-wider ${textMuted}`}>Violations</span>
            <FileWarning className="h-4 w-4 text-orange-500" />
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className={`text-3xl font-bold ${textPrimary}`}>{stats.policyViolations}</p>
              <div className="flex items-center gap-1 mt-1">
                {stats.policyViolations > 0 ? (
                  <>
                    <TrendingUp className="h-3 w-3 text-red-500" />
                    <span className="text-xs text-red-500">+2 this week</span>
                  </>
                ) : (
                  <>
                    <TrendingDown className="h-3 w-3 text-green-500" />
                    <span className="text-xs text-green-500">No violations</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-500/50 to-yellow-500/50" />
        </div>

        {/* Pending Review */}
        <div className={`rounded-xl border ${isDarkMode ? 'border-amber-500/30' : 'border-amber-200'} ${isDarkMode ? 'bg-amber-500/5' : 'bg-amber-50'} p-4 relative overflow-hidden`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>Pending</span>
            <Timer className="h-4 w-4 text-amber-500" />
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold text-amber-500">{stats.pending}</p>
              <p className={`text-xs mt-1 ${isDarkMode ? 'text-amber-400/70' : 'text-amber-600/70'}`}>
                awaiting review
              </p>
            </div>
            <Clock className="h-10 w-10 text-amber-500/20" />
          </div>
        </div>
      </div>

      {/* Risk Distribution Bar */}
      <div className={`rounded-xl border ${borderColor} ${bgSecondary} p-4 mb-6`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`text-sm font-medium ${textPrimary}`}>Risk Distribution</h3>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Low ({stats.lowRisk})</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-yellow-500" /> Medium ({stats.mediumRisk})</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> High ({stats.highRisk})</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Critical ({stats.criticalRisk})</span>
          </div>
        </div>
        <div className="h-3 rounded-full overflow-hidden flex" style={{ backgroundColor: isDarkMode ? '#1f1f1f' : '#e5e7eb' }}>
          {stats.totalChanges > 0 && (
            <>
              <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${(stats.lowRisk / stats.totalChanges) * 100}%` }} />
              <div className="h-full bg-yellow-500 transition-all duration-500" style={{ width: `${(stats.mediumRisk / stats.totalChanges) * 100}%` }} />
              <div className="h-full bg-orange-500 transition-all duration-500" style={{ width: `${(stats.highRisk / stats.totalChanges) * 100}%` }} />
              <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${(stats.criticalRisk / stats.totalChanges) * 100}%` }} />
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex gap-6">
        {/* Left: Changes Table */}
        <div className={`flex-1 rounded-xl border ${borderColor} ${bgSecondary} overflow-hidden transition-all duration-300 ${selectedChange ? 'w-[460px]' : ''}`}>
          {/* Table Header with Filters */}
          <div className={`p-4 border-b ${borderColor} flex items-center justify-between`}>
            <div className="flex items-center gap-3">
              <h2 className={`text-lg font-semibold ${textPrimary}`}>Infrastructure Changes</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full ${isDarkMode ? 'bg-[#1f1f1f] text-[#a0a0a0]' : 'bg-gray-100 text-gray-600'}`}>
                {filteredChanges.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${textMuted}`} />
                <input
                  type="text"
                  placeholder="Search changes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`pl-9 pr-3 py-1.5 text-sm rounded-lg border ${borderColor} ${bgTertiary} ${textPrimary} placeholder:${textMuted} focus:outline-none focus:ring-1 focus:ring-teal-500 w-48`}
                />
              </div>
              {/* Status Filter */}
              <select
                value={statusFilter || ''}
                onChange={(e) => setStatusFilter(e.target.value || null)}
                className={`px-3 py-1.5 text-sm rounded-lg border ${borderColor} ${bgTertiary} ${textPrimary} focus:outline-none focus:ring-1 focus:ring-teal-500`}
              >
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="running">Running</option>
                <option value="approved">Approved</option>
                <option value="passed">Passed</option>
                <option value="auto_approved">Auto-Approved</option>
                <option value="rejected">Rejected</option>
                <option value="failed">Failed</option>
              </select>
              {/* Risk Filter */}
              <select
                value={riskFilter || ''}
                onChange={(e) => setRiskFilter(e.target.value || null)}
                className={`px-3 py-1.5 text-sm rounded-lg border ${borderColor} ${bgTertiary} ${textPrimary} focus:outline-none focus:ring-1 focus:ring-teal-500`}
              >
                <option value="">All Risk</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={`border-b ${borderColor} ${bgTertiary}`}>
                  <th className={`text-left text-xs font-medium ${textMuted} uppercase tracking-wider px-4 py-3`}>Change</th>
                  <th className={`text-left text-xs font-medium ${textMuted} uppercase tracking-wider px-4 py-3`}>Status</th>
                  <th className={`text-left text-xs font-medium ${textMuted} uppercase tracking-wider px-4 py-3`}>Risk</th>
                  <th className={`text-left text-xs font-medium ${textMuted} uppercase tracking-wider px-4 py-3`}>Policy</th>
                  <th className={`text-left text-xs font-medium ${textMuted} uppercase tracking-wider px-4 py-3`}>Time</th>
                  <th className={`text-left text-xs font-medium ${textMuted} uppercase tracking-wider px-4 py-3 w-12`}></th>
                </tr>
              </thead>
              <tbody>
                {(sessionsLoading || sandboxLoading) ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12">
                      <RefreshCw className="h-6 w-6 text-teal-500 animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : filteredChanges.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12">
                      <FileText className={`h-8 w-8 mx-auto mb-2 ${textMuted}`} />
                      <p className={textMuted}>No changes found</p>
                    </td>
                  </tr>
                ) : (
                  filteredChanges.slice(0, 20).map((change) => (
                    <tr
                      key={change.id}
                      className={`border-b ${borderColor} cursor-pointer transition-colors ${hoverBg} ${
                        selectedChange?.id === change.id 
                          ? isDarkMode ? 'bg-teal-500/10 border-l-2 border-l-teal-500' : 'bg-teal-50 border-l-2 border-l-teal-500'
                          : ''
                      }`}
                      onClick={() => setSelectedChange(change)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100'}`}>
                            {change.type === 'sandbox' ? (
                              <Target className={`h-4 w-4 ${textSecondary}`} />
                            ) : (
                              <GitCommit className={`h-4 w-4 ${textSecondary}`} />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className={`text-sm font-medium truncate max-w-[200px] ${textPrimary}`}>
                              {change.prompt}
                            </p>
                            <p className={`text-xs ${textMuted}`}>
                              {change.type === 'sandbox' ? `${change.repository}/${change.branch}` : `${change.file_count} file(s)`}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                          change.status === 'approved' || change.status === 'auto_approved' || change.status === 'passed'
                            ? isDarkMode ? 'bg-green-500/10 text-green-400' : 'bg-green-100 text-green-700'
                            : change.status === 'rejected' || change.status === 'failed'
                            ? isDarkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-100 text-red-700'
                            : isDarkMode ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {change.status === 'auto_approved' && <Zap className="h-3 w-3" />}
                          {(change.status === 'approved' || change.status === 'passed') && <CheckCircle className="h-3 w-3" />}
                          {(change.status === 'rejected' || change.status === 'failed') && <XCircle className="h-3 w-3" />}
                          {(change.status === 'pending' || change.status === 'running') && <Clock className="h-3 w-3" />}
                          {change.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {change.risk_assessment ? (
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${
                              change.risk_assessment.risk_level === 'low' ? 'bg-green-500' :
                              change.risk_assessment.risk_level === 'medium' ? 'bg-yellow-500' :
                              change.risk_assessment.risk_level === 'high' ? 'bg-orange-500' : 'bg-red-500'
                            }`} />
                            <span className={`text-xs ${textSecondary}`}>
                              {change.risk_assessment.risk_score}
                            </span>
                          </div>
                        ) : (
                          <span className={`text-xs ${textMuted}`}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {change.policy_results ? (
                          <div className="flex items-center gap-1">
                            {change.policy_results.failed > 0 ? (
                              <span className="text-xs text-red-500">{change.policy_results.failed} failed</span>
                            ) : (
                              <span className="text-xs text-green-500">Passed</span>
                            )}
                          </div>
                        ) : (
                          <span className={`text-xs ${textMuted}`}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs ${textMuted}`}>
                          {formatRelativeTime(change.created_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <ChevronRight className={`h-4 w-4 ${textMuted}`} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Activity Feed (when no selection) */}
        {!selectedChange && (
          <div className={`w-80 rounded-xl border ${borderColor} ${bgSecondary} overflow-hidden`}>
            <div className={`p-4 border-b ${borderColor} flex items-center justify-between`}>
              <h3 className={`text-sm font-semibold ${textPrimary}`}>Recent Activity</h3>
              <select
                value={eventFilter || ''}
                onChange={(e) => setEventFilter(e.target.value || null)}
                className={`text-xs ${bgTertiary} border ${borderColor} rounded px-2 py-1 ${textPrimary}`}
              >
                <option value="">All events</option>
                <option value="change_proposed">Proposed</option>
                <option value="risk_assessed">Risk Assessed</option>
                <option value="change_approved">Approved</option>
                <option value="apply_completed">Applied</option>
              </select>
            </div>

            <div className="max-h-[600px] overflow-y-auto">
              {eventsLoading ? (
                <div className="p-8 text-center">
                  <RefreshCw className="h-5 w-5 text-teal-500 animate-spin mx-auto" />
                </div>
              ) : auditEvents?.length === 0 ? (
                <div className="p-8 text-center">
                  <Activity className={`h-8 w-8 mx-auto mb-2 ${textMuted}`} />
                  <p className={textMuted}>No activity yet</p>
                </div>
              ) : (
                <div className="divide-y divide-[#1f1f1f]">
                  {auditEvents?.slice(0, 30).map((event, idx) => (
                    <div key={event.id} className={`p-4 ${hoverBg} transition-colors`}>
                      <div className="flex items-start gap-3">
                        <div className={`p-1.5 rounded-lg ${
                          event.event_type.includes('approved') ? isDarkMode ? 'bg-green-500/10' : 'bg-green-100' :
                          event.event_type.includes('rejected') ? isDarkMode ? 'bg-red-500/10' : 'bg-red-100' :
                          event.event_type.includes('risk') ? isDarkMode ? 'bg-orange-500/10' : 'bg-orange-100' :
                          isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100'
                        }`}>
                          {event.event_type.includes('approved') ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : event.event_type.includes('rejected') ? (
                            <XCircle className="h-4 w-4 text-red-500" />
                          ) : event.event_type.includes('risk') ? (
                            <ShieldAlert className="h-4 w-4 text-orange-500" />
                          ) : event.event_type.includes('policy') ? (
                            <FileWarning className="h-4 w-4 text-purple-500" />
                          ) : (
                            <Activity className={`h-4 w-4 ${textSecondary}`} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${textPrimary} line-clamp-2`}>{event.summary}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100'} ${textMuted}`}>
                              {event.event_type.replace(/_/g, ' ')}
                            </span>
                            <span className={`text-xs ${textMuted}`}>
                              {formatRelativeTime(event.timestamp)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Detail Panel - Slide out */}
      {selectedChange && (
        <>
          {/* Navigation Controls */}
          <div className="fixed left-[410px] top-1/2 -translate-y-1/2 z-50 flex flex-col gap-2">
            <button
              onClick={() => setSelectedChange(null)}
              className={`p-2 rounded-lg ${isDarkMode ? 'bg-[#1f1f1f] hover:bg-[#2a2a2a]' : 'bg-white hover:bg-gray-100'} border ${borderColor} shadow-lg transition-colors`}
            >
              <X className={`h-4 w-4 ${textSecondary}`} />
            </button>
            <button
              onClick={goToPrevious}
              disabled={currentIndex <= 0}
              className={`p-2 rounded-lg ${isDarkMode ? 'bg-[#1f1f1f] hover:bg-[#2a2a2a]' : 'bg-white hover:bg-gray-100'} border ${borderColor} shadow-lg transition-colors disabled:opacity-30`}
            >
              <ChevronUp className={`h-4 w-4 ${textSecondary}`} />
            </button>
            <button
              onClick={goToNext}
              disabled={currentIndex >= filteredChanges.length - 1}
              className={`p-2 rounded-lg ${isDarkMode ? 'bg-[#1f1f1f] hover:bg-[#2a2a2a]' : 'bg-white hover:bg-gray-100'} border ${borderColor} shadow-lg transition-colors disabled:opacity-30`}
            >
              <ChevronDown className={`h-4 w-4 ${textSecondary}`} />
            </button>
          </div>

          {/* Panel */}
          <div className={`fixed top-0 right-0 h-full w-[calc(100%-460px)] z-40 ${bgSecondary} border-l ${borderColor} shadow-2xl overflow-hidden flex flex-col`}>
            {/* Panel Header */}
            <div className={`p-6 border-b ${borderColor}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    {selectedChange.risk_assessment && (
                      <RiskBadge level={selectedChange.risk_assessment.risk_level as any} />
                    )}
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      selectedChange.status === 'approved' || selectedChange.status === 'auto_approved'
                        ? isDarkMode ? 'bg-green-500/10 text-green-400' : 'bg-green-100 text-green-700'
                        : selectedChange.status === 'rejected'
                        ? isDarkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-100 text-red-700'
                        : isDarkMode ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {selectedChange.status}
                    </span>
                  </div>
                  <h2 className={`text-xl font-semibold ${textPrimary} mb-1`}>
                    {selectedChange.type === 'sandbox' 
                      ? `Sandbox Test: ${selectedChange.repository}/${selectedChange.branch}`
                      : selectedChange.prompt}
                  </h2>
                  <div className="flex items-center gap-4 text-sm">
                    {selectedChange.type === 'sandbox' ? (
                      <>
                        <span className={textMuted}>{selectedChange.repository}</span>
                        <span className={textMuted}>•</span>
                        <span className={textMuted}>{selectedChange.branch}</span>
                        <span className={textMuted}>•</span>
                        <span className={textMuted}>By {selectedChange.user}</span>
                      </>
                    ) : (
                      <>
                        <span className={textMuted}>{selectedChange.file_count} files</span>
                        <span className={textMuted}>•</span>
                        <span className={textMuted}>{formatRelativeTime(selectedChange.created_at)}</span>
                      </>
                    )}
                    <span className={textMuted}>•</span>
                    <span className={textMuted}>{formatRelativeTime(selectedChange.created_at)}</span>
                    {selectedChange.risk_assessment && (
                      <>
                        <span className={textMuted}>•</span>
                        <span className={textMuted}>Score: {selectedChange.risk_assessment.risk_score}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 mt-6">
                {[
                  { id: 'timeline', label: 'Timeline', icon: GitBranch },
                  { id: 'risk', label: 'Risk Analysis', icon: ShieldAlert },
                  { id: 'policy', label: 'Policy', icon: Scale },
                  { id: 'history', label: 'History', icon: Clock },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
                      activeTab === tab.id
                        ? isDarkMode ? 'bg-teal-500/10 text-teal-400' : 'bg-teal-50 text-teal-600'
                        : `${textMuted} ${hoverBg}`
                    }`}
                  >
                    <tab.icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Panel Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'timeline' && (
                <div>
                  <h3 className={`text-sm font-semibold ${textPrimary} mb-4 flex items-center gap-2`}>
                    <GitBranch className="h-4 w-4 text-teal-500" />
                    {selectedChange.type === 'sandbox' ? 'Sandbox Execution Timeline' : 'Governance Lifecycle'}
                  </h3>
                  {selectedChange.type === 'sandbox' ? (
                    <>
                      {sandboxDetailLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <RefreshCw className="h-6 w-6 text-teal-500 animate-spin" />
                        </div>
                      ) : detailedSandboxRun ? (
                        <div className="space-y-4">
                          {/* Sandbox Steps */}
                          {detailedSandboxRun.steps && detailedSandboxRun.steps.length > 0 && (
                            <div className={`rounded-xl border ${borderColor} ${bgTertiary} p-4`}>
                              <h4 className={`text-sm font-semibold ${textPrimary} mb-3`}>Execution Steps</h4>
                              <div className="space-y-2">
                                {detailedSandboxRun.steps.map((step: any, idx: number) => (
                                  <div key={idx} className={`flex items-center gap-3 p-3 rounded-lg ${isDarkMode ? 'bg-[#1f1f1f]' : 'bg-white'}`}>
                                    <div className={`p-1.5 rounded ${
                                      step.status === 'passed' ? 'bg-green-500/10' :
                                      step.status === 'failed' ? 'bg-red-500/10' :
                                      step.status === 'running' ? 'bg-amber-500/10' : 'bg-gray-500/10'
                                    }`}>
                                      {step.status === 'passed' ? (
                                        <CheckCircle className="h-4 w-4 text-green-500" />
                                      ) : step.status === 'failed' ? (
                                        <XCircle className="h-4 w-4 text-red-500" />
                                      ) : step.status === 'running' ? (
                                        <RefreshCw className="h-4 w-4 text-amber-500 animate-spin" />
                                      ) : (
                                        <Clock className="h-4 w-4 text-gray-500" />
                                      )}
                                    </div>
                                    <div className="flex-1">
                                      <p className={`text-sm font-medium ${textPrimary}`}>{step.name}</p>
                                      {step.message && (
                                        <p className={`text-xs ${textMuted} mt-1`}>{step.message}</p>
                                      )}
                                    </div>
                                    <span className={`text-xs ${textMuted}`}>
                                      {step.duration_ms ? `${(step.duration_ms / 1000).toFixed(1)}s` : '—'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {/* Audit Trail */}
                          {timelineLoading ? (
                            <div className="flex items-center justify-center py-4">
                              <RefreshCw className="h-5 w-5 text-teal-500 animate-spin" />
                            </div>
                          ) : timeline?.events && timeline.events.length > 0 ? (
                            <div className={`rounded-xl border ${borderColor} ${bgTertiary} p-4`}>
                              <h4 className={`text-sm font-semibold ${textPrimary} mb-3`}>Audit Trail</h4>
                              <div className="space-y-2">
                                {timeline.events.map((event: any, idx: number) => (
                                  <div key={idx} className={`flex items-start gap-3 p-3 rounded-lg ${isDarkMode ? 'bg-[#1f1f1f]' : 'bg-white'}`}>
                                    <div className={`p-1.5 rounded-lg ${
                                      event.event_type?.includes('approved') || event.event_type?.includes('passed') ? 'bg-green-500/10' :
                                      event.event_type?.includes('rejected') || event.event_type?.includes('failed') ? 'bg-red-500/10' :
                                      'bg-[#1f1f1f]'
                                    }`}>
                                      <Activity className="h-4 w-4 text-teal-500" />
                                    </div>
                                    <div className="flex-1">
                                      <p className={`text-sm ${textPrimary}`}>{event.summary || event.action}</p>
                                      <div className="flex items-center gap-2 mt-1">
                                        <span className={`text-xs ${textMuted}`}>
                                          {formatRelativeTime(event.timestamp)}
                                        </span>
                                        {event.user && (
                                          <>
                                            <span className={textMuted}>•</span>
                                            <span className={`text-xs ${textMuted}`}>{event.user}</span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <p className={textMuted}>No audit trail available</p>
                          )}
                        </div>
                      ) : (
                        <p className={textMuted}>No sandbox details available</p>
                      )}
                    </>
                  ) : (
                    <>
                      {timelineLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <RefreshCw className="h-6 w-6 text-teal-500 animate-spin" />
                        </div>
                      ) : timeline ? (
                        <LifecycleTimeline
                          changeId={selectedChange.id}
                          timeline={timeline.timeline || []}
                          summary={timeline.summary}
                          loading={false}
                        />
                      ) : (
                        <p className={textMuted}>No timeline data available</p>
                      )}
                    </>
                  )}
                </div>
              )}

              {activeTab === 'risk' && (
                <div className="space-y-6">
                  <h3 className={`text-sm font-semibold ${textPrimary} mb-4 flex items-center gap-2`}>
                    <ShieldAlert className="h-4 w-4 text-orange-500" />
                    Risk Assessment
                  </h3>
                  
                  {selectedChange.type === 'sandbox' && detailedSandboxRun && (
                    <div className={`rounded-xl border ${borderColor} ${bgTertiary} p-4 space-y-4`}>
                      <h4 className={`text-sm font-semibold ${textPrimary}`}>Sandbox Risk Details</h4>
                      
                      {/* Resources Detected */}
                      {detailedSandboxRun.resources_detected && detailedSandboxRun.resources_detected.length > 0 && (
                        <div>
                          <p className={`text-xs font-medium ${textSecondary} mb-2`}>Resources Detected</p>
                          <div className="space-y-1">
                            {detailedSandboxRun.resources_detected.map((resource: any, idx: number) => (
                              <div key={idx} className={`flex items-center justify-between p-2 rounded ${isDarkMode ? 'bg-[#1f1f1f]' : 'bg-white'}`}>
                                <span className={`text-sm ${textPrimary}`}>
                                  {resource.type}.{resource.name}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded ${
                                  resource.action === 'create' ? 'bg-green-500/10 text-green-400' :
                                  resource.action === 'update' ? 'bg-amber-500/10 text-amber-400' :
                                  resource.action === 'delete' ? 'bg-red-500/10 text-red-400' :
                                  'bg-gray-500/10 text-gray-400'
                                }`}>
                                  {resource.action}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Security Issues */}
                      {detailedSandboxRun.security_issues !== undefined && (
                        <div className="flex items-center justify-between">
                          <span className={`text-sm ${textSecondary}`}>Security Issues</span>
                          <span className={`text-sm font-medium ${
                            detailedSandboxRun.security_issues > 0 ? 'text-red-500' : 'text-green-500'
                          }`}>
                            {detailedSandboxRun.security_issues || 0}
                          </span>
                        </div>
                      )}
                      
                      {/* Auto-heal Status */}
                      {detailedSandboxRun.auto_healed && (
                        <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-amber-50 border border-amber-200'}`}>
                          <div className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-amber-500" />
                            <span className={`text-sm font-medium ${isDarkMode ? 'text-amber-400' : 'text-amber-700'}`}>
                              Auto-healed {detailedSandboxRun.attempts || 1} time(s)
                            </span>
                          </div>
                          {detailedSandboxRun.fixes_applied && detailedSandboxRun.fixes_applied.length > 0 && (
                            <p className={`text-xs ${isDarkMode ? 'text-amber-300' : 'text-amber-600'} mt-1`}>
                              {detailedSandboxRun.fixes_applied.length} fix(es) applied
                            </p>
                          )}
                        </div>
                      )}
                      
                      {/* Providers Used */}
                      {detailedSandboxRun.providers_used && detailedSandboxRun.providers_used.length > 0 && (
                        <div>
                          <p className={`text-xs font-medium ${textSecondary} mb-2`}>Providers Used</p>
                          <div className="flex flex-wrap gap-2">
                            {detailedSandboxRun.providers_used.map((provider: string, idx: number) => (
                              <span key={idx} className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-[#1f1f1f]' : 'bg-white'} ${textPrimary}`}>
                                {provider}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {selectedChange.risk_assessment ? (
                    <>
                      {/* Risk Score Visualization */}
                      <div className={`p-4 rounded-xl border ${borderColor} ${bgTertiary}`}>
                        <div className="flex items-center justify-between mb-4">
                          <span className={`text-sm font-medium ${textPrimary}`}>Overall Risk Score</span>
                          <span className={`text-2xl font-bold ${
                            selectedChange.risk_assessment.risk_level === 'low' ? 'text-green-500' :
                            selectedChange.risk_assessment.risk_level === 'medium' ? 'text-yellow-500' :
                            selectedChange.risk_assessment.risk_level === 'high' ? 'text-orange-500' : 'text-red-500'
                          }`}>
                            {selectedChange.risk_assessment.risk_score}
                          </span>
                        </div>
                        <div className={`h-3 rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-200'}`}>
                          <div 
                            className={`h-full transition-all duration-500 ${
                              selectedChange.risk_assessment.risk_level === 'low' ? 'bg-green-500' :
                              selectedChange.risk_assessment.risk_level === 'medium' ? 'bg-yellow-500' :
                              selectedChange.risk_assessment.risk_level === 'high' ? 'bg-orange-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${selectedChange.risk_assessment.risk_score}%` }}
                          />
                        </div>
                        <div className="flex justify-between mt-2 text-xs">
                          <span className="text-green-500">Low (0-25)</span>
                          <span className="text-yellow-500">Medium (26-50)</span>
                          <span className="text-orange-500">High (51-75)</span>
                          <span className="text-red-500">Critical (76-100)</span>
                        </div>
                      </div>

                      {/* Risk Factors */}
                      <div className={`p-4 rounded-xl border ${borderColor} ${bgTertiary}`}>
                        <h4 className={`text-sm font-medium ${textPrimary} mb-3`}>Risk Factors</h4>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className={`text-sm ${textSecondary}`}>Auto-Approve Eligible</span>
                            {selectedChange.risk_assessment.auto_approve ? (
                              <span className="flex items-center gap-1 text-green-500 text-sm">
                                <CheckCircle className="h-4 w-4" /> Yes
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-amber-500 text-sm">
                                <Lock className="h-4 w-4" /> No
                              </span>
                            )}
                          </div>
                          {selectedChange.risk_assessment.factors && (
                            <>
                              <div className="flex items-center justify-between">
                                <span className={`text-sm ${textSecondary}`}>Resource Types</span>
                                <span className={`text-sm ${textPrimary}`}>
                                  {selectedChange.risk_assessment.factors.resource_types?.join(', ') || 'N/A'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className={`text-sm ${textSecondary}`}>Operations</span>
                                <span className={`text-sm ${textPrimary}`}>
                                  {selectedChange.risk_assessment.factors.operations?.join(', ') || 'N/A'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className={`text-sm ${textSecondary}`}>Environment</span>
                                <span className={`text-sm ${textPrimary}`}>
                                  {selectedChange.risk_assessment.factors.environment || 'N/A'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className={`text-sm ${textSecondary}`}>Policy Violations</span>
                                <span className={`text-sm ${selectedChange.risk_assessment.factors.policy_violations > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                  {selectedChange.risk_assessment.factors.policy_violations || 0}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className={`p-8 text-center rounded-xl border ${borderColor} ${bgTertiary}`}>
                      <ShieldX className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} />
                      <p className={textSecondary}>No risk assessment available</p>
                      <p className={`text-sm ${textMuted} mt-1`}>Risk will be calculated when the change is processed</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'policy' && (
                <div className="space-y-6">
                  <h3 className={`text-sm font-semibold ${textPrimary} mb-4 flex items-center gap-2`}>
                    <Scale className="h-4 w-4 text-purple-500" />
                    Policy Compliance
                  </h3>
                  
                  {selectedChange.type === 'sandbox' && detailedSandboxRun && (
                    <div className={`rounded-xl border ${borderColor} ${bgTertiary} p-4 space-y-4`}>
                      <h4 className={`text-sm font-semibold ${textPrimary}`}>Sandbox Policy Checks</h4>
                      
                      <div className="grid grid-cols-3 gap-4">
                        <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-green-500/30 bg-green-500/5' : 'border-green-200 bg-green-50'}`}>
                          <CheckCircle2 className="h-5 w-5 text-green-500 mb-2" />
                          <p className="text-2xl font-bold text-green-500">
                            {detailedSandboxRun.steps?.filter((s: any) => s.status === 'passed').length || 0}
                          </p>
                          <p className={`text-xs ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>Passed</p>
                        </div>
                        <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-red-500/30 bg-red-500/5' : 'border-red-200 bg-red-50'}`}>
                          <XCircle className="h-5 w-5 text-red-500 mb-2" />
                          <p className="text-2xl font-bold text-red-500">
                            {detailedSandboxRun.steps?.filter((s: any) => s.status === 'failed').length || 0}
                          </p>
                          <p className={`text-xs ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>Failed</p>
                        </div>
                        <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-amber-500/30 bg-amber-500/5' : 'border-amber-200 bg-amber-50'}`}>
                          <AlertTriangle className="h-5 w-5 text-amber-500 mb-2" />
                          <p className="text-2xl font-bold text-amber-500">
                            {detailedSandboxRun.security_issues || 0}
                          </p>
                          <p className={`text-xs ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>Security Issues</p>
                        </div>
                      </div>
                      
                      {detailedSandboxRun.errors && detailedSandboxRun.errors.length > 0 && (
                        <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-red-500/10 border border-red-500/20' : 'bg-red-50 border border-red-200'}`}>
                          <p className={`text-sm font-medium ${isDarkMode ? 'text-red-400' : 'text-red-700'} mb-2`}>Errors</p>
                          <ul className="space-y-1">
                            {detailedSandboxRun.errors.map((error: string, idx: number) => (
                              <li key={idx} className={`text-xs ${isDarkMode ? 'text-red-300' : 'text-red-600'}`}>
                                • {error}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {detailedSandboxRun.warnings && detailedSandboxRun.warnings.length > 0 && (
                        <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-amber-50 border border-amber-200'}`}>
                          <p className={`text-sm font-medium ${isDarkMode ? 'text-amber-400' : 'text-amber-700'} mb-2`}>Warnings</p>
                          <ul className="space-y-1">
                            {detailedSandboxRun.warnings.map((warning: string, idx: number) => (
                              <li key={idx} className={`text-xs ${isDarkMode ? 'text-amber-300' : 'text-amber-600'}`}>
                                • {warning}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {selectedChange.policy_results ? (
                    <>
                      <div className="grid grid-cols-3 gap-4">
                        <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-green-500/30 bg-green-500/5' : 'border-green-200 bg-green-50'}`}>
                          <CheckCircle2 className="h-5 w-5 text-green-500 mb-2" />
                          <p className="text-2xl font-bold text-green-500">{selectedChange.policy_results.passed}</p>
                          <p className={`text-xs ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>Passed</p>
                        </div>
                        <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-red-500/30 bg-red-500/5' : 'border-red-200 bg-red-50'}`}>
                          <XCircle className="h-5 w-5 text-red-500 mb-2" />
                          <p className="text-2xl font-bold text-red-500">{selectedChange.policy_results.failed}</p>
                          <p className={`text-xs ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>Failed</p>
                        </div>
                        <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-amber-500/30 bg-amber-500/5' : 'border-amber-200 bg-amber-50'}`}>
                          <AlertTriangle className="h-5 w-5 text-amber-500 mb-2" />
                          <p className="text-2xl font-bold text-amber-500">{selectedChange.policy_results.warnings}</p>
                          <p className={`text-xs ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>Warnings</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className={`p-8 text-center rounded-xl border ${borderColor} ${bgTertiary}`}>
                      <FileWarning className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} />
                      <p className={textSecondary}>No policy results available</p>
                      <p className={`text-sm ${textMuted} mt-1`}>Policies will be evaluated when the change is processed</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'history' && (
                <div>
                  <h3 className={`text-sm font-semibold ${textPrimary} mb-4 flex items-center gap-2`}>
                    <Clock className="h-4 w-4 text-blue-500" />
                    Change History
                  </h3>
                  <div className="space-y-3">
                    <div className={`p-3 rounded-lg border ${borderColor} ${bgTertiary}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-sm ${textSecondary}`}>Created</span>
                        <span className={`text-sm ${textPrimary}`}>
                          {new Date(selectedChange.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className={`p-3 rounded-lg border ${borderColor} ${bgTertiary}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-sm ${textSecondary}`}>Last Updated</span>
                        <span className={`text-sm ${textPrimary}`}>
                          {new Date(selectedChange.updated_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className={`p-3 rounded-lg border ${borderColor} ${bgTertiary}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-sm ${textSecondary}`}>Current Status</span>
                        <span className={`text-sm ${textPrimary}`}>{selectedChange.status}</span>
                      </div>
                    </div>
                    <div className={`p-3 rounded-lg border ${borderColor} ${bgTertiary}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-sm ${textSecondary}`}>Change ID</span>
                        <code className={`text-xs font-mono ${textMuted}`}>{selectedChange.diff_id}</code>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function formatRelativeTime(timestamp: string): string {
  try {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
    return `${Math.floor(diffMins / 1440)}d ago`
  } catch {
    return timestamp
  }
}
