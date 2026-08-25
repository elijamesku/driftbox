/**
 * Staging hook for easy change management
 * Provides shortcuts and utilities for staging files
 */

import { useState, useCallback } from 'react'
import { getApiEndpoint } from '@/utils/apiEndpoint'

export interface FileChange {
  path: string
  content: string
  original_content?: string  // Original content for diff
  lines_added: number
  lines_removed: number
}

/**
 * Calculate actual line additions/removals using LCS (Longest Common Subsequence)
 * This properly handles inserted/deleted lines without counting shifted lines as changes
 */
function calculateLineDiff(origLines: string[], newLines: string[]): { linesAdded: number; linesRemoved: number } {
  // Build LCS table
  const m = origLines.length
  const n = newLines.length
  
  // For very large files, use a simpler but still accurate approach
  if (m > 1000 || n > 1000) {
    // Use line-by-line comparison with a Set for large files
    const origSet = new Set(origLines)
    const newSet = new Set(newLines)
    
    // Count lines in new that aren't in original (added)
    let added = 0
    for (const line of newLines) {
      if (!origSet.has(line)) added++
    }
    
    // Count lines in original that aren't in new (removed)
    let removed = 0
    for (const line of origLines) {
      if (!newSet.has(line)) removed++
    }
    
    return { linesAdded: added, linesRemoved: removed }
  }
  
  // Standard LCS for smaller files (more accurate)
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  
  const lcsLength = dp[m][n]
  
  // Lines removed = original lines not in LCS
  // Lines added = new lines not in LCS
  return {
    linesAdded: n - lcsLength,
    linesRemoved: m - lcsLength
  }
}

export function useStaging(
  teamId: string | null, 
  repoFullName: string | null, 
  token: string | null,
  userId?: string | null,
  userName?: string | null,
  onActivityStatusChange?: (status: 'idle' | 'editing' | 'generating' | 'creating_pr') => void
) {
  const [staging, setStaging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Stage current file changes
   */
  const stageFile = useCallback(async (
    filePath: string,
    fileContent: string,
    originalContent?: string,
    metadata?: { ai_assisted?: boolean }
  ) => {
    if (!teamId || !repoFullName || !token) {
      setError('Missing team or repo information')
      return { success: false, error: 'Missing team or repo information' }
    }

    try {
      setStaging(true)
      setError(null)
      
      // Set activity status to 'generating' to warn team
      if (onActivityStatusChange) {
        onActivityStatusChange('generating')
        // Auto-reset to idle after 10 seconds if no PR is created
        setTimeout(() => {
          onActivityStatusChange('idle')
        }, 10000)
      }

      // Calculate actual line changes using LCS-based diff
      const newLines = fileContent.split('\n')
      // Handle empty originalContent correctly - split('') gives [''], not []
      const origLines = originalContent ? originalContent.split('\n') : []
      
      // Use LCS-based diff for accurate counting
      // This finds lines that are truly added vs removed, not just shifted
      const { linesAdded, linesRemoved } = calculateLineDiff(origLines, newLines)
      
      console.log(`📊 [Staging] Diff calculation for ${filePath}:`, {
        origLineCount: origLines.length,
        newLineCount: newLines.length,
        linesAdded,
        linesRemoved,
        hasOriginal: !!originalContent
      })
      
      console.log(`🚀 [Staging] Sending staging request for: ${filePath}`)
      console.log(`🚀 [Staging] Content preview (first 100 chars):`, fileContent.substring(0, 100))
      
      const response = await fetch(
        getApiEndpoint(`/teams/${teamId}/staging/stage`),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            repo_full_name: repoFullName,
            user_id: userId,
            user_name: userName,
            files: [{
              path: filePath,
              content: fileContent,
              original_content: originalContent || '',
              lines_added: linesAdded,
              lines_removed: linesRemoved
            }],
            metadata
          })
        }
      )

      if (response.ok) {
        const data = await response.json()
        return { success: true, ...data }
      } else {
        const errorData = await response.json()
        setError(errorData.detail || 'Failed to stage file')
        return { success: false, error: errorData.detail }
      }
    } catch (err: any) {
      setError(err.message)
      return { success: false, error: err.message }
    } finally {
      setStaging(false)
    }
  }, [teamId, repoFullName, token, userId, userName, onActivityStatusChange])

  /**
   * Stage multiple files at once
   */
  const stageFiles = useCallback(async (
    files: FileChange[],
    metadata?: { ai_assisted?: boolean }
  ) => {
    console.log('🚀 [useStaging.stageFiles] Called with:', {
      filesCount: files.length,
      files: files.map(f => ({ path: f.path, contentLength: f.content?.length || 0 })),
      teamId,
      repoFullName,
      hasToken: !!token,
      userId,
      userName,
      metadata
    })
    
    if (!teamId || !repoFullName || !token) {
      console.error('❌ [useStaging.stageFiles] Missing required params:', { teamId, repoFullName, hasToken: !!token })
      setError('Missing team or repo information')
      return { success: false, error: 'Missing team or repo information' }
    }

    try {
      setStaging(true)
      setError(null)
      
      // Set activity status to 'generating' to warn team (for batch staging)
      if (onActivityStatusChange) {
        onActivityStatusChange('generating')
        // Auto-reset to idle after 10 seconds if no PR is created
        setTimeout(() => {
          onActivityStatusChange('idle')
        }, 10000)
      }

      const endpoint = getApiEndpoint(`/teams/${teamId}/staging/stage`)
      console.log('📤 [useStaging.stageFiles] Calling API:', endpoint)
      
      const requestBody = {
        repo_full_name: repoFullName,
        user_id: userId,
        user_name: userName,
        files,
        metadata
      }
      console.log('📤 [useStaging.stageFiles] Request body:', JSON.stringify(requestBody, null, 2).slice(0, 500))
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      })

      console.log('📥 [useStaging.stageFiles] Response status:', response.status, response.statusText)
      
      if (response.ok) {
        const data = await response.json()
        console.log('✅ [useStaging.stageFiles] Success:', data)
        return { success: true, ...data }
      } else {
        const errorData = await response.json()
        console.error('❌ [useStaging.stageFiles] API error:', errorData)
        setError(errorData.detail || 'Failed to stage files')
        return { success: false, error: errorData.detail }
      }
    } catch (err: any) {
      console.error('❌ [useStaging.stageFiles] Exception:', err)
      setError(err.message)
      return { success: false, error: err.message }
    } finally {
      setStaging(false)
    }
  }, [teamId, repoFullName, token, userId, userName, onActivityStatusChange])

  /**
   * Unstage changes
   */
  const unstage = useCallback(async () => {
    if (!teamId || !token) {
      setError('Missing team information')
      return { success: false, error: 'Missing team information' }
    }

    try {
      setStaging(true)
      setError(null)

      const response = await fetch(
        getApiEndpoint(`/teams/${teamId}/staging/unstage`),
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      )

      if (response.ok) {
        const data = await response.json()
        return { success: true, ...data }
      } else {
        const errorData = await response.json()
        setError(errorData.detail || 'Failed to unstage')
        return { success: false, error: errorData.detail }
      }
    } catch (err: any) {
      setError(err.message)
      return { success: false, error: err.message }
    } finally {
      setStaging(false)
    }
  }, [teamId, token])

  /**
   * Clear user's staging - use before starting a fresh generation
   * to remove stale files from previous sessions
   */
  const clearStaging = useCallback(async () => {
    if (!teamId || !token) {
      setError('Missing team information')
      return { success: false, error: 'Missing team information' }
    }

    try {
      setStaging(true)
      setError(null)

      console.log(`🧹 [Staging] Clearing staged files for team: ${teamId}`)
      
      const response = await fetch(
        getApiEndpoint(`/teams/${teamId}/staging/clear`),
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      )

      if (response.ok) {
        const data = await response.json()
        console.log(`✅ [Staging] Cleared ${data.cleared_count || 0} files`)
        return { success: true, ...data }
      } else {
        const errorData = await response.json()
        setError(errorData.detail || 'Failed to clear staging')
        return { success: false, error: errorData.detail }
      }
    } catch (err: any) {
      setError(err.message)
      return { success: false, error: err.message }
    } finally {
      setStaging(false)
    }
  }, [teamId, token])

  /**
   * Get staging status
   */
  const getStagingStatus = useCallback(async () => {
    if (!teamId || !token) return null

    try {
      const response = await fetch(
        getApiEndpoint(`/teams/${teamId}/staging`),
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      )

      if (response.ok) {
        const data = await response.json()
        return data
      }
      return null
    } catch (err) {
      console.error('Failed to get staging status:', err)
      return null
    }
  }, [teamId, token])

  return {
    stageFile,
    stageFiles,
    unstage,
    clearStaging,
    getStagingStatus,
    isStaging: staging,
    error
  }
}

