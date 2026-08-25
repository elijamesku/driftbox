// Preload script - runs in renderer process with limited Node access
const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// limited Node.js functionality
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isDesktop: true, // Flag to detect desktop mode
  
  // File operations
  readFile: (owner, repo, filePath) => 
    ipcRenderer.invoke('readFile', owner, repo, filePath),
  
  writeFile: (owner, repo, filePath, content) => 
    ipcRenderer.invoke('writeFile', owner, repo, filePath, content),
  
  getFileTree: (owner, repo, dirPath) => 
    ipcRenderer.invoke('getFileTree', owner, repo, dirPath),
  
  getFileFromGitHead: (owner, repo, filePath) =>
    ipcRenderer.invoke('getFileFromGitHead', owner, repo, filePath),
  
  moveFile: (owner, repo, sourcePath, targetPath) => 
    ipcRenderer.invoke('moveFile', owner, repo, sourcePath, targetPath),
  
  deleteFile: (owner, repo, path) => 
    ipcRenderer.invoke('deleteFile', owner, repo, path),
  
  createFile: (owner, repo, path, content, isFolder) => 
    ipcRenderer.invoke('createFile', owner, repo, path, content, isFolder),
  
  // Repository operations
  cloneRepo: (owner, repo, token) => 
    ipcRenderer.invoke('cloneRepo', owner, repo, token),
  
  getRepoPath: (owner, repo) => 
    ipcRenderer.invoke('getRepoPath', owner, repo),
  
  // Git operations
  gitCommit: (owner, repo, message) => 
    ipcRenderer.invoke('gitCommit', owner, repo, message),
  
  gitPush: (owner, repo, branch, token) => 
    ipcRenderer.invoke('gitPush', owner, repo, branch, token),
  
  gitPull: (owner, repo, branch, token) =>
    ipcRenderer.invoke('gitPull', owner, repo, branch, token),
  
  createBranch: (owner, repo, branchName) => 
    ipcRenderer.invoke('createBranch', owner, repo, branchName),
  
  terraformFmt: (owner, repo) =>
    ipcRenderer.invoke('terraformFmt', owner, repo),
  
  terraformValidate: (owner, repo) =>
    ipcRenderer.invoke('terraformValidate', owner, repo),
  
  terraformInitBackground: (owner, repo) =>
    ipcRenderer.invoke('terraformInitBackground', owner, repo),
  
  autoHeal: (token, workspacePath, diagnostics, repoOwner, repoName, files) =>
    ipcRenderer.invoke('autoHeal', token, workspacePath, diagnostics, repoOwner, repoName, files),
  
  getGitStatus: (owner, repo) => 
    ipcRenderer.invoke('getGitStatus', owner, repo),
  
  gitReset: (repoFullName) => 
    ipcRenderer.invoke('gitReset', repoFullName),
  
  // Auto-sync: background polling for GitHub changes
  startAutoSync: (owner, repo, isTeamWorkspace = false) =>
    ipcRenderer.invoke('startAutoSync', owner, repo, isTeamWorkspace),
  
  stopAutoSync: () =>
    ipcRenderer.invoke('stopAutoSync'),
  
  onRepoSynced: (callback) => {
    ipcRenderer.on('repo-synced', (event, data) => callback(data))
  },
  
  onRepoBehind: (callback) => {
    ipcRenderer.on('repo-behind', (event, data) => callback(data))
  },
  
  // Terminal operations
  executeCommand: (command, cwd) => 
    ipcRenderer.invoke('executeCommand', command, cwd),
  
  getHomeDir: () => 
    ipcRenderer.invoke('getHomeDir'),
  
  // GitHub token management for git authentication
  setGitHubToken: (token) => 
    ipcRenderer.invoke('setGitHubToken', token),
  
  getGitHubToken: () => 
    ipcRenderer.invoke('getGitHubToken'),
  
  // Open external URL (for OAuth)
  openExternal: (url) => 
    ipcRenderer.invoke('openExternal', url),
  
  // Listen for OAuth callback
  onOAuthCallback: (callback) => {
    ipcRenderer.on('oauth-callback', (event, data) => callback(data))
  },
  
  // Listen for deep link navigation (team invites, etc)
  onNavigate: (callback) => {
    ipcRenderer.on('navigate-to', (event, path) => callback(path))
  }
})

