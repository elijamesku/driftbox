/**
 * IDE State Persistence utilities
 * Handles saving and restoring IDE state to/from sessionStorage
 */

// ========== Types ==========

export interface IDEState {
  repo: {
    id: number
    name: string
    full_name: string
    default_branch?: string
  } | null
  file: any
  sidebarOpen: boolean
  currentTeamId: string | null
  teamRepos: string[]
  timestamp: number
}

export interface IDEStateSetters {
  setSelectedRepo: (repo: IDEState['repo']) => void
  setSelectedFile: (file: any) => void
  setIsSidebarOpen: (open: boolean) => void
  setCurrentTeamId: (id: string | null) => void
  setTeamRepoNames: (repos: string[]) => void
}

// ========== Constants ==========

const IDE_STATE_KEY = 'ide_state_backup'
const RESTORE_FLAG_KEY = 'restore_ide_state'

// ========== Functions ==========

/**
 * Save IDE state to sessionStorage
 */
export function saveIDEState(state: Partial<IDEState>): void {
  if (!state.repo && !state.file) return
  
  const ideState: IDEState = {
    repo: state.repo || null,
    file: state.file || null,
    sidebarOpen: state.sidebarOpen ?? true,
    currentTeamId: state.currentTeamId || null,
    teamRepos: state.teamRepos || [],
    timestamp: Date.now()
  }
  
  sessionStorage.setItem(IDE_STATE_KEY, JSON.stringify(ideState))
}

/**
 * Get saved IDE state from sessionStorage
 */
export function getSavedIDEState(): IDEState | null {
  const saved = sessionStorage.getItem(IDE_STATE_KEY)
  if (!saved) return null
  
  try {
    return JSON.parse(saved) as IDEState
  } catch {
    return null
  }
}

/**
 * Check if we should restore IDE state
 */
export function shouldRestoreState(): boolean {
  return sessionStorage.getItem(RESTORE_FLAG_KEY) === 'true'
}

/**
 * Clear the restore flag
 */
export function clearRestoreFlag(): void {
  sessionStorage.removeItem(RESTORE_FLAG_KEY)
}

/**
 * Set the restore flag (call before navigating away)
 */
export function setRestoreFlag(): void {
  sessionStorage.setItem(RESTORE_FLAG_KEY, 'true')
}

/**
 * Restore IDE state with proper sequencing
 * Returns a cleanup function to clear the restoring flag
 */
export function restoreIDEState(
  setters: IDEStateSetters,
  isRestoringRef: React.MutableRefObject<boolean>
): void {
  if (!shouldRestoreState()) return
  
  const state = getSavedIDEState()
  if (!state) {
    isRestoringRef.current = false
    clearRestoreFlag()
    return
  }
  
  try {
    // Set restoring flag to prevent interference from other effects
    isRestoringRef.current = true
    
    // Restore team workspace state FIRST (before repo, so team repos filter works correctly)
    if (state.currentTeamId) {
      setters.setCurrentTeamId(state.currentTeamId)
      console.log('✅ Restored team workspace:', state.currentTeamId)
    }
    if (state.teamRepos && state.teamRepos.length > 0) {
      setters.setTeamRepoNames(state.teamRepos)
      console.log('✅ Restored team repos:', state.teamRepos.length, 'repositories')
    }
    
    // Restore sidebar state
    if (state.sidebarOpen !== undefined) {
      setters.setIsSidebarOpen(state.sidebarOpen)
    }
    
    // Restore repo AFTER team workspace is set (use delay to ensure team workspace state is set)
    if (state.repo) {
      setTimeout(() => {
        setters.setSelectedRepo(state.repo)
        console.log('✅ Restored repo:', state.repo?.full_name)
        
        // Restore file AFTER repo is set (filetree needs repo to be set first)
        if (state.file) {
          setTimeout(() => {
            setters.setSelectedFile(state.file)
            console.log('✅ Restored file:', state.file?.path)
            isRestoringRef.current = false
          }, 150)
        } else {
          isRestoringRef.current = false
        }
      }, 100)
    } else if (state.file) {
      // If no repo but there's a file, restore file immediately
      setters.setSelectedFile(state.file)
      console.log('✅ Restored file:', state.file?.path)
      isRestoringRef.current = false
    } else {
      isRestoringRef.current = false
    }
  } catch (e) {
    console.error('Failed to restore IDE state:', e)
    isRestoringRef.current = false
  }
  
  clearRestoreFlag()
}
