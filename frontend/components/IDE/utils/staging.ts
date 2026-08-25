/**
 * Staging utilities for IDE
 * Handles file staging for team collaboration
 */

import { getApiEndpoint } from '@/utils/apiEndpoint'

// ========== Types ==========

export interface StagingContext {
  selectedFile: { path: string } | null
  selectedRepo: { full_name: string } | null
  currentTeamId: string | null
  isStaging: boolean
  hasUnsavedChanges: boolean
  token: string | null
  githubToken: string | null
}

export interface StageFileParams {
  path: string
  content: string
  originalContent: string
  metadata: { ai_assisted: boolean }
}

// ========== Helper Functions ==========

/**
 * Check if staging can proceed
 */
export function canStage(context: StagingContext): boolean {
  return !!(
    context.selectedFile && 
    context.currentTeamId && 
    !context.isStaging && 
    context.selectedRepo
  )
}

/**
 * Get file content from editor tab if available
 */
export async function getContentFromEditor(filePath: string): Promise<string | null> {
  if (typeof window !== 'undefined' && (window as any).__getEditorContentForStaging) {
    const content = await (window as any).__getEditorContentForStaging(filePath)
    if (content !== null) {
      console.log(`📝 [Staging] Got content from editor tab: ${content.length} chars`)
      return content
    }
  }
  return null
}

/**
 * Get file content from local disk (desktop) or API (web)
 */
export async function getContentFromDisk(
  owner: string,
  repo: string,
  filePath: string,
  token: string | null
): Promise<string | null> {
  const isDesktop = typeof window !== 'undefined' && !!(window as any).electronAPI
  
  if (isDesktop && (window as any).electronAPI?.readFile) {
    const result = await (window as any).electronAPI.readFile(owner, repo, filePath)
    if (result.success) {
      return result.content
    }
    console.error('Failed to read file:', result.error)
    return null
  }
  
  // Web: Fetch from API
  const response = await fetch(
    getApiEndpoint(`/local/files/read?owner=${owner}&repo=${repo}&path=${filePath}`),
    { headers: { Authorization: `Bearer ${token}` } }
  )
  
  if (response.ok) {
    const data = await response.json()
    return data.content || ''
  }
  
  return null
}

/**
 * Get original file content from git HEAD for diff comparison
 */
export async function getOriginalFromGitHead(
  owner: string,
  repo: string,
  filePath: string,
  githubToken: string | null
): Promise<string> {
  const isDesktop = typeof window !== 'undefined' && !!(window as any).electronAPI
  
  if (isDesktop) {
    try {
      if ((window as any).electronAPI?.getFileFromGitHead) {
        const gitResult = await (window as any).electronAPI.getFileFromGitHead(owner, repo, filePath)
        if (gitResult.success && gitResult.content) {
          console.log(`📄 [Staging] Got original from git HEAD: ${gitResult.content.split('\\n').length} lines`)
          return gitResult.content
        }
        console.log(`📄 [Staging] File not in git HEAD (new file): ${filePath}`)
      } else if (githubToken) {
        // Fallback to GitHub API if Electron API not available
        const ghResponse = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
          { headers: { Authorization: `Bearer ${githubToken}` } }
        )
        if (ghResponse.ok) {
          const ghData = await ghResponse.json()
          if (ghData.content) {
            const original = atob(ghData.content.replace(/\n/g, ''))
            console.log(`📄 [Staging] Got original from GitHub API: ${original.split('\\n').length} lines`)
            return original
          }
        }
      }
    } catch (e) {
      console.log('Could not fetch original (may be new file):', e)
    }
  }
  
  return ''
}

/**
 * Check if user should be warned about no changes detected
 */
export function shouldWarnNoChanges(
  content: string,
  originalContent: string,
  gotFromEditor: boolean
): boolean {
  return content === originalContent && !gotFromEditor
}
