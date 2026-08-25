import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts'
import { getCachedDocumentation, cacheDocumentation, clearCachedDocumentation, getCachedDoc } from '@/utils/documentationCache'
import { getApiEndpoint } from '@/utils/apiEndpoint'

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

interface DocumentationData {
  ok: boolean
  repo: string
  branch: string
  summary: {
    total_resources: number
    resource_types: number
    files: number
  }
  sections: Array<{
    type: string
    display_name: string
    icon: string
    count: number
    resources: Array<{
      name: string
      tf_name: string
      file: string
      line?: number
      attributes: Record<string, any>
    }>
  }>
  analysis: string
  recommendations: string[]
}

interface DriftItem {
  file: string
  line?: number
  type: 'added' | 'removed' | 'modified' | 'config_change'
  severity: 'low' | 'medium' | 'high'
  resource_name: string
  resource_type: string
  description: string
  old_value?: string
  new_value?: string
  ai_explanation?: {
    text: string
    risk_level: string
    confidence: number
  }
  git_context?: {
    commits: any[]
    last_author?: string
    last_message?: string
    commit_count: number
  }
  affected_resources?: Array<{
    type: string
    name: string
    file: string
    relationship: string
  }>
  conversation_history?: Array<{
    timestamp?: string
    snippet: string
  }>
}

interface DriftData {
  ok: boolean
  repo: string
  branch: string
  compared_to: string
  total_changes: number
  added: number
  removed: number
  modified: number
  drifts: DriftItem[]
  impact_analysis?: {
    total_drifts: number
    high_risk_count: number
    cascade_effects: any[]
    requires_review: boolean
  }
  ai_insights?: {
    summary: string
    recommendations: string[]
  }
  analysis_metadata?: {
    total_resources_current: number
    total_resources_previous: number
    resources_compared: number
    previous_commit_sha?: string
    previous_commit_message?: string
  }
}

/**
 * Hook to fetch diagram data with TanStack Query
 * Automatically deduplicates requests and caches results
 */
export function useDiagramData(
  owner: string | null,
  repo: string | null,
  branch: string = 'main',
  enabled: boolean = true
) {
  const { token } = useAuth()
  const queryClient = useQueryClient()

  // localStorage cache key for diagram (persists across page refreshes)
  const DIAGRAM_CACHE_KEY = owner && repo ? `infrara_diagram_cache_${owner}_${repo}_${branch}` : null
  const DIAGRAM_CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours - matches refresh lock duration

  // Helper to get cached diagram from localStorage
  const getCachedDiagram = (): DiagramData | null => {
    if (!DIAGRAM_CACHE_KEY) return null
    try {
      const cached = localStorage.getItem(DIAGRAM_CACHE_KEY)
      if (cached) {
        const { data, timestamp } = JSON.parse(cached)
        const cacheAge = Date.now() - timestamp
        if (cacheAge < DIAGRAM_CACHE_DURATION) {
          // Don't log here - log only when actually used in queryFn
          return data
        } else {
          localStorage.removeItem(DIAGRAM_CACHE_KEY)
        }
      }
    } catch (e) {
      console.error('📊 [Diagram] Failed to read localStorage cache:', e)
    }
    return null
  }

  // Helper to cache diagram to localStorage
  const cacheDiagram = (diagramData: DiagramData) => {
    if (!DIAGRAM_CACHE_KEY) return
    try {
      localStorage.setItem(DIAGRAM_CACHE_KEY, JSON.stringify({
        data: diagramData,
        timestamp: Date.now()
      }))
      console.log('📊 [Diagram] 💾 Cached diagram to localStorage')
    } catch (e) {
      console.error('📊 [Diagram] Failed to cache to localStorage:', e)
    }
  }

  // Check localStorage cache on mount
  const localStorageCache = DIAGRAM_CACHE_KEY ? getCachedDiagram() : null

  return useQuery<DiagramData>({
    queryKey: ['diagram', owner, repo, branch],
    initialData: localStorageCache || undefined,
    placeholderData: () => {
      const queryCache = queryClient.getQueryData<DiagramData>(['diagram', owner, repo, branch])
      if (queryCache) return queryCache
      return getCachedDiagram() || undefined
    },
    queryFn: async () => {
      if (!owner || !repo || !token) {
        throw new Error('Missing required parameters')
      }

      // Check TanStack Query cache first (for normal loads)
      // When invalidated, this will be null and we'll fetch fresh
      const cachedData = queryClient.getQueryData<DiagramData>(['diagram', owner, repo, branch])
      if (cachedData) {
        console.log('📊 [Diagram] ✅ Found cached data in TanStack Query cache, returning immediately')
        return cachedData
      }

      // Check localStorage cache (only if not invalidated)
      const localStorageData = getCachedDiagram()
      if (localStorageData) {
        // Calculate cache age for logging
        let cacheAge = 0
        if (DIAGRAM_CACHE_KEY) {
          try {
            const cached = localStorage.getItem(DIAGRAM_CACHE_KEY)
            if (cached) {
              const { timestamp } = JSON.parse(cached)
              cacheAge = Date.now() - timestamp
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
        console.log('📊 [Diagram] ✅ Found cached data in localStorage (age:', Math.round(cacheAge / 1000 / 60), 'min), returning immediately')
        queryClient.setQueryData(['diagram', owner, repo, branch], localStorageData)
        return localStorageData
      }

      console.log('📊 [Diagram] Fetching fresh data from network...')

      const response = await fetch(getApiEndpoint(`/diagram/generate/${owner}/${repo}?branch=${branch}`), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || error.error || `Failed to generate diagram: ${response.status}`)
      }

      const result = await response.json()
      
      // Cache successful result to localStorage
      cacheDiagram(result)
      
      return result
    },
    enabled: enabled && !!owner && !!repo && !!token,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Don't retry on 404 - fail fast for repos without infrastructure
  })
}

/**
 * Hook to fetch documentation data with TanStack Query
 * Automatically deduplicates requests and caches results
 */
export function useDocumentationData(
  owner: string | null,
  repo: string | null,
  branch: string = 'main',
  enabled: boolean = true
) {
  const { token } = useAuth()
  const queryClient = useQueryClient()

  // Cache key for this repo/branch (for reference)
  const DOC_CACHE_KEY = owner && repo ? `infrara_doc_cache_${owner}_${repo}_${branch}` : null

  // Load initial cache synchronously (localStorage only - file system is async)
  const initialCache = owner && repo ? getCachedDoc(owner, repo, branch) : null
  
  return useQuery<DocumentationData>({
    queryKey: ['documentation', owner, repo, branch],
    // Use initial cache from localStorage if available
    initialData: initialCache || undefined,
    // Use placeholderData function to check cache dynamically on every render
    // This ensures cached data is shown immediately if it exists
    placeholderData: () => {
      // First check TanStack Query cache
      const queryCache = queryClient.getQueryData<DocumentationData>(['documentation', owner, repo, branch])
      if (queryCache) return queryCache
      
      // Then check localStorage cache (synchronous)
      if (owner && repo) {
        const cached = getCachedDoc(owner, repo, branch)
        if (cached) {
          // Also populate TanStack Query cache for faster access
          queryClient.setQueryData(['documentation', owner, repo, branch], cached)
          return cached
        }
      }
      
      return undefined
    },
    queryFn: async ({ signal }) => {
      if (!owner || !repo || !token) {
        throw new Error('Missing required parameters')
      }

      // Create a unique key for this documentation request
      const docKey = `${owner}/${repo}/${branch}`
      
      // First, check if data is already cached (from preload or previous fetch)
      // This is a defensive check - TanStack Query should handle this, but we check anyway
      const queryCachedData = queryClient.getQueryData<DocumentationData>(['documentation', owner, repo, branch])
      if (queryCachedData) {
        console.log('📄 [Documentation] ✅ Found cached data in TanStack Query cache, returning immediately (no network request)')
        // Return cached data immediately - this prevents any network request
        return queryCachedData
      }
      
      // Also check persistent cache before making network request
      const persistentCachedData = await getCachedDocumentation(owner, repo, branch)
      if (persistentCachedData) {
        console.log('📄 [Documentation] ✅ Found cached data in persistent cache, returning immediately (no network request)')
        // Cache it to TanStack Query cache for faster access
        queryClient.setQueryData(['documentation', owner, repo, branch], persistentCachedData)
        return persistentCachedData
      }
      
      console.log('📄 [Documentation] ❌ No cached data found, will fetch from network')
      
      // Check if a documentation request is already in progress for this repo
      if (documentationInProgress.has(docKey)) {
        console.log('⏳ [Documentation] Request already in progress, waiting for existing request...')
        // Wait for the existing request
        const existingPromise = documentationInProgress.get(docKey)!
        return existingPromise
      }

      // Create the documentation request
      const docPromise = (async () => {
        try {
          // Add timeout - documentation can take 30-60s, but allow up to 4 minutes
          // Note: Next.js/Vercel may have platform limits (60s for Pro, 10s for Hobby)
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 240000) // 4 minutes (less than backend's 5 min)
          
          // DON'T use TanStack Query's signal - it aborts on component unmount
          // We want documentation to continue loading in background even if user navigates away
          // Only use timeout signal so it still times out after 4 minutes
          // This allows prefetch and component usage to both continue in background

          const response = await fetch(getApiEndpoint(`/documentation/generate/${owner}/${repo}?branch=${branch}`), {
            headers: {
              'Authorization': `Bearer ${token}`
            },
            signal: controller.signal // Only timeout, not component unmount
          })

          clearTimeout(timeoutId)

          if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            // Check for 504 Gateway Timeout (Next.js/Vercel platform timeout)
            if (response.status === 504) {
              throw new Error('Documentation generation timed out. This may be due to platform limits. Try again or contact support.')
            }
            throw new Error(error.detail || error.error || `Failed to generate documentation: ${response.status}`)
          }

          const result = await response.json()
          
          // Cache successful result to persistent storage (localStorage + file system)
          await cacheDocumentation(owner, repo, branch, result)
          
          return result
        } catch (error: any) {
          if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            throw new Error('Documentation generation timed out after 4 minutes. The server may be overloaded.')
          }
          throw error
        } finally {
          // Clean up after request completes (success or failure)
          documentationInProgress.delete(docKey)
        }
      })()

      // Store the promise so other calls can wait for it
      documentationInProgress.set(docKey, docPromise)
      
      return docPromise
    },
    enabled: enabled && !!owner && !!repo && !!token,
    staleTime: 10 * 60 * 1000, // 10 minutes - docs are expensive to generate
    retry: false, // Don't retry - documentation generation is expensive and failures are usually timeout/platform issues
    // TanStack Query will automatically deduplicate requests with the same queryKey
    // So if component remounts, it will reuse the existing request
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes (was cacheTime)
    // Don't cancel on unmount - let background prefetch continue
    // The prefetchQuery in usePreloadData will continue even if component unmounts
    refetchOnMount: false, // Don't refetch if data exists in cache (within staleTime)
    refetchOnWindowFocus: false, // Don't refetch on window focus
    refetchOnReconnect: false, // Don't refetch on reconnect
    // placeholderData ensures UI shows cached data immediately if it exists
    // The cache check inside queryFn prevents network requests when cached data exists
  })
}

/**
 * Hook to fetch drift detection data with TanStack Query
 * Automatically deduplicates requests and caches results
 */
export function useDriftData(
  owner: string | null,
  repo: string | null,
  branch: string = 'main',
  enhanced: boolean = false,
  enabled: boolean = true
) {
  const { token } = useAuth()
  const queryClient = useQueryClient()

  // localStorage cache key for drift (persists across page refreshes)
  const DRIFT_CACHE_KEY = owner && repo ? `infrara_drift_cache_${owner}_${repo}_${branch}_${enhanced ? 'enhanced' : 'basic'}` : null
  const DRIFT_CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours - matches refresh lock duration

  // Helper to get cached drift from localStorage
  const getCachedDrift = (): DriftData | null => {
    if (!DRIFT_CACHE_KEY) return null
    try {
      const cached = localStorage.getItem(DRIFT_CACHE_KEY)
      if (cached) {
        const { data, timestamp } = JSON.parse(cached)
        const cacheAge = Date.now() - timestamp
        if (cacheAge < DRIFT_CACHE_DURATION) {
          // Don't log here - log only when actually used in queryFn
          return data
        } else {
          localStorage.removeItem(DRIFT_CACHE_KEY)
        }
      }
    } catch (e) {
      console.error('🔍 [Drift] Failed to read localStorage cache:', e)
    }
    return null
  }

  // Helper to cache drift to localStorage
  const cacheDrift = (driftData: DriftData) => {
    if (!DRIFT_CACHE_KEY) return
    try {
      localStorage.setItem(DRIFT_CACHE_KEY, JSON.stringify({
        data: driftData,
        timestamp: Date.now()
      }))
      console.log('🔍 [Drift] 💾 Cached drift to localStorage')
    } catch (e) {
      console.error('🔍 [Drift] Failed to cache to localStorage:', e)
    }
  }

  // Check localStorage cache on mount
  const localStorageCache = DRIFT_CACHE_KEY ? getCachedDrift() : null

  return useQuery<DriftData>({
    queryKey: ['drift', owner, repo, branch, enhanced ? 'enhanced' : 'basic'],
    initialData: localStorageCache || undefined,
    placeholderData: () => {
      const queryCache = queryClient.getQueryData<DriftData>(['drift', owner, repo, branch, enhanced ? 'enhanced' : 'basic'])
      if (queryCache) return queryCache
      return getCachedDrift() || undefined
    },
    queryFn: async ({ signal }) => {
      if (!owner || !repo || !token) {
        throw new Error('Missing required parameters')
      }

      // First, check if data is already cached (from preload or previous fetch)
      const cachedData = queryClient.getQueryData<DriftData>(['drift', owner, repo, branch, enhanced ? 'enhanced' : 'basic'])
      if (cachedData) {
        console.log('🔍 [Drift] ✅ Found cached data in TanStack Query cache, returning immediately')
        return cachedData
      }

      // Also check localStorage cache before making network request
      const localStorageData = getCachedDrift()
      if (localStorageData) {
        // Calculate cache age for logging
        let cacheAge = 0
        if (DRIFT_CACHE_KEY) {
          try {
            const cached = localStorage.getItem(DRIFT_CACHE_KEY)
            if (cached) {
              const { timestamp } = JSON.parse(cached)
              cacheAge = Date.now() - timestamp
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
        console.log('🔍 [Drift] ✅ Found cached data in localStorage (age:', Math.round(cacheAge / 1000 / 60), 'min), returning immediately')
        queryClient.setQueryData(['drift', owner, repo, branch, enhanced ? 'enhanced' : 'basic'], localStorageData)
        return localStorageData
      }

      console.log('🔍 [Drift] ❌ No cached data found (neither TanStack Query nor localStorage), will fetch from network')

      // Create a unique key for this drift request
      const driftKey = `${owner}/${repo}/${branch}/${enhanced ? 'enhanced' : 'basic'}`
      
      // Check if a drift request is already in progress for this repo/branch/enhanced combo
      if (driftInProgress.has(driftKey)) {
        console.log('⏳ [Drift] Request already in progress, waiting for existing request...')
        // Wait for the existing request
        const existingPromise = driftInProgress.get(driftKey)!
        return existingPromise
      }

      // Create the drift request
      const driftPromise = (async () => {
        try {
          const endpoint = enhanced ? 'enhanced' : ''
          const url = `/drift/detect/${owner}/${repo}${endpoint ? '/' + endpoint : ''}?branch=${branch}`
          
          // Create AbortController with timeout (90 seconds for enhanced, 60 for basic)
          const timeoutMs = enhanced ? 90000 : 60000
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
          
          // Combine with TanStack Query's signal
          const combinedSignal = signal ? (() => {
            const combined = new AbortController()
            signal.addEventListener('abort', () => combined.abort())
            controller.signal.addEventListener('abort', () => combined.abort())
            return combined.signal
          })() : controller.signal

          const response = await fetch(getApiEndpoint(url), {
            headers: {
              'Authorization': `Bearer ${token}`
            },
            signal: combinedSignal
          })

          clearTimeout(timeoutId)

          if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            throw new Error(error.detail || error.error || `Failed to detect drift: ${response.status}`)
          }

          const result = await response.json()
          
          // Cache successful result to localStorage
          cacheDrift(result)
          
          return result
        } catch (error: any) {
          if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            const timeoutMs = enhanced ? 90000 : 60000
            throw new Error(`Request timed out after ${timeoutMs / 1000}s. The server may be overloaded.`)
          }
          throw error
        } finally {
          // Clean up after request completes (success or failure)
          driftInProgress.delete(driftKey)
        }
      })()

      // Store the promise so other calls can wait for it
      driftInProgress.set(driftKey, driftPromise)
      
      return driftPromise
    },
    enabled: enabled && !!owner && !!repo && !!token,
    staleTime: 2 * 60 * 1000, // 2 minutes - drift can change frequently
    retry: 1, // Only retry once to avoid overloading server
    retryDelay: 2000, // 2 second delay between retries
    refetchOnMount: false, // Don't refetch if data exists in cache - prevents duplicate calls when navigating back
  })
}

interface SecurityData {
  ok: boolean
  summary: {
    total_issues: number
    by_severity: {
      critical: number
      high: number
      medium: number
      low: number
    }
    security_score: number
    status: string
    compliance_affected: string[]
  }
  issues: any[]
}

interface CostData {
  ok: boolean
  method: string
  total_monthly_cost: number
  total_annual_cost: number
  total_potential_savings: number
  optimizations: any[]
  resources?: any[]
  error?: string
  message?: string
  total_resources?: number
  aws_resources_found?: number
  costable_resources_found?: number
}

/**
 * Hook to fetch security scan data with TanStack Query (per-repo)
 * Automatically deduplicates requests and caches results per repository
 */
export function useSecurityScan(owner: string | null, repo: string | null, enabled: boolean = true) {
  const { token } = useAuth()
  const queryClient = useQueryClient()

  // localStorage cache key for security scan (per-repo)
  const SECURITY_CACHE_KEY = owner && repo ? `infrara_security_cache_${owner}_${repo}` : null
  const SECURITY_CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours - matches refresh lock duration

  // Helper to get cached security scan from localStorage
  const getCachedSecurity = (): SecurityData | null => {
    if (!SECURITY_CACHE_KEY) return null
    try {
      const cached = localStorage.getItem(SECURITY_CACHE_KEY)
      if (cached) {
        const { data, timestamp } = JSON.parse(cached)
        const cacheAge = Date.now() - timestamp
        if (cacheAge < SECURITY_CACHE_DURATION) {
          return data
        } else {
          localStorage.removeItem(SECURITY_CACHE_KEY)
        }
      }
    } catch (e) {
      console.error('🔒 [Security] Failed to read localStorage cache:', e)
    }
    return null
  }

  // Helper to cache security scan to localStorage
  const cacheSecurity = (securityData: SecurityData) => {
    if (!SECURITY_CACHE_KEY) return
    try {
      localStorage.setItem(SECURITY_CACHE_KEY, JSON.stringify({
        data: securityData,
        timestamp: Date.now()
      }))
      console.log('🔒 [Security] 💾 Cached security scan to localStorage')
    } catch (e) {
      console.error('🔒 [Security] Failed to cache to localStorage:', e)
    }
  }

  // Check localStorage cache on mount
  const localStorageCache = SECURITY_CACHE_KEY ? getCachedSecurity() : null

  return useQuery<SecurityData>({
    queryKey: ['security', 'scan', owner, repo], // Per-repo key
    initialData: localStorageCache || undefined,
    placeholderData: () => {
      const queryCache = queryClient.getQueryData<SecurityData>(['security', 'scan', owner, repo])
      if (queryCache) return queryCache
      return getCachedSecurity() || undefined
    },
    queryFn: async () => {
      if (!token) {
        throw new Error('Not authenticated')
      }

      // Check TanStack Query cache first
      const cachedData = queryClient.getQueryData<SecurityData>(['security', 'scan', owner, repo])
      if (cachedData) {
        console.log('🔒 [Security] ✅ Found cached data in TanStack Query cache, returning immediately')
        return cachedData
      }

      // Check localStorage cache
      const localStorageData = getCachedSecurity()
      if (localStorageData) {
        console.log('🔒 [Security] ✅ Found cached data in localStorage, returning immediately')
        queryClient.setQueryData(['security', 'scan', owner, repo], localStorageData)
        return localStorageData
      }

      console.log('🔒 [Security] Fetching fresh data from network...')

      const response = await fetch(getApiEndpoint('/security/scan'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || error.error || `Failed to scan security: ${response.status}`)
      }

      const result = await response.json()
      
      // Cache successful result to localStorage
      cacheSecurity(result)
      
      return result
    },
    enabled: enabled && !!owner && !!repo && !!token,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

/**
 * Hook to fetch cost estimate data with TanStack Query (per-repo)
 * Automatically deduplicates requests and caches results per repository
 */
export function useCostEstimate(owner: string | null, repo: string | null, enabled: boolean = true) {
  const { token } = useAuth()
  const queryClient = useQueryClient()

  // localStorage cache key for cost estimate (per-repo)
  const COST_CACHE_KEY = owner && repo ? `infrara_cost_cache_${owner}_${repo}` : null
  const COST_CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours - matches refresh lock duration

  // Helper to get cached cost estimate from localStorage
  const getCachedCost = (): CostData | null => {
    if (!COST_CACHE_KEY) return null
    try {
      const cached = localStorage.getItem(COST_CACHE_KEY)
      if (cached) {
        const { data, timestamp } = JSON.parse(cached)
        const cacheAge = Date.now() - timestamp
        if (cacheAge < COST_CACHE_DURATION) {
          return data
        } else {
          localStorage.removeItem(COST_CACHE_KEY)
        }
      }
    } catch (e) {
      console.error('💰 [Cost] Failed to read localStorage cache:', e)
    }
    return null
  }

  // Helper to cache cost estimate to localStorage
  const cacheCost = (costData: CostData) => {
    if (!COST_CACHE_KEY) return
    try {
      localStorage.setItem(COST_CACHE_KEY, JSON.stringify({
        data: costData,
        timestamp: Date.now()
      }))
      console.log('💰 [Cost] 💾 Cached cost estimate to localStorage')
    } catch (e) {
      console.error('💰 [Cost] Failed to cache to localStorage:', e)
    }
  }

  // Check localStorage cache on mount
  const localStorageCache = COST_CACHE_KEY ? getCachedCost() : null

  return useQuery<CostData>({
    queryKey: ['cost', 'estimate', owner, repo], // Per-repo key
    initialData: localStorageCache || undefined,
    placeholderData: () => {
      const queryCache = queryClient.getQueryData<CostData>(['cost', 'estimate', owner, repo])
      if (queryCache) return queryCache
      return getCachedCost() || undefined
    },
    queryFn: async () => {
      if (!token) {
        throw new Error('Not authenticated')
      }

      // Check TanStack Query cache first
      const cachedData = queryClient.getQueryData<CostData>(['cost', 'estimate', owner, repo])
      if (cachedData) {
        console.log('💰 [Cost] ✅ Found cached data in TanStack Query cache, returning immediately')
        return cachedData
      }

      // Check localStorage cache
      const localStorageData = getCachedCost()
      if (localStorageData) {
        console.log('💰 [Cost] ✅ Found cached data in localStorage, returning immediately')
        queryClient.setQueryData(['cost', 'estimate', owner, repo], localStorageData)
        return localStorageData
      }

      console.log('💰 [Cost] Fetching fresh data from network...')

      const response = await fetch(getApiEndpoint('/cost/estimate'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || error.error || `Failed to estimate cost: ${response.status}`)
      }

      const result = await response.json()
      
      // Cache successful result to localStorage
      cacheCost(result)
      
      return result
    },
    enabled: enabled && !!owner && !!repo && !!token,
    staleTime: 10 * 60 * 1000, // 10 minutes - cost estimates don't change often
  })
}

interface ResourceGroup {
  type: string
  display_name: string
  icon: string
  count: number
  resources: Array<{
    name: string
    tf_name: string
    file: string
    line?: number
    type?: string
    attributes: Record<string, any>
  }>
}

interface DashboardData {
  ok: boolean
  repo: string
  sha?: string
  total_resources: number
  resource_types: number
  resources: ResourceGroup[]
}

// Shared state to coordinate parse requests across components
// This prevents duplicate parse requests when Dashboard and Preload both try to parse
const parseInProgress = new Map<string, Promise<any>>()

// Shared state to coordinate documentation requests across components
// This prevents duplicate documentation requests in React Strict Mode
export const documentationInProgress = new Map<string, Promise<any>>()

// Shared state to coordinate drift requests across components
// This prevents duplicate drift requests when navigating away and back
const driftInProgress = new Map<string, Promise<any>>()

// Shared state to coordinate infrastructure story requests across components
// This prevents duplicate story requests from preload and component
export const storyInProgress = new Map<string, Promise<any>>()

/**
 * Hook to parse GitHub repository (POST mutation)
 * This populates the catalog/index for the dashboard
 * Uses shared state to prevent duplicate requests
 */
export function useParseGitHubRepo() {
  const { token } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ owner, repo, branch }: { owner: string; repo: string; branch: string }) => {
      if (!token) {
        throw new Error('Not authenticated')
      }

      // Create a unique key for this parse request
      const parseKey = `${owner}/${repo}/${branch}`
      
      // Check if a parse is already in progress for this repo
      if (parseInProgress.has(parseKey)) {
        console.log('⏳ [Parse] Parse already in progress, waiting for existing request...')
        // Wait for the existing request
        const existingPromise = parseInProgress.get(parseKey)!
        return existingPromise
      }

      // Create the parse request
      const parsePromise = (async () => {
        try {
          const response = await fetch(getApiEndpoint('/github/parse-github-repo'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ owner, repo, branch })
          })

          if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            const errorMessage = error.detail?.message || error.error || `Failed to parse repository: ${response.status}`
            
            // For auth errors, include status code in error message for easier detection
            if (response.status === 401 || response.status === 403) {
              throw new Error(`Authentication failed (${response.status}): ${errorMessage}`)
            }
            
            throw new Error(errorMessage)
          }

          return response.json()
        } catch (error) {
          // Re-throw to let mutation handle it
          throw error
        } finally {
          // Clean up after request completes (success or failure)
          parseInProgress.delete(parseKey)
        }
      })()

      // Store the promise so other calls can wait for it
      parseInProgress.set(parseKey, parsePromise)
      
      return parsePromise
    },
    onSuccess: (data, variables) => {
      // Remove dashboard query from cache to force fresh fetch on refetch
      // This ensures we get the newly parsed data from the infrastructure index
      queryClient.removeQueries({ 
        queryKey: ['dashboard', variables.owner, variables.repo]
      })
      console.log('🔄 [Parse] Removed dashboard cache - will fetch fresh data on refetch')
    },
  })
}

/**
 * Hook to fetch dashboard AWS resources data with TanStack Query
 * Automatically deduplicates requests and caches results
 */
export function useDashboardData(
  owner: string | null,
  repo: string | null,
  enabled: boolean = true
) {
  const { token } = useAuth()
  const queryClient = useQueryClient()

  // localStorage cache key for dashboard (persists across page refreshes)
  const DASHBOARD_CACHE_KEY = owner && repo ? `infrara_dashboard_cache_${owner}_${repo}` : null
  const DASHBOARD_CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours - matches refresh lock duration

  // Helper to get cached dashboard from localStorage
  const getCachedDashboard = (): DashboardData | null => {
    if (!DASHBOARD_CACHE_KEY) return null
    try {
      const cached = localStorage.getItem(DASHBOARD_CACHE_KEY)
      if (cached) {
        const { data, timestamp } = JSON.parse(cached)
        const cacheAge = Date.now() - timestamp
        if (cacheAge < DASHBOARD_CACHE_DURATION) {
          // Don't log here - log only when actually used in queryFn
          return data
        } else {
          localStorage.removeItem(DASHBOARD_CACHE_KEY)
        }
      }
    } catch (e) {
      console.error('📊 [Dashboard] Failed to read localStorage cache:', e)
    }
    return null
  }

  // Helper to cache dashboard to localStorage
  const cacheDashboard = (dashboardData: DashboardData) => {
    if (!DASHBOARD_CACHE_KEY) return
    try {
      localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
        data: dashboardData,
        timestamp: Date.now()
      }))
      console.log('📊 [Dashboard] 💾 Cached dashboard to localStorage')
    } catch (e) {
      console.error('📊 [Dashboard] Failed to cache to localStorage:', e)
    }
  }

  // Check localStorage cache on mount
  const localStorageCache = DASHBOARD_CACHE_KEY ? getCachedDashboard() : null

  return useQuery<DashboardData>({
    queryKey: ['dashboard', owner, repo],
    initialData: localStorageCache || undefined,
    placeholderData: () => {
      const queryCache = queryClient.getQueryData<DashboardData>(['dashboard', owner, repo])
      if (queryCache) return queryCache
      return getCachedDashboard() || undefined
    },
    queryFn: async ({ signal }) => {
      if (!owner || !repo || !token) {
        throw new Error('Missing required parameters')
      }

      // Check TanStack Query cache first (for normal loads)
      // When invalidated, this will be null and we'll fetch fresh
      const cachedData = queryClient.getQueryData<DashboardData>(['dashboard', owner, repo])
      if (cachedData) {
        console.log('📊 [Dashboard] ✅ Found cached data in TanStack Query cache, returning immediately')
        return cachedData
      }

      // Check localStorage cache (only if not invalidated)
      const localStorageData = getCachedDashboard()
      if (localStorageData) {
        // Calculate cache age for logging
        let cacheAge = 0
        if (DASHBOARD_CACHE_KEY) {
          try {
            const cached = localStorage.getItem(DASHBOARD_CACHE_KEY)
            if (cached) {
              const { timestamp } = JSON.parse(cached)
              cacheAge = Date.now() - timestamp
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
        console.log('📊 [Dashboard] ✅ Found cached data in localStorage (age:', Math.round(cacheAge / 1000 / 60), 'min), returning immediately')
        queryClient.setQueryData(['dashboard', owner, repo], localStorageData)
        return localStorageData
      }

      console.log('📊 [Dashboard] Fetching fresh data from network...')

      // Create AbortController with 60 second timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 60000)
      
      // Combine with TanStack Query's signal
      const combinedSignal = signal ? (() => {
        const combined = new AbortController()
        signal.addEventListener('abort', () => combined.abort())
        controller.signal.addEventListener('abort', () => combined.abort())
        return combined.signal
      })() : controller.signal

      try {
        const response = await fetch(getApiEndpoint(`/dashboard/aws-resources/${owner}/${repo}`), {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          signal: combinedSignal
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const error = await response.json().catch(() => ({}))
          throw new Error(error.detail?.message || error.error || `Failed to fetch dashboard: ${response.status}`)
        }

        const data = await response.json()
        
        // Validate response structure
        if (Array.isArray(data) || !data || typeof data.get === 'function') {
          throw new Error('Backend returned invalid data format')
        }

        // Cache successful result to localStorage
        cacheDashboard(data)
        
        return data
      } catch (error: any) {
        clearTimeout(timeoutId)
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
          throw new Error('Request timed out after 60s. The server may be overloaded.')
        }
        throw error
      }
    },
    enabled: enabled && !!owner && !!repo && !!token,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Don't retry on 404 - fail fast for repos without infrastructure
  })
}

interface IndexCodebaseResponse {
  success: boolean
  message?: string
  chunk_count?: number
  file_count?: number
  resource_count?: number
}

/**
 * Hook to index codebase with TanStack Query mutation
 * Handles parsing locally, then sending chunks to backend
 * Prevents duplicate requests and provides proper state management
 */
export function useIndexCodebase() {
  const { token } = useAuth()
  const queryClient = useQueryClient()

  return useMutation<IndexCodebaseResponse, Error, { owner: string; repo: string }>({
    mutationFn: async ({ owner, repo }) => {
      if (!token) {
        throw new Error('Not authenticated')
      }

      // Step 1: Parse codebase locally
      const { indexCodebase } = await import('@/utils/codebaseParser')
      const parseResult = await indexCodebase(owner, repo)
      
      if (!parseResult.success || !parseResult.chunks) {
        throw new Error(parseResult.error || 'Failed to parse codebase')
      }

      // Step 2: Send chunks to backend with timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 120000) // 2 minutes

      try {
        const response = await fetch(getApiEndpoint('/context/index-codebase'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            owner,
            repo,
            chunks: parseResult.chunks
          }),
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const error = await response.json().catch(() => ({}))
          throw new Error(error.detail || error.error || `Failed to index codebase: ${response.status}`)
        }

        const data = await response.json()
        
        // Store indexing status in localStorage
        const indexStatusKey = `codebase_indexed_${owner}_${repo}`
        localStorage.setItem(indexStatusKey, Date.now().toString())

        return data
      } catch (error: any) {
        clearTimeout(timeoutId)
        if (error.name === 'AbortError') {
          throw new Error('Indexing request timed out after 2 minutes. The server may be overloaded.')
        }
        throw error
      }
    },
    retry: 1, // Only retry once
    retryDelay: 3000, // 3 second delay between retries
  })
}

interface CortexInsights {
  noTerraform?: boolean
  message?: string
  suggestion?: string
  scannedResources: {
    total: number
    byType: Record<string, number>
  }
  detectedPatterns: string[]
  dependencies: {
    total: number
    common: string[]
  }
  recommendations: string[]
  repoStats: {
    tfFileCount: number
    totalLines: number
    lastScanned: string
    scanMethod?: string
  }
}

/**
 * Hook to fetch Driftbox Cortex insights with TanStack Query
 * Provides automatic caching, refresh handling, and consistent behavior with other data hooks
 */
export function useCortexInsights(
  owner: string | null,
  repo: string | null,
  branch: string = 'main',
  enabled: boolean = true
) {
  const { token } = useAuth()
  const queryClient = useQueryClient()

  const CORTEX_CACHE_KEY = owner && repo ? `driftbox_cortex_${owner}_${repo}_${branch}` : null

  const getCachedInsights = (): CortexInsights | null => {
    if (!CORTEX_CACHE_KEY) return null
    try {
      const cached = localStorage.getItem(CORTEX_CACHE_KEY)
      if (cached) {
        const { data, timestamp } = JSON.parse(cached)
        // Use cache if less than 1 hour old
        if (Date.now() - timestamp < 3600000) {
          return data
        }
      }
    } catch (e) {
      console.warn('⚠️ [Cortex] Failed to read localStorage cache:', e)
    }
    return null
  }

  const cacheInsights = (data: CortexInsights) => {
    if (!CORTEX_CACHE_KEY) return
    try {
      localStorage.setItem(CORTEX_CACHE_KEY, JSON.stringify({
        data,
        timestamp: Date.now()
      }))
    } catch (e) {
      console.warn('⚠️ [Cortex] Failed to cache insights:', e)
    }
  }

  // Check localStorage cache on mount
  const localStorageCache = CORTEX_CACHE_KEY ? getCachedInsights() : null

  return useQuery<CortexInsights>({
    queryKey: ['cortex', 'insights', owner, repo, branch],
    initialData: localStorageCache || undefined,
    placeholderData: () => {
      const queryCache = queryClient.getQueryData<CortexInsights>(['cortex', 'insights', owner, repo, branch])
      if (queryCache) return queryCache
      return getCachedInsights() || undefined
    },
    queryFn: async ({ signal }) => {
      if (!owner || !repo || !token) {
        throw new Error('Missing required parameters')
      }

      // Check TanStack Query cache first
      const cachedData = queryClient.getQueryData<CortexInsights>(['cortex', 'insights', owner, repo, branch])
      if (cachedData) {
        console.log('🧠 [Cortex] ✅ Found cached data in TanStack Query cache, returning immediately')
        return cachedData
      }

      // Check localStorage cache before making network request
      const localStorageData = getCachedInsights()
      if (localStorageData) {
        console.log('🧠 [Cortex] ✅ Found cached data in localStorage, returning immediately')
        queryClient.setQueryData(['cortex', 'insights', owner, repo, branch], localStorageData)
        return localStorageData
      }

      console.log(`🧠 [Cortex] Fetching insights for ${owner}/${repo} on branch ${branch}...`)

      const response = await fetch(getApiEndpoint(`/cortex/insights/${owner}/${repo}?branch=${encodeURIComponent(branch)}`), {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        signal
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || error.error || `Failed to fetch Cortex insights: ${response.status}`)
      }

      const data = await response.json()
      
      // Cache to both TanStack Query and localStorage
      queryClient.setQueryData(['cortex', 'insights', owner, repo, branch], data)
      cacheInsights(data)
      
      console.log('🧠 [Cortex] ✅ Fetched and cached insights')
      return data
    },
    enabled: enabled && !!owner && !!repo && !!token,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  })
}

