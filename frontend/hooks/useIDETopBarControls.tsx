'use client'

import { useState, useEffect } from 'react'

interface IDETopBarControls {
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

let ideControls: IDETopBarControls = {}
let listeners: Set<() => void> = new Set()

export function setIDETopBarControls(controls: IDETopBarControls) {
  ideControls = controls
  // Trigger re-render for any components using this
  listeners.forEach(listener => listener())
}

export function getIDETopBarControls(): IDETopBarControls {
  return ideControls
}

export function useIDETopBarControls() {
  const [controls, setControls] = useState<IDETopBarControls>(ideControls)

  useEffect(() => {
    const listener = () => {
      setControls({ ...ideControls })
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  return controls
}
