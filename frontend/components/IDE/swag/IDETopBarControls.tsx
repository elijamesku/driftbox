'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useGitHub } from '@/contexts'
import { useAuth } from '@/contexts/AuthContext'
import { useIDETopBarControls } from '@/hooks/useIDETopBarControls'
import SearchModal from '../modals/SearchModal'
import DriftboxCortexModal from '../modals/DriftboxCortexModal'

interface Repository {
  id: number
  name: string
  full_name: string
  private: boolean
  description?: string | null
  updated_at?: string
  default_branch?: string
}

export default function IDETopBarControls() {
  const ideContext = useIDETopBarControls()
  const { repos: contextRepos, isLoadingRepos } = useGitHub()
  const { user } = useAuth()
  const router = useRouter()
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isCortexOpen, setIsCortexOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchBarRef = useRef<HTMLDivElement>(null)

  const userGitHubUsername = user?.github_username

  // Filter repos based on team workspace and ownership
  let availableRepos = contextRepos
  if (ideContext.currentTeamId && ideContext.teamRepos && ideContext.teamRepos.length > 0) {
    availableRepos = contextRepos.filter(repo => ideContext.teamRepos!.includes(repo.full_name))
  } else if (!ideContext.currentTeamId && userGitHubUsername) {
    availableRepos = contextRepos.filter(repo => {
      const owner = repo.owner?.login || repo.full_name?.split('/')[0]
      return owner === userGitHubUsername
    })
  }

  // Sync with parent's selectedRepo
  useEffect(() => {
    if (ideContext.selectedRepoFromParent) {
      const repoForTopBar: Repository = {
        id: ideContext.selectedRepoFromParent.id,
        name: ideContext.selectedRepoFromParent.name,
        full_name: ideContext.selectedRepoFromParent.full_name,
        private: false,
        description: undefined,
        updated_at: undefined,
        default_branch: ideContext.selectedRepoFromParent.default_branch
      }
      setSelectedRepo(repoForTopBar)
    } else if (ideContext.selectedRepoFromParent === null) {
      setSelectedRepo(null)
    }
  }, [ideContext.selectedRepoFromParent])

  // Expose search open function via ref
  useEffect(() => {
    if (ideContext.onOpenSearchRef) {
      ideContext.onOpenSearchRef.current = () => setIsModalOpen(true)
    }
  }, [ideContext.onOpenSearchRef])

  // Keyboard shortcut: Ctrl+P to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault()
        setIsModalOpen(true)
        if (searchBarRef.current) {
          searchBarRef.current.focus()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Focus search bar when modal opens
  useEffect(() => {
    if (isModalOpen && searchBarRef.current) {
      searchBarRef.current.focus()
      setSearchQuery('')
    }
  }, [isModalOpen])

  const handleRepoSelect = (repo: Repository) => {
    setSelectedRepo(repo)
    if (ideContext.onRepoSelect) {
      ideContext.onRepoSelect({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name
      })
    }
    setIsModalOpen(false)
  }

  const handleRepoCreated = async (repoName: string, repoFullName: string) => {
    if (ideContext.onRepoCreated) {
      ideContext.onRepoCreated(repoName, repoFullName)
    }
    if (ideContext.onRefreshReposRef?.current) {
      await ideContext.onRefreshReposRef.current()
    }
  }

  if (!ideContext.onToggleChat) {
    return null // Not in IDE or context not provided
  }

  return (
    <>
      <div className="flex items-center gap-4 flex-1 min-w-0 w-full">
        {/* Left: Title */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="h-5 w-px bg-[#1f1f1f]" />
          <span className="text-sm text-[#666666]">IDE Workspace</span>
        </div>

        {/* Center-left: Navigation arrows + Search bar */}
        <div className="flex-1 flex justify-center items-center gap-2">
          {/* Navigation arrows */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <i 
              onClick={ideContext.canNavigatePrevious ? ideContext.onNavigatePrevious : undefined}
              className={`codicon codicon-arrow-left transition-colors ${
                ideContext.canNavigatePrevious 
                  ? 'text-[#a1a1a1] hover:text-[#fafafa] cursor-pointer' 
                  : 'text-[#454545] cursor-not-allowed'
              }`}
              style={{ fontSize: 16 }}
              title="Go Back"
            />
            <i 
              onClick={ideContext.canNavigateNext ? ideContext.onNavigateNext : undefined}
              className={`codicon codicon-arrow-right transition-colors ${
                ideContext.canNavigateNext 
                  ? 'text-[#a1a1a1] hover:text-[#fafafa] cursor-pointer' 
                  : 'text-[#454545] cursor-not-allowed'
              }`}
              style={{ fontSize: 16 }}
              title="Go Forward"
            />
          </div>
          
          {/* Search bar - Input when modal open, button when closed */}
          <div ref={searchBarRef} className="min-w-[200px] max-w-[500px] flex-1">
            {isModalOpen ? (
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                }}
                onFocus={() => setIsModalOpen(true)}
                onKeyDown={(e) => {
                  // Let arrow keys and enter be handled by SearchModal
                  if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
                    // Don't prevent default - let SearchModal handle it
                  }
                }}
                className="w-full h-[22px] px-3 bg-[#181818] rounded-md text-[12px] text-[#858585] border border-[#2a2a2a] focus:border-[#3a3a3a] focus:outline-none"
                placeholder="Search repositories..."
              />
            ) : (
              <button
                onClick={() => setIsModalOpen(true)}
                className="w-full h-[22px] flex items-center gap-2 px-3 bg-[#181818] rounded-md transition-colors text-[12px] text-[#858585] border border-[#2a2a2a] hover:border-[#3a3a3a]"
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
        </div>

        {/* Right section - Buttons with better spacing */}
        <div className="flex items-center gap-3 flex-shrink-0">
        {/* Driftbox Cortex */}
        <button
          onClick={() => setIsCortexOpen(true)}
          className="flex items-center gap-1.5 px-2 py-1 bg-gradient-to-r from-purple-600/20 to-blue-600/20 border border-purple-500/30 rounded text-[11px] font-medium text-purple-200 hover:from-purple-600/30 hover:to-blue-600/30 hover:border-purple-500/50 transition-all flex-shrink-0 whitespace-nowrap"
          title="Driftbox Cortex - View learned insights"
        >
          <span className="text-purple-400 text-sm">⚡</span>
          <span>Cortex</span>
        </button>
        
        {/* Teams */}
        <button
          onClick={() => {
            const ideState = {
              repo: selectedRepo,
              file: null,
              sidebarOpen: true,
              view: 'code',
              currentTeamId: ideContext.currentTeamId,
              teamRepos: ideContext.teamRepos,
              currentPath: window.location.pathname,
              timestamp: Date.now()
            }
            sessionStorage.setItem('ide_state_backup', JSON.stringify(ideState))
            sessionStorage.setItem('restore_ide_state', 'true')
            router.push('/dashboard/teams')
          }}
          className="flex items-center gap-1.5 px-2 py-1 bg-gradient-to-r from-blue-600/20 to-cyan-600/20 border border-blue-500/30 rounded text-[11px] font-medium text-blue-200 hover:from-blue-600/30 hover:to-cyan-600/30 hover:border-blue-500/50 transition-all flex-shrink-0 whitespace-nowrap"
          title="Team Management"
        >
          <span className="text-blue-400 text-sm">👥</span>
          <span>Teams</span>
        </button>
        
          {/* Toggle Sidebar (File Tree) */}
          {ideContext.onToggleSidebar && (
            <i 
              onClick={ideContext.onToggleSidebar}
              className="codicon codicon-layout-sidebar-left text-[#a1a1a1] hover:text-[#fafafa] transition-colors cursor-pointer flex items-center justify-center flex-shrink-0" 
              style={{ fontSize: 18, height: 18, lineHeight: '18px', width: 18 }}
              title="Toggle Sidebar"
            />
          )}
          
          {/* Toggle Terminal */}
          {ideContext.onToggleTerminal && (
            <i 
              onClick={ideContext.onToggleTerminal}
              className="codicon codicon-terminal text-[#a1a1a1] hover:text-[#fafafa] transition-colors cursor-pointer flex items-center justify-center flex-shrink-0" 
              style={{ fontSize: 18, height: 18, lineHeight: '18px', width: 18 }}
              title="Toggle Terminal"
            />
          )}
          
          {/* Driftbox Logo - Toggle Chat */}
          <div 
            onClick={ideContext.onToggleChat}
            className="cursor-pointer flex items-center justify-center transition-all opacity-90 hover:opacity-100 flex-shrink-0"
            style={{ height: 22, width: 24 }}
            title="Toggle Chat"
          >
            <Image
              src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg"
              alt="Logo"
              width={24}
              height={24}
              className="flex-shrink-0"
              style={{ 
                objectFit: 'contain',
                filter: 'brightness(1.2)',
              }}
              draggable={false}
            />
          </div>
        </div>
      </div>

      {/* Search Modal */}
      <SearchModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSearchQuery('')
        }}
        repositories={availableRepos as any}
        isLoading={isLoadingRepos}
        selectedRepo={selectedRepo as any}
        onRepoSelect={handleRepoSelect}
        onRepoCreated={handleRepoCreated}
        anchorElement={searchBarRef.current}
        searchQuery={searchQuery}
      />
      
      {/* Driftbox Cortex Modal */}
      <DriftboxCortexModal
        isOpen={isCortexOpen}
        onClose={() => setIsCortexOpen(false)}
        selectedRepo={selectedRepo}
        currentTeamId={ideContext.currentTeamId}
      />
    </>
  )
}
