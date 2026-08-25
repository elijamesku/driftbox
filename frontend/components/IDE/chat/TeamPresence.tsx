'use client'

/**
 * Team Presence Indicator
 * Shows online teammates, what they're editing, and recent activity
 * Figma-style collaboration UI
 */

import { useState, useEffect } from 'react'
import { Users, Eye, Edit3, Clock, ChevronDown, ChevronUp, GitPullRequest, Check, AlertCircle, ChevronLeft, ChevronRight, Sparkles, Search, Shield, Zap } from 'lucide-react'
import type { OnlineUser, FileActivity, RecentChange, CursorPosition, UserIntent } from '@/hooks/useTeamCollaboration'
import TeamPRBuilder from './TeamPRBuilder'

// Intent signaling options - what the user is doing
const INTENT_OPTIONS: { value: UserIntent; label: string; color: string }[] = [
  { value: 'exploring', label: 'Exploring — not applying', color: 'text-blue-400' },
  { value: 'refactoring', label: 'Refactoring', color: 'text-amber-400' },
  { value: 'debugging', label: 'Debugging', color: 'text-red-400' },
  { value: 'implementing', label: 'Implementing feature', color: 'text-purple-400' },
  { value: 'reviewing', label: 'Reviewing changes', color: 'text-cyan-400' },
  { value: 'ready-for-pr', label: 'Ready for PR', color: 'text-emerald-400' },
]

interface TeamPresenceProps {
  onlineUsers: OnlineUser[]
  fileActivity: Record<string, FileActivity>
  recentChanges: RecentChange[]
  cursorPositions?: Record<string, CursorPosition>
  currentFile?: string | null
  currentUserId?: string
  currentUserCursor?: { line: number; column: number } | null
  prIntent?: 'work-in-progress' | 'ready-for-pr'
  userIntent?: UserIntent
  userIntents?: Record<string, UserIntent> // Other users' intents
  repoFullName?: string
  onPRIntentChange?: (intent: 'work-in-progress' | 'ready-for-pr') => void
  onIntentChange?: (intent: UserIntent) => void
  onCreateTeamPR?: (contributors: string[], title: string, description: string) => void
  onOpenStaging?: () => void
  notificationPopupOpen?: boolean
  modeDropdownOpen?: boolean
  onNavigateToUser?: (filePath: string, line?: number, column?: number) => void
}

export default function TeamPresence({
  onlineUsers,
  fileActivity,
  recentChanges,
  cursorPositions = {},
  currentUserId,
  currentUserCursor,
  currentFile,
  prIntent = 'work-in-progress',
  userIntent = 'exploring',
  userIntents = {},
  repoFullName,
  onPRIntentChange,
  onIntentChange,
  onCreateTeamPR,
  onOpenStaging,
  notificationPopupOpen = false,
  modeDropdownOpen = false,
  onNavigateToUser
}: TeamPresenceProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isMinimized, setIsMinimized] = useState(false)
  const [showPRBuilder, setShowPRBuilder] = useState(false)
  const [showIntentDropdown, setShowIntentDropdown] = useState(false)

  // Auto-minimize when the mode dropdown (Ask/Agent/Team) is opened at the bottom
  useEffect(() => {
    if (modeDropdownOpen && !isMinimized) {
      setIsMinimized(true)
    }
  }, [modeDropdownOpen, isMinimized])

  // Check if anyone is editing current file (dedupe by user_id)
  // Must match BOTH file_path AND repo to avoid cross-repo confusion
  const currentFileEditorsRaw = Object.values(fileActivity).filter(
    activity => currentFile && activity.file_path === currentFile && activity.repo === repoFullName
  )
  // Dedupe by user_id to prevent showing same user twice
  const currentFileEditors = currentFileEditorsRaw.filter(
    (editor, index, self) => self.findIndex(e => e.user_id === editor.user_id) === index
  )

  // Get initials for avatar
  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

  // Get color for user (consistent per user)
  const getUserColor = (userId: string) => {
    const colors = [
      'bg-purple-500',
      'bg-blue-500',
      'bg-green-500',
      'bg-yellow-500',
      'bg-pink-500',
      'bg-indigo-500',
      'bg-red-500',
      'bg-cyan-500'
    ]
    const index = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return colors[index % colors.length]
  }

  if (onlineUsers.length === 0) return null

  // Minimized view - small tab at TOP right edge (out of chat's way)
  // Push down when notification popup is open
  // Disable clicking while dropdown is open to prevent glitches
  if (isMinimized) {
    return (
      <div 
        className={`fixed right-0 z-40 transition-all duration-200 ${notificationPopupOpen ? 'top-80' : 'top-20'} ${modeDropdownOpen ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        onClick={() => {
          if (!modeDropdownOpen) {
            setIsMinimized(false)
          }
        }}
      >
        <div className="bg-black/95 backdrop-blur-md border border-white/10 border-r-0 rounded-l-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] px-2.5 py-3.5 hover:bg-white/5 transition-all duration-200">
          <div className="flex flex-col items-center gap-2">
            <ChevronLeft className="w-4 h-4 text-white/40" />
            <div className="flex flex-col -space-y-2">
              {onlineUsers.slice(0, 3).map(user => (
                <div
                  key={user.user_id}
                  className={`w-6 h-6 rounded-full ${getUserColor(user.user_id)} flex items-center justify-center text-white text-xs font-semibold border-2 border-[#0a0a0a]`}
                  title={user.name}
                >
                  {getInitials(user.name)}
                </div>
              ))}
            </div>
            <span className="text-[10px] font-medium text-white/40 writing-mode-vertical" style={{ writingMode: 'vertical-rl' }}>
              {onlineUsers.length}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed bottom-32 right-2 z-40 w-[340px] transition-all duration-300 ease-out">
      <div className="bg-black/95 backdrop-blur-md border border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden">
        {/* Header */}
        <div
          className="px-4 py-3.5 border-b border-white/5 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-all duration-200"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2">
            {/* Minimize button */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsMinimized(true)
              }}
              className="p-1.5 hover:bg-white/10 rounded-lg transition-all duration-200"
              title="Minimize"
            >
              <ChevronRight className="w-4 h-4 text-white/40" />
            </button>
            <div className="flex -space-x-2">
              {onlineUsers.slice(0, 3).map(user => (
                <div
                  key={user.user_id}
                  className={`w-7 h-7 rounded-full ${getUserColor(user.user_id)} flex items-center justify-center text-white text-[10px] font-semibold border-2 border-black shadow-md transition-transform hover:scale-110 hover:z-10`}
                  title={user.name}
                >
                  {getInitials(user.name)}
                </div>
              ))}
              {onlineUsers.length > 3 && (
                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/70 text-[10px] font-semibold border-2 border-black">
                  +{onlineUsers.length - 3}
                </div>
              )}
            </div>
            <span className="text-sm font-medium text-white/90">
              {onlineUsers.length} online
            </span>
          </div>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-white/40" />
          ) : (
            <ChevronUp className="w-4 h-4 text-white/40" />
          )}
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="max-h-96 overflow-y-auto">
            {/* Current File Warning */}
            {currentFileEditors.length > 0 && (
              <div className="px-4 py-3 bg-yellow-500/10 border-b border-yellow-500/20">
                <div className="flex items-start gap-2">
                  <Edit3 className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-yellow-300">
                      {currentFileEditors.length} {currentFileEditors.length === 1 ? 'person is' : 'people are'} editing this file
                    </p>
                    {currentFileEditors.map(editor => (
                      <p key={editor.user_id} className="text-xs text-yellow-200/80 mt-1">
                        {editor.user_name}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Online Users */}
            <div className="px-4 py-3.5 border-b border-white/5">
              <div className="text-[10px] font-semibold text-white/40 mb-3 uppercase tracking-widest">
                Online Now
              </div>
              <div className="space-y-3">
                {onlineUsers.map(user => {
                  const isCurrentUser = user.user_id === currentUserId
                  
                  // For current user, use local cursor state. For others, use WebSocket cursor positions.
                  const userCursor = isCurrentUser 
                    ? (currentFile && currentUserCursor ? { 
                        file_path: currentFile, 
                        line: currentUserCursor.line, 
                        column: currentUserCursor.column 
                      } : null)
                    : Object.values(cursorPositions).find(cursor => cursor.user_id === user.user_id)
                  
                  // Fallback to file activity if no cursor
                  const fileActivityEntry = Object.values(fileActivity).find(
                    activity => activity.user_id === user.user_id
                  )
                  
                  // Determine what file they're editing
                  const editingFile = userCursor?.file_path || fileActivityEntry?.file_path
                  
                  // Get user's individual repo - for current user use local state, for others use cursor or file activity
                  const userRepo = isCurrentUser 
                    ? repoFullName 
                    : ((userCursor as CursorPosition)?.repo || fileActivityEntry?.repo)
                  
                  // Can navigate to this user if they have a file open AND we're in the same repo
                  const sameRepo = repoFullName && userRepo && repoFullName === userRepo
                  const canNavigate = !isCurrentUser && editingFile && onNavigateToUser && sameRepo
                  
                  return (
                    <div 
                      key={user.user_id} 
                      className={`flex items-center gap-3 p-2.5 bg-white/5 rounded-xl transition-all duration-200 ${
                        canNavigate 
                          ? 'cursor-pointer hover:bg-white/10' 
                          : ''
                      }`}
                      onClick={() => {
                        if (canNavigate && editingFile) {
                          onNavigateToUser(editingFile, userCursor?.line, userCursor?.column)
                        }
                      }}
                      title={canNavigate ? `Jump to ${user.name}'s location` : undefined}
                    >
                      <div className={`w-9 h-9 rounded-full ${getUserColor(user.user_id)} flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 relative shadow-lg`}>
                        {getInitials(user.name)}
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-black"></div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white truncate">
                            {user.name}
                          </span>
                          {userRepo && (
                            <span className="text-xs text-green-400 truncate">
                              {userRepo.split('/')[1] || userRepo}
                            </span>
                          )}
                        </div>
                        {/* User Intent Badge */}
                        {(() => {
                          const intent = isCurrentUser ? userIntent : userIntents[user.user_id]
                          const intentOption = INTENT_OPTIONS.find(o => o.value === intent)
                          if (intentOption && intent !== 'exploring') {
                            return (
                              <div className={`text-[10px] ${intentOption.color} mb-0.5`}>
                                {intentOption.label}
                              </div>
                            )
                          }
                          return null
                        })()}
                        {/* Activity Status Badge */}
                        {user.activity_status === 'generating' ? (
                          <div className="flex items-center gap-1 text-xs text-yellow-400 animate-pulse">
                            <span>🤖</span>
                            <span className="font-medium">Staging changes...</span>
                            <span className="ml-1 px-1.5 py-0.5 bg-yellow-500/20 rounded text-[10px] animate-[flash_0.5s_ease-in-out_infinite]">
                              ⚠️ PR incoming
                            </span>
                          </div>
                        ) : user.activity_status === 'creating_pr' ? (
                          <div className="flex items-center gap-1 text-xs text-orange-400">
                            <span className="animate-spin">📤</span>
                            <span className="font-medium">Creating PR...</span>
                            <span className="ml-1 px-1.5 py-0.5 bg-orange-500/20 rounded text-[10px]">
                              🔒 Files locked
                            </span>
                          </div>
                        ) : editingFile ? (
                          <div className="flex items-center gap-1 text-xs text-purple-400">
                            <Edit3 className="w-3 h-3" />
                            <span className="truncate">
                              {editingFile.split('/').pop()}
                              {userCursor && (
                                <span className="text-white/40 ml-1">
                                  Ln {userCursor.line}, Col {userCursor.column}
                                </span>
                              )}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-xs text-white/40">
                            <Eye className="w-3 h-3" />
                            <span>Viewing</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Recent Activity */}
            {recentChanges.length > 0 && (
              <div className="px-4 py-3.5 border-b border-white/5">
                <div className="text-[10px] font-semibold text-white/40 mb-3 uppercase tracking-widest">
                  Recent Activity
                </div>
                <div className="space-y-2">
                  {recentChanges.slice(-5).reverse().map((change, idx) => (
                    <div key={idx} className="flex items-start gap-2 p-2.5 bg-white/5 rounded-xl">
                      <Clock className="w-3 h-3 text-white/30 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white/70">
                          <span className="font-medium text-white/90">{change.user_name}</span>
                          {' '}{change.action}{' '}
                          <span className="text-white/50 truncate">{change.file_path}</span>
                        </p>
                        <p className="text-[10px] text-white/30 mt-0.5">
                          {formatTimestamp(change.timestamp)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Intent Signaling - What are you doing? */}
            <div className="px-4 py-3.5 space-y-3">
              {/* Intent Dropdown */}
              <div className="relative">
                <div className="text-[10px] font-semibold text-white/40 mb-2.5 uppercase tracking-widest">
                  What are you doing?
                </div>
                <button
                  onClick={() => setShowIntentDropdown(!showIntentDropdown)}
                  className={`w-full px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-between gap-2 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20`}
                >
                  <span className={INTENT_OPTIONS.find(o => o.value === userIntent)?.color || 'text-white'}>
                    {INTENT_OPTIONS.find(o => o.value === userIntent)?.label || 'Exploring'}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-white/40 transition-transform ${showIntentDropdown ? 'rotate-180' : ''}`} />
                </button>
                
                {/* Intent Dropdown Menu */}
                {showIntentDropdown && (
                  <div 
                    ref={(el) => {
                      // Auto-scroll to show all dropdown options when opened
                      if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                      }
                    }}
                    className="absolute top-full left-0 right-0 mt-1 bg-black/95 backdrop-blur-md border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden"
                  >
                    {INTENT_OPTIONS.map(option => (
                      <button
                        key={option.value}
                        onClick={() => {
                          onIntentChange?.(option.value)
                          // Also update PR intent if ready
                          if (option.value === 'ready-for-pr') {
                            onPRIntentChange?.('ready-for-pr')
                          } else {
                            onPRIntentChange?.('work-in-progress')
                          }
                          setShowIntentDropdown(false)
                        }}
                        className={`w-full px-4 py-2.5 text-left text-sm flex items-center justify-between hover:bg-white/10 transition-colors ${
                          userIntent === option.value ? 'bg-white/5' : ''
                        }`}
                      >
                        <span className={option.color}>{option.label}</span>
                        {userIntent === option.value && (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Staging & Team PR Buttons */}
              <div>
                <div className="text-[10px] font-semibold text-white/40 mb-2.5 uppercase tracking-widest">
                  Team Actions
                </div>
                <button
                  onClick={() => onOpenStaging?.()}
                  className="w-full px-4 py-3 bg-white text-black rounded-xl text-sm font-semibold hover:bg-white/90 transition-all duration-200 flex items-center justify-center gap-2 shadow-lg"
                >
                  <GitPullRequest className="w-4 h-4" />
                  Open Staging
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Team PR Builder Modal */}
      {showPRBuilder && repoFullName && (
        <TeamPRBuilder
          isOpen={showPRBuilder}
          onClose={() => setShowPRBuilder(false)}
          teamContributors={onlineUsers.map(user => {
            const userActivity = Object.values(fileActivity).filter(a => a.user_id === user.user_id)
            return {
              user_id: user.user_id,
              user_name: user.name,
              files_modified: userActivity.map(a => a.file_path),
              lines_added: 0, // TODO: Track actual line changes
              lines_removed: 0, // TODO: Track actual line changes
              ready_for_pr: user.user_id === onlineUsers[0]?.user_id 
                ? prIntent === 'ready-for-pr' 
                : false // Default others to false, will be synced via WebSocket
            }
          })}
          repoFullName={repoFullName}
          onCreatePR={(contributors, title, description) => {
            onCreateTeamPR?.(contributors, title, description)
            setShowPRBuilder(false)
          }}
        />
      )}
    </div>
  )
}

function showNotification(message: string, type: 'info' | 'warning') {
  console.log(`[${type.toUpperCase()}] ${message}`)
  // TODO: Integrate with toast notifications
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  
  return date.toLocaleDateString()
}

