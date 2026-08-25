'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Upload, BookOpen } from 'lucide-react'
import { useGitHub } from '@/contexts'
import { useAuth } from '@/contexts/AuthContext'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import SearchModal from '../modals/SearchModal'
import SettingsModal from '../modals/SettingsModal'
import DriftboxCortexModal from '../modals/DriftboxCortexModal'
import ProfileModal from '../modals/ProfileModal'

interface TopBarProps {
  onToggleChat: () => void
  isChatOpen: boolean
  onToggleSidebar?: () => void
  onToggleTerminal?: () => void
  onRepoSelect: (repo: { id: number; name: string; full_name: string } | null) => void
  onNavigatePrevious?: () => void
  onNavigateNext?: () => void
  canNavigatePrevious?: boolean
  canNavigateNext?: boolean
  onOpenSearchRef?: React.MutableRefObject<(() => void) | null>
  onRepoCreated?: (repoName: string, repoFullName: string) => void
  onRefreshReposRef?: React.MutableRefObject<(() => Promise<Repository[] | undefined>) | null>
  onStageChanges?: () => void
  hasUnsavedChanges?: boolean
  onEnterTeamWorkspace?: (teamId: string) => void
  onLeaveWorkspace?: () => void
  currentTeamId?: string | null
  teamRepos?: string[] // List of repo full_names in the team workspace
  selectedFile?: any // Current selected file for state persistence
  isSidebarOpen?: boolean // Sidebar state for persistence
  currentView?: string // Current view for persistence
  selectedRepoFromParent?: { id: number; name: string; full_name: string; default_branch?: string } | null // Selected repo from IDELayout for display
  onToggleWiki?: () => void // Toggle wiki panel
  isWikiOpen?: boolean // Wiki panel state
}

export interface Repository {
  id: number
  name: string
  full_name: string
  private: boolean
  description?: string
  updated_at?: string
  default_branch?: string
}

export default function TopBar({ onToggleChat, isChatOpen, onToggleSidebar, onToggleTerminal, onRepoSelect, onNavigatePrevious, onNavigateNext, canNavigatePrevious = false, canNavigateNext = false, onOpenSearchRef, onRepoCreated, onRefreshReposRef, onStageChanges, hasUnsavedChanges = false, onEnterTeamWorkspace, onLeaveWorkspace, currentTeamId, teamRepos = [], selectedFile, isSidebarOpen, currentView, selectedRepoFromParent, onToggleWiki, isWikiOpen = false }: TopBarProps) {
  // Use repos from GitHubContext - it already fetches after auth/me completes
  const { repos: contextRepos, isLoadingRepos, fetchRepos } = useGitHub()
  const { user } = useAuth()
  
  // Get user's GitHub username for filtering
  const userGitHubUsername = user?.github_username
  
  // Filter repos based on team workspace and ownership
  // If in a team workspace, only show team repos
  // If NOT in teams mode, only show repos owned by the user (filter out organizational repos)
  let availableRepos = contextRepos
  
  if (currentTeamId && teamRepos.length > 0) {
    // Teams mode: only show repos that are in the team
    availableRepos = contextRepos.filter(repo => teamRepos.includes(repo.full_name))
  } else if (!currentTeamId && userGitHubUsername) {
    // Not in teams mode: only show repos owned by the user (filter out organizational repos)
    // Use owner.login if available, otherwise extract owner from full_name (format: "owner/repo")
    availableRepos = contextRepos.filter(repo => {
      const owner = repo.owner?.login || repo.full_name?.split('/')[0]
      return owner === userGitHubUsername
    })
  }
  const router = useRouter()
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  
  // Sync internal state with parent's selectedRepo prop (for state restoration)
  // NOTE: selectedRepo intentionally excluded from deps to prevent infinite loop
  useEffect(() => {
    if (selectedRepoFromParent) {
      // Convert parent's repo format to TopBar's Repository format
      const repoForTopBar: Repository = {
        id: selectedRepoFromParent.id,
        name: selectedRepoFromParent.name,
        full_name: selectedRepoFromParent.full_name,
        private: false, // We don't have this from parent, but it's ok for display
        description: undefined,
        updated_at: undefined,
        default_branch: selectedRepoFromParent.default_branch
      }
      setSelectedRepo(repoForTopBar)
    } else if (selectedRepoFromParent === null) {
      // Parent cleared the repo, clear ours too
      setSelectedRepo(null)
    }
  }, [selectedRepoFromParent])

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isCortexOpen, setIsCortexOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)

  // Keyboard shortcut: Cmd/Ctrl + Shift + S for Stage Changes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 's') {
        e.preventDefault()
        onStageChanges?.()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onStageChanges])

  // Convert repos to TopBar Repository format and sort by updated_at
  // Uses availableRepos which is filtered by team workspace if active
  const repos = availableRepos
    .map(repo => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      description: repo.description || undefined,
      updated_at: repo.updated_at,
      default_branch: repo.default_branch
    }))
    .sort((a, b) => {
      const dateA = new Date(a.updated_at || 0).getTime()
      const dateB = new Date(b.updated_at || 0).getTime()
      return dateB - dateA
    })

  // Expose search modal opener through ref
  useEffect(() => {
    if (onOpenSearchRef) {
      onOpenSearchRef.current = () => {
        setIsModalOpen(true)
      }
    }
  }, [onOpenSearchRef])

  // Expose repo refresh function through ref (uses GitHubContext's fetchRepos)
  useEffect(() => {
    if (onRefreshReposRef) {
      onRefreshReposRef.current = async () => {
        await fetchRepos()
        // Return repos from context after refresh (they'll be updated by the context)
        return contextRepos.map(repo => ({
          id: repo.id,
          name: repo.name,
          full_name: repo.full_name,
          private: repo.private,
          description: repo.description || undefined,
          updated_at: repo.updated_at,
          default_branch: repo.default_branch
        }))
      }
    }
  }, [onRefreshReposRef, fetchRepos, contextRepos])

  const handleRepoSelect = (repo: Repository) => {
    setSelectedRepo(repo)
    setIsModalOpen(false)
    onRepoSelect(repo)
  }

  const handleRepoCreated = async (repoName: string, repoFullName: string) => {
    console.log('🎉 [TopBar] Repository created:', repoFullName)
    
    // Clear localStorage cache to force fresh fetch
    try {
      localStorage.removeItem('github_repos_cache')
      console.log('🗑️ [TopBar] Cleared repos cache')
    } catch (e) {
      console.error('❌ [TopBar] Failed to clear cache:', e)
    }
    
    // Refresh the repo list after delays to allow GitHub API to update
    // GitHub API has eventual consistency, so we retry multiple times
    // This ensures the newly created repo appears in the search bar
    const refreshDelay = 2000 // 2 seconds
    const maxRetries = 4
    
    const refreshRepos = async (attempt: number) => {
      console.log(`🔄 [TopBar] Refreshing repo list after creation (attempt ${attempt}/${maxRetries})...`)
      await fetchRepos()
    }
    
    // Refresh immediately, then retry with increasing delays
    // This gives GitHub API time to propagate the new repo
    refreshRepos(1)
    setTimeout(() => refreshRepos(2), refreshDelay)
    setTimeout(() => refreshRepos(3), refreshDelay * 2)
    setTimeout(() => refreshRepos(4), refreshDelay * 3)
    
    // Call the parent's onRepoCreated callback (for chat message, etc.)
    if (onRepoCreated) {
      onRepoCreated(repoName, repoFullName)
    }
  }

  return (
    <>
      <div className="h-[35px] w-full bg-[#141414] border-b border-[#1a1a1a] flex items-center relative z-30" style={{ WebkitAppRegion: 'drag' } as any}>
        {/* Left section - Moving Logo Animation */}
        <div className="flex items-center h-full relative overflow-hidden w-[340px] flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <div className="logo-carousel">
            <div className="carousel-item">
              <Image
                src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg"
                alt="Logo"
                width={28}
                height={28}
                className="logo-moving"
                draggable={false}
              />
              <span className="infrara-text">Driftbox - Infra OS</span>
            </div>
            <div className="carousel-item">
              <Image
                src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg"
                alt="Logo"
                width={28}
                height={28}
                className="logo-moving"
                draggable={false}
              />
              <span className="infrara-text">Driftbox - Infra OS</span>
            </div>
            <div className="carousel-item">
              <Image
                src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg"
                alt="Logo"
                width={28}
                height={28}
                className="logo-moving"
                draggable={false}
              />
              <span className="infrara-text">Driftbox - Infra OS</span>
            </div>
            <div className="carousel-item">
              <Image
                src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg"
                alt="Logo"
                width={28}
                height={28}
                className="logo-moving"
                draggable={false}
              />
              <span className="infrara-text">Driftbox - Infra OS</span>
            </div>
          </div>
          
          <style jsx>{`
            @keyframes slideLoop {
              0% {
                transform: translateX(0);
              }
              100% {
                transform: translateX(calc(-170px - 24px));
              }
            }
            
            .logo-carousel {
              display: flex;
              gap: 24px;
              animation: slideLoop 8s linear infinite;
              will-change: transform;
            }
            
            .carousel-item {
              display: flex;
              align-items: center;
              gap: 12px;
              flex-shrink: 0;
              width: 170px;
            }
            
            .logo-moving {
              opacity: 0.8;
              filter: brightness(1.2) drop-shadow(0 0 8px rgba(138, 43, 226, 0.4));
              flex-shrink: 0;
            }
            
            .infrara-text {
              font-size: 12px;
              color: #cccccc;
              font-weight: 500;
              white-space: nowrap;
              transform: translateY(3px);
            }
          `}</style>
        </div>

        {/* Center section - Navigation + Search trigger */}
        <div className="flex-1 flex justify-center items-center gap-2 min-w-0 px-2">
          {/* Navigation arrows */}
          <div className="flex items-center gap-2 flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <i 
              onClick={canNavigatePrevious ? onNavigatePrevious : undefined}
              className={`codicon codicon-arrow-left transition-colors ${
                canNavigatePrevious 
                  ? 'text-[#858585] hover:text-[#cccccc] cursor-pointer' 
                  : 'text-[#454545] cursor-not-allowed'
              }`}
              style={{ fontSize: 16 }}
              title="Go Back"
            />
            <i 
              onClick={canNavigateNext ? onNavigateNext : undefined}
              className={`codicon codicon-arrow-right transition-colors ${
                canNavigateNext 
                  ? 'text-[#858585] hover:text-[#cccccc] cursor-pointer' 
                  : 'text-[#454545] cursor-not-allowed'
              }`}
              style={{ fontSize: 16 }}
              title="Go Forward"
            />
          </div>

          {/* Search bar */}
          {!isModalOpen && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex-1 min-w-[200px] max-w-[500px] h-[22px] flex items-center gap-2 px-3 bg-[#181818] rounded-md transition-colors text-[12px] text-[#858585] border border-[#2a2a2a] hover:border-[#3a3a3a]"
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
              {selectedRepo ? (
                <span className="flex-1 text-center truncate overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
                  {selectedRepo.full_name}
                </span>
              ) : (
                <>
                  <i className="codicon codicon-search flex-shrink-0 opacity-60" style={{ fontSize: 14 }} />
                  <span className="flex-1 text-left truncate overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
                    Search repositories...
                  </span>
                  <span className="text-[11px] opacity-50 flex-shrink-0">Ctrl+P</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Right section - Icon toolbar (flex-shrink-0 prevents overlap) */}
        <div className="flex items-center h-full gap-1.5 px-2 flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {/* Driftbox Cortex */}
          <button
            onClick={() => setIsCortexOpen(true)}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-gradient-to-r from-purple-600/20 to-blue-600/20 border border-purple-500/30 rounded text-[10px] font-medium text-purple-200 hover:from-purple-600/30 hover:to-blue-600/30 hover:border-purple-500/50 transition-all flex-shrink-0 whitespace-nowrap"
            title="Driftbox Cortex - View learned insights"
          >
            <span className="text-purple-400">⚡</span>
            <span>Cortex</span>
          </button>

          {/* Leave Workspace - Only show when in a team workspace */}
          {currentTeamId && onLeaveWorkspace && (
            <button
              onClick={onLeaveWorkspace}
              className="flex items-center gap-1 px-1.5 py-0.5 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-[10px] font-medium text-gray-400 hover:text-white hover:bg-[#3a3a3a] hover:border-[#4a4a4a] transition-all flex-shrink-0 whitespace-nowrap"
              title="Leave team workspace and return to all repos"
            >
              <span>🏠</span>
              <span>Home</span>
            </button>
          )}
          
          {/* Teams */}
          <button
            onClick={() => {
              // Store full IDE state before navigating
              const ideState = {
                repo: selectedRepo,
                file: selectedFile,
                sidebarOpen: isSidebarOpen,
                view: currentView,
                currentTeamId: currentTeamId,
                teamRepos: teamRepos,
                currentPath: window.location.pathname,
                timestamp: Date.now()
              }
              sessionStorage.setItem('ide_state_backup', JSON.stringify(ideState))
              sessionStorage.setItem('restore_ide_state', 'true')
              
              // Use router.push for client-side navigation (works in both web and Electron)
              router.push('/teams')
            }}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-gradient-to-r from-blue-600/20 to-cyan-600/20 border border-blue-500/30 rounded text-[10px] font-medium text-blue-200 hover:from-blue-600/30 hover:to-cyan-600/30 hover:border-blue-500/50 transition-all flex-shrink-0 whitespace-nowrap"
            title="Team Management"
          >
            <span className="text-blue-400">👥</span>
            <span>Teams</span>
          </button>

          {/* Profile */}
          <button
            onClick={() => setIsProfileOpen(true)}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-gradient-to-r from-purple-600/20 to-pink-600/20 border border-purple-500/30 rounded text-[10px] font-medium text-purple-200 hover:from-purple-600/30 hover:to-pink-600/30 hover:border-purple-500/50 transition-all flex-shrink-0 whitespace-nowrap"
            title="Profile & Achievements"
          >
            <span className="text-purple-400">👤</span>
            <span>Profile</span>
          </button>

          {/* Repo Wiki - AI-powered documentation */}
          {selectedRepo && onToggleWiki && (
            <button
              onClick={onToggleWiki}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all flex-shrink-0 whitespace-nowrap ${
                isWikiOpen 
                  ? 'bg-purple-500/30 border border-purple-400/60 text-purple-200' 
                  : 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-400/40 text-purple-200 hover:from-purple-500/30 hover:to-pink-500/30 hover:border-purple-400/60'
              }`}
              title="Open AI-powered wiki documentation"
            >
              <BookOpen className="w-3 h-3 text-purple-300" />
              <span>Wiki</span>
            </button>
          )}

          
          {/* Toggle Sidebar */}
          <i 
            onClick={onToggleSidebar}
            className="codicon codicon-layout-sidebar-left text-[#858585] hover:text-[#cccccc] transition-colors cursor-pointer flex items-center justify-center flex-shrink-0" 
            style={{ fontSize: 14, height: 14, lineHeight: '14px', width: 14 }}
            title="Toggle Sidebar"
          />
          
          {/* Toggle Terminal */}
          <i 
            onClick={onToggleTerminal}
            className="codicon codicon-terminal text-[#858585] hover:text-[#cccccc] transition-colors cursor-pointer flex items-center justify-center flex-shrink-0" 
            style={{ fontSize: 14, height: 14, lineHeight: '14px', width: 14 }}
            title="Toggle Terminal"
          />
          
          {/* Driftbox Logo - Toggle Chat */}
          <div 
            onClick={onToggleChat}
            className="cursor-pointer flex items-center justify-center transition-all opacity-90 hover:opacity-100 flex-shrink-0"
            style={{ height: 14, width: 18 }}
            title="Toggle Chat"
          >
            <Image
              src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg"
              alt="Logo"
              width={18}
              height={18}
              className="flex-shrink-0"
              style={{ 
                objectFit: 'contain',
                filter: 'brightness(1.2)',
                marginTop: '-4px',
              }}
              draggable={false}
            />
          </div>
          
          {/* Settings */}
          <i 
            onClick={() => setIsSettingsOpen(true)}
            className="codicon codicon-settings-gear text-[#858585] hover:text-[#cccccc] transition-colors cursor-pointer flex items-center justify-center flex-shrink-0" 
            style={{ fontSize: 14, height: 14, lineHeight: '14px', width: 14 }}
            title="Settings"
          />
        </div>
      </div>

      {/* Search Modal */}
      <SearchModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        repositories={repos}
        isLoading={isLoadingRepos}
        selectedRepo={selectedRepo}
        onRepoSelect={handleRepoSelect}
        onRepoCreated={handleRepoCreated}
      />
      
      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
      
      {/* Driftbox Cortex Modal */}
      <DriftboxCortexModal
        isOpen={isCortexOpen}
        onClose={() => setIsCortexOpen(false)}
        selectedRepo={selectedRepo}
        currentTeamId={currentTeamId}
      />
      
      {/* Profile Modal */}
      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        onEnterTeamWorkspace={onEnterTeamWorkspace}
      />

    </>
  )
}

