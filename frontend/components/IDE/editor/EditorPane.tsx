'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useAuth, useGitHub } from '@/contexts'
import WelcomeScreen from '../swag/WelcomeScreen'
import { fetchGitHubFile } from '@/utils/apiClient'
import { isDesktop, applyFileProposal, getWorkspacePath, readFile } from '@/utils/desktopBridge'
import { FileIcon } from '../swag/FileIcon'
import TerraformToPulumiModal from '../modals/TerraformToPulumiModal'
import ResourceDefinition from './ResourceDefinition'
import ResourceAnalysis from './ResourceAnalysis'
import { getApiEndpoint } from '@/utils/apiEndpoint'

// Dynamically import Monaco Editor (client-side only)
const MonacoEditor = dynamic(() => import('./MonacoEditor'), { 
  ssr: false,
  loading: () => null // No loading state - instant with caching
})

interface Tab {
  id: string
  name: string
  content: string
  isDirty: boolean
  language: string
  path: string
  isDiffMode?: boolean
  originalContent?: string
  proposedContent?: string
  targetLine?: number // Line number to navigate to when opening the file
}

// Remote cursor type for live collaboration
interface RemoteCursor {
  userId: string
  userName: string
  line: number
  column: number
  color: string
}

interface EditorPaneProps {
  selectedFile?: any
  fileProposal?: any
  fileProposals?: any[]
  proposalStates?: Record<string, 'pending' | 'accepted' | 'rejected'>
  selectedRepo?: any
  onProposalHandled?: (accepted: boolean, proposalPath?: string) => void
  onAcceptAll?: () => Promise<void>
  deletedFilePath?: string | null
  onNavigationChange?: (canPrev: boolean, canNext: boolean, onPrev: () => void, onNext: () => void) => void
  onAgentMode?: () => void
  onPRShortcut?: () => void // New callback for PR shortcut
  onSaveAllTabsRef?: React.MutableRefObject<(() => Promise<void>) | null> // Ref to expose save all function
  onReloadOpenTabsRef?: React.MutableRefObject<(() => Promise<void>) | null> // Ref to reload all tabs from disk
  onRefreshFileTree?: () => void
  onRefreshGitStatusRef?: React.MutableRefObject<(() => void) | null>
  onResetOriginalContentRef?: React.MutableRefObject<(() => void) | null>
  onGetEditorContent?: (filePath: string) => Promise<string | null> // Callback to get current editor content
  onCursorPositionChange?: (line: number, column: number, filePath?: string) => void
  onLanguageChange?: (language: string) => void
  onDiagnosticsChange?: (errors: number, warnings: number) => void
  onActiveFileChange?: (filePath: string | null) => void
  gitStatus?: {
    stagedFiles?: string[]
    stagedAddedFiles?: string[] // Staged new files (status "A")
    stagedModifiedFiles?: string[] // Staged modified files (status "M")
    modifiedFiles?: string[]
    untrackedFiles?: string[]
    deletedFiles?: string[]
  } | null
  // Real-time collaboration props
  remoteCursors?: RemoteCursor[]
  remoteTextChanges?: {
    userId: string
    userName: string
    repo: string
    filePath: string
    fullContent: string
  } | null
  onLocalTextChange?: (filePath: string, fullContent: string) => void
  onAgentFilesAccepted?: (files: Array<{ path: string; content: string; action: 'created' | 'updated' }>) => void
  onAgentFilesDiscarded?: (files: Array<{ path: string; action: 'created' | 'updated' }>) => void
  // File locking for PR creation
  isFileLocked?: (filePath: string) => { file_path: string; locked_by: string; locked_by_name: string; reason: string } | null
}

export default function EditorPane({ selectedFile, fileProposal, fileProposals = [], proposalStates = {}, selectedRepo, onProposalHandled, onAcceptAll, deletedFilePath, onNavigationChange, onAgentMode, onPRShortcut, onSaveAllTabsRef, onReloadOpenTabsRef, onRefreshFileTree, onRefreshGitStatusRef, onResetOriginalContentRef, onGetEditorContent, onCursorPositionChange, onLanguageChange, onDiagnosticsChange, onActiveFileChange, gitStatus, remoteCursors = [], remoteTextChanges, onLocalTextChange, onAgentFilesAccepted, onAgentFilesDiscarded, isFileLocked }: EditorPaneProps) {
  const { token } = useAuth()
  const { githubToken } = useGitHub()
  const [tabs, setTabs] = useState<Tab[]>([])
  const [leftTab, setLeftTab] = useState<string | null>(null) // Tab ID for left pane
  const isApplyingRemoteRef = useRef(false) // Flag to prevent echo when applying remote changes
  const [showDefinition, setShowDefinition] = useState<string | null>(null) // Resource type to show definition for
  
  // Resource analysis state
  const [resourceAnalysis, setResourceAnalysis] = useState<{
    type: 'cost' | 'security' | 'dependencies'
    resourceType: string
    resourceName: string
    resourceBlock: string
  } | null>(null)

  // Apply remote full content sync
  useEffect(() => {
    if (!remoteTextChanges) return
    
    const { repo, filePath, fullContent } = remoteTextChanges
    
    // Only apply changes if they're for the currently selected repo
    // This prevents cross-repo content overwrites when files have the same name
    if (repo !== selectedRepo?.full_name) {
      console.log(`[EditorPane] Ignoring remote text change for different repo: ${repo} vs ${selectedRepo?.full_name}`)
      return
    }
    
    // Set flag to prevent echoing back
    isApplyingRemoteRef.current = true
    
    // Update the tab content directly
    setTabs(prevTabs => prevTabs.map(tab => {
      if (tab.path !== filePath) return tab
      // Only update if content is different
      if (tab.content === fullContent) return tab
      return { ...tab, content: fullContent }
    }))
    
    // Reset flag after a tick
    setTimeout(() => {
      isApplyingRemoteRef.current = false
    }, 100)
  }, [remoteTextChanges, selectedRepo?.full_name])

  // Helper to get git status for a file (VS Code style indicators)
  const getFileGitStatus = (filePath: string): 'added' | 'modified' | 'deleted' | null => {
    if (!gitStatus || !selectedRepo) return null
    
    // Normalize file path - remove owner/repo prefix if present, convert to forward slashes
    const [owner, repo] = selectedRepo.full_name.split('/')
    let normalizedPath = filePath.replace(/\\/g, '/') // Normalize to forward slashes
    if (normalizedPath.startsWith(`${owner}/${repo}/`)) {
      normalizedPath = normalizedPath.substring(`${owner}/${repo}/`.length)
    }
    
    // Helper to check if paths match
    const pathsMatch = (gitPath: string, filePath: string): boolean => {
      const normalizedGitPath = gitPath.replace(/\\/g, '/')
      return normalizedGitPath === filePath || 
             normalizedGitPath.endsWith(`/${filePath}`) || 
             filePath.endsWith(`/${normalizedGitPath}`)
    }
    
    // Check deleted files first
    if (gitStatus.deletedFiles?.some((p: string) => pathsMatch(p, normalizedPath))) {
      return 'deleted'
    }
    
    // Check untracked files (new files) - these show green "A"
    if (gitStatus.untrackedFiles?.some(p => pathsMatch(p, normalizedPath))) {
      return 'added'
    }
    
    // Check staged added files (new files that were staged) - these show green "A"
    if (gitStatus.stagedAddedFiles?.some(p => pathsMatch(p, normalizedPath))) {
      return 'added'
    }
    
    // Check staged modified files and unstaged modified files - these show yellow "M"
    const isStagedModified = gitStatus.stagedModifiedFiles?.some(p => pathsMatch(p, normalizedPath))
    const isModified = gitStatus.modifiedFiles?.some(p => pathsMatch(p, normalizedPath))
    
    if (isStagedModified || isModified) {
      return 'modified'
    }
    
    // Fallback: if file is in stagedFiles but not in stagedAddedFiles or stagedModifiedFiles,
    // assume it's modified (for backward compatibility)
    const isStaged = gitStatus.stagedFiles?.some(p => pathsMatch(p, normalizedPath))
    if (isStaged) {
      return 'modified'
    }
    
    return null
  }
  
  // Helper to check if a file is modified in git (for backward compatibility)
  const isFileModifiedInGit = (filePath: string): boolean => {
    const status = getFileGitStatus(filePath)
    return status === 'added' || status === 'modified' || status === 'deleted'
  }
  
  // Helper function to save a file proposal (extracted from Keep button logic)
  const saveFileProposal = async (proposal: any): Promise<{ success: boolean; error?: string }> => {
    if (!selectedRepo) {
      return { success: false, error: 'No repository selected' }
    }
    
    if (!token) {
      return { success: false, error: 'Not authenticated. Please log in.' }
    }
    
    try {
      const [owner, repo] = selectedRepo.full_name.split('/')
      
      // Ensure repo is cloned first (for Electron) - only needed for file creation
      if (isDesktop && window.electronAPI) {
        const { getFileTree } = await import('@/utils/desktopBridge')
        const treeResult = await getFileTree(owner, repo, '')
        
        if (!treeResult.success) {
          if (!githubToken) {
            return { success: false, error: 'Repository not found locally. GitHub token required to clone it.' }
          }
          
          const { cloneRepository } = await import('@/utils/desktopBridge')
          const cloneResult = await cloneRepository(owner, repo, githubToken)
          if (!cloneResult.success) {
            return { success: false, error: `Failed to clone repository: ${cloneResult.error}` }
          }
        }
      }
      
      // Determine action: use proposal.action if available, otherwise check oldContent
      const action = proposal.action === 'create' || 
                     !proposal.oldContent || 
                     proposal.oldContent === '' 
                        ? 'create' : 'edit'
      
      const result = await applyFileProposal(
        owner,
        repo,
        proposal.path,
        proposal.newContent,
        token,
        action
      )
      
      if (!result.success) {
        return { success: false, error: result.error || 'Failed to save file' }
      }
      
      // Refresh git status and file tree after successful save
      if (onRefreshGitStatusRef?.current) {
        onRefreshGitStatusRef.current()
      }
      if (onRefreshFileTree) {
        onRefreshFileTree()
      }
      
      // If a .tf file was created, start background terraform init to download providers
      if (action === 'create' && proposal.path.endsWith('.tf') && window.electronAPI?.terraformInitBackground) {
        window.electronAPI.terraformInitBackground(owner, repo).then(result => {
          if (result.skipped) {
            console.log(`✅ [EditorPane] Providers already cached`)
          } else if (result.started) {
            console.log(`🔄 [EditorPane] New .tf file - background provider download started`)
          }
        })
      }
      
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message || 'Unknown error' }
    }
  }
  const [rightTab, setRightTab] = useState<string | null>(null) // Tab ID for right pane
  const [isSplit, setIsSplit] = useState(false) // Split mode enabled
  const [dividerPosition, setDividerPosition] = useState(50) // Percentage (0-100)
  const [isDragging, setIsDragging] = useState(false)
  const [focusedPane, setFocusedPane] = useState<'left' | 'right'>('left') // Which pane is focused
  const [pendingCloseTab, setPendingCloseTab] = useState<string | null>(null) // Tab ID waiting for confirmation
  const [currentFileProposal, setCurrentFileProposal] = useState<any>(null) // Store proposal for saving
  const tabsRef = useRef<Tab[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const isSplitRef = useRef<boolean>(false)
  const focusedPaneRef = useRef<'left' | 'right'>('left')
  const leftTabRef = useRef<string | null>(null)
  const rightTabRef = useRef<string | null>(null)
  const previousRepoRef = useRef<string | null>(null)

  // Terraform to Pulumi modal state
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false)
  const [currentTerraformFile, setCurrentTerraformFile] = useState<string | null>(null)
  const [showPRShortcut, setShowPRShortcut] = useState(false) // Show PR creation shortcut modal

  // Keep refs in sync with state
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    isSplitRef.current = isSplit
  }, [isSplit])

  useEffect(() => {
    focusedPaneRef.current = focusedPane
  }, [focusedPane])

  useEffect(() => {
    leftTabRef.current = leftTab
  }, [leftTab])

  useEffect(() => {
    rightTabRef.current = rightTab
  }, [rightTab])

  // Clear all tabs when repository changes
  useEffect(() => {
    const currentRepoId = selectedRepo?.id?.toString() || null
    const previousRepoId = previousRepoRef.current
    
    if (previousRepoId !== null && currentRepoId !== previousRepoId) {
      // Repository changed - clear all tabs
      console.log('Repository changed, clearing all tabs')
      setTabs([])
      setLeftTab(null)
      setRightTab(null)
      setIsSplit(false)
      setCurrentFileProposal(null)
    }
    
    previousRepoRef.current = currentRepoId
  }, [selectedRepo?.id])

  // Navigate to previous/next tab
  const navigateToPreviousTab = () => {
    const currentTabId = focusedPane === 'left' ? leftTab : rightTab
    const currentIndex = tabs.findIndex(t => t.id === currentTabId)
    if (currentIndex > 0) {
      const previousTab = tabs[currentIndex - 1]
      if (focusedPane === 'left' || !isSplit) {
        setLeftTab(previousTab.id)
      } else {
        setRightTab(previousTab.id)
      }
    }
  }

  const navigateToNextTab = () => {
    const currentTabId = focusedPane === 'left' ? leftTab : rightTab
    const currentIndex = tabs.findIndex(t => t.id === currentTabId)
    if (currentIndex < tabs.length - 1) {
      const nextTab = tabs[currentIndex + 1]
      if (focusedPane === 'left' || !isSplit) {
        setLeftTab(nextTab.id)
      } else {
        setRightTab(nextTab.id)
      }
    }
  }

  // Notify parent of navigation state changes
  useEffect(() => {
    if (onNavigationChange && tabs.length > 0) {
      const currentTabId = focusedPane === 'left' ? leftTab : rightTab
      const currentIndex = tabs.findIndex(t => t.id === currentTabId)
      const canPrev = currentIndex > 0
      const canNext = currentIndex < tabs.length - 1
      onNavigationChange(canPrev, canNext, navigateToPreviousTab, navigateToNextTab)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, leftTab, rightTab, focusedPane, isSplit])

  // Notify parent of language change and active file change when active tab changes
  useEffect(() => {
    if (tabs.length > 0) {
      const currentTabId = focusedPane === 'left' ? leftTab : rightTab
      const currentTab = tabs.find(t => t.id === currentTabId)
      if (currentTab) {
        // Notify parent of language change
        if (onLanguageChange) {
          // Map file language to display name
          const languageMap: Record<string, string> = {
            'hcl': 'Terraform',
            'typescript': 'TypeScript',
            'javascript': 'JavaScript',
            'typescriptreact': 'TypeScript JSX',
            'javascriptreact': 'JavaScript JSX',
            'json': 'JSON',
            'markdown': 'Markdown',
            'yaml': 'YAML',
            'python': 'Python',
            'go': 'Go',
            'rust': 'Rust'
          }
          const displayLanguage = languageMap[currentTab.language] || currentTab.language
          onLanguageChange(displayLanguage)
        }
        
        // Notify parent of active file change
        if (onActiveFileChange) {
          onActiveFileChange(currentTab.path)
        }
      } else if (onActiveFileChange) {
        // No active tab, notify parent
        onActiveFileChange(null)
      }
    } else if (onActiveFileChange) {
      // No tabs, notify parent
      onActiveFileChange(null)
    }
  }, [tabs, leftTab, rightTab, focusedPane, onLanguageChange, onActiveFileChange])

  // Get active tabs array for display
  const activeTabs = [leftTab, rightTab].filter(Boolean) as string[]

  // Handle file clicks from sidebar - fetch real content from GitHub
  useEffect(() => {
    if (selectedFile && selectedFile.type === 'file') {
      // Check if file is already open using ref to get latest tabs
      const existingTab = tabsRef.current.find(tab => tab.path === selectedFile.path && !tab.isDiffMode)
      if (existingTab) {
        // Show in appropriate pane FIRST - simple behavior: just switch focus
        // Use refs to get current values to avoid stale closures
        if (isSplitRef.current) {
          // In split mode, show in focused pane
          if (focusedPaneRef.current === 'left') {
            setLeftTab(existingTab.id)
          } else {
            setRightTab(existingTab.id)
          }
        } else {
          // Not in split mode - just switch focus to this file in left pane
          setLeftTab(existingTab.id)
        }
        
        // THEN update the targetLine after a brief delay to ensure editor is mounted
        if (selectedFile.line) {
          console.log(`📍 [EditorPane] Will navigate to line ${selectedFile.line} for existing tab ${existingTab.id}`)
          setTimeout(() => {
            console.log(`📍 [EditorPane] Updating targetLine for tab ${existingTab.id} to line ${selectedFile.line}`)
            setTabs(prevTabs => prevTabs.map(tab => 
              tab.id === existingTab.id 
                ? { ...tab, targetLine: selectedFile.line }
                : tab
            ))
            
            // Clear the targetLine after navigation completes
            setTimeout(() => {
              console.log(`📍 [EditorPane] Clearing targetLine for tab ${existingTab.id}`)
              setTabs(prevTabs => prevTabs.map(tab => 
                tab.id === existingTab.id 
                  ? { ...tab, targetLine: undefined }
                  : tab
              ))
            }, 1000)
          }, 100)
        }
      } else {
        // Fetch file content from GitHub (will update tabs asynchronously)
        fetchFileContent(selectedFile)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile]) // Only react to selectedFile changes - use refs/state getters for isSplit/focusedPane

  // Handle file proposals - open in diff mode (simplified, no transition state)
  // Expose callback to reset originalContent after commits/pushes
  useEffect(() => {
    if (onResetOriginalContentRef) {
      onResetOriginalContentRef.current = () => {
        console.log('🔄 [EditorPane] Resetting originalContent for all tabs after commit/push')
        // Update all tabs: set originalContent to current content (new committed state)
        setTabs(prevTabs => prevTabs.map(tab => ({
          ...tab,
          originalContent: tab.content // Reset baseline to current (committed) content
        })))
      }
    }
  }, [onResetOriginalContentRef, tabs.length]) // Re-setup when tabs change

  useEffect(() => {
    if (fileProposal) {
      console.log('📝 [EditorPane] File proposal received for display:', {
        path: fileProposal.path,
        action: fileProposal.action,
        hasOldContent: !!fileProposal.oldContent,
        oldContentLength: fileProposal.oldContent?.length || 0,
        newContentLength: fileProposal.newContent?.length || 0,
        newContentPreview: fileProposal.newContent?.substring(0, 100) || '(empty)'
      })
      
      // Check if proposal is already open using ref to get latest tabs
      const existingTab = tabsRef.current.find(tab => tab.path === fileProposal.path)
      
      // Store the proposal for later saving
      setCurrentFileProposal(fileProposal)
      console.log('📝 [EditorPane] Stored proposal in currentFileProposal state')
      
      if (existingTab && existingTab.isDiffMode) {
        console.log('📝 [EditorPane] Tab already exists in diff mode, switching focus:', existingTab.id)
        // Show in appropriate pane - simple behavior: just switch focus
        // Use refs to get current values to avoid stale closures
        if (isSplitRef.current) {
          // In split mode, show in focused pane
          if (focusedPaneRef.current === 'left') {
            setLeftTab(existingTab.id)
          } else {
            setRightTab(existingTab.id)
          }
        } else {
          // Not in split mode - just switch focus to this file in left pane
          setLeftTab(existingTab.id)
        }
      } else {
        // If there's an existing non-diff tab for this file, close it first
        if (existingTab && !existingTab.isDiffMode) {
          console.log('📝 [EditorPane] Closing existing non-diff tab to show diff:', existingTab.id)
          setTabs(prevTabs => prevTabs.filter(t => t.id !== existingTab.id))
          // Clear active pane if it was showing this tab
          if (leftTabRef.current === existingTab.id) {
            setLeftTab(null)
          }
          if (rightTabRef.current === existingTab.id) {
            setRightTab(null)
          }
        }
        
        // Create new diff tab
        console.log('📝 [EditorPane] Creating new diff tab')
        const newTab: Tab = {
          id: Date.now().toString(),
          name: fileProposal.path.split('/').pop() || fileProposal.path,
          path: fileProposal.path,
          language: getLanguage(fileProposal.path),
          isDirty: false,
          content: fileProposal.newContent,
          isDiffMode: true,
          originalContent: fileProposal.oldContent || '',
          proposedContent: fileProposal.newContent
        }
        console.log('📝 [EditorPane] New tab created:', {
          id: newTab.id,
          path: newTab.path,
          isDiffMode: newTab.isDiffMode,
          originalContentLength: newTab.originalContent?.length || 0,
          contentLength: newTab.content?.length || 0
        })
        setTabs(prevTabs => [...prevTabs, newTab])
        // Use refs to get current values to avoid stale closures
        if (isSplitRef.current) {
          if (focusedPaneRef.current === 'left') {
            setLeftTab(newTab.id)
          } else {
            setRightTab(newTab.id)
          }
        } else {
          setLeftTab(newTab.id)
        }
        console.log('📝 [EditorPane] Tab added and focused')
      }
    } else {
      console.log('📝 [EditorPane] No file proposal (fileProposal is null/undefined)')
      // Clear currentFileProposal when fileProposal is cleared (e.g., after "Keep all")
      if (currentFileProposal) {
        console.log('📝 [EditorPane] Clearing currentFileProposal since fileProposal is null')
        setCurrentFileProposal(null)
        
        // Also close all diff mode tabs to remove Keep/Undo buttons
        console.log('📝 [EditorPane] Closing all diff mode tabs')
        setTabs(prev => prev.filter(tab => !tab.isDiffMode))
        setLeftTab(null)
        setRightTab(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileProposal]) // Only react to fileProposal changes - use refs for isSplit/focusedPane

  // File content cache helpers (1 hour TTL)
  const getFileCache = (repoFullName: string, filePath: string): string | null => {
    try {
      const cacheKey = `file_cache_${repoFullName}_${filePath}`
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const { content, timestamp } = JSON.parse(cached)
        // Cache valid for 1 hour
        if (Date.now() - timestamp < 60 * 60 * 1000) {
          console.log('⚡ [EditorPane] File content from cache:', filePath)
          return content
        }
        localStorage.removeItem(cacheKey) // Expired
      }
    } catch (e) {
      // Cache read failed - proceed with fetch
    }
    return null
  }

  const setFileCache = (repoFullName: string, filePath: string, content: string) => {
    try {
      const cacheKey = `file_cache_${repoFullName}_${filePath}`
      localStorage.setItem(cacheKey, JSON.stringify({
        content,
        timestamp: Date.now()
      }))
    } catch (e) {
      // Cache write failed - not critical
    }
  }

  const fetchFileContent = useCallback(async (file: any) => {
    try {
      // CHECK CACHE FIRST for instant loading
      if (selectedRepo) {
        const cached = getFileCache(selectedRepo.full_name, file.path)
        if (cached !== null) {
          // File is cached - show IMMEDIATELY with real content
          const newTab: Tab = {
            id: Date.now().toString(),
            name: file.name,
            path: file.path,
            language: getLanguage(file.name),
            isDirty: false,
            content: cached,
            originalContent: cached
          }
          setTabs(prevTabs => {
            if (prevTabs.find(tab => tab.path === file.path)) {
              return prevTabs
            }
            return [...prevTabs, newTab]
          })
          if (isSplitRef.current) {
            if (focusedPaneRef.current === 'right') {
              setRightTab(newTab.id)
            } else {
              setLeftTab(newTab.id)
            }
          } else {
            setLeftTab(newTab.id)
          }
          return // Early return - already showing cached content
        }
      }
      
      // NOT IN CACHE - fetch from source
      // For desktop mode, try to read immediately before showing loading state
      if (isDesktop && file.owner && file.repo && file.path) {
        // Try to read file locally FIRST (usually instant)
        const result = await readFile(file.owner, file.repo, file.path)
        
        if (result.success && result.content !== undefined) {
          const fileContent = result.content
          
          // Cache immediately
          if (selectedRepo) {
            setFileCache(selectedRepo.full_name, file.path, fileContent)
          }
          
          // Show tab with real content (no loading state needed!)
          const newTab: Tab = {
            id: Date.now().toString(),
            name: file.name,
            path: file.path,
            language: getLanguage(file.name),
            isDirty: false,
            content: fileContent,
            originalContent: fileContent,
            targetLine: file.line
          }
          
          setTabs(prevTabs => {
            if (prevTabs.find(tab => tab.path === file.path)) {
              return prevTabs
            }
            return [...prevTabs, newTab]
          })
          if (isSplitRef.current) {
            if (focusedPaneRef.current === 'right') {
              setRightTab(newTab.id)
            } else {
              setLeftTab(newTab.id)
            }
          } else {
            setLeftTab(newTab.id)
          }
          
          // Clear the targetLine after navigation completes
          if (file.line) {
            setTimeout(() => {
              setTabs(prevTabs => prevTabs.map(tab => 
                tab.path === file.path 
                  ? { ...tab, targetLine: undefined }
                  : tab
              ))
            }, 500)
          }
          
          return // Success - no loading state needed!
        }
      }
      
      // FALLBACK: Show loading state only if desktop read failed or web mode
      const loadingTabId = Date.now().toString()
      const loadingTab: Tab = {
        id: loadingTabId,
        name: file.name,
        path: file.path,
        language: getLanguage(file.name),
        isDirty: false,
        content: '// Loading...',
        originalContent: ''
      }
      
      setTabs(prevTabs => {
        if (prevTabs.find(tab => tab.path === file.path)) {
          return prevTabs
        }
        return [...prevTabs, loadingTab]
      })
      if (isSplitRef.current) {
        if (focusedPaneRef.current === 'right') {
          setRightTab(loadingTab.id)
        } else {
          setLeftTab(loadingTab.id)
        }
      } else {
        setLeftTab(loadingTab.id)
      }
      
      // Fetch from GitHub API (web mode or desktop fallback)
      let content = ''
      
      if (file.url && file.type === 'file' && file.owner && file.repo && token) {
        try {
          const data = await fetchGitHubFile(file.owner, file.repo, file.path, token)
          if (data.content) {
            content = atob(data.content.replace(/\s/g, ''))
          }
        } catch (error) {
          console.error('Failed to fetch GitHub file:', error)
        }
      }

      // Update tab with fetched content
      if (content !== undefined) {
        const fileContent = content || ''
        
        if (selectedRepo) {
          setFileCache(selectedRepo.full_name, file.path, fileContent)
        }
        
        setTabs(prevTabs => {
          return prevTabs.map(tab => {
            if (tab.path === file.path && tab.id === loadingTabId) {
              return {
                ...tab,
                content: fileContent,
                originalContent: fileContent,
                targetLine: file.line
              }
            }
            return tab
          })
        })
        
        if (file.line) {
          setTimeout(() => {
            setTabs(prevTabs => prevTabs.map(tab => 
              tab.path === file.path 
                ? { ...tab, targetLine: undefined }
                : tab
            ))
          }, 500)
        }
      }
    } catch (error) {
      console.error('Failed to fetch file content:', error)
    }
  }, [selectedRepo, token, isDesktop, readFile, getFileCache, setFileCache])

  const getLanguage = (filename: string) => {
    if (filename.endsWith('.tf')) return 'hcl'
    if (filename.endsWith('.js')) return 'javascript'
    if (filename.endsWith('.ts')) return 'typescript'
    if (filename.endsWith('.tsx')) return 'typescript'
    if (filename.endsWith('.json')) return 'json'
    if (filename.endsWith('.py')) return 'python'
    if (filename.endsWith('.yaml') || filename.endsWith('.yml')) return 'yaml'
    if (filename.endsWith('.md')) return 'markdown'
    return 'text'
  }

  const closeTab = (id: string) => {
    const tab = tabs.find(t => t.id === id)
    
    // If tab is dirty, show confirmation dialog
    if (tab?.isDirty) {
      setPendingCloseTab(id)
      return
    }
    
    // Close immediately if not dirty
    doCloseTab(id)
  }

  const doCloseTab = (id: string) => {
    // Remove from tabs
    setTabs(prevTabs => prevTabs.filter(tab => tab.id !== id))
    // Remove from panes
    if (leftTab === id) {
      setLeftTab(null)
      // If split and right tab exists, move focus to right
      if (isSplit && rightTab) {
        setFocusedPane('right')
      }
    }
    if (rightTab === id) {
      setRightTab(null)
      // If split and left tab exists, move focus to left
      if (isSplit && leftTab) {
        setFocusedPane('left')
      }
      // If no left tab, disable split
      if (!leftTab) {
        setIsSplit(false)
      }
    }
    setPendingCloseTab(null)
  }

  // Close tabs when files are deleted
  useEffect(() => {
    if (deletedFilePath) {
      // Find all tabs matching the deleted file path (including nested files if it's a folder)
      const tabsToClose = tabsRef.current.filter(tab => {
        // If it's a file, match exact path
        // If it's a folder, match any file that starts with the folder path
        return tab.path === deletedFilePath || tab.path.startsWith(deletedFilePath + '/')
      })
      
      // Close all matching tabs
      tabsToClose.forEach(tab => {
        doCloseTab(tab.id)
      })
    }
  }, [deletedFilePath])

  const handleSave = async () => {
    if (!pendingCloseTab) return
    
    const tab = tabs.find(t => t.id === pendingCloseTab)
    if (!tab) return

    try {
      // DESKTOP: Use Electron IPC to write files locally (instant!)
      const { isDesktop: isElectron, writeFile } = await import('@/utils/desktopBridge')
      
      // Extract owner/repo from path if available (format: owner/repo/path/to/file)
      const pathParts = tab.path.split('/')
      if (pathParts.length >= 2) {
        const owner = pathParts[0]
        const repo = pathParts[1]
        const filePath = pathParts.slice(2).join('/')
        
        if (isElectron) {
          // Desktop: Write file locally via Electron (instant!)
          const result = await writeFile(owner, repo, filePath, tab.content)
          
          if (result.success) {
            console.log('✅ File saved locally:', filePath)
            // Mark as not dirty and update original content
            setTabs(prevTabs => prevTabs.map(t =>
              t.id === pendingCloseTab ? { ...t, isDirty: false, originalContent: t.content } : t
            ))
            // Refresh git status after file save
            if (onRefreshGitStatusRef?.current) {
              onRefreshGitStatusRef.current()
            }
          } else {
            console.error('Failed to save file:', result.error)
            // Still mark as saved locally to allow closing
            setTabs(prevTabs => prevTabs.map(t =>
              t.id === pendingCloseTab ? { ...t, isDirty: false } : t
            ))
          }
        } else {
          // Web: This shouldn't happen in desktop mode, but fallback gracefully
          console.warn('Save attempted in web mode - files should be committed via PR')
          setTabs(prevTabs => prevTabs.map(t =>
            t.id === pendingCloseTab ? { ...t, isDirty: false } : t
          ))
        }
      } else {
        // If we can't determine owner/repo, just mark as saved locally
        setTabs(prevTabs => prevTabs.map(t =>
          t.id === pendingCloseTab ? { ...t, isDirty: false } : t
        ))
      }
    } catch (error) {
      console.error('Error saving file:', error)
      // Still allow closing even if save fails
      setTabs(prevTabs => prevTabs.map(t =>
        t.id === pendingCloseTab ? { ...t, isDirty: false } : t
      ))
    }
    
    doCloseTab(pendingCloseTab)
  }

  const saveTab = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find(t => t.id === tabId)
    if (!tab || !tab.isDirty) return

    if (!selectedRepo) {
      alert('Error: No repository selected. Please select a repository first.')
      return
    }

    try {
      const [owner, repo] = selectedRepo.full_name.split('/')
      
      // Determine file path - handle both formats:
      // 1. Full format: "owner/repo/path/to/file" 
      // 2. Relative format: "path/to/file" (use selectedRepo)
      let filePath: string
      const pathParts = tab.path.split('/')
      
      if (pathParts.length >= 2 && pathParts[0] === owner && pathParts[1] === repo) {
        // Full format: owner/repo/path
        filePath = pathParts.slice(2).join('/')
      } else {
        // Relative format: just the path
        filePath = tab.path
      }

      const isDesktop = typeof window !== 'undefined' && window.electronAPI?.isDesktop === true
      
      if (isDesktop && window.electronAPI) {
        // DESKTOP: Use Electron API
        const { readFile, applyFileProposal } = await import('@/utils/desktopBridge')
        
        // Check if file exists by trying to read it
        const readResult = await readFile(owner, repo, filePath)
        const fileExists = readResult.success
        
        // Use createFile for new files, writeFile for existing
        const action = fileExists ? 'edit' : 'create'
        
        const result = await applyFileProposal(
          owner,
          repo,
          filePath,
          tab.content,
          token || '',
          action
        )
        
        if (result.success) {
          setTabs(prevTabs => prevTabs.map(t =>
            t.id === tabId ? { ...t, isDirty: false, originalContent: t.content } : t
          ))
          console.log('✅ File saved:', filePath)
          // Refresh git status after file save
          if (onRefreshGitStatusRef?.current) {
            onRefreshGitStatusRef.current()
          }
          
          // Refresh file tree if callback provided
          if (onRefreshFileTree) {
            onRefreshFileTree()
          }
        } else {
          alert(`Failed to save file: ${result.error}`)
          console.error('❌ Save failed:', result.error)
        }
      } else {
        // WEB: Use backend API
        const saveUrl = getApiEndpoint('/local/files/write')
        
        const response = await fetch(saveUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token || ''}`
          },
          body: JSON.stringify({
            owner,
            repo,
            path: filePath,
            content: tab.content
          })
        })

        if (response.ok) {
          setTabs(prevTabs => prevTabs.map(t =>
            t.id === tabId ? { ...t, isDirty: false } : t
          ))
          console.log('✅ File saved:', filePath)
        } else {
          const error = await response.text()
          alert(`Failed to save file: ${error}`)
          console.error('❌ Save failed:', error)
        }
      }
    } catch (error: any) {
      console.error('❌ Error saving file:', error)
      alert(`Error saving file: ${error?.message || 'Unknown error'}`)
    }
  }, [selectedRepo, token, onRefreshFileTree])

  // Ctrl+S keyboard shortcut for saving
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S or Cmd+S - Save current tab
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        // Use refs to get current values
        const currentTabId = isSplitRef.current 
          ? (focusedPaneRef.current === 'left' ? leftTabRef.current : rightTabRef.current)
          : leftTabRef.current
        if (currentTabId) {
          saveTab(currentTabId)
        }
      }
      
      // Cmd+Shift+P or Ctrl+Shift+P - Show Create PR modal
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'p') {
        e.preventDefault()
        setShowPRShortcut(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [saveTab]) // saveTab is now stable via useCallback

  // Expose save all tabs function via ref
  useEffect(() => {
    if (onSaveAllTabsRef) {
      onSaveAllTabsRef.current = async () => {
        // Save all dirty tabs
        const dirtyTabs = tabsRef.current.filter(t => t.isDirty)
        for (const tab of dirtyTabs) {
          await saveTab(tab.id)
        }
      }
    }
  }, [saveTab, onSaveAllTabsRef])

  // Expose reload all open tabs function via ref (for auto-sync after git pull)
  useEffect(() => {
    if (onReloadOpenTabsRef) {
      onReloadOpenTabsRef.current = async () => {
        console.log('🔄 [EditorPane] Reloading all open tabs from disk...')
        const currentTabs = tabsRef.current
        if (!selectedRepo || currentTabs.length === 0) return
        
        const [owner, repo] = selectedRepo.full_name.split('/')
        
        for (const tab of currentTabs) {
          // Skip tabs that are dirty (have unsaved changes) - user might lose work
          if (tab.isDirty) {
            console.log(`⚠️ [EditorPane] Skipping dirty tab: ${tab.path}`)
            continue
          }
          
          try {
            // Read fresh content from disk
            const readResult = await window.electronAPI?.readFile(owner, repo, tab.path)
            if (readResult?.success && readResult.content !== undefined) {
              const newContent = readResult.content
              // Only update if content actually changed
              if (newContent !== tab.content) {
                console.log(`✅ [EditorPane] Reloaded: ${tab.path}`)
                setTabs(prev => prev.map(t => 
                  t.id === tab.id 
                    ? { ...t, content: newContent, originalContent: newContent }
                    : t
                ))
              }
            }
          } catch (error) {
            console.warn(`⚠️ [EditorPane] Failed to reload: ${tab.path}`, error)
          }
        }
        console.log('✅ [EditorPane] Tab reload complete')
      }
    }
  }, [selectedRepo, onReloadOpenTabsRef])

  // Expose get editor content callback (for staging)
  useEffect(() => {
    if (onGetEditorContent) {
      // This will be called from IDELayout when staging
      // We'll set it up to get content from tabs
      const getContent = async (filePath: string) => {
        const tab = tabs.find(t => t.path === filePath)
        return tab ? tab.content : null
      }
      // Store in a way IDELayout can access
      ;(window as any).__getEditorContentForStaging = getContent
    }
    return () => {
      delete (window as any).__getEditorContentForStaging
    }
  }, [tabs, onGetEditorContent])

  const handleDontSave = () => {
    if (!pendingCloseTab) return
    doCloseTab(pendingCloseTab)
  }

  const handleCancel = () => {
    setPendingCloseTab(null)
  }

  // Auto-disable split when only one pane has a file or both are empty
  useEffect(() => {
    if (!isSplit) return
    
    // If both panes are empty, disable split
    if (!leftTab && !rightTab) {
      setIsSplit(false)
      return
    }
    
    // If only left pane has a file, disable split
    if (leftTab && !rightTab) {
      setIsSplit(false)
      return
    }
    
    // If only right pane has a file, move it to left and disable split
    if (!leftTab && rightTab) {
      setLeftTab(rightTab)
      setRightTab(null)
      setIsSplit(false)
    }
  }, [isSplit, leftTab, rightTab])

  // Handle divider drag
  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return
      
      const container = containerRef.current
      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const percentage = Math.max(10, Math.min(90, (x / rect.width) * 100))
      setDividerPosition(percentage)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging])


  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#141414] relative z-0">
      {/* Tab bar - VS Code style - only show if tabs exist */}
      {tabs.length > 0 && (
      <div 
        className="h-[35px] bg-[#181818] border-b border-[#1a1a1a] flex items-center overflow-x-auto"
        style={{
          msOverflowStyle: 'none',  /* IE and Edge */
          scrollbarWidth: 'none',  /* Firefox */
        }}
      >
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            className={`h-full px-3 flex items-center gap-2 group relative ${
              index < tabs.length - 1 ? 'border-r border-[#1a1a1a]' : ''
            } ${
              (leftTab === tab.id || rightTab === tab.id)
                ? 'bg-[#181818] text-white'
                : 'bg-[#141414] text-[#969696] hover:bg-[#2a2a2a]'
            }`}
          >
            <div 
              className="flex items-center gap-2 cursor-pointer" 
              onClick={() => {
                if (isSplit) {
                  // In split mode, show tab in focused pane
                  if (focusedPane === 'left') {
                    setLeftTab(tab.id)
                  } else {
                    setRightTab(tab.id)
                  }
                } else {
                  // Not in split mode, show in left pane
                  setLeftTab(tab.id)
                }
              }}
            >
              <FileIcon key={`tab-${tab.id}`} fileName={tab.name} size={16} />
              {(() => {
                const gitStatus = getFileGitStatus(tab.path)
                return (
                  <>
                    <span className={`text-[13px] ${
                      gitStatus === 'added' ? 'text-green-400' : 
                      gitStatus === 'modified' ? 'text-yellow-400' : 
                      gitStatus === 'deleted' ? 'text-red-400' : ''
                    }`}>
                      {tab.name}
                    </span>
                    {gitStatus === 'added' && (
                      <span className="text-[11px] text-green-400 font-medium ml-1">A</span>
                    )}
                    {gitStatus === 'modified' && (
                      <span className="text-[11px] text-yellow-400 font-medium ml-1">M</span>
                    )}
                    {gitStatus === 'deleted' && (
                      <span className="text-[11px] text-red-400 font-medium ml-1">D</span>
                    )}
                  </>
                )
              })()}
            </div>
            {tab.isDirty && (
              <div className="w-[6px] h-[6px] rounded-full bg-white" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              className="opacity-0 group-hover:opacity-100 hover:bg-[#3e3e3e] rounded-sm p-0.5 transition-opacity ml-1"
              aria-label="Close"
            >
              <i className="codicon codicon-close text-[#969696] hover:text-white" style={{ fontSize: 14 }} />
            </button>
          </div>
        ))}
      </div>
      )}

      {/* Editor content - Single or split view */}
      {(() => {
        // Only show editor if we have actual tabs (not just IDs that don't exist yet)
        const leftTabExists = leftTab && tabs.find(t => t.id === leftTab)
        const rightTabExists = rightTab && tabs.find(t => t.id === rightTab)
        return leftTabExists || rightTabExists
      })() ? (
        <div ref={containerRef} className="flex-1 flex overflow-hidden bg-[#181818] relative">
          {isSplit ? (
            // Split view with 2 editors and resizable divider
            <>
              {/* Left editor */}
              <div 
                className="flex flex-col overflow-hidden border-r border-[#1a1a1a]"
                style={{ width: `${dividerPosition}%` }}
                onClick={() => setFocusedPane('left')}
              >
                {(() => {
                  const tab = tabs.find(t => t.id === leftTab)
                  if (!tab) {
                    return (
                      <div className="flex-1 flex items-center justify-center text-[#858585] text-sm">
                        No file open
                      </div>
                    )
                  }
                  return (
                    <>
                      {/* Breadcrumb */}
                      <div className="h-[22px] bg-[#181818] border-b border-[#1a1a1a] flex items-center justify-between px-4">
                        <div className="flex items-center gap-1 text-[11px] text-[#858585]">
                          {tab.path.split('/').map((part, partIndex, array) => (
                            <span key={`${tab.id}-breadcrumb-${partIndex}`} className="flex items-center gap-1">
                              {partIndex === array.length - 1 && <FileIcon key={`${tab.id}-icon`} fileName={part} size={14} />}
                              <span className="hover:text-[#cccccc] cursor-pointer transition-colors">{part}</span>
                              {partIndex < array.length - 1 && <span className="text-[#6e7681]">{'>'}</span>}
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center gap-1">
                          {/* Save button */}
                          {tab.isDirty && (
                            <button
                              onClick={() => saveTab(tab.id)}
                              className="px-2 py-0.5 text-[11px] text-[#858585] hover:text-white hover:bg-[#2a2a2a] rounded transition-colors flex items-center gap-1"
                              title="Save (Ctrl+S)"
                            >
                              <i className="codicon codicon-save" style={{ fontSize: 12 }} />
                              Save
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Editor */}
                      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        {/* Multi-proposal navigation (Cursor-style) */}
                        {tab.isDiffMode && (
                          <div className="flex items-center justify-between px-3 py-1.5 bg-[#252526] border-b border-[#3e3e42]">
                            {/* Left: Navigation arrows with file counter */}
                            {fileProposals.length > 1 && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    const currentIdx = fileProposals.findIndex(p => p.path === currentFileProposal?.path)
                                    const prevIdx = currentIdx > 0 ? currentIdx - 1 : fileProposals.length - 1
                                    const prevProposal = fileProposals[prevIdx]
                                    if (prevProposal && onProposalHandled) {
                                      onProposalHandled(prevProposal.path, 'view')
                                    }
                                  }}
                                  className="w-6 h-6 flex items-center justify-center text-[#cccccc] hover:bg-[#2a2d2e] rounded transition-colors"
                                  title="Previous file"
                                >
                                  &#60;
                                </button>
                                <span className="text-xs text-[#cccccc] font-medium">
                                  {fileProposals.findIndex(p => p.path === currentFileProposal?.path) + 1} / {fileProposals.length} files
                                </span>
                                <button
                                  onClick={() => {
                                    const currentIdx = fileProposals.findIndex(p => p.path === currentFileProposal?.path)
                                    const nextIdx = currentIdx < fileProposals.length - 1 ? currentIdx + 1 : 0
                                    const nextProposal = fileProposals[nextIdx]
                                    if (nextProposal && onProposalHandled) {
                                      onProposalHandled(nextProposal.path, 'view')
                                    }
                                  }}
                                  className="w-6 h-6 flex items-center justify-center text-[#cccccc] hover:bg-[#2a2d2e] rounded transition-colors"
                                  title="Next file"
                                >
                                  &#62;
                                </button>
                              </div>
                            )}
                            
                            {/* Right: Undo All and Keep All buttons */}
                            <div className="flex items-center gap-2 ml-auto">
                              <button
                                onClick={async () => {
                                  console.log('⏪ [EditorPane] UNDO ALL clicked')
                                  // Reject all pending file proposals
                                  const pendingProposals = fileProposals.filter(p => proposalStates[p.path] === 'pending')
                                  for (const proposal of pendingProposals) {
                                    if (onProposalHandled) {
                                      await onProposalHandled(false, proposal.path)
                                    }
                                  }
                                }}
                                className="px-3 py-1 text-xs font-medium text-[#cccccc] bg-[#3c3c3c] hover:bg-[#505050] rounded transition-colors border border-[#3e3e42]"
                                title="Reject all changes"
                              >
                                Undo All ⌘⇧⌫
                              </button>
                              <button
                                onClick={async () => {
                                  console.log('✅ [EditorPane] KEEP ALL clicked - saving all pending proposals')
                                  // Accept all pending file proposals
                                  const pendingProposals = fileProposals.filter(p => proposalStates[p.path] === 'pending')
                                  console.log(`📦 [EditorPane] Saving ${pendingProposals.length} proposals...`)
                                  
                                  // Save each file first, then mark as accepted
                                  for (const proposal of pendingProposals) {
                                    console.log(`💾 [EditorPane] Saving file: ${proposal.path}`)
                                    const saveResult = await saveFileProposal(proposal)
                                    
                                    if (saveResult.success) {
                                      console.log(`✅ [EditorPane] File saved: ${proposal.path}`)
                                      // Broadcast to team so they see agent changes
                                      if (onLocalTextChange && proposal.newContent) {
                                        onLocalTextChange(proposal.path, proposal.newContent)
                                        console.log(`📢 [EditorPane] Broadcast agent changes: ${proposal.path}`)
                                      }
                                      // Mark as accepted after successful save
                                      if (onProposalHandled) {
                                        await onProposalHandled(true, proposal.path)
                                      }
                                    } else {
                                      console.error(`❌ [EditorPane] Failed to save ${proposal.path}:`, saveResult.error)
                                      alert(`Failed to save ${proposal.path}: ${saveResult.error}`)
                                      // Continue with other files even if one fails
                                    }
                                  }
                                  
                                  console.log(`✅ [EditorPane] Keep All complete - processed ${pendingProposals.length} files`)
                                  
                                  // Notify team about new/updated files WITH CONTENT so they can write locally
                                  if (onAgentFilesAccepted && pendingProposals.length > 0) {
                                    onAgentFilesAccepted(pendingProposals.map(p => ({
                                      path: p.path,
                                      content: p.newContent || '',
                                      action: (p.action === 'create' ? 'created' : 'updated') as 'created' | 'updated'
                                    })))
                                  }
                                }}
                                className="px-3 py-1 text-xs font-medium text-white bg-[#0e639c] hover:bg-[#1177bb] rounded transition-colors"
                                title="Accept all changes"
                              >
                                Keep All ⌘⏎
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {/* Lock banner when file is locked during PR creation */}
                        {(() => {
                          const lockInfo = isFileLocked?.(tab.path)
                          if (lockInfo) {
                            console.log(`🔒 [EditorPane] File ${tab.path} IS locked by ${lockInfo.locked_by_name}`)
                          }
                          return lockInfo ? (
                            <div className="flex items-center gap-2 px-3 py-2 bg-yellow-900/50 border-b border-yellow-700/50 text-yellow-200 text-sm">
                              <span>🔒</span>
                              <span>
                                <strong>{lockInfo.locked_by_name}</strong> is creating a PR with this file. Editing is temporarily disabled.
                              </span>
                            </div>
                          ) : null
                        })()}
                        
                        <MonacoEditor
                          key={tab.id}
                          value={tab.content}
                          originalValue={tab.isDiffMode ? tab.originalContent : undefined}
                          originalContent={tab.originalContent} // For gutter indicators (agent edits or manual edits)
                          isDirty={tab.isDirty}
                          language={tab.language}
                          readOnly={isFileLocked?.(tab.path) !== null}
                          onChange={(newValue) => {
                            // Skip if this is from remote sync
                            if (isApplyingRemoteRef.current) return
                            // Skip if file is locked
                            if (isFileLocked?.(tab.path)) return
                            
                            const currentTabId = tab.id
                            setTabs(prevTabs => prevTabs.map(t => 
                              t.id === currentTabId 
                                ? { ...t, content: newValue, isDirty: true }
                                : t
                            ))
                            
                            // Broadcast full content to collaborators
                            onLocalTextChange?.(tab.path, newValue)
                          }}
                          onCursorPositionChange={(line, col) => onCursorPositionChange?.(line, col, tab.path)}
                          onDiagnosticsChange={onDiagnosticsChange}
                          remoteCursors={remoteCursors.filter(c => c.userId !== tab.id)}
                          onShowDefinition={(resourceType) => setShowDefinition(resourceType)}
                          onEstimateCost={(resourceType, resourceName, resourceBlock) => 
                            setResourceAnalysis({ type: 'cost', resourceType, resourceName, resourceBlock })
                          }
                          onSecurityCheck={(resourceType, resourceName, resourceBlock) =>
                            setResourceAnalysis({ type: 'security', resourceType, resourceName, resourceBlock })
                          }
                          onFindDependencies={(resourceType, resourceName, resourceBlock) =>
                            setResourceAnalysis({ type: 'dependencies', resourceType, resourceName, resourceBlock })
                          }
                          onAccept={tab.isDiffMode ? async () => {
                            console.log('✅ [EditorPane] KEEP button clicked')
                            const currentTabId = tab.id
                            console.log('✅ [EditorPane] Tab ID:', currentTabId)
                            console.log('✅ [EditorPane] Current file proposal:', {
                              exists: !!currentFileProposal,
                              path: currentFileProposal?.path,
                              action: currentFileProposal?.action,
                              hasOldContent: !!currentFileProposal?.oldContent,
                              oldContentLength: currentFileProposal?.oldContent?.length || 0,
                              newContentLength: currentFileProposal?.newContent?.length || 0
                            })
                            console.log('✅ [EditorPane] Selected repo:', selectedRepo?.full_name)
                            console.log('✅ [EditorPane] Token exists:', !!token)
                            
                            // Save file to disk first
                            if (!currentFileProposal) {
                              console.error('❌ [EditorPane] No currentFileProposal - cannot save')
                              alert('Error: No file proposal to save')
                              return
                            }
                            
                            if (!selectedRepo) {
                              console.error('❌ [EditorPane] No selectedRepo - cannot save')
                              alert('Error: No repository selected')
                              return
                            }
                            
                            if (!token) {
                              console.error('❌ [EditorPane] No token - cannot save')
                              alert('Error: Not authenticated. Please log in.')
                              return
                            }
                            
                            try {
                              const [owner, repo] = selectedRepo.full_name.split('/')
                              console.log('✅ [EditorPane] Extracted owner/repo:', { owner, repo })
                              
                              // Ensure repo is cloned first (for Electron) - only needed for file creation
                              if (isDesktop && window.electronAPI) {
                                console.log('✅ [EditorPane] Checking if repo exists locally...')
                                const { getFileTree } = await import('@/utils/desktopBridge')
                                const treeResult = await getFileTree(owner, repo, '')
                                
                                if (!treeResult.success) {
                                  console.log('✅ [EditorPane] Repo not found locally, cloning...')
                                  
                                  // Only need GitHub token if we need to clone
                                  if (!githubToken) {
                                    console.error('❌ [EditorPane] GitHub token not available for cloning')
                                    alert('Repository not found locally. GitHub token required to clone it. Please authenticate with GitHub first.')
                                    return
                                  }
                                  
                                  const { cloneRepository } = await import('@/utils/desktopBridge')
                                  const cloneResult = await cloneRepository(owner, repo, githubToken)
                                  if (!cloneResult.success) {
                                    console.error('❌ [EditorPane] Failed to clone repo:', cloneResult.error)
                                    alert(`Failed to clone repository: ${cloneResult.error}`)
                                    return
                                  }
                                  console.log('✅ [EditorPane] Repo cloned successfully')
                                } else {
                                  console.log('✅ [EditorPane] Repo already exists locally - no token needed')
                                }
                              }
                              
                              // Use desktop bridge (handles both Electron and web)
                              // Determine action: use proposal.action if available, otherwise check oldContent
                              const action = currentFileProposal.action === 'create' || 
                                             !currentFileProposal.oldContent || 
                                             currentFileProposal.oldContent === '' 
                                                ? 'create' : 'edit'
                              console.log('✅ [EditorPane] Determined action:', {
                                action,
                                proposalAction: currentFileProposal.action,
                                hasOldContent: !!currentFileProposal.oldContent,
                                oldContentEmpty: !currentFileProposal.oldContent || currentFileProposal.oldContent === ''
                              })
                              console.log('✅ [EditorPane] Calling applyFileProposal:', {
                                owner,
                                repo,
                                path: currentFileProposal.path,
                                contentLength: currentFileProposal.newContent?.length || 0,
                                action,
                                isDesktop,
                                hasElectronAPI: !!(isDesktop && window.electronAPI)
                              })
                              
                              const result = await applyFileProposal(
                                owner,
                                repo,
                                currentFileProposal.path,
                                currentFileProposal.newContent,
                                token,
                                action
                              )
                              
                              console.log('✅ [EditorPane] applyFileProposal result:', result)
                              
                              if (!result.success) {
                                console.error('❌ [EditorPane] Failed to save file:', result.error)
                                alert(`Failed to save file: ${result.error}`)
                                return // Don't proceed if save failed
                              }
                              
                              // Refresh git status after file operation
                              if (onRefreshGitStatusRef?.current) {
                                onRefreshGitStatusRef.current()
                              }
                              
                              // Refresh file tree to show new/modified files in sidebar
                              if (onRefreshFileTree) {
                                onRefreshFileTree()
                              }
                              
                              // Broadcast to team so they see the changes
                              if (onLocalTextChange && currentFileProposal.newContent) {
                                onLocalTextChange(currentFileProposal.path, currentFileProposal.newContent)
                                console.log(`📢 [EditorPane] Broadcast agent changes: ${currentFileProposal.path}`)
                              }
                              
                              // Notify team about new/updated file WITH CONTENT
                              if (onAgentFilesAccepted) {
                                onAgentFilesAccepted([{
                                  path: currentFileProposal.path,
                                  content: currentFileProposal.newContent || '',
                                  action: currentFileProposal.action === 'create' ? 'created' : 'updated'
                                }])
                              }
                              
                              console.log('✅ [EditorPane] File saved successfully:', currentFileProposal.path)
                            } catch (error: any) {
                              console.error('❌ [EditorPane] Exception during file save:', error)
                              alert(`Error saving file: ${error?.message || 'Unknown error'}`)
                              return // Don't proceed if save failed
                            }
                            
                            console.log('✅ [EditorPane] Updating tab state - exiting diff mode')
                            // Update tab: mark as saved (not dirty), update content and originalContent
                            setTabs(prevTabs => prevTabs.map(t => {
                              if (t.id === currentTabId) {
                                const newContent = t.proposedContent || t.content
                                return { 
                                  ...t, 
                                  content: newContent, 
                                  originalContent: newContent, // Update originalContent to current content
                                  isDiffMode: false, 
                                  isDirty: false // File is saved, not dirty
                                }
                              }
                              return t
                            }))
                            
                            // Clear the proposal state to prevent re-triggering
                            const proposalPath = currentFileProposal?.path
                            setCurrentFileProposal(null)
                            console.log('✅ [EditorPane] Cleared currentFileProposal')
                            
                            console.log('✅ [EditorPane] Calling onProposalHandled(true)')
                            if (onProposalHandled) onProposalHandled(true, proposalPath)
                            console.log('✅ [EditorPane] Keep flow complete')
                            
                            // Refresh git status and file tree again after a short delay to ensure file is detected
                            setTimeout(() => {
                              if (onRefreshGitStatusRef?.current) {
                                onRefreshGitStatusRef.current()
                              }
                              if (onRefreshFileTree) {
                                onRefreshFileTree()
                              }
                            }, 500)
                          } : undefined}
                          onReject={tab.isDiffMode ? () => {
                            console.log('❌ [EditorPane] UNDO button clicked')
                            const currentTabId = tab.id
                            console.log('❌ [EditorPane] Tab ID:', currentTabId)
                            console.log('❌ [EditorPane] Tab originalContent:', {
                              exists: !!tab.originalContent,
                              length: tab.originalContent?.length || 0,
                              isEmpty: !tab.originalContent || tab.originalContent === ''
                            })
                            
                            // If it's a new file (no original content), force close the tab immediately
                            // Otherwise, revert to original content and exit diff mode
                            if (!tab.originalContent || tab.originalContent === '') {
                              console.log('❌ [EditorPane] New file detected - closing tab immediately')
                              // Force close without dirty check for new files
                              doCloseTab(currentTabId)
                              console.log('❌ [EditorPane] Tab closed')
                              // Clear the current file proposal
                              setCurrentFileProposal(null)
                              console.log('❌ [EditorPane] Cleared currentFileProposal')
                            } else {
                              console.log('❌ [EditorPane] Existing file - reverting to original content')
                              // Revert to original content and exit diff mode
                              setTabs(prevTabs => prevTabs.map(t =>
                                t.id === currentTabId
                                  ? { ...t, content: t.originalContent || '', isDiffMode: false, isDirty: false }
                                  : t
                              ))
                              console.log('❌ [EditorPane] Tab reverted to original content')
                            }
                            
                            console.log('❌ [EditorPane] Calling onProposalHandled(false)')
                            if (onProposalHandled) onProposalHandled(false, currentFileProposal?.path)
                            
                            // Notify team to discard this file too
                            if (onAgentFilesDiscarded && currentFileProposal) {
                              onAgentFilesDiscarded([{
                                path: currentFileProposal.path,
                                action: currentFileProposal.action === 'create' ? 'created' : 'updated'
                              }])
                            }
                            console.log('❌ [EditorPane] Undo flow complete')
                          } : undefined}
                          totalProposals={fileProposals.filter(p => proposalStates[p.path] === 'pending').length}
                          onAcceptAll={fileProposals.filter(p => proposalStates[p.path] === 'pending').length > 1 && onAcceptAll ? async () => {
                            console.log('✅ [EditorPane] KEEP ALL (bottom) clicked - saving all pending proposals')
                            const pendingProposals = fileProposals.filter(p => proposalStates[p.path] === 'pending')
                            console.log(`📦 [EditorPane] Saving ${pendingProposals.length} proposals...`)
                            
                            // Save each file first
                            for (const proposal of pendingProposals) {
                              console.log(`💾 [EditorPane] Saving file: ${proposal.path}`)
                              const saveResult = await saveFileProposal(proposal)
                              
                              if (saveResult.success) {
                                console.log(`✅ [EditorPane] File saved: ${proposal.path}`)
                                // Broadcast to team so they see agent changes
                                if (onLocalTextChange && proposal.newContent) {
                                  onLocalTextChange(proposal.path, proposal.newContent)
                                  console.log(`📢 [EditorPane] Broadcast agent changes: ${proposal.path}`)
                                }
                              } else {
                                console.error(`❌ [EditorPane] Failed to save ${proposal.path}:`, saveResult.error)
                                alert(`Failed to save ${proposal.path}: ${saveResult.error}`)
                                return // Stop if any file fails
                              }
                            }
                            
                            console.log(`✅ [EditorPane] All files saved, calling onAcceptAll to batch-accept`)
                            // Now accept all at once
                            await onAcceptAll()
                            
                            // Notify team about new/updated files WITH CONTENT so they can stage
                            if (onAgentFilesAccepted && pendingProposals.length > 0) {
                              console.log('📦 [EditorPane] Notifying team and staging AI changes...')
                              onAgentFilesAccepted(pendingProposals.map(p => ({
                                path: p.path,
                                content: p.newContent || '',
                                action: (p.action === 'create' ? 'created' : 'updated') as 'created' | 'updated'
                              })))
                            }
                          } : undefined}
                        />
                      </div>
                    </>
                  )
                })()}
              </div>
              
              {/* Resizable divider */}
              <div className="flex flex-col items-center relative z-10">
                <div
                  className="w-[4px] bg-[#1a1a1a] hover:bg-[#2a2a2a] cursor-col-resize transition-colors flex-1"
                  onMouseDown={handleDividerMouseDown}
                >
                  <div className="absolute inset-y-0 left-0 right-0" />
                </div>
                {/* Close split button */}
                <button
                  onClick={() => {
                    // Move right tab to left if it exists, then disable split
                    if (rightTab && !leftTab) {
                      setLeftTab(rightTab)
                      setRightTab(null)
                    }
                    setIsSplit(false)
                  }}
                  className="absolute top-1/2 -translate-y-1/2 bg-[#252526] border border-[#1a1a1a] hover:bg-[#2d2d30] rounded px-1.5 py-0.5 transition-colors"
                  title="Close split view"
                >
                  <i className="codicon codicon-close text-[#858585] hover:text-white" style={{ fontSize: 12 }} />
                </button>
              </div>
              
              {/* Right editor */}
              <div 
                className="flex flex-col overflow-hidden"
                style={{ width: `${100 - dividerPosition}%` }}
                onClick={() => setFocusedPane('right')}
              >
                {(() => {
                  const tab = tabs.find(t => t.id === rightTab)
                  if (!tab) {
                    return (
                      <div className="flex-1 flex items-center justify-center text-[#858585] text-sm">
                        No file open
                      </div>
                    )
                  }
                  return (
                    <>
                      {/* Breadcrumb */}
                      <div className="h-[22px] bg-[#181818] border-b border-[#1a1a1a] flex items-center justify-between px-4">
                        <div className="flex items-center gap-1 text-[11px] text-[#858585]">
                          {tab.path.split('/').map((part, partIndex, array) => (
                            <span key={`${tab.id}-breadcrumb-${partIndex}`} className="flex items-center gap-1">
                              {partIndex === array.length - 1 && <FileIcon key={`${tab.id}-icon`} fileName={part} size={14} />}
                              <span className="hover:text-[#cccccc] cursor-pointer transition-colors">{part}</span>
                              {partIndex < array.length - 1 && <span className="text-[#6e7681]">{'>'}</span>}
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center gap-1">
                          {/* Save button */}
                          {tab.isDirty && (
                            <button
                              onClick={() => saveTab(tab.id)}
                              className="px-2 py-0.5 text-[11px] text-[#858585] hover:text-white hover:bg-[#2a2a2a] rounded transition-colors flex items-center gap-1"
                              title="Save (Ctrl+S)"
                            >
                              <i className="codicon codicon-save" style={{ fontSize: 12 }} />
                              Save
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Editor */}
                      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        {/* Multi-proposal navigation (Cursor-style) */}
                        {tab.isDiffMode && (
                          <div className="flex items-center justify-between px-3 py-1.5 bg-[#252526] border-b border-[#3e3e42]">
                            {/* Left: Navigation arrows with file counter */}
                            {fileProposals.length > 1 && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    const currentIdx = fileProposals.findIndex(p => p.path === currentFileProposal?.path)
                                    const prevIdx = currentIdx > 0 ? currentIdx - 1 : fileProposals.length - 1
                                    const prevProposal = fileProposals[prevIdx]
                                    if (prevProposal && onProposalHandled) {
                                      onProposalHandled(prevProposal.path, 'view')
                                    }
                                  }}
                                  className="w-6 h-6 flex items-center justify-center text-[#cccccc] hover:bg-[#2a2d2e] rounded transition-colors"
                                  title="Previous file"
                                >
                                  &#60;
                                </button>
                                <span className="text-xs text-[#cccccc] font-medium">
                                  {fileProposals.findIndex(p => p.path === currentFileProposal?.path) + 1} / {fileProposals.length} files
                                </span>
                                <button
                                  onClick={() => {
                                    const currentIdx = fileProposals.findIndex(p => p.path === currentFileProposal?.path)
                                    const nextIdx = currentIdx < fileProposals.length - 1 ? currentIdx + 1 : 0
                                    const nextProposal = fileProposals[nextIdx]
                                    if (nextProposal && onProposalHandled) {
                                      onProposalHandled(nextProposal.path, 'view')
                                    }
                                  }}
                                  className="w-6 h-6 flex items-center justify-center text-[#cccccc] hover:bg-[#2a2d2e] rounded transition-colors"
                                  title="Next file"
                                >
                                  &#62;
                                </button>
                              </div>
                            )}
                            
                            {/* Right: Undo All and Keep All buttons */}
                            <div className="flex items-center gap-2 ml-auto">
                              <button
                                onClick={async () => {
                                  console.log('⏪ [EditorPane] UNDO ALL clicked')
                                  // Reject all pending file proposals
                                  const pendingProposals = fileProposals.filter(p => proposalStates[p.path] === 'pending')
                                  for (const proposal of pendingProposals) {
                                    if (onProposalHandled) {
                                      await onProposalHandled(false, proposal.path)
                                    }
                                  }
                                }}
                                className="px-3 py-1 text-xs font-medium text-[#cccccc] bg-[#3c3c3c] hover:bg-[#505050] rounded transition-colors border border-[#3e3e42]"
                                title="Reject all changes"
                              >
                                Undo All ⌘⇧⌫
                              </button>
                              <button
                                onClick={async () => {
                                  console.log('✅ [EditorPane] KEEP ALL clicked - saving all pending proposals')
                                  // Accept all pending file proposals
                                  const pendingProposals = fileProposals.filter(p => proposalStates[p.path] === 'pending')
                                  console.log(`📦 [EditorPane] Saving ${pendingProposals.length} proposals...`)
                                  
                                  // Save each file first, then mark as accepted
                                  for (const proposal of pendingProposals) {
                                    console.log(`💾 [EditorPane] Saving file: ${proposal.path}`)
                                    const saveResult = await saveFileProposal(proposal)
                                    
                                    if (saveResult.success) {
                                      console.log(`✅ [EditorPane] File saved: ${proposal.path}`)
                                      // Broadcast to team so they see agent changes
                                      if (onLocalTextChange && proposal.newContent) {
                                        onLocalTextChange(proposal.path, proposal.newContent)
                                        console.log(`📢 [EditorPane] Broadcast agent changes: ${proposal.path}`)
                                      }
                                      // Mark as accepted after successful save
                                      if (onProposalHandled) {
                                        await onProposalHandled(true, proposal.path)
                                      }
                                    } else {
                                      console.error(`❌ [EditorPane] Failed to save ${proposal.path}:`, saveResult.error)
                                      alert(`Failed to save ${proposal.path}: ${saveResult.error}`)
                                      // Continue with other files even if one fails
                                    }
                                  }
                                  
                                  console.log(`✅ [EditorPane] Keep All complete - processed ${pendingProposals.length} files`)
                                  
                                  // Notify team about new/updated files WITH CONTENT so they can write locally
                                  if (onAgentFilesAccepted && pendingProposals.length > 0) {
                                    onAgentFilesAccepted(pendingProposals.map(p => ({
                                      path: p.path,
                                      content: p.newContent || '',
                                      action: (p.action === 'create' ? 'created' : 'updated') as 'created' | 'updated'
                                    })))
                                  }
                                }}
                                className="px-3 py-1 text-xs font-medium text-white bg-[#0e639c] hover:bg-[#1177bb] rounded transition-colors"
                                title="Accept all changes"
                              >
                                Keep All ⌘⏎
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {/* Lock banner when file is locked during PR creation */}
                        {isFileLocked?.(tab.path) && (
                          <div className="flex items-center gap-2 px-3 py-2 bg-yellow-900/50 border-b border-yellow-700/50 text-yellow-200 text-sm">
                            <span>🔒</span>
                            <span>
                              <strong>{isFileLocked(tab.path)?.locked_by_name}</strong> is creating a PR with this file. Editing is temporarily disabled.
                            </span>
                          </div>
                        )}
                        
                        <MonacoEditor
                          key={tab.id}
                          value={tab.content}
                          originalValue={tab.isDiffMode ? tab.originalContent : undefined}
                          originalContent={tab.originalContent}
                          isDirty={tab.isDirty}
                          language={tab.language}
                          targetLine={tab.targetLine}
                          readOnly={isFileLocked?.(tab.path) !== null}
                          onChange={(newValue) => {
                            // Skip if this is from remote sync
                            if (isApplyingRemoteRef.current) return
                            // Skip if file is locked
                            if (isFileLocked?.(tab.path)) return
                            
                            const currentTabId = tab.id
                            setTabs(prevTabs => prevTabs.map(t => 
                              t.id === currentTabId 
                                ? { ...t, content: newValue, isDirty: true }
                                : t
                            ))
                            
                            // Broadcast full content to collaborators
                            onLocalTextChange?.(tab.path, newValue)
                          }}
                          onCursorPositionChange={(line, col) => onCursorPositionChange?.(line, col, tab.path)}
                          onDiagnosticsChange={onDiagnosticsChange}
                          remoteCursors={remoteCursors.filter(c => c.userId !== tab.id)}
                          onShowDefinition={(resourceType) => setShowDefinition(resourceType)}
                          onEstimateCost={(resourceType, resourceName, resourceBlock) => 
                            setResourceAnalysis({ type: 'cost', resourceType, resourceName, resourceBlock })
                          }
                          onSecurityCheck={(resourceType, resourceName, resourceBlock) =>
                            setResourceAnalysis({ type: 'security', resourceType, resourceName, resourceBlock })
                          }
                          onFindDependencies={(resourceType, resourceName, resourceBlock) =>
                            setResourceAnalysis({ type: 'dependencies', resourceType, resourceName, resourceBlock })
                          }
                          onAccept={tab.isDiffMode ? async () => {
                            const currentTabId = tab.id
                            
                            // Save file to disk first
                            if (currentFileProposal && selectedRepo && token) {
                              try {
                                const [owner, repo] = selectedRepo.full_name.split('/')
                                
                                // Use desktop bridge (handles both Electron and web)
                                // Determine action: use proposal.action if available, otherwise check oldContent
                                const action = currentFileProposal.action === 'create' || 
                                               !currentFileProposal.oldContent || 
                                               currentFileProposal.oldContent === '' 
                                                  ? 'create' : 'edit'
                                console.log('💾 Saving file:', { path: currentFileProposal.path, action, hasOldContent: !!currentFileProposal.oldContent })
                                const result = await applyFileProposal(
                                  owner,
                                  repo,
                                  currentFileProposal.path,
                                  currentFileProposal.newContent,
                                  token,
                                  action
                                )
                                
                                if (!result.success) {
                                  console.error('❌ Failed to save file:', result.error)
                                  alert(`Failed to save file: ${result.error}`)
                                  return // Don't proceed if save failed
                                }
                                
                                // Refresh git status after file operation
                                if (onRefreshGitStatusRef?.current) {
                                  onRefreshGitStatusRef.current()
                                }
                                
                                // Refresh file tree to show new/modified files in sidebar
                                if (onRefreshFileTree) {
                                  onRefreshFileTree()
                                }
                                
                                // Broadcast to team so they see the changes
                                if (onLocalTextChange && currentFileProposal.newContent) {
                                  onLocalTextChange(currentFileProposal.path, currentFileProposal.newContent)
                                  console.log(`📢 [EditorPane] Broadcast agent changes: ${currentFileProposal.path}`)
                                }
                                
                                // Notify team about new/updated file WITH CONTENT
                                if (onAgentFilesAccepted) {
                                  onAgentFilesAccepted([{
                                    path: currentFileProposal.path,
                                    content: currentFileProposal.newContent || '',
                                    action: currentFileProposal.action === 'create' ? 'created' : 'updated'
                                  }])
                                }
                                
                                console.log('✅ File saved:', currentFileProposal.path)
                                
                                // Trigger codebase index update for this accepted file
                                if (isDesktop && token) {
                                  try {
                                    const { parseChangedFiles } = await import('@/utils/codebaseParser')
                                    
                                    // Parse the accepted file
                                    const parseResult = await parseChangedFiles(owner, repo, [{
                                      path: currentFileProposal.path,
                                      type: action === 'create' ? 'added' : 'modified',
                                      content: currentFileProposal.newContent
                                    }])
                                    
                                    if (parseResult.success && parseResult.chunks && token) {
                                      // Send incremental update for this single file
                                      const response = await fetch(getApiEndpoint('/context/update-codebase'), {
                                        method: 'POST',
                                        headers: {
                                          'Content-Type': 'application/json',
                                          'Authorization': `Bearer ${token}`
                                        },
                                        body: JSON.stringify({
                                          owner,
                                          repo,
                                          changed_files: [{
                                            path: currentFileProposal.path,
                                            type: action === 'create' ? 'added' : 'modified',
                                            chunks: parseResult.chunks
                                          }]
                                        })
                                      })
                                      
                                      if (response.ok) {
                                        const result = await response.json()
                                        console.log('✅ [EditorPane] Codebase index updated:', {
                                          path: currentFileProposal.path,
                                          reused: result.reused_embeddings || 0,
                                          new: result.new_embeddings || 0
                                        })
                                        
                                        // Update localStorage hash for the file
                                        const lastHashesKey = `codebase_hashes_${owner}_${repo}`
                                        const lastHashes = JSON.parse(localStorage.getItem(lastHashesKey) || '{}')
                                        const { calculateFileHash } = await import('@/utils/codebaseParser')
                                        lastHashes[currentFileProposal.path] = calculateFileHash(currentFileProposal.newContent)
                                        localStorage.setItem(lastHashesKey, JSON.stringify(lastHashes))
                                      } else {
                                        const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
                                        console.warn('⚠️ [EditorPane] Failed to update codebase index:', error.detail || error.error)
                                        // Non-fatal - continue with file save
                                      }
                                    }
                                  } catch (error) {
                                    console.error('⚠️ [EditorPane] Failed to update codebase index (non-fatal):', error)
                                    // Non-fatal - continue with file save
                                  }
                                }
                              } catch (error) {
                                console.error('Failed to save file:', error)
                              }
                            }
                            
                            // Update tab: mark as saved (not dirty), update content and originalContent
                            setTabs(prevTabs => prevTabs.map(t => {
                              if (t.id === currentTabId) {
                                const newContent = t.proposedContent || t.content
                                return { 
                                  ...t, 
                                  content: newContent, 
                                  originalContent: newContent, // Update originalContent to current content
                                  isDiffMode: false, 
                                  isDirty: false // File is saved, not dirty
                                }
                              }
                              return t
                            }))
                            
                            const proposalPath = currentFileProposal?.path
                            setCurrentFileProposal(null)
                            if (onProposalHandled) onProposalHandled(true, proposalPath)
                            
                            // Refresh git status and file tree again after a short delay to ensure file is detected
                            setTimeout(() => {
                              if (onRefreshGitStatusRef?.current) {
                                onRefreshGitStatusRef.current()
                              }
                              if (onRefreshFileTree) {
                                onRefreshFileTree()
                              }
                            }, 500)
                          } : undefined}
                          onReject={tab.isDiffMode ? () => {
                            const currentTabId = tab.id
                            // If it's a new file (no original content), force close the tab immediately
                            // Otherwise, revert to original content and exit diff mode
                            if (!tab.originalContent || tab.originalContent === '') {
                              // Force close without dirty check for new files
                              doCloseTab(currentTabId)
                              // Clear the current file proposal
                              setCurrentFileProposal(null)
                            } else {
                              // Revert to original content and exit diff mode
                              setTabs(prevTabs => prevTabs.map(t =>
                                t.id === currentTabId
                                  ? { ...t, content: t.originalContent || '', isDiffMode: false, isDirty: false }
                                  : t
                              ))
                            }
                            if (onProposalHandled) onProposalHandled(false, currentFileProposal?.path)
                            
                            // Notify team to discard this file too
                            if (onAgentFilesDiscarded && currentFileProposal) {
                              onAgentFilesDiscarded([{
                                path: currentFileProposal.path,
                                action: currentFileProposal.action === 'create' ? 'created' : 'updated'
                              }])
                            }
                          } : undefined}
                          totalProposals={fileProposals.filter(p => proposalStates[p.path] === 'pending').length}
                          onAcceptAll={fileProposals.filter(p => proposalStates[p.path] === 'pending').length > 1 && onAcceptAll ? async () => {
                            console.log('✅ [EditorPane] KEEP ALL (bottom) clicked - saving all pending proposals')
                            const pendingProposals = fileProposals.filter(p => proposalStates[p.path] === 'pending')
                            console.log(`📦 [EditorPane] Saving ${pendingProposals.length} proposals...`)
                            
                            // Save each file first
                            for (const proposal of pendingProposals) {
                              console.log(`💾 [EditorPane] Saving file: ${proposal.path}`)
                              const saveResult = await saveFileProposal(proposal)
                              
                              if (saveResult.success) {
                                console.log(`✅ [EditorPane] File saved: ${proposal.path}`)
                                // Broadcast to team so they see agent changes
                                if (onLocalTextChange && proposal.newContent) {
                                  onLocalTextChange(proposal.path, proposal.newContent)
                                  console.log(`📢 [EditorPane] Broadcast agent changes: ${proposal.path}`)
                                }
                              } else {
                                console.error(`❌ [EditorPane] Failed to save ${proposal.path}:`, saveResult.error)
                                alert(`Failed to save ${proposal.path}: ${saveResult.error}`)
                                return // Stop if any file fails
                              }
                            }
                            
                            console.log(`✅ [EditorPane] All files saved, calling onAcceptAll to batch-accept`)
                            // Now accept all at once
                            await onAcceptAll()
                            
                            // Notify team about new/updated files WITH CONTENT so they can stage
                            if (onAgentFilesAccepted && pendingProposals.length > 0) {
                              console.log('📦 [EditorPane] Notifying team and staging AI changes...')
                              onAgentFilesAccepted(pendingProposals.map(p => ({
                                path: p.path,
                                content: p.newContent || '',
                                action: (p.action === 'create' ? 'created' : 'updated') as 'created' | 'updated'
                              })))
                            }
                          } : undefined}
                        />
                      </div>
                    </>
                  )
                })()}
              </div>
            </>
          ) : (
            // Single editor view (left pane only)
            (() => {
              const tab = tabs.find(t => t.id === leftTab)
              if (!tab) return <WelcomeScreen onAgentMode={onAgentMode} />
              
              return (
                <div className="flex-1 flex flex-col overflow-hidden" onClick={() => setFocusedPane('left')}>
                  {/* Breadcrumb */}
                  <div className="h-[22px] bg-[#181818] border-b border-[#1a1a1a] flex items-center justify-between px-4">
                    <div className="flex items-center gap-1 text-[11px] text-[#858585]">
                      {tab.path.split('/').map((part, partIndex, array) => (
                        <React.Fragment key={`breadcrumb-${tab.id}-${partIndex}`}>
                          <span className="hover:text-[#cccccc] cursor-pointer transition-colors">{part}</span>
                          {partIndex < array.length - 1 && <span className="text-[#6e7681] ml-1">{'>'}</span>}
                        </React.Fragment>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Save button */}
                      {tab.isDirty && (
                        <button
                          onClick={() => saveTab(tab.id)}
                          className="px-2 py-0.5 text-[11px] text-[#858585] hover:text-white hover:bg-[#2a2a2a] rounded transition-colors flex items-center gap-1"
                          title="Save (Ctrl+S)"
                        >
                          <i className="codicon codicon-save" style={{ fontSize: 12 }} />
                          Save
                        </button>
                      )}
                      {/* Split button - always visible when there's a tab */}
                      <button
                        onClick={() => {
                          setIsSplit(true)
                          setFocusedPane('right')
                          // If right tab doesn't exist, copy left tab to right
                          if (!rightTab && leftTab) {
                            setRightTab(leftTab)
                          }
                        }}
                        className="px-2 py-0.5 text-[11px] text-[#858585] hover:text-white hover:bg-[#2a2a2a] rounded transition-colors flex items-center gap-1"
                        title="Split editor"
                      >
                        <i className="codicon codicon-split-horizontal" style={{ fontSize: 12 }} />
                        Split
                      </button>
                      
                      {/* Convert to Pulumi button - only show for .tf files */}
                      {(tab.path.endsWith('.tf') || tab.path.endsWith('.tfvars')) && (
                        <button
                          onClick={() => {
                            setCurrentTerraformFile(tab.path)
                            setIsConvertModalOpen(true)
                          }}
                          className="px-2 py-0.5 text-[11px] text-[#858585] hover:text-white hover:bg-[#2a2a2a] rounded transition-colors flex items-center gap-1"
                          title="Convert Terraform to Pulumi"
                        >
                          <i className="codicon codicon-arrow-swap" style={{ fontSize: 12 }} />
                          Convert to
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Editor */}
                  <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {/* Lock banner when file is locked during PR creation */}
                    {isFileLocked?.(tab.path) && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-yellow-900/50 border-b border-yellow-700/50 text-yellow-200 text-sm">
                        <span>🔒</span>
                        <span>
                          <strong>{isFileLocked(tab.path)?.locked_by_name}</strong> is creating a PR with this file. Editing is temporarily disabled.
                        </span>
                      </div>
                    )}
                    <MonacoEditor
                      key={tab.id}
                      value={tab.content}
                      originalValue={tab.isDiffMode ? tab.originalContent : undefined}
                      originalContent={tab.originalContent}
                      isDirty={tab.isDirty}
                      language={tab.language}
                      targetLine={tab.targetLine}
                      readOnly={isFileLocked?.(tab.path) !== null}
                      onChange={(newValue) => {
                        // Skip if this is from remote sync
                        if (isApplyingRemoteRef.current) return
                        // Skip if file is locked
                        if (isFileLocked?.(tab.path)) return
                        
                        const currentTabId = tab.id
                        setTabs(prevTabs => prevTabs.map(t => 
                          t.id === currentTabId 
                            ? { ...t, content: newValue, isDirty: true }
                            : t
                        ))
                        
                        // Broadcast full content to collaborators
                        onLocalTextChange?.(tab.path, newValue)
                      }}
                      onCursorPositionChange={(line, col) => onCursorPositionChange?.(line, col, tab.path)}
                      remoteCursors={remoteCursors.filter(c => c.userId !== tab.id)}
                      onShowDefinition={(resourceType) => setShowDefinition(resourceType)}
                      onEstimateCost={(resourceType, resourceName, resourceBlock) => 
                        setResourceAnalysis({ type: 'cost', resourceType, resourceName, resourceBlock })
                      }
                      onSecurityCheck={(resourceType, resourceName, resourceBlock) =>
                        setResourceAnalysis({ type: 'security', resourceType, resourceName, resourceBlock })
                      }
                      onFindDependencies={(resourceType, resourceName, resourceBlock) =>
                        setResourceAnalysis({ type: 'dependencies', resourceType, resourceName, resourceBlock })
                      }
                      onAccept={tab.isDiffMode ? async () => {
                        console.log('✅ [EditorPane] KEEP button clicked (right pane)')
                        const currentTabId = tab.id
                        
                        // Save file to disk first - use same logic as left pane
                        if (!currentFileProposal) {
                          console.error('❌ [EditorPane] No currentFileProposal - cannot save')
                          alert('Error: No file proposal to save')
                          return
                        }
                        
                        if (!selectedRepo) {
                          console.error('❌ [EditorPane] No selectedRepo - cannot save')
                          alert('Error: No repository selected')
                          return
                        }
                        
                        if (!token) {
                          console.error('❌ [EditorPane] No token - cannot save')
                          alert('Error: Not authenticated. Please log in.')
                          return
                        }
                        
                        try {
                          const [owner, repo] = selectedRepo.full_name.split('/')
                          
                          // Ensure repo is cloned first (for Electron)
                          if (isDesktop && window.electronAPI) {
                            const { getFileTree } = await import('@/utils/desktopBridge')
                            const treeResult = await getFileTree(owner, repo, '')
                            
                            if (!treeResult.success) {
                              if (!githubToken) {
                                alert('Repository not found locally. GitHub token required to clone it.')
                                return
                              }
                              
                              const { cloneRepository } = await import('@/utils/desktopBridge')
                              const cloneResult = await cloneRepository(owner, repo, githubToken)
                              if (!cloneResult.success) {
                                alert(`Failed to clone repository: ${cloneResult.error}`)
                                return
                              }
                            }
                          }
                          
                          const action = currentFileProposal.action === 'create' || 
                                         !currentFileProposal.oldContent || 
                                         currentFileProposal.oldContent === '' 
                                            ? 'create' : 'edit'
                          
                          const result = await applyFileProposal(
                            owner,
                            repo,
                            currentFileProposal.path,
                            currentFileProposal.newContent,
                            token,
                            action
                          )
                          
                          if (!result.success) {
                            alert(`Failed to save file: ${result.error}`)
                            return
                          }
                          
                          // Refresh git status after file operation
                          if (onRefreshGitStatusRef?.current) {
                            onRefreshGitStatusRef.current()
                          }
                          
                          // Refresh file tree to show new/modified files in sidebar
                          if (onRefreshFileTree) {
                            onRefreshFileTree()
                          }
                          
                          // Broadcast to team so they see the changes
                          if (onLocalTextChange && currentFileProposal.newContent) {
                            onLocalTextChange(currentFileProposal.path, currentFileProposal.newContent)
                            console.log(`📢 [EditorPane] Broadcast agent changes: ${currentFileProposal.path}`)
                          }
                          
                          // Notify team about new/updated file WITH CONTENT
                          console.log(`📢 [EditorPane] Checking onAgentFilesAccepted: ${!!onAgentFilesAccepted}`)
                          if (onAgentFilesAccepted) {
                            console.log(`📢 [EditorPane] Calling onAgentFilesAccepted for: ${currentFileProposal.path}`)
                            onAgentFilesAccepted([{
                              path: currentFileProposal.path,
                              content: currentFileProposal.newContent || '',
                              action: currentFileProposal.action === 'create' ? 'created' : 'updated'
                            }])
                          }
                        } catch (error: any) {
                          alert(`Error saving file: ${error?.message || 'Unknown error'}`)
                          return
                        }
                        
                        // Update tab: mark as saved (not dirty), update content and originalContent
                        setTabs(prevTabs => prevTabs.map(t => {
                          if (t.id === currentTabId) {
                            const newContent = t.proposedContent || t.content
                            return { 
                              ...t, 
                              content: newContent, 
                              originalContent: newContent, // Update originalContent to current content
                              isDiffMode: false, 
                              isDirty: false // File is saved, not dirty
                            }
                          }
                          return t
                        }))
                        
                        const proposalPath = currentFileProposal?.path
                        setCurrentFileProposal(null)
                        if (onProposalHandled) onProposalHandled(true, proposalPath)
                        
                        // Refresh git status and file tree again after a short delay to ensure file is detected
                        setTimeout(() => {
                          if (onRefreshGitStatusRef?.current) {
                            onRefreshGitStatusRef.current()
                          }
                          if (onRefreshFileTree) {
                            onRefreshFileTree()
                          }
                        }, 500)
                      } : undefined}
                      onReject={tab.isDiffMode ? () => {
                        const currentTabId = tab.id
                        // If it's a new file (no original content), close the tab
                        // Otherwise, revert to original content and exit diff mode
                        if (!tab.originalContent || tab.originalContent === '') {
                          closeTab(currentTabId)
                        } else {
                          // Revert to original content and exit diff mode
                          setTabs(prevTabs => prevTabs.map(t =>
                            t.id === currentTabId
                              ? { ...t, content: t.originalContent || '', isDiffMode: false, isDirty: false }
                              : t
                          ))
                        }
                        if (onProposalHandled) onProposalHandled(false, currentFileProposal?.path)
                        
                        // Notify team to discard this file too
                        if (onAgentFilesDiscarded && currentFileProposal) {
                          onAgentFilesDiscarded([{
                            path: currentFileProposal.path,
                            action: currentFileProposal.action === 'create' ? 'created' : 'updated'
                          }])
                        }
                      } : undefined}
                      totalProposals={fileProposals.filter(p => proposalStates[p.path] === 'pending').length}
                      onAcceptAll={fileProposals.filter(p => proposalStates[p.path] === 'pending').length > 1 && onAcceptAll ? async () => {
                        console.log('✅ [EditorPane] KEEP ALL (single editor mode) clicked - saving all pending proposals')
                        const pendingProposals = fileProposals.filter(p => proposalStates[p.path] === 'pending')
                        console.log(`📦 [EditorPane] Saving ${pendingProposals.length} proposals...`)
                        
                        // Save each file first
                        for (const proposal of pendingProposals) {
                          console.log(`💾 [EditorPane] Saving file: ${proposal.path}`)
                          const saveResult = await saveFileProposal(proposal)
                          
                          if (saveResult.success) {
                            console.log(`✅ [EditorPane] File saved: ${proposal.path}`)
                          } else {
                            console.error(`❌ [EditorPane] Failed to save ${proposal.path}:`, saveResult.error)
                            alert(`Failed to save ${proposal.path}: ${saveResult.error}`)
                            return // Stop if any file fails
                          }
                        }
                        
                        console.log(`✅ [EditorPane] All files saved, calling onAcceptAll to batch-accept`)
                        // Now accept all at once
                        await onAcceptAll()
                      } : undefined}
                    />
                  </div>
                </div>
              )
            })()
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-hidden bg-[#181818]">
          <WelcomeScreen onAgentMode={onAgentMode} />
        </div>
      )}

      {/* Save confirmation dialog */}
      {pendingCloseTab && (() => {
        const tab = tabs.find(t => t.id === pendingCloseTab)
        if (!tab) return null
        
        return (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-[#252526] border border-[#1a1a1a] rounded-lg shadow-2xl overflow-hidden min-w-[400px]">
              <div className="px-6 py-4 border-b border-[#1a1a1a]">
                <h3 className="text-[14px] font-semibold text-white">Save Changes?</h3>
              </div>
              <div className="px-6 py-4">
                <p className="text-[13px] text-[#cccccc] mb-4">
                  Do you want to save the changes you made to <span className="font-medium text-white">{tab.name}</span>?
                </p>
                <p className="text-[12px] text-[#858585]">
                  Your changes will be lost if you don't save them.
                </p>
              </div>
              <div className="px-6 py-4 border-t border-[#1a1a1a] flex items-center justify-end gap-2">
                <button
                  onClick={handleCancel}
                  className="px-4 py-1.5 text-[13px] text-[#cccccc] hover:bg-[#2d2d30] rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDontSave}
                  className="px-4 py-1.5 text-[13px] text-[#cccccc] hover:bg-[#2d2d30] rounded transition-colors"
                >
                  Don't Save
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-1.5 text-[13px] bg-[#0e639c] hover:bg-[#1177bb] text-white rounded transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Terraform to Pulumi Conversion Modal */}
      <TerraformToPulumiModal
        isOpen={isConvertModalOpen}
        onClose={() => setIsConvertModalOpen(false)}
        selectedRepo={selectedRepo}
        terraformFiles={currentTerraformFile ? [currentTerraformFile] : []}
        onRefreshFileTree={onRefreshFileTree}
      />

      {/* Create PR Shortcut Modal */}
      {showPRShortcut && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm">
          <div className="bg-gradient-to-br from-[#1a1a1a] to-[#252526] border border-[#3e3e42] rounded-xl shadow-2xl overflow-hidden min-w-[500px] max-w-[550px]">
            {/* Header with gradient accent */}
            <div className="relative px-6 py-5 border-b border-[#3e3e42] bg-gradient-to-r from-emerald-600/10 to-green-600/10">
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-600/5 via-green-600/5 to-emerald-600/5" style={{ backgroundSize: '200% 100%', animation: 'shimmer 4s ease-in-out infinite' }} />
              <h3 className="relative text-[16px] font-bold text-white flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Create Pull Request
              </h3>
              <p className="relative text-[12px] text-[#a0a0a0] mt-1">Commit and push your changes to GitHub</p>
            </div>
            
            {/* Content */}
            <div className="px-6 py-6">
              <p className="text-[14px] text-[#d4d4d4] mb-5 leading-relaxed">
                Ready to commit your changes? The chat panel will guide you through creating a pull request.
              </p>
              
              <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg p-5 mb-5 relative overflow-hidden">
                {/* Subtle gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/5 to-transparent pointer-events-none" />
                
                <p className="relative text-[13px] text-[#858585] mb-3 font-medium">
                  What happens next:
                </p>
                <ul className="relative text-[13px] text-[#cccccc] space-y-2.5">
                  <li className="flex items-start gap-3">
                    <span className="text-emerald-500 mt-0.5">✓</span>
                    <span>Review your file changes</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-emerald-500 mt-0.5">✓</span>
                    <span>Create a new branch automatically</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-emerald-500 mt-0.5">✓</span>
                    <span>Commit and push to GitHub</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-emerald-500 mt-0.5">✓</span>
                    <span>Open a pull request in one click</span>
                  </li>
                </ul>
              </div>
              
              <div className="flex items-center gap-2 text-[12px] text-[#858585] bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg px-4 py-3">
                <i className="codicon codicon-lightbulb text-amber-500" style={{ fontSize: 14 }} />
                <span>
                  <span className="font-medium text-[#cccccc]">Pro tip:</span> Press <kbd className="mx-1 px-2 py-0.5 bg-[#1e1e1e] border border-[#3e3e42] rounded text-[11px] font-mono text-white">⌘ Shift P</kbd> anytime to open this
                </span>
              </div>
            </div>
            
            {/* Footer with buttons */}
            <div className="px-6 py-5 border-t border-[#3e3e42] bg-[#1a1a1a] flex items-center justify-end gap-3">
              <button
                onClick={() => setShowPRShortcut(false)}
                className="px-5 py-2 text-[13px] text-[#cccccc] hover:text-white hover:bg-[#2d2d30] rounded-lg transition-all duration-200 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowPRShortcut(false)
                  // Use the custom PR shortcut handler instead
                  if (onPRShortcut) {
                    onPRShortcut()
                  } else if (onAgentMode) {
                    onAgentMode()
                  }
                }}
                className="relative overflow-hidden rounded-lg shadow-md shadow-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/30 transition-all group"
              >
                {/* Animated gradient background (same as Create PR button) */}
                <div 
                  className="absolute inset-0 rounded-lg bg-gradient-to-r from-emerald-600 via-green-600 to-emerald-600 transition-all duration-300 group-hover:scale-105"
                  style={{
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 3s ease-in-out infinite',
                    boxShadow: '0 0 20px rgba(16, 185, 129, 0.2)'
                  }}
                />
                
                {/* Glow effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-400/0 via-emerald-400/30 to-emerald-400/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl" />
                
                {/* Content */}
                <div className="relative flex items-center justify-center gap-2 px-5 py-2 text-white text-[13px] font-semibold tracking-wide">
                  <i className="codicon codicon-comment-discussion" style={{ fontSize: 14 }} />
                  <span>Open Chat Panel</span>
                  <svg className="w-3 h-3 transform group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
                
                {/* Border shine effect */}
                <div className="absolute inset-0 rounded-lg border border-white/20 group-hover:border-white/30 transition-colors" />
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Resource Definition Modal */}
      {showDefinition && (
        <ResourceDefinition 
          resourceType={showDefinition} 
          onClose={() => setShowDefinition(null)} 
        />
      )}
      
      {/* Resource Analysis Modal (Cost, Security, Dependencies) */}
      {resourceAnalysis && (
        <ResourceAnalysis
          type={resourceAnalysis.type}
          resourceType={resourceAnalysis.resourceType}
          resourceName={resourceAnalysis.resourceName}
          resourceBlock={resourceAnalysis.resourceBlock}
          allCode={tabs.filter(t => t.language === 'hcl').map(t => t.content).join('\n\n')}
          onClose={() => setResourceAnalysis(null)}
        />
      )}
    </div>
  )
}

