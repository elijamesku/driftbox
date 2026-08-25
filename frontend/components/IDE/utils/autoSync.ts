/**
 * Auto-Sync utilities for IDE
 * Handles automatic syncing with GitHub for desktop app
 */

// ========== Types ==========

export interface SyncedEventData {
  owner: string
  repo: string
  commitsBehind?: number
}

export interface BehindEventData {
  owner: string
  repo: string
  commitsBehind: number
  hasLocalChanges: boolean
  message: string
}

export interface AutoSyncRefs {
  reloadOpenTabsRef: React.MutableRefObject<(() => Promise<void>) | null>
  refreshFileTreeRef: React.MutableRefObject<(() => void) | null>
  refreshGitStatusRef: React.MutableRefObject<(() => void) | null>
}

// ========== Functions ==========

/**
 * Get the Electron API if available
 */
export function getElectronAPI(): any | null {
  if (typeof window === 'undefined') return null
  return (window as any).electronAPI || null
}

/**
 * Check if running in desktop mode with auto-sync support
 */
export function isAutoSyncAvailable(): boolean {
  const api = getElectronAPI()
  return api?.isDesktop && api?.startAutoSync
}

/**
 * Start auto-sync for a repository
 */
export function startAutoSync(
  owner: string,
  repo: string,
  isTeamWorkspace: boolean
): void {
  const api = getElectronAPI()
  if (!api?.startAutoSync) return
  
  console.log(`👀 [AutoSync] Starting watch for ${owner}/${repo} (team: ${isTeamWorkspace})`)
  api.startAutoSync(owner, repo, isTeamWorkspace)
}

/**
 * Stop auto-sync
 */
export function stopAutoSync(): void {
  const api = getElectronAPI()
  api?.stopAutoSync?.()
  console.log('🛑 [AutoSync] Stopping watch')
}

/**
 * Create a handler for repo synced events
 */
export function createSyncedHandler(
  setCommitsBehind: (n: number) => void,
  refs: AutoSyncRefs
): (data: SyncedEventData) => void {
  return (data: SyncedEventData) => {
    console.log(`🔄 [AutoSync] Repo synced: ${data.owner}/${data.repo} (${data.commitsBehind || 0} commits)`)
    // Clear behind indicator since we're now synced
    setCommitsBehind(0)
    // Small delay to ensure files are fully written
    setTimeout(async () => {
      // Reload open tabs with fresh content from disk
      if (refs.reloadOpenTabsRef.current) {
        console.log('🔄 [AutoSync] Reloading open tabs...')
        await refs.reloadOpenTabsRef.current()
      }
      // Refresh file tree to show new/deleted files
      if (refs.refreshFileTreeRef.current) {
        refs.refreshFileTreeRef.current()
      }
      // Refresh git status
      if (refs.refreshGitStatusRef.current) {
        refs.refreshGitStatusRef.current()
      }
    }, 100)
  }
}

/**
 * Create a handler for repo behind events
 */
export function createBehindHandler(
  setCommitsBehind: (n: number) => void
): (data: BehindEventData) => void {
  return (data: BehindEventData) => {
    console.log(`⚠️ [AutoSync] Repo behind: ${data.owner}/${data.repo} - ${data.message}`)
    setCommitsBehind(data.commitsBehind)
  }
}

/**
 * Register auto-sync event listeners
 */
export function registerAutoSyncListeners(
  autoSyncListenerRef: React.MutableRefObject<((data: any) => void) | null>,
  autoBehindListenerRef: React.MutableRefObject<((data: any) => void) | null>,
  setCommitsBehind: (n: number) => void,
  refs: AutoSyncRefs
): void {
  const api = getElectronAPI()
  if (!api) return
  
  // Listen for sync events (only set once)
  if (!autoSyncListenerRef.current && api.onRepoSynced) {
    autoSyncListenerRef.current = createSyncedHandler(setCommitsBehind, refs)
    api.onRepoSynced(autoSyncListenerRef.current)
  }
  
  // Listen for "behind" events (when we can't auto-pull due to local changes)
  if (!autoBehindListenerRef.current && api.onRepoBehind) {
    autoBehindListenerRef.current = createBehindHandler(setCommitsBehind)
    api.onRepoBehind(autoBehindListenerRef.current)
  }
}
