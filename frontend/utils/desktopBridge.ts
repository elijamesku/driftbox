/**
 * Desktop Bridge - Handles Electron IPC vs Web API routing
 * 
 * In Electron: Uses IPC for direct filesystem access
 * In Browser: Uses API proxy for backend file operations
 */

import { getApiEndpoint } from './apiEndpoint'

// TypeScript declarations for Electron API
declare global {
  interface Window {
    electronAPI?: {
      isDesktop: boolean
      platform: string
      
      // File operations
      readFile: (owner: string, repo: string, filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
      writeFile: (owner: string, repo: string, filePath: string, content: string) => Promise<{ success: boolean; path?: string; error?: string }>
      getFileTree: (owner: string, repo: string, dirPath?: string) => Promise<{ success: boolean; items?: any[]; error?: string }>
      moveFile: (owner: string, repo: string, sourcePath: string, targetPath: string) => Promise<{ success: boolean; error?: string }>
      deleteFile: (owner: string, repo: string, path: string) => Promise<{ success: boolean; error?: string }>
      createFile: (owner: string, repo: string, path: string, content: string, isFolder: boolean) => Promise<{ success: boolean; error?: string }>
      
      // Repository operations
      cloneRepo: (owner: string, repo: string, token: string) => Promise<{ success: boolean; path?: string; error?: string }>
      getRepoPath: (owner: string, repo: string) => Promise<{ success: boolean; path?: string; error?: string }>
      
      // Git operations
      gitCommit: (owner: string, repo: string, message: string) => Promise<{ success: boolean; error?: string }>
      gitPush: (owner: string, repo: string, branch?: string, token?: string) => Promise<{ success: boolean; error?: string }>
      createBranch: (owner: string, repo: string, branchName: string) => Promise<{ success: boolean; error?: string }>
      getGitStatus: (owner: string, repo: string) => Promise<{
        success: boolean
        branch?: string
        hasChanges?: boolean
        stagedCount?: number
        modifiedCount?: number
        untrackedCount?: number
        deletedCount?: number
        stagedFiles?: string[]
        stagedAddedFiles?: string[] // Staged new files (status "A")
        stagedModifiedFiles?: string[] // Staged modified files (status "M")
        modifiedFiles?: string[]
        untrackedFiles?: string[]
        deletedFiles?: string[]
        error?: string
      }>
      gitReset: (repoFullName: string) => Promise<{ success: boolean; message?: string; error?: string }>
      gitPull: (owner: string, repo: string, branch?: string, token?: string) => Promise<{ success: boolean; error?: string }>
      
      // GitHub token storage
      setGitHubToken: (token: string) => Promise<{ success: boolean }>
      getGitHubToken: () => Promise<{ success: boolean; token?: string }>
      
      // Terraform operations
      terraformFmt: (owner: string, repo: string) => Promise<{ success: boolean; output?: string; error?: string }>
      terraformValidate: (owner: string, repo: string) => Promise<{ 
        success: boolean
        valid?: boolean
        diagnostics?: any[]
        error?: string
      }>
      terraformInitBackground: (owner: string, repo: string) => Promise<{
        success: boolean
        skipped?: boolean
        started?: boolean
        reason?: string
        error?: string
      }>
      autoHeal: (
        token: string,
        workspacePath: string,
        diagnostics: any[],
        repoOwner: string,
        repoName: string,
        files: {[key: string]: string}
      ) => Promise<{
        success: boolean
        fixes?: Array<{path: string; newContent: string}>
        error?: string
        details?: string
      }>
    }
  }
}

export const isDesktop = typeof window !== 'undefined' && window.electronAPI?.isDesktop === true

/**
 * Apply file proposal - writes file to local repo
 * For new files (action: "create"), uses createFile API which properly tracks in git
 * For existing files (action: "edit"), uses writeFile API
 */
export async function applyFileProposal(
  owner: string,
  repo: string,
  filePath: string,
  content: string,
  token: string,
  action: 'create' | 'edit' = 'edit'
): Promise<{ success: boolean; message?: string; error?: string }> {
  console.log('💾 [desktopBridge] applyFileProposal called:', {
    owner,
    repo,
    filePath,
    contentLength: content?.length || 0,
    action,
    isDesktop,
    hasElectronAPI: !!(isDesktop && window.electronAPI)
  })
  
  if (isDesktop && window.electronAPI) {
    // ELECTRON: Use appropriate API based on action
    if (action === 'create') {
      console.log('💾 [desktopBridge] Using Electron createFile for new file:', filePath)
      try {
        const result = await window.electronAPI.createFile(owner, repo, filePath, content, false)
        console.log('💾 [desktopBridge] createFile result:', result)
        
        if (result.success) {
          return {
            success: true,
            message: `File created and staged: ${filePath}`
          }
        } else {
          console.error('💾 [desktopBridge] createFile failed:', result.error)
          return {
            success: false,
            error: result.error
          }
        }
      } catch (error: any) {
        console.error('💾 [desktopBridge] createFile exception:', error)
        return {
          success: false,
          error: error?.message || 'Unknown error'
        }
      }
    } else {
      console.log('💾 [desktopBridge] Using Electron writeFile for existing file:', filePath)
      try {
        const result = await window.electronAPI.writeFile(owner, repo, filePath, content)
        console.log('💾 [desktopBridge] writeFile result:', result)
        
        if (result.success) {
          return {
            success: true,
            message: `File written: ${result.path}`
          }
        } else {
          console.error('💾 [desktopBridge] writeFile failed:', result.error)
          return {
            success: false,
            error: result.error
          }
        }
      } catch (error: any) {
        console.error('💾 [desktopBridge] writeFile exception:', error)
        return {
          success: false,
          error: error?.message || 'Unknown error'
        }
      }
    }
  } else {
    // WEB: Use backend API
    console.log('💾 [desktopBridge] Using API for file write:', filePath)
    try {
      const response = await fetch('/api/proxy/files/proposals/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          workspace_path: `~/.driftbox/repos/${owner}/${repo}`,
          action: action,
          path: filePath,
          new_content: content
        })
      })
      
      console.log('💾 [desktopBridge] API response status:', response.status)
      
      if (!response.ok) {
        const error = await response.text()
        console.error('💾 [desktopBridge] API request failed:', error)
        return { success: false, error }
      }
      
      const data = await response.json()
      console.log('💾 [desktopBridge] API response data:', data)
      return { success: true, message: data.message }
    } catch (error: any) {
      console.error('💾 [desktopBridge] API request exception:', error)
      return {
        success: false,
        error: error?.message || 'Unknown error'
      }
    }
  }
}

/**
 * Fix duplicate resources in HCL files client-side
 */
async function fixDuplicateResourcesClientSide(owner: string, repo: string): Promise<{ fixed: number }> {
  if (!window.electronAPI) return { fixed: 0 }
  
  console.log('🔍 [Duplicate Check] Starting client-side duplicate detection...')
  
  try {
    // Get all .tf files
    const treeResult = await window.electronAPI.getFileTree(owner, repo, '')
    if (!treeResult.success || !treeResult.items) {
      return { fixed: 0 }
    }
    
    const tfFiles = treeResult.items.filter((item: any) => 
      item.type === 'file' && item.name.endsWith('.tf')
    )
    
    // Track all resources across all files
    const allResources = new Map<string, number>() // {type.name => count}
    let fixedCount = 0
    
    // Pass 1: Count all resources
    for (const file of tfFiles) {
      const readResult = await window.electronAPI!.readFile(owner, repo, file.name)
      if (!readResult.success || !readResult.content) continue
      
      const matches = readResult.content.matchAll(/resource\s+"([^"]+)"\s+"([^"]+)"/g)
      for (const match of matches) {
        const key = `${match[1]}.${match[2]}`
        allResources.set(key, (allResources.get(key) || 0) + 1)
      }
    }
    
    // Generate unique suffix based on timestamp
    const uniqueSuffix = Date.now().toString(36).slice(-4) // Short unique suffix like "a1b2"
    
    // Pass 2: Fix duplicates in each file
    for (const file of tfFiles) {
      const readResult = await window.electronAPI!.readFile(owner, repo, file.name)
      if (!readResult.success || !readResult.content) continue
      
      let content = readResult.content
      const seenInFile = new Map<string, number>()
      let modified = false
      
      // Find and rename duplicates
      content = content.replace(
        /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g,
        (match, type, name) => {
          const key = `${type}.${name}`
          const occurrenceInFile = (seenInFile.get(key) || 0) + 1
          seenInFile.set(key, occurrenceInFile)
          
          // If duplicate (either in file or globally)
          if (occurrenceInFile > 1 || (allResources.get(key) || 0) > 1) {
            // Use unique suffix to avoid collision with existing resources
            const newName = `${name}_${uniqueSuffix}${fixedCount}`
            console.log(`🔧 [Duplicate Check] ${file.name}: ${key} → ${type}.${newName}`)
            modified = true
            fixedCount++
            return `resource "${type}" "${newName}" {`
          }
          
          return match
        }
      )
      
      // Write back if modified
      if (modified) {
        await window.electronAPI!.writeFile(owner, repo, file.name, content)
        console.log(`✅ [Duplicate Check] Fixed duplicates in ${file.name}`)
      }
    }
    
    console.log(`✅ [Duplicate Check] Fixed ${fixedCount} duplicate resources`)
    return { fixed: fixedCount }
  } catch (error) {
    console.error('❌ [Duplicate Check] Error:', error)
    return { fixed: 0 }
  }
}

/**
 * Create PR - commits and pushes to GitHub
 */
export async function createPullRequest(
  owner: string,
  repo: string,
  branchName: string,
  commitMessage: string,
  token: string,
  onAutoHealProgress?: (status: 'analyzing' | 'generating' | 'applying' | 'retrying' | 'success' | 'failed') => void
): Promise<{ success: boolean; pr_url?: string; error?: string }> {
  if (isDesktop && window.electronAPI) {
    // ELECTRON: Local git operations + GitHub API
    console.log('🖥️  Using Electron for PR creation')
    
    try {
      // 0. Get GitHub token from Electron store (not the JWT token passed in)
      console.log(`🔑 [createPR] Step 0: Getting GitHub token from Electron store...`)
      const tokenResult = await window.electronAPI.getGitHubToken()
      const githubToken = tokenResult?.token
      console.log(`🔑 [createPR] GitHub token retrieved:`, githubToken ? 'Yes' : 'No')
      
      if (!githubToken) {
        throw new Error('GitHub token not found. Please authenticate with GitHub first.')
      }
      
      // 1. Create branch
      console.log(`🌿 [createPR] Step 1: Creating branch "${branchName}"...`)
      const branchResult = await window.electronAPI.createBranch(owner, repo, branchName)
      console.log(`🌿 [createPR] Branch result:`, branchResult)
      if (!branchResult.success) {
        throw new Error(`Failed to create branch: ${branchResult.error}`)
      }
      
      // 2. Commit changes
      console.log(`📝 [createPR] Step 2: Committing changes with message: "${commitMessage}"...`)
      const commitResult = await window.electronAPI.gitCommit(owner, repo, commitMessage)
      console.log(`📝 [createPR] Commit result:`, commitResult)
      if (!commitResult.success) {
        throw new Error(`Failed to commit: ${commitResult.error}`)
      }
      
      // 2.5. Fix duplicate resources CLIENT-SIDE (before terraform fmt)
      console.log(`🔍 [createPR] Step 2.5: Fixing duplicate resources client-side...`)
      const duplicateResult = await fixDuplicateResourcesClientSide(owner, repo)
      if (duplicateResult.fixed > 0) {
        console.log(`✅ [createPR] Fixed ${duplicateResult.fixed} duplicate resources, re-committing...`)
        // Re-commit with the fixes
        const reCommitResult = await window.electronAPI.gitCommit(owner, repo, commitMessage + ' (auto-fixed duplicates)')
        if (!reCommitResult.success) {
          console.warn(`⚠️ [createPR] Failed to re-commit duplicate fixes:`, reCommitResult.error)
        }
      }
      
      // 3. Run terraform fmt
      console.log(`🎨 [createPR] Step 3: Running terraform fmt...`)
      const fmtResult = await window.electronAPI.terraformFmt(owner, repo)
      console.log(`🎨 [createPR] Fmt result:`, fmtResult)
      if (!fmtResult.success) {
        console.warn(`⚠️  [createPR] Terraform fmt failed (non-blocking):`, fmtResult.error)
      }
      
      // 4. Run terraform validate (SERVER-SIDE - fast, providers cached on server)
      console.log(`✅ [createPR] Step 4: Running terraform validate (server-side)...`)
      
      // First, read all .tf files from workspace
      const fileTreeResult = await window.electronAPI.getFileTree(owner, repo, '')
      if (!fileTreeResult.success || !fileTreeResult.items) {
        throw new Error('Unable to read workspace files for validation')
      }
      
      // Recursively find all .tf files
      const collectTfFiles = async (items: any[], basePath: string = ''): Promise<{[key: string]: string}> => {
        const files: {[key: string]: string} = {}
        for (const item of items) {
          const itemPath = basePath ? `${basePath}/${item.name}` : item.name
          if (item.type === 'file' && item.name.endsWith('.tf')) {
            const fileContent = await window.electronAPI!.readFile(owner, repo, itemPath)
            if (fileContent.success && fileContent.content) {
              files[itemPath] = fileContent.content
            }
          } else if (item.type === 'directory' && item.children) {
            const childFiles = await collectTfFiles(item.children, itemPath)
            Object.assign(files, childFiles)
          }
        }
        return files
      }
      
      const tfFilesForValidation = await collectTfFiles(fileTreeResult.items)
      console.log(`📦 [createPR] Collected ${Object.keys(tfFilesForValidation).length} .tf files for validation`)
      
      // Send to server for validation (server has providers cached)
      let validateResult: any = { valid: true, diagnostics: [], init_success: true }
      try {
        const validateResponse = await fetch(getApiEndpoint('/terraform/validate'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ files: tfFilesForValidation })
        })
        
        if (validateResponse.ok) {
          validateResult = await validateResponse.json()
          console.log(`✅ [createPR] Server validation result:`, validateResult)
        } else {
          console.warn(`⚠️ [createPR] Server validation failed, response:`, validateResponse.status)
          // Fall back to local validation if server fails
          console.log(`🔄 [createPR] Falling back to local validation...`)
          validateResult = await window.electronAPI.terraformValidate(owner, repo)
        }
      } catch (serverError) {
        console.warn(`⚠️ [createPR] Server validation error:`, serverError)
        // Fall back to local validation if server fails
        console.log(`🔄 [createPR] Falling back to local validation...`)
        validateResult = await window.electronAPI.terraformValidate(owner, repo)
      }
      
      console.log(`✅ [createPR] Final validate result:`, validateResult)
      console.log(`✅ [createPR] Validation details:`, {
        valid: validateResult.valid,
        init_success: validateResult.init_success,
        init_error: validateResult.init_error,
        diagnosticsCount: validateResult.diagnostics?.length || 0,
        diagnostics: validateResult.diagnostics
      })
      
      // Check for ANY validation/init failure (both should trigger auto-heal)
      // Backend returns: { valid, diagnostics, init_success, init_error }
      const initFailed = validateResult.init_success === false
      const validationFailed = validateResult.valid === false
      
      if (initFailed || validationFailed) {
        // Try AI auto-heal with retry loop
        console.log(`🤖 [createPR] Validation/init failed - attempting AI auto-heal...`)
        console.log(`   Reason: ${initFailed ? `terraform init failed: ${validateResult.init_error}` : 'validation errors found'}`)
        
        const MAX_AUTO_HEAL_ATTEMPTS = 3
        let currentValidateResult = validateResult
        
        for (let attempt = 1; attempt <= MAX_AUTO_HEAL_ATTEMPTS; attempt++) {
          console.log(`🔄 [createPR] Auto-heal attempt ${attempt}/${MAX_AUTO_HEAL_ATTEMPTS}`)
          
          try {
            // Notify: Analyzing errors (this step includes file reading now)
            onAutoHealProgress?.('analyzing')
          
          // Get the actual workspace path from Electron
          const repoPathResult = await window.electronAPI.getRepoPath(owner, repo)
          if (!repoPathResult.success || !repoPathResult.path) {
            onAutoHealProgress?.('failed')
            throw new Error('Unable to get workspace path for auto-heal')
          }
          
          // Read all .tf files from the workspace (fast - runs locally)
          console.log(`📂 [createPR] Reading .tf files from workspace for auto-heal...`)
          const fileTreeResult = await window.electronAPI.getFileTree(owner, repo, '')
          if (!fileTreeResult.success || !fileTreeResult.items) {
            onAutoHealProgress?.('failed')
            throw new Error('Unable to read workspace files')
          }
          
          // Recursively find all .tf files
          const findTfFiles = async (items: any[], basePath: string = ''): Promise<{[key: string]: string}> => {
            const files: {[key: string]: string} = {}
            
            for (const item of items) {
              const itemPath = basePath ? `${basePath}/${item.name}` : item.name
              
              if (item.type === 'file' && item.name.endsWith('.tf')) {
                // Read file content
                const fileContent = await window.electronAPI!.readFile(owner, repo, itemPath)
                if (fileContent.success && fileContent.content) {
                  files[itemPath] = fileContent.content
                  console.log(`  📄 Read: ${itemPath}`)
                }
              } else if (item.type === 'directory' && item.children) {
                const childFiles = await findTfFiles(item.children, itemPath)
                Object.assign(files, childFiles)
              }
            }
            
            return files
          }
          
          const tfFiles = await findTfFiles(fileTreeResult.items)
          console.log(`📦 [createPR] Found ${Object.keys(tfFiles).length} .tf files`)
          
          // Notify: Generating fixes
          onAutoHealProgress?.('generating')
          
          // Use IPC if available (desktop mode with updated Electron), otherwise fall back to proxy API
          let autoHealResult: any
          if (window.electronAPI?.autoHeal) {
            console.log(`🤖 [createPR] Using Electron IPC for auto-heal`)
            autoHealResult = await window.electronAPI.autoHeal(
              token,
              repoPathResult.path,
              currentValidateResult.diagnostics || [],
              owner,
              repo,
              tfFiles
            )
          } else {
            // Fallback to proxy API (works without Electron restart)
            console.log(`🤖 [createPR] Using proxy API for auto-heal (IPC not available)`)
            const autoHealResponse = await fetch('/api/proxy/git/auto-heal', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({
                workspace_path: repoPathResult.path,
                diagnostics: currentValidateResult.diagnostics || [],
                repo_owner: owner,
                repo_name: repo,
                files: tfFiles
              })
            })
            autoHealResult = await autoHealResponse.json()
          }
          console.log(`🤖 [createPR] Auto-heal result:`, autoHealResult)
          
          if (autoHealResult.success && autoHealResult.fixes && autoHealResult.fixes.length > 0) {
            // Notify: Applying fixes
            onAutoHealProgress?.('applying')
            
            // Apply fixes to disk using Electron
            console.log(`✅ [createPR] AI generated ${autoHealResult.fixes.length} fixes, applying to disk...`)
            
            for (const fix of autoHealResult.fixes) {
              console.log(`  📝 Applying fix to: ${fix.path}`)
              const writeResult = await window.electronAPI.writeFile(owner, repo, fix.path, fix.newContent)
              if (!writeResult.success) {
                console.error(`  ❌ Failed to write ${fix.path}:`, writeResult.error)
              }
            }
            
            console.log(`✅ [createPR] All fixes applied to disk`)
            
            // Notify: Retrying validation
            onAutoHealProgress?.('retrying')
            
            // Re-validate SERVER-SIDE (not local - local has no providers)
            console.log(`🔄 [createPR] Re-validating server-side after auto-heal...`)
            const revalidateFiles = await collectTfFiles(fileTreeResult.items)
            const revalidateResponse = await fetch(getApiEndpoint('/terraform/validate'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ files: revalidateFiles })
            })
            
            if (revalidateResponse.ok) {
              currentValidateResult = await revalidateResponse.json()
              console.log(`✅ [createPR] Server re-validation result:`, currentValidateResult)
            } else {
              console.error(`❌ [createPR] Server re-validation failed`)
              currentValidateResult = { valid: false, diagnostics: [], init_success: false }
            }
            if (currentValidateResult.valid) {
              console.log(`✅ [createPR] Validation passed after AI auto-heal (attempt ${attempt})!`)
              onAutoHealProgress?.('success')
              break  // Success! Exit the retry loop
            } else {
              // Still has errors - log and continue to next attempt
              console.log(`⚠️  [createPR] Validation still failing after attempt ${attempt}, will retry...`)
              if (attempt === MAX_AUTO_HEAL_ATTEMPTS) {
                // Max attempts reached, fail with clean error message
                onAutoHealProgress?.('failed')
                // Log full errors to console for debugging
                const errors = currentValidateResult.diagnostics
                  ?.filter((d: any) => d.severity === 'error')
                  .map((d: any) => `${d.summary}: ${d.detail}`)
                  .join('\n') || 'Unknown validation errors'
                console.error(`[createPR] Validation errors:`, errors)
                // Throw clean user-facing message
                const errorCount = currentValidateResult.diagnostics?.filter((d: any) => d.severity === 'error').length || 0
                throw new Error(`Terraform validation failed (${errorCount} errors). Check console for details.`)
              }
              // Continue to next attempt
            }
          } else {
            // Auto-heal couldn't generate fixes
            console.log(`⚠️  [createPR] Auto-heal returned no fixes on attempt ${attempt}`)
            if (attempt === MAX_AUTO_HEAL_ATTEMPTS) {
              onAutoHealProgress?.('failed')
              // Log full errors to console for debugging
              const errors = currentValidateResult.diagnostics
                ?.filter((d: any) => d.severity === 'error')
                .map((d: any) => `${d.summary}: ${d.detail}`)
                .join('\n') || 'Unknown validation errors'
              console.error(`[createPR] Validation errors:`, errors)
              // Throw clean user-facing message
              const errorCount = currentValidateResult.diagnostics?.filter((d: any) => d.severity === 'error').length || 0
              throw new Error(`Terraform validation failed (${errorCount} errors). Auto-heal could not fix issues.`)
            }
          }
        } catch (autoHealError: any) {
          console.error(`❌ [createPR] Auto-heal error on attempt ${attempt}:`, autoHealError)
          
          // Better error message for IPC failures
          if (autoHealError.message?.includes('Failed to connect to backend') || 
              autoHealError.message?.includes('backend server') ||
              autoHealError.message?.includes('404')) {
            console.error(`❌ [createPR] Backend connection failed or endpoint not found`)
          }
          
          if (attempt === MAX_AUTO_HEAL_ATTEMPTS) {
            onAutoHealProgress?.('failed')
            // Log full errors to console for debugging
            const errors = currentValidateResult.diagnostics
              ?.filter((d: any) => d.severity === 'error')
              .map((d: any) => `${d.summary}: ${d.detail}`)
              .join('\n') || 'Unknown validation errors'
            console.error(`[createPR] Validation errors:`, errors)
            console.error(`[createPR] Init error:`, currentValidateResult.init_error)
            // Throw clean user-facing message
            const errorCount = currentValidateResult.diagnostics?.filter((d: any) => d.severity === 'error').length || 0
            throw new Error(`Terraform validation failed (${errorCount} errors). Auto-heal service unavailable.`)
          }
          // Continue to next attempt
        }
        } // End of for loop
      }
      
      // 5. Push to GitHub using the GitHub token (not JWT)
      console.log(`📤 [createPR] Step 5: Pushing branch "${branchName}" to GitHub...`)
      const pushResult = await window.electronAPI.gitPush(owner, repo, branchName, githubToken)
      console.log(`📤 [createPR] Push result:`, pushResult)
      if (!pushResult.success) {
        throw new Error(`Failed to push: ${pushResult.error}`)
      }
      
      // 6. Reset working directory to clean state (remove yellow "M" indicators)
      console.log(`🧹 [createPR] Step 6: Resetting working directory to clean state...`)
      const resetResult = await window.electronAPI!.gitReset(`${owner}/${repo}`)
      if (!resetResult.success) {
        console.warn(`⚠️  [createPR] Failed to reset working directory:`, resetResult.error)
      } else {
        console.log(`✅ [createPR] Working directory reset successfully`)
      }
      
      // 7. Pull latest from main to sync with GitHub
      console.log(`🔄 [createPR] Step 7: Pulling latest from GitHub to sync...`)
      try {
        const pullResult = await window.electronAPI!.gitPull(owner, repo, 'main', githubToken)
        if (pullResult.success) {
          console.log(`✅ [createPR] Pulled latest changes from GitHub`)
        } else {
          console.warn(`⚠️  [createPR] Git pull failed:`, pullResult.error)
        }
      } catch (pullError) {
        console.warn(`⚠️  [createPR] Git pull error:`, pullError)
      }
      
      // 8. Generate GitHub PR URL
      const prUrl = `https://github.com/${owner}/${repo}/compare/main...${branchName}?expand=1`
      console.log(`✅ [createPR] PR URL generated: ${prUrl}`)
      
      return {
        success: true,
        pr_url: prUrl
      }
    } catch (error: any) {
      console.error(`❌ [createPR] Error:`, error)
      return {
        success: false,
        error: error.message
      }
    }
  } else {
    // WEB: Use backend API
    console.log('🌐 Using API for PR creation')
    
    const repoPathResult = await fetch('/api/proxy/files/read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        workspace_path: `~/.driftbox/repos/${owner}/${repo}`
      })
    })
    
    if (!repoPathResult.ok) {
      return { success: false, error: 'Failed to get workspace path' }
    }
    
    const response = await fetch('/api/proxy/approve/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        workspace_path: `~/.driftbox/repos/${owner}/${repo}`,
        commit_message: commitMessage,
        target_branch: branchName
      })
    })
    
    if (!response.ok) {
      const error = await response.text()
      return { success: false, error }
    }
    
    // Parse SSE stream for final result
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finalData: any = null
    
    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'complete') {
                finalData = data
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    }
    
    if (finalData?.success) {
      return {
        success: true,
        pr_url: finalData.pr_url
      }
    } else {
      return {
        success: false,
        error: finalData?.message || 'PR creation failed'
      }
    }
  }
}

/**
 * Get workspace path for backend API calls
 */
export async function getWorkspacePath(owner: string, repo: string): Promise<string | null> {
  if (isDesktop && window.electronAPI) {
    const result = await window.electronAPI.getRepoPath(owner, repo)
    return result.success ? result.path! : null
  } else {
    // For web, use standard path
    return `~/.driftbox/repos/${owner}/${repo}`
  }
}

/**
 * Clone repository (desktop only - web uses backend)
 */
export async function cloneRepository(owner: string, repo: string, token: string): Promise<{ success: boolean; path?: string; error?: string }> {
  if (isDesktop && window.electronAPI) {
    return await window.electronAPI.cloneRepo(owner, repo, token)
  } else {
    // Web: Use backend clone API
    const response = await fetch('/api/proxy/github/clone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ owner, repo })
    })
    
    if (!response.ok) {
      return { success: false, error: await response.text() }
    }
    
    const data = await response.json()
    return { success: true, path: data.path }
  }
}

/**
 * Read file content from local repository
 */
export async function readFile(owner: string, repo: string, filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
  if (isDesktop && window.electronAPI?.readFile) {
    return await window.electronAPI.readFile(owner, repo, filePath)
  } else {
    return { success: false, error: 'Not in desktop mode or readFile not available' }
  }
}

/**
 * Write file content to local repository
 */
export async function writeFile(owner: string, repo: string, filePath: string, content: string): Promise<{ success: boolean; path?: string; error?: string }> {
  if (isDesktop && window.electronAPI?.writeFile) {
    return await window.electronAPI.writeFile(owner, repo, filePath, content)
  } else {
    return { success: false, error: 'Not in desktop mode or writeFile not available' }
  }
}

/**
 * Get file tree from local repository
 */
export async function getFileTree(owner: string, repo: string, dirPath: string = ''): Promise<{ success: boolean; items?: any[]; error?: string }> {
  if (isDesktop && window.electronAPI?.getFileTree) {
    return await window.electronAPI.getFileTree(owner, repo, dirPath)
  } else {
    return { success: false, error: 'Not in desktop mode or getFileTree not available' }
  }
}

/**
 * Get git status for a repository
 */
export async function getGitStatus(owner: string, repo: string): Promise<{
  success: boolean
  branch?: string
  hasChanges?: boolean
  stagedCount?: number
  modifiedCount?: number
  untrackedCount?: number
  deletedCount?: number
  stagedFiles?: string[]
  stagedAddedFiles?: string[] // Staged new files (status "A")
  stagedModifiedFiles?: string[] // Staged modified files (status "M")
  modifiedFiles?: string[]
  untrackedFiles?: string[]
  deletedFiles?: string[]
  error?: string
}> {
  if (isDesktop && window.electronAPI?.getGitStatus) {
    return await window.electronAPI.getGitStatus(owner, repo)
  } else {
    return { success: false, error: 'Not in desktop mode or getGitStatus not available' }
  }
}

/**
 * Reset repository - discard all uncommitted changes
 */
export async function gitReset(repoFullName: string): Promise<{ success: boolean; message?: string; error?: string }> {
  if (isDesktop && window.electronAPI?.gitReset) {
    return await window.electronAPI.gitReset(repoFullName)
  } else {
    return { success: false, error: 'Not in desktop mode or gitReset not available' }
  }
}

export default {
  isDesktop,
  applyFileProposal,
  createPullRequest,
  getWorkspacePath,
  cloneRepository,
  readFile,
  writeFile,
  getFileTree,
  getGitStatus,
  gitReset
}

