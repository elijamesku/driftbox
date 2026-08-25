'use client'

import { useState, Fragment, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, FileCode, GitBranch, AlertTriangle, CheckCircle, RefreshCw, Brain, Sparkles, GitCommit } from 'lucide-react'
import { useDriftData, useSecurityScan, useCostEstimate, useDashboardData } from '@/hooks/useInfrastructureData'
import { useRefreshLock } from '@/hooks/useRefreshLock'
import { useAuth } from '@/contexts'
import InfrastructureStory from './InfrastructureStory'
import PremiumInsights from './PremiumInsights'

interface DriftDetectionProps {
  selectedRepo?: {
    id: number
    name: string
    full_name: string
    default_branch?: string
  } | null
  onFileClick?: (filePath: string, line?: number) => void
  currentTeamId?: string | null
}

export default function DriftDetection({ selectedRepo, onFileClick, currentTeamId }: DriftDetectionProps) {
  const queryClient = useQueryClient()
  const { token } = useAuth()
  const [filterType, setFilterType] = useState<string>('all')
  const [filterSeverity, setFilterSeverity] = useState<string>('all')
  const [aiInsightsEnabled, setAiInsightsEnabled] = useState(false) // AI insights OFF by default to avoid expensive enhanced endpoint on load
  const [activeView, setActiveView] = useState<'drift' | 'story' | 'insights'>('insights')
  const [securityExpanded, setSecurityExpanded] = useState(false)
  const [costExpanded, setCostExpanded] = useState(false)
  const [refreshStatus, setRefreshStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const [owner, repo] = selectedRepo?.full_name.split('/') || [null, null]
  const branch = selectedRepo?.default_branch || 'main'

  // Use TanStack Query hooks for all data fetching
  const { 
    data: driftData, 
    isLoading: driftLoading, 
    error: driftError, 
    refetch: refetchDrift,
    isFetching: driftFetching
  } = useDriftData(owner, repo, branch, aiInsightsEnabled, !!selectedRepo)

  const { 
    data: securityData, 
    isLoading: securityLoading, 
    error: securityError, 
    refetch: refetchSecurity,
    isFetching: securityFetching
  } = useSecurityScan(owner, repo, !!selectedRepo)

  const { 
    data: costData, 
    isLoading: costLoading, 
    error: costError, 
    refetch: refetchCost,
    isFetching: costFetching
  } = useCostEstimate(owner, repo, !!selectedRepo)

  const { 
    data: dashboardData, 
    isLoading: dashboardLoading, 
    error: dashboardError, 
    refetch: refetchDashboard
  } = useDashboardData(owner, repo, !!selectedRepo)

  // Combined loading state
  const loading = driftLoading && !driftData
  const error = driftError instanceof Error ? driftError.message : driftError ? String(driftError) : null
  const [isRefreshing, setIsRefreshing] = useState(false)

  // 24-hour refresh lock (per-repo) - team workspaces get unlimited refreshes
  const lockKey = owner && repo ? `drift_${owner}_${repo}_${branch}` : 'drift'
  const aiInsightsLockKey = owner && repo ? `ai-insights_${owner}_${repo}_${branch}` : 'ai-insights'
  const { isLocked, timeRemainingFormatted, lockRefresh } = useRefreshLock(lockKey, !!currentTeamId)
  
  // 24-hour lock for AI insights (per-repo) - team workspaces get unlimited refreshes
  const { isLocked: isAiInsightsLocked, timeRemainingFormatted: aiInsightsTimeRemaining, lockRefresh: lockAiInsights } = useRefreshLock(aiInsightsLockKey, !!currentTeamId)
  
  // Track if we should lock AI insights after successful fetch
  const shouldLockAiInsightsRef = useRef(false)

  // Watch for successful AI insights fetch and lock it
  useEffect(() => {
    if (shouldLockAiInsightsRef.current && aiInsightsEnabled && driftData?.ai_insights && !driftFetching && !driftError) {
      // Successfully fetched AI insights - lock it for 24 hours
      lockAiInsights()
      shouldLockAiInsightsRef.current = false
      console.log('✅ [AI Insights] Fetch completed, button locked for 24 hours')
    } else if (shouldLockAiInsightsRef.current && driftError && !driftFetching) {
      // Fetch failed - don't lock
      shouldLockAiInsightsRef.current = false
      console.error('❌ [AI Insights] Fetch failed, not locking:', driftError)
    }
  }, [aiInsightsEnabled, driftData, driftFetching, driftError, lockAiInsights])

  // Refetch all data function - clears cache and refetches
  const refetchAll = async () => {
    if (!selectedRepo || !owner || !repo || isRefreshing || isLocked) return
    
    console.log('🔄 [Drift] Refresh triggered - fetching fresh drift, security, and cost data from network...')
    setIsRefreshing(true)
    
    // Clear cache for all three queries (per-repo)
    queryClient.removeQueries({ 
      queryKey: ['drift', owner, repo, branch]
    })
    queryClient.removeQueries({ 
      queryKey: ['security', 'scan', owner, repo]
    })
    queryClient.removeQueries({ 
      queryKey: ['cost', 'estimate', owner, repo]
    })
    
    // Also clear localStorage cache (per-repo)
    const driftCacheKey = `infrara_drift_cache_${owner}_${repo}_${branch}_${aiInsightsEnabled ? 'enhanced' : 'basic'}`
    const securityCacheKey = `infrara_security_cache_${owner}_${repo}`
    const costCacheKey = `infrara_cost_cache_${owner}_${repo}`
    try {
      localStorage.removeItem(driftCacheKey)
      localStorage.removeItem(securityCacheKey)
      localStorage.removeItem(costCacheKey)
      console.log('🔄 [Drift] Cleared all caches for fresh fetch')
    } catch (e) {
      console.warn('⚠️ [Drift] Failed to clear localStorage cache:', e)
    }
    
    // Use fetchQuery directly to bypass all cache and force network requests
    // This ensures we get fresh data from the server, not cached data
    try {
      const [driftResult, securityResult, costResult] = await Promise.all([
        // Force fresh drift fetch
        queryClient.fetchQuery({
          queryKey: ['drift', owner, repo, branch, aiInsightsEnabled ? 'enhanced' : 'basic'],
          queryFn: async () => {
            // Use token from component scope (already defined at top)
            if (!owner || !repo || !token) {
              throw new Error('Missing required parameters')
            }

            console.log('🔍 [Drift] 🔄 Forced refresh - fetching from network (bypassing all cache)')

            const endpoint = aiInsightsEnabled ? 'enhanced' : ''
            const { getApiEndpoint } = await import('@/utils/apiEndpoint')
            const url = getApiEndpoint(`/drift/detect/${owner}/${repo}${endpoint ? '/' + endpoint : ''}?branch=${branch}`)
            const response = await fetch(url, {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            })

            if (!response.ok) {
              const error = await response.json().catch(() => ({}))
              throw new Error(error.detail || error.error || `Failed to fetch drift: ${response.status}`)
            }

            const result = await response.json()
            
            // Cache successful result
            const cacheKey = `infrara_drift_cache_${owner}_${repo}_${branch}_${aiInsightsEnabled ? 'enhanced' : 'basic'}`
            try {
              localStorage.setItem(cacheKey, JSON.stringify({
                data: result,
                timestamp: Date.now()
              }))
            } catch (e) {
              console.warn('⚠️ [Drift] Failed to cache to localStorage:', e)
            }
            
            return result
          },
          staleTime: 0, // Force fresh fetch
        }),
        // Force fresh security fetch
        queryClient.fetchQuery({
          queryKey: ['security', 'scan', owner, repo],
          queryFn: async () => {
            // Use token from component scope
            const { getApiEndpoint } = await import('@/utils/apiEndpoint')
            const response = await fetch(getApiEndpoint('/security/scan'), {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            })
            if (!response.ok) throw new Error(`Failed: ${response.status}`)
            const result = await response.json()
            
            // Cache successful result (per-repo)
            const cacheKey = `infrara_security_cache_${owner}_${repo}`
            try {
              localStorage.setItem(cacheKey, JSON.stringify({
                data: result,
                timestamp: Date.now()
              }))
            } catch (e) {
              console.warn('⚠️ [Security] Failed to cache to localStorage:', e)
            }
            
            return result
          },
          staleTime: 0,
        }),
        // Force fresh cost fetch
        queryClient.fetchQuery({
          queryKey: ['cost', 'estimate', owner, repo],
          queryFn: async () => {
            // Use token from component scope
            const { getApiEndpoint } = await import('@/utils/apiEndpoint')
            const response = await fetch(getApiEndpoint('/cost/estimate'), {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            })
            if (!response.ok) throw new Error(`Failed: ${response.status}`)
            const result = await response.json()
            
            // Cache successful result (per-repo)
            const cacheKey = `infrara_cost_cache_${owner}_${repo}`
            try {
              localStorage.setItem(cacheKey, JSON.stringify({
                data: result,
                timestamp: Date.now()
              }))
            } catch (e) {
              console.warn('⚠️ [Cost] Failed to cache to localStorage:', e)
            }
            
            return result
          },
          staleTime: 0,
        })
      ])
      
      // Only lock if all fetches succeeded and returned data
      if (driftResult && securityResult && costResult) {
        lockRefresh()
        setRefreshStatus('success')
        console.log('✅ [Drift] Refresh completed with fresh data, button locked for 24 hours')
        setTimeout(() => setRefreshStatus('idle'), 2000)
      } else {
        console.warn('⚠️ [Drift] Refresh completed but some data missing')
        setRefreshStatus('error')
        setTimeout(() => setRefreshStatus('idle'), 3000)
      }
    } catch (error) {
      console.error('❌ [Drift] Refresh failed:', error)
      setRefreshStatus('error')
      setTimeout(() => setRefreshStatus('idle'), 3000)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleDriftClick = (drift: { file: string; line?: number }) => {
    console.log('📍 [DriftDetection] handleDriftClick called:', { file: drift.file, line: drift.line, drift })
    if (onFileClick && drift.file) {
      onFileClick(drift.file, drift.line)
    }
  }

  // Handle AI insights toggle - lock after successful fetch
  const handleAiInsightsToggle = () => {
    if (isAiInsightsLocked) return // Don't allow toggle if locked
    
    const newValue = !aiInsightsEnabled
    
    if (newValue) {
      // Enabling AI insights - mark that we should lock after successful fetch
      shouldLockAiInsightsRef.current = true
      setAiInsightsEnabled(true)
      // The useDriftData hook will automatically refetch when aiInsightsEnabled changes
      // The useEffect will watch for successful completion and lock it
    } else {
      // Disabling AI insights - no lock needed
      shouldLockAiInsightsRef.current = false
      setAiInsightsEnabled(false)
    }
  }

  const filteredDrifts = driftData?.drifts.filter(drift => {
    if (filterType !== 'all' && drift.type !== filterType) return false
    if (filterSeverity !== 'all' && drift.severity !== filterSeverity) return false
    return true
  }) || []

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'text-[#F85149] bg-[#F85149]/10'
      case 'medium': return 'text-[#FFA657] bg-[#FFA657]/10'
      case 'low': return 'text-[#79C0FF] bg-[#79C0FF]/10'
      default: return 'text-[#888] bg-[#1F1F1F]'
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'added': return <CheckCircle size={14} className="text-[#79C0FF]" />
      case 'removed': return <AlertTriangle size={14} className="text-[#F85149]" />
      case 'modified': return <AlertCircle size={14} className="text-[#FFA657]" />
      default: return <FileCode size={14} className="text-[#888]" />
    }
  }

  if (!selectedRepo) {
    return (
      <div className="flex-1 w-full h-full flex items-center justify-center bg-[#181818]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-[#666] mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-[#EDEDED] mb-1">No Repository Selected</h2>
          <p className="text-[#888] text-sm">Select a repository to detect drift</p>
        </div>
      </div>
    )
  }

  if (loading || isRefreshing) {
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
            {isRefreshing ? 'Refreshing Drift Analysis' : 'Analyzing Terraform Code'}
          </h2>
          <p className="text-[#888] text-sm mb-2">
            {isRefreshing 
              ? 'Fetching the latest drift, security, and cost data...'
              : 'Scanning your infrastructure for drift, security issues, and cost estimates...'
            }
          </p>
          <p className="text-[#666] text-xs">
            This may take a few seconds
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
          `}} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#181818]">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-[#F85149] mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-[#EDEDED] mb-2">Drift Detection Error</h2>
          <p className="text-[#888] text-sm mb-4">{error}</p>
          <button
            onClick={refetchAll}
            disabled={isLocked}
            className="px-4 py-2 bg-[#007ACC] hover:bg-[#005A9E] text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
            title={isLocked ? `Refresh locked. Available in ${timeRemainingFormatted}` : undefined}
          >
            <RefreshCw size={14} />
            {isLocked ? (timeRemainingFormatted ? `Locked (${timeRemainingFormatted})` : 'Locked') : 'Retry'}
          </button>
        </div>
      </div>
    )
  }

  if (!driftData) {
    return null
  }

  return (
    <div 
      className="flex-1 flex flex-col overflow-hidden bg-[#181818] h-full"
      style={{ fontFamily: 'var(--font-sans)' }}
    >
      {/* Header */}
      <div className="border-b border-[#1a1a1a] px-6 py-4">
        {/* Tab Switcher */}
        <div className="flex gap-1 mb-4 bg-[#1F1F1F] p-1 rounded-lg inline-flex">
          <button
            onClick={() => setActiveView('insights')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeView === 'insights'
                ? 'bg-[#2a2a2a] text-white border border-[#3a3a3a]'
                : 'text-[#888] hover:text-[#EDEDED]'
            }`}
          >
            Infrastructure Insights
          </button>
          <button
            onClick={() => setActiveView('drift')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeView === 'drift'
                ? 'bg-[#2a2a2a] text-white border border-[#3a3a3a]'
                : 'text-[#888] hover:text-[#EDEDED]'
            }`}
          >
            Drift Detection
          </button>
          <button
            onClick={() => setActiveView('story')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeView === 'story'
                ? 'bg-[#2a2a2a] text-white border border-[#3a3a3a]'
                : 'text-[#888] hover:text-[#EDEDED]'
            }`}
          >
            Infrastructure Story
          </button>
        </div>
        
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold text-[#EDEDED]" style={{ fontWeight: 600 }}>
              {activeView === 'insights' ? 'Infrastructure Insights' : activeView === 'story' ? 'Infrastructure Story' : 'Drift Detection'}
            </h1>
            <p className="text-xs text-[#888] mt-0.5">
              {selectedRepo.name}
              {activeView === 'drift' && driftData && ` · Comparing ${driftData.branch} to ${driftData.compared_to}`}
              {activeView === 'insights' && driftData && ` · ${driftData.analysis_metadata?.total_resources_current || 0} resources tracked`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* AI Insights Toggle - show only for drift view */}
            {activeView === 'drift' && (
              <button
                onClick={handleAiInsightsToggle}
                disabled={isAiInsightsLocked || (aiInsightsEnabled && driftFetching)}
                className={`px-3 py-1.5 border rounded-md transition-colors text-xs font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  aiInsightsEnabled
                    ? 'bg-purple-500/20 border-purple-500/50 text-purple-300 hover:bg-purple-500/30'
                    : 'bg-[#1F1F1F] border-[#2a2a2a] text-[#888] hover:border-[#3a3a3a]'
                }`}
                title={
                  isAiInsightsLocked 
                    ? `AI insights locked. Available in ${aiInsightsTimeRemaining}` 
                    : aiInsightsEnabled 
                      ? 'AI insights enabled' 
                      : 'Enable AI insights'
                }
              >
                <Brain size={14} />
                {isAiInsightsLocked ? `AI Insights (${aiInsightsTimeRemaining})` : 'AI Insights'}
                {aiInsightsEnabled && driftFetching && (
                  <span className="ml-1">
                    <RefreshCw size={12} className="animate-spin" />
                  </span>
                )}
              </button>
            )}
            {/* Refresh button - show for all views */}
            <button
              onClick={refetchAll}
              disabled={!!isRefreshing || isLocked}
              className={`px-3 py-1.5 border rounded-md transition-colors text-xs font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                refreshStatus === 'success'
                  ? 'bg-green-500/20 border-green-500/50 text-green-400'
                  : refreshStatus === 'error'
                  ? 'bg-red-500/20 border-red-500/50 text-red-400'
                  : 'bg-[#1F1F1F] border-[#2a2a2a] text-[#EDEDED] hover:border-[#3a3a3a]'
              }`}
              title={isLocked ? `Refresh locked. Available in ${timeRemainingFormatted}` : undefined}
            >
              {refreshStatus === 'success' ? (
                <>
                  <CheckCircle size={14} />
                  Updated!
                </>
              ) : refreshStatus === 'error' ? (
                <>
                  <AlertCircle size={14} />
                  Failed
                </>
              ) : (
                <>
                  <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                  {isRefreshing ? 'Updating...' : isLocked ? (timeRemainingFormatted ? `Locked (${timeRemainingFormatted})` : 'Locked') : 'Refresh'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Drift Analysis View */}
      {activeView === 'drift' && (
        <div className="flex-1 flex flex-col overflow-hidden bg-[#181818]">
          {/* Sticky Stats and Filters */}
          <div className="sticky top-0 z-10 bg-[#181818] border-b border-[#1a1a1a] px-4 pt-4 pb-3">
            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="bg-gradient-to-br from-purple-900/20 to-purple-800/10 border border-purple-500/30 rounded-lg px-4 py-3 hover:border-purple-500/50 transition-all">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-purple-300 uppercase tracking-wide">Total</span>
                  <AlertCircle size={14} className="text-purple-400" />
                </div>
                <div className="text-2xl font-semibold text-[#EDEDED]">{driftData.total_changes}</div>
              </div>
              <div className="bg-gradient-to-br from-emerald-900/20 to-emerald-800/10 border border-emerald-500/30 rounded-lg px-4 py-3 hover:border-emerald-500/50 transition-all">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wide">Added</span>
                  <CheckCircle size={14} className="text-emerald-400" />
                </div>
                <div className="text-2xl font-semibold text-emerald-400">{driftData.added}</div>
              </div>
              <div className="bg-gradient-to-br from-red-900/20 to-red-800/10 border border-red-500/30 rounded-lg px-4 py-3 hover:border-red-500/50 transition-all">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-red-300 uppercase tracking-wide">Removed</span>
                  <AlertTriangle size={14} className="text-red-400" />
                </div>
                <div className="text-2xl font-semibold text-red-400">{driftData.removed}</div>
              </div>
              <div className="bg-gradient-to-br from-orange-900/20 to-orange-800/10 border border-orange-500/30 rounded-lg px-4 py-3 hover:border-orange-500/50 transition-all">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-orange-300 uppercase tracking-wide">Modified</span>
                  <AlertCircle size={14} className="text-orange-400" />
                </div>
                <div className="text-2xl font-semibold text-orange-400">{driftData.modified}</div>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterType('all')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                filterType === 'all'
                  ? 'bg-gradient-to-r from-purple-500 to-violet-500 text-white shadow-lg shadow-purple-500/30'
                  : 'bg-[#1F1F1F] text-[#888] hover:text-[#EDEDED] hover:bg-[#2a2a2a] border border-[#2a2a2a]'
              }`}
            >
              All ({driftData.drifts.length})
            </button>
            <button
              onClick={() => setFilterType('added')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                filterType === 'added'
                  ? 'bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-lg shadow-emerald-500/30'
                  : 'bg-[#1F1F1F] text-[#888] hover:text-[#EDEDED] hover:bg-[#2a2a2a] border border-[#2a2a2a]'
              }`}
            >
              Added ({driftData.added})
            </button>
            <button
              onClick={() => setFilterType('modified')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                filterType === 'modified'
                  ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/30'
                  : 'bg-[#1F1F1F] text-[#888] hover:text-[#EDEDED] hover:bg-[#2a2a2a] border border-[#2a2a2a]'
              }`}
            >
              Modified ({driftData.modified})
            </button>
            <button
              onClick={() => setFilterType('removed')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                filterType === 'removed'
                  ? 'bg-gradient-to-r from-red-500 to-rose-500 text-white shadow-lg shadow-red-500/30'
                  : 'bg-[#1F1F1F] text-[#888] hover:text-[#EDEDED] hover:bg-[#2a2a2a] border border-[#2a2a2a]'
              }`}
            >
              Removed ({driftData.removed})
            </button>
            <div className="w-px h-8 bg-[#2a2a2a]" />
            <button
              onClick={() => setFilterSeverity(filterSeverity === 'high' ? 'all' : 'high')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                filterSeverity === 'high'
                  ? 'bg-gradient-to-r from-red-600 to-red-500 text-white shadow-lg shadow-red-500/30'
                  : 'bg-[#1F1F1F] text-[#888] hover:text-[#EDEDED] hover:bg-[#2a2a2a] border border-[#2a2a2a]'
              }`}
            >
              High Severity
            </button>
          </div>
          </div>

          {/* Scrollable Content Area */}
          <div className="flex-1 overflow-y-auto px-4">
            {/* AI Insights Summary */}
            {aiInsightsEnabled && driftData.ai_insights && (
              <div className="mt-4 mb-4 p-6 bg-gradient-to-r from-gray-900/20 to-gray-800/20 rounded-lg border border-gray-500/30">
                <div className="flex items-start gap-4">
                  <Sparkles className="w-6 h-6 text-gray-400 mt-1 flex-shrink-0" />
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-300 mb-3">AI Analysis</h3>
                    <p className="text-gray-300 leading-relaxed mb-4">
                      {driftData.ai_insights.summary}
                    </p>
                    {driftData.ai_insights.recommendations && driftData.ai_insights.recommendations.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-gray-300 mb-2">Recommendations:</p>
                        {driftData.ai_insights.recommendations.map((rec: string, idx: number) => (
                          <div key={idx} className="flex items-start gap-2 text-sm text-gray-400">
                            <span className="text-yellow-400 mt-0.5">→</span>
                            <span>{rec}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Drift List */}
            <div className="pt-2 pb-6">
            {!driftData ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-[#333] border-t-[#EDEDED] rounded-full animate-spin" />
              </div>
            ) : driftData.drifts.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <CheckCircle className="w-12 h-12 text-[#3FB950] mx-auto mb-3" />
                  <h2 className="text-lg font-semibold text-[#EDEDED] mb-1">No Drift Detected</h2>
                  <p className="text-[#888] text-sm mb-6">Your Terraform code is in sync with the expected state</p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={refetchAll}
                      disabled={!!isRefreshing || isLocked}
                      className="px-4 py-2 bg-[#1F1F1F] border border-[#2a2a2a] text-[#EDEDED] rounded-lg text-sm font-medium hover:border-[#3a3a3a] transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={isLocked ? `Refresh locked. Available in ${timeRemainingFormatted}` : undefined}
                    >
                      <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                      {isRefreshing ? 'Updating...' : isLocked ? (timeRemainingFormatted ? `Locked (${timeRemainingFormatted})` : 'Locked') : 'Check Again'}
                    </button>
                    <button
                      onClick={() => setActiveView('insights')}
                      className="px-4 py-2 bg-[#2a2a2a] hover:bg-[#3a3a3a] text-[#EDEDED] rounded-lg text-sm font-medium transition-colors flex items-center gap-2 border border-[#3a3a3a]"
                    >
                      View Insights
                    </button>
                  </div>
                </div>
              </div>
            ) : filteredDrifts.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-[#888] text-sm">No drifts match your filters</p>
              </div>
            ) : (
              <div className="space-y-2 px-6">
                {filteredDrifts.map((drift, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleDriftClick(drift)}
                    className="p-4 bg-[#1F1F1F] border border-[#2a2a2a] rounded-lg hover:border-[#3a3a3a] transition-colors cursor-pointer"
                  >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{getTypeIcon(drift.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm text-[#EDEDED] font-medium truncate" style={{ fontWeight: 500 }}>
                        {drift.resource_name}
                      </h3>
                      <span className="text-xs px-2 py-0.5 rounded bg-[#1F1F1F] text-[#888] border border-[#2a2a2a]">
                        {drift.resource_type}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded ${getSeverityColor(drift.severity)}`}>
                        {drift.severity}
                      </span>
                    </div>
                    <p className="text-xs text-[#888] mb-2">{drift.description}</p>
                    {drift.old_value && drift.new_value && (
                      <div className="text-xs font-mono space-y-1 mb-3">
                        <div className="text-[#F85149]">- {drift.old_value}</div>
                        <div className="text-[#3FB950]">+ {drift.new_value}</div>
                      </div>
                    )}

                    {/* AI Explanation */}
                    {aiInsightsEnabled && drift.ai_explanation && (
                      <div className="mt-3 p-3 bg-blue-900/10 rounded-lg border-l-2 border-blue-500">
                        <div className="flex items-start gap-2">
                          <Sparkles className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="text-sm text-gray-300 leading-relaxed">{drift.ai_explanation.text}</p>
                            
                            {/* Risk level badge */}
                            <div className="mt-2 flex items-center gap-2">
                              <span className={`text-xs px-2 py-1 rounded ${
                                drift.ai_explanation.risk_level === 'high' ? 'bg-red-500/20 text-red-400' :
                                drift.ai_explanation.risk_level === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                'bg-green-500/20 text-green-400'
                              }`}>
                                {drift.ai_explanation.risk_level} risk
                              </span>
                              <span className="text-xs text-gray-500">
                                {Math.round(drift.ai_explanation.confidence * 100)}% confident
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Affected Resources */}
                    {aiInsightsEnabled && drift.affected_resources && drift.affected_resources.length > 0 && (
                      <div className="mt-3 p-3 bg-orange-900/10 rounded-lg border-l-2 border-orange-500">
                        <h4 className="text-xs font-semibold text-orange-400 mb-2 flex items-center gap-1">
                          <AlertCircle size={12} />
                          Affects {drift.affected_resources.length} resource(s):
                        </h4>
                        <div className="space-y-1">
                          {drift.affected_resources.map((affected, idx) => (
                            <div key={idx} className="text-xs text-gray-400 flex items-center gap-2">
                              <span className="text-orange-400">→</span>
                              <code className="bg-gray-900/50 px-1.5 py-0.5 rounded">
                                {affected.type}.{affected.name}
                              </code>
                              <span className="text-gray-600 text-[10px]">in {affected.file}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Git Context */}
                    {aiInsightsEnabled && drift.git_context && drift.git_context.last_message && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                        <GitCommit size={12} />
                        <span>
                          Last changed by <span className="text-gray-500">{drift.git_context.last_author}</span>: 
                          "<span className="text-gray-500 italic">{drift.git_context.last_message}</span>"
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDriftClick(drift)
                    }}
                    className="flex items-center gap-1 text-xs text-[#666] hover:text-[#EDEDED] transition-colors cursor-pointer"
                    title="Click to view in editor"
                  >
                    <FileCode size={12} />
                    <span className="font-mono">{drift.file}</span>
                    {drift.line && <span>:{drift.line}</span>}
                  </button>
                </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>

          {/* Footer */}
          {filteredDrifts.length > 0 && (
            <div className="border-t border-[#1a1a1a] px-6 py-2.5">
              <p className="text-xs text-[#666]">
                Showing {filteredDrifts.length} of {driftData.drifts.length} drifts
              </p>
            </div>
          )}
        </div>
      )}

      {/* Infrastructure Insights View */}
      {activeView === 'insights' && (
        <PremiumInsights 
          driftData={driftData}
          securityData={securityData}
          costData={costData}
          dashboardData={dashboardData}
          onFileClick={onFileClick}
          onViewChange={setActiveView}
        />
      )}

      {/* Infrastructure Story View */}
      {activeView === 'story' && selectedRepo && (
        <InfrastructureStory selectedRepo={selectedRepo} currentTeamId={currentTeamId} />
      )}
    </div>
  )
}
