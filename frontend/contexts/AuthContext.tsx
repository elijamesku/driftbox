'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { apiFetch } from '@/utils/apiEndpoint'

interface User {
  id: string
  email: string
  username?: string
  github_access_token?: string
  [key: string]: any
}

interface AuthContextType {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (token: string, userData?: User) => void
  logout: () => void
  updateUser: (userData: User) => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  // Initialize state directly from localStorage to survive React StrictMode double-mounting
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window === 'undefined') return null
    const storedUser = localStorage.getItem('user_data')
    if (storedUser) {
      try {
        return JSON.parse(storedUser)
      } catch {
        return null
      }
    }
    return null
  })
  
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('token')
  })
  
  const [isLoading, setIsLoading] = useState(true)
  const hasFetchedRef = useRef(false) // Prevent duplicate fetches in React Strict Mode

  // Initialize auth state from localStorage
  useEffect(() => {
    if (hasFetchedRef.current) return // Prevent duplicate calls in React Strict Mode
    hasFetchedRef.current = true
    
    console.log('🔐 [AuthContext] Initializing...')
    const storedToken = localStorage.getItem('token')
    const storedUser = localStorage.getItem('user_data')

    console.log('🔐 [AuthContext] Stored token found:', !!storedToken)
    console.log('🔐 [AuthContext] Stored user found:', !!storedUser)

    if (storedToken) {
      // Token already set in initial state, just verify
      console.log('🔐 [AuthContext] Token loaded from localStorage')
      
      if (storedUser) {
        // User already set in initial state
        console.log('🔐 [AuthContext] User loaded from localStorage')
      }
      
      // User data exists - stop loading immediately so spinner shows
      setIsLoading(false)
      
      // Fetch fresh user data in background (but don't block the UI)
      console.log('🔐 [AuthContext] Fetching fresh user data in background...')
      fetchUserData(storedToken)
    } else {
      console.log('🔐 [AuthContext] No token found, user not authenticated')
      setIsLoading(false)
    }
  }, [])

  const fetchUserData = async (authToken: string) => {
    console.log('🔐 [AuthContext] Fetching user data from API...')
    try {
      // Add timeout to prevent blocking - auth should be fast but allow for backend load
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout - matches proxy timeout
      
      const response = await apiFetch('/auth/me', {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      console.log('🔐 [AuthContext] API response status:', response.status)

      if (response.ok) {
        const data = await response.json()
        const userData = data.user || data
        setUser(userData)
        localStorage.setItem('user_data', JSON.stringify(userData))
        localStorage.setItem('last_user_id', userData.id) // Track current user
        console.log('🔐 [AuthContext] ✅ User data fetched successfully:', {
          id: userData.id,
          email: userData.email,
          hasGitHubToken: !!userData.github_access_token,
          githubTokenLength: userData.github_access_token?.length || 0
        })
      } else {
        // Background refresh failed - keep existing auth (tokens never expire)
        console.warn('[AuthContext] ⚠️ Failed to refresh user data in background:', response.status, '- keeping existing auth state')
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn('[AuthContext] ⚠️ Auth/me request timed out after 10s - using cached data')
      } else {
        console.error('[AuthContext] Error fetching user data:', error)
      }
      // Don't fail - keep existing cached auth state
    } finally {
      setIsLoading(false)
      console.log('[AuthContext] Loading complete')
    }
  }

  const login = (authToken: string, userData?: User) => {
    console.log('[AuthContext] Login called')
    console.log('[AuthContext] Token provided:', !!authToken)
    console.log('[AuthContext] User data provided:', !!userData)
    
    // Check if this is a different user - if so, clear all cache
    const previousUserId = localStorage.getItem('last_user_id')
    const newUserId = userData?.id
    
    if (previousUserId && newUserId && previousUserId !== newUserId) {
      console.log('[AuthContext] Different user detected - clearing all cache')
      // Clear all cache except auth data
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && !key.startsWith('auth_') && !key.startsWith('user_data') && !key.startsWith('last_user_id')) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key))
      console.log(`[AuthContext] Cleared ${keysToRemove.length} cache entries for new user`)
    }
    
    setToken(authToken)
    localStorage.setItem('token', authToken)
    console.log('[AuthContext] Token stored in localStorage')

    if (userData) {
      setUser(userData)
      localStorage.setItem('user_data', JSON.stringify(userData))
      localStorage.setItem('last_user_id', userData.id) // Track current user
      console.log('[AuthContext] Login successful with user data:', {
        id: userData.id,
        email: userData.email,
        hasGitHubToken: !!userData.github_access_token
      })
    } else {
      // Fetch user data if not provided
      console.log('[AuthContext] No user data provided, fetching from API...')
      fetchUserData(authToken)
    }
  }

  const logout = useCallback(() => {
    console.log('[AuthContext] Logout called')
    setToken(null)
    setUser(null)
    
    // Only clear auth data, NOT cache - cache persists across sessions unless different user logs in
    localStorage.removeItem('token')
    localStorage.removeItem('user_data')
    
    // Remove ALL existing overlays (including anonymous ones from IDE page)
    const allOverlays = document.querySelectorAll('[id*="overlay"], [style*="z-index: 99999"]')
    allOverlays.forEach(overlay => {
      console.log('[AuthContext] Removing existing overlay:', overlay.id || 'anonymous')
      overlay.remove()
    })
    
    console.log('[AuthContext] Auth data cleared (cache preserved), redirecting immediately to home...')
    // Redirect immediately to landing page - no loading screen needed
    window.location.href = '/'
  }, [])

  const updateUser = (userData: User) => {
    console.log('[AuthContext] Updating user data:', {
      id: userData.id,
      email: userData.email,
      hasGitHubToken: !!userData.github_access_token
    })
    setUser(userData)
    localStorage.setItem('user_data', JSON.stringify(userData))
    console.log('[AuthContext] User data updated')
  }

  const refreshUser = async () => {
    console.log('[AuthContext] Refresh user called')
    if (token) {
      console.log('[AuthContext] Token available, refreshing user data...')
      await fetchUserData(token)
    } else {
      console.log('[AuthContext] No token available, cannot refresh')
    }
  }

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: !!token,
    isLoading,
    login,
    logout,
    updateUser,
    refreshUser,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

