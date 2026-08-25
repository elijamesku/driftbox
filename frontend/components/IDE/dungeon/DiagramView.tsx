'use client'

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, RefreshCw, Palette, CheckCircle } from 'lucide-react'
import { useDiagramData } from '@/hooks/useInfrastructureData'
import { useRefreshLock } from '@/hooks/useRefreshLock'
import { useAuth } from '@/contexts'
import AWSDiagram from './AWSDiagram'

interface DiagramViewProps {
  selectedRepo?: {
    id: number
    name: string
    full_name: string
    default_branch?: string
  } | null
  onFileClick?: (filePath: string, line?: number) => void
  currentTeamId?: string | null
}

interface DiagramData {
  ok: boolean
  repo: string
  nodes: Array<{
    id: string
    type: string
    label: string
    icon: string
    file: string
    line?: number
    category: string
  }>
  edges: Array<{
    source: string
    target: string
    relationship: string
  }>
  explanation: string
}

// Color mapping for different resource categories
const getCategoryColor = (category: string): string => {
  const colorMap: Record<string, string> = {
    'Storage': '#3b82f6',      // Blue
    'Compute': '#10b981',      // Green
    'Network': '#f59e0b',      // Amber
    'Database': '#8b5cf6',     // Purple
    'IAM': '#ef4444',          // Red
    'Security': '#ec4899',     // Pink
    'Monitoring': '#06b6d4',   // Cyan
    'Other': '#6366f1',        // Indigo
  }
  return colorMap[category] || '#6366f1'
}


export default function DiagramView({ selectedRepo, onFileClick, currentTeamId }: DiagramViewProps) {
  const diagramRef = useRef<HTMLDivElement>(null)
  const explanationRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const { token } = useAuth()
  const [isDarkBackground, setIsDarkBackground] = useState(true) // Default to dark
  const [refreshStatus, setRefreshStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [owner, repo] = selectedRepo?.full_name.split('/') || [null, null]
  const branch = selectedRepo?.default_branch || 'main'

  const { data: diagramData, isLoading: loading, error, refetch: refetchDiagram } = useDiagramData(
    owner,
    repo,
    branch,
    !!selectedRepo
  )

  const errorMessage = error instanceof Error ? error.message : error ? String(error) : null

  // 24-hour refresh lock (per-repo) - team workspaces get unlimited refreshes
  const lockKey = owner && repo ? `diagram_${owner}_${repo}_${branch}` : 'diagram'
  const { isLocked, timeRemainingFormatted, lockRefresh } = useRefreshLock(lockKey, !!currentTeamId)

  const handleRefresh = async () => {
    if (!selectedRepo || !owner || !repo || isRefreshing || isLocked || !token) return
    
    console.log('🔄 [Diagram] Refresh triggered - fetching fresh diagram data...')
    setIsRefreshing(true)
    
    // Clear both TanStack Query cache and localStorage cache
    queryClient.removeQueries({ 
      queryKey: ['diagram', owner, repo, branch]
    })
    const cacheKey = `infrara_diagram_cache_${owner}_${repo}_${branch}`
    try {
      localStorage.removeItem(cacheKey)
      console.log('🔄 [Diagram] Cleared cache for fresh fetch')
    } catch (e) {
      console.warn('⚠️ [Diagram] Failed to clear localStorage cache:', e)
    }
    
    // Invalidate the query to mark it as stale, then force a fresh fetch
    // This ensures we bypass any cached data and get fresh data from the network
    try {
      await queryClient.invalidateQueries({
        queryKey: ['diagram', owner, repo, branch]
      })
      
      // Force a fresh fetch by using fetchQuery with a custom queryFn that bypasses cache
      const result = await queryClient.fetchQuery({
        queryKey: ['diagram', owner, repo, branch],
        queryFn: async () => {
          // Direct fetch without checking cache - this ensures fresh data
          const { getApiEndpoint } = await import('@/utils/apiEndpoint')
          const response = await fetch(getApiEndpoint(`/diagram/generate/${owner}/${repo}?branch=${branch}`), {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          })
          
          if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            throw new Error(error.detail || error.error || `Failed to generate diagram: ${response.status}`)
          }
          
          const data = await response.json()
          
          // Cache the new data to localStorage
          try {
            localStorage.setItem(cacheKey, JSON.stringify({
              data: data,
              timestamp: Date.now()
            }))
          } catch (e) {
            console.warn('⚠️ [Diagram] Failed to cache to localStorage:', e)
          }
          
          return data
        },
        staleTime: 0, // Force fresh fetch - don't use stale data
      })
      
      // Lock the refresh button for 24 hours after successful fetch
      lockRefresh()
      setRefreshStatus('success')
      console.log('✅ [Diagram] Refresh completed, button locked for 24 hours')
      setTimeout(() => setRefreshStatus('idle'), 2000)
    } catch (error) {
      console.error('❌ [Diagram] Refresh failed:', error)
      setRefreshStatus('error')
      setTimeout(() => setRefreshStatus('idle'), 3000)
    } finally {
      setIsRefreshing(false)
    }
  }

  const toggleBackground = () => {
    setIsDarkBackground(!isDarkBackground)
  }
  

  if (!selectedRepo) {
    return (
      <div className="flex-1 w-full h-full flex items-center justify-center bg-[#181818]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-[#666] mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-[#EDEDED] mb-1">No Repository Selected</h2>
          <p className="text-[#888] text-sm">Select a repository to view architecture diagram</p>
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
            {isRefreshing ? 'Refreshing Architecture Diagram' : 'Generating Architecture Diagram'}
          </h2>
          <p className="text-[#888] text-sm mb-2">
            {isRefreshing 
              ? 'Fetching the latest diagram from the server...'
              : 'Analyzing your infrastructure and creating a visual representation...'
            }
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
          `}} />
        </div>
      </div>
    )
  }

  if (errorMessage) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#181818]">
        <div className="text-center max-w-md">
          <div className="mb-6 breathing-logo">
            <img 
              src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg" 
              alt="Logo" 
              width={120} 
              height={120}
              className="grayscale opacity-20 mx-auto"
            />
          </div>
          <h2 className="text-lg font-semibold text-[#EDEDED] mb-2">Architecture Diagram Error</h2>
          <p className="text-[#888] text-sm mb-4">{errorMessage}</p>
        </div>
      </div>
    )
  }

  if (!diagramData) {
    return null
  }

  return (
    <div 
      className="flex-1 flex flex-col overflow-hidden bg-[#181818] h-full"
      style={{ fontFamily: 'var(--font-sans)' }}
    >
      {/* Header */}
      <div className="flex-shrink-0 border-b border-[#1a1a1a] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-[#EDEDED] flex items-center gap-2" style={{ fontWeight: 600 }}>
              Architecture Diagram
              {isRefreshing && (
                <span className="flex items-center gap-1.5 text-[10px] text-[#A78BFA] font-normal">
                  <RefreshCw size={12} className="animate-spin" />
                  <span>Updating...</span>
                </span>
              )}
            </h1>
            <p className="text-xs text-[#888] mt-0.5">
              {selectedRepo.name} · {diagramData.nodes.length} resources
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || isLocked}
              className={`flex items-center gap-2 px-3 py-2 border rounded-md transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
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
                  <CheckCircle size={16} />
                  <span>Updated!</span>
                </>
              ) : refreshStatus === 'error' ? (
                <>
                  <AlertCircle size={16} />
                  <span>Failed</span>
                </>
              ) : isRefreshing ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Updating...</span>
                </>
              ) : isLocked ? (
                <>
                  <RefreshCw size={16} />
                  <span>{timeRemainingFormatted ? `Locked (${timeRemainingFormatted})` : 'Locked'}</span>
                </>
              ) : (
                <>
                  <RefreshCw size={16} />
                  <span>Refresh</span>
                </>
              )}
            </button>
            <button
              onClick={toggleBackground}
              className="flex items-center gap-2 px-3 py-2 bg-[#EDEDED] text-[#0A0A0A] rounded-md hover:bg-white transition-colors text-sm font-medium"
            >
              <Palette size={16} />
              Switch Background
            </button>
          </div>
        </div>
      </div>

      {/* Diagram Area - Scrollable */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        <div className="p-6">
          {/* AWS Architecture Diagram */}
          <div 
            ref={diagramRef}
            className={`border border-[#2a2a2a] rounded-lg mb-6 overflow-hidden transition-colors duration-300 ${
              isDarkBackground ? 'bg-[#1a1a1a]' : 'bg-[#1F1F1F]'
            }`}
            style={{ minHeight: '600px', height: '600px' }}
          >
            {diagramData && (
              <AWSDiagram
                data={diagramData}
                isDarkBackground={isDarkBackground}
                onNodeClick={(nodeId, file, line) => {
                  if (onFileClick) {
                    onFileClick(file, line)
                  }
                }}
              />
            )}
          </div>

          {/* Architecture Explanation */}
          <div 
            ref={explanationRef}
            className="bg-[#1F1F1F] border border-[#2a2a2a] rounded-lg p-6"
          >
            <h2 className="text-base font-semibold text-[#EDEDED] mb-3" style={{ fontWeight: 600 }}>
              Architecture Explanation
            </h2>
            <div 
              className="text-sm text-[#EDEDED] leading-relaxed whitespace-pre-wrap"
              dangerouslySetInnerHTML={{
                __html: diagramData.explanation
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Convert **bold** to <strong>
                  .replace(/\n/g, '<br>') // Preserve line breaks
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

