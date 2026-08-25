# Context Providers - Quick Start Guide

## 🚀 Setup Complete!

Your context providers are already set up and ready to use. They're automatically available throughout your app.

## 📁 File Structure

```
frontend/
├── contexts/
│   ├── AuthContext.tsx        ✅ Authentication & user management
│   ├── GitHubContext.tsx      ✅ GitHub integration
│   ├── index.tsx              ✅ Providers wrapper & exports
│   ├── README.md              📖 Full documentation
│   ├── EXAMPLES.md            💡 Real-world examples
│   └── QUICK_START.md         ⚡ This file
├── app/
│   └── layout.tsx             ✅ Root layout (includes Providers from @/contexts)
```

## 🎯 Usage in 30 Seconds

### 1. Authentication

```typescript
'use client'
import { useAuth } from '@/contexts/AuthContext'

function MyComponent() {
  const { user, isAuthenticated, login, logout } = useAuth()

  if (!isAuthenticated) return <div>Please log in</div>
  return <div>Hello, {user?.email}!</div>
}
```

### 2. GitHub Integration

```typescript
'use client'
import { useGitHub } from '@/contexts/GitHubContext'

function RepoList() {
  const { repos, fetchRepos } = useGitHub()

  useEffect(() => {
    fetchRepos()
  }, [])

  return (
    <ul>
      {repos.map(repo => (
        <li key={repo.id}>{repo.full_name}</li>
      ))}
    </ul>
  )
}
```

### 3. Both Together

```typescript
'use client'
import { useAuth } from '@/contexts/AuthContext'
import { useGitHub } from '@/contexts/GitHubContext'

function Dashboard() {
  const { user, isAuthenticated } = useAuth()
  const { repos, githubToken } = useGitHub()

  return (
    <div>
      <h1>Welcome {user?.email}</h1>
      <p>GitHub: {githubToken ? '✓ Connected' : '✗ Not connected'}</p>
      <p>Repos: {repos.length}</p>
    </div>
  )
}
```

## 📋 Common Patterns

### Protected Route

```typescript
'use client'
import { useAuth } from '@/contexts/AuthContext'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ProtectedPage() {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login')
    }
  }, [isLoading, isAuthenticated, router])

  if (isLoading) return <div>Loading...</div>
  if (!isAuthenticated) return null

  return <div>Protected Content</div>
}
```

### Logout Button

```typescript
import { useAuth } from '@/contexts/AuthContext'

function LogoutButton() {
  const { logout } = useAuth()

  return (
    <button onClick={logout}>
      Logout
    </button>
  )
}
```

### User Profile Display

```typescript
import { useAuth } from '@/contexts/AuthContext'

function UserProfile() {
  const { user, refreshUser } = useAuth()

  return (
    <div>
      <h2>{user?.email}</h2>
      <p>ID: {user?.id}</p>
      <button onClick={refreshUser}>Refresh</button>
    </div>
  )
}
```

### Fetch GitHub Repos

```typescript
import { useGitHub } from '@/contexts/GitHubContext'
import { useEffect } from 'react'

function MyRepos() {
  const { repos, isLoadingRepos, fetchRepos } = useGitHub()

  useEffect(() => {
    fetchRepos()
  }, [])

  if (isLoadingRepos) return <div>Loading...</div>

  return (
    <ul>
      {repos.map(repo => (
        <li key={repo.id}>
          <a href={repo.html_url}>{repo.full_name}</a>
        </li>
      ))}
    </ul>
  )
}
```

### Clone a Repository

```typescript
import { useGitHub } from '@/contexts/GitHubContext'
import { useState } from 'react'

function CloneRepo() {
  const { cloneRepo } = useGitHub()
  const [url, setUrl] = useState('')

  const handleClone = async () => {
    const result = await cloneRepo(url)
    alert(result.message)
  }

  return (
    <div>
      <input 
        value={url} 
        onChange={e => setUrl(e.target.value)}
        placeholder="Repo URL"
      />
      <button onClick={handleClone}>Clone</button>
    </div>
  )
}
```

## 🔑 Available Properties & Methods

### AuthContext

| Property | Type | Description |
|----------|------|-------------|
| `user` | `User \| null` | Current user data |
| `token` | `string \| null` | Auth JWT token |
| `isAuthenticated` | `boolean` | Is user logged in? |
| `isLoading` | `boolean` | Loading auth state? |
| `login(token, user?)` | `function` | Log in user |
| `logout()` | `function` | Log out & redirect |
| `updateUser(user)` | `function` | Update user data |
| `refreshUser()` | `function` | Fetch fresh user data |

### GitHubContext

| Property | Type | Description |
|----------|------|-------------|
| `githubToken` | `string \| null` | GitHub access token |
| `repos` | `GitHubRepo[]` | User's repositories |
| `isLoadingRepos` | `boolean` | Loading repos? |
| `currentRepo` | `GitHubRepo \| null` | Selected repo |
| `setCurrentRepo(repo)` | `function` | Set current repo |
| `fetchRepos()` | `function` | Fetch all repos |
| `fetchRepoContents(owner, repo, path?)` | `function` | Get repo contents |
| `fetchFileContent(owner, repo, path)` | `function` | Get file content |
| `cloneRepo(url)` | `function` | Clone repository |

## 💡 Pro Tips

1. **Always check `isLoading`** before checking `isAuthenticated`
2. **Use `useEffect`** with proper dependencies to fetch data
3. **Handle errors** with try-catch blocks
4. **GitHub token** comes from user profile (requires GitHub OAuth)
5. **All API calls** automatically use the auth token from context

## 🐛 Debugging

All contexts have comprehensive logging! Open your browser DevTools console to see:
- 🔐 **AuthContext** logs (with lock emoji)
- 🐙 **GitHubContext** logs (with octopus emoji)

See `DEBUGGING.md` for complete debugging guide.

## 📚 More Resources

- **Full Documentation**: See `README.md` in this directory
- **Real-world Examples**: See `EXAMPLES.md` in this directory
- **Debugging Guide**: See `DEBUGGING.md` in this directory
- **API Routes**: Check `app/api/proxy/` for backend endpoints

## ✅ Already Integrated

The following components are already using the contexts:
- ✅ `app/layout.tsx` - Imports `Providers` from `@/contexts`
- ✅ `app/ide/page.tsx` - Uses `useAuth()` for authentication
- ✅ `components/Auth/pages/Login.tsx` - Uses `login()` method
- ✅ `components/Auth/pages/Signup.tsx` - Uses `login()` method

## 💡 Pro Import Tip

You can import directly from `@/contexts`:

```typescript
// ✅ Convenient - imports from index.tsx
import { useAuth, useGitHub } from '@/contexts'

// ✅ Also works - direct import
import { useAuth } from '@/contexts/AuthContext'
```

You can now use `useAuth()` and `useGitHub()` anywhere in your app!

