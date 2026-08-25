'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Sparkles, GitBranch, GitCommit, Plus, Minus, ChevronDown, ChevronRight, FileCode, RefreshCw, GitMerge, CheckCircle } from 'lucide-react'
import { useAuth } from '@/contexts'
import { storyInProgress } from '@/hooks/useInfrastructureData'
import { useRefreshLock } from '@/hooks/useRefreshLock'

interface InfrastructureStoryProps {
  selectedRepo: {
    id: number
    name: string
    full_name: string
  }
  currentTeamId?: string | null
}

interface StoryData {
  repo: string
  timeframe: string
  narrative: string
  chapters: Array<{
    title: string
    commits: number
    authors: string[]
    cost_impact: number
    summary: string
    changes: Array<{
      sha: string
      message: string
      author: string | { name: string; email: string }
      date: string
      files_changed: number
      insertions: number
      deletions: number
      files?: Array<{
        filename: string
        additions: number
        deletions: number
        changes: number
        status: string
        patch?: string
      }>
      summary?: string
      explanation?: string
    }>
  }>
  recommendations: Array<{
    type: string
    priority: string
    title: string
    description: string
    impact?: string
    action: string
  }>
  total_commits: number
  total_authors: number
}

export default function InfrastructureStory({ selectedRepo, currentTeamId }: InfrastructureStoryProps) {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set())
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [loadingExplanationSha, setLoadingExplanationSha] = useState<string | null>(null)
  const [refreshStatus, setRefreshStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const [owner, repo] = selectedRepo.full_name.split('/')

  // localStorage cache key for infrastructure story (persists across page refreshes)
  const STORY_CACHE_KEY = `infrara_story_cache_${owner}_${repo}`
  const STORY_CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours - story doesn't change often

  // Helper to get cached story from localStorage
  const getCachedStory = (): StoryData | null => {
    try {
      const cached = localStorage.getItem(STORY_CACHE_KEY)
      if (cached) {
        const { data, timestamp } = JSON.parse(cached)
        const cacheAge = Date.now() - timestamp
        if (cacheAge < STORY_CACHE_DURATION) {
          console.log('📖 [InfrastructureStory] ✅ Found cached data in localStorage (age:', Math.round(cacheAge / 1000 / 60), 'min)')
          return data
        } else {
          console.log('📖 [InfrastructureStory] ⏰ localStorage cache expired, will fetch fresh')
          localStorage.removeItem(STORY_CACHE_KEY)
        }
      }
    } catch (e) {
      console.error('📖 [InfrastructureStory] Failed to read localStorage cache:', e)
    }
    return null
  }

  // Helper to cache story to localStorage
  const cacheStory = (storyData: StoryData) => {
    try {
      localStorage.setItem(STORY_CACHE_KEY, JSON.stringify({
        data: storyData,
        timestamp: Date.now()
      }))
      console.log('📖 [InfrastructureStory] 💾 Cached story to localStorage')
    } catch (e) {
      console.error('📖 [InfrastructureStory] Failed to cache to localStorage:', e)
    }
  }

  // Check localStorage cache on mount
  const localStorageCache = getCachedStory()

  // Fetch story data with TanStack Query
  // Use shared state to prevent duplicate requests from preload
  const {
    data: storyData,
    isLoading: loading,
    error: storyError,
    refetch: refetchStory,
    isFetching: storyFetching
  } = useQuery<StoryData>({
    queryKey: ['infrastructure-story', owner, repo],
    initialData: localStorageCache || undefined,
    placeholderData: () => {
      const queryCache = queryClient.getQueryData<StoryData>(['infrastructure-story', owner, repo])
      if (queryCache) return queryCache
      return getCachedStory() || undefined
    },
    queryFn: async () => {
      if (!token) {
        throw new Error('Not authenticated')
      }

      // Check if query is invalidated (forced refresh) - if so, skip cache checks
      const queryState = queryClient.getQueryState(['infrastructure-story', owner, repo])
      const isInvalidated = queryState?.isInvalidated === true
      
      // Only check cache if query is NOT invalidated (normal fetch, not forced refresh)
      if (!isInvalidated) {
        // First, check if data is already cached (from preload or previous fetch)
        const cachedData = queryClient.getQueryData<StoryData>(['infrastructure-story', owner, repo])
        if (cachedData) {
          console.log('📖 [InfrastructureStory] ✅ Found cached data in TanStack Query cache, returning immediately')
          return cachedData
        }

        // Also check localStorage cache before making network request
        const localStorageData = getCachedStory()
        if (localStorageData) {
          console.log('📖 [InfrastructureStory] ✅ Found cached data in localStorage, returning immediately')
          queryClient.setQueryData(['infrastructure-story', owner, repo], localStorageData)
          return localStorageData
        }
      }

      console.log('📖 [InfrastructureStory] ❌ No cached data found (neither TanStack Query nor localStorage), will fetch from network')

      // Use shared state to prevent duplicate requests when preload and component both try to fetch
      const storyKey = `${owner}/${repo}`
      
      // Check if a story request is already in progress
      if (storyInProgress.has(storyKey)) {
        console.log('⏳ [InfrastructureStory] Request already in progress, waiting for existing request...')
        const existingPromise = storyInProgress.get(storyKey)!
        return existingPromise
      }

      // Create the story request
      const storyPromise = (async () => {
        try {
          const { getApiEndpoint } = await import('@/utils/apiEndpoint')
          const response = await fetch(getApiEndpoint(`/drift/story/${owner}/${repo}?months=6`), {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          })

          if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            throw new Error(error.detail || error.error || `Failed to fetch story: ${response.status}`)
          }

          const result = await response.json()
          
          // Cache successful result to localStorage
          cacheStory(result)
          
          return result
        } finally {
          // Clean up after request completes
          storyInProgress.delete(storyKey)
        }
      })()

      // Store the promise so other calls can wait for it
      storyInProgress.set(storyKey, storyPromise)
      
      return storyPromise
    },
    enabled: !!token && !!selectedRepo,
    staleTime: 10 * 60 * 1000, // 10 minutes - story doesn't change often
    refetchOnMount: false, // Don't refetch if data exists in cache
  })

  // Mutation for fetching commit explanations
  const explanationMutation = useMutation({
    mutationFn: async (sha: string) => {
      if (!token) {
        throw new Error('Not authenticated')
      }

      setLoadingExplanationSha(sha)
      const { getApiEndpoint } = await import('@/utils/apiEndpoint')
      const response = await fetch(getApiEndpoint(`/drift/explain/${owner}/${repo}/${sha}`), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || error.error || `Failed to fetch explanation: ${response.status}`)
      }

      const data = await response.json()
      return { sha, explanation: data.explanation }
    },
    onSuccess: (data) => {
      setExplanations(prev => ({
        ...prev,
        [data.sha]: data.explanation
      }))
      setLoadingExplanationSha(null)
    },
    onError: () => {
      setLoadingExplanationSha(null)
    }
  })

  // Mutation for applying commits
  const applyCommitMutation = useMutation({
    mutationFn: async ({ sha, message }: { sha: string; message: string }) => {
      if (!token) {
        throw new Error('Not authenticated')
      }

      const { getApiEndpoint } = await import('@/utils/apiEndpoint')
      const response = await fetch(getApiEndpoint(`/drift/apply-commit/${owner}/${repo}/${sha}`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          commit_message: message
        })
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || error.error || `Failed to apply commit: ${response.status}`)
      }

      return response.json()
    },
    onSuccess: (data) => {
      alert(
        `✅ Success!\n\n` +
        `PR #${data.pr_number} created: ${data.pr_title}\n` +
        `URL: ${data.pr_url}`
      )
    },
    onError: (error: Error) => {
      alert(`❌ Failed to apply commit:\n${error.message}`)
    }
  })

  const toggleCommit = async (sha: string) => {
    const wasExpanded = expandedCommits.has(sha)
    
    // Toggle expansion
    setExpandedCommits(prev => {
      const newSet = new Set(prev)
      if (newSet.has(sha)) {
        newSet.delete(sha)
      } else {
        newSet.add(sha)
      }
      return newSet
    })
    
    // If expanding and no explanation yet, fetch it
    if (!wasExpanded && !explanations[sha]) {
      explanationMutation.mutate(sha)
    }
  }

  const [isRefreshing, setIsRefreshing] = useState(false)

  // 24-hour refresh lock (per-repo) - team workspaces get unlimited refreshes
  const lockKey = owner && repo ? `story_${owner}_${repo}` : 'story'
  const { isLocked, timeRemainingFormatted, lockRefresh } = useRefreshLock(lockKey, !!currentTeamId)

  const forceRefresh = async () => {
    if (isRefreshing || isLocked) return
    
    console.log('🔄 [InfrastructureStory] Refresh triggered - fetching fresh story from network...')
    setIsRefreshing(true)
    
    // Clear localStorage cache first
    try {
      localStorage.removeItem(STORY_CACHE_KEY)
      console.log('🔄 [InfrastructureStory] Cleared localStorage cache')
    } catch (e) {
      console.warn('⚠️ [InfrastructureStory] Failed to clear localStorage cache:', e)
    }
    
    // Remove query from cache to force fresh fetch
    queryClient.removeQueries({ 
      queryKey: ['infrastructure-story', owner, repo]
    })
    
    // Use fetchQuery directly to bypass all cache and force network request
    // This ensures we get fresh data from the server, not cached data
    try {
      const freshData = await queryClient.fetchQuery({
        queryKey: ['infrastructure-story', owner, repo],
        queryFn: async () => {
          if (!token) {
            throw new Error('Not authenticated')
          }

          console.log('📖 [InfrastructureStory] 🔄 Forced refresh - fetching from network (bypassing all cache)')

          // Use shared state to prevent duplicate requests
          const storyKey = `${owner}/${repo}`
          
          // Check if a story request is already in progress
          if (storyInProgress.has(storyKey)) {
            console.log('⏳ [InfrastructureStory] Request already in progress, waiting for existing request...')
            const existingPromise = storyInProgress.get(storyKey)!
            return existingPromise
          }

          // Create the story request
          const storyPromise = (async () => {
            try {
              const { getApiEndpoint } = await import('@/utils/apiEndpoint')
              const response = await fetch(getApiEndpoint(`/drift/story/${owner}/${repo}?months=6`), {
                headers: {
                  'Authorization': `Bearer ${token}`
                }
              })

              if (!response.ok) {
                const error = await response.json().catch(() => ({}))
                throw new Error(error.detail || error.error || `Failed to fetch story: ${response.status}`)
              }

              const result = await response.json()
              
              // Cache successful result to localStorage
              cacheStory(result)
              
              return result
            } finally {
              // Clean up after request completes
              storyInProgress.delete(storyKey)
            }
          })()

          // Store the promise so other calls can wait for it
          storyInProgress.set(storyKey, storyPromise)
          
          return storyPromise
        },
        staleTime: 0, // Force fresh fetch
      })
      
      // Lock only after successful fetch
      if (freshData) {
        lockRefresh()
        setRefreshStatus('success')
        console.log('✅ [InfrastructureStory] Refresh completed with fresh data, button locked for 24 hours')
        setTimeout(() => setRefreshStatus('idle'), 2000)
      }
    } catch (error: any) {
      console.error('❌ [InfrastructureStory] Refresh failed:', error)
      setRefreshStatus('error')
      setTimeout(() => setRefreshStatus('idle'), 3000)
    } finally {
      setIsRefreshing(false)
    }
  }

  const applyCommit = async (sha: string, message: string) => {
    const confirmApply = window.confirm(
      `Apply this commit to your current branch?\n\n` +
      `Commit: ${message}\n` +
      `SHA: ${sha.substring(0, 7)}\n\n` +
      `This will create a new PR with these changes.`
    )
    
    if (!confirmApply) return
    
    applyCommitMutation.mutate({ sha, message })
  }

  if (loading || isRefreshing) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
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
            {isRefreshing ? 'Refreshing Infrastructure Story' : 'Building Your Infrastructure Story'}
          </h2>
          <p className="text-[#888] text-sm mb-2">
            {isRefreshing 
              ? 'Fetching the latest commit history and changes...'
              : 'Analyzing your infrastructure evolution over time...'
            }
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

  if (storyError) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-[#F85149] mx-auto mb-3" />
          <p className="text-[#EDEDED] text-sm mb-2">Failed to load infrastructure story</p>
          <p className="text-[#888] text-xs mb-4">{storyError instanceof Error ? storyError.message : 'Unknown error'}</p>
          <button
            onClick={() => refetchStory()}
            className="px-4 py-2 bg-[#8b5cf6] hover:bg-[#7c3aed] text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 mx-auto"
          >
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!storyData) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-[#666] mx-auto mb-3" />
          <p className="text-[#888] text-sm">No infrastructure story available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6 overflow-auto">
      {/* Narrative Summary */}
      <div className="bg-gradient-to-r from-gray-900/20 to-gray-800/20 rounded-lg border border-gray-500/30 p-6">
        <div className="flex items-start gap-4">
          <Sparkles className="w-6 h-6 text-gray-400 mt-1 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-300">Your Infrastructure Journey</h2>
              <button
                onClick={forceRefresh}
                disabled={!!isRefreshing || isLocked}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-2 disabled:cursor-not-allowed ${
                  refreshStatus === 'success'
                    ? 'bg-green-500/20 text-green-400'
                    : refreshStatus === 'error'
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-gray-600 hover:bg-gray-700 disabled:bg-gray-700 text-white'
                }`}
                title={isLocked ? `Refresh locked. Available in ${timeRemainingFormatted}` : 'Refresh to check for new commits'}
              >
                {refreshStatus === 'success' ? (
                  <>
                    <CheckCircle size={12} />
                    Updated!
                  </>
                ) : refreshStatus === 'error' ? (
                  <>
                    <AlertCircle size={12} />
                    Failed
                  </>
                ) : (
                  <>
                    <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                    {isRefreshing ? 'Updating...' : isLocked ? (timeRemainingFormatted ? `Locked (${timeRemainingFormatted})` : 'Locked') : 'Refresh'}
                  </>
                )}
              </button>
            </div>
            <p className="text-gray-300 leading-relaxed mb-4">{storyData.narrative}</p>
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <GitBranch size={14} className="text-gray-500" />
                <span className="text-gray-400">{storyData.total_commits} commits</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">👥</span>
                <span className="text-gray-400">{storyData.total_authors} contributors</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">📅</span>
                <span className="text-gray-400">{storyData.timeframe}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Chapters */}
      {storyData.chapters && storyData.chapters.length > 0 && (
        <div className="bg-[#1F1F1F] rounded-lg border border-[#2a2a2a] p-6">
          <h3 className="text-md font-semibold text-[#EDEDED] mb-4 flex items-center gap-2">
            <span>📖</span> Commit Timeline ({storyData.total_commits} commits)
          </h3>
          <div className="space-y-6">
            {storyData.chapters.map((chapter, idx) => (
              <div key={idx}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-px flex-1 bg-gradient-to-r from-gray-500/50 to-transparent"></div>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{chapter.title}</h4>
                  <div className="h-px flex-1 bg-gradient-to-l from-gray-500/50 to-transparent"></div>
                </div>
                <p className="text-xs text-gray-400 mb-3 italic">{chapter.summary}</p>
                
                {/* Individual Commits */}
                {chapter.changes && chapter.changes.length > 0 && (
                  <div className="space-y-2">
                    {chapter.changes.map((commit, commitIdx) => {
                      const isExpanded = expandedCommits.has(commit.sha)
                      return (
                        <div 
                          key={commitIdx} 
                          className="border-l-2 border-gray-700 hover:border-gray-500 pl-4 py-2 transition-colors bg-[#181818] rounded-r-lg"
                        >
                          <div 
                            className="flex items-start gap-3 cursor-pointer"
                            onClick={() => toggleCommit(commit.sha)}
                          >
                            {isExpanded ? (
                              <ChevronDown size={16} className="text-gray-600 mt-0.5 flex-shrink-0" />
                            ) : (
                              <ChevronRight size={16} className="text-gray-600 mt-0.5 flex-shrink-0" />
                            )}
                            <GitCommit size={16} className="text-gray-600 mt-0.5 flex-shrink-0" />
                            <div className="flex items-start justify-between gap-4 flex-1">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-[#EDEDED] font-medium mb-1">{commit.message}</p>
                                {commit.summary && !isExpanded && (
                                  <p className="text-xs text-gray-500 italic mb-1">{commit.summary}</p>
                                )}
                                <div className="flex items-center gap-3 text-xs text-gray-500">
                                  <span className="flex items-center gap-1">
                                    <span className="text-gray-400">@{typeof commit.author === 'object' ? commit.author.name : commit.author}</span>
                                  </span>
                                  <span>•</span>
                                  <span>{new Date(commit.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                  <span>•</span>
                                  <span className="font-mono text-gray-600">{commit.sha.substring(0, 7)}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 text-xs flex-shrink-0 mr-4">
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-500">{commit.files_changed} files</span>
                                  {commit.insertions > 0 && (
                                    <span className="text-green-400">+{commit.insertions}</span>
                                  )}
                                  {commit.deletions > 0 && (
                                    <span className="text-red-400">-{commit.deletions}</span>
                                  )}
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    applyCommit(commit.sha, commit.message)
                                  }}
                                  disabled={applyCommitMutation.isPending}
                                  className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-wait text-white rounded text-xs font-medium transition-colors flex items-center gap-1"
                                  title="Cherry-pick this commit to your current branch"
                                >
                                  {applyCommitMutation.isPending ? (
                                    <>
                                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                      <span>Applying...</span>
                                    </>
                                  ) : (
                                    <>
                                      <GitMerge size={12} />
                                      <span>Apply</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Expanded Content */}
                          {isExpanded && (
                            <div className="mt-3 ml-9 space-y-3">
                              {/* AI Explanation - PROMINENT */}
                              <div className="bg-gradient-to-r from-gray-900/20 to-gray-800/20 border border-gray-500/40 rounded-lg p-4">
                                <div className="flex items-start gap-2 mb-2">
                                  <Sparkles className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                                  <h4 className="text-sm font-semibold text-gray-300">What Changed & Why</h4>
                                </div>
                                {loadingExplanationSha === commit.sha ? (
                                  <div className="flex items-center gap-2 text-sm text-gray-400">
                                    <div className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                                    <span>Analyzing commit with AI...</span>
                                  </div>
                                ) : explanations[commit.sha] ? (
                                  <p className="text-sm text-gray-200 leading-relaxed">{explanations[commit.sha]}</p>
                                ) : (
                                  <p className="text-sm text-gray-400 italic">Click to generate AI explanation</p>
                                )}
                              </div>

                              {/* Files Changed */}
                              {commit.files && commit.files.length > 0 && (
                                <>
                                  <p className="text-xs font-semibold text-gray-400 flex items-center gap-2">
                                    <FileCode size={14} />
                                    Code Changes ({commit.files.length} file{commit.files.length !== 1 ? 's' : ''})
                                  </p>
                                  {commit.files.map((file, fileIdx) => (
                                    <div key={fileIdx} className="bg-[#1F1F1F] border border-gray-800 rounded p-3">
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                          <FileCode size={14} className="text-gray-500" />
                                          <span className="text-xs font-mono text-gray-400">{file.filename}</span>
                                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                                            file.status === 'added' ? 'bg-green-900/30 text-green-400' :
                                            file.status === 'removed' ? 'bg-red-900/30 text-red-400' :
                                            file.status === 'modified' ? 'bg-yellow-900/30 text-yellow-400' :
                                            'bg-gray-800 text-gray-400'
                                          }`}>
                                            {file.status}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs">
                                          {file.additions > 0 && (
                                            <span className="text-green-400">+{file.additions}</span>
                                          )}
                                          {file.deletions > 0 && (
                                            <span className="text-red-400">-{file.deletions}</span>
                                          )}
                                        </div>
                                      </div>
                                      {file.patch && (
                                        <pre className="text-xs overflow-x-auto bg-black/30 p-2 rounded border border-gray-800 max-h-40 overflow-y-auto">
                                          <code className="text-gray-300">{file.patch}</code>
                                        </pre>
                                      )}
                                    </div>
                                  ))}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                
                {/* Chapter Summary */}
                <div className="mt-3 flex items-center gap-3 text-xs text-gray-600 pl-4">
                  <span>{chapter.commits} commits</span>
                  <span>•</span>
                  <span>by {chapter.authors.join(', ')}</span>
                  {chapter.cost_impact !== 0 && (
                    <>
                      <span>•</span>
                      <span className={chapter.cost_impact > 0 ? 'text-red-400 font-medium' : 'text-green-400 font-medium'}>
                        {chapter.cost_impact > 0 ? '+' : ''} ${Math.abs(chapter.cost_impact)}/mo
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {storyData.recommendations && storyData.recommendations.length > 0 && (
        <div className="bg-[#1F1F1F] rounded-lg border border-[#2a2a2a] p-6">
          <h3 className="text-md font-semibold text-[#EDEDED] mb-4 flex items-center gap-2">
            <span>💡</span> Recommendations
          </h3>
          <div className="space-y-3">
            {storyData.recommendations.map((rec, idx) => (
              <div
                key={idx}
                className={`p-4 rounded-lg border ${
                  rec.priority === 'high'
                    ? 'bg-red-900/10 border-red-500/30'
                    : rec.priority === 'medium'
                    ? 'bg-yellow-900/10 border-yellow-500/30'
                    : 'bg-gray-900/10 border-gray-500/30'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-semibold text-[#EDEDED]">{rec.title}</h4>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          rec.priority === 'high'
                            ? 'bg-red-500/20 text-red-400'
                            : rec.priority === 'medium'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {rec.priority}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mb-2">{rec.description}</p>
                    {rec.impact && (
                      <p className="text-xs text-gray-500 mb-2">
                        <span className="font-semibold">Impact:</span> {rec.impact}
                      </p>
                    )}
                    <p className="text-xs text-gray-300">
                      <span className="font-semibold text-gray-400">→</span> {rec.action}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

