# Context Provider Examples

Real-world examples of using AuthContext and GitHubContext together.

## Example 1: Protected Page with User Info

```typescript
'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function DashboardPage() {
  const { user, isAuthenticated, isLoading, logout } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login')
    }
  }, [isLoading, isAuthenticated, router])

  if (isLoading) {
    return <div>Loading...</div>
  }

  if (!isAuthenticated) {
    return null // Redirecting...
  }

  return (
    <div>
      <h1>Welcome, {user?.email || user?.username}!</h1>
      <p>User ID: {user?.id}</p>
      <button onClick={logout}>Logout</button>
    </div>
  )
}
```

## Example 2: GitHub Repository Selector

```typescript
'use client'

import { useGitHub } from '@/contexts/GitHubContext'
import { useEffect } from 'react'

export default function RepoSelector() {
  const { 
    repos, 
    isLoadingRepos, 
    currentRepo, 
    setCurrentRepo, 
    fetchRepos 
  } = useGitHub()

  useEffect(() => {
    fetchRepos()
  }, [])

  if (isLoadingRepos) {
    return <div>Loading repositories...</div>
  }

  return (
    <div>
      <h2>Select a Repository</h2>
      <select 
        value={currentRepo?.id || ''} 
        onChange={(e) => {
          const repo = repos.find(r => r.id === Number(e.target.value))
          setCurrentRepo(repo || null)
        }}
      >
        <option value="">-- Select a repo --</option>
        {repos.map(repo => (
          <option key={repo.id} value={repo.id}>
            {repo.full_name}
          </option>
        ))}
      </select>

      {currentRepo && (
        <div>
          <h3>{currentRepo.name}</h3>
          <p>{currentRepo.description}</p>
          <a href={currentRepo.html_url} target="_blank" rel="noopener noreferrer">
            View on GitHub
          </a>
        </div>
      )}
    </div>
  )
}
```

## Example 3: File Browser with Content Preview

```typescript
'use client'

import { useGitHub } from '@/contexts/GitHubContext'
import { useState } from 'react'

interface FileBrowserProps {
  owner: string
  repo: string
}

export default function FileBrowser({ owner, repo }: FileBrowserProps) {
  const { fetchRepoContents, fetchFileContent } = useGitHub()
  const [currentPath, setCurrentPath] = useState('')
  const [items, setItems] = useState<any[]>([])
  const [fileContent, setFileContent] = useState('')
  const [loading, setLoading] = useState(false)

  const loadDirectory = async (path: string = '') => {
    setLoading(true)
    try {
      const contents = await fetchRepoContents(owner, repo, path)
      setItems(contents)
      setCurrentPath(path)
      setFileContent('')
    } catch (error) {
      console.error('Error loading directory:', error)
    } finally {
      setLoading(false)
    }
  }

  const openFile = async (path: string) => {
    setLoading(true)
    try {
      const content = await fetchFileContent(owner, repo, path)
      setFileContent(content)
    } catch (error) {
      console.error('Error loading file:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleItemClick = (item: any) => {
    if (item.type === 'dir') {
      loadDirectory(item.path)
    } else {
      openFile(item.path)
    }
  }

  return (
    <div className="flex h-screen">
      <div className="w-1/3 border-r overflow-y-auto">
        <div className="p-4">
          <h3 className="font-bold mb-2">Files</h3>
          {currentPath && (
            <button 
              onClick={() => {
                const parentPath = currentPath.split('/').slice(0, -1).join('/')
                loadDirectory(parentPath)
              }}
              className="mb-2 text-blue-500"
            >
              ← Back
            </button>
          )}
          
          {loading ? (
            <div>Loading...</div>
          ) : (
            <ul>
              {items.map(item => (
                <li 
                  key={item.path}
                  onClick={() => handleItemClick(item)}
                  className="cursor-pointer hover:bg-gray-100 p-2"
                >
                  {item.type === 'dir' ? '📁' : '📄'} {item.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="w-2/3 overflow-y-auto">
        <div className="p-4">
          {fileContent ? (
            <pre className="bg-gray-900 text-white p-4 rounded">
              <code>{fileContent}</code>
            </pre>
          ) : (
            <div className="text-gray-500">
              Select a file to view its contents
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

## Example 4: User Profile with GitHub Status

```typescript
'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useGitHub } from '@/contexts/GitHubContext'
import { useEffect } from 'react'

export default function UserProfile() {
  const { user, refreshUser } = useAuth()
  const { githubToken, fetchRepos, repos } = useGitHub()

  useEffect(() => {
    if (githubToken) {
      fetchRepos()
    }
  }, [githubToken])

  const hasGitHubConnected = !!githubToken

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Profile</h1>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">User Information</h2>
        <p><strong>Email:</strong> {user?.email}</p>
        <p><strong>Username:</strong> {user?.username || 'N/A'}</p>
        <p><strong>User ID:</strong> {user?.id}</p>
      </div>

      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">GitHub Integration</h2>
        {hasGitHubConnected ? (
          <div>
            <p className="text-green-600 mb-2">✓ GitHub Connected</p>
            <p className="text-sm text-gray-600">
              You have access to {repos.length} repositories
            </p>
          </div>
        ) : (
          <div>
            <p className="text-red-600 mb-2">✗ GitHub Not Connected</p>
            <a 
              href="/api/proxy/auth/github"
              className="bg-black text-white px-4 py-2 rounded inline-block"
            >
              Connect GitHub
            </a>
          </div>
        )}
      </div>

      <button 
        onClick={refreshUser}
        className="bg-blue-500 text-white px-4 py-2 rounded"
      >
        Refresh Profile
      </button>
    </div>
  )
}
```

## Example 5: Repository Clone Component

```typescript
'use client'

import { useGitHub } from '@/contexts/GitHubContext'
import { useState } from 'react'

export default function CloneRepository() {
  const { cloneRepo } = useGitHub()
  const [repoUrl, setRepoUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const handleClone = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!repoUrl) {
      setMessage('Please enter a repository URL')
      return
    }

    setLoading(true)
    setMessage('')

    try {
      const result = await cloneRepo(repoUrl)
      
      if (result.success) {
        setMessage(`✓ ${result.message}`)
        setRepoUrl('')
      } else {
        setMessage(`✗ ${result.message}`)
      }
    } catch (error) {
      setMessage('✗ An error occurred while cloning')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">Clone Repository</h2>
      
      <form onSubmit={handleClone} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            Repository URL
          </label>
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/username/repo"
            className="w-full px-4 py-2 border rounded"
            disabled={loading}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-blue-500 text-white px-6 py-2 rounded disabled:bg-gray-400"
        >
          {loading ? 'Cloning...' : 'Clone Repository'}
        </button>

        {message && (
          <div className={`p-3 rounded ${
            message.startsWith('✓') 
              ? 'bg-green-100 text-green-800' 
              : 'bg-red-100 text-red-800'
          }`}>
            {message}
          </div>
        )}
      </form>
    </div>
  )
}
```

## Example 6: Combined Authentication & Data Flow

```typescript
'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useGitHub } from '@/contexts/GitHubContext'
import { useEffect, useState } from 'react'

export default function DashboardWithData() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()
  const { 
    repos, 
    isLoadingRepos, 
    fetchRepos,
    githubToken 
  } = useGitHub()
  const [recentActivity, setRecentActivity] = useState<any[]>([])

  // Load repos when user is authenticated and has GitHub token
  useEffect(() => {
    if (isAuthenticated && githubToken) {
      fetchRepos()
    }
  }, [isAuthenticated, githubToken])

  // Process repos to show recent activity
  useEffect(() => {
    if (repos.length > 0) {
      const sorted = [...repos]
        .sort((a, b) => 
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
        .slice(0, 5)
      setRecentActivity(sorted)
    }
  }, [repos])

  if (authLoading) {
    return <div>Loading authentication...</div>
  }

  if (!isAuthenticated) {
    return <div>Please log in</div>
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">
        Welcome back, {user?.username || user?.email}!
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-white p-4 rounded shadow">
          <h3 className="text-gray-500 text-sm">Total Repositories</h3>
          <p className="text-3xl font-bold">{repos.length}</p>
        </div>

        <div className="bg-white p-4 rounded shadow">
          <h3 className="text-gray-500 text-sm">GitHub Status</h3>
          <p className="text-3xl font-bold">
            {githubToken ? '✓' : '✗'}
          </p>
        </div>

        <div className="bg-white p-4 rounded shadow">
          <h3 className="text-gray-500 text-sm">Account</h3>
          <p className="text-lg truncate">{user?.email}</p>
        </div>
      </div>

      <div className="bg-white p-6 rounded shadow">
        <h2 className="text-xl font-bold mb-4">Recent Activity</h2>
        
        {isLoadingRepos ? (
          <div>Loading repositories...</div>
        ) : recentActivity.length > 0 ? (
          <ul className="space-y-2">
            {recentActivity.map(repo => (
              <li key={repo.id} className="border-b pb-2">
                <div className="flex justify-between">
                  <span className="font-medium">{repo.full_name}</span>
                  <span className="text-sm text-gray-500">
                    {new Date(repo.updated_at).toLocaleDateString()}
                  </span>
                </div>
                {repo.description && (
                  <p className="text-sm text-gray-600">{repo.description}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500">
            {githubToken 
              ? 'No repositories found' 
              : 'Connect GitHub to see your repositories'
            }
          </p>
        )}
      </div>
    </div>
  )
}
```

## Tips

1. **Always check loading states** before rendering data
2. **Handle errors gracefully** with try-catch blocks
3. **Use useEffect dependencies correctly** to prevent infinite loops
4. **Check authentication** before making GitHub API calls
5. **Provide user feedback** for async operations (loading, success, error)
6. **Clean up effects** if needed to prevent memory leaks

