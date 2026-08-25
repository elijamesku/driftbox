'use client'

import { useState } from 'react'
import { Repository } from '../swag/TopBar'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import { useAuth } from '@/contexts/AuthContext'

interface RepositoryListProps {
  repositories: Repository[]
  isLoading: boolean
  highlightedIndex: number
  selectedRepo: Repository | null
  searchQuery: string
  onRepoSelect: (repo: Repository) => void
  onHighlight: (index: number) => void
  onRepoCreated?: (repoName: string, repoFullName: string) => void
}

export default function RepositoryList({
  repositories,
  isLoading,
  highlightedIndex,
  selectedRepo,
  searchQuery,
  onRepoSelect,
  onHighlight,
  onRepoCreated
}: RepositoryListProps) {
  const { token } = useAuth()
  const [isCreatingRepo, setIsCreatingRepo] = useState(false)
  const [newRepoName, setNewRepoName] = useState('')
  const [newRepoDescription, setNewRepoDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [createError, setCreateError] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const handleCreateRepo = async () => {
    if (!newRepoName.trim()) {
      setCreateError('Repository name is required')
      return
    }

    setIsCreating(true)
    setCreateError('')

    try {
      const response = await fetch(getApiEndpoint('/auth/github/create-repo'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          name: newRepoName.trim(),
          description: newRepoDescription.trim(),
          private: isPrivate
        })
      })

      if (response.ok) {
        const newRepo = await response.json()
        console.log('✅ Repository created:', newRepo)
        
        // Close modal and reset form
        setIsCreatingRepo(false)
        setNewRepoName('')
        setNewRepoDescription('')
        setIsPrivate(true)
        
        // Format the repo data to match what onRepoSelect expects
        const formattedRepo = {
          id: newRepo.id,
          name: newRepo.name,
          full_name: newRepo.full_name,
          private: newRepo.private,
          description: newRepo.description,
          owner: {
            login: newRepo.full_name.split('/')[0]
          },
          default_branch: newRepo.default_branch || 'main',
          updated_at: newRepo.updated_at
        }
        
        // Select the new repo to open it
        console.log('📂 Opening newly created repository:', formattedRepo.full_name)
        onRepoSelect(formattedRepo)
        
        // Notify parent about repo creation so it can show in chat
        if (onRepoCreated) {
          onRepoCreated(newRepo.name, newRepo.full_name)
        }
      } else {
        const error = await response.json()
        setCreateError(error.error || 'Failed to create repository')
      }
    } catch (error) {
      setCreateError('Network error. Please try again.')
    } finally {
      setIsCreating(false)
    }
  }

  const scrollbarStyle = `
    .repository-list {
      scrollbar-width: thin;
      scrollbar-color: #555 #141414;
    }
    .repository-list::-webkit-scrollbar {
      width: 14px;
      display: block;
    }
    .repository-list::-webkit-scrollbar-track {
      background: #141414;
      border-radius: 7px;
    }
    .repository-list::-webkit-scrollbar-thumb {
      background: #555;
      border-radius: 7px;
      border: 3px solid #141414;
      min-height: 30px;
    }
    .repository-list::-webkit-scrollbar-thumb:hover {
      background: #666;
    }
    .repository-list::-webkit-scrollbar-thumb:active {
      background: #777;
    }
  `

  return (
    <>
      <style>{scrollbarStyle}</style>
      <div className="repository-list max-h-[400px] overflow-y-scroll pb-2 bg-[#141414]">
        {/* New Repository Button - First in list */}
        <button
          onClick={() => setIsCreatingRepo(true)}
          onMouseEnter={() => onHighlight(-1)}
          className="w-full px-4 py-2.5 text-left bg-[#1a1a1a] hover:bg-[#2a2d2e] transition-colors border-b border-[#2a2a2a] block"
        >
          <div className="flex items-center gap-2">
            <i className="codicon codicon-add text-[#a855f7]" style={{ fontSize: 14 }} />
            <span className="text-[13px] font-medium bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">New Repository</span>
          </div>
        </button>

        {isLoading ? (
          <div className="px-4 py-3 text-[13px] text-[#858585] bg-[#141414]">
            Loading repositories...
          </div>
        ) : repositories.length === 0 ? (
          <div className="px-4 py-3 text-[13px] text-[#858585] bg-[#141414]">
            {searchQuery ? 'No repositories found' : 'No repositories available. Authorize GitHub access.'}
          </div>
        ) : (
          repositories.map((repo, index) => (
            <RepositoryItem
              key={repo.id}
              repository={repo}
              isHighlighted={highlightedIndex === index}
              isSelected={selectedRepo?.id === repo.id}
              onSelect={() => onRepoSelect(repo)}
              onMouseEnter={() => onHighlight(index)}
            />
          ))
        )}
      </div>

      {/* Create Repository Modal */}
      {isCreatingRepo && (
        <div 
          className="fixed inset-0 flex items-center justify-center z-50 bg-black/50 backdrop-blur-sm animate-fadeIn"
          onClick={() => setIsCreatingRepo(false)}
        >
          <div 
            className="w-[480px] bg-[#171717] rounded-lg border border-white/10 shadow-2xl animate-slideUp"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <img 
                  src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg" 
                  alt="infrara" 
                  className="w-7 h-7"
                  style={{
                    filter: 'brightness(1.5) contrast(1.2) drop-shadow(0 0 2px rgba(255, 255, 255, 0.3))'
                  }}
                />
                <div>
                  <h2 className="text-base font-semibold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
                    Create New Repository
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">Start your next project</p>
                </div>
              </div>
            </div>
            
            {/* Form */}
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-400">
                  Repository Name <span className="text-pink-400">*</span>
                </label>
                <input
                  type="text"
                  value={newRepoName}
                  onChange={(e) => setNewRepoName(e.target.value)}
                  placeholder="my-awesome-project"
                  className="w-full px-3 py-2.5 bg-[#141414] border border-white/10 rounded-md text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-400/50 transition-colors"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-400">
                  Description <span className="text-gray-600 text-[11px]">(optional)</span>
                </label>
                <input
                  type="text"
                  value={newRepoDescription}
                  onChange={(e) => setNewRepoDescription(e.target.value)}
                  placeholder="A brief description"
                  className="w-full px-3 py-2.5 bg-[#141414] border border-white/10 rounded-md text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-400/50 transition-colors"
                />
              </div>

              <div className="flex items-center gap-2.5 pt-1">
                <div className="relative">
                  <input
                    type="checkbox"
                    id="private-repo"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    className="peer w-4 h-4 cursor-pointer appearance-none bg-transparent border border-gray-600 rounded checked:border-gray-500 transition-colors"
                  />
                  {isPrivate && (
                    <i className="codicon codicon-check absolute top-0 left-0 text-white pointer-events-none" style={{ fontSize: 14 }} />
                  )}
                </div>
                <label htmlFor="private-repo" className="text-xs text-gray-400 cursor-pointer select-none">
                  Private repository
                </label>
              </div>

              {createError && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-md">
                  <i className="codicon codicon-error text-red-400" style={{ fontSize: 14 }} />
                  <p className="text-xs text-red-300">{createError}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-2">
              <button
                onClick={() => setIsCreatingRepo(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRepo}
                disabled={isCreating}
                className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? (
                  <div className="flex items-center gap-2">
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span>Creating...</span>
                  </div>
                ) : (
                  'Create Repository'
                )}
              </button>
            </div>
          </div>
          
          <style jsx>{`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            
            @keyframes slideUp {
              from {
                opacity: 0;
                transform: translateY(10px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            
            .animate-fadeIn {
              animation: fadeIn 0.15s ease-out;
            }
            
            .animate-slideUp {
              animation: slideUp 0.2s ease-out;
            }
          `}</style>
        </div>
      )}
    </>
  )
}

interface RepositoryItemProps {
  repository: Repository
  isHighlighted: boolean
  isSelected: boolean
  onSelect: () => void
  onMouseEnter: () => void
}

function RepositoryItem({
  repository,
  isHighlighted,
  isSelected,
  onSelect,
  onMouseEnter
}: RepositoryItemProps) {
  return (
    <button
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      className={`w-full px-4 py-2 text-left transition-colors ${
        isSelected
          ? 'bg-[#37373d]' // Selected item - darker grey
          : isHighlighted
            ? 'bg-[#2d2d30]' // Highlighted (keyboard nav) - medium grey
            : 'bg-[#1e1e1e] hover:bg-[#2d2d30]' // Default with hover - like IDE definition popup
      }`}
    >
      <div className="flex items-center">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-[#cccccc] truncate">
              {repository.name}
            </span>
            {repository.private && (
              <span className="text-[10px] px-1.5 py-0.5 bg-[#3e3e42] text-[#858585] rounded">
                Private
              </span>
            )}
          </div>
          {repository.description && (
            <div className="text-[11px] text-[#6e7681] truncate mt-0.5">
              {repository.description}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

