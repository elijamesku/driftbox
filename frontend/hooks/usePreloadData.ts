import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts'
import { storyInProgress, documentationInProgress } from '@/hooks/useInfrastructureData'
import { getApiEndpoint } from '@/utils/apiEndpoint'

/**
 * Hook to preload all view data in the background when a repo is selected
 * This makes switching between views instant since data is already cached
 * Uses TanStack Query prefetchQuery to populate the cache that components use
 */
export function usePreloadData(selectedRepo: { id: number; name: string; full_name: string; default_branch?: string } | null) {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const preloadedRepoRef = useRef<string | null>(null)
  const preloadInProgressRef = useRef(false)

  useEffect(() => {
    // Only preload if:
    // 1. We have a selected repo
    // 2. We have auth token
    // 3. Haven't preloaded this repo yet
    // 4. No preload currently in progress
    if (!selectedRepo || !token) {
      return
    }

    const repoKey = selectedRepo.full_name
    
    // Skip if already preloaded this repo or preload in progress
    if (preloadedRepoRef.current === repoKey || preloadInProgressRef.current) {
      return
    }

    // Check if data is already cached in TanStack Query cache
    const [owner, repo] = repoKey.split('/')
    const branch = selectedRepo.default_branch || 'main'
    
    const hasCachedDashboard = queryClient.getQueryData(['dashboard', owner, repo])
    const hasCachedDrift = queryClient.getQueryData(['drift', owner, repo, branch, 'basic'])
    const hasCachedSecurity = queryClient.getQueryData(['security', 'scan', owner, repo])
    const hasCachedCost = queryClient.getQueryData(['cost', 'estimate', owner, repo])
    // Check both TanStack Query cache and localStorage for diagram
    const hasCachedDiagramInQuery = queryClient.getQueryData(['diagram', owner, repo, branch])
    const hasCachedDiagramInStorage = (() => {
      try {
        const cacheKey = `infrara_diagram_cache_${owner}_${repo}_${branch}`
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          const { timestamp } = JSON.parse(cached)
          const cacheAge = Date.now() - timestamp
          return cacheAge < 60 * 60 * 1000 // 1 hour
        }
      } catch (e) {
        // Ignore errors
      }
      return false
    })()
    const hasCachedDiagram = hasCachedDiagramInQuery || hasCachedDiagramInStorage
    // Check both TanStack Query cache and localStorage for infrastructure story
    const hasCachedStoryInQuery = queryClient.getQueryData(['infrastructure-story', owner, repo])
    const hasCachedStoryInStorage = (() => {
      try {
        const cacheKey = `infrara_story_cache_${owner}_${repo}`
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          const { timestamp } = JSON.parse(cached)
          const cacheAge = Date.now() - timestamp
          return cacheAge < 24 * 60 * 60 * 1000 // 24 hours
        }
      } catch (e) {
        // Ignore errors
      }
      return false
    })()
    const hasCachedStory = hasCachedStoryInQuery || hasCachedStoryInStorage
    // Check both TanStack Query cache and localStorage for documentation
    const hasCachedDocsInQuery = queryClient.getQueryData(['documentation', owner, repo, branch])
    const hasCachedDocsInStorage = (() => {
      try {
        const cacheKey = `infrara_doc_cache_${owner}_${repo}_${branch}`
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          const { timestamp } = JSON.parse(cached)
          const cacheAge = Date.now() - timestamp
          return cacheAge < 24 * 60 * 60 * 1000 // 24 hours
        }
      } catch (e) {
        // Ignore errors
      }
      return false
    })()
    const hasCachedDocs = hasCachedDocsInQuery || hasCachedDocsInStorage

    // If everything is cached, no need to preload
    // Note: Docs preload is optional, so we don't require it to be cached
    if (hasCachedDashboard && hasCachedDrift && hasCachedSecurity && hasCachedCost && hasCachedDiagram && hasCachedStory) {
      console.log('⚡ [Preload] All critical data already cached in TanStack Query for', repoKey, '- skipping preload')
      preloadedRepoRef.current = repoKey
      return
    }

    // Start preloading in background
    preloadInProgressRef.current = true
    console.log('🚀 [Preload] Starting background preload for', repoKey)

    // Preload all endpoints using TanStack Query prefetchQuery
    // This populates the cache that components use, preventing duplicate calls
    const preloadSequence = async () => {
      try {
        // Dashboard component handles parsing and fetching dashboard data
        // We don't need to do it here - the useDashboardData hook will automatically
        // fetch when parse completes. This prevents duplicate calls.
        if (hasCachedDashboard) {
          console.log('⚡ [Preload] Dashboard already cached')
        } else {
          console.log('📊 [Preload] Dashboard will be fetched by Dashboard component after parse completes')
        }

        // Now prefetch other endpoints in parallel
        const prefetchPromises = []

        // Preload drift data (basic only - enhanced is expensive and should be user-triggered)
        // Shared state in useDriftData prevents duplicates even if component also fetches
        if (!hasCachedDrift) {
          console.log('🔍 [Preload] Prefetching drift data (basic)...')
          prefetchPromises.push(
            queryClient.prefetchQuery({
              queryKey: ['drift', owner, repo, branch, 'basic'],
              queryFn: async ({ signal }) => {
                // Add timeout to prevent hanging
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), 60000)
                
                const combinedSignal = signal ? (() => {
                  const combined = new AbortController()
                  signal.addEventListener('abort', () => combined.abort())
                  controller.signal.addEventListener('abort', () => combined.abort())
                  return combined.signal
                })() : controller.signal

                try {
                  const response = await fetch(getApiEndpoint(`/drift/detect/${owner}/${repo}?branch=${branch}`), {
                    headers: { 'Authorization': `Bearer ${token}` },
                    signal: combinedSignal
                  })
                  clearTimeout(timeoutId)
                  if (!response.ok) throw new Error(`Failed: ${response.status}`)
                  return response.json()
                } catch (error: any) {
                  clearTimeout(timeoutId)
                  if (error.name === 'AbortError') {
                    throw new Error('Request timed out')
                  }
                  throw error
                }
              },
              staleTime: 2 * 60 * 1000, // Match component's staleTime
              retry: false, // Don't retry on 404 - fail fast for repos without infrastructure
            }).then(() => console.log('✅ [Preload] Drift data prefetched'))
              .catch(err => console.log('⏭️  [Preload] Drift prefetch skipped (no data yet):', err.message))
          )
        } else {
          console.log('⚡ [Preload] Drift data already cached')
        }

        // Preload security scan (per-repo)
        if (!hasCachedSecurity) {
          console.log('🔒 [Preload] Prefetching security data...')
          prefetchPromises.push(
            queryClient.prefetchQuery({
              queryKey: ['security', 'scan', owner, repo],
              queryFn: async ({ signal }) => {
                const response = await fetch(getApiEndpoint('/security/scan'), {
                  headers: { 'Authorization': `Bearer ${token}` },
                  signal
                })
                if (!response.ok) throw new Error(`Failed: ${response.status}`)
                const result = await response.json()
                
                // Cache to localStorage
                try {
                  const cacheKey = `infrara_security_cache_${owner}_${repo}`
                  localStorage.setItem(cacheKey, JSON.stringify({
                    data: result,
                    timestamp: Date.now()
                  }))
                } catch (e) {
                  console.error('🔒 [Preload] Failed to cache security to localStorage:', e)
                }
                
                return result
              },
            }).then(() => console.log('✅ [Preload] Security data prefetched'))
              .catch(err => console.log('⚠️ [Preload] Security prefetch failed (non-critical):', err))
          )
        }

        // Preload cost estimate (per-repo)
        if (!hasCachedCost) {
          console.log('💰 [Preload] Prefetching cost data...')
          prefetchPromises.push(
            queryClient.prefetchQuery({
              queryKey: ['cost', 'estimate', owner, repo],
              queryFn: async ({ signal }) => {
                const response = await fetch(getApiEndpoint('/cost/estimate'), {
                  headers: { 'Authorization': `Bearer ${token}` },
                  signal
                })
                if (!response.ok) throw new Error(`Failed: ${response.status}`)
                const result = await response.json()
                
                // Cache to localStorage
                try {
                  const cacheKey = `infrara_cost_cache_${owner}_${repo}`
                  localStorage.setItem(cacheKey, JSON.stringify({
                    data: result,
                    timestamp: Date.now()
                  }))
                } catch (e) {
                  console.error('💰 [Preload] Failed to cache cost to localStorage:', e)
                }
                
                return result
              },
            }).then(() => console.log('✅ [Preload] Cost data prefetched'))
              .catch(err => console.log('⚠️ [Preload] Cost prefetch failed (non-critical):', err))
          )
        }

        // Preload diagram (optional, slower)
        if (!hasCachedDiagram) {
          console.log('📊 [Preload] Prefetching diagram data...')
          prefetchPromises.push(
            queryClient.prefetchQuery({
              queryKey: ['diagram', owner, repo, branch],
              queryFn: async () => {
                // Check localStorage cache before making network request
                try {
                  const cacheKey = `infrara_diagram_cache_${owner}_${repo}_${branch}`
                  const cached = localStorage.getItem(cacheKey)
                  if (cached) {
                    const { data, timestamp } = JSON.parse(cached)
                    const cacheAge = Date.now() - timestamp
                    if (cacheAge < 60 * 60 * 1000) { // 1 hour
                      console.log('📊 [Preload] ✅ Found cached diagram in localStorage, using it')
                      return data
                    }
                  }
                } catch (e) {
                  // Ignore errors, continue to fetch
                }

                console.log('📊 [Preload] ❌ No cached diagram found, fetching from network')
                const response = await fetch(getApiEndpoint(`/diagram/generate/${owner}/${repo}?branch=${branch}`), {
                  headers: { 'Authorization': `Bearer ${token}` }
                })
                if (!response.ok) throw new Error(`Failed: ${response.status}`)
                
                const result = await response.json()
                
                // Cache successful result to localStorage
                try {
                  const cacheKey = `infrara_diagram_cache_${owner}_${repo}_${branch}`
                  localStorage.setItem(cacheKey, JSON.stringify({
                    data: result,
                    timestamp: Date.now()
                  }))
                  console.log('📊 [Preload] 💾 Cached diagram to localStorage')
                } catch (e) {
                  console.error('📊 [Preload] Failed to cache diagram to localStorage:', e)
                }
                
                return result
              },
            }).then(() => console.log('✅ [Preload] Diagram data prefetched'))
              .catch(err => console.log('⚠️ [Preload] Diagram prefetch failed (non-critical):', err))
          )
        } else {
          console.log('⚡ [Preload] Diagram already cached (query or localStorage), skipping')
        }

        // Run all initial prefetches in parallel
        await Promise.all(prefetchPromises)
        console.log('✅ [Preload] Initial batch complete (dashboard, drift, security, cost, diagram)')

        // Phase 2: Load infrastructure story AFTER drift completes
        // Wait for drift to finish (it's in the initial batch, so it should complete soon)
        // Check if drift data is now available
        let driftCompleted = hasCachedDrift
        if (!driftCompleted) {
          console.log('⏳ [Preload] Waiting for drift detection to complete before loading story...')
          // Wait up to 60 seconds for drift to complete
          for (let i = 0; i < 60; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000)) // Check every second
            const driftData = queryClient.getQueryData(['drift', owner, repo, branch, 'basic'])
            if (driftData) {
              driftCompleted = true
              console.log('✅ [Preload] Drift detection completed, starting infrastructure story')
              break
            }
          }
          if (!driftCompleted) {
            console.log('⚠️ [Preload] Drift detection timed out, proceeding with story anyway')
          }
        }

        // Infrastructure Story (moderate speed - 10-15s) - only after drift completes
        if (!hasCachedStory) {
          console.log('📖 [Preload] Prefetching infrastructure story (after drift completed)...')
          try {
            await queryClient.prefetchQuery({
              queryKey: ['infrastructure-story', owner, repo],
              queryFn: async ({ signal }) => {
                // Use shared state to coordinate with component
                const storyKey = `${owner}/${repo}`
                
                // Check if story request is already in progress
                if (storyInProgress.has(storyKey)) {
                  console.log('⏳ [Preload] Story request already in progress, waiting...')
                  const existingPromise = storyInProgress.get(storyKey)!
                  return existingPromise
                }

                // Add timeout to prevent hanging
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), 120000) // 2 minutes
                
                const combinedSignal = signal ? (() => {
                  const combined = new AbortController()
                  signal.addEventListener('abort', () => combined.abort())
                  controller.signal.addEventListener('abort', () => combined.abort())
                  return combined.signal
                })() : controller.signal

                // Create the story request
                const storyPromise = (async () => {
                  try {
                    const response = await fetch(getApiEndpoint(`/drift/story/${owner}/${repo}?months=6`), {
                      headers: { 'Authorization': `Bearer ${token}` },
                      signal: combinedSignal
                    })
                    clearTimeout(timeoutId)
                    if (!response.ok) throw new Error(`Failed: ${response.status}`)
                    
                    const result = await response.json()
                    
                    // Cache successful result to localStorage
                    try {
                      const cacheKey = `infrara_story_cache_${owner}_${repo}`
                      localStorage.setItem(cacheKey, JSON.stringify({
                        data: result,
                        timestamp: Date.now()
                      }))
                      console.log('📖 [Preload] 💾 Cached infrastructure story to localStorage')
                    } catch (e) {
                      console.error('📖 [Preload] Failed to cache story to localStorage:', e)
                    }
                    
                    return result
                  } catch (error: any) {
                    clearTimeout(timeoutId)
                    if (error.name === 'AbortError') {
                      throw new Error('Request timed out')
                    }
                    throw error
                    } finally {
                      // Clean up after request completes
                      storyInProgress.delete(storyKey)
                    }
                  })()

                  // Store the promise so component can wait for it
                  storyInProgress.set(storyKey, storyPromise)
                
                return storyPromise
              },
              staleTime: 10 * 60 * 1000, // 10 minutes - story doesn't change often
              retry: false, // Don't retry on 404 - fail fast for repos without infrastructure
            })
            console.log('✅ [Preload] Infrastructure story prefetched')
          } catch (err) {
            console.log('⚠️ [Preload] Story prefetch failed (non-critical):', err)
          }
        } else {
          console.log('⚡ [Preload] Story already cached, skipping')
        }

        // Phase 3: Documentation generation - LAST, after everything else completes
        // Wait for infrastructure story to complete before starting documentation
        let storyCompleted = hasCachedStory
        if (!storyCompleted) {
          console.log('⏳ [Preload] Waiting for infrastructure story to complete before loading documentation...')
          // Wait up to 2 minutes for story to complete
          for (let i = 0; i < 120; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000)) // Check every second
            const storyData = queryClient.getQueryData(['infrastructure-story', owner, repo])
            if (storyData) {
              storyCompleted = true
              console.log('✅ [Preload] Infrastructure story completed, starting documentation generation')
              break
            }
          }
          if (!storyCompleted) {
            console.log('⚠️ [Preload] Infrastructure story timed out, proceeding with documentation anyway')
          }
        }

        // Documentation generation (expensive - 30-60s, but can take up to 4 minutes)
        if (!hasCachedDocs) {
          console.log('📄 [Preload] Phase 3: Prefetching documentation (after all other preloads complete)...')
          try {
            await queryClient.prefetchQuery({
              queryKey: ['documentation', owner, repo, branch],
              queryFn: async ({ signal }) => {
                // First, check localStorage cache before making network request
                try {
                  const cacheKey = `infrara_doc_cache_${owner}_${repo}_${branch}`
                  const cached = localStorage.getItem(cacheKey)
                  if (cached) {
                    const { data, timestamp } = JSON.parse(cached)
                    const cacheAge = Date.now() - timestamp
                    if (cacheAge < 24 * 60 * 60 * 1000) { // 24 hours
                      console.log('📄 [Preload] ✅ Found cached documentation in localStorage, using it')
                      return data
                    }
                  }
                } catch (e) {
                  // Ignore errors, continue to fetch
                }

                // Use shared state to coordinate with component
                const docKey = `${owner}/${repo}/${branch}`
                
                // Check if documentation request is already in progress
                if (documentationInProgress.has(docKey)) {
                  console.log('⏳ [Preload] Documentation request already in progress, waiting...')
                  const existingPromise = documentationInProgress.get(docKey)!
                  return existingPromise
                }

                console.log('📄 [Preload] ❌ No cached documentation found, fetching from network')

                // Add timeout - documentation can take 30-60s, but allow up to 4 minutes
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), 240000) // 4 minutes
                
                const combinedSignal = signal ? (() => {
                  const combined = new AbortController()
                  signal.addEventListener('abort', () => combined.abort())
                  controller.signal.addEventListener('abort', () => combined.abort())
                  return combined.signal
                })() : controller.signal

                // Create the documentation request
                const docPromise = (async () => {
                  try {
                    const response = await fetch(getApiEndpoint(`/documentation/generate/${owner}/${repo}?branch=${branch}`), {
                      headers: { 'Authorization': `Bearer ${token}` },
                      signal: combinedSignal
                    })
                    clearTimeout(timeoutId)
                    if (!response.ok) throw new Error(`Failed: ${response.status}`)
                    
                    const result = await response.json()
                    
                    // Cache successful result to localStorage
                    try {
                      const cacheKey = `infrara_doc_cache_${owner}_${repo}_${branch}`
                      localStorage.setItem(cacheKey, JSON.stringify({
                        data: result,
                        timestamp: Date.now()
                      }))
                      console.log('📄 [Preload] 💾 Cached documentation to localStorage')
                    } catch (e) {
                      console.error('📄 [Preload] Failed to cache documentation to localStorage:', e)
                    }
                    
                    return result
                  } catch (error: any) {
                    clearTimeout(timeoutId)
                    if (error.name === 'AbortError') {
                      throw new Error('Request timed out')
                    }
                    throw error
                  } finally {
                    // Clean up after request completes
                    documentationInProgress.delete(docKey)
                  }
                })()

                // Store the promise so component can wait for it
                documentationInProgress.set(docKey, docPromise)
                
                return docPromise
              },
              staleTime: 10 * 60 * 1000, // 10 minutes - docs are expensive to generate
              retry: false, // Don't retry on 404 - fail fast for repos without infrastructure
            })
            console.log('✅ [Preload] Documentation prefetched')
          } catch (err) {
            console.log('⚠️ [Preload] Documentation prefetch failed (non-critical):', err)
          }
        } else {
          console.log('⚡ [Preload] Documentation already cached')
        }

        console.log('🎉 [Preload] All background preload complete for', repoKey)
        preloadedRepoRef.current = repoKey
      } catch (error) {
        console.error('[Preload] Error during preload:', error)
      } finally {
        preloadInProgressRef.current = false
      }
    }

    // Start preload immediately - no delay
    preloadSequence()

  }, [selectedRepo, token, queryClient])
}

