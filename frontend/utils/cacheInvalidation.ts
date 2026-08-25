import { QueryClient } from '@tanstack/react-query'

/**
 * Invalidates all TanStack Query caches and localStorage caches for a given repository.
 * This should be called whenever repository files are edited, created, or deleted.
 * 
 * NOTE: This is a team workspace-only feature. Caches are only invalidated when
 * working in a team workspace context.
 * 
 * @param queryClient - The TanStack Query client instance
 * @param owner - Repository owner (e.g., "username")
 * @param repo - Repository name (e.g., "my-repo")
 * @param branch - Optional branch name (defaults to 'main')
 * @param isTeamWorkspace - Whether the user is currently in a team workspace (defaults to false)
 */
export function invalidateRepoCaches(
  queryClient: QueryClient,
  owner: string,
  repo: string,
  branch: string = 'main',
  isTeamWorkspace: boolean = false
): void {
  // Only invalidate caches in team workspaces
  if (!isTeamWorkspace) {
    console.log('🔄 [Cache] Skipping cache invalidation - not in team workspace')
    return
  }

  console.log('🔄 [Cache] Invalidating all caches for team workspace:', { owner, repo, branch })

  // Invalidate TanStack Query caches
  // Dashboard data
  queryClient.invalidateQueries({ queryKey: ['dashboard', owner, repo] })
  
  // Drift detection (both basic and enhanced)
  queryClient.invalidateQueries({ queryKey: ['drift', owner, repo, branch, 'basic'] })
  queryClient.invalidateQueries({ queryKey: ['drift', owner, repo, branch, 'enhanced'] })
  // Also invalidate any drift queries without specifying basic/enhanced
  queryClient.invalidateQueries({ queryKey: ['drift', owner, repo] })
  
  // Security scan
  queryClient.invalidateQueries({ queryKey: ['security', 'scan', owner, repo] })
  
  // Cost estimate
  queryClient.invalidateQueries({ queryKey: ['cost', 'estimate', owner, repo] })
  
  // Diagram data
  queryClient.invalidateQueries({ queryKey: ['diagram', owner, repo, branch] })
  
  // Documentation data
  queryClient.invalidateQueries({ queryKey: ['documentation', owner, repo, branch] })
  
  // Cortex insights
  queryClient.invalidateQueries({ queryKey: ['cortex', 'insights', owner, repo, branch] })
  
  // Infrastructure story
  queryClient.invalidateQueries({ queryKey: ['infrastructure-story', owner, repo] })

  // Clear localStorage caches
  try {
    // Dashboard cache
    localStorage.removeItem(`infrara_dashboard_cache_${owner}_${repo}`)
    
    // Drift caches (both basic and enhanced)
    localStorage.removeItem(`infrara_drift_cache_${owner}_${repo}_${branch}_basic`)
    localStorage.removeItem(`infrara_drift_cache_${owner}_${repo}_${branch}_enhanced`)
    
    // Security scan cache
    localStorage.removeItem(`infrara_security_cache_${owner}_${repo}`)
    
    // Cost estimate cache
    localStorage.removeItem(`infrara_cost_cache_${owner}_${repo}`)
    
    // Diagram cache
    localStorage.removeItem(`infrara_diagram_cache_${owner}_${repo}_${branch}`)
    
    // Documentation cache
    localStorage.removeItem(`infrara_documentation_cache_${owner}_${repo}_${branch}`)
    
    // Cortex insights cache
    localStorage.removeItem(`driftbox_cortex_${owner}_${repo}_${branch}`)
    
    console.log('🔄 [Cache] ✅ Cleared all localStorage caches for repo')
  } catch (error) {
    console.warn('🔄 [Cache] ⚠️ Failed to clear some localStorage caches:', error)
  }

  console.log('🔄 [Cache] ✅ Cache invalidation complete')
}

