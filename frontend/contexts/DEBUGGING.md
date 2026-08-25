# Context Provider Debugging Guide

## 🔍 Console Logging

Both contexts now have comprehensive logging to help you debug authentication and GitHub integration issues.

## 🔐 AuthContext Logs

### Log Prefix: `🔐 [AuthContext]`

All AuthContext logs use the lock emoji 🔐 prefix.

### What You'll See

#### On Page Load/Refresh
```
🔐 [AuthContext] Initializing...
🔐 [AuthContext] Stored token found: true
🔐 [AuthContext] Stored user found: true
🔐 [AuthContext] Token loaded from localStorage
🔐 [AuthContext] User loaded from localStorage: { id: "...", email: "...", hasGitHubToken: true }
🔐 [AuthContext] Fetching fresh user data...
🔐 [AuthContext] Fetching user data from API...
🔐 [AuthContext] API response status: 200
🔐 [AuthContext] ✅ User data fetched successfully: { id: "...", email: "...", hasGitHubToken: true, githubTokenLength: 40 }
🔐 [AuthContext] Loading complete
```

#### On Login
```
🔐 [AuthContext] Login called
🔐 [AuthContext] Token provided: true
🔐 [AuthContext] User data provided: true
🔐 [AuthContext] Token stored in localStorage
🔐 [AuthContext] ✅ Login successful with user data: { id: "...", email: "...", hasGitHubToken: true }
```

#### On Logout
```
🔐 [AuthContext] Logout called
🔐 [AuthContext] Auth data cleared, redirecting to home...
```

### Common Issues

| Log Message | What It Means | Fix |
|-------------|---------------|-----|
| `Stored token found: false` | User not logged in | Normal - redirect to login |
| `⚠️ Failed to fetch user data, token may be invalid` | JWT token expired or invalid | User needs to re-login |
| `❌ Failed to parse stored user data` | Corrupted localStorage | Clear localStorage and re-login |
| `hasGitHubToken: false` | GitHub not connected | User needs to connect GitHub OAuth |

## 🐙 GitHubContext Logs

### Log Prefix: `🐙 [GitHubContext]`

All GitHubContext logs use the octopus emoji 🐙 prefix (because Octocat!).

### What You'll See

#### On Context Initialization/Update
```
🐙 [GitHubContext] State updated: {
  hasAuthToken: true,
  hasUser: true,
  hasGitHubToken: true,
  githubTokenLength: 40,
  reposCount: 5,
  currentRepo: "username/repo-name"
}
```

#### When Fetching Repos
```
🐙 [GitHubContext] fetchRepos called
🐙 [GitHubContext] Auth token available: true
🐙 [GitHubContext] GitHub token available: true
🐙 [GitHubContext] Fetching repos from API...
🐙 [GitHubContext] API response status: 200
🐙 [GitHubContext] ✅ Repos fetched successfully: 12 repositories
🐙 [GitHubContext] Fetch repos complete
```

#### When Browsing Repository Contents
```
🐙 [GitHubContext] fetchRepoContents called: { owner: "user", repo: "repo-name", path: "(root)" }
🐙 [GitHubContext] Fetching repo contents from API...
🐙 [GitHubContext] API response status: 200
🐙 [GitHubContext] ✅ Contents fetched: 15 items
```

#### When Opening a File
```
🐙 [GitHubContext] fetchFileContent called: { owner: "user", repo: "repo-name", path: "src/index.ts" }
🐙 [GitHubContext] Fetching file content from API...
🐙 [GitHubContext] API response status: 200
🐙 [GitHubContext] ✅ File content decoded: 1234 characters
```

#### When Cloning a Repo
```
🐙 [GitHubContext] cloneRepo called: https://github.com/user/repo
🐙 [GitHubContext] Cloning repository via API...
🐙 [GitHubContext] API response status: 200
🐙 [GitHubContext] ✅ Repository cloned successfully
🐙 [GitHubContext] ℹ️ Backend returned useGitHubAPI flag (serverless mode)
```

### Common Issues

| Log Message | What It Means | Fix |
|-------------|---------------|-----|
| `⚠️ Cannot fetch repos - missing tokens` | Auth or GitHub token missing | Check AuthContext logs |
| `hasAuthToken: false` | User not authenticated | Login required |
| `hasGitHubToken: false` | GitHub not connected | Connect GitHub OAuth |
| `githubTokenLength: 0` | GitHub token empty | Re-authenticate with GitHub |
| `❌ Not authenticated - no token` | No JWT token available | User needs to login |
| `ℹ️ Backend returned useGitHubAPI flag` | Serverless mode detected | **This is normal!** See below |

## 🚀 "Using GitHub API fallback (serverless environment)"

### What This Message Means

This message comes from `Sidebar.tsx` (NOT from the contexts) and indicates:

```
Your backend is running in a serverless environment (like Vercel) 
and cannot clone repositories to a local filesystem.
```

### Is This a Problem? ❌ NO!

This is **expected behavior** and **not an error**. Here's why:

#### Desktop/Local Backend
```
Clone Repo → Save to local filesystem → Read files from disk
```
✅ Full file system access
✅ Can use git clone directly
✅ Faster for large repos

#### Serverless Environment (Vercel, Lambda, etc.)
```
Clone Repo → No filesystem available → Fallback to GitHub API → Read files from GitHub
```
✅ Works perfectly fine
✅ No filesystem needed
✅ Stateless (better for scaling)
⚠️ Uses GitHub API rate limits

### Why It Happens

1. Your backend detects it's in a serverless environment
2. Backend returns `{ useGitHubAPI: true }` flag
3. Frontend uses GitHub API directly instead of local filesystem
4. Everything works, just through a different path!

### Detection Logic

From `Sidebar.tsx`:
```typescript
if (cloneData.useGitHubAPI) {
  // Backend said: "I can't use filesystem, use GitHub API instead"
  console.log('Using GitHub API fallback (serverless environment)')
  const contents = await fetchGitHubContents(owner, repoName, '', authToken)
  // Works perfectly! ✅
}
```

## 🔧 Debugging Workflow

### 1. Check AuthContext First
```
Open DevTools Console → Look for 🔐 logs
```

✅ **Healthy Login**:
```
🔐 [AuthContext] Initializing...
🔐 [AuthContext] Stored token found: true
🔐 [AuthContext] User loaded from localStorage: { hasGitHubToken: true }
🔐 [AuthContext] ✅ User data fetched successfully
```

❌ **Problem**:
```
🔐 [AuthContext] Stored token found: false
// → User needs to login

🔐 [AuthContext] hasGitHubToken: false
// → User needs to connect GitHub
```

### 2. Then Check GitHubContext
```
Look for 🐙 logs
```

✅ **Healthy State**:
```
🐙 [GitHubContext] State updated: {
  hasAuthToken: true,
  hasUser: true,
  hasGitHubToken: true,
  githubTokenLength: 40
}
```

❌ **Problem**:
```
🐙 [GitHubContext] ⚠️ Cannot fetch repos - missing tokens: {
  hasAuthToken: false,  // ← Problem here!
  hasGitHubToken: true
}
```

### 3. Check API Calls
```
Look for API response status codes
```

✅ **Working**:
```
🐙 [GitHubContext] API response status: 200
```

❌ **Error**:
```
🐙 [GitHubContext] API response status: 401
🐙 [GitHubContext] ❌ Failed to fetch repos
```

## 📊 Complete Flow Example

Here's what you should see in console for a successful session:

```
# Page Load
🔐 [AuthContext] Initializing...
🔐 [AuthContext] Stored token found: true
🔐 [AuthContext] Token loaded from localStorage
🔐 [AuthContext] User loaded from localStorage: { hasGitHubToken: true }
🔐 [AuthContext] Fetching fresh user data...
🐙 [GitHubContext] State updated: { hasAuthToken: true, hasUser: true, hasGitHubToken: true }
🔐 [AuthContext] API response status: 200
🔐 [AuthContext] ✅ User data fetched successfully
🔐 [AuthContext] Loading complete

# User clicks "Load Repos"
🐙 [GitHubContext] fetchRepos called
🐙 [GitHubContext] Auth token available: true
🐙 [GitHubContext] GitHub token available: true
🐙 [GitHubContext] Fetching repos from API...
🐙 [GitHubContext] API response status: 200
🐙 [GitHubContext] ✅ Repos fetched successfully: 12 repositories
🐙 [GitHubContext] State updated: { reposCount: 12 }

# User selects a repo (serverless backend)
Using GitHub API fallback (serverless environment)  ← From Sidebar.tsx, this is NORMAL!
🐙 [GitHubContext] fetchRepoContents called: { owner: "user", repo: "repo" }
🐙 [GitHubContext] API response status: 200
🐙 [GitHubContext] ✅ Contents fetched: 15 items

# User opens a file
🐙 [GitHubContext] fetchFileContent called: { path: "README.md" }
🐙 [GitHubContext] API response status: 200
🐙 [GitHubContext] ✅ File content decoded: 1234 characters
```

## 🎯 Quick Reference

### Emoji Legend
- 🔐 = AuthContext logs
- 🐙 = GitHubContext logs
- ✅ = Success
- ❌ = Error
- ⚠️ = Warning
- ℹ️ = Information

### Key States to Check

| State | How to Check | What It Should Be |
|-------|--------------|-------------------|
| Authenticated | `🔐 hasGitHubToken: true` | `true` |
| GitHub Connected | `🔐 githubTokenLength: 40` | > 0 |
| Repos Loaded | `🐙 reposCount: 12` | > 0 |
| API Working | `API response status: 200` | 200 |

## 🛠️ Troubleshooting

### Issue: No logs appearing
**Fix**: Check that you're in development mode and DevTools console is open

### Issue: "Cannot fetch repos - missing tokens"
**Fix**: 
1. Check AuthContext - is user logged in?
2. Check if GitHub token exists in user object
3. User may need to reconnect GitHub OAuth

### Issue: API response status: 401
**Fix**: Token expired or invalid - user needs to re-login

### Issue: API response status: 403 (GitHub API)
**Fix**: GitHub API rate limit reached - wait or authenticate

### Issue: "Using GitHub API fallback"
**Fix**: This is NOT an issue! This is normal for serverless deployments.

## 📝 Disable Logging (Production)

To disable logs in production, wrap console statements:

```typescript
const DEBUG = process.env.NODE_ENV === 'development'

if (DEBUG) {
  console.log('🔐 [AuthContext] ...')
}
```

Or use a logging utility that respects `NODE_ENV`.

