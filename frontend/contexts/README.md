# Context Providers

This directory contains React Context providers for managing global application state.

## Structure

```
contexts/
├── AuthContext.tsx      # Authentication and user management
├── GitHubContext.tsx    # GitHub integration and repository operations
├── index.tsx            # Providers wrapper & exports (import this!)
├── README.md            # This file (full documentation)
├── QUICK_START.md       # Quick start guide
└── EXAMPLES.md          # Real-world examples
```

## Setup

The providers are automatically wrapped around your application via `contexts/index.tsx` which is imported in the root `app/layout.tsx`.

## Usage

### AuthContext

Manages user authentication, JWT tokens, and user data.

#### Available Hook

```typescript
import { useAuth } from '@/contexts/AuthContext'

function MyComponent() {
  const { 
    user,              // User object with profile data
    token,             // JWT auth token
    isAuthenticated,   // Boolean auth status
    isLoading,         // Loading state during initialization
    login,             // Function to log in: (token: string, userData?: User) => void
    logout,            // Function to log out: () => void
    updateUser,        // Function to update user data: (userData: User) => void
    refreshUser,       // Function to refresh user from API: () => Promise<void>
  } = useAuth()

  // Example: Display user info
  if (isLoading) return <div>Loading...</div>
  if (!isAuthenticated) return <div>Please log in</div>

  return <div>Welcome, {user?.email}!</div>
}
```

#### Methods

- **`login(token: string, userData?: User)`**
  - Sets the auth token and optionally user data
  - Stores token in localStorage
  - If userData not provided, fetches it from API

- **`logout()`**
  - Clears all auth data
  - Removes token from localStorage
  - Redirects to home page

- **`updateUser(userData: User)`**
  - Updates user data in state and localStorage

- **`refreshUser()`**
  - Fetches fresh user data from API
  - Updates state and localStorage

#### Example: Login Flow

```typescript
import { useAuth } from '@/contexts/AuthContext'

function LoginComponent() {
  const { login } = useAuth()

  const handleLogin = async (email: string, password: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })

    if (response.ok) {
      const { token, user } = await response.json()
      login(token, user)
      // User is now authenticated!
    }
  }

  return <form onSubmit={handleLogin}>...</form>
}
```

### GitHubContext

Manages GitHub integration, repositories, and file operations.

#### Available Hook

```typescript
import { useGitHub } from '@/contexts/GitHubContext'

function MyComponent() {
  const {
    githubToken,       // GitHub access token from user
    repos,             // Array of user's GitHub repos
    isLoadingRepos,    // Loading state for repos
    currentRepo,       // Currently selected repository
    setCurrentRepo,    // Function to set current repo: (repo: GitHubRepo | null) => void
    fetchRepos,        // Function to fetch repos: () => Promise<void>
    fetchRepoContents, // Function to fetch repo contents: (owner, repo, path?) => Promise<GitHubFile[]>
    fetchFileContent,  // Function to fetch file content: (owner, repo, path) => Promise<string>
    cloneRepo,         // Function to clone repo: (repoUrl: string) => Promise<{success, message}>
  } = useGitHub()

  // Example: List user's repos
  useEffect(() => {
    fetchRepos()
  }, [fetchRepos])

  return (
    <ul>
      {repos.map(repo => (
        <li key={repo.id}>{repo.full_name}</li>
      ))}
    </ul>
  )
}
```

#### Methods

- **`fetchRepos()`**
  - Fetches all repositories for the authenticated user
  - Updates `repos` state
  - Sets `isLoadingRepos` during fetch

- **`fetchRepoContents(owner: string, repo: string, path?: string)`**
  - Fetches contents of a directory in a repository
  - Returns array of files and folders
  - Path defaults to root if not provided

- **`fetchFileContent(owner: string, repo: string, path: string)`**
  - Fetches and decodes content of a specific file
  - Returns the file content as a string
  - Automatically handles base64 decoding

- **`cloneRepo(repoUrl: string)`**
  - Clones a repository to the backend
  - Returns `{ success: boolean, message: string }`

- **`setCurrentRepo(repo: GitHubRepo | null)`**
  - Sets the currently active repository

#### Example: Browse Repository

```typescript
import { useGitHub } from '@/contexts/GitHubContext'
import { useState } from 'react'

function RepoBrowser() {
  const { fetchRepoContents, fetchFileContent } = useGitHub()
  const [files, setFiles] = useState([])
  const [content, setContent] = useState('')

  const loadRepo = async () => {
    const contents = await fetchRepoContents('owner', 'repo-name')
    setFiles(contents)
  }

  const openFile = async (path: string) => {
    const fileContent = await fetchFileContent('owner', 'repo-name', path)
    setContent(fileContent)
  }

  return (
    <div>
      <button onClick={loadRepo}>Load Repo</button>
      <ul>
        {files.map(file => (
          <li key={file.path} onClick={() => openFile(file.path)}>
            {file.name}
          </li>
        ))}
      </ul>
      <pre>{content}</pre>
    </div>
  )
}
```

#### Example: Clone Repository

```typescript
import { useGitHub } from '@/contexts/GitHubContext'

function CloneButton() {
  const { cloneRepo } = useGitHub()

  const handleClone = async () => {
    const result = await cloneRepo('https://github.com/owner/repo')
    
    if (result.success) {
      alert('Repository cloned successfully!')
    } else {
      alert(`Failed to clone: ${result.message}`)
    }
  }

  return <button onClick={handleClone}>Clone Repo</button>
}
```

## Dependencies

Both contexts depend on:
- User being authenticated (AuthContext handles this)
- API routes in `app/api/proxy/` for backend communication
- localStorage for persisting auth state

## Notes

- The contexts are automatically available throughout your app via the `Providers` wrapper
- Both use 'use client' directive as they rely on React hooks and browser APIs
- Auth tokens are stored in localStorage for persistence across sessions
- GitHub token comes from the user's profile data (requires GitHub OAuth)
- All API calls go through Next.js API routes (`/api/proxy/*`) for security

