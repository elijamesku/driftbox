'use client'

import { useState, useEffect, useRef, useCallback } from 'react' 
import { useRouter } from 'next/navigation' 
import { isDesktop } from '@/utils/desktopBridge'
import { useAuth } from '@/contexts/AuthContext'
import { useGitHub } from '@/contexts/GitHubContext'
import { useIDE } from '@/contexts/IDEContext'
import { checkGitStatus, sendGitHubTokenToElectron, type GitStatusState, type GitStatusRefs } from './utils/gitStatus'
import { 
  enrichProposalWithExistingContent, 
  getNextPendingProposal, 
  filterAcceptedProposals, 
  cleanAcceptedStates,
  type FileProposal,
  type ProposalState 
} from './utils/fileProposals'
// Persistence now handled by IDEContext
import { fetchTeamRepos, getTeamWorkspaceEntryId, handleTeamWorkspaceEntry } from './utils/teamWorkspace'
import { isAutoSyncAvailable, startAutoSync, stopAutoSync, registerAutoSyncListeners, type AutoSyncRefs } from './utils/autoSync'
import { setupShortcuts, type ShortcutHandlers, type CopyContext } from './utils/shortcuts'
import { canStage, getContentFromEditor, getContentFromDisk, getOriginalFromGitHead, shouldWarnNoChanges } from './utils/staging'
// DISABLED: usePreloadData was blocking UI on startup
// import { usePreloadData } from '@/hooks/usePreloadData'
import { useIndexCodebase, useParseGitHubRepo } from '@/hooks/useInfrastructureData'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import { useTeamCollaboration } from '@/hooks/useTeamCollaboration'
import { useStaging } from '@/hooks/useStaging'
import { setIDETopBarControls } from '@/hooks/useIDETopBarControls'
import Sidebar from './github/Sidebar'
import EditorPane from './editor/EditorPane'
import ChatPanel from './chat/ChatPanel'
import TopBar from './swag/TopBar'
import Terminal from './swag/Terminal'
import StatusBar from './chat/StatusBar'
import TeamPresence from './chat/TeamPresence'
import StagingPanel from './chat/StagingPanel'
// FileLockIndicator moved to Sidebar for better UX
import DependencyGraph from './chat/DependencyGraph'
import DependencyNotificationPanel from './editor/DependencyNotificationPanel'
import ShortcutsOverlay from './swag/ShortcutsOverlay' 
import GitHubActionsModal from './github/githubActions'

// ProposalDiffView removed - using EditorPane's built-in diff capabilities instead

export default function IDELayout() {
  const router = useRouter()
  const { token, user } = useAuth()
  const { githubToken, repos: githubRepos } = useGitHub()
  
  // ========== IDE Context State (persisted, prevents re-renders) ==========
  const {
    selectedRepo, setSelectedRepo,
    selectedFile, setSelectedFile,
    currentTeamId, setCurrentTeamId,
    teamRepoNames, setTeamRepoNames,
    isSidebarOpen, setIsSidebarOpen,
    isChatOpen, setIsChatOpen,
    isTerminalOpen, setIsTerminalOpen,
    sidebarTab, setSidebarTab,
    toggleSidebar, toggleTerminal
  } = useIDE()
  
  // ========== Local UI State (component-specific) ==========
  const [isNotificationPopupOpen, setIsNotificationPopupOpen] = useState(false)
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false)
  const [showStagingPanel, setShowStagingPanel] = useState(false)
  const [showDependencyGraph, setShowDependencyGraph] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [isGitHubActionsOpen, setIsGitHubActionsOpen] = useState(false)
  const [stagingReloadKey, setStagingReloadKey] = useState(0)
  
  // ========== Repository State (local, not persisted) ==========
  const [gitStatus, setGitStatus] = useState<GitStatusState | null>(null)
  const [deletedFilePath, setDeletedFilePath] = useState<string | null>(null)
  
  // ========== Team Collaboration State ==========
  const [prIntent, setPrIntent] = useState<'work-in-progress' | 'ready-for-pr'>('work-in-progress')
  
  // Real-time collaboration (Figma-style)
  const {
    isConnected: isTeamConnected,
    onlineUsers,
    fileActivity,
    recentChanges,
    cursorPositions,
    conflictWarning,
    chatMessages,
    typingUsers,
    notifyFileOpen,
    notifyFileClose,
    notifyFileChange,
    notifyPRIntentChange,
    createTeamPR,
    sendChatMessage,
    setTyping,
    // Intent signaling
    myIntent,
    userIntents,
    notifyIntentChange,
    // File locking (passed to Sidebar)
    fileLocks,
    acquireLock,
    releaseLock,
    // Dependencies
    dependencyGraph,
    dependencyNotifications,
    fetchDependencyGraph,
    clearDependencyNotification,
    // Live editing
    notifyTextChange,
    notifyCursorMove,
    remoteTextChanges,
    notifyFilesUpdated,
    notifyFilesDiscarded,
    setOnFilesUpdated,
    setOnStagingCleared,
    // Activity status & PR file locking
    myActivityStatus,
    setActivityStatus,
    lockedFiles,
    lockFilesForPR,
    unlockFilesFromPR,
    isFileLocked
  } = useTeamCollaboration(currentTeamId, user?.id || null, user?.full_name || user?.email)
  
  // Staging functionality
  const { stageFile, stageFiles, clearStaging, isStaging } = useStaging(
    currentTeamId,
    selectedRepo?.full_name || null,
    token,
    user?.id,
    user?.full_name || user?.email,
    setActivityStatus // Notify team when staging (warns of incoming PR)
  )
  
  // ========== File & Editor State ==========
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 })
  const [currentFileLanguage, setCurrentFileLanguage] = useState<string>('TypeScript JSX')
  const [errorCount, setErrorCount] = useState(0)
  const [warningCount, setWarningCount] = useState(0)
  
  // ========== File Proposals State (AI Agent) ==========
  const [fileProposal, setFileProposal] = useState<any>(null)
  const [fileProposals, setFileProposals] = useState<any[]>([])
  const [proposalStates, setProposalStates] = useState<Record<string, 'pending' | 'accepted' | 'rejected'>>({})
  const [proposalChangeTimer, setProposalChangeTimer] = useState<NodeJS.Timeout | null>(null)
  const proposalChangeTimerRef = useRef<NodeJS.Timeout | null>(null)
  
  // ========== Navigation State ==========
  const [canNavigatePrev, setCanNavigatePrev] = useState(false)
  const [canNavigateNext, setCanNavigateNext] = useState(false)
  const [onNavigatePrev, setOnNavigatePrev] = useState<(() => void) | null>(null)
  const [onNavigateNext, setOnNavigateNext] = useState<(() => void) | null>(null)
  
  // DISABLED: Preload was blocking UI on startup - data now loads on-demand when you open each view
  // usePreloadData(selectedRepo)
  
  // Fetch team repos when entering a team workspace
  // Skip if teamRepoNames already populated (restored from context)
  useEffect(() => {
    if (!currentTeamId || !token) {
      if (teamRepoNames.length > 0) setTeamRepoNames([])
      return
    }
    
    // Don't refetch if we already have repos (restored from context)
    if (teamRepoNames.length > 0) return
    
    fetchTeamRepos(currentTeamId, token).then(repos => {
      setTeamRepoNames(repos)
      console.log('🏢 [Team Workspace] Loaded team repos:', repos.length)
    })
  }, [currentTeamId, token, teamRepoNames.length, setTeamRepoNames])
  
  // NOTE: IDE state persistence is now handled by IDEContext automatically
  
  // Listen for deep link navigation (team invites, etc.)
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.onNavigate) {
      (window as any).electronAPI.onNavigate((path: string) => {
        console.log('🔗 [Deep Link] Navigating to:', path)
        router.push(path)
      })
    }
  }, [router])
  
  // Check for team workspace entry from team details page
  useEffect(() => {
    const enterTeamWorkspaceId = getTeamWorkspaceEntryId()
    if (enterTeamWorkspaceId && !currentTeamId && token) {
      handleTeamWorkspaceEntry(
        enterTeamWorkspaceId,
        token,
        setCurrentTeamId,
        setTeamRepoNames,
        selectedRepo,
        setSelectedRepo,
        setSelectedFile
      )
    }
  }, [currentTeamId, token, selectedRepo])
  
  // NOTE: Team workspace is now entered manually via Profile modal
  // The old auto-detection logic has been removed to prevent conflicts
  
  // Notify team when active file changes (works for both file tree and tab clicks)
  // activeFilePath is updated by EditorPane when ANY tab becomes active (including tab clicks)
  useEffect(() => {
    if (activeFilePath && selectedRepo && currentTeamId && isTeamConnected) {
      notifyFileOpen(selectedRepo.full_name, activeFilePath)
      console.log('📢 Notified team: opened', activeFilePath)
    }
  }, [activeFilePath, selectedRepo, currentTeamId, isTeamConnected, notifyFileOpen])
  
  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (proposalChangeTimerRef.current) {
        clearTimeout(proposalChangeTimerRef.current)
      }
    }
  }, [])

  // Refs to prevent excessive git status calls
  const gitStatusCheckInProgressRef = useRef(false)
  const lastGitStatusCheckRef = useRef<number>(0)
  const refreshGitStatusRef = useRef<(() => void) | null>(null)
  const resetOriginalContentRef = useRef<(() => void) | null>(null)
  const previousHasChangesRef = useRef<boolean | null>(null)
  const refreshRepoListRef = useRef<(() => Promise<any[] | undefined>) | null>(null)
  const clearAcceptedProposalsRef = useRef<(() => void) | null>(null)
  const showTemplatesRef = useRef<(() => void) | null>(null)
  const [hasSuggestions, setHasSuggestions] = useState(false)

  // Git status refs object for utility function
  const gitStatusRefs: GitStatusRefs = {
    gitStatusCheckInProgressRef,
    lastGitStatusCheckRef,
    previousHasChangesRef,
    resetOriginalContentRef
  }

  // Wrapper for checkGitStatus utility
  const handleCheckGitStatus = useCallback((repo: typeof selectedRepo) => {
    checkGitStatus(repo, gitStatusRefs, setGitStatus)
  }, [])

  // Send GitHub token to Electron for git authentication
  useEffect(() => {
    sendGitHubTokenToElectron(githubToken)
  }, [githubToken])

  // Expose refresh function via ref
  useEffect(() => {
    refreshGitStatusRef.current = () => {
      if (selectedRepo) {
        handleCheckGitStatus(selectedRepo)
      }
    }
  }, [selectedRepo, handleCheckGitStatus])

  // Check git status when repo is first selected (defer to avoid blocking UI)
  useEffect(() => {
    if (selectedRepo) {
      previousHasChangesRef.current = null // Reset tracking when repo changes
      // Reset debounce timer when repo changes to allow immediate check
      lastGitStatusCheckRef.current = 0
      // Defer git status check to let UI render first
      setTimeout(() => handleCheckGitStatus(selectedRepo), 100)
    } else {
      setGitStatus(null)
      previousHasChangesRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepo?.full_name, handleCheckGitStatus])

  // Initial codebase indexing when repo is selected
  // Trigger after parse completes (not with fixed delay) to ensure proper sequencing
  const indexCodebaseMutation = useIndexCodebase()
  const parseMutation = useParseGitHubRepo()
  const indexedRepoRef = useRef<string | null>(null) // Track which repo we've triggered indexing for
  
  useEffect(() => {
    if (selectedRepo && isDesktop) {
      const [owner, repo] = selectedRepo.full_name.split('/')
      const branch = (selectedRepo as any).default_branch || 'main'
      const repoKey = `${owner}/${repo}`
      const indexStatusKey = `codebase_indexed_${owner}_${repo}`
      const alreadyIndexed = localStorage.getItem(indexStatusKey)
      
      // Check if parse completed for this repo
      // Parse mutation isSuccess means a parse completed, but we need to verify it's for this repo
      // We'll use a simpler approach: if parse is successful and we haven't indexed this repo yet, trigger indexing
      // The shared state in useParseGitHubRepo ensures only one parse happens, so if isSuccess is true,
      // it means the current repo was parsed (since Dashboard triggers parse for the selected repo)
      const parseCompleted = parseMutation.isSuccess && !parseMutation.isPending
      
      if (!alreadyIndexed && token && !indexCodebaseMutation.isPending && parseCompleted && indexedRepoRef.current !== repoKey) {
        console.log('📚 [IDELayout] Parse completed, deferring codebase indexing to avoid blocking UI...')
        indexedRepoRef.current = repoKey
        // Defer indexing to avoid blocking UI
        setTimeout(() => {
          indexCodebaseMutation.mutate(
            { owner, repo },
            {
              onSuccess: () => {
                console.log('✅ [IDELayout] Codebase indexed successfully')
              },
              onError: (error) => {
                console.error('❌ [IDELayout] Codebase indexing failed:', error.message)
                indexedRepoRef.current = null // Reset on error so we can retry
              }
            }
          )
        }, 500) // Delay 500ms to let UI render first
      }
    }
    
    // Reset indexed repo ref when repo changes
    if (selectedRepo) {
      const [owner, repo] = selectedRepo.full_name.split('/')
      const repoKey = `${owner}/${repo}`
      if (indexedRepoRef.current && indexedRepoRef.current !== repoKey) {
        indexedRepoRef.current = null
      }
    }
  }, [selectedRepo, token, isDesktop, indexCodebaseMutation, parseMutation.isSuccess, parseMutation.isPending])

  const handleFileClick = (file: any) => {
    console.log('File clicked:', file)
    if (file.type === 'file') {
      setSelectedFile(file)
      setFileProposal(null) // Clear any active proposal when opening normal file
    }
  }

  const [onProposalAccept, setOnProposalAccept] = useState<(() => void) | null>(null)
  const shouldCallAcceptRef = useRef(false)
  
  // Clear accepted proposals after PR is created
  const clearAcceptedProposals = useCallback(() => {
    console.log('🧹 [IDELayout] Clearing accepted proposals after PR creation')
    setFileProposals(prev => {
      const filtered = filterAcceptedProposals(prev, proposalStates)
      console.log(`🧹 [IDELayout] Removed ${prev.length - filtered.length} accepted proposals`)
      return filtered
    })
    setProposalStates(prev => cleanAcceptedStates(prev))
  }, [proposalStates])
  
  // Clear ALL proposals (for switching repos in team workspace)
  const clearAllProposals = useCallback(() => {
    console.log('🧹 [IDELayout] Clearing ALL proposals (repo switch in team workspace)')
    setFileProposals([])
    setProposalStates({})
  }, [])
  
  // Handle repo selection - clear proposals when switching in team workspace
  const handleRepoSelect = useCallback((repo: typeof selectedRepo) => {
    // If in team workspace and switching to a different repo, clear proposals
    if (currentTeamId && selectedRepo && repo && selectedRepo.full_name !== repo.full_name) {
      console.log('🧹 [IDELayout] Switching repos in team workspace - clearing agent proposals')
      clearAllProposals()
    }
    setSelectedRepo(repo)
    
    // Start background terraform init (downloads providers silently if needed)
    if (repo && window.electronAPI?.terraformInitBackground) {
      const [owner, repoName] = repo.full_name.split('/')
      window.electronAPI.terraformInitBackground(owner, repoName).then(result => {
        if (result.skipped) {
          console.log(`✅ [IDELayout] Providers already cached for ${repo.full_name}`)
        } else if (result.started) {
          console.log(`🔄 [IDELayout] Background provider download started for ${repo.full_name}`)
        }
      })
    }
  }, [currentTeamId, selectedRepo, clearAllProposals])
  
  // Handle import generation - auto-select repo and trigger generation
  useEffect(() => {
    // Skip if we've already handled this import
    if (importGenerationHandledRef.current) return
    
    const importRepoStr = sessionStorage.getItem('import_selected_repo')
    const importPrompt = sessionStorage.getItem('import_generation_prompt')
    const importRepo = sessionStorage.getItem('import_generation_repo')
    
    // Step 1: Auto-select the repo if we have import data and repos are loaded
    if (importRepoStr && !selectedRepo && githubRepos.length > 0) {
      try {
        const repoData = JSON.parse(importRepoStr)
        // Find the repo in the GitHub repos list
        const matchingRepo = githubRepos.find((r: any) => r.full_name === repoData.full_name)
        
        if (matchingRepo) {
          console.log('✅ Auto-selecting repo from import:', matchingRepo.full_name)
          // Use handleRepoSelect to properly select the repo (triggers all necessary setup)
          handleRepoSelect({
            id: matchingRepo.id,
            name: matchingRepo.name,
            full_name: matchingRepo.full_name,
            default_branch: matchingRepo.default_branch || 'main'
          })
          sessionStorage.removeItem('import_selected_repo')
          // Don't trigger chat yet - wait for repo to be fully selected and workspace to load
          return
        } else {
          console.warn('⚠️ Import repo not found in GitHub repos:', repoData.full_name)
          importGenerationHandledRef.current = true // Mark as handled even if repo not found
        }
      } catch (e) {
        console.error('Failed to parse import repo data:', e)
        importGenerationHandledRef.current = true
      }
    }
    
    // Step 2: Once repo is selected and workspace is loading, trigger chat generation
    // Wait a bit for workspace to initialize (file tree, git status, etc.)
    if (selectedRepo && importPrompt && importRepo === selectedRepo.full_name && !importGenerationHandledRef.current) {
      // Mark as handled to prevent multiple triggers
      importGenerationHandledRef.current = true
      
      // Give workspace time to load (file tree, git status, etc.)
      const workspaceLoadDelay = 2000 // 2 seconds for workspace to fully initialize
      
      setTimeout(() => {
        // Open chat if not already open
        if (!isChatOpen) {
          setIsChatOpen(true)
        }
        
        const importMode = sessionStorage.getItem('import_generation_mode') || 'agent'
        
        // Switch to agent mode
        if (importMode === 'agent' && setAgentModeRef.current) {
          setAgentModeRef.current()
        }
        
        // Set flag for ChatPanel to auto-send
        sessionStorage.setItem('auto_send_chat_message', 'true')
        console.log('✅ Triggering chat generation for imported resources')
      }, workspaceLoadDelay)
    }
  }, [selectedRepo, isChatOpen, githubRepos, handleRepoSelect])
  
  // Handler for accepting all proposals at once (for "Keep all" button)
  const handleAcceptAll = useCallback(async () => {
    console.log('✅✅✅ [IDELayout] HANDLE ACCEPT ALL - Accepting all pending proposals at once')
    
    // Clear any existing timers
    if (proposalChangeTimerRef.current) {
      clearTimeout(proposalChangeTimerRef.current)
      proposalChangeTimerRef.current = null
      setProposalChangeTimer(null)
    }
    
    // Clear current proposal immediately to remove diff view
    setFileProposal(null)
    
    // Mark ALL pending proposals as accepted in one state update
    setProposalStates(prev => {
      const updated: Record<string, 'pending' | 'accepted' | 'rejected'> = { ...prev }
      fileProposals.forEach(p => {
        if (updated[p.path] === 'pending') {
          updated[p.path] = 'accepted'
        }
      })
      console.log('✅✅✅ [IDELayout] Marked all proposals as accepted:', updated)
      return updated
    })
    
    // Call the accept callback since all are now accepted (shows PR button)
    console.log('✅✅✅ [IDELayout] Calling onProposalAccept callback to show PR button')
    if (onProposalAccept) {
      setTimeout(() => {
        onProposalAccept()
      }, 100) // Small delay to ensure state updates
    }
    
    // Don't clear proposals - keep them for PR button. They'll be cleared after PR is created.
    console.log('✅✅✅ [IDELayout] Keeping accepted proposals for PR button')
  }, [fileProposals, onProposalAccept])

  // Ref for setting agent mode in chat
  const setAgentModeRef = useRef<(() => void) | null>(null)
  // Ref for opening search modal
  const openSearchRef = useRef<(() => void) | null>(null)
  // Ref for refreshing file tree
  const refreshFileTreeRef = useRef<(() => void) | null>(null)
  // Ref for adding messages to chat
  const addMessageRef = useRef<((message: any) => void) | null>(null)
  // Ref to track if we've already handled import generation (prevent multiple triggers)
  const importGenerationHandledRef = useRef(false)
  
  // Register file tree refresh callback for team collaboration (auto-refresh when teammate creates files)
  useEffect(() => {
    setOnFilesUpdated(() => {
      if (refreshFileTreeRef.current) {
        console.log('🔄 [Team] Auto-refreshing file tree (teammate created files)')
        refreshFileTreeRef.current()
      }
      // Also refresh git status so the yellow staged indicator shows
      if (refreshGitStatusRef.current) {
        console.log('🔄 [Team] Auto-refreshing git status (teammate created files)')
        refreshGitStatusRef.current()
      }
    })
  }, [setOnFilesUpdated])
  
  // Register staging reload callback (auto-reload when teammate creates PR)
  useEffect(() => {
    setOnStagingCleared(() => {
      console.log('🔄 [Team] Staging cleared by teammate - reloading staging panel')
      setStagingReloadKey(prev => prev + 1)
      
      // Also reset local git working directory to match remote
      // When teammate creates PR, their changes are on GitHub, so we should sync local
      if (selectedRepo && typeof window !== 'undefined' && (window as any).electronAPI) {
        const [owner, repo] = selectedRepo.full_name.split('/')
        console.log(`🔄 [Team] Resetting local changes to sync with remote after teammate's PR`)
        
        // First reset local changes, then pull
        if ((window as any).electronAPI.gitReset) {
          ;(window as any).electronAPI.gitReset(selectedRepo.full_name).then((resetResult: any) => {
            if (resetResult.success) {
              // Now pull latest from remote
              ;(window as any).electronAPI.getGitHubToken?.().then((tokenResult: any) => {
                const githubToken = tokenResult?.token
                if ((window as any).electronAPI.gitPull) {
                  ;(window as any).electronAPI.gitPull(owner, repo, 'main', githubToken).then((pullResult: any) => {
                    if (pullResult.success) {
                      console.log('✅ [Team] Local working directory synced with remote')
                      // Refresh git status and file tree
                      if (refreshGitStatusRef.current) refreshGitStatusRef.current()
                      if (refreshFileTreeRef.current) refreshFileTreeRef.current()
                    }
                  })
                }
              })
            }
          })
        }
      }
    })
  }, [setOnStagingCleared, selectedRepo])
  
  // Auto-sync: Start watching repo for GitHub changes when a repo is selected
  const autoSyncListenerRef = useRef<((data: any) => void) | null>(null)
  const autoBehindListenerRef = useRef<((data: any) => void) | null>(null)
  const [commitsBehind, setCommitsBehind] = useState<number>(0)
  
  useEffect(() => {
    if (!isAutoSyncAvailable() || !selectedRepo) return
    
    const [owner, repo] = selectedRepo.full_name.split('/')
    const isTeamWorkspace = !!currentTeamId
    
    // Start auto-sync with team workspace flag for faster polling
    startAutoSync(owner, repo, isTeamWorkspace)
    
    // Register event listeners
    const autoSyncRefs: AutoSyncRefs = {
      reloadOpenTabsRef,
      refreshFileTreeRef,
      refreshGitStatusRef
    }
    registerAutoSyncListeners(autoSyncListenerRef, autoBehindListenerRef, setCommitsBehind, autoSyncRefs)
    
    // Cleanup - stop watching but keep listeners (they're reused)
    return () => stopAutoSync()
  }, [selectedRepo?.full_name, currentTeamId])
  
  // Ref for saving all tabs in editor
  const saveAllTabsRef = useRef<(() => Promise<void>) | null>(null)
  // Ref for reloading all open tabs from disk (after git sync)
  const reloadOpenTabsRef = useRef<(() => Promise<void>) | null>(null)

  // Handle file proposals - defined BEFORE handleRepoCreated since it depends on this
  const handleFileProposal = useCallback(async (proposal: any, onAccept?: () => void) => {
    // Store the accept callback
    if (onAccept) {
      setOnProposalAccept(() => onAccept)
    }
    
    // Fetch existing file content if the file exists
    let enrichedProposal = { ...proposal }
    if (selectedRepo && proposal.path && proposal.action !== 'delete') {
      try {
        const [owner, repo] = selectedRepo.full_name.split('/')
        
        // Check if it's desktop mode
        const { isDesktop, readFile } = await import('@/utils/desktopBridge')
        
        let existingContent = ''
        
        if (isDesktop) {
          // Desktop: Read file locally
          const result = await readFile(owner, repo, proposal.path)
          if (result.success && result.content) {
            existingContent = result.content
            console.log(`📄 [handleFileProposal] Fetched existing file content (${existingContent.length} chars) from local file`)
          }
        } else {
          // Web: Fetch from GitHub API
          if (token) {
            const response = await fetch(getApiEndpoint(`/github/repos/${owner}/${repo}/contents/${proposal.path}`), {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            })
            
            if (response.ok) {
              const data = await response.json()
              if (data.content && data.encoding === 'base64') {
                existingContent = atob(data.content.replace(/\s/g, ''))
                console.log(`📄 [handleFileProposal] Fetched existing file content (${existingContent.length} chars) from GitHub`)
              }
            }
          }
        }
        
        // If we found existing content, add it to the proposal
        if (existingContent) {
          enrichedProposal = {
            ...proposal,
            oldContent: existingContent,
            newContent: existingContent.trim() + '\n\n' + proposal.newContent, // Combine existing + new
            action: 'edit' // Change action to 'edit' if file exists
          }
          console.log(`✅ [handleFileProposal] Enriched proposal with existing content for diff view`)
          console.log(`   Old content: ${existingContent.length} chars`)
          console.log(`   New content: ${enrichedProposal.newContent.length} chars (existing + new)`)
        }
      } catch (error) {
        console.error('[handleFileProposal] Failed to fetch existing file content:', error)
        // Continue with original proposal if fetch fails
      }
    }
    
    // Add to proposals array (Cursor-style stacking)
    setFileProposals(prev => {
      // Check if this proposal already exists (rejected proposals are removed, so this checks pending/accepted)
      const existingIndex = prev.findIndex(p => p.path === enrichedProposal.path)
      
      if (existingIndex >= 0) {
        // Proposal already exists - UPDATE it with new content instead of skipping
        // This handles the case where AI creates a file, then edits it in a subsequent request
        console.log('📦 [handleFileProposal] Updating existing proposal for:', enrichedProposal.path)
        const updated = [...prev]
        // Merge: keep old content as base, but use new proposed content
        const existingProposal = updated[existingIndex]
        const updatedProposal = {
          ...existingProposal,
          ...enrichedProposal,
          // For edits to previously created files, the oldContent should be what was created/saved
          oldContent: enrichedProposal.oldContent || existingProposal.newContent || existingProposal.oldContent,
          newContent: enrichedProposal.newContent,
          action: 'edit' // Mark as edit since file now exists
        }
        updated[existingIndex] = updatedProposal
        
        console.log('📦 [handleFileProposal] Updated proposal:', {
          path: updatedProposal.path,
          hasOldContent: !!updatedProposal.oldContent,
          oldContentLength: updatedProposal.oldContent?.length || 0,
          hasNewContent: !!updatedProposal.newContent,
          newContentLength: updatedProposal.newContent?.length || 0,
          action: updatedProposal.action
        })
        
        // Reset state to pending so the diff view opens again
        setProposalStates(prevStates => ({
          ...prevStates,
          [enrichedProposal.path]: 'pending'
        }))
        
        // Open the updated proposal in diff view
        if (proposalChangeTimerRef.current) {
          clearTimeout(proposalChangeTimerRef.current)
        }
        const timer = setTimeout(() => {
          console.log('📂 [handleFileProposal] Opening updated proposal in diff view:', updatedProposal.path)
          setFileProposal(updatedProposal)
        }, 150)
        proposalChangeTimerRef.current = timer
        setProposalChangeTimer(timer)
        
        return updated
      }
      
      // Add new proposal
      const newProposals = [...prev, enrichedProposal]
      
      // Initialize state as 'pending' and check if we should open
      setProposalStates(prevStates => {
        const updated: Record<string, 'pending' | 'accepted' | 'rejected'> = {
          ...prevStates,
          [enrichedProposal.path]: 'pending'
        }
        
        // Determine if we should open this proposal:
        // 1. If it's the first proposal (no proposals yet), OR
        // 2. If all existing proposals are accepted (user has accepted all previous ones)
        const isFirstProposal = prev.length === 0
        const allAccepted = prev.length > 0 && prev.every((p: any) => {
          const path = p.path as string
          const state = updated[path] || prevStates[path]
          return state === 'accepted'
        })
        
        const shouldOpen = isFirstProposal || allAccepted
        
        if (shouldOpen) {
          console.log('📂 [handleFileProposal] Opening proposal in editor:', {
            path: enrichedProposal.path,
            reason: isFirstProposal ? 'first proposal' : 'all previous accepted',
            existingProposals: prev.length,
            allAccepted
          })
          // Clear any existing timer
          if (proposalChangeTimerRef.current) {
            clearTimeout(proposalChangeTimerRef.current)
          }
          
          // Set proposal with a small delay to ensure Monaco is ready
          const timer = setTimeout(() => {
            setFileProposal(enrichedProposal)
          }, 150)
          proposalChangeTimerRef.current = timer
          setProposalChangeTimer(timer)
        } else {
          console.log('📦 [handleFileProposal] Collecting proposal silently (pending proposals still exist)')
        }
        
        return updated
      })
      
      return newProposals
    })
  }, [selectedRepo, token, githubToken, isDesktop])

  // Handle repository creation - add README.md as a file proposal and show PR button
  const handleRepoCreated = useCallback((repoName: string, repoFullName: string) => {
    console.log('🎉 [IDELayout] Repository created:', repoFullName)
    console.log('🎉 [IDELayout] Current selectedRepo:', selectedRepo?.full_name)
    
    // Wait a bit for selectedRepo to be set (since onRepoSelect is called just before this)
    // This ensures the proposal has a valid selectedRepo context
    setTimeout(() => {
      console.log('🎉 [IDELayout] Creating README proposal for new repo:', repoFullName)
      console.log('🎉 [IDELayout] SelectedRepo after delay:', selectedRepo?.full_name)
      
      // Add a message to chat about the repo creation
      if (addMessageRef.current) {
        addMessageRef.current({
          role: 'assistant',
          content: `**Repository created successfully!**\n\n**${repoFullName}**\n\nYour repository has been initialized with a README.md file. Review the changes below, click "Keep" to accept them, then click the "Push & Create Pull Request" button to commit the initial setup.`,
          mode: 'agent',
          streaming: false
        })
      }
      
      // Create a file proposal for the README.md that was auto-created
      // GitHub creates it with "# repoName" so we set that as oldContent
      const readmeProposal = {
        action: 'edit' as const,
        path: 'README.md',
        oldContent: `# ${repoName}\n`,  // What GitHub creates by default
        newContent: `# ${repoName}\n\nYour new repository\n`,  // Add description
        description: `Initialize README for ${repoName}`
      }
      
      console.log('🎉 [IDELayout] Adding README proposal to array')
      // Add the README as a file proposal so the PR button appears
      handleFileProposal(readmeProposal)
    }, 300) // Small delay to ensure repo selection state has propagated
  }, [handleFileProposal, selectedRepo, addMessageRef])

  // Global keyboard shortcuts
  const toggleShortcuts = useCallback(() => setShowShortcuts(prev => !prev), [])
  
  useEffect(() => {
    const handlers: ShortcutHandlers = {
      setAgentModeRef,
      openSearchRef,
      toggleTerminal,
      toggleSidebar,
      toggleShortcuts
    }
    const context: CopyContext = {
      selectedFile,
      selectedRepo
    }
    return setupShortcuts(handlers, context)
  }, [selectedFile?.path, selectedRepo?.full_name, toggleTerminal, toggleSidebar, toggleShortcuts])

  // Expose clearAcceptedProposals via ref
  useEffect(() => {
    clearAcceptedProposalsRef.current = clearAcceptedProposals
  }, [clearAcceptedProposals])

  // Handler for staging changes
  const handleStageChanges = async () => {
    console.log('🎯 [StageChanges] Called with:', {
      selectedFile: selectedFile?.path,
      currentTeamId,
      isStaging,
      selectedRepo: selectedRepo?.full_name
    })
    
    const stagingContext = { selectedFile, selectedRepo, currentTeamId, isStaging, hasUnsavedChanges, token, githubToken }
    if (!canStage(stagingContext)) {
      console.log('🎯 [StageChanges] Early return - missing requirements')
      return
    }
    
    // Check if there are unsaved changes and warn user
    if (hasUnsavedChanges) {
      const proceed = confirm('⚠️ You have unsaved changes!\n\nPress ⌘+S to save first, then stage.\n\nStage anyway with current saved version?')
      if (!proceed) return
    }
    
    try {
      const [owner, repo] = selectedRepo!.full_name.split('/')
      let content = ''
      let gotFromEditor = false
      
      // FIRST: Try to get content from editor tab (may have unsaved changes)
      const editorContent = await getContentFromEditor(selectedFile!.path)
      if (editorContent !== null) {
        content = editorContent
        gotFromEditor = true
      }
      
      // If not in editor, fall back to reading from disk
      if (!content) {
        const diskContent = await getContentFromDisk(owner, repo, selectedFile!.path, token)
        if (diskContent === null) {
          alert(`❌ Failed to read file`)
          return
        }
        content = diskContent
      }
      
      // Fetch original content from local git HEAD for diff comparison
      const originalContent = await getOriginalFromGitHead(owner, repo, selectedFile!.path, githubToken)
      
      // Check if content matches original (no changes detected)
      if (shouldWarnNoChanges(content, originalContent, gotFromEditor)) {
        const proceed = confirm(
          `⚠️ No changes detected in ${selectedFile!.path}.\n\n` +
          `This usually means the file was already saved.\n\n` +
          `To stage changes:\n` +
          `1. Make your edits\n` +
          `2. Stage with ⌘+Shift+S (before saving)\n` +
          `3. Then save if needed\n\n` +
          `Stage anyway?`
        )
        if (!proceed) return
      }
      
      const result = await stageFile(
        selectedFile!.path,
        content,
        originalContent,
        { ai_assisted: false }
      )
      
      console.log(`🎯 [StageChanges] Result:`, result)
      
      if (result.success) {
        if (content === originalContent) {
          alert(`⚠️ Staged ${selectedFile!.path}, but no changes detected (0 lines added/removed).\n\nMake edits and stage before saving to capture changes.`)
        } else {
          alert(`✅ Staged ${selectedFile!.path}!`)
        }
      } else {
        alert(`❌ Failed to stage: ${result.error}`)
      }
    } catch (error: any) {
      console.error('Failed to stage changes:', error)
      alert(`❌ Error: ${error.message}`)
    }
  }

  // Check if there are unsaved changes
  const hasUnsavedChanges = (gitStatus?.modifiedFiles?.length || 0) > 0 || 
                            (gitStatus?.untrackedFiles?.length || 0) > 0

  // Register IDE top bar controls with layout
  useEffect(() => {
    setIDETopBarControls({
      onToggleChat: () => setIsChatOpen(!isChatOpen),
      onToggleSidebar: () => setIsSidebarOpen(!isSidebarOpen),
      onToggleTerminal: () => setIsTerminalOpen(!isTerminalOpen),
      onRepoSelect: handleRepoSelect,
      onNavigatePrevious: onNavigatePrev || undefined,
      onNavigateNext: onNavigateNext || undefined,
      canNavigatePrevious: canNavigatePrev,
      canNavigateNext: canNavigateNext,
      onOpenSearchRef: openSearchRef,
      onRepoCreated: handleRepoCreated,
      onRefreshReposRef: refreshRepoListRef,
      currentTeamId: currentTeamId,
      teamRepos: teamRepoNames,
      selectedRepoFromParent: selectedRepo
    })
  }, [
    isChatOpen,
    isSidebarOpen,
    isTerminalOpen,
    canNavigatePrev,
    canNavigateNext,
    onNavigatePrev,
    onNavigateNext,
    currentTeamId,
    teamRepoNames,
    selectedRepo,
    handleRepoSelect,
    handleRepoCreated
  ])

  return (
      <div className="h-full w-full flex flex-col overflow-hidden bg-[#141414]">
        

      {/* Main content - ensure proper borders and no overlap */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar */}
        {isSidebarOpen && (
          <Sidebar 
            activeTab={sidebarTab} 
            setActiveTab={setSidebarTab}
            selectedRepo={selectedRepo}
            onFileClick={handleFileClick}
            onFileDeleted={(filePath) => {
              // Refresh git status after file deletion
              if (refreshGitStatusRef.current) {
                refreshGitStatusRef.current()
              }
              setDeletedFilePath(filePath)
              // Reset after a short delay to allow the effect to trigger again if needed
              setTimeout(() => setDeletedFilePath(null), 100)
            }}
            onRefreshFileTreeRef={refreshFileTreeRef}
            activeFilePath={activeFilePath}
            gitStatus={gitStatus ? {
              stagedFiles: gitStatus.stagedFiles,
              modifiedFiles: gitStatus.modifiedFiles,
              untrackedFiles: gitStatus.untrackedFiles
            } : null}
            isTeamWorkspace={!!currentTeamId}
            fileLocks={fileLocks}
            currentUserId={user?.id}
            onAcquireLock={(filePath) => selectedRepo && acquireLock(selectedRepo.full_name, filePath)}
            onReleaseLock={(filePath) => selectedRepo && releaseLock(selectedRepo.full_name, filePath)}
          />
        )}

        {/* Content area */}
        <div className="flex-1 relative">
          {/* Editor Pane - always show (handles both regular files and proposals) */}
          <div style={{ 
            display: 'flex', 
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: isTerminalOpen ? 'var(--terminal-height, 0px)' : 0,
            flexDirection: 'column'
          }}>
            <EditorPane 
              key={`editor-${currentTeamId || 'home'}`}
              selectedFile={selectedFile} 
              fileProposal={fileProposal}
              fileProposals={fileProposals}
              proposalStates={proposalStates}
              selectedRepo={selectedRepo}
              deletedFilePath={deletedFilePath}
              gitStatus={gitStatus ? {
                stagedFiles: gitStatus.stagedFiles,
                modifiedFiles: gitStatus.modifiedFiles,
                untrackedFiles: gitStatus.untrackedFiles
              } : null}
              onNavigationChange={(canPrev, canNext, onPrev, onNext) => {
                setCanNavigatePrev(canPrev)
                setCanNavigateNext(canNext)
                setOnNavigatePrev(() => onPrev)
                setOnNavigateNext(() => onNext)
              }}
              onAgentMode={() => {
                if (setAgentModeRef.current) {
                  setAgentModeRef.current()
                }
              }}
              onPRShortcut={async () => {
                // Step 1: Save all dirty tabs first
                if (saveAllTabsRef.current) {
                  await saveAllTabsRef.current()
                }
                
                // Step 2: Wait a moment for file system to sync
                await new Promise(resolve => setTimeout(resolve, 300))
                
                // Step 3: Refresh git status to pick up the saved changes
                if (refreshGitStatusRef.current) {
                  refreshGitStatusRef.current()
                }
                
                // Step 4: Wait for git status to update
                await new Promise(resolve => setTimeout(resolve, 500))
                
                // Step 5: Open chat and show changes
                setIsChatOpen(true)
                // Switch to agent mode
                if (setAgentModeRef.current) {
                  setAgentModeRef.current()
                }
                
                // Check if there are any git changes
                if (gitStatus && selectedRepo) {
                  const hasChanges = (gitStatus.modifiedFiles?.length || 0) > 0 || 
                                    (gitStatus.untrackedFiles?.length || 0) > 0 ||
                                    (gitStatus.stagedFiles?.length || 0) > 0
                  
                  if (hasChanges) {
                    // Build a summary message
                    let changesSummary = '## 📝 Ready to create a pull request!\n\n'
                    changesSummary += 'I\'ve detected the following changes:\n\n'
                    
                    const allChangedFiles: string[] = []
                    
                    if (gitStatus.modifiedFiles && gitStatus.modifiedFiles.length > 0) {
                      changesSummary += '**Modified:**\n'
                      gitStatus.modifiedFiles.forEach(file => {
                        changesSummary += `- ${file}\n`
                        allChangedFiles.push(file)
                      })
                      changesSummary += '\n'
                    }
                    
                    if (gitStatus.untrackedFiles && gitStatus.untrackedFiles.length > 0) {
                      changesSummary += '**New files:**\n'
                      gitStatus.untrackedFiles.forEach(file => {
                        changesSummary += `- ${file}\n`
                        allChangedFiles.push(file)
                      })
                      changesSummary += '\n'
                    }
                    
                    if (gitStatus.stagedFiles && gitStatus.stagedFiles.length > 0) {
                      changesSummary += '**Staged:**\n'
                      gitStatus.stagedFiles.forEach(file => {
                        changesSummary += `- ${file}\n`
                        allChangedFiles.push(file)
                      })
                      changesSummary += '\n'
                    }
                    
                    // Add the message
                    if (addMessageRef.current) {
                      addMessageRef.current({
                        role: 'assistant',
                        content: changesSummary,
                        mode: 'agent',
                        streaming: false
                      })
                    }
                    
                    // Now create file proposals for each changed file so PR button appears
                    // Read content from disk for each file and create proposals
                    const { isDesktop, readFile } = await import('@/utils/desktopBridge')
                    const [owner, repo] = selectedRepo.full_name.split('/')
                    
                    for (const filePath of allChangedFiles) {
                      try {
                        let content = ''
                        if (isDesktop) {
                          // Read from local disk
                          const result = await readFile(owner, repo, filePath)
                          if (result.success && result.content) {
                            content = result.content
                          }
                        }
                        
                        // Determine if this is a new file or modified file
                        const isNewFile = gitStatus.untrackedFiles?.includes(filePath)
                        
                        // Create a file proposal
                        const proposal = {
                          path: filePath,
                          oldContent: isNewFile ? '' : content, // Empty for new files
                          newContent: content,
                          action: isNewFile ? 'create' : 'edit'
                        }
                        
                        // Add the proposal (it will be auto-accepted since user manually edited)
                        handleFileProposal(proposal)
                      } catch (error) {
                        console.error(`Failed to read file ${filePath}:`, error)
                      }
                    }
                  } else {
                    // No changes detected
                    if (addMessageRef.current) {
                      addMessageRef.current({
                        role: 'assistant',
                        content: `No changes detected in your working directory.\n\nMake some edits to your files first, then press **⌘ Shift P** to create a pull request!`,
                        mode: 'agent',
                        streaming: false
                      })
                    }
                  }
                }
              }}
              onRefreshFileTree={() => {
                if (refreshFileTreeRef.current) {
                  refreshFileTreeRef.current()
                }
              }}
              onSaveAllTabsRef={saveAllTabsRef}
              onReloadOpenTabsRef={reloadOpenTabsRef}
              onRefreshGitStatusRef={refreshGitStatusRef}
              onResetOriginalContentRef={resetOriginalContentRef}
              onGetEditorContent={async (filePath: string) => {
                // This callback is set up by EditorPane via window.__getEditorContentForStaging
                if (typeof window !== 'undefined' && (window as any).__getEditorContentForStaging) {
                  return await (window as any).__getEditorContentForStaging(filePath)
                }
                return null
              }}
              onCursorPositionChange={(line, column, filePath) => {
                setCursorPosition({ line, column })
                // Broadcast cursor position to team members
                // Use filePath from callback directly (avoids stale state issues)
                const currentFilePath = filePath || activeFilePath || selectedFile?.path
                if (currentTeamId && currentFilePath) {
                  notifyCursorMove(currentFilePath, line, column, selectedRepo?.full_name)
                }
              }}
              onLanguageChange={(language) => {
                setCurrentFileLanguage(language)
              }}
              onDiagnosticsChange={(errors, warnings) => {
                setErrorCount(errors)
                setWarningCount(warnings)
              }}
              onActiveFileChange={(filePath) => {
                setActiveFilePath(filePath)
              }}
              onAcceptAll={handleAcceptAll}
              onProposalHandled={(accepted, proposalPath) => {
              console.log('🔄 [IDELayout] onProposalHandled called:', {
                accepted,
                proposalPath,
                fileProposalsCount: fileProposals.length,
                allProposals: fileProposals.map(p => ({ path: p.path, state: proposalStates[p.path] }))
              })
              
              // Clear any pending timer first
              if (proposalChangeTimerRef.current) {
                console.log('🔄 [IDELayout] Clearing existing proposal change timer')
                clearTimeout(proposalChangeTimerRef.current)
                proposalChangeTimerRef.current = null
                setProposalChangeTimer(null)
              }
              
              // CRITICAL: Clear current proposal FIRST to let Monaco dispose and prevent re-triggering
              console.log('🔄 [IDELayout] Clearing current fileProposal state')
              setFileProposal(null)
              console.log('🔄 [IDELayout] Current proposal cleared')
              
            // Update state and find next proposal
            if (proposalPath) {
              if (accepted) {
                // ACCEPTED: Mark as accepted (keep in array for PR button)
                console.log('🔄 [IDELayout] Marking proposal as accepted:', proposalPath)
                
                // Reset the flag
                shouldCallAcceptRef.current = false
                
                setProposalStates(prev => {
                  const updated: Record<string, 'pending' | 'accepted' | 'rejected'> = {
                    ...prev,
                    [proposalPath]: 'accepted'
                  }
                  console.log('🔄 [IDELayout] Updated proposalStates:', updated)
                  console.log('🔄 [IDELayout] All proposals:', fileProposals.map(p => ({ path: p.path, newState: updated[p.path] })))
                  
                  // Check if all are now accepted
                  const allAccepted = fileProposals.every(p => updated[p.path] === 'accepted')
                  console.log('🔄 [IDELayout] All proposals accepted?', allAccepted)
                  
                  // Find next pending proposal using the UPDATED state
                  const nextProposal = fileProposals.find(p => 
                    p.path !== proposalPath && updated[p.path] === 'pending'
                  )
                  
                  if (nextProposal) {
                    console.log('🔄 [IDELayout] Setting timer to load next proposal in 600ms:', nextProposal.path)
                    const timer = setTimeout(() => {
                      console.log('🔄 [IDELayout] Timer fired - loading next proposal:', nextProposal.path)
                      setFileProposal(nextProposal)
                    }, 600)
                    proposalChangeTimerRef.current = timer
                    setProposalChangeTimer(timer)
                  } else {
                    console.log('🔄 [IDELayout] No more pending proposals - PR button should now be visible!')
                    // Mark that we should call the accept callback after state update
                    shouldCallAcceptRef.current = true
                  }
                  
                  return updated
                })
                
                // Call onProposalAccept outside of state updater to avoid React warning
                // Use setTimeout to ensure this runs after the state update completes
                if (shouldCallAcceptRef.current && onProposalAccept) {
                  setTimeout(() => {
                    console.log('🔄 [IDELayout] Calling onProposalAccept callback (after state update)')
                    onProposalAccept()
                    shouldCallAcceptRef.current = false
                  }, 0)
                }
                } else {
                  // REJECTED: Remove from array entirely (don't keep rejected proposals)
                  console.log('🔄 [IDELayout] Removing rejected proposal from array:', proposalPath)
                  
                  // Filter out rejected proposal and find next in one go
                  const filteredProposals = fileProposals.filter(p => p.path !== proposalPath)
                  const nextProposal = filteredProposals.find(p => proposalStates[p.path] === 'pending')
                  
                  console.log('🔄 [IDELayout] After rejection:', {
                    removed: proposalPath,
                    remaining: filteredProposals.length,
                    nextProposal: nextProposal?.path || 'none'
                  })
                  
                  // Update proposals array
                  setFileProposals(filteredProposals)
                  
                  // Clean up state
                  setProposalStates(prev => {
                    const newStates = { ...prev }
                    delete newStates[proposalPath]
                    return newStates
                  })
                  
                  // Load next proposal if exists
                  if (nextProposal) {
                    console.log('🔄 [IDELayout] Setting timer to load next proposal in 600ms:', nextProposal.path)
                    const timer = setTimeout(() => {
                      console.log('🔄 [IDELayout] Timer fired - loading next proposal:', nextProposal.path)
                      setFileProposal(nextProposal)
                    }, 600)
                    proposalChangeTimerRef.current = timer
                    setProposalChangeTimer(timer)
                  } else {
                    console.log('🔄 [IDELayout] No more proposals - all cleared!')
                  }
                }
              }
            }}
            // Real-time collaboration props
            remoteCursors={currentTeamId && selectedFile ? Object.values(cursorPositions)
              .filter(c => c && c.user_id && c.file_path === selectedFile.path && c.user_id !== user?.id)
              .map(c => ({
                userId: c.user_id,
                userName: c.user_name || 'Unknown',
                line: c.line || 1,
                column: c.column || 1,
                color: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'][
                  (c.user_id || '').split('').reduce((a, b) => a + b.charCodeAt(0), 0) % 6
                ]
              })) : []}
            remoteTextChanges={currentTeamId && selectedRepo ? remoteTextChanges : null}
            onLocalTextChange={(filePath, fullContent) => {
              if (currentTeamId && selectedRepo) {
                notifyTextChange(selectedRepo.full_name, filePath, fullContent)
              }
            }}
            onAgentFilesAccepted={async (files) => {
              console.log('📢 [IDELayout] onAgentFilesAccepted called:', files, { currentTeamId, selectedRepo: selectedRepo?.full_name })
              if (currentTeamId && selectedRepo) {
                console.log('📢 [IDELayout] Calling notifyFilesUpdated with file content...')
                notifyFilesUpdated(selectedRepo.full_name, files)
                
                // Auto-stage to team staging area so AI changes combine with manual changes
                console.log('📦 [IDELayout] Auto-staging AI changes to team staging...')
                try {
                  // Convert to FileChange format for staging
                  const fileChanges = files.map(f => {
                    const lines = f.content.split('\n').length
                    return {
                      path: f.path,
                      content: f.content,
                      original_content: '', // AI creates new content
                      lines_added: lines,
                      lines_removed: 0
                    }
                  })
                  const result = await stageFiles(fileChanges, { ai_assisted: true })
                  if (result.success) {
                    console.log('✅ [IDELayout] AI changes staged successfully')
                  } else {
                    console.warn('⚠️ [IDELayout] Staging returned error:', result.error)
                  }
                } catch (err) {
                  console.error('❌ [IDELayout] Failed to auto-stage AI changes:', err)
                }
              }
            }}
            onAgentFilesDiscarded={(files) => {
              console.log('🗑️ [IDELayout] onAgentFilesDiscarded called:', files, { currentTeamId, selectedRepo: selectedRepo?.full_name })
              if (currentTeamId && selectedRepo) {
                console.log('🗑️ [IDELayout] Calling notifyFilesDiscarded...')
                notifyFilesDiscarded(selectedRepo.full_name, files)
              }
            }}
            isFileLocked={isFileLocked}
          />
          </div>

          {/* Terminal - positioned absolutely within editor area only (VS Code style) */}
          <Terminal 
            isOpen={isTerminalOpen} 
            onClose={() => setIsTerminalOpen(false)}
            selectedRepo={selectedRepo}
            onRefreshGitStatus={() => {
              if (refreshGitStatusRef.current) {
                refreshGitStatusRef.current()
              }
            }}
          />
        </div>

        {/* GitHub Actions Modal - Standalone */}
        {isGitHubActionsOpen && selectedRepo && (
          <GitHubActionsModal
            selectedRepo={selectedRepo}
            onClose={() => setIsGitHubActionsOpen(false)}
            onRefreshFileTree={refreshFileTreeRef.current || undefined}
          />
        )}

        {/* Chat panel - always visible */}
        <ChatPanel 
          key={`chat-${currentTeamId || 'home'}`}
          isOpen={isChatOpen} 
          onClose={() => setIsChatOpen(false)}
          selectedRepo={selectedRepo}
          onFileProposal={handleFileProposal}
          fileProposals={fileProposals}
          proposalStates={proposalStates}
          onSetAgentModeRef={setAgentModeRef}
          onAddMessageRef={addMessageRef}
          onRefreshGitStatusRef={refreshGitStatusRef}
          onRefreshRepoListRef={refreshRepoListRef}
          onClearAcceptedProposalsRef={clearAcceptedProposalsRef}
          onShowTemplatesRef={showTemplatesRef}
          onHasSuggestionsChange={setHasSuggestions}
          onRefreshFileTreeRef={refreshFileTreeRef}
          teamChatMessages={chatMessages}
          teamTypingUsers={typingUsers}
          currentUserId={user?.id || ''}
          onSendTeamMessage={sendChatMessage}
          onTeamTyping={setTyping}
          isTeamConnected={isTeamConnected}
          currentTeamId={currentTeamId}
          teamOnlineUsers={onlineUsers.map(u => ({ user_id: u.user_id, user_name: u.name }))}
          onNavigateToFile={(file, line, repo) => {
            // Navigate to file and line
            const [owner, repoName] = (repo || selectedRepo?.full_name || '').split('/')
            console.log('📍 [Navigate] Code ref click:', { file, line, repo, owner, repoName })
            handleFileClick({ 
              path: file, 
              name: file.split('/').pop() || file, 
              type: 'file',
              owner,
              repo: repoName
            })
            // TODO: Scroll to specific line after file loads
          }}
          onNotificationPopupChange={setIsNotificationPopupOpen}
          onActivityStatusChange={setActivityStatus}
          onModeDropdownChange={setIsModeDropdownOpen}
          onClearStaging={clearStaging}
        />
        
        {/* Team Presence - Figma-style collaboration indicator (only in team workspace) */}
        {currentTeamId && isTeamConnected && onlineUsers.length > 0 && (
          <TeamPresence
            onlineUsers={onlineUsers}
            fileActivity={fileActivity}
            recentChanges={recentChanges}
            cursorPositions={cursorPositions}
            currentFile={activeFilePath || selectedFile?.path}
            currentUserId={user?.id}
            currentUserCursor={cursorPosition}
            prIntent={prIntent}
            userIntent={myIntent}
            userIntents={userIntents}
            repoFullName={selectedRepo?.full_name}
            onPRIntentChange={(intent) => {
              setPrIntent(intent)
              notifyPRIntentChange(intent)
            }}
            onIntentChange={(intent) => {
              notifyIntentChange(intent)
            }}
            onCreateTeamPR={(contributors, title, description) => {
              // Create PR via WebSocket
              createTeamPR(contributors, title, description)
              // TODO: Also call backend API to actually create GitHub PR
            }}
            onOpenStaging={() => setShowStagingPanel(true)}
            notificationPopupOpen={isNotificationPopupOpen}
            modeDropdownOpen={isModeDropdownOpen}
            onNavigateToUser={(filePath, line, column) => {
              console.log(`🎯 Jumping to ${filePath} at line ${line}, col ${column}`)
              // Open the file and navigate to the line
              handleFileClick({
                path: filePath,
                name: filePath.split('/').pop() || filePath,
                type: 'file',
                line: line // This will be used to scroll to the line
              })
            }}
          />
        )}

        {/* Staging Panel - Team PR staging area */}
        {showStagingPanel && currentTeamId && (
          selectedRepo ? (
            <StagingPanel
              key={stagingReloadKey} // Reload when staging is cleared by teammate
              teamId={currentTeamId}
              repoFullName={selectedRepo.full_name}
              currentUserId={user?.id || ''}
              token={token || ''}
              onClose={() => setShowStagingPanel(false)}
              onRefreshGitStatus={refreshGitStatusRef.current || undefined}
              onRefreshFileTree={refreshFileTreeRef.current || undefined}
              onLockFilesForPR={lockFilesForPR}
              onUnlockFilesFromPR={unlockFilesFromPR}
              gitStatus={gitStatus}
            />
          ) : (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-[#0a0a0a] border border-[#333] rounded-lg p-6 max-w-md">
                <h3 className="text-white font-semibold mb-2">Select a Repository</h3>
                <p className="text-[#888] text-sm mb-4">
                  Please select a repository from the dropdown to view and manage staged changes.
                </p>
                <button
                  onClick={() => setShowStagingPanel(false)}
                  className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-gray-100"
                >
                  Close
                </button>
              </div>
            </div>
          )
        )}

        {/* Dependency Notifications - Real-time alerts when dependencies change */}
        {currentTeamId && dependencyNotifications.length > 0 && (
          <DependencyNotificationPanel
            notifications={dependencyNotifications}
            onDismiss={(index) => clearDependencyNotification(index)}
            onNavigateToFile={(file) => {
              // Find and open the file
              const filePath = file
              // Try to navigate to the file
              if (selectedRepo) {
                handleFileClick({ 
                  name: filePath.split('/').pop() || filePath, 
                  path: filePath, 
                  type: 'blob' 
                })
              }
            }}
          />
        )}

        {/* Dependency Graph Modal */}
        {showDependencyGraph && currentTeamId && (
          <DependencyGraph
            graph={dependencyGraph}
            currentResource={selectedFile?.path}
            onClose={() => setShowDependencyGraph(false)}
            onRefresh={() => {
              if (selectedRepo) {
                fetchDependencyGraph(selectedRepo.full_name)
              }
            }}
            onSelectResource={(resource, file) => {
              if (selectedRepo) {
                handleFileClick({ 
                  name: file.split('/').pop() || file, 
                  path: file, 
                  type: 'blob' 
                })
              }
            }}
          />
        )}
      </div>

      {/* Status bar */}
      <StatusBar 
        selectedRepo={selectedRepo}
        gitStatus={gitStatus}
        cursorPosition={cursorPosition}
        language={currentFileLanguage}
        errorCount={errorCount}
        warningCount={warningCount}
        onRefreshGitStatus={async () => {
          // After manual sync, reload everything (same as auto-sync)
          // Small delay to ensure files are fully written
          setTimeout(async () => {
            // Reload open tabs with fresh content from disk
            if (reloadOpenTabsRef.current) {
              console.log('🔄 [StatusBar Sync] Reloading open tabs...')
              await reloadOpenTabsRef.current()
            }
            // Refresh file tree to show new/deleted files
            if (refreshFileTreeRef.current) {
              console.log('🔄 [StatusBar Sync] Refreshing file tree...')
              refreshFileTreeRef.current()
            }
            // Refresh git status
            if (selectedRepo) {
              handleCheckGitStatus(selectedRepo)
            }
          }, 100)
        }}
        commitsBehind={commitsBehind}
        onShowTemplates={() => showTemplatesRef.current?.()}
        hasSuggestions={hasSuggestions}
      />

      {/* Keyboard Shortcuts Overlay */}
      <ShortcutsOverlay 
        isOpen={showShortcuts} 
        onClose={() => setShowShortcuts(false)} 
      />
    </div>
  )
}


