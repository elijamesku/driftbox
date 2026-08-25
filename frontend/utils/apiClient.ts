/**
 * API Client utility that works in both web and Electron desktop modes
 * Automatically detects environment and routes requests appropriately
 */

import { getApiEndpoint } from './apiEndpoint'

// Detect if we're running in Electron desktop app
const isDesktop = typeof window !== 'undefined' && 
  ((window as any).electronAPI !== undefined || window.location.protocol === 'file:')

// Detect if we're in a serverless environment (Vercel)
const isServerless = typeof process !== 'undefined' && (process.env.VERCEL !== undefined)

// Get API base URL based on environment
const getApiBaseUrl = () => {
  // In desktop mode or when API routes aren't available, call backend directly
  if (isDesktop || (!isServerless && typeof window !== 'undefined' && window.location.protocol === 'file:')) {
    // Use getApiEndpoint to get the full backend URL
    const endpoint = getApiEndpoint('/')
    // Remove trailing slash and return base URL
    return endpoint.replace(/\/$/, '')
  }
  // In web/serverless mode, use Next.js API routes as proxy
  return ''
}

/**
 * Fetch GitHub repository contents
 * Works in both web (via proxy) and desktop (direct) modes
 */
export async function fetchGitHubContents(
  owner: string,
  repo: string,
  path: string = '',
  authToken: string
): Promise<any> {
  const apiBase = getApiBaseUrl()
  
  if (apiBase) {
    // Desktop mode: call backend directly
    // First get GitHub token from backend
    const userResponse = await fetch(getApiEndpoint('/auth/me'), {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
      cache: 'no-store',
    })

    if (!userResponse.ok) {
      throw new Error('Failed to get user info')
    }

    const userData = await userResponse.json()
    const githubToken = userData.user?.github_access_token || userData.github_access_token

    if (!githubToken) {
      throw new Error('No GitHub token available')
    }

    // Fetch from GitHub API directly
    const githubPath = path ? `/${path}` : ''
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents${githubPath}`,
      {
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Infrara-IDE'
        }
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch repository contents: ${response.status}`)
    }

    return await response.json()
  } else {
    // Web mode: use Next.js API proxy
    const response = await fetch(`/api/proxy/github/contents?owner=${owner}&repo=${repo}&path=${encodeURIComponent(path)}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(errorData.error || `Failed to fetch repository contents: ${response.status}`)
    }

    return await response.json()
  }
}

/**
 * Fetch GitHub file content
 * Works in both web (via proxy) and desktop (direct) modes
 */
export async function fetchGitHubFile(
  owner: string,
  repo: string,
  path: string,
  authToken: string
): Promise<any> {
  const apiBase = getApiBaseUrl()
  
  if (apiBase) {
    // Desktop mode: call backend directly
    const userResponse = await fetch(`${apiBase}/auth/me`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
      cache: 'no-store',
    })

    if (!userResponse.ok) {
      throw new Error('Failed to get user info')
    }

    const userData = await userResponse.json()
    const githubToken = userData.user?.github_access_token || userData.github_access_token

    if (!githubToken) {
      throw new Error('No GitHub token available')
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Infrara-IDE'
        }
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status}`)
    }

    return await response.json()
  } else {
    // Web mode: use Next.js API proxy
    const response = await fetch(`/api/proxy/github/file`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        owner,
        repo,
        path
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(errorData.error || `Failed to fetch file: ${response.status}`)
    }

    return await response.json()
  }
}

