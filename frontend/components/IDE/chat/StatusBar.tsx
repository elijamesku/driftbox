'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts'
import * as desktopBridge from '@/utils/desktopBridge'

interface StatusBarProps {
  cursorPosition?: { line: number; column: number }
  language?: string
  encoding?: string
  lineEnding?: string
  indentSize?: number
  errorCount?: number
  warningCount?: number
  gitBranch?: string
  gitStatus?: {
    branch?: string
    hasChanges?: boolean
    stagedCount?: number
    modifiedCount?: number
    untrackedCount?: number
    deletedCount?: number
  } | null
  selectedRepo?: {
    id: number
    name: string
    full_name: string
  } | null
  onRefreshGitStatus?: () => void
  commitsBehind?: number
  onShowTemplates?: () => void
  hasSuggestions?: boolean
}

export default function StatusBar({
  cursorPosition = { line: 1, column: 1 },
  language = 'TypeScript JSX',
  encoding = 'UTF-8',
  lineEnding = 'LF',
  indentSize = 2,
  errorCount = 0,
  warningCount = 0,
  gitBranch = 'main',
  gitStatus,
  selectedRepo,
  onRefreshGitStatus,
  commitsBehind = 0,
  onShowTemplates,
  hasSuggestions = false
}: StatusBarProps) {
  const { user } = useAuth()
  const [showDiscardModal, setShowDiscardModal] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  // Get the display name from user email or GitHub username
  const displayName = user?.email?.split('@')[0] || 'User'
  
  // Calculate time since last activity (mock for now)
  const timeSince = '14 minutes ago'

  // Determine branch and change indicator
  const branch = gitStatus?.branch || gitBranch
  const hasChanges = gitStatus?.hasChanges || false
  const totalChanges = (gitStatus?.stagedCount || 0) + (gitStatus?.modifiedCount || 0) + (gitStatus?.untrackedCount || 0) + (gitStatus?.deletedCount || 0)

  const handleDiscardClick = () => {
    if (!selectedRepo) {
      console.error('❌ [StatusBar] No repository selected')
      return
    }
    setShowDiscardModal(true)
  }

  const handleDiscardConfirm = async () => {
    if (!selectedRepo) {
      console.error('❌ [StatusBar] No repository selected')
      return
    }

    setIsDiscarding(true)
    console.log('🗑️ [StatusBar] Discarding all changes for:', selectedRepo.full_name)

    try {
      // Check if we're in desktop mode
      if (desktopBridge.isDesktop) {
        console.log('🖥️ [StatusBar] Using desktop bridge for git reset')
        
        const result = await desktopBridge.gitReset(selectedRepo.full_name)
        
        if (result.success) {
          console.log('✅ [StatusBar] Successfully discarded changes')
          
          // Close modal
          setShowDiscardModal(false)
          setIsDiscarding(false)
          
          // Refresh git status to clear indicators
          if (onRefreshGitStatus) {
            console.log('🔄 [StatusBar] Refreshing git status after discard')
            onRefreshGitStatus()
          }
        } else {
          console.error('❌ [StatusBar] Failed to discard changes:', result.error)
          alert(`❌ Failed to discard changes:\n\n${result.error}`)
          setIsDiscarding(false)
        }
      } else {
        console.warn('⚠️ [StatusBar] Not in desktop mode, cannot discard changes')
        alert('⚠️ This feature is only available in the desktop app.')
        setIsDiscarding(false)
      }
    } catch (error) {
      console.error('❌ [StatusBar] Error discarding changes:', error)
      alert(`❌ Error discarding changes:\n\n${error}`)
      setIsDiscarding(false)
    }
  }

  const handleDiscardCancel = () => {
    setShowDiscardModal(false)
  }

  // Helper to sanitize error messages (remove tokens)
  const sanitizeError = (error: string) => {
    // Remove GitHub tokens from error messages (they look like gho_xxxx or ghp_xxxx)
    return error.replace(/https:\/\/[^@]+@github\.com/g, 'https://github.com')
                .replace(/gho_[a-zA-Z0-9]+/g, '[token]')
                .replace(/ghp_[a-zA-Z0-9]+/g, '[token]')
  }

  // Manual sync with GitHub
  const handleSync = async () => {
    if (!selectedRepo || isSyncing) return
    
    const [owner, repo] = selectedRepo.full_name.split('/')
    const isDesktop = typeof window !== 'undefined' && (window as any).electronAPI?.isDesktop
    
    if (!isDesktop || !(window as any).electronAPI?.gitPull) {
      console.log('⚠️ [StatusBar] Sync not available - not in desktop mode or API missing')
      return
    }
    
    setIsSyncing(true)
    setSyncError(null)
    console.log(`🔄 [StatusBar] Syncing ${owner}/${repo} with GitHub...`)
    
    try {
      // Get GitHub token for authenticated pull
      const tokenResult = await (window as any).electronAPI?.getGitHubToken?.()
      const githubToken = tokenResult?.token
      
      const result = await (window as any).electronAPI.gitPull(owner, repo, 'main', githubToken)
      if (result.success) {
        console.log(`✅ [StatusBar] Synced successfully`)
        setSyncError(null)
        // Refresh file tree and git status
        if (onRefreshGitStatus) {
          onRefreshGitStatus()
        }
      } else {
        const errorMsg = result.error || 'Unknown error'
        const safeError = sanitizeError(errorMsg)
        
        // Check if it's a conflict error
        if (errorMsg.includes('would be overwritten') || 
            errorMsg.includes('local changes') ||
            errorMsg.includes('Please commit your changes')) {
          // Extract the conflicting file(s) from the error
          const fileMatch = errorMsg.match(/Your local changes to the following files would be overwritten[^:]*:\s*([\s\S]*?)(?:Please commit|$)/i)
          const files = fileMatch ? fileMatch[1].trim().split('\n').map((f: string) => f.trim()).filter(Boolean) : []
          
          const conflictMsg = files.length > 0 
            ? `Conflict: ${files.join(', ')} has local changes`
            : 'Local changes conflict with remote'
          
          console.log(`⚠️ [StatusBar] ${conflictMsg}`)
          setSyncError(conflictMsg)
          
          // Clear error after 5 seconds
          setTimeout(() => setSyncError(null), 5000)
        } else {
          console.error(`❌ [StatusBar] Sync failed:`, safeError)
          setSyncError('Sync failed')
          setTimeout(() => setSyncError(null), 5000)
        }
      }
    } catch (error: any) {
      const safeError = sanitizeError(error?.message || 'Unknown error')
      console.error(`❌ [StatusBar] Sync error:`, safeError)
      setSyncError('Sync failed')
      setTimeout(() => setSyncError(null), 5000)
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div className="h-[22px] bg-[#141414] border-t border-[#1a1a1a] flex items-center justify-between px-2 text-[11px] text-[#6e7681]">
      {/* Left section */}
      <div className="flex items-center gap-3">
        <i className="codicon codicon-close hover:bg-[#2a2a2a] rounded cursor-pointer" style={{ fontSize: 14, padding: '2px' }} title="Close" />
        
        <div 
          className={`flex items-center gap-1 hover:bg-[#2a2a2a] px-1 rounded cursor-pointer ${hasChanges ? 'text-yellow-400' : ''}`}
          title={hasChanges ? `${totalChanges} uncommitted change${totalChanges !== 1 ? 's' : ''} (${gitStatus?.stagedCount || 0} staged, ${gitStatus?.modifiedCount || 0} modified, ${gitStatus?.untrackedCount || 0} untracked)` : 'No uncommitted changes'}
        >
          <i className="codicon codicon-source-control" style={{ fontSize: 14 }} />
          <span>{branch}{hasChanges ? '*' : ''}</span>
          {hasChanges && totalChanges > 0 && (
            <span className="ml-1 text-yellow-400">({totalChanges})</span>
          )}
        </div>
        
        {hasChanges && (
          <button
            onClick={handleDiscardClick}
            className="flex items-center gap-1 hover:bg-red-600/20 px-2 py-0.5 rounded cursor-pointer text-red-400 hover:text-red-300 transition-colors"
            title="Discard all uncommitted changes (git reset --hard HEAD)"
          >
            <i className="codicon codicon-discard" style={{ fontSize: 14 }} />
            <span>Discard</span>
          </button>
        )}
        
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className={`flex items-center gap-1 hover:bg-[#2a2a2a] px-1.5 py-0.5 rounded cursor-pointer transition-colors ${isSyncing ? 'opacity-50' : ''} ${syncError ? 'text-red-400' : commitsBehind > 0 ? 'text-orange-400' : ''}`}
          title={syncError 
            ? syncError
            : commitsBehind > 0 
              ? `${commitsBehind} commit${commitsBehind > 1 ? 's' : ''} behind - commit or discard your changes to sync` 
              : 'Sync with GitHub (git pull)'}
        >
          <i className={`codicon ${syncError ? 'codicon-warning' : 'codicon-sync'} ${isSyncing ? 'animate-spin' : ''}`} style={{ fontSize: 14 }} />
          <span className="text-[10px]">
            {isSyncing ? 'Syncing...' : syncError ? 'Conflict!' : commitsBehind > 0 ? `↓${commitsBehind}` : 'Sync'}
          </span>
        </button>
        
        {/* Sync error tooltip */}
        {syncError && (
          <div className="flex items-center gap-1 text-red-400 text-[10px] px-1">
            <span>{syncError}</span>
          </div>
        )}
        
        <div className="flex items-center gap-1 hover:bg-[#2a2a2a] px-1 rounded cursor-pointer">
          <i className="codicon codicon-error" style={{ fontSize: 14 }} />
          <span>{errorCount}</span>
        </div>
        
        <div className="flex items-center gap-1 hover:bg-[#2a2a2a] px-1 rounded cursor-pointer">
          <i className="codicon codicon-warning" style={{ fontSize: 14 }} />
          <span>{warningCount}</span>
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-3">
        <span 
          className="hover:bg-[#2a2a2a] px-1 rounded cursor-pointer"
          onClick={onShowTemplates}
        >{hasSuggestions ? 'Driftbox Suggestions' : 'Driftbox Templates'}</span>
        
        <span className="hover:bg-[#2a2a2a] px-1 rounded cursor-pointer">-o- {displayName} ({timeSince})</span>
        
        <span className="hover:bg-[#2a2a2a] px-1 rounded cursor-pointer">Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
        
        <span className="hover:bg-[#2a2a2a] px-1 rounded cursor-pointer">Spaces: {indentSize}</span>
        
        <span className="hover:bg-[#2a2a2a] px-1 rounded cursor-pointer">{encoding}</span>
        
        <span className="hover:bg-[#2a2a2a] px-1 rounded cursor-pointer">{lineEnding}</span>
        
        <div className="flex items-center gap-1 hover:bg-[#2a2a2a] px-1 rounded cursor-pointer">
          <span>{'{}'}</span>
          <span>{language}</span>
        </div>
        
        <i className="codicon codicon-check hover:bg-[#2a2a2a] rounded cursor-pointer" style={{ fontSize: 14, padding: '2px' }} title="Prettier" />
        
        <i className="codicon codicon-bell hover:bg-[#2a2a2a] rounded cursor-pointer" style={{ fontSize: 14, padding: '2px' }} title="Notifications" />
      </div>

      {/* Discard Changes Confirmation Modal */}
      {showDiscardModal && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50"
          onClick={handleDiscardCancel}
        >
          <div 
            className="bg-[#252526] border border-[#3e3e42] rounded-lg shadow-2xl overflow-hidden min-w-[450px] max-w-[500px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-[#3e3e42]">
              <h3 className="text-[15px] font-semibold text-white">
                Discard All Changes?
              </h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-[13px] text-[#cccccc] mb-3">
                Are you sure you want to discard <span className="font-medium text-white">ALL uncommitted changes</span>?
              </p>
              <div className="bg-[#1e1e1e] border border-[#3e3e42] rounded p-3 mb-4">
                <p className="text-[12px] text-[#858585] mb-2">This will:</p>
                <ul className="text-[12px] text-[#cccccc] space-y-1 list-disc list-inside ml-2">
                  <li>Reset all files to last commit (git reset --hard HEAD)</li>
                  <li>Remove untracked files (git clean -fd)</li>
                </ul>
              </div>
              <p className="text-[12px] text-red-400 font-medium">
                ⚠️ This action cannot be undone!
              </p>
            </div>
            <div className="px-6 py-4 border-t border-[#3e3e42] flex items-center justify-end gap-2">
              <button
                onClick={handleDiscardCancel}
                disabled={isDiscarding}
                className="px-4 py-1.5 text-[13px] text-[#cccccc] hover:bg-[#2d2d30] rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleDiscardConfirm}
                disabled={isDiscarding}
                className="px-4 py-1.5 text-[13px] bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors"
              >
                {isDiscarding ? 'Discarding...' : 'Discard All Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

