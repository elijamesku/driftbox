'use client'

/**
 * Team PR Builder - Smart PR creation with team contributions
 * Shows who contributed what, allows including/excluding changes
 * Game-changing feature - no competitor has this!
 */

import { useState } from 'react'
import { X, Users, GitPullRequest, Check, AlertCircle, FileText } from 'lucide-react'

interface TeamContributor {
  user_id: string
  user_name: string
  files_modified: string[]
  lines_added: number
  lines_removed: number
  ready_for_pr: boolean
}

interface TeamPRBuilderProps {
  isOpen: boolean
  onClose: () => void
  teamContributors: TeamContributor[]
  repoFullName: string
  onCreatePR: (contributors: string[], title: string, description: string) => void
}

export default function TeamPRBuilder({
  isOpen,
  onClose,
  teamContributors,
  repoFullName,
  onCreatePR
}: TeamPRBuilderProps) {
  const [selectedContributors, setSelectedContributors] = useState<Set<string>>(
    new Set(teamContributors.filter(c => c.ready_for_pr).map(c => c.user_id))
  )
  const [prTitle, setPrTitle] = useState('')
  const [prDescription, setPrDescription] = useState('')

  if (!isOpen) return null

  const toggleContributor = (userId: string) => {
    const updated = new Set(selectedContributors)
    if (updated.has(userId)) {
      updated.delete(userId)
    } else {
      updated.add(userId)
    }
    setSelectedContributors(updated)
  }

  const handleCreate = () => {
    onCreatePR(Array.from(selectedContributors), prTitle, prDescription)
    onClose()
  }

  const getUserColor = (userId: string) => {
    const colors = ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f87171']
    const index = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return colors[index % colors.length]
  }

  const totalStats = teamContributors
    .filter(c => selectedContributors.has(c.user_id))
    .reduce(
      (acc, c) => ({
        files: acc.files + c.files_modified.length,
        added: acc.added + c.lines_added,
        removed: acc.removed + c.lines_removed
      }),
      { files: 0, added: 0, removed: 0 }
    )

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1e1e1e] rounded-lg border border-[#3a3a3a] w-full max-w-2xl shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#3a3a3a] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GitPullRequest className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-white">Create Team Pull Request</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white transition-colors rounded hover:bg-[#2a2a2a]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-6 max-h-[600px] overflow-y-auto">
          {/* PR Details */}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Pull Request Title
              </label>
              <input
                type="text"
                value={prTitle}
                onChange={(e) => setPrTitle(e.target.value)}
                placeholder="feat: Add monitoring and alerting infrastructure"
                className="w-full px-3 py-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded-md text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Description
              </label>
              <textarea
                value={prDescription}
                onChange={(e) => setPrDescription(e.target.value)}
                placeholder="Describe what the team built together..."
                rows={4}
                className="w-full px-3 py-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded-md text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 resize-none"
              />
            </div>
          </div>

          {/* Team Contributors */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-300">
                Team Contributions
              </label>
              <div className="text-xs text-gray-400">
                {selectedContributors.size} of {teamContributors.length} contributors selected
              </div>
            </div>

            <div className="space-y-2">
              {teamContributors.map(contributor => {
                const isSelected = selectedContributors.has(contributor.user_id)
                
                return (
                  <div
                    key={contributor.user_id}
                    onClick={() => toggleContributor(contributor.user_id)}
                    className={`p-4 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-[#2a2a2a] border-purple-500/50'
                        : 'bg-[#2a2a2a]/50 border-[#3a3a3a] hover:border-[#4a4a4a]'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      {/* Left: User info */}
                      <div className="flex items-start gap-3 flex-1">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleContributor(contributor.user_id)}
                            className="mt-1"
                          />
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                            style={{ backgroundColor: getUserColor(contributor.user_id) }}
                          >
                            {contributor.user_name[0].toUpperCase()}
                          </div>
                        </div>
                        
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-white">
                              {contributor.user_name}
                            </span>
                            {contributor.ready_for_pr && (
                              <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full flex items-center gap-1">
                                <Check className="w-3 h-3" />
                                Ready
                              </span>
                            )}
                            {!contributor.ready_for_pr && (
                              <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded-full flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                Draft
                              </span>
                            )}
                          </div>
                          
                          <div className="space-y-1">
                            {contributor.files_modified.slice(0, 3).map((file, idx) => (
                              <div key={idx} className="text-xs text-gray-400 flex items-center gap-1">
                                <FileText className="w-3 h-3" />
                                {file}
                              </div>
                            ))}
                            {contributor.files_modified.length > 3 && (
                              <div className="text-xs text-gray-500">
                                +{contributor.files_modified.length - 3} more files
                              </div>
                            )}
                          </div>
                          
                          <div className="mt-2 flex items-center gap-3 text-xs">
                            <span className="text-green-400">+{contributor.lines_added}</span>
                            <span className="text-red-400">-{contributor.lines_removed}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Stats Summary */}
          <div className="bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg p-4">
            <div className="text-sm font-medium text-gray-300 mb-3">Pull Request Summary</div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-white">{totalStats.files}</div>
                <div className="text-xs text-gray-400">Files Changed</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-400">+{totalStats.added}</div>
                <div className="text-xs text-gray-400">Lines Added</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-400">-{totalStats.removed}</div>
                <div className="text-xs text-gray-400">Lines Removed</div>
              </div>
            </div>
          </div>

          {/* Warning for work-in-progress */}
          {teamContributors.some(c => selectedContributors.has(c.user_id) && !c.ready_for_pr) && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-yellow-300 mb-1">
                    Including work-in-progress changes
                  </div>
                  <div className="text-xs text-yellow-200/80">
                    Some contributors haven't marked their changes as "Ready for PR". 
                    Their work-in-progress will be included.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#3a3a3a] flex items-center justify-between bg-[#252526]">
          <div className="text-xs text-gray-400">
            Repository: <span className="text-gray-300">{repoFullName}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-white bg-transparent border border-[#3a3a3a] rounded-md hover:bg-[#3a3a3a] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={selectedContributors.size === 0 || !prTitle.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-pink-600 rounded-md hover:from-purple-700 hover:to-pink-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <GitPullRequest className="w-4 h-4" />
              Create Team PR
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

