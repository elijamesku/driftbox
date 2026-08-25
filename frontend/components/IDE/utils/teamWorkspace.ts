/**
 * Team Workspace utilities for IDE
 * Handles team repository fetching and workspace management
 */

import { getApiEndpoint } from '@/utils/apiEndpoint'

// ========== Types ==========

export interface TeamRepo {
  repo_full_name: string
  full_name?: string
}

// ========== Functions ==========

/**
 * Fetch team repositories from the API
 */
export async function fetchTeamRepos(
  teamId: string,
  token: string
): Promise<string[]> {
  try {
    const apiUrl = getApiEndpoint(`/teams/${teamId}/repositories`)
    
    const response = await fetch(apiUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    if (response.ok) {
      const repos: TeamRepo[] = await response.json()
      return repos.map(r => r.repo_full_name || r.full_name || '')
    }
    
    return []
  } catch (error) {
    console.error('Failed to fetch team repos:', error)
    return []
  }
}

/**
 * Check if a repo is in the team workspace
 */
export function isRepoInTeam(repoFullName: string, teamRepos: string[]): boolean {
  return teamRepos.includes(repoFullName)
}

/**
 * Get the team workspace entry ID from sessionStorage
 */
export function getTeamWorkspaceEntryId(): string | null {
  return sessionStorage.getItem('enter_team_workspace')
}

/**
 * Clear the team workspace entry ID
 */
export function clearTeamWorkspaceEntry(): void {
  sessionStorage.removeItem('enter_team_workspace')
}

/**
 * Handle entering a team workspace
 * Returns the repo full names in the team
 */
export async function handleTeamWorkspaceEntry(
  teamId: string,
  token: string,
  setCurrentTeamId: (id: string) => void,
  setTeamRepoNames: (repos: string[]) => void,
  selectedRepo: { full_name: string } | null,
  setSelectedRepo: (repo: null) => void,
  setSelectedFile: (file: null) => void
): Promise<void> {
  clearTeamWorkspaceEntry()
  setCurrentTeamId(teamId)
  
  const repoFullNames = await fetchTeamRepos(teamId, token)
  setTeamRepoNames(repoFullNames)
  console.log('✅ Entered team workspace:', teamId, 'with', repoFullNames.length, 'repos')
  
  // If current repo is not in team, clear it
  if (selectedRepo && !isRepoInTeam(selectedRepo.full_name, repoFullNames)) {
    setSelectedRepo(null)
    setSelectedFile(null)
  }
}
