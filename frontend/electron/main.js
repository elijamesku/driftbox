const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { spawn, exec } = require('child_process')
const path = require('path')
const fs = require('fs').promises
const { promisify } = require('util')
const execAsync = promisify(exec)
const http = require('http')
const fsSync = require('fs')

console.log('[Electron Main] Starting main process...')

// Register custom protocol for OAuth callback
// Force registration for dev mode
console.log('[Protocol] Registering driftbox:// protocol handler...')
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('driftbox', process.execPath, [path.resolve(process.argv[1])])
    console.log('[Protocol] Registered with defaultApp mode')
  }
} else {
  app.setAsDefaultProtocolClient('driftbox')
  console.log('[Protocol] Registered without defaultApp mode')
}

// Also try to register using the current executable path for dev mode
try {
  const success = app.setAsDefaultProtocolClient('driftbox')
  console.log('[Protocol] Force registration result:', success)
} catch (err) {
  console.error('[Protocol] Force registration error:', err)
}

let mainWindow
let nextProcess
let staticServer
let isNextReady = false
let storedGitHubToken = null // Store GitHub token for git authentication

// Get dev mode after app is ready
const getIsDev = () => {
  // Check if we're in a packaged app
  // In packaged apps, app.isPackaged is true
  // Also check if we're running from electron executable (not npm/node)
  const isPackaged = app.isPackaged || !process.defaultApp
  return !isPackaged
}

// Start simple HTTP server for static files
function startStaticServer() {
  // In packaged app, out dir is in resources/app/out (relative to main.js)
  // In dev, it's in ../out
  const isDev = getIsDev()
  let outDir
  if (isDev) {
    outDir = path.join(__dirname, '..', 'out')
  } else {
    // In packaged app, main.js is in resources/app/electron/main.js
    // So out should be in resources/app/out
    outDir = path.join(__dirname, '..', 'out')
    // Fallback: try app.getAppPath()/out
    if (!fsSync.existsSync(outDir)) {
      outDir = path.join(app.getAppPath(), 'out')
    }
  }
  console.log('[Static Server] Starting for:', outDir, 'isDev:', isDev)
  
  // Check if out directory exists
  if (!fsSync.existsSync(outDir)) {
    console.error('[Static Server] ERROR: out directory does not exist:', outDir)
    return
  }
  
  staticServer = http.createServer((req, res) => {
    // Parse URL and remove query string
    const parsedUrl = new URL(req.url, 'http://localhost:3000')
    let urlPath = parsedUrl.pathname
    
    // Handle root
    if (urlPath === '/') {
      urlPath = '/index.html'
    }
    
    // If no extension and not a static asset, try .html
    const ext = path.extname(urlPath)
    if (!ext && !urlPath.startsWith('/_next/')) {
      urlPath = urlPath + '.html'
    }
    
    let filePath = path.join(outDir, urlPath)
    
    console.log('[Static Server] Request:', req.url, '->', filePath)
    
    // Get file extension for content type
    const fileExt = path.extname(filePath).toLowerCase()
    const contentTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.wasm': 'application/wasm',
      '.ttf': 'font/ttf',
      '.txt': 'text/plain',
      '.xml': 'application/xml'
    }
    
    const contentType = contentTypes[fileExt] || 'application/octet-stream'
    
    fsSync.readFile(filePath, (err, data) => {
      if (err) {
        console.error('[Static Server] Error loading:', filePath, err.message)
        res.writeHead(404)
        res.end('Not found')
      } else {
        res.writeHead(200, { 'Content-Type': contentType })
        res.end(data)
      }
    })
  })
  
  staticServer.on('error', (err) => {
    console.error('[Static Server] Server error:', err)
  })
  
  staticServer.listen(3000, () => {
    console.log('[Static Server] Running at http://localhost:3000')
    isNextReady = true
    
    // Wait a moment then load the URL
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('[Static Server] Loading app in window')
        mainWindow.loadURL('http://localhost:3000')
      }
    }, 500)
  })
}

// Get URL based on dev mode
const getUrl = () => {
  return 'http://localhost:3000'
}

// Start Next.js dev server
function startNextDevServer() {
  const isDev = getIsDev()
  if (!isDev) return // In production, Next.js is already built
  
  console.log('Starting Next.js dev server...')
  const nextPath = path.join(__dirname, '..')
  // Use npx to ensure next is found in node_modules
  nextProcess = spawn('npx', ['next', 'dev'], {
    cwd: nextPath,
    shell: true,
    env: { 
      ...process.env, 
      PORT: '3000',
      // Don't set VERCEL env var so desktop detection works
    }
  })

  nextProcess.stdout.on('data', (data) => {
    const output = data.toString()
    console.log(`Next.js: ${output}`)
    
    // Check if Next.js is ready (more specific patterns)
    if (output.includes('Ready in') || 
        output.includes('Local:') || 
        output.includes('started server on') ||
        output.includes('compiled successfully') ||
        output.includes(' Ready')) {
      if (!isNextReady) {
        isNextReady = true
        console.log('Next.js is ready!')
        // Wait a bit more for server to fully start
        setTimeout(() => {
          if (mainWindow) {
            const appUrl = getUrl()
            console.log('Loading app at:', appUrl)
            mainWindow.loadURL(appUrl)
          } else {
            createWindow()
          }
        }, 2000)
      }
    }
  })

  nextProcess.stderr.on('data', (data) => {
    console.error(`Next.js error: ${data}`)
  })

  nextProcess.on('close', (code) => {
    console.log(`Next.js process exited with code ${code}`)
    isNextReady = false
  })

  nextProcess.on('error', (error) => {
    console.error(`Next.js process error: ${error}`)
  })
}

// Kill process and all its children (Windows-compatible)
function killProcessTree(childProcess, signal = 'SIGTERM') {
  if (!childProcess) return Promise.resolve()
  
  return new Promise((resolve) => {
    try {
      const platform = require('os').platform()
      // On Windows, we need to kill the entire process tree
      if (platform === 'win32') {
        // Use taskkill to kill the process tree
        const pid = childProcess.pid
        if (pid) {
          const { exec } = require('child_process')
          exec(`taskkill /F /T /PID ${pid}`, (error) => {
            if (error && !error.message.includes('not found')) {
              console.warn('Failed to kill process tree:', error.message)
            }
            resolve()
          })
        } else {
          resolve()
        }
      } else {
        // On Unix-like systems, kill the process group
        childProcess.kill(signal)
        childProcess.once('exit', () => resolve())
        // Timeout after 3 seconds
        setTimeout(() => {
          if (!childProcess.killed) {
            childProcess.kill('SIGKILL')
          }
          resolve()
        }, 3000)
      }
    } catch (error) {
      console.warn('Error killing process:', error.message)
      resolve()
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 589,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '..', 'public', 'logo-svgs', 'driftbox_logo_mark_dark_v1.svg'),
    titleBarStyle: 'default',
    backgroundColor: '#141414'
  })

  const isDev = getIsDev()
  const url = getUrl()
  
  // Wait for Next.js to be ready (both dev and prod)
  if (!isNextReady) {
    console.log('⏳ Waiting for Next.js to start...')
    const loadingMessage = isDev ? 'Loading Next.js dev server...' : 'Loading Driftbox...'
    mainWindow.loadURL(`data:text/html,<html><head><meta charset="utf-8"><title>Loading...</title></head><body style="background:#141414;color:#fff;display:flex;align-items:center;justify-content:center;font-family:monospace;flex-direction:column;gap:20px"><h1>${loadingMessage}</h1><p>Please wait, this may take 10-30 seconds...</p></body></html>`)
    
    // Poll for Next.js to be ready
    const checkReady = setInterval(() => {
      const http = require('http')
      const req = http.get('http://localhost:3000', (res) => {
        clearInterval(checkReady)
        isNextReady = true
        console.log('Next.js is ready, loading app...')
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(url)
        }
      })
      req.on('error', () => {
        // Still loading, keep waiting
      })
      req.end()
    }, 2000) // Check every 2 seconds
    
    // Give up after 60 seconds
    setTimeout(() => {
      clearInterval(checkReady)
      if (!isNextReady && mainWindow && !mainWindow.isDestroyed()) {
        console.error('Next.js failed to start after 60 seconds')
        mainWindow.loadURL('data:text/html,<html><head><meta charset="utf-8"><title>Error</title></head><body style="background:#141414;color:#f00;display:flex;align-items:center;justify-content:center;font-family:monospace;flex-direction:column;gap:20px;padding:40px"><h1>Next.js Failed to Start</h1><p>The server could not start.</p><p>Try running the app from terminal to see errors.</p></body></html>')
      }
    }, 60000)
  } else {
    mainWindow.loadURL(url)
  }

  // Open DevTools (always open for debugging)
  mainWindow.webContents.openDevTools()

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Handle OAuth callback URLs (driftbox://...)
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window and handle the protocol
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      
      // Handle the protocol URL (OAuth callback)
      const url = commandLine.find(arg => arg.startsWith('driftbox://'))
      if (url) {
        handleOAuthCallback(url)
      }
    }
  })

  // Handle protocol on macOS
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleOAuthCallback(url)
  })
}

// Handle custom protocol URLs (OAuth and team invites)
async function handleOAuthCallback(url) {
  console.log('[Protocol] Received URL:', url)
  
  const urlObj = new URL(url)
  
  // Handle team invitations: driftbox://invite/{token}
  if (urlObj.pathname.startsWith('/invite/')) {
    const token = urlObj.pathname.replace('/invite/', '')
    console.log('[Invite] Received team invitation:', token)
    
    if (mainWindow) {
      // Navigate to the invite page in the app
      mainWindow.webContents.send('navigate-to', `/teams/invite/${token}`)
      mainWindow.focus()
    }
    return
  }
  
  // Handle OAuth callback: driftbox://auth/callback?code=...
  const code = urlObj.searchParams.get('code')
  const state = urlObj.searchParams.get('state')
  
  if (code && mainWindow) {
    console.log('[OAuth] Code received:', code)
    
    try {
      // Call backend to exchange code for token (backend returns redirect response)
      // Use same default as frontend (apiEndpoint.ts) - production backend
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://129.212.181.126'
      const backendUrl = `${apiUrl}/auth/github/callback?code=${code}${state ? `&state=${state}` : ''}`
      
      console.log('[OAuth] Calling backend:', backendUrl)
      
      // Use fetch with redirect: 'manual' to intercept the redirect
      const response = await fetch(backendUrl, { 
        redirect: 'manual',
        headers: {
          'Referer': 'http://localhost:3000'  // Tell backend we're from localhost
        }
      })
      
      console.log('[OAuth] Backend response status:', response.status)
      
      // Backend returns 302 redirect to /auth/callback?token=...
      if (response.status === 302 || response.status === 301 || response.status === 307) {
        const redirectUrl = response.headers.get('location')
        console.log('[OAuth] Redirect URL:', redirectUrl)
        
        if (redirectUrl) {
          // Extract token from redirect URL
          const redirectUrlObj = new URL(redirectUrl, 'http://localhost:3000')
          const token = redirectUrlObj.searchParams.get('token')
          
          if (token) {
            console.log('[OAuth] Token extracted from redirect!')
            
            // Wait for Next.js to be ready before redirecting
            if (!isNextReady) {
              console.log('⏳ [OAuth] Waiting for Next.js to be ready...')
              // Wait up to 30 seconds for Next.js
              let attempts = 0
              while (!isNextReady && attempts < 60) {
                await new Promise(resolve => setTimeout(resolve, 500))
                attempts++
              }
              if (!isNextReady) {
                console.error('[OAuth] Next.js did not become ready in time')
                mainWindow.loadURL(`http://localhost:3000/auth/callback?error=nextjs_not_ready`)
                return
              }
            }
            
            // Load callback page with token
            console.log('[OAuth] Loading callback page with token')
            mainWindow.loadURL(`http://localhost:3000/auth/callback?token=${token}`)
          } else {
            console.error('[OAuth] No token in redirect URL')
            mainWindow.loadURL(`http://localhost:3000/auth/callback?error=no_token_in_redirect`)
          }
        } else {
          console.error('[OAuth] No location header in redirect')
          mainWindow.loadURL(`http://localhost:3000/auth/callback?error=no_redirect_location`)
        }
      } else {
        console.error('[OAuth] Unexpected response status:', response.status)
        mainWindow.loadURL(`http://localhost:3000/auth/callback?error=unexpected_status_${response.status}`)
      }
    } catch (error) {
      console.error('[OAuth] Error:', error)
      mainWindow.loadURL(`http://localhost:3000/auth/callback?error=${encodeURIComponent(error.message)}`)
    }
  }
}

// Poll for OAuth token file (dev mode workaround)
function startOAuthTokenPolling() {
  const os = require('os')
  const tempFile = require('path').join(os.tmpdir(), 'driftbox-oauth-token.txt')
  
  console.log('[OAuth Polling] Starting to poll for token file:', tempFile)
  
  setInterval(async () => {
    try {
      // Check if file exists
      const fileExists = fsSync.existsSync(tempFile)
      
      if (fileExists && mainWindow) {
        console.log('[OAuth Polling] Token file found!')
        
        // Read the token
        const token = fsSync.readFileSync(tempFile, 'utf-8').trim()
        
        // Delete the file
        fsSync.unlinkSync(tempFile)
        
        console.log('[OAuth Polling] Token received, redirecting to IDE...')
        
        // Load the IDE with the token
        mainWindow.loadURL(`http://localhost:3000/auth/callback?token=${token}`)
      }
    } catch (error) {
      // Ignore errors (file might not exist yet)
    }
  }, 1000) // Check every second
}

// Register all IPC handlers before app is ready
// This ensures handlers are available as soon as the app starts

app.whenReady().then(() => {
  const isDev = getIsDev()
  console.log('[App Ready] isDev:', isDev)
  
  if (isDev) {
    // Development mode - start Next.js dev server
    console.log('[App Ready] Starting in DEV mode')
    startNextDevServer()
  } else {
    // Production mode - start static file server
    console.log('[App Ready] Starting in PRODUCTION mode')
    startStaticServer()
  }
  
  // Create window immediately, it will reload when server is ready
  createWindow()
})

// Graceful shutdown handler
async function gracefulShutdown() {
  console.log('[Electron Main] Starting graceful shutdown...')
  
  if (staticServer) {
    console.log('[Electron Main] Stopping static server...')
    staticServer.close()
    staticServer = null
  }
  
  if (nextProcess) {
    console.log('[Electron Main] Killing Next.js server...')
    await killProcessTree(nextProcess)
    nextProcess = null
  }
  
  // Also try to kill any process using port 3000 (fallback)
  if (process.platform === 'win32') {
    try {
      const { exec } = require('child_process')
      exec('netstat -ano | findstr :3000', (error, stdout) => {
        if (!error && stdout) {
          const lines = stdout.trim().split('\n')
          const pids = new Set()
          lines.forEach(line => {
            const match = line.match(/\s+(\d+)\s*$/)
            if (match) {
              const pid = match[1]
              if (pid && pid !== '0') {
                pids.add(pid)
              }
            }
          })
          pids.forEach(pid => {
            exec(`taskkill /F /PID ${pid}`, (err) => {
              if (err && !err.message.includes('not found')) {
                console.warn(`Failed to kill process ${pid}:`, err.message)
              }
            })
          })
        }
      })
    } catch (e) {
      // Ignore errors
    }
  }
  
  console.log('[Electron Main] Shutdown complete')
}

app.on('window-all-closed', async () => {
  await gracefulShutdown()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', async (event) => {
  // Prevent default quit, do graceful shutdown first
  event.preventDefault()
  await gracefulShutdown()
  app.exit(0)
})

// Handle process signals
process.on('SIGINT', async () => {
  console.log('[Electron Main] Received SIGINT, shutting down...')
  await gracefulShutdown()
  app.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('[Electron Main] Received SIGTERM, shutting down...')
  await gracefulShutdown()
  app.exit(0)
})

// Get repos directory (same as backend)
function getReposDir() {
  const os = require('os')
  const reposDir = path.join(os.homedir(), '.driftbox', 'repos')
  // Ensure directory exists
  const fs = require('fs')
  if (!fs.existsSync(reposDir)) {
    fs.mkdirSync(reposDir, { recursive: true })
  }
  return reposDir
}

// ======= IPC Handlers for File & Git Operations =======

// Read file from local repo (synchronous for speed - main process can block)
ipcMain.handle('readFile', async (event, owner, repo, filePath) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    const fullPath = path.join(repoPath, filePath)
    
    // Use synchronous fs for instant reads (main process blocking is fine)
    const fsSync = require('fs')
    if (!fsSync.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${filePath}` }
    }
    
    // Synchronous read is MUCH faster than async for small-medium files
    const content = fsSync.readFileSync(fullPath, 'utf-8')
    return { success: true, content }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Get file content from git HEAD (what's committed, not working directory)
// Used for accurate diff calculation when staging
ipcMain.handle('getFileFromGitHead', async (event, owner, repo, filePath) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    
    // Use git show to get the file content from HEAD
    const { stdout } = await execAsync(`git show HEAD:"${filePath}"`, { 
      cwd: repoPath, 
      shell: true,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large files
    })
    
    return { success: true, content: stdout }
  } catch (error) {
    // File doesn't exist in HEAD (new file) or other git error
    return { success: false, error: error.message }
  }
})

// Write file to local repo (handles both create and edit)
ipcMain.handle('writeFile', async (event, owner, repo, filePath, content) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    const fullPath = path.join(repoPath, filePath)
    
    // Ensure parent directory exists
    const parentDir = path.dirname(fullPath)
    await fs.mkdir(parentDir, { recursive: true })
    
    // Write file
    await fs.writeFile(fullPath, content, 'utf-8')
    
    // Stage with git
    const gitFilePath = filePath.replace(/\\/g, '/')
    await execAsync(`git add "${gitFilePath}"`, { cwd: repoPath, shell: true })
    
    return { success: true, path: fullPath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Get file tree for repo
ipcMain.handle('getFileTree', async (event, owner, repo, dirPath = '') => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    const targetPath = path.join(repoPath, dirPath)
    
    if (!require('fs').existsSync(targetPath)) {
      return { success: false, error: 'Path not found' }
    }
    
    const entries = await fs.readdir(targetPath, { withFileTypes: true })
    const items = []
    
    for (const entry of entries) {
      // Skip .git and node_modules
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      
      const relativePath = path.join(dirPath, entry.name)
      items.push({
        name: entry.name,
        path: relativePath.replace(/\\/g, '/'),
        type: entry.isDirectory() ? 'folder' : 'file'
      })
    }
    
    return { success: true, items }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Clone repository
ipcMain.handle('cloneRepo', async (event, owner, repo, token) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    const fsSync = require('fs')
    
    // Check if already cloned
    if (fsSync.existsSync(repoPath) && fsSync.existsSync(path.join(repoPath, '.git'))) {
      // Repo exists, try to pull latest changes
      try {
        await execAsync('git pull', {
          cwd: repoPath,
          shell: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        })
        return { success: true, path: repoPath, message: 'Repository updated successfully' }
      } catch (pullError) {
        // Pull failed, but repo exists - still usable
        console.warn('Pull failed, using existing repo:', pullError.message)
        return { success: true, path: repoPath, message: `Using existing repo (pull failed: ${pullError.message})` }
      }
    }
    
    // Clone with token
    const cloneUrl = `https://${token}@github.com/${owner}/${repo}.git`
    const parentDir = path.dirname(repoPath)
    await fs.mkdir(parentDir, { recursive: true })
    
    await execAsync(`git clone "${cloneUrl}" "${repo}"`, {
      cwd: parentDir,
      shell: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    
    // After cloning, fetch all branches and checkout default branch
    try {
      // Fetch all branches
      await execAsync('git fetch --all', {
        cwd: repoPath,
        shell: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      })
      
      // Try to checkout main, fallback to master
      try {
        await execAsync('git checkout main', {
          cwd: repoPath,
          shell: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        })
      } catch {
        // Try master if main doesn't exist
        await execAsync('git checkout master', {
          cwd: repoPath,
          shell: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        })
      }
    } catch (fetchError) {
      console.warn('Failed to fetch/checkout after clone:', fetchError.message)
      // Continue anyway - repo is cloned
    }
    
    return { success: true, path: repoPath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Get repo path (for passing to backend)
ipcMain.handle('getRepoPath', async (event, owner, repo) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    
    if (!require('fs').existsSync(repoPath)) {
      return { success: false, error: 'Repository not cloned' }
    }
    
    return { success: true, path: repoPath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Git commit
ipcMain.handle('gitCommit', async (event, owner, repo, message) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    
    // Stage all changes
    await execAsync('git add .', { cwd: repoPath, shell: true })
    
    // IMPORTANT: Unstage .terraform folder - it should NEVER be committed (local cache)
    try {
      await execAsync('git reset HEAD .terraform', { cwd: repoPath, shell: true })
      console.log('[gitCommit] Excluded .terraform from commit')
    } catch (e) {
      // .terraform might not be staged, that's fine
    }
    
    // Commit
    await execAsync(`git commit -m "${message}"`, { cwd: repoPath, shell: true })
    
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Git push
ipcMain.handle('gitPush', async (event, owner, repo, branch = 'main', token = null) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    
    console.log(`[Electron gitPush] owner: ${owner}, repo: ${repo}, branch: ${branch}, hasToken: ${!!token}`)
    
    // If token provided, use authenticated HTTPS URL
    if (token) {
      console.log(`[Electron gitPush] Using authenticated URL with token`)
      const authenticatedUrl = `https://${token}@github.com/${owner}/${repo}.git`
      await execAsync(`git push ${authenticatedUrl} ${branch}`, { 
        cwd: repoPath, 
        shell: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      })
      console.log(`[Electron gitPush] Push completed successfully`)
    } else {
      // Fallback to origin (requires git credentials to be configured)
      console.log(`[Electron gitPush] No token - using origin (will likely hang)`)
      await execAsync(`git push origin ${branch}`, { 
        cwd: repoPath, 
        shell: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      })
    }
    
    return { success: true }
  } catch (error) {
    console.error(`[Electron gitPush] Error:`, error.message)
    return { success: false, error: error.message }
  }
})

// Git pull - sync local with remote
ipcMain.handle('gitPull', async (event, owner, repo, branch = 'main', token = null) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    
    console.log(`[Electron gitPull] Pulling ${branch} for ${owner}/${repo}, hasToken: ${!!token}`)
    
    // If token provided, use authenticated HTTPS URL
    if (token) {
      const authenticatedUrl = `https://${token}@github.com/${owner}/${repo}.git`
      
      // Ensure origin remote is set up with authenticated URL
      try {
        await execAsync(`git remote get-url origin`, { cwd: repoPath, shell: true })
        // Remote exists, update it to use authenticated URL
        await execAsync(`git remote set-url origin ${authenticatedUrl}`, { 
          cwd: repoPath, 
          shell: true 
        })
      } catch {
        // No origin remote, add it
        await execAsync(`git remote add origin ${authenticatedUrl}`, { 
          cwd: repoPath, 
          shell: true 
        })
      }
      
      // Fetch all branches from origin
      let fetchSuccess = false
      try {
        await execAsync(`git fetch origin`, { 
          cwd: repoPath, 
          shell: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        })
        fetchSuccess = true
        console.log(`[gitPull] Fetch completed`)
      } catch (fetchError) {
        console.warn(`[gitPull] Fetch failed:`, fetchError.message)
        // Continue anyway - might be network issue or empty repo
      }
      
      // Check if branch exists locally, if not checkout from origin
      try {
        await execAsync(`git rev-parse --verify ${branch}`, { 
          cwd: repoPath, 
          shell: true 
        })
        // Branch exists locally, just checkout
        await execAsync(`git checkout ${branch}`, { 
          cwd: repoPath, 
          shell: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        })
      } catch {
        // Branch doesn't exist locally - try to checkout from origin
        try {
          await execAsync(`git checkout -b ${branch} origin/${branch}`, { 
            cwd: repoPath, 
            shell: true,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
          })
        } catch (checkoutError) {
          // Branch doesn't exist on remote either - repo might be empty
          console.warn(`[gitPull] Branch ${branch} doesn't exist on remote - repo might be empty`)
          // Return success anyway - nothing to pull
          return { success: true, message: 'Repository is empty or branch does not exist' }
        }
      }
      
      // Always try to reset to origin if fetch succeeded - this is the most reliable way
      // to sync with remote, even if git pull would fail due to divergent histories
      if (fetchSuccess) {
        try {
          // Check if origin/branch exists
          await execAsync(`git rev-parse origin/${branch}`, { 
            cwd: repoPath, 
            shell: true 
          })
          // Reset working directory to match origin/branch
          await execAsync(`git reset --hard origin/${branch}`, { 
            cwd: repoPath, 
            shell: true 
          })
          console.log(`[gitPull] Reset working directory to match origin/${branch}`)
        } catch (resetError) {
          // origin/branch might not exist (empty repo) - try git pull as fallback
          console.warn(`[gitPull] Could not reset to origin/${branch}:`, resetError.message)
          
          // Fallback to git pull
          try {
            await execAsync(`git pull origin ${branch}`, { 
              cwd: repoPath, 
              shell: true,
              env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
            })
            console.log(`[gitPull] Pull completed (fallback)`)
          } catch (pullError) {
            const errorMsg = pullError.message || ''
            if (errorMsg.includes('local changes') || errorMsg.includes('would be overwritten')) {
              throw pullError // Re-throw conflict errors so caller can handle them
            }
            console.warn(`[gitPull] Pull also failed:`, errorMsg)
          }
        }
      } else {
        // Fetch failed, try git pull anyway as last resort
        console.log(`[gitPull] Fetch failed, trying pull as fallback...`)
        try {
          await execAsync(`git pull origin ${branch}`, { 
            cwd: repoPath, 
            shell: true,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
          })
          console.log(`[gitPull] Pull completed`)
        } catch (pullError) {
          const errorMsg = pullError.message || ''
          if (errorMsg.includes('local changes') || errorMsg.includes('would be overwritten')) {
            throw pullError
          }
          console.warn(`[gitPull] Pull failed:`, errorMsg)
          return { success: false, error: `Sync failed: ${errorMsg}` }
        }
      }
    } else {
      // Fallback to origin (requires git credentials to be configured)
      console.log(`[Electron gitPull] No token - using origin (may fail for private repos)`)
      
      let fetchSuccess = false
      try {
        await execAsync(`git fetch origin`, { 
          cwd: repoPath, 
          shell: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        })
        fetchSuccess = true
        console.log(`[gitPull] Fetch completed (no token)`)
      } catch (fetchError) {
        console.warn(`[gitPull] Fetch failed (no token):`, fetchError.message)
      }
      
      // Check if branch exists locally, if not try to checkout from remote
      try {
        await execAsync(`git rev-parse --verify ${branch}`, { 
          cwd: repoPath, 
          shell: true 
        })
        // Branch exists locally, just checkout
        await execAsync(`git checkout ${branch}`, { 
          cwd: repoPath, 
          shell: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        })
      } catch {
        // Branch doesn't exist locally - try to checkout from remote
        try {
          await execAsync(`git checkout -b ${branch} origin/${branch}`, { 
            cwd: repoPath, 
            shell: true,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
          })
        } catch {
          // Try just checking out the branch (might be a remote tracking branch)
          await execAsync(`git checkout ${branch}`, { 
            cwd: repoPath, 
            shell: true,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
          })
        }
      }
      
      // Reset to origin if fetch succeeded
      if (fetchSuccess) {
        try {
          await execAsync(`git rev-parse origin/${branch}`, { 
            cwd: repoPath, 
            shell: true 
          })
          await execAsync(`git reset --hard origin/${branch}`, { 
            cwd: repoPath, 
            shell: true 
          })
          console.log(`[gitPull] Reset working directory to match origin/${branch}`)
        } catch (resetError) {
          console.warn(`[gitPull] Could not reset to origin/${branch}:`, resetError.message)
          // Fallback to pull
          await execAsync(`git pull origin ${branch}`, { 
            cwd: repoPath, 
            shell: true,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
          })
        }
      } else {
        // Fetch failed, try pull directly
        await execAsync(`git pull origin ${branch}`, { 
          cwd: repoPath, 
          shell: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        })
      }
    }
    
    console.log(`[Electron gitPull] Pull completed successfully`)
    return { success: true }
  } catch (error) {
    console.error(`[Electron gitPull] Error:`, error.message)
    return { success: false, error: error.message }
  }
})

// Create branch and push
ipcMain.handle('createBranch', async (event, owner, repo, branchName) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    
    // Create and checkout new branch
    await execAsync(`git checkout -b ${branchName}`, { cwd: repoPath, shell: true })
    
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Terraform fmt
ipcMain.handle('terraformFmt', async (event, owner, repo) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    
    console.log(`[Electron terraformFmt] Running terraform fmt in: ${repoPath}`)
    const result = await execAsync('terraform fmt', { cwd: repoPath, shell: true })
    console.log(`[Electron terraformFmt] Success:`, result.stdout || '(no output)')
    
    return { success: true, output: result.stdout }
  } catch (error) {
    console.error(`[Electron terraformFmt] Error:`, error.message)
    return { success: false, error: error.message }
  }
})

// Background terraform init - called when repo is opened or .tf file created
// Downloads providers silently so they're ready when PR is created
ipcMain.handle('terraformInitBackground', async (event, owner, repo) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    const fs = require('fs')
    const os = require('os')
    
    // Check if any .tf files exist
    const files = fs.readdirSync(repoPath)
    const hasTfFiles = files.some(f => f.endsWith('.tf'))
    
    if (!hasTfFiles) {
      console.log(`[Electron terraformInitBackground] No .tf files in ${repo}, skipping`)
      return { success: true, skipped: true, reason: 'no_tf_files' }
    }
    
    // Check if providers already exist
    const providersPath = path.join(repoPath, '.terraform', 'providers')
    if (fs.existsSync(providersPath) && fs.readdirSync(providersPath).length > 0) {
      console.log(`[Electron terraformInitBackground] Providers already exist for ${repo}`)
      return { success: true, skipped: true, reason: 'providers_exist' }
    }
    
    // Set up plugin cache
    const pluginCacheDir = path.join(os.homedir(), '.driftbox', 'terraform-plugin-cache')
    if (!fs.existsSync(pluginCacheDir)) {
      fs.mkdirSync(pluginCacheDir, { recursive: true })
    }
    
    console.log(`[Electron terraformInitBackground] Starting background provider download for ${repo}...`)
    
    // Run init in background (don't await - fire and forget)
    execAsync('terraform init -upgrade=false -input=false 2>&1', { 
      cwd: repoPath, 
      shell: true,
      timeout: 600000, // 10 minutes for background
      env: {
        ...process.env,
        TF_PLUGIN_CACHE_DIR: pluginCacheDir
      }
    }).then(result => {
      console.log(`[Electron terraformInitBackground] Background init complete for ${repo}`)
    }).catch(error => {
      console.log(`[Electron terraformInitBackground] Background init failed for ${repo}:`, error.message)
    })
    
    return { success: true, started: true }
  } catch (error) {
    console.error(`[Electron terraformInitBackground] Error:`, error.message)
    return { success: false, error: error.message }
  }
})

// Terraform validate (runs init if providers don't exist)
ipcMain.handle('terraformValidate', async (event, owner, repo) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    
    const fs = require('fs')
    const providersDir = path.join(repoPath, '.terraform', 'providers')
    
    // Check if providers ACTUALLY exist (not just .terraform folder)
    const hasProviders = fs.existsSync(providersDir) && 
                         fs.readdirSync(providersDir).length > 0
    
    if (!hasProviders) {
      console.log(`[Electron terraformValidate] ⏳ No providers found, running init...`)
      // Use global plugin cache if it exists
      const os = require('os')
      const pluginCacheDir = path.join(os.homedir(), '.driftbox', 'terraform-plugin-cache')
      
      // Create cache dir if needed
      if (!fs.existsSync(pluginCacheDir)) {
        fs.mkdirSync(pluginCacheDir, { recursive: true })
        console.log(`[Electron terraformValidate] Created plugin cache at: ${pluginCacheDir}`)
      }
      
      const env = { ...process.env, TF_PLUGIN_CACHE_DIR: pluginCacheDir }
      const startTime = Date.now()
      
      try {
        await execAsync('terraform init -upgrade=false -input=false', { 
          cwd: repoPath, 
          shell: true,
          env,
          timeout: 15000 // 15 second max
        })
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`[Electron terraformValidate] Init complete in ${duration}s`)
      } catch (initError) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`[Electron terraformValidate] Init failed/timed out after ${duration}s:`, initError.message)
        // Continue to validate anyway - it will fail and trigger auto-heal
      }
    } else {
      console.log(`[Electron terraformValidate] Providers exist, skipping init`)
    }
    
    console.log(`[Electron terraformValidate] Running terraform validate...`)
    const startTime = Date.now()
    // 30 second timeout for validate
    const result = await execAsync('terraform validate -json', { 
      cwd: repoPath, 
      shell: true,
      timeout: 30000 // 30 seconds
    })
    const duration = Date.now() - startTime
    console.log(`[Electron terraformValidate] Completed in ${duration}ms`)
    const validation = JSON.parse(result.stdout)
    
    console.log(`[Electron terraformValidate] Valid:`, validation.valid)
    
    return { 
      success: true, 
      valid: validation.valid,
      diagnostics: validation.diagnostics || []
    }
  } catch (error) {
    console.error(`[Electron terraformValidate] Error:`, error.message)
    console.error(`[Electron terraformValidate] stdout:`, error.stdout)
    console.error(`[Electron terraformValidate] stderr:`, error.stderr)
    
    // Try to parse error output as JSON
    try {
      if (error.stdout) {
        const validation = JSON.parse(error.stdout)
        console.log(`[Electron terraformValidate] Parsed validation errors:`, validation.diagnostics?.length || 0, 'issues')
        return {
          success: true,
          valid: false,
          diagnostics: validation.diagnostics || []
        }
      }
    } catch (parseError) {
      // If can't parse, return error
    }
    
    return { success: false, error: error.message }
  }
})

// Auto-heal Terraform validation errors via backend API
ipcMain.handle('autoHeal', async (event, token, workspacePath, diagnostics, repoOwner, repoName, files) => {
  try {
    // Use same default as frontend (apiEndpoint.ts) - production backend
    // Note: Backend routes are mounted directly without /api/v1 prefix
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://129.212.181.126'
    const backendUrl = `${apiUrl}/git/auto-heal`
    
    console.log(`[Electron autoHeal] Calling backend: ${backendUrl}`)
    console.log(`[Electron autoHeal] Workspace: ${workspacePath}`)
    console.log(`[Electron autoHeal] Diagnostics: ${diagnostics.length} errors`)
    console.log(`[Electron autoHeal] Files: ${Object.keys(files).length} .tf files`)
    
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        workspace_path: workspacePath,
        diagnostics: diagnostics,
        repo_owner: repoOwner,
        repo_name: repoName,
        files: files
      })
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Electron autoHeal] Backend error: ${response.status} - ${errorText}`)
      return {
        success: false,
        fixes: [],
        error: `Backend returned ${response.status}: ${errorText}`
      }
    }
    
    const result = await response.json()
    console.log(`[Electron autoHeal] Success: ${result.fixes?.length || 0} fixes generated`)
    return result
  } catch (error) {
    console.error(`[Electron autoHeal] Error:`, error.message)
    return {
      success: false,
      fixes: [],
      error: error.message,
      details: 'Failed to connect to backend server. Make sure the backend is running.'
    }
  }
})

ipcMain.handle('moveFile', async (event, owner, repo, sourcePath, targetPath) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    
    // Check if repo exists
    if (!require('fs').existsSync(repoPath)) {
      return { success: false, error: `Repository not found: ${owner}/${repo}` }
    }
    
    // Check if .git exists
    if (!require('fs').existsSync(path.join(repoPath, '.git'))) {
      return { success: false, error: 'Repository is not a git repository' }
    }
    
    const fullSourcePath = path.join(repoPath, sourcePath)
    const fullTargetPath = path.join(repoPath, targetPath)
    
    // Validate source exists
    if (!require('fs').existsSync(fullSourcePath)) {
      return { success: false, error: `Source path not found: ${sourcePath}` }
    }
    
    // Validate target doesn't exist
    if (require('fs').existsSync(fullTargetPath)) {
      return { success: false, error: `Target path already exists: ${targetPath}` }
    }
    
    // Ensure target parent directory exists
    const targetParent = path.dirname(fullTargetPath)
    await fs.mkdir(targetParent, { recursive: true })
    
    // Check if source is tracked in git
    const isFile = (await fs.stat(fullSourcePath)).isFile()
    let isTracked = false
    
    // Convert paths to forward slashes for git commands
    const gitSourcePath = sourcePath.replace(/\\/g, '/')
    
    if (isFile) {
      // For files, check directly
      try {
        const { stdout } = await execAsync(
          `git ls-files --error-unmatch "${gitSourcePath}"`,
          { cwd: repoPath, shell: true }
        )
        isTracked = true
      } catch {
        isTracked = false
      }
    } else {
      // For folders, check if any files inside are tracked
      try {
        const { stdout } = await execAsync(
          `git ls-files -- "${gitSourcePath}"`,
          { cwd: repoPath, shell: true }
        )
        isTracked = stdout.trim().length > 0
      } catch {
        isTracked = false
      }
    }
    
    if (isTracked) {
      // Use git mv to preserve history (automatically stages the move)
      // Convert paths to forward slashes for git (works on all platforms)
      const gitTargetPath = targetPath.replace(/\\/g, '/')
      console.log(`[moveFile] Using git mv (tracked file): "${gitSourcePath}" -> "${gitTargetPath}"`)
      try {
        await execAsync(
          `git mv "${gitSourcePath}" "${gitTargetPath}"`,
          { cwd: repoPath, shell: true }
        )
        console.log(`[moveFile] Git mv successful - move is staged in git`)
      } catch (error) {
        console.error(`[moveFile] Git mv failed:`, error.message)
        return { success: false, error: `Git mv failed: ${error.message}` }
      }
    } else {
      // File not tracked, use regular move and stage manually
      console.log(`[moveFile] File not tracked, using regular move + git add: "${gitSourcePath}" -> "${targetPath}"`)
      const fsSync = require('fs')
      fsSync.renameSync(fullSourcePath, fullTargetPath)
      
      // Convert path to forward slashes for git
      const gitTargetPath = targetPath.replace(/\\/g, '/')
      try {
        await execAsync(
          `git add "${gitTargetPath}"`,
          { cwd: repoPath, shell: true }
        )
        console.log(`[moveFile] File moved and staged in git`)
      } catch (error) {
        console.error(`[moveFile] Git add failed:`, error.message)
        return { success: false, error: `Git add failed: ${error.message}` }
      }
    }
    
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message || 'Failed to move file' }
  }
})

ipcMain.handle('deleteFile', async (event, owner, repo, filePath) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    
    // Check if repo exists
    if (!require('fs').existsSync(repoPath)) {
      return { success: false, error: `Repository not found: ${owner}/${repo}` }
    }
    
    // Check if .git exists
    if (!require('fs').existsSync(path.join(repoPath, '.git'))) {
      return { success: false, error: 'Repository is not a git repository' }
    }
    
    const fullPath = path.join(repoPath, filePath)
    
    // Validate path exists
    if (!require('fs').existsSync(fullPath)) {
      return { success: false, error: `Path not found: ${filePath}` }
    }
    
    const stats = await fs.stat(fullPath)
    const isFile = stats.isFile()
    
    // Check if path is tracked in git
    let isTracked = false
    
    // Convert path to forward slashes for git commands
    const gitFilePath = filePath.replace(/\\/g, '/')
    
    if (isFile) {
      try {
        await execAsync(
          `git ls-files --error-unmatch "${gitFilePath}"`,
          { cwd: repoPath, shell: true }
        )
        isTracked = true
      } catch {
        isTracked = false
      }
    } else {
      try {
        const { stdout } = await execAsync(
          `git ls-files -- "${gitFilePath}"`,
          { cwd: repoPath, shell: true }
        )
        isTracked = stdout.trim().length > 0
      } catch {
        isTracked = false
      }
    }
    
    if (isTracked) {
      // Use git rm with -f flag to force removal even if files have staged changes
      // Convert path to forward slashes for git
      const gitFilePath = filePath.replace(/\\/g, '/')
      try {
        const command = isFile 
          ? `git rm -f "${gitFilePath}"`
          : `git rm -rf "${gitFilePath}"`
        console.log(`[deleteFile] Using git rm: ${command}`)
        await execAsync(command, { cwd: repoPath, shell: true })
        console.log(`[deleteFile] Git rm successful - deletion is staged`)
      } catch (error) {
        console.error(`[deleteFile] Git rm failed:`, error.message)
        return { success: false, error: `Git rm failed: ${error.message}` }
      }
    } else {
      // Not tracked, just delete from filesystem
      if (isFile) {
        await fs.unlink(fullPath)
      } else {
        await fs.rmdir(fullPath, { recursive: true })
      }
    }
    
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message || 'Failed to delete file' }
  }
})

ipcMain.handle('createFile', async (event, owner, repo, filePath, content, isFolder) => {
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    
    // Check if repo exists
    if (!require('fs').existsSync(repoPath)) {
      return { success: false, error: `Repository not found: ${owner}/${repo}` }
    }
    
    // Check if .git exists
    if (!require('fs').existsSync(path.join(repoPath, '.git'))) {
      return { success: false, error: 'Repository is not a git repository' }
    }
    
    const fullPath = path.join(repoPath, filePath)
    
    // Check if file already exists
    const fileExists = require('fs').existsSync(fullPath)
    
    if (fileExists && !isFolder) {
      // File already exists - REPLACE content (backend handles merge logic)
      console.log(`[createFile] File exists, REPLACING content: ${filePath}`)
      
      // Write new content (replaces existing)
      await fs.writeFile(fullPath, content || '', 'utf-8')
      
      console.log(`[createFile] File replaced with ${(content || '').length} chars`)
      
      // Stage the modified file
      const gitFilePath = filePath.replace(/\\/g, '/')
      try {
        await execAsync(
          `git add "${gitFilePath}"`,
          { cwd: repoPath, shell: true }
        )
        console.log(`[createFile] File updated and staged: ${filePath}`)
      } catch (error) {
        console.error(`[createFile] Git add failed:`, error.message)
        return { success: false, error: `Git add failed: ${error.message}` }
      }
      
      return { success: true, updated: true, message: 'File content replaced' }
    } else if (fileExists && isFolder) {
      // Folder already exists
      return { success: true, existed: true }
    }
    
    // Ensure parent directory exists
    const parentDir = path.dirname(fullPath)
    await fs.mkdir(parentDir, { recursive: true })
    
    if (isFolder) {
      // Create folder
      // Note: Git doesn't track empty folders, so we don't need to stage it
      // The folder will be tracked when files are added to it
      await fs.mkdir(fullPath, { recursive: true })
      console.log(`[createFile] Folder created: ${filePath}`)
    } else {
      // Create file with content
      await fs.writeFile(fullPath, content || '', 'utf-8')
      
      // Stage the new file (git only tracks files, not folders)
      // Convert path to forward slashes for git
      const gitFilePath = filePath.replace(/\\/g, '/')
      try {
        await execAsync(
          `git add "${gitFilePath}"`,
          { cwd: repoPath, shell: true }
        )
        console.log(`[createFile] File created and staged: ${filePath}`)
      } catch (error) {
        console.error(`[createFile] Git add failed:`, error.message)
        return { success: false, error: `Git add failed: ${error.message}` }
      }
    }
    
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message || 'Failed to create file' }
  }
})

// Store current working directory per session (simplified - one global for now)
let terminalCwd = null

// Get home directory
ipcMain.handle('getHomeDir', async () => {
  return require('os').homedir()
})

// Store GitHub token for git authentication
ipcMain.handle('setGitHubToken', async (event, token) => {
  storedGitHubToken = token
  console.log('[setGitHubToken] Token stored:', token ? 'Yes' : 'No')
  return { success: true }
})

// Get stored GitHub token
ipcMain.handle('getGitHubToken', async (event) => {
  return { success: true, token: storedGitHubToken }
})

// Log that GitHub token handlers are registered
console.log('[GitHub Token] IPC handlers registered (setGitHubToken, getGitHubToken)')

// Open external URL (for OAuth)
ipcMain.handle('openExternal', async (event, url) => {
  console.log('[openExternal] Opening URL:', url)
  await shell.openExternal(url)
  return { success: true }
})

console.log('[openExternal] IPC handler registered')

// Execute terminal command locally
ipcMain.handle('executeCommand', async (event, command, cwd) => {
  try {
    // Use provided cwd or stored terminal cwd or default to process.cwd()
    // Don't auto-select a repo - only use one if explicitly provided
    let workingDir = cwd || terminalCwd
    
    if (!workingDir) {
      // Just use the current working directory - don't assume a repo
      workingDir = process.cwd()
    }

    // Handle pwd command (get current directory)
    if (command.trim() === 'pwd') {
      return {
        success: true,
        output: workingDir + '\n',
        exitCode: 0,
        cwd: workingDir
      }
    }
    
    // Handle cd command (Windows - just 'cd' shows current directory)
    if (command.trim() === 'cd' && platform.system() === "Windows") {
      return {
        success: true,
        output: workingDir + '\n',
        exitCode: 0,
        cwd: workingDir
      }
    }
    
    // Handle cd command specially
    if (command.trim().startsWith('cd ')) {
      const targetDir = command.trim().substring(3).trim()
      let newDir = targetDir
      
      if (!targetDir) {
        // cd without args - go to home
        newDir = require('os').homedir()
      } else if (path.isAbsolute(targetDir)) {
        newDir = targetDir
      } else {
        newDir = path.resolve(workingDir, targetDir)
      }
      
      // Check if directory exists
      const fsSync = require('fs')
      if (fsSync.existsSync(newDir) && fsSync.statSync(newDir).isDirectory()) {
        terminalCwd = newDir
        return {
          success: true,
          output: '',
          exitCode: 0,
          cwd: newDir
        }
      } else {
        return {
          success: false,
          error: `cd: ${targetDir}: No such file or directory`,
          output: `cd: ${targetDir}: No such file or directory\n`,
          exitCode: 1,
          cwd: workingDir
        }
      }
    }

    // Handle clear command
    if (command.trim() === 'clear') {
      return {
        success: true,
        output: '',
        exitCode: 0,
        cwd: workingDir
      }
    }

    // Handle git remote commands with authentication
    const isGitRemoteCommand = /^git\s+(push|pull|fetch|clone)/i.test(command)
    let originalRemoteUrl = null
    let needsAuthRestore = false

    console.log('[executeCommand] Git command check:', {
      command: command.trim(),
      isGitRemoteCommand,
      hasToken: !!storedGitHubToken,
      tokenLength: storedGitHubToken?.length || 0
    })

    if (isGitRemoteCommand && storedGitHubToken) {
      try {
        // Check if we're in a git repo (for push/pull/fetch)
        if (!command.trim().startsWith('git clone')) {
          const fsSync = require('fs')
          const gitDir = path.join(workingDir, '.git')
          if (fsSync.existsSync(gitDir)) {
            // Get current remote URL
            try {
              const { stdout: remoteUrl } = await execAsync('git remote get-url origin', { cwd: workingDir, shell: true })
              originalRemoteUrl = remoteUrl.trim()
              
              // Only modify if it's a GitHub URL
              // Always update to use our stored token, even if URL already has credentials
              // This ensures we use the current OAuth token instead of potentially expired credentials
              const isSSH = originalRemoteUrl.startsWith('git@github.com:')
              // Check for HTTPS - handle both with and without credentials (e.g., https://token@github.com/...)
              const isHTTPS = (originalRemoteUrl.startsWith('https://') || originalRemoteUrl.startsWith('http://')) && 
                             originalRemoteUrl.includes('github.com')
              const hasToken = originalRemoteUrl.includes('@github.com') && !isSSH // SSH has @ but not a token
              
              // Always update if it's a GitHub URL (SSH or HTTPS) - use our stored token
              if (originalRemoteUrl && originalRemoteUrl.includes('github.com') && (isSSH || isHTTPS)) {
                // Extract owner/repo from URL - handle both HTTPS and SSH formats
                // HTTPS: https://github.com/owner/repo.git or https://token@github.com/owner/repo.git
                // SSH: git@github.com:owner/repo.git or git@github.com:owner/repo
                let owner, repo
                // Try HTTPS format first (with or without credentials)
                let urlMatch = originalRemoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/)
                
                if (!urlMatch) {
                  // Try SSH format: git@github.com:owner/repo.git
                  urlMatch = originalRemoteUrl.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/)
                }
                
                if (urlMatch) {
                  [, owner, repo] = urlMatch
                  // Always use HTTPS format with token for authentication
                  const authenticatedUrl = `https://${storedGitHubToken}@github.com/${owner}/${repo}.git`
                  
                  // Temporarily set authenticated remote
                  console.log('[executeCommand] Setting authenticated remote:', {
                    original: originalRemoteUrl,
                    authenticated: authenticatedUrl.replace(/https:\/\/[^@]+@/, 'https://***@'), // Hide token in logs
                    owner,
                    repo,
                    originalFormat: isSSH ? 'SSH' : 'HTTPS',
                    needsConversion: isSSH
                  })
                  
                  // Set the authenticated remote URL
                  await execAsync(`git remote set-url origin "${authenticatedUrl}"`, { cwd: workingDir, shell: true })
                  
                  // Clear any cached credentials that might interfere
                  // This ensures git uses the token in the URL instead of cached credentials
                  try {
                    await execAsync('git credential-cache exit', { cwd: workingDir, shell: true })
                  } catch (e) {
                    // Credential cache might not be enabled, that's okay
                  }
                  
                  needsAuthRestore = true
                  console.log('[executeCommand] Set authenticated remote URL for git command')
                } else {
                  console.log('[executeCommand] Could not parse GitHub URL:', originalRemoteUrl)
                }
              } else {
                console.log('[executeCommand] Skipping remote URL update:', {
                  hasUrl: !!originalRemoteUrl,
                  isGitHub: originalRemoteUrl?.includes('github.com'),
                  isSSH,
                  isHTTPS,
                  hasToken,
                  url: originalRemoteUrl ? originalRemoteUrl.replace(/https?:\/\/[^@]+@/, 'https://***@') : null
                })
              }
            } catch (error) {
              // No remote configured or not a git repo - that's okay
              console.log('[executeCommand] No git remote found or not a git repo')
            }
          }
        } else if (command.trim().startsWith('git clone')) {
          // For clone commands, inject token into the URL
          const cloneMatch = command.match(/git\s+clone\s+(https?:\/\/[^\s]+)/i)
          if (cloneMatch) {
            const cloneUrl = cloneMatch[1]
            if (cloneUrl.includes('github.com') && !cloneUrl.includes('@github.com')) {
              // Inject token into clone URL
              const authenticatedUrl = cloneUrl.replace(/https?:\/\//, `https://${storedGitHubToken}@`)
              command = command.replace(cloneUrl, authenticatedUrl)
              console.log('[executeCommand] Injected credentials into clone URL')
            }
          }
        }
      } catch (error) {
        console.warn('[executeCommand] Failed to set up git authentication:', error.message)
      }
    }

    // Execute other commands
    return new Promise(async (resolve) => {
      const childProcess = spawn(command, [], {
        cwd: workingDir,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''

      childProcess.stdout.on('data', (data) => {
        stdout += data.toString('utf8')
      })

      childProcess.stderr.on('data', (data) => {
        stderr += data.toString('utf8')
      })

      childProcess.on('close', async (code) => {
        // Restore original remote URL if we modified it
        if (needsAuthRestore && originalRemoteUrl) {
          try {
            await execAsync(`git remote set-url origin "${originalRemoteUrl}"`, { cwd: workingDir, shell: true })
            console.log('[executeCommand] Restored original remote URL')
          } catch (error) {
            console.warn('[executeCommand] Failed to restore remote URL:', error.message)
          }
        }
        
        // Update cwd if command changed it (for commands like pushd/popd)
        terminalCwd = workingDir
        // Combine stdout and stderr, ensure proper encoding
        const combinedOutput = (stdout || '') + (stderr || '')
        resolve({
          success: code === 0 || code === null, // Success if exit code is 0 or null
          output: combinedOutput,
          exitCode: code || 0,
          cwd: workingDir || process.cwd() // Always return a directory
        })
      })

      childProcess.on('error', async (error) => {
        // Restore original remote URL if we modified it (even on error)
        if (needsAuthRestore && originalRemoteUrl) {
          try {
            await execAsync(`git remote set-url origin "${originalRemoteUrl}"`, { cwd: workingDir, shell: true })
            console.log('[executeCommand] Restored original remote URL after error')
          } catch (restoreError) {
            console.warn('[executeCommand] Failed to restore remote URL:', restoreError.message)
          }
        }
        
        resolve({
          success: false,
          error: error.message,
          output: stdout + stderr,
          cwd: workingDir || process.cwd() // Always return a directory
        })
      })
    })
  } catch (error) {
    return { success: false, error: error.message, cwd: terminalCwd || process.cwd() }
  }
}) 

// Get git status for a repository
ipcMain.handle('getGitStatus', async (event, owner, repo) => {
  console.log('[getGitStatus] Handler called for:', owner, repo)
  try {
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    
    if (!require('fs').existsSync(repoPath)) {
      return { success: false, error: `Repository not found: ${owner}/${repo}` }
    }
    
    if (!require('fs').existsSync(path.join(repoPath, '.git'))) {
      return { success: false, error: 'Repository is not a git repository' }
    }
    
    // Get current branch - handle empty repos or uninitialized branches
    let branch = 'main'
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, shell: true })
      branch = stdout.trim() || 'main'
    } catch (error) {
      // No HEAD - try to checkout default branch
      console.warn('Failed to get branch name:', error.message)
      try {
        // Try to checkout main
        await execAsync('git checkout main', { cwd: repoPath, shell: true })
        const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, shell: true })
        branch = stdout.trim() || 'main'
      } catch {
        // Try master if main doesn't exist
        try {
          await execAsync('git checkout master', { cwd: repoPath, shell: true })
          const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, shell: true })
          branch = stdout.trim() || 'main'
        } catch {
          // Repo is empty or has no commits - use default
          branch = 'main'
        }
      }
    }
    
    // Get git status --porcelain (shows staged, modified, untracked files)
    const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: repoPath, shell: true })
    const statusLines = statusOutput.trim().split('\n').filter(line => line.trim())
    
    // Parse status lines
    // Format: XY filename
    // X = staged status, Y = working tree status
    // M = modified, A = added, D = deleted, ?? = untracked
    const stagedFiles = [] // All staged files (for backward compatibility)
    const stagedAddedFiles = [] // Staged new files (status "A")
    const stagedModifiedFiles = [] // Staged modified files (status "M")
    const modifiedFiles = [] // Unstaged modified files
    const untrackedFiles = [] // Untracked files
    const deletedFiles = []
    
    statusLines.forEach(line => {
      const status = line.substring(0, 2)
      // Git status uses forward slashes, normalize to forward slashes
      const filePath = line.substring(3).trim().replace(/\\/g, '/')
      
      const stagedStatus = status[0]
      const workingStatus = status[1]
      
      if (stagedStatus !== ' ' && stagedStatus !== '?') {
        // File is staged
        if (stagedStatus === 'A') {
          stagedFiles.push(filePath)
          stagedAddedFiles.push(filePath) // Track as added
        } else if (stagedStatus === 'M') {
          stagedFiles.push(filePath)
          stagedModifiedFiles.push(filePath) // Track as modified
        } else if (stagedStatus === 'D') {
          deletedFiles.push(filePath)
        }
      }
      
      if (workingStatus !== ' ' && workingStatus !== '?') {
        // File has working tree changes
        if (workingStatus === 'M') {
          modifiedFiles.push(filePath)
        } else if (workingStatus === 'D') {
          deletedFiles.push(filePath)
        }
      }
      
      if (status === '??') {
        // Untracked file
        untrackedFiles.push(filePath)
      }
    })
    
    const hasChanges = stagedFiles.length > 0 || modifiedFiles.length > 0 || untrackedFiles.length > 0 || deletedFiles.length > 0
    
    return {
      success: true,
      branch,
      hasChanges,
      stagedCount: stagedFiles.length,
      modifiedCount: modifiedFiles.length,
      untrackedCount: untrackedFiles.length,
      deletedCount: deletedFiles.length,
      stagedFiles,
      stagedAddedFiles, // New: staged new files
      stagedModifiedFiles, // New: staged modified files
      modifiedFiles,
      untrackedFiles,
      deletedFiles
    }
  } catch (error) {
    console.error('[getGitStatus] Error:', error)
    return { success: false, error: error.message || 'Failed to get git status' }
  }
})

// Log that handler is registered (this runs when the module loads)
console.log('[getGitStatus] IPC handler registered')

// Git reset - discard all uncommitted changes
ipcMain.handle('gitReset', async (event, repoFullName) => {
  console.log('[gitReset] Handler called for:', repoFullName)
  try {
    // Parse owner/repo from full_name
    const [owner, repo] = repoFullName.split('/')
    if (!owner || !repo) {
      return { success: false, error: 'Invalid repository name format (expected: owner/repo)' }
    }
    
    const reposDir = getReposDir()
    const repoPath = path.join(reposDir, owner, repo)
    
    if (!require('fs').existsSync(repoPath)) {
      return { success: false, error: `Repository not found: ${owner}/${repo}` }
    }
    
    if (!require('fs').existsSync(path.join(repoPath, '.git'))) {
      return { success: false, error: 'Repository is not a git repository' }
    }
    
    console.log('[gitReset] Resetting repository at:', repoPath)
    
    // Check if HEAD exists (repo has commits)
    let hasCommits = false
    try {
      await execAsync('git rev-parse HEAD', { cwd: repoPath, shell: true })
      hasCommits = true
    } catch {
      // No commits yet - repo is empty
      console.log('[gitReset] No commits found - repo is empty')
    }
    
    if (hasCommits) {
      // Step 1: Reset all staged and unstaged changes (git reset --hard HEAD)
      await execAsync('git reset --hard HEAD', { cwd: repoPath, shell: true })
      console.log('[gitReset] Reset staged and modified files')
    } else {
      // No commits - just unstage everything
      try {
        await execAsync('git reset', { cwd: repoPath, shell: true })
        console.log('[gitReset] Unstaged all files')
      } catch {
        // No staging area yet - that's fine
      }
    }
    
    // Step 2: Remove untracked files and directories (git clean -fd)
    await execAsync('git clean -fd', { cwd: repoPath, shell: true })
    console.log('[gitReset] Removed untracked files')
    
    return { success: true, message: 'All uncommitted changes discarded successfully' }
  } catch (error) {
    console.error('[gitReset] Error:', error)
    return { success: false, error: error.message || 'Failed to reset repository' }
  }
})

console.log('[gitReset] IPC handler registered')

// ========== AUTO-SYNC: Background polling for GitHub changes ==========
let autoSyncInterval = null
let watchedRepo = null // { owner, repo, isTeam }
let lastKnownCommit = null
let lastBehindNotification = 0 // Timestamp of last "behind" notification

// Check if remote has new commits and auto-pull
async function checkAndSync() {
  if (!watchedRepo) return
  
  const { owner, repo, isTeam } = watchedRepo
  const reposDir = getReposDir()
  const repoPath = path.join(reposDir, owner, repo)
  
  // Check if repo exists
  if (!fsSync.existsSync(path.join(repoPath, '.git'))) return
  
  // Get GitHub token for authenticated requests
  if (!storedGitHubToken) {
    // No token - can't authenticate, skip silently
    return
  }
  
  try {
    // Use authenticated URL for fetch
    const authUrl = `https://${storedGitHubToken}@github.com/${owner}/${repo}.git`
    
    // Fetch latest from remote (silent, no output)
    await execAsync(`git fetch ${authUrl} main --quiet`, { 
      cwd: repoPath, 
      shell: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    
    // Check if local HEAD exists (repo might be empty or branch not checked out)
    let localHash = null
    try {
      const { stdout: localCommit } = await execAsync('git rev-parse HEAD', { cwd: repoPath, shell: true })
      localHash = localCommit.trim()
    } catch (headError) {
      // No HEAD - try to checkout default branch
      console.log(`[AutoSync] No local HEAD, trying to checkout default branch...`)
      try {
        await execAsync('git checkout main', { cwd: repoPath, shell: true })
        const { stdout: localCommit } = await execAsync('git rev-parse HEAD', { cwd: repoPath, shell: true })
        localHash = localCommit.trim()
      } catch {
        try {
          await execAsync('git checkout master', { cwd: repoPath, shell: true })
          const { stdout: localCommit } = await execAsync('git rev-parse HEAD', { cwd: repoPath, shell: true })
          localHash = localCommit.trim()
        } catch {
          // Repo is empty or has no commits - skip sync
          return
        }
      }
    }
    
    // Get remote HEAD commit (FETCH_HEAD has what we just fetched)
    let remoteHash = null
    try {
      const { stdout: remoteCommit } = await execAsync('git rev-parse FETCH_HEAD', { cwd: repoPath, shell: true })
      remoteHash = remoteCommit.trim()
    } catch {
      // No remote commits yet - skip sync
      return
    }
    
    // If different, remote has new commits
    if (localHash !== remoteHash) {
      // Count how many commits behind
      let commitsBehind = 0
      try {
        const { stdout: behindCount } = await execAsync(`git rev-list --count HEAD..FETCH_HEAD`, { cwd: repoPath, shell: true })
        commitsBehind = parseInt(behindCount.trim()) || 0
      } catch (e) {
        commitsBehind = 1 // Default to 1 if we can't count
      }
      
      console.log(`[AutoSync] Remote has ${commitsBehind} new commit(s) for ${owner}/${repo}`)
      
      // Check if we have uncommitted changes
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: repoPath, shell: true })
      const hasLocalChanges = !!statusOutput.trim()
      
      if (hasLocalChanges) {
        console.log(`[AutoSync] Local has uncommitted changes, attempting smart merge...`)
      }
      
      // Try to pull - Git is smart enough to merge non-conflicting changes
      // even when you have dirty files. It will fail if there's an actual conflict.
      try {
        await execAsync(`git pull ${authUrl} main --quiet`, { 
          cwd: repoPath, 
          shell: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        })
        
        console.log(`[AutoSync] Pulled ${commitsBehind} commit(s) for ${owner}/${repo}${hasLocalChanges ? ' (preserved local changes)' : ''}`)
        
        // Notify renderer to refresh file tree and tabs
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('repo-synced', { owner, repo, commitsBehind })
        }
      } catch (pullError) {
        // Pull failed - likely due to conflict with local changes
        const errorMsg = pullError.message || ''
        
        if (hasLocalChanges && (
          errorMsg.includes('overwritten by merge') ||
          errorMsg.includes('uncommitted changes') ||
          errorMsg.includes('local changes') ||
          errorMsg.includes('would be overwritten') ||
          errorMsg.includes('conflict')
        )) {
          // Genuine conflict - notify user
          console.log(`[AutoSync] Pull blocked - local changes conflict with remote`)
          
          // Only notify once per minute to avoid spam
          const now = Date.now()
          if (now - lastBehindNotification > 60000) {
            lastBehindNotification = now
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('repo-behind', { 
                owner, 
                repo, 
                commitsBehind,
                hasLocalChanges: true,
                hasConflict: true,
                message: `Your local changes conflict with ${commitsBehind} new commit(s). Commit or discard to sync.`
              })
            }
          }
        } else {
          // Some other error (network, auth, etc) - log it
          console.error(`[AutoSync] Pull failed:`, errorMsg)
        }
      }
    }
  } catch (error) {
    // Silent fail - don't spam console for network issues
    if (!error.message?.includes('Could not resolve host')) {
      console.error(`[AutoSync] Error:`, error.message)
    }
  }
}

// Start watching a repo for changes
ipcMain.handle('startAutoSync', async (event, owner, repo, isTeamWorkspace = false) => {
  console.log(`[AutoSync] Starting watch for ${owner}/${repo} (team: ${isTeamWorkspace})`)
  watchedRepo = { owner, repo, isTeam: isTeamWorkspace }
  lastBehindNotification = 0 // Reset notification throttle
  
  // Clear existing interval
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval)
  }
  
  // Check immediately, then poll based on workspace type
  // Team workspaces: every 15 seconds for faster collaboration
  // Solo workspaces: every 30 seconds (less aggressive)
  const pollInterval = isTeamWorkspace ? 15000 : 30000
  console.log(`[AutoSync] Poll interval: ${pollInterval / 1000}s`)
  
  checkAndSync()
  autoSyncInterval = setInterval(checkAndSync, pollInterval)
  
  return { success: true }
})

// Stop watching
ipcMain.handle('stopAutoSync', async () => {
  console.log(`[AutoSync] Stopping watch`)
  watchedRepo = null
  lastBehindNotification = 0
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval)
    autoSyncInterval = null
  }
  return { success: true }
})

console.log('[AutoSync] IPC handlers registered')

