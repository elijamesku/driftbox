/**
 * File Proposals utilities for IDE
 * Types and helper functions for managing AI-generated file proposals
 */

import { getApiEndpoint } from '@/utils/apiEndpoint'
import { isDesktop, readFile } from '@/utils/desktopBridge'

// ========== Types ==========

export type ProposalState = 'pending' | 'accepted' | 'rejected'

export interface FileProposal {
  path: string
  action: 'create' | 'edit' | 'delete'
  oldContent?: string
  newContent?: string
  description?: string
}

export interface ProposalContext {
  selectedRepo: { id: number; name: string; full_name: string } | null
  token: string | null
  githubToken: string | null
}

// ========== Helper Functions ==========

/**
 * Fetch existing file content for a proposal
 * Used to create diff view when AI proposes changes to existing files
 */
export async function fetchExistingFileContent(
  repoFullName: string,
  filePath: string,
  token: string | null
): Promise<string | null> {
  try {
    const [owner, repo] = repoFullName.split('/')
    
    if (isDesktop) {
      // Desktop: Read file locally
      const result = await readFile(owner, repo, filePath)
      if (result.success && result.content) {
        console.log(`📄 [FileProposals] Fetched existing file content (${result.content.length} chars) from local file`)
        return result.content
      }
    } else {
      // Web: Fetch from GitHub API
      if (token) {
        const response = await fetch(getApiEndpoint(`/github/repos/${owner}/${repo}/contents/${filePath}`), {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })
        
        if (response.ok) {
          const data = await response.json()
          if (data.content && data.encoding === 'base64') {
            const content = atob(data.content.replace(/\s/g, ''))
            console.log(`📄 [FileProposals] Fetched existing file content (${content.length} chars) from GitHub`)
            return content
          }
        }
      }
    }
    
    return null
  } catch (error) {
    console.error('[FileProposals] Failed to fetch existing file content:', error)
    return null
  }
}

/**
 * Enrich a proposal with existing file content for diff view
 */
export async function enrichProposalWithExistingContent(
  proposal: FileProposal,
  repoFullName: string,
  token: string | null
): Promise<FileProposal> {
  if (proposal.action === 'delete') {
    return proposal
  }
  
  const existingContent = await fetchExistingFileContent(repoFullName, proposal.path, token)
  
  if (existingContent) {
    return {
      ...proposal,
      oldContent: existingContent,
      newContent: existingContent.trim() + '\n\n' + (proposal.newContent || ''),
      action: 'edit'
    }
  }
  
  return proposal
}

/**
 * Check if all proposals have been accepted
 */
export function areAllProposalsAccepted(
  proposals: FileProposal[],
  states: Record<string, ProposalState>
): boolean {
  if (proposals.length === 0) return false
  return proposals.every(p => states[p.path] === 'accepted')
}

/**
 * Get the next pending proposal
 */
export function getNextPendingProposal(
  proposals: FileProposal[],
  states: Record<string, ProposalState>,
  excludePath?: string
): FileProposal | null {
  return proposals.find(p => 
    p.path !== excludePath && states[p.path] === 'pending'
  ) || null
}

/**
 * Filter out accepted proposals
 */
export function filterAcceptedProposals(
  proposals: FileProposal[],
  states: Record<string, ProposalState>
): FileProposal[] {
  return proposals.filter(p => states[p.path] !== 'accepted')
}

/**
 * Clean proposal states - remove entries for accepted proposals
 */
export function cleanAcceptedStates(
  states: Record<string, ProposalState>
): Record<string, ProposalState> {
  const newStates = { ...states }
  Object.keys(newStates).forEach(key => {
    if (newStates[key] === 'accepted') {
      delete newStates[key]
    }
  })
  return newStates
}
