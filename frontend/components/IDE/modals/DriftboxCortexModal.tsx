'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCortexInsights } from '@/hooks/useInfrastructureData'
import { useRefreshLock } from '@/hooks/useRefreshLock'
import { useAuth } from '@/contexts'
import { getApiEndpoint } from '@/utils/apiEndpoint'

interface DriftboxCortexModalProps {
  isOpen: boolean
  onClose: () => void
  selectedRepo: { full_name: string; name: string; default_branch?: string } | null
  currentTeamId?: string | null
}

export default function DriftboxCortexModal({ isOpen, onClose, selectedRepo, currentTeamId }: DriftboxCortexModalProps) {
  const queryClient = useQueryClient()
  const { token } = useAuth()
  const [refreshStatus, setRefreshStatus] = useState<'idle' | 'success' | 'error'>('idle')
  
  const [owner, repo] = selectedRepo?.full_name.split('/') || [null, null]
  const branch = selectedRepo?.default_branch || 'main'
  
  // Use TanStack Query hook for consistent caching and refresh behavior
  const { 
    data: insights, 
    isLoading, 
    error: queryError, 
    isFetching,
    refetch: refetchInsights 
  } = useCortexInsights(
    owner,
    repo,
    branch,
    isOpen && !!selectedRepo // Only fetch when modal is open
  )

  const error = queryError instanceof Error ? queryError.message : queryError ? String(queryError) : null
  const [isRefreshing, setIsRefreshing] = useState(false)

  // 24-hour refresh lock (per-repo) - team workspaces get unlimited refreshes
  const lockKey = owner && repo ? `cortex-insights_${owner}_${repo}_${branch}` : 'cortex-insights'
  const { isLocked, timeRemainingFormatted, lockRefresh } = useRefreshLock(lockKey, !!currentTeamId)

  const handleRefresh = async () => {
    if (!selectedRepo || !owner || !repo || isRefreshing || isLocked) return
    
    console.log('🔄 [Driftbox Cortex] Refresh triggered - fetching fresh insights from network...')
    setIsRefreshing(true)
    
    // Clear both TanStack Query cache and localStorage cache
    queryClient.removeQueries({ 
      queryKey: ['cortex', 'insights', owner, repo, branch]
    })
    
    // Also clear localStorage cache
    const cacheKey = `driftbox_cortex_${owner}_${repo}_${branch}`
    try {
      localStorage.removeItem(cacheKey)
      console.log('🔄 [Driftbox Cortex] Cleared cache for fresh fetch')
    } catch (e) {
      console.warn('⚠️ [Driftbox Cortex] Failed to clear localStorage cache:', e)
    }
    
    // Use fetchQuery directly to bypass all cache and force network request
    // This ensures we get fresh data from the server, not cached data
    try {
      const freshData = await queryClient.fetchQuery({
        queryKey: ['cortex', 'insights', owner, repo, branch],
        queryFn: async () => {
          if (!owner || !repo || !token) {
            throw new Error('Missing required parameters')
          }

          console.log('🧠 [Cortex] 🔄 Forced refresh - fetching from network (bypassing all cache)')

          const response = await fetch(getApiEndpoint(`/cortex/insights/${owner}/${repo}?branch=${encodeURIComponent(branch)}`), {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          })

          if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            throw new Error(error.detail || error.error || `Failed to fetch Cortex insights: ${response.status}`)
          }

          const result = await response.json()
          
          // Cache successful result to localStorage
          try {
            const cacheKey = `driftbox_cortex_${owner}_${repo}_${branch}`
            localStorage.setItem(cacheKey, JSON.stringify({
              data: result,
              timestamp: Date.now()
            }))
            console.log('🧠 [Cortex] 💾 Cached insights to localStorage')
          } catch (e) {
            console.warn('⚠️ [Cortex] Failed to cache to localStorage:', e)
          }
          
          return result
        },
        staleTime: 0, // Force fresh fetch
      })
      
      // Lock only after successful fetch
      if (freshData) {
        lockRefresh()
        setRefreshStatus('success')
        console.log('✅ [Driftbox Cortex] Refresh completed with fresh data, button locked for 24 hours')
        setTimeout(() => setRefreshStatus('idle'), 2000)
      }
    } catch (error: any) {
      console.error('❌ [Driftbox Cortex] Refresh failed:', error)
      setRefreshStatus('error')
      setTimeout(() => setRefreshStatus('idle'), 3000)
    } finally {
      setIsRefreshing(false)
    }
  }

  if (!isOpen) return null

  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Neural Network Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md animate-fadeIn" />
      
      {/* Animated Neural Grid Background */}
      <div className="absolute inset-0 opacity-20">
        <div className="neural-grid"></div>
      </div>
      
      {/* Modal */}
      <div 
        className="relative w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-xl shadow-2xl animate-slideUp"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a0a2e 50%, #0a0a0a 100%)',
          border: '1px solid rgba(147, 51, 234, 0.3)',
          boxShadow: '0 0 40px rgba(147, 51, 234, 0.3), inset 0 0 60px rgba(147, 51, 234, 0.05)'
        }}
      >
        <style jsx>{`
          .neural-grid {
            background-image: 
              linear-gradient(rgba(147, 51, 234, 0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(147, 51, 234, 0.1) 1px, transparent 1px);
            background-size: 50px 50px;
            animation: gridMove 20s linear infinite;
            width: 100%;
            height: 100%;
          }
          
          @keyframes gridMove {
            0% { transform: translate(0, 0); }
            100% { transform: translate(50px, 50px); }
          }
          
          .neural-pulse {
            animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          }
          
          @keyframes pulse {
            0%, 100% {
              opacity: 1;
              transform: scale(1);
            }
            50% {
              opacity: 0.7;
              transform: scale(1.05);
            }
          }
          
          .data-stream {
            animation: dataFlow 3s ease-in-out infinite;
          }
          
          @keyframes dataFlow {
            0%, 100% {
              opacity: 0.3;
              transform: translateY(0);
            }
            50% {
              opacity: 1;
              transform: translateY(-5px);
            }
          }
          
          .glow-text {
            text-shadow: 0 0 10px rgba(147, 51, 234, 0.8),
                         0 0 20px rgba(147, 51, 234, 0.4),
                         0 0 30px rgba(147, 51, 234, 0.2);
          }
          
          .cyber-border {
            position: relative;
            overflow: hidden;
          }
          
          .cyber-border::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 2px;
            background: linear-gradient(90deg, transparent, rgba(147, 51, 234, 0.8), transparent);
            animation: borderScan 3s linear infinite;
          }
          
          @keyframes borderScan {
            0% { left: -100%; }
            100% { left: 100%; }
          }
          
          .custom-scrollbar::-webkit-scrollbar {
            width: 8px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: rgba(10, 10, 10, 0.5);
            border-radius: 4px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: linear-gradient(180deg, rgba(147, 51, 234, 0.6), rgba(59, 130, 246, 0.6));
            border-radius: 4px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(180deg, rgba(147, 51, 234, 0.8), rgba(59, 130, 246, 0.8));
          }
          
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          
          @keyframes slideUp {
            from { 
              opacity: 0;
              transform: translateY(20px) scale(0.95);
            }
            to { 
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          
          .animate-fadeIn {
            animation: fadeIn 0.2s ease-out;
          }
          
          .animate-slideUp {
            animation: slideUp 0.3s ease-out;
          }
          
          .neuron-node {
            position: relative;
          }
          
          .neuron-node::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            border: 2px solid rgba(147, 51, 234, 0.3);
            transform: translate(-50%, -50%);
            animation: neuronPulse 2s ease-out infinite;
          }
          
          @keyframes neuronPulse {
            0% {
              transform: translate(-50%, -50%) scale(1);
              opacity: 1;
            }
            100% {
              transform: translate(-50%, -50%) scale(1.8);
              opacity: 0;
            }
          }
        `}</style>
        {/* Header - Neural Brain Interface */}
        <div className="cyber-border flex items-center justify-between p-5 border-b border-purple-500/30 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-purple-900/20 via-blue-900/20 to-purple-900/20"></div>
          <div className="relative flex items-center gap-4">
            <div className="neuron-node w-12 h-12 rounded-full bg-gradient-to-br from-purple-600 via-purple-500 to-blue-500 flex items-center justify-center shadow-lg neural-pulse">
              <span className="text-white text-2xl font-bold glow-text">D</span>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white glow-text flex items-center gap-2">
                DRIFTBOX CORTEX
                <span className="inline-flex h-2 w-2 rounded-full bg-purple-500 data-stream"></span>
              </h2>
              <p className="text-xs text-purple-300/80 font-mono mt-1">
                {selectedRepo ? `// ANALYZING: ${selectedRepo.name.toUpperCase()}` : '// AWAITING TARGET SELECTION'}
              </p>
            </div>
          </div>
          <div className="relative flex items-center gap-2">
            {insights && (
              <button
                onClick={handleRefresh}
                disabled={isRefreshing || isLocked}
                className={`px-3 py-2.5 rounded-lg border transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg flex items-center gap-2 ${
                  refreshStatus === 'success'
                    ? 'border-green-500/50 bg-green-500/20 text-green-300'
                    : refreshStatus === 'error'
                    ? 'border-red-500/50 bg-red-500/20 text-red-300'
                    : 'border-purple-500/30 hover:border-purple-500/60 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 hover:text-purple-200'
                }`}
                title={isLocked ? `Refresh locked. Available in ${timeRemainingFormatted}` : 'Refresh neural scan'}
              >
                {refreshStatus === 'success' ? (
                  <>
                    <i className="codicon codicon-check" style={{ fontSize: 18 }} />
                    <span className="text-xs font-mono">Updated!</span>
                  </>
                ) : refreshStatus === 'error' ? (
                  <>
                    <i className="codicon codicon-error" style={{ fontSize: 18 }} />
                    <span className="text-xs font-mono">Failed</span>
                  </>
                ) : (
                  <>
                    <i 
                      className={`codicon ${isLocked ? 'codicon-lock' : 'codicon-refresh'} ${isRefreshing ? 'animate-spin' : ''}`} 
                      style={{ fontSize: 18 }} 
                    />
                    {isLocked && timeRemainingFormatted && (
                      <span className="text-xs font-mono">{timeRemainingFormatted}</span>
                    )}
                  </>
                )}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2.5 rounded-lg border border-purple-500/30 hover:border-red-500/60 bg-purple-500/10 hover:bg-red-500/20 text-purple-300 hover:text-red-300 transition-all shadow-lg"
            >
              <i className="codicon codicon-close" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(85vh-88px)] p-6 custom-scrollbar">
          {!selectedRepo ? (
            <div className="text-center py-16">
              <div className="neuron-node w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-purple-600/20 to-blue-600/20 flex items-center justify-center border-2 border-purple-500/30">
                <i className="codicon codicon-search text-5xl text-purple-400/50" />
              </div>
              <p className="text-purple-300/60 font-mono text-sm">// SELECT REPOSITORY TO INITIATE NEURAL SCAN</p>
            </div>
          ) : isLoading ? (
            <div className="text-center py-16">
              <div className="relative w-24 h-24 mx-auto mb-6">
                <div className="absolute inset-0 rounded-full border-4 border-purple-500/20"></div>
                <div className="absolute inset-0 rounded-full border-4 border-t-purple-500 border-r-blue-500 border-b-transparent border-l-transparent animate-spin"></div>
                <div className="absolute inset-2 rounded-full border-4 border-b-purple-500 border-l-blue-500 border-t-transparent border-r-transparent animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 neural-pulse"></div>
                </div>
              </div>
              <p className="text-purple-300 font-mono text-sm mb-2 glow-text">NEURAL SCAN IN PROGRESS</p>
              <p className="text-purple-400/60 text-xs font-mono">// ACQUIRING INFRASTRUCTURE DATA...</p>
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center border-2 border-red-500/30">
                <i className="codicon codicon-error text-5xl text-red-400" />
              </div>
              <p className="text-red-400 font-mono text-sm">// ERROR: {error}</p>
            </div>
          ) : insights?.noTerraform ? (
            <div className="py-16 px-8">
              <div className="text-center mb-8">
                <div className="relative w-32 h-32 mx-auto mb-6">
                  <div className="absolute inset-0 rounded-full border-4 border-orange-500/20"></div>
                  <div className="absolute inset-0 rounded-full border-4 border-t-orange-500 border-r-yellow-500 border-b-transparent border-l-transparent animate-spin" style={{ animationDuration: '3s' }}></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <i className="codicon codicon-file-code text-5xl text-orange-400/80" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-orange-300 mb-3 glow-text font-mono">{insights.message}</h3>
                <p className="text-orange-400/70 text-sm font-mono leading-relaxed max-w-2xl mx-auto">
                  {insights.suggestion}
                </p>
              </div>
              
              <div className="cyber-border rounded-xl p-6 border border-orange-500/30 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.05) 0%, rgba(234, 179, 8, 0.05) 100%)' }}>
                <div className="absolute top-0 right-0 w-40 h-40 bg-orange-500/10 rounded-full blur-3xl"></div>
                <h4 className="text-sm font-bold text-orange-300 mb-4 flex items-center gap-2 glow-text relative z-10">
                  <i className="codicon codicon-info" />
                  SCAN DIAGNOSTICS
                </h4>
                <div className="space-y-3 relative z-10 font-mono text-xs">
                  <div className="flex items-center gap-3 text-gray-300">
                    <i className="codicon codicon-circle-outline text-orange-400" />
                    <span>Terraform Files Detected: <span className="text-orange-400 font-bold">0</span></span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-300">
                    <i className="codicon codicon-circle-outline text-orange-400" />
                    <span>Infrastructure Resources: <span className="text-orange-400 font-bold">NONE</span></span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-300">
                    <i className="codicon codicon-circle-outline text-orange-400" />
                    <span>Scan Status: <span className="text-green-400 font-bold">COMPLETE</span></span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-300">
                    <i className="codicon codicon-circle-outline text-orange-400" />
                    <span>Last Scanned: <span className="text-white font-bold">{insights.repoStats?.lastScanned || 'N/A'}</span></span>
                  </div>
                </div>
              </div>
              
              <div className="mt-6 text-center">
                <p className="text-xs text-purple-500/50 font-mono">// TIP: Driftbox Cortex analyzes Terraform (.tf) infrastructure patterns</p>
              </div>
            </div>
          ) : insights ? (
            <div className="space-y-5">
              {/* Repo Stats - Neural Data */}
              <div className="cyber-border rounded-xl p-5 border border-purple-500/30 shadow-lg hover:shadow-purple-500/20 transition-all relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(147, 51, 234, 0.05) 0%, rgba(59, 130, 246, 0.05) 100%)' }}>
                <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full blur-3xl"></div>
                <h3 className="text-sm font-bold text-purple-300 mb-4 flex items-center gap-2 glow-text relative z-10">
                  <i className="codicon codicon-dashboard" />
                  NEURAL REPOSITORY SCAN
                </h3>
                <div className="grid grid-cols-3 gap-4 relative z-10">
                  <div className="bg-black/40 rounded-lg p-4 border border-purple-500/20 hover:border-purple-500/40 transition-all backdrop-blur-sm">
                    <div className="text-purple-400/70 text-xs mb-2 font-mono">TERRAFORM FILES</div>
                    <div className="text-3xl font-bold text-white glow-text">{insights.repoStats.tfFileCount}</div>
                    <div className="mt-2 h-1 bg-purple-500/20 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 data-stream" style={{ width: '100%' }}></div>
                    </div>
                  </div>
                  <div className="bg-black/40 rounded-lg p-4 border border-blue-500/20 hover:border-blue-500/40 transition-all backdrop-blur-sm">
                    <div className="text-blue-400/70 text-xs mb-2 font-mono">CODE LINES</div>
                    <div className="text-3xl font-bold text-white glow-text">{insights.repoStats.totalLines.toLocaleString()}</div>
                    <div className="mt-2 h-1 bg-blue-500/20 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 data-stream" style={{ width: '100%', animationDelay: '0.5s' }}></div>
                    </div>
                  </div>
                  <div className="bg-black/40 rounded-lg p-4 border border-cyan-500/20 hover:border-cyan-500/40 transition-all backdrop-blur-sm">
                    <div className="text-cyan-400/70 text-xs mb-2 font-mono">LAST SCAN</div>
                    <div className="text-sm font-bold text-white glow-text mt-2">{insights.repoStats.lastScanned}</div>
                    <div className="mt-2 flex items-center gap-1">
                      <span className="inline-flex h-2 w-2 rounded-full bg-green-500 data-stream"></span>
                      <span className="text-xs text-green-400 font-mono">ACTIVE</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Scanned Resources - Neural Map */}
              <div className="cyber-border rounded-xl p-5 border border-green-500/30 shadow-lg hover:shadow-green-500/20 transition-all relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.05) 0%, rgba(59, 130, 246, 0.05) 100%)' }}>
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-green-500/5 rounded-full blur-3xl"></div>
                <div className="flex items-center justify-between mb-4 relative z-10">
                  <h3 className="text-sm font-bold text-green-300 flex items-center gap-2 glow-text">
                    <i className="codicon codicon-symbol-class" />
                    RESOURCE DETECTION MAP
                  </h3>
                  <span className="text-xs font-bold text-green-400 bg-black/40 px-3 py-1.5 rounded-full border border-green-500/30 backdrop-blur-sm">
                    <i className="codicon codicon-database" style={{ fontSize: 10 }} /> {insights.scannedResources.total} NODES
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto custom-scrollbar relative z-10">
                  {Object.entries(insights.scannedResources.byType).map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between bg-black/40 rounded-lg px-3 py-2.5 text-xs border border-green-500/20 hover:border-green-500/40 transition-all backdrop-blur-sm group">
                      <span className="text-gray-300 font-mono text-[11px]">{type}</span>
                      <span className="text-white font-bold bg-green-500/20 group-hover:bg-green-500/30 px-2.5 py-1 rounded border border-green-500/30">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detected Patterns - Neural Intelligence */}
              {insights.detectedPatterns.length > 0 && (
                <div className="cyber-border rounded-xl p-5 border border-yellow-500/30 shadow-lg hover:shadow-yellow-500/20 transition-all relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.05) 0%, rgba(249, 115, 22, 0.05) 100%)' }}>
                  <div className="absolute top-0 left-1/2 w-40 h-40 bg-yellow-500/5 rounded-full blur-3xl -translate-x-1/2"></div>
                  <h3 className="text-sm font-bold text-yellow-300 mb-4 flex items-center gap-2 glow-text relative z-10">
                    <i className="codicon codicon-lightbulb" />
                    PATTERN RECOGNITION
                    <span className="text-xs font-bold text-yellow-400 bg-black/40 px-3 py-1.5 rounded-full border border-yellow-500/30 ml-auto backdrop-blur-sm">
                      {insights.detectedPatterns.length} PATTERNS
                    </span>
                  </h3>
                  <div className="space-y-2 relative z-10">
                    {insights.detectedPatterns.map((pattern, idx) => (
                      <div key={idx} className="flex items-start gap-3 text-sm text-gray-100 bg-black/40 rounded-lg p-3 border border-yellow-500/20 hover:border-yellow-500/40 transition-all backdrop-blur-sm group">
                        <div className="neuron-node w-5 h-5 mt-0.5 flex-shrink-0 rounded-full bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center">
                          <i className="codicon codicon-check text-black" style={{ fontSize: 10 }} />
                        </div>
                        <span className="leading-relaxed font-mono text-xs">{pattern}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Common Dependencies - Neural Links */}
              {insights.dependencies.common.length > 0 && (
                <div className="cyber-border rounded-xl p-5 border border-cyan-500/30 shadow-lg hover:shadow-cyan-500/20 transition-all relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.05) 0%, rgba(147, 51, 234, 0.05) 100%)' }}>
                  <div className="absolute bottom-0 right-0 w-40 h-40 bg-cyan-500/5 rounded-full blur-3xl"></div>
                  <h3 className="text-sm font-bold text-cyan-300 mb-4 flex items-center gap-2 glow-text relative z-10">
                    <i className="codicon codicon-symbol-method" />
                    DEPENDENCY NETWORK
                    <span className="text-xs font-bold text-cyan-400 bg-black/40 px-3 py-1.5 rounded-full border border-cyan-500/30 ml-auto backdrop-blur-sm">
                      {insights.dependencies.total} CONNECTIONS
                    </span>
                  </h3>
                  <div className="flex flex-wrap gap-2 relative z-10">
                    {insights.dependencies.common.map((dep, idx) => (
                      <span 
                        key={idx}
                        className="px-4 py-2 bg-black/40 border border-cyan-500/30 hover:border-cyan-500/60 rounded-lg text-xs text-cyan-300 font-mono hover:bg-cyan-500/10 transition-all backdrop-blur-sm cursor-pointer"
                      >
                        <i className="codicon codicon-circle-filled text-cyan-500 data-stream" style={{ fontSize: 8 }} /> {dep}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations - AI Suggestions */}
              {insights.recommendations.length > 0 && (
                <div className="cyber-border rounded-xl p-5 border border-purple-500/40 shadow-lg hover:shadow-purple-500/30 transition-all relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(147, 51, 234, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%)' }}>
                  <div className="absolute top-0 right-0 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl"></div>
                  <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl"></div>
                  <h3 className="text-sm font-bold text-purple-300 mb-4 flex items-center gap-2 glow-text relative z-10">
                    <i className="codicon codicon-star-full text-yellow-400 neural-pulse" />
                    AI OPTIMIZATION SUGGESTIONS
                    <span className="text-xs font-bold text-purple-400 bg-black/40 px-3 py-1.5 rounded-full border border-purple-500/30 ml-auto backdrop-blur-sm">
                      {insights.recommendations.length} INSIGHTS
                    </span>
                  </h3>
                  <div className="space-y-2 relative z-10">
                    {insights.recommendations.map((rec, idx) => (
                      <div key={idx} className="flex items-start gap-3 text-sm text-gray-100 bg-black/40 rounded-lg p-3 border border-purple-500/30 hover:border-purple-500/50 transition-all backdrop-blur-sm group">
                        <div className="neuron-node w-5 h-5 mt-0.5 flex-shrink-0 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                          <i className="codicon codicon-arrow-right text-white" style={{ fontSize: 8 }} />
                        </div>
                        <span className="leading-relaxed font-mono text-xs">{rec}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Footer - Neural Status */}
              <div className="text-center py-4 relative">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-purple-500/10 to-transparent"></div>
                <div className="relative flex items-center justify-center gap-2 text-xs text-purple-400/80 font-mono">
                  <span className="inline-flex h-2 w-2 rounded-full bg-purple-500 neural-pulse"></span>
                  <span>DRIFTBOX CORTEX - NEURAL NETWORK ACTIVE</span>
                  <span className="inline-flex h-2 w-2 rounded-full bg-purple-500 neural-pulse" style={{ animationDelay: '1s' }}></span>
                </div>
                <p className="text-[10px] text-purple-500/50 mt-2 font-mono">// CONTINUOUSLY LEARNING FROM INFRASTRUCTURE PATTERNS</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
