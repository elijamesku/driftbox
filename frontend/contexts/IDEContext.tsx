'use client'

import { createContext, useContext, useState, useCallback, useEffect, useMemo, ReactNode } from 'react'

// ========== Types ==========

export interface RepoInfo {
  id: number
  name: string
  full_name: string
  default_branch?: string
}

export interface FileInfo {
  name: string
  path: string
  type: 'file' | 'folder'
  owner?: string
  repo?: string
  sha?: string
  line?: number
}

interface IDEState {
  // Repository state
  selectedRepo: RepoInfo | null
  selectedFile: FileInfo | null
  
  // Team workspace state
  currentTeamId: string | null
  teamRepoNames: string[]
  
  // UI state
  isSidebarOpen: boolean
  isChatOpen: boolean
  isTerminalOpen: boolean
  sidebarTab: string
}

interface IDEContextValue extends IDEState {
  // Repository actions
  setSelectedRepo: (repo: RepoInfo | null) => void
  setSelectedFile: (file: FileInfo | null) => void
  
  // Team workspace actions
  setCurrentTeamId: (teamId: string | null) => void
  setTeamRepoNames: (repos: string[]) => void
  enterTeamWorkspace: (teamId: string, repos: string[]) => void
  exitTeamWorkspace: () => void
  
  // UI actions
  setIsSidebarOpen: (open: boolean) => void
  setIsChatOpen: (open: boolean) => void
  setIsTerminalOpen: (open: boolean) => void
  setSidebarTab: (tab: string) => void
  toggleSidebar: () => void
  toggleChat: () => void
  toggleTerminal: () => void
}

// ========== Storage Keys ==========

const STORAGE_KEY = 'ide_context_state'

// ========== Default State ==========

const defaultState: IDEState = {
  selectedRepo: null,
  selectedFile: null,
  currentTeamId: null,
  teamRepoNames: [],
  isSidebarOpen: true,
  isChatOpen: true,
  isTerminalOpen: false,
  sidebarTab: 'explorer'
}

// ========== Context ==========

const IDEContext = createContext<IDEContextValue | null>(null)

// ========== Provider ==========

export function IDEProvider({ children }: { children: ReactNode }) {
  // Initialize state from sessionStorage or defaults
  const [state, setState] = useState<IDEState>(() => {
    if (typeof window === 'undefined') return defaultState
    
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        return { ...defaultState, ...parsed }
      }
    } catch (e) {
      console.error('Failed to restore IDE state:', e)
    }
    return defaultState
  })

  // Persist state to sessionStorage on changes
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (e) {
      console.error('Failed to save IDE state:', e)
    }
  }, [state])

  // ========== Repository Actions ==========
  
  const setSelectedRepo = useCallback((repo: RepoInfo | null) => {
    setState(prev => ({ ...prev, selectedRepo: repo }))
  }, [])

  const setSelectedFile = useCallback((file: FileInfo | null) => {
    setState(prev => ({ ...prev, selectedFile: file }))
  }, [])

  // ========== Team Workspace Actions ==========
  
  const setCurrentTeamId = useCallback((teamId: string | null) => {
    setState(prev => ({ ...prev, currentTeamId: teamId }))
  }, [])

  const setTeamRepoNames = useCallback((repos: string[]) => {
    setState(prev => ({ ...prev, teamRepoNames: repos }))
  }, [])

  const enterTeamWorkspace = useCallback((teamId: string, repos: string[]) => {
    setState(prev => {
      // Clear repo if not in team
      const shouldClearRepo = prev.selectedRepo && !repos.includes(prev.selectedRepo.full_name)
      return {
        ...prev,
        currentTeamId: teamId,
        teamRepoNames: repos,
        selectedRepo: shouldClearRepo ? null : prev.selectedRepo,
        selectedFile: shouldClearRepo ? null : prev.selectedFile
      }
    })
  }, [])

  const exitTeamWorkspace = useCallback(() => {
    setState(prev => ({
      ...prev,
      currentTeamId: null,
      teamRepoNames: []
    }))
  }, [])

  // ========== UI Actions ==========
  
  const setIsSidebarOpen = useCallback((open: boolean) => {
    setState(prev => ({ ...prev, isSidebarOpen: open }))
  }, [])

  const setIsChatOpen = useCallback((open: boolean) => {
    setState(prev => ({ ...prev, isChatOpen: open }))
  }, [])

  const setIsTerminalOpen = useCallback((open: boolean) => {
    setState(prev => ({ ...prev, isTerminalOpen: open }))
  }, [])

  const setSidebarTab = useCallback((tab: string) => {
    setState(prev => ({ ...prev, sidebarTab: tab }))
  }, [])

  const toggleSidebar = useCallback(() => {
    setState(prev => ({ ...prev, isSidebarOpen: !prev.isSidebarOpen }))
  }, [])

  const toggleChat = useCallback(() => {
    setState(prev => ({ ...prev, isChatOpen: !prev.isChatOpen }))
  }, [])

  const toggleTerminal = useCallback(() => {
    setState(prev => ({ ...prev, isTerminalOpen: !prev.isTerminalOpen }))
  }, [])

  // ========== Memoized Context Value ==========
  
  const value = useMemo<IDEContextValue>(() => ({
    // State
    selectedRepo: state.selectedRepo,
    selectedFile: state.selectedFile,
    currentTeamId: state.currentTeamId,
    teamRepoNames: state.teamRepoNames,
    isSidebarOpen: state.isSidebarOpen,
    isChatOpen: state.isChatOpen,
    isTerminalOpen: state.isTerminalOpen,
    sidebarTab: state.sidebarTab,
    
    // Actions
    setSelectedRepo,
    setSelectedFile,
    setCurrentTeamId,
    setTeamRepoNames,
    enterTeamWorkspace,
    exitTeamWorkspace,
    setIsSidebarOpen,
    setIsChatOpen,
    setIsTerminalOpen,
    setSidebarTab,
    toggleSidebar,
    toggleChat,
    toggleTerminal
  }), [
    state,
    setSelectedRepo,
    setSelectedFile,
    setCurrentTeamId,
    setTeamRepoNames,
    enterTeamWorkspace,
    exitTeamWorkspace,
    setIsSidebarOpen,
    setIsChatOpen,
    setIsTerminalOpen,
    setSidebarTab,
    toggleSidebar,
    toggleChat,
    toggleTerminal
  ])

  return (
    <IDEContext.Provider value={value}>
      {children}
    </IDEContext.Provider>
  )
}

// ========== Hook ==========

export function useIDE() {
  const context = useContext(IDEContext)
  if (!context) {
    throw new Error('useIDE must be used within an IDEProvider')
  }
  return context
}

// ========== Selector Hooks (for performance) ==========

/** Use only selectedRepo - won't re-render when other state changes */
export function useSelectedRepo() {
  const { selectedRepo, setSelectedRepo } = useIDE()
  return { selectedRepo, setSelectedRepo }
}

/** Use only selectedFile - won't re-render when other state changes */
export function useSelectedFile() {
  const { selectedFile, setSelectedFile } = useIDE()
  return { selectedFile, setSelectedFile }
}

/** Use only team workspace state */
export function useTeamWorkspace() {
  const { currentTeamId, teamRepoNames, setCurrentTeamId, setTeamRepoNames, enterTeamWorkspace, exitTeamWorkspace } = useIDE()
  return { currentTeamId, teamRepoNames, setCurrentTeamId, setTeamRepoNames, enterTeamWorkspace, exitTeamWorkspace }
}

/** Use only UI state */
export function useIDEUI() {
  const { 
    isSidebarOpen, isChatOpen, isTerminalOpen, sidebarTab,
    setIsSidebarOpen, setIsChatOpen, setIsTerminalOpen, setSidebarTab,
    toggleSidebar, toggleChat, toggleTerminal
  } = useIDE()
  return { 
    isSidebarOpen, isChatOpen, isTerminalOpen, sidebarTab,
    setIsSidebarOpen, setIsChatOpen, setIsTerminalOpen, setSidebarTab,
    toggleSidebar, toggleChat, toggleTerminal
  }
}
