'use client'

import { createContext, useContext, ReactNode } from 'react'

interface IDETopBarContextType {
  onToggleChat?: () => void
  onToggleSidebar?: () => void
  onToggleTerminal?: () => void
  onRepoSelect?: (repo: { id: number; name: string; full_name: string } | null) => void
  onNavigatePrevious?: () => void
  onNavigateNext?: () => void
  canNavigatePrevious?: boolean
  canNavigateNext?: boolean
  onOpenSearchRef?: React.MutableRefObject<(() => void) | null>
  onRepoCreated?: (repoName: string, repoFullName: string) => void
  onRefreshReposRef?: React.MutableRefObject<(() => Promise<any[] | undefined>) | null>
  currentTeamId?: string | null
  teamRepos?: string[]
  selectedRepoFromParent?: { id: number; name: string; full_name: string; default_branch?: string } | null
}

const IDETopBarContext = createContext<IDETopBarContextType>({})

export function IDETopBarProvider({ children, value }: { children: ReactNode; value: IDETopBarContextType }) {
  return <IDETopBarContext.Provider value={value}>{children}</IDETopBarContext.Provider>
}

export function useIDETopBar() {
  return useContext(IDETopBarContext)
}
