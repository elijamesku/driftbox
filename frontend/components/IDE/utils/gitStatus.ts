/**
 * Git Status utilities for IDE
 * Handles checking and managing git status state
 */

import { getGitStatus } from '@/utils/desktopBridge'

// ========== Types ==========

export interface GitStatusState {
  branch?: string
  hasChanges?: boolean
  stagedCount?: number
  modifiedCount?: number
  untrackedCount?: number
  deletedCount?: number
  stagedFiles?: string[]
  stagedAddedFiles?: string[]
  stagedModifiedFiles?: string[]
  modifiedFiles?: string[]
  untrackedFiles?: string[]
  deletedFiles?: string[]
}

export interface RepoInfo {
  id: number
  name: string
  full_name: string
  default_branch?: string
}

export interface GitStatusRefs {
  gitStatusCheckInProgressRef: React.MutableRefObject<boolean>
  lastGitStatusCheckRef: React.MutableRefObject<number>
  previousHasChangesRef: React.MutableRefObject<boolean | null>
  resetOriginalContentRef: React.MutableRefObject<(() => void) | null>
}

// ========== Functions ==========

/**
 * Check git status for a repository
 * Handles debouncing and concurrent call prevention
 */
export async function checkGitStatus(
  repo: RepoInfo | null,
  refs: GitStatusRefs,
  setGitStatus: (status: GitStatusState | null) => void
): Promise<void> {
  if (!repo) {
    setGitStatus(null)
    return
  }

  // Prevent concurrent calls only - no debounce for instant feel
  const now = Date.now()
  if (refs.gitStatusCheckInProgressRef.current) {
    return
  }

  // Minimal debounce: only prevent spam (< 50ms)
  if (refs.lastGitStatusCheckRef.current > 0 && now - refs.lastGitStatusCheckRef.current < 50) {
    return
  }

  refs.gitStatusCheckInProgressRef.current = true
  refs.lastGitStatusCheckRef.current = now

  try {
    // Handle repo name format - could be "owner/repo" or just "repo name"
    let owner: string
    let repoName: string
    
    if (repo.full_name.includes('/')) {
      [owner, repoName] = repo.full_name.split('/')
    } else {
      // If no slash, assume it's just the repo name and use a default owner
      // Or use the repo name as both (for local repos)
      owner = repo.name || repo.full_name
      repoName = repo.full_name
    }
    
    if (!owner || !repoName) {
      console.warn('Invalid repo format:', repo.full_name)
      refs.gitStatusCheckInProgressRef.current = false
      return
    }
    
    console.log('📊 [GitStatus] Checking git status for:', { owner, repo: repoName, full_name: repo.full_name })
    const status = await getGitStatus(owner, repoName)
    
    if (status.success) {
      // Detect when changes go from "has changes" to "no changes" (after commit/push)
      const hadChangesBefore = refs.previousHasChangesRef.current
      const hasChangesNow = status.hasChanges ?? false
      
      // If we had changes before and now we don't, files were committed/pushed
      if (hadChangesBefore === true && hasChangesNow === false) {
        console.log('📊 [GitStatus] Git status changed: had changes → no changes (commit/push detected)')
        // Reset originalContent for all tabs to reflect new committed state
        if (refs.resetOriginalContentRef.current) {
          refs.resetOriginalContentRef.current()
        }
      }
      
      refs.previousHasChangesRef.current = hasChangesNow
      
      setGitStatus({
        branch: status.branch,
        hasChanges: status.hasChanges,
        stagedCount: status.stagedCount,
        modifiedCount: status.modifiedCount,
        untrackedCount: status.untrackedCount,
        deletedCount: status.deletedCount,
        stagedFiles: status.stagedFiles,
        stagedAddedFiles: status.stagedAddedFiles,
        stagedModifiedFiles: status.stagedModifiedFiles,
        modifiedFiles: status.modifiedFiles,
        untrackedFiles: status.untrackedFiles,
        deletedFiles: status.deletedFiles
      })
    } else {
      setGitStatus(null)
      refs.previousHasChangesRef.current = null
    }
  } catch (error) {
    console.error('Failed to check git status:', error)
    setGitStatus(null)
  } finally {
    refs.gitStatusCheckInProgressRef.current = false
  }
}

/**
 * Send GitHub token to Electron for git authentication
 */
export function sendGitHubTokenToElectron(githubToken: string | null): void {
  if (!githubToken || typeof window === 'undefined') return
  
  const electronAPI = (window as any).electronAPI
  if (electronAPI?.setGitHubToken) {
    console.log('🔑 [GitStatus] Sending GitHub token to Electron for git authentication')
    electronAPI.setGitHubToken(githubToken).catch((error: any) => {
      // Only log if it's not the "no handler" error (means app needs restart)
      if (!error?.message?.includes('No handler registered')) {
        console.warn('⚠️ [GitStatus] Failed to send GitHub token to Electron:', error)
      } else {
        // Handler not registered - app needs restart, but don't spam console
        console.debug('🔑 [GitStatus] GitHub token handler not yet registered (Electron app may need restart)')
      }
      // This is non-critical - git commands will just prompt for auth if needed
    })
  } else if (electronAPI) {
    // Desktop mode but handler not available - likely needs restart
    console.debug('🔑 [GitStatus] setGitHubToken not available - Electron app may need restart')
  }
}
