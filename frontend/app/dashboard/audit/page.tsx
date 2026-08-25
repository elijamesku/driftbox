'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import {
  ScrollText, Download, Filter, Search, Clock, User, Shield,
  Activity, ChevronRight, ChevronDown, X, ExternalLink, Copy,
  Check, AlertTriangle, CheckCircle, Info, GitBranch, Terminal,
  FileText, Settings, Eye, RefreshCw, Calendar, Globe, Server,
  ChevronUp, Play, Pause, Zap, Lock, Database, ArrowUpRight,
  ArrowDownRight, Minus, Loader2, Plus, Users
} from 'lucide-react'

interface AuditLog {
  id: string
  user: string
  userEmail: string
  userAvatar?: string
  action: string
  actionType: 'create' | 'update' | 'delete' | 'approve' | 'deploy' | 'scan' | 'alert' | 'login' | 'system'
  resource: string
  resourceType: string
  severity: 'info' | 'warning' | 'critical' | 'success'
  timestamp: string
  ip: string
  location?: string
  details?: string
  metadata?: Record<string, string>
}

interface Team {
  id: string
  name: string
}

// Fetch teams the current user is a member of (API returns only user's teams)
async function fetchUserTeams(token: string): Promise<Team[]> {
  const response = await fetch(getApiEndpoint('/teams/'), {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!response.ok) return []
  const data = await response.json()
  // API returns List<TeamResponse> (array), not { teams: [...] }
  const list = Array.isArray(data) ? data : (data.teams || [])
  return list.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }))
}

// Avatar colors based on user name
const avatarColors = [
  { from: '#14b8a6', to: '#0d9488' }, // Teal
  { from: '#a855f7', to: '#7c3aed' }, // Purple
  { from: '#f59e0b', to: '#d97706' }, // Amber
  { from: '#3b82f6', to: '#2563eb' }, // Blue
  { from: '#ef4444', to: '#dc2626' }, // Red
  { from: '#22c55e', to: '#16a34a' }, // Green
  { from: '#ec4899', to: '#db2777' }, // Pink
  { from: '#6366f1', to: '#4f46e5' }, // Indigo
]

const getAvatarColor = (name: string) => {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % avatarColors.length
  return avatarColors[index]
}

// Fetch audit logs from API
const fetchAuditLogs = async (
  token: string,
  params: {
    limit?: number
    offset?: number
    action_type?: string
    severity?: string
    search?: string
    team_id?: string
  }
): Promise<{ logs: AuditLog[]; total: number; stats: any }> => {
  const queryParams = new URLSearchParams()
  if (params.limit) queryParams.set('limit', params.limit.toString())
  if (params.offset) queryParams.set('offset', params.offset.toString())
  if (params.action_type && params.action_type !== 'all') queryParams.set('action_type', params.action_type)
  if (params.severity && params.severity !== 'all') queryParams.set('severity', params.severity)
  if (params.search) queryParams.set('search', params.search)
  if (params.team_id) queryParams.set('team_id', params.team_id)
  
  const response = await fetch(getApiEndpoint(`/audit-logs/logs?${queryParams.toString()}`), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMsg = errorData.detail?.message || errorData.message || 'Failed to fetch audit logs'
    console.error('[AuditLogs] API Error:', errorMsg, errorData)
    throw new Error(errorMsg)
  }
  
  const data = await response.json()
  if (!data.ok && data.error) {
    console.error('[AuditLogs] Service Error:', data.error)
  }
  return {
    logs: data.logs || [],
    total: data.total || 0,
    stats: data.stats || {},
  }
}

// Action type badge
function ActionTypeBadge({ type, isDarkMode }: { type: string; isDarkMode: boolean }) {
  const config: Record<string, { bg: string; text: string; icon: typeof Activity }> = {
    create: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', icon: Plus },
    update: { bg: 'bg-blue-500/10', text: 'text-blue-400', icon: RefreshCw },
    delete: { bg: 'bg-red-500/10', text: 'text-red-400', icon: X },
    approve: { bg: 'bg-purple-500/10', text: 'text-purple-400', icon: CheckCircle },
    deploy: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', icon: Zap },
    scan: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', icon: Terminal },
    alert: { bg: 'bg-orange-500/10', text: 'text-orange-400', icon: AlertTriangle },
    login: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', icon: User },
    system: { bg: 'bg-gray-500/10', text: 'text-gray-400', icon: Server },
  }
  const c = config[type] || config.system
  const Icon = c.icon
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium capitalize ${c.bg} ${c.text}`}>
      <Icon className="h-3 w-3" />
      {type}
    </span>
  )
}

// Severity indicator
function SeverityIndicator({ severity }: { severity: string }) {
  const config: Record<string, { color: string; icon: typeof Info }> = {
    info: { color: 'text-blue-400', icon: Info },
    warning: { color: 'text-yellow-400', icon: AlertTriangle },
    critical: { color: 'text-red-400', icon: AlertTriangle },
    success: { color: 'text-emerald-400', icon: CheckCircle },
  }
  const c = config[severity] || config.info
  const Icon = c.icon
  
  return <Icon className={`h-4 w-4 ${c.color}`} />
}

// Format relative time
function formatRelativeTime(timestamp: string): string {
  const now = new Date()
  const date = new Date(timestamp)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

// Format full timestamp
function formatFullTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString()
}

// Detail Panel
function LogDetailPanel({
  log,
  onClose,
  isDarkMode,
}: {
  log: AuditLog
  onClose: () => void
  isDarkMode: boolean
}) {
  const [copied, setCopied] = useState(false)
  
  const copyLogId = () => {
    navigator.clipboard.writeText(log.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  
  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/60 z-30" onClick={onClose} />
      
      {/* Navigation */}
      <div className="fixed left-[410px] top-20 z-50 flex flex-col items-center gap-2">
        <button
          onClick={onClose}
          className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all shadow-lg ${
            isDarkMode 
              ? 'border-[#444444] bg-[#1a1a1a] text-[#888888] hover:text-[#fafafa] hover:border-[#14b8a6]'
              : 'border-gray-300 bg-white text-gray-500 hover:text-gray-900 hover:border-[#14b8a6]'
          }`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      
      {/* Panel */}
      <div className={`fixed top-0 right-0 bottom-0 w-[calc(100%-460px)] flex flex-col overflow-hidden z-40 shadow-2xl ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-white'}`}>
        {/* Header */}
        <div className={`px-6 py-5 border-b ${isDarkMode ? 'border-[#1f1f1f] bg-[#0f0f0f]' : 'border-gray-200 bg-gray-50'}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-xl ${
                log.severity === 'critical' ? 'bg-red-500/10' :
                log.severity === 'warning' ? 'bg-yellow-500/10' :
                log.severity === 'success' ? 'bg-emerald-500/10' : 'bg-blue-500/10'
              }`}>
                <SeverityIndicator severity={log.severity} />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{log.action}</h2>
                  <ActionTypeBadge type={log.actionType} isDarkMode={isDarkMode} />
                </div>
                <div className={`flex items-center gap-4 text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                  <span className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    {log.user}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {formatFullTimestamp(log.timestamp)}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={copyLogId}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isDarkMode ? 'bg-[#1f1f1f] text-[#a1a1a1] hover:bg-[#2f2f2f]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy ID'}
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Event Details */}
            <div className={`p-5 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
              <h3 className={`text-sm font-medium mb-4 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Event Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Event ID</p>
                  <p className={`text-sm font-mono ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{log.id}</p>
                </div>
                <div>
                  <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Action Type</p>
                  <p className={`text-sm capitalize ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{log.actionType}</p>
                </div>
                <div>
                  <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Severity</p>
                  <p className={`text-sm capitalize ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{log.severity}</p>
                </div>
                <div>
                  <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Duration</p>
                  <p className={`text-sm ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{log.metadata?.duration || 'N/A'}</p>
                </div>
              </div>
            </div>
            
            {/* User Information */}
            <div className={`p-5 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
              <h3 className={`text-sm font-medium mb-4 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>User Information</h3>
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#14b8a6] to-[#0d9488] flex items-center justify-center text-lg font-semibold text-white">
                  {log.user === 'System' ? 'S' : log.user.split(' ').map(n => n[0]).join('')}
                </div>
                <div>
                  <p className={`font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{log.user}</p>
                  <p className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{log.userEmail}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>IP Address</p>
                  <p className={`text-sm font-mono ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{log.ip}</p>
                </div>
                <div>
                  <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Location</p>
                  <p className={`text-sm ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{log.location}</p>
                </div>
              </div>
            </div>
            
            {/* Resource Information */}
            <div className={`p-5 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
              <h3 className={`text-sm font-medium mb-4 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Resource</h3>
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-[#14b8a6]/10' : 'bg-[#14b8a6]/10'}`}>
                  <Database className="h-5 w-5 text-[#14b8a6]" />
                </div>
                <div>
                  <p className={`font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{log.resource}</p>
                  <p className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{log.resourceType}</p>
                </div>
              </div>
              <button className="flex items-center gap-2 text-sm text-[#14b8a6] hover:underline">
                <ExternalLink className="h-3.5 w-3.5" />
                View Resource
              </button>
            </div>
            
            {/* Raw Event Data */}
            <div className={`p-5 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
              <h3 className={`text-sm font-medium mb-4 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Raw Event Data</h3>
              <pre className={`text-xs font-mono p-4 rounded-lg overflow-x-auto ${isDarkMode ? 'bg-[#0a0a0a] text-[#a1a1a1]' : 'bg-gray-100 text-gray-700'}`}>
                {JSON.stringify(log, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default function AuditPage() {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [isLive, setIsLive] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  // Initialize selectedTeamId from localStorage or IDE context
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    // Try to get from localStorage first (persisted audit page selection)
    const saved = localStorage.getItem('audit-selected-team-id')
    if (saved) return saved
    // Fallback to IDE context if available
    try {
      const ideState = sessionStorage.getItem('ide_context_state')
      if (ideState) {
        const parsed = JSON.parse(ideState)
        if (parsed.currentTeamId) return parsed.currentTeamId
      }
    } catch {}
    return null
  })
  const logsPerPage = 15
  
  // Persist team selection to localStorage
  useEffect(() => {
    if (selectedTeamId) {
      localStorage.setItem('audit-selected-team-id', selectedTeamId)
    } else {
      localStorage.removeItem('audit-selected-team-id')
    }
  }, [selectedTeamId])
  
  // Theme detection
  useEffect(() => {
    const checkTheme = () => {
      const savedTheme = localStorage.getItem('driftbox-theme')
      if (savedTheme) {
        setIsDarkMode(savedTheme === 'dark')
      } else {
        setIsDarkMode(!document.documentElement.classList.contains('light-mode'))
      }
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
  
  // Fetch user's teams for team selector
  const { data: teams = [] } = useQuery({
    queryKey: ['user-teams', token],
    queryFn: () => fetchUserTeams(token || ''),
    enabled: !!token,
    staleTime: 60000,
  })
  
  // Validate selectedTeamId is still in user's teams (in case they left a team)
  useEffect(() => {
    if (selectedTeamId && teams.length > 0) {
      const isStillMember = teams.some(t => t.id === selectedTeamId)
      if (!isStillMember) {
        setSelectedTeamId(null)
      }
    }
  }, [teams, selectedTeamId])
  
  // Fetch audit logs with TanStack Query
  const { 
    data: auditData, 
    isLoading, 
    error,
    refetch 
  } = useQuery({
    queryKey: ['audit-logs', token, actionFilter, severityFilter, searchQuery, currentPage, selectedTeamId],
    queryFn: () => fetchAuditLogs(token || '', {
      limit: logsPerPage,
      offset: (currentPage - 1) * logsPerPage,
      action_type: actionFilter,
      severity: severityFilter,
      search: searchQuery,
      team_id: selectedTeamId || undefined,
    }),
    enabled: !!token,
    refetchInterval: isLive ? 30000 : false, // Auto-refresh every 30s when live
  })
  
  const logs = auditData?.logs || []
  const totalLogs = auditData?.total || 0
  const stats = auditData?.stats || {}
  
  // Pagination
  const totalPages = Math.ceil(totalLogs / logsPerPage)
  
  // Use stats from API (24h/7d data) instead of just current page
  const criticalEvents = stats.critical || 0
  const warningEvents = stats.warnings || 0
  const uniqueUsers = stats.activeUsers || 0
  
  const actionTypes = ['all', 'create', 'update', 'delete', 'approve', 'deploy', 'scan', 'alert', 'login', 'system']
  const severities = ['all', 'info', 'warning', 'critical', 'success']
  
  // Handle refresh with cache busting
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
    refetch()
  }
  
  return (
    <div className={`min-h-screen p-6 ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
      {/* Detail Panel */}
      {selectedLog && (
        <LogDetailPanel
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
          isDarkMode={isDarkMode}
        />
      )}
      
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className={`text-2xl font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
            Audit Logs
          </h1>
          <p className={`mt-1 text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
            Complete history of all actions and changes across your infrastructure
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsLive(!isLive)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isLive 
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : isDarkMode ? 'bg-[#1f1f1f] text-[#666666]' : 'bg-gray-100 text-gray-500'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-emerald-400 animate-pulse' : isDarkMode ? 'bg-[#666666]' : 'bg-gray-400'}`} />
            {isLive ? 'Live' : 'Paused'}
          </button>
          <button className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isDarkMode ? 'bg-[#1f1f1f] text-[#a1a1a1] hover:bg-[#2f2f2f]' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>
      
      {/* Stats Cards */}
      <div className={`grid gap-4 mb-6 ${selectedTeamId ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {/* Total Events */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-[#14b8a6]/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#14b8a6]/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-[#14b8a6]/10 transition-all" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-[#14b8a6] animate-pulse" />
              <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Total Events</p>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className={`text-4xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{totalLogs.toLocaleString()}</p>
                <p className={`text-xs mt-1 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                  All time
                </p>
              </div>
              {/* Mini activity chart - uses daily stats */}
              <div className="flex items-end gap-1 h-12">
                {(stats.daily && stats.daily.length > 0 
                  ? stats.daily.slice(-10).map((d: { count: number }) => d.count)
                  : [0, 0, 0, 0, 0, 0, 0]
                ).map((count: number, i: number) => {
                  const maxCount = Math.max(...(stats.daily?.map((d: { count: number }) => d.count) || [1]), 1)
                  const height = Math.max(4, (count / maxCount) * 44)
                  return (
                    <div 
                      key={i} 
                      className="w-1.5 rounded-full bg-gradient-to-t from-[#14b8a6]/40 to-[#14b8a6] transition-all hover:from-[#14b8a6]/60"
                      style={{ height: `${height}px` }}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </div>
        
        {/* Critical Events - Circular */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-red-500/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-red-500/10 transition-all" />
          <div className="relative flex items-center gap-4">
            <div className="relative w-20 h-20 flex-shrink-0">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="32" fill="none" stroke={isDarkMode ? "#1f1f1f" : "#e5e7eb"} strokeWidth="8" />
                <circle
                  cx="40" cy="40" r="32" fill="none"
                  stroke="#ef4444"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${Math.min(criticalEvents * 20, 201)} 201`}
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-red-400" />
              </div>
            </div>
            <div>
              <p className={`text-xs font-medium uppercase tracking-wider mb-1 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Critical</p>
              <p className="text-3xl font-bold text-red-400">{criticalEvents}</p>
              <p className={`text-xs mt-1 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Needs attention</p>
            </div>
          </div>
        </div>
        
        {/* Warning Events - Alert style */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-yellow-500/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          {warningEvents > 0 && (
            <div className="absolute top-3 right-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
              </span>
            </div>
          )}
          <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-yellow-500/0 via-yellow-500/50 to-yellow-500/0" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-yellow-400" />
              <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Warnings</p>
            </div>
            <p className={`text-4xl font-bold ${warningEvents > 0 ? 'text-yellow-400' : isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`}>{warningEvents}</p>
            <div className="flex gap-1 mt-3">
              {[...Array(Math.min(warningEvents, 5))].map((_, i) => (
                <div key={i} className="w-6 h-1.5 rounded-full bg-yellow-500/60" />
              ))}
              {warningEvents === 0 && (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" /> All clear
                </span>
              )}
            </div>
          </div>
        </div>
        
        {/* Active Users - Timer style - Only show when team is selected */}
        {selectedTeamId && (
          <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-purple-500/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-purple-500/10 transition-all" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <User className="h-4 w-4 text-purple-400" />
                <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Active Users</p>
              </div>
              <div className="flex items-baseline gap-2">
                <p className={`text-4xl font-bold text-purple-400`}>{uniqueUsers}</p>
                <p className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>users</p>
              </div>
              <div className="flex -space-x-2 mt-3">
                {uniqueUsers > 0 ? (
                  <>
                    {Array.from({ length: Math.min(uniqueUsers, 4) }).map((_, i) => (
                      <div key={i} className={`w-7 h-7 rounded-full bg-gradient-to-br flex items-center justify-center text-[10px] font-medium text-white border-2 ${isDarkMode ? 'border-[#0f0f0f]' : 'border-white'}`}
                        style={{ background: `linear-gradient(135deg, ${avatarColors[i % avatarColors.length].from}, ${avatarColors[i % avatarColors.length].to})` }}>
                        U{i + 1}
                      </div>
                    ))}
                    {uniqueUsers > 4 && (
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium border-2 ${isDarkMode ? 'bg-[#1f1f1f] text-[#666666] border-[#0f0f0f]' : 'bg-gray-200 text-gray-500 border-white'}`}>
                        +{uniqueUsers - 4}
                      </div>
                    )}
                  </>
                ) : (
                  <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>No recent activity</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Filters */}
      <div className="flex items-center gap-4 mb-4">
        {/* Team Selector */}
        <select
          value={selectedTeamId || ''}
          onChange={(e) => {
            setSelectedTeamId(e.target.value || null)
            setCurrentPage(1)
          }}
          className={`px-3 py-2.5 rounded-lg border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#14b8a6]/50 ${
            isDarkMode 
              ? 'bg-[#0f0f0f] border-[#1f1f1f] text-[#fafafa]'
              : 'bg-white border-gray-200 text-gray-900'
          }`}
        >
          <option value="">My activity only</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
        
        <div className="relative flex-1 max-w-md">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
          <input
            type="text"
            placeholder="Search logs by user, action, or resource..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full pl-9 pr-4 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[#14b8a6]/50 ${
              isDarkMode 
                ? 'bg-[#0f0f0f] border-[#1f1f1f] text-[#fafafa] placeholder-[#666666]'
                : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
            }`}
          />
        </div>
        
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className={`px-3 py-2.5 rounded-lg border text-sm focus:outline-none capitalize ${
            isDarkMode 
              ? 'bg-[#0f0f0f] border-[#1f1f1f] text-[#fafafa]'
              : 'bg-white border-gray-200 text-gray-900'
          }`}
        >
          {actionTypes.map((type) => (
            <option key={type} value={type}>{type === 'all' ? 'All Actions' : type}</option>
          ))}
        </select>
        
        <select
          value={severityFilter}
          onChange={(e) => { setSeverityFilter(e.target.value); setCurrentPage(1); }}
          className={`px-3 py-2.5 rounded-lg border text-sm focus:outline-none ${
            isDarkMode 
              ? 'bg-[#0f0f0f] border-[#1f1f1f] text-[#fafafa]'
              : 'bg-white border-gray-200 text-gray-900'
          }`}
        >
          {severities.map((sev) => (
            <option key={sev} value={sev}>{sev === 'all' ? 'All Severities' : sev.charAt(0).toUpperCase() + sev.slice(1)}</option>
          ))}
        </select>
        
        <button 
          onClick={handleRefresh}
          disabled={isLoading}
          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isDarkMode ? 'text-[#14b8a6] hover:bg-[#14b8a6]/10' : 'text-[#0d9488] hover:bg-[#14b8a6]/10'} disabled:opacity-50`}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      
      {/* Logs Table */}
      <div className={`rounded-lg border overflow-hidden ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
        {/* Table Header */}
        <div className={`grid grid-cols-12 gap-4 px-4 py-3 border-b text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'border-[#1f1f1f] text-[#666666]' : 'border-gray-200 text-gray-500'}`}>
          <div className="col-span-1">Severity</div>
          <div className="col-span-3">User</div>
          <div className="col-span-3">Action</div>
          <div className="col-span-2">Resource</div>
          <div className="col-span-1">IP</div>
          <div className="col-span-2">Time</div>
        </div>
        
        {/* Table Body */}
        <div className={`divide-y ${isDarkMode ? 'divide-[#1f1f1f]' : 'divide-gray-100'}`}>
          {isLoading ? (
            <div className="py-12 text-center">
              <Loader2 className={`h-8 w-8 mx-auto mb-4 animate-spin ${isDarkMode ? 'text-[#14b8a6]' : 'text-teal-600'}`} />
              <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}>Loading audit logs...</p>
            </div>
          ) : error ? (
            <div className="py-12 text-center">
              <AlertTriangle className={`h-12 w-12 mx-auto mb-4 ${isDarkMode ? 'text-red-400' : 'text-red-500'}`} />
              <p className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
                Failed to load audit logs
              </p>
              <p className={`text-sm mb-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-600'}`}>
                {error instanceof Error ? error.message : 'Unknown error occurred'}
              </p>
              {error instanceof Error && error.message.includes('table does not exist') && (
                <div className={`mt-4 p-4 rounded-lg ${isDarkMode ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-amber-50 border border-amber-200'}`}>
                  <p className={`text-sm ${isDarkMode ? 'text-amber-300' : 'text-amber-700'}`}>
                    Please run the migration: <code className="font-mono text-xs">007_add_audit_logs_table.sql</code> in your Supabase database.
                  </p>
                </div>
              )}
              <button
                onClick={handleRefresh}
                className="mt-4 px-4 py-2 rounded-md bg-[#14b8a6] text-white text-sm font-medium hover:bg-[#0d9488]"
              >
                Retry
              </button>
            </div>
          ) : logs.map((log) => (
            <div
              key={log.id}
              onClick={() => setSelectedLog(log)}
              className={`grid grid-cols-12 gap-4 px-4 py-3 cursor-pointer transition-colors ${
                selectedLog?.id === log.id
                  ? 'bg-[#14b8a6]/5'
                  : isDarkMode ? 'hover:bg-[#141414]' : 'hover:bg-gray-50'
              }`}
            >
              {/* Severity */}
              <div className="col-span-1 flex items-center">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  log.severity === 'critical' ? 'bg-red-500' :
                  log.severity === 'warning' ? 'bg-yellow-500' :
                  log.severity === 'success' ? 'bg-emerald-500' : 'bg-blue-500'
                }`} />
              </div>
              
              {/* User */}
              <div className="col-span-3 flex items-center gap-3">
                <div 
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
                  style={{ 
                    background: `linear-gradient(135deg, ${getAvatarColor(log.user).from}, ${getAvatarColor(log.user).to})` 
                  }}
                >
                  {log.user === 'System' ? 'S' : log.user.split(' ').map(n => n[0]).join('')}
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-medium truncate ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{log.user}</p>
                  <p className={`text-xs truncate ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{log.userEmail}</p>
                </div>
              </div>
              
              {/* Action */}
              <div className="col-span-3 flex items-center gap-2">
                <ActionTypeBadge type={log.actionType} isDarkMode={isDarkMode} />
                <span className={`text-sm truncate ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>{log.action}</span>
              </div>
              
              {/* Resource */}
              <div className="col-span-2 flex items-center">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs truncate ${isDarkMode ? 'bg-[#1a1a1a] text-[#14b8a6]' : 'bg-gray-100 text-[#0d9488]'}`}>
                  {log.resource}
                </span>
              </div>
              
              {/* IP */}
              <div className="col-span-1 flex items-center">
                <span className={`text-xs font-mono ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{log.ip === 'system' ? '—' : log.ip.split('.').slice(0, 2).join('.') + '...'}</span>
              </div>
              
              {/* Time */}
              <div className="col-span-2 flex items-center justify-between">
                <span className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{formatRelativeTime(log.timestamp)}</span>
                <ChevronRight className={`h-4 w-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
              </div>
            </div>
          ))}
        </div>
        
        {!isLoading && !error && logs.length === 0 && (
          <div className="py-12 text-center">
            <ScrollText className={`h-12 w-12 mx-auto mb-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
            <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}>No audit logs found</p>
          </div>
        )}
      </div>
      
      {/* Pagination */}
      {logs.length > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <p className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
            Showing {((currentPage - 1) * logsPerPage) + 1} to {Math.min(currentPage * logsPerPage, totalLogs)} of {totalLogs.toLocaleString()} logs
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isDarkMode 
                  ? 'border border-[#1f1f1f] bg-[#0f0f0f] text-[#666666] hover:bg-[#141414]'
                  : 'border border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              Previous
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isDarkMode 
                  ? 'border border-[#1f1f1f] bg-[#0f0f0f] text-[#666666] hover:bg-[#141414]'
                  : 'border border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
