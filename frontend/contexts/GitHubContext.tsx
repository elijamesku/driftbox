'use client'

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { apiFetch } from '@/utils/apiEndpoint'

interface GitHubRepo {
  id: number
  name: string
  full_name: string
  private: boolean
  owner: {
    login: string
    avatar_url: string
  }
  description: string | null
  html_url: string
  clone_url: string
  ssh_url: string
  default_branch: string
  updated_at: string
  [key: string]: any
}

interface GitHubFile {
  name: string
  path: string
  type: 'file' | 'dir'
  size: number
  sha: string
  download_url?: string
  content?: string
  encoding?: string
}

interface GitHubContextType {
  githubToken: string | null
  repos: GitHubRepo[]
  isLoadingRepos: boolean
  currentRepo: GitHubRepo | null
  setCurrentRepo: (repo: GitHubRepo | null) => void
  fetchRepos: () => Promise<void>
  fetchRepoContents: (owner: string, repo: string, path?: string) => Promise<GitHubFile[]>
  fetchFileContent: (owner: string, repo: string, path: string) => Promise<string>
  cloneRepo: (repoUrl: string) => Promise<{ success: boolean; message: string }>
}

const GitHubContext = createContext<GitHubContextType | undefined>(undefined)

export function GitHubProvider({ children }: { children: ReactNode }) {
  const { user, token, logout } = useAuth()
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [isLoadingRepos, setIsLoadingRepos] = useState(false)
  const [currentRepo, setCurrentRepo] = useState<GitHubRepo | null>(null)

  // Get GitHub token from user data
  const githubToken = user?.github_access_token || null

  // Cache key for repos
  const REPOS_CACHE_KEY = 'github_repos_cache'
  const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

  // Helper to get cached repos
  const getCachedRepos = (): GitHubRepo[] | null => {
    try {
      const cached = localStorage.getItem(REPOS_CACHE_KEY)
      if (cached) {
        const { data, timestamp } = JSON.parse(cached)
        const cacheAge = Date.now() - timestamp
        if (cacheAge < CACHE_DURATION) {
          console.log('🐙 [GitHubContext] ✅ Using cached repos (age:', Math.round(cacheAge / 1000), 's)')
          return data
        } else {
          console.log('🐙 [GitHubContext] ⏰ Cache expired, will fetch fresh')
          localStorage.removeItem(REPOS_CACHE_KEY)
        }
      }
    } catch (e) {
      console.error('🐙 [GitHubContext] Failed to read repos cache:', e)
    }
    return null
  }

  // Helper to cache repos
  const cacheRepos = (reposList: GitHubRepo[]) => {
    try {
      localStorage.setItem(REPOS_CACHE_KEY, JSON.stringify({
        data: reposList,
        timestamp: Date.now()
      }))
      console.log('🐙 [GitHubContext] 💾 Cached', reposList.length, 'repos')
    } catch (e) {
      console.error('🐙 [GitHubContext] Failed to cache repos:', e)
    }
  }

  // Load cached repos on mount
  useEffect(() => {
    const cached = getCachedRepos()
    if (cached && cached.length > 0) {
      console.log('🐙 [GitHubContext] 📦 Loading', cached.length, 'cached repos immediately')
      setRepos(cached)
    }
  }, [])

  // Log context state on initialization and updates
  useEffect(() => {
    console.log('🐙 [GitHubContext] State updated:', {
      hasAuthToken: !!token,
      hasUser: !!user,
      hasGitHubToken: !!githubToken,
      githubTokenLength: githubToken?.length || 0,
      reposCount: repos.length,
      currentRepo: currentRepo?.full_name || null
    })
  }, [token, user, githubToken, repos.length, currentRepo])

  const fetchRepos = useCallback(async () => {
    console.log('🐙 [GitHubContext] fetchRepos called')
    console.log('🐙 [GitHubContext] Auth token available:', !!token)
    console.log('🐙 [GitHubContext] GitHub token available:', !!githubToken)
    
    if (!token || !githubToken) {
      console.warn('🐙 [GitHubContext] ⚠️ Cannot fetch repos - missing tokens:', {
        hasAuthToken: !!token,
        hasGitHubToken: !!githubToken
      })
      return
    }

    // Show cached repos immediately if available (already set in useEffect)
    // Now fetch fresh data in background
    console.log('🐙 [GitHubContext] Fetching fresh repos from API...')
    setIsLoadingRepos(true)
    try {
      // Add cache-busting query parameter to ensure fresh data
      const cacheBuster = `?t=${Date.now()}`
      const response = await apiFetch(`/auth/github/repos${cacheBuster}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
        cache: 'no-store', // Ensure no caching
      })

      console.log('🐙 [GitHubContext] API response status:', response.status)

      if (response.status === 401) {
        // Auth token expired or invalid
        console.warn('🐙 [GitHubContext] ⚠️ Auth token expired (401), logging out')
        logout()
        return
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch repos: ${response.status}`)
      }

      const data = await response.json()
      const reposList = data.repos || data || []
      
      // Update repos and cache
      setRepos(reposList)
      cacheRepos(reposList)
      console.log('🐙 [GitHubContext] ✅ Repos fetched successfully:', reposList.length, 'repositories')
    } catch (error) {
      console.error('🐙 [GitHubContext] ❌ Error fetching repos:', error)
      // Don't clear repos on error - keep cached ones visible
      // Only clear if we have no cached repos
      if (repos.length === 0) {
        setRepos([])
      }
    } finally {
      setIsLoadingRepos(false)
      console.log('🐙 [GitHubContext] Fetch repos complete')
    }
  }, [token, githubToken, logout, repos.length])

  // Automatically fetch repos when tokens become available
  // Use a ref to track if we've already attempted to fetch to prevent infinite loops
  const hasFetchedRef = React.useRef(false)
  const fetchReposRef = React.useRef(fetchRepos)
  
  // Keep ref updated with latest fetchRepos
  React.useEffect(() => {
    fetchReposRef.current = fetchRepos
  }, [fetchRepos])
  
  useEffect(() => {
    // Only fetch if we have tokens, haven't fetched yet, and have no repos
    if (token && githubToken && !hasFetchedRef.current && repos.length === 0 && !isLoadingRepos) {
      console.log('🐙 [GitHubContext] Auto-fetching repos on token availability')
      hasFetchedRef.current = true
      fetchReposRef.current()
    }
    // Reset fetch flag if tokens are cleared (user logged out)
    if (!token || !githubToken) {
      hasFetchedRef.current = false
    }
  }, [token, githubToken, repos.length, isLoadingRepos])

  const fetchRepoContents = useCallback(
    async (owner: string, repo: string, path: string = ''): Promise<GitHubFile[]> => {
      console.log('🐙 [GitHubContext] fetchRepoContents called:', { owner, repo, path: path || '(root)' })
      
      if (!token) {
        console.error('🐙 [GitHubContext] ❌ Not authenticated - no token')
        throw new Error('Not authenticated')
      }

      console.log('🐙 [GitHubContext] Fetching repo contents from API...')
      const response = await apiFetch(
        `/github/contents?owner=${owner}&repo=${repo}&path=${encodeURIComponent(path)}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      )

      console.log('🐙 [GitHubContext] API response status:', response.status)

      if (response.status === 401) {
        // Auth token expired or invalid
        console.warn('🐙 [GitHubContext] ⚠️ Auth token expired (401) during contents fetch')
        logout()
        throw new Error('Authentication expired. Please log in again.')
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('🐙 [GitHubContext] ❌ Failed to fetch contents:', errorData)
        throw new Error(errorData.error || `Failed to fetch contents: ${response.status}`)
      }

      const data = await response.json()
      console.log('🐙 [GitHubContext] ✅ Contents fetched:', Array.isArray(data) ? `${data.length} items` : '1 item')
      return data
    },
    [token, logout]
  )

  const fetchFileContent = useCallback(
    async (owner: string, repo: string, path: string): Promise<string> => {
      console.log('🐙 [GitHubContext] fetchFileContent called:', { owner, repo, path })
      
      if (!token) {
        console.error('🐙 [GitHubContext] ❌ Not authenticated - no token')
        throw new Error('Not authenticated')
      }

      console.log('🐙 [GitHubContext] Fetching file content from API...')
      const response = await apiFetch('/github/file', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ owner, repo, path }),
      })

      console.log('🐙 [GitHubContext] API response status:', response.status)

      if (response.status === 401) {
        // Auth token expired or invalid
        console.warn('🐙 [GitHubContext] ⚠️ Auth token expired (401) during file fetch')
        logout()
        throw new Error('Authentication expired. Please log in again.')
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('🐙 [GitHubContext] ❌ Failed to fetch file:', errorData)
        throw new Error(errorData.error || `Failed to fetch file: ${response.status}`)
      }

      const data = await response.json()

      // Decode base64 content
      if (data.content && data.encoding === 'base64') {
        const decoded = atob(data.content.replace(/\n/g, ''))
        console.log('🐙 [GitHubContext] ✅ File content decoded:', decoded.length, 'characters')
        return decoded
      }

      console.log('🐙 [GitHubContext] ✅ File content fetched:', data.content?.length || 0, 'characters')
      return data.content || ''
    },
    [token, logout]
  )

  const cloneRepo = useCallback(
    async (repoUrl: string): Promise<{ success: boolean; message: string }> => {
      console.log('🐙 [GitHubContext] cloneRepo called:', repoUrl)
      
      if (!token) {
        console.error('🐙 [GitHubContext] ❌ Not authenticated - no token')
        return { success: false, message: 'Not authenticated' }
      }

      console.log('🐙 [GitHubContext] Cloning repository via API...')
      try {
        const response = await apiFetch('/github/clone', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ repo_url: repoUrl }),
        })

      console.log('🐙 [GitHubContext] API response status:', response.status)
      const data = await response.json()

      if (response.status === 401) {
        // Auth token expired or invalid
        console.warn('🐙 [GitHubContext] ⚠️ Auth token expired (401) during clone')
        logout()
        return { success: false, message: 'Authentication expired. Please log in again.' }
      }

      if (!response.ok) {
        console.error('🐙 [GitHubContext] ❌ Clone failed:', data.error)
        return { success: false, message: data.error || 'Failed to clone repository' }
      }

        console.log('🐙 [GitHubContext] ✅ Repository cloned successfully')
        if (data.useGitHubAPI) {
          console.log('🐙 [GitHubContext] ℹ️ Backend returned useGitHubAPI flag (serverless mode)')
        }
        return { success: true, message: data.message || 'Repository cloned successfully' }
      } catch (error) {
        console.error('🐙 [GitHubContext] ❌ Network error cloning repo:', error)
        return { success: false, message: 'Network error while cloning repository' }
      }
    },
    [token, logout]
  )

  const value: GitHubContextType = {
    githubToken,
    repos,
    isLoadingRepos,
    currentRepo,
    setCurrentRepo,
    fetchRepos,
    fetchRepoContents,
    fetchFileContent,
    cloneRepo,
  }

  return <GitHubContext.Provider value={value}>{children}</GitHubContext.Provider>
}

export function useGitHub() {
  const context = useContext(GitHubContext)
  if (context === undefined) {
    throw new Error('useGitHub must be used within a GitHubProvider')
  }
  return context
}

