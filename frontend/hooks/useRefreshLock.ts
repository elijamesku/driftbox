'use client'

import { useState, useEffect, useCallback } from 'react'

const LOCK_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
const MAX_REFRESHES_PER_DAY = 2 // Regular users get 2 refreshes per 24 hours

interface RefreshLockState {
  isLocked: boolean
  timeRemaining: number | null // milliseconds remaining
  unlockTime: number | null // timestamp when lock will unlock
  refreshesRemaining: number // How many refreshes left in 24h window
}

/**
 * Custom hook to manage refresh limits for reducing server load
 * 
 * - Team workspaces: Unlimited refreshes (no lock)
 * - Regular users: 2 refreshes per 24-hour sliding window
 * 
 * @param lockKey - Unique key for this refresh button (e.g., 'dashboard', 'diagram', 'documentation', 'drift')
 * @param isTeamWorkspace - Whether the user is in a team workspace (defaults to false)
 * @returns Object with lock state and functions to check/update lock
 */
export function useRefreshLock(lockKey: string, isTeamWorkspace: boolean = false) {
  const [lockState, setLockState] = useState<RefreshLockState>({
    isLocked: false,
    timeRemaining: null,
    unlockTime: null,
    refreshesRemaining: MAX_REFRESHES_PER_DAY
  })

  // Get storage key for localStorage (timestamps array)
  const getStorageKey = useCallback(() => {
    return `refresh_timestamps_${lockKey}`
  }, [lockKey])

  // Get valid (non-expired) timestamps from storage
  const getValidTimestamps = useCallback((): number[] => {
    try {
      const storageKey = getStorageKey()
      const stored = localStorage.getItem(storageKey)
      
      if (!stored) {
        return []
      }

      const timestamps: number[] = JSON.parse(stored)
      const now = Date.now()
      
      // Filter out timestamps older than 24 hours
      const validTimestamps = timestamps.filter(ts => (now - ts) < LOCK_DURATION_MS)
      
      // If we filtered any out, update storage
      if (validTimestamps.length !== timestamps.length) {
        if (validTimestamps.length === 0) {
          localStorage.removeItem(storageKey)
        } else {
          localStorage.setItem(storageKey, JSON.stringify(validTimestamps))
        }
      }
      
      return validTimestamps
    } catch (e) {
      console.warn(`[RefreshLock] Failed to get timestamps for ${lockKey}:`, e)
      return []
    }
  }, [getStorageKey, lockKey])

  // Check if currently locked (only for regular users)
  const checkLock = useCallback((): boolean => {
    // Team workspaces are never locked
    if (isTeamWorkspace) {
      return false
    }

    const validTimestamps = getValidTimestamps()
    return validTimestamps.length >= MAX_REFRESHES_PER_DAY
  }, [isTeamWorkspace, getValidTimestamps])

  // Get time remaining until oldest refresh expires (allowing a new one)
  const getTimeRemaining = useCallback((): number | null => {
    // Team workspaces have no lock
    if (isTeamWorkspace) {
      return null
    }

    const validTimestamps = getValidTimestamps()
    
    if (validTimestamps.length < MAX_REFRESHES_PER_DAY) {
      return null // Not locked
    }

    // Find the oldest timestamp - when it expires, user gets a refresh back
    const oldestTimestamp = Math.min(...validTimestamps)
    const now = Date.now()
    const remaining = LOCK_DURATION_MS - (now - oldestTimestamp)

    if (remaining <= 0) {
      return null
    }

    return remaining
  }, [isTeamWorkspace, getValidTimestamps])

  // Get number of refreshes remaining
  const getRefreshesRemaining = useCallback((): number => {
    // Team workspaces have unlimited refreshes
    if (isTeamWorkspace) {
      return Infinity
    }

    const validTimestamps = getValidTimestamps()
    return Math.max(0, MAX_REFRESHES_PER_DAY - validTimestamps.length)
  }, [isTeamWorkspace, getValidTimestamps])

  // Record a refresh (add timestamp)
  const lockRefresh = useCallback(() => {
    // Team workspaces don't need to track refreshes
    if (isTeamWorkspace) {
      console.log(`[RefreshLock] Skipping lock for ${lockKey} - team workspace (unlimited refreshes)`)
      return
    }

    try {
      const storageKey = getStorageKey()
      const validTimestamps = getValidTimestamps()
      const now = Date.now()
      
      // Add new timestamp
      validTimestamps.push(now)
      localStorage.setItem(storageKey, JSON.stringify(validTimestamps))
      
      const remaining = MAX_REFRESHES_PER_DAY - validTimestamps.length
      
      if (remaining <= 0) {
        // Find when the oldest refresh will expire
        const oldestTimestamp = Math.min(...validTimestamps)
        const timeUntilUnlock = LOCK_DURATION_MS - (now - oldestTimestamp)
        
        setLockState({
          isLocked: true,
          timeRemaining: timeUntilUnlock,
          unlockTime: now + timeUntilUnlock,
          refreshesRemaining: 0
        })
        
        console.log(`[RefreshLock] ${lockKey} locked - 0 refreshes remaining. Next available in ${Math.ceil(timeUntilUnlock / 60000)} minutes`)
      } else {
        setLockState(prev => ({
          ...prev,
          refreshesRemaining: remaining
        }))
        
        console.log(`[RefreshLock] ${lockKey} refresh used - ${remaining} refreshes remaining`)
      }
    } catch (e) {
      console.warn(`[RefreshLock] Failed to record refresh for ${lockKey}:`, e)
    }
  }, [isTeamWorkspace, getStorageKey, getValidTimestamps, lockKey])

  // Format time remaining as human-readable string
  const formatTimeRemaining = useCallback((ms: number | null): string => {
    if (ms === null || ms <= 0) {
      return ''
    }

    const hours = Math.floor(ms / (60 * 60 * 1000))
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))
    const seconds = Math.floor((ms % (60 * 1000)) / 1000)

    if (hours > 0) {
      return `${hours}h ${minutes}m`
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    } else {
      return `${seconds}s`
    }
  }, [])

  // Update lock state periodically
  useEffect(() => {
    // Team workspaces are never locked
    if (isTeamWorkspace) {
      setLockState({
        isLocked: false,
        timeRemaining: null,
        unlockTime: null,
        refreshesRemaining: Infinity
      })
      return
    }

    // Initial check
    const isLocked = checkLock()
    const timeRemaining = getTimeRemaining()
    const unlockTime = timeRemaining ? Date.now() + timeRemaining : null
    const refreshesRemaining = getRefreshesRemaining()

    setLockState({
      isLocked,
      timeRemaining,
      unlockTime,
      refreshesRemaining
    })

    // Update every second if locked
    if (isLocked) {
      const interval = setInterval(() => {
        const stillLocked = checkLock()
        const remaining = getTimeRemaining()
        const refreshesLeft = getRefreshesRemaining()

        if (!stillLocked || remaining === null) {
          setLockState({
            isLocked: false,
            timeRemaining: null,
            unlockTime: null,
            refreshesRemaining: refreshesLeft
          })
          clearInterval(interval)
        } else {
          setLockState(prev => ({
            ...prev,
            timeRemaining: remaining,
            unlockTime: Date.now() + remaining,
            refreshesRemaining: refreshesLeft
          }))
        }
      }, 1000)

      return () => clearInterval(interval)
    }
  }, [isTeamWorkspace, checkLock, getTimeRemaining, getRefreshesRemaining])

  return {
    isLocked: lockState.isLocked,
    timeRemaining: lockState.timeRemaining,
    timeRemainingFormatted: formatTimeRemaining(lockState.timeRemaining),
    refreshesRemaining: lockState.refreshesRemaining,
    lockRefresh,
    checkLock
  }
}
