'use client'

/**
 * File Lock Indicator
 * Shows lock status on files and allows requesting/releasing locks
 */

import { useState } from 'react'
import { Lock, Unlock, Clock, AlertTriangle } from 'lucide-react'
import type { FileLock } from '@/hooks/useTeamCollaboration'

interface FileLockIndicatorProps {
  filePath: string
  repoFullName: string
  lock: FileLock | null
  isOwnLock: boolean
  onAcquireLock: () => void
  onReleaseLock: () => void
  onRequestLock: () => void
  className?: string
}

export default function FileLockIndicator({
  filePath,
  repoFullName,
  lock,
  isOwnLock,
  onAcquireLock,
  onReleaseLock,
  onRequestLock,
  className = ''
}: FileLockIndicatorProps) {
  const [showTooltip, setShowTooltip] = useState(false)

  if (!lock) {
    // File is not locked - show lock button
    return (
      <button
        onClick={onAcquireLock}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`relative flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors hover:bg-[#3a3a3a] text-gray-400 hover:text-white ${className}`}
        title="Click to lock this file for exclusive editing"
      >
        <Unlock size={12} />
        <span className="hidden sm:inline">Unlocked</span>
        
        {showTooltip && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-[#1e1e1e] border border-[#3a3a3a] rounded text-[10px] text-gray-300 whitespace-nowrap z-50">
            Click to lock for exclusive editing
          </div>
        )}
      </button>
    )
  }

  if (isOwnLock) {
    // Current user has the lock
    return (
      <button
        onClick={onReleaseLock}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`relative flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-green-500/20 text-green-400 hover:bg-green-500/30 ${className}`}
        title="Click to release lock"
      >
        <Lock size={12} />
        <span className="hidden sm:inline">Locked by You</span>
        
        {showTooltip && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-[#1e1e1e] border border-[#3a3a3a] rounded text-[10px] text-gray-300 whitespace-nowrap z-50">
            Click to release lock
          </div>
        )}
      </button>
    )
  }

  // Locked by someone else
  const isExclusive = lock.lock_type === 'exclusive'
  
  return (
    <div
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      className={`relative flex items-center gap-2 ${className}`}
    >
      <div className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${
        isExclusive 
          ? 'bg-red-500/20 text-red-400' 
          : 'bg-yellow-500/20 text-yellow-400'
      }`}>
        {isExclusive ? <Lock size={12} /> : <AlertTriangle size={12} />}
        <span className="hidden sm:inline">
          {isExclusive ? 'Locked' : 'Editing'} by {lock.user_name}
        </span>
      </div>
      
      {isExclusive && (
        <button
          onClick={onRequestLock}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors"
          title="Request lock from current holder"
        >
          <Clock size={12} />
          <span className="hidden sm:inline">Request</span>
        </button>
      )}
      
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-[#1e1e1e] border border-[#3a3a3a] rounded text-[10px] text-gray-300 whitespace-nowrap z-50">
          <div className="font-medium text-white">{lock.user_name}</div>
          <div className="text-gray-400">
            {isExclusive ? 'Has exclusive lock' : 'Is currently editing'}
          </div>
          <div className="text-gray-500 mt-1">
            Since {new Date(lock.locked_at).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  )
}

// Compact version for editor tabs
export function FileLockBadge({ 
  lock, 
  isOwnLock 
}: { 
  lock: FileLock | null
  isOwnLock: boolean 
}) {
  if (!lock) return null
  
  if (isOwnLock) {
    return (
      <span className="ml-1 text-green-400" title="You have the lock">
        <Lock size={10} />
      </span>
    )
  }
  
  return (
    <span 
      className={lock.lock_type === 'exclusive' ? 'ml-1 text-red-400' : 'ml-1 text-yellow-400'} 
      title={`Locked by ${lock.user_name}`}
    >
      <Lock size={10} />
    </span>
  )
}

