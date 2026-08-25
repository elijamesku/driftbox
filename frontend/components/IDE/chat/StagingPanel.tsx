'use client'

/**
 * Staging Panel - Team PR staging area
 * Shows staged changes, allows validation, integrates with auto-heal
 */

import { useState, useEffect } from 'react'
import { GitBranch, GitPullRequest, Check, AlertCircle, FileText, X, Zap, CheckCircle2, Loader2, ChevronDown, ChevronRight, Trash2, Play, Shield, Terminal, RefreshCw } from 'lucide-react'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import { createPullRequest } from '@/utils/desktopBridge'

interface StagedFile {
  path: string
  content: string
  original_content?: string
  lines_added: number
  lines_removed: number
}

interface StagedContributor {
  user_id: string
  user_name: string
  files: StagedFile[]
  staged_at: string
  lines_added: number
  lines_removed: number
  metadata?: {
    ai_assisted?: boolean
  }
}

// Simple line-by-line diff
interface DiffLine {
  type: 'same' | 'add' | 'remove'
  content: string
  lineNum?: number
}

function computeDiff(original: string, modified: string): DiffLine[] {
  const origLines = original ? original.split('\n') : []
  const newLines = modified.split('\n')
  const result: DiffLine[] = []
  
  // Simple LCS-based diff
  const maxLen = Math.max(origLines.length, newLines.length)
  let origIdx = 0
  let newIdx = 0
  
  while (origIdx < origLines.length || newIdx < newLines.length) {
    if (origIdx >= origLines.length) {
      // All remaining are additions
      result.push({ type: 'add', content: newLines[newIdx], lineNum: newIdx + 1 })
      newIdx++
    } else if (newIdx >= newLines.length) {
      // All remaining are deletions
      result.push({ type: 'remove', content: origLines[origIdx] })
      origIdx++
    } else if (origLines[origIdx] === newLines[newIdx]) {
      // Same line
      result.push({ type: 'same', content: newLines[newIdx], lineNum: newIdx + 1 })
      origIdx++
      newIdx++
    } else {
      // Different - show as remove then add
      result.push({ type: 'remove', content: origLines[origIdx] })
      origIdx++
      result.push({ type: 'add', content: newLines[newIdx], lineNum: newIdx + 1 })
      newIdx++
    }
  }
  
  return result
}

interface StagingPanelProps {
  teamId: string
  repoFullName: string
  currentUserId: string
  token: string
  onClose: () => void
  onRefreshGitStatus?: () => void
  onRefreshFileTree?: () => void
  onLockFilesForPR?: (files: string[]) => void
  onUnlockFilesFromPR?: () => void
  gitStatus?: {
    modifiedFiles?: string[]
    untrackedFiles?: string[]
    stagedFiles?: string[]
    deletedFiles?: string[]
  } | null
}

export default function StagingPanel({ 
  teamId, 
  repoFullName, 
  currentUserId,
  token,
  onClose,
  onRefreshGitStatus,
  onRefreshFileTree,
  onLockFilesForPR,
  onUnlockFilesFromPR,
  gitStatus
}: StagingPanelProps) {
  const [stagedChanges, setStagedChanges] = useState<Record<string, StagedContributor>>({})
  const [stats, setStats] = useState<any>(null)
  const [conflicts, setConflicts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  // PR creation state
  const [showPRForm, setShowPRForm] = useState(false)
  const [prTitle, setPrTitle] = useState('')
  const [prDescription, setPrDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [validating, setValidating] = useState(false)
  const [autoHealStatus, setAutoHealStatus] = useState<string | null>(null)
  const [expandedUsers, setExpandedUsers] = useState<Record<string, boolean>>({})
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({})
  
  // PR progress steps
  const [prSteps, setPrSteps] = useState<{ text: string; completed: boolean; current: boolean }[]>([])
  const [prError, setPrError] = useState<string | null>(null)
  
  // Sandbox testing state
  const [sandboxStatus, setSandboxStatus] = useState<'idle' | 'running' | 'passed' | 'failed'>('idle')
  const [sandboxResults, setSandboxResults] = useState<{
    steps: Array<{ name: string; status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'; message?: string }>
    availableCidr?: string
    errors?: string[]
    fixesApplied?: Array<{ path: string; oldContent?: string; newContent: string }>
    autoHealed?: boolean
    resourcesDetected?: Array<{ type: string; name: string; action: string; provider: string }>
    providersUsed?: string[]
    duplicateFixDetails?: {
      detailed_message?: string
      auto_fixed_vpcs?: Array<{
        file: string
        label: string
        name: string
        type: string
        description: string
        detailed_explanation?: string
        before: string
        after: string
        impact?: {
          severity: string
          would_have_broken: string[]
          fix_benefits: string[]
        }
        reference_updates?: Array<{
          file: string
          count: number
          old_reference: string
          new_reference: string
        }>
      }>
    }
  } | null>(null)
  
  const toggleExpanded = (userId: string) => {
    setExpandedUsers(prev => ({ ...prev, [userId]: !prev[userId] }))
  }
  
  const toggleFileExpanded = (userId: string, filePath: string) => {
    const key = `${userId}:${filePath}`
    setExpandedFiles(prev => ({ ...prev, [key]: !prev[key] }))
  }

  useEffect(() => {
    loadStagingData()
  }, [teamId])

  // Calculate stats from stagedChanges (more reliable than backend)
  useEffect(() => {
    const contributors = Object.values(stagedChanges)
    if (contributors.length === 0) {
      setStats({ total_files: 0, total_lines_added: 0, total_lines_removed: 0 })
      return
    }

    // Get all unique file paths
    const allFiles = new Set<string>()
    let totalLinesAdded = 0
    let totalLinesRemoved = 0

    contributors.forEach(contributor => {
      contributor.files.forEach(file => {
        allFiles.add(file.path)
        totalLinesAdded += file.lines_added || 0
        totalLinesRemoved += file.lines_removed || 0
      })
    })

    setStats({
      total_files: allFiles.size,
      total_lines_added: totalLinesAdded,
      total_lines_removed: totalLinesRemoved
    })
  }, [stagedChanges])

  const loadStagingData = async () => {
    try {
      setLoading(true)
      console.log(`📦 [StagingPanel] Loading staging data for team ${teamId}...`)
      
      // Add timeout to prevent hanging forever
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout
      
      const response = await fetch(
        getApiEndpoint(`/teams/${teamId}/staging`),
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
        }
      )
      clearTimeout(timeoutId)
      
      if (response.ok) {
        const data = await response.json()
        console.log(`✅ [StagingPanel] Loaded staging data:`, data)
        setStagedChanges(data.staged_changes || {})
        setStats(data.stats || {})
        setConflicts(data.conflicts || [])
      } else {
        console.error(`❌ [StagingPanel] API error:`, response.status, response.statusText)
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error('❌ [StagingPanel] Request timed out after 30 seconds')
      } else {
        console.error('❌ [StagingPanel] Failed to load staging data:', error)
      }
    } finally {
      setLoading(false)
    }
  }

  // Run sandbox test - validates Terraform before PR creation
  // Now uses STREAMING for real-time progress updates
  const runSandboxTest = async () => {
    const startTime = Date.now()
    setSandboxStatus('running')
    setSandboxResults({
      steps: [
        { name: 'Collecting workspace files', status: 'running' },
        { name: 'Checking for duplicate resources', status: 'pending' },
        { name: 'Validating Terraform syntax', status: 'pending' },
        { name: 'Running terraform init', status: 'pending' },
        { name: 'Running terraform plan', status: 'pending' },
        { name: 'Auto-healing errors', status: 'pending' },
        { name: 'Security policy scan', status: 'pending' },
      ]
    })

    // Abort controller for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 180000) // 3 minute timeout

    try {
      const [owner, repo] = repoFullName.split('/')
      
      // Step 1: Collect ALL .tf files from local workspace
      console.log('📁 [SandboxTest] Collecting all workspace .tf files...')
      const electronAPI = (window as any).electronAPI
      
      let workspaceFiles: { [path: string]: string } = {}
      
      if (electronAPI) {
        const fileTreeResult = await electronAPI.getFileTree(owner, repo, '')
        
        if (fileTreeResult.success && fileTreeResult.items) {
          const collectTfFiles = async (items: any[], basePath: string = ''): Promise<{ [path: string]: string }> => {
            const files: { [path: string]: string } = {}
            
            for (const item of items) {
              const itemPath = basePath ? `${basePath}/${item.name}` : item.name
              
              if (item.type === 'file' && item.name.endsWith('.tf')) {
                const fileContent = await electronAPI.readFile(owner, repo, itemPath)
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
          
          workspaceFiles = await collectTfFiles(fileTreeResult.items)
          console.log(`📦 [SandboxTest] Found ${Object.keys(workspaceFiles).length} .tf files in workspace`)
        }
      }
      
      // Step 2: Merge staged changes on top
      const stagedFilesMap: { [path: string]: string } = {}
      Object.values(stagedChanges).forEach(contributor => {
        contributor.files.forEach(file => {
          stagedFilesMap[file.path] = file.content
        })
      })
      
      const mergedFiles = { ...workspaceFiles, ...stagedFilesMap }
      console.log(`🔀 [SandboxTest] Merged ${Object.keys(mergedFiles).length} total files`)
      
      const filesForApi = Object.entries(mergedFiles).map(([path, content]) => ({ path, content }))

      // Use streaming endpoint for real-time progress
      const response = await fetch(getApiEndpoint('/terraform/sandbox-test/stream'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          repo_full_name: repoFullName,
          files: filesForApi,
          team_id: teamId,  // Include team_id for team credential sharing
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // Map step names from backend to frontend
      const stepNameMap: { [key: string]: string } = {
        fmt: "Terraform Format Check",
        validate: "Terraform Validate",
        apply: "Terraform Apply",
        'collecting': 'Collecting workspace files',
        'duplicate_check': 'Checking for duplicate resources',
        'syntax': 'Validating Terraform syntax',
        'init': 'Running terraform init',
        'plan': 'Running terraform plan',
        'auto_heal': 'Auto-healing errors',
        'security': 'Security policy scan',
      }

      // Track current state - use explicit type for mutable steps
      type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
      type Step = { name: string; status: StepStatus; message?: string }
      
      let currentSteps: Step[] = [
        { name: 'Collecting workspace files', status: 'passed', message: `${Object.keys(mergedFiles).length} files` },
        { name: 'Checking for duplicate resources', status: 'pending' },
        { name: 'Validating Terraform syntax', status: 'pending' },
        { name: 'Terraform Format Check', status: 'pending' },
        { name: 'Running terraform init', status: 'pending' },
        { name: 'Terraform Validate', status: 'pending' },
        { name: 'Running terraform plan', status: 'pending' },
        { name: 'Terraform Apply', status: 'pending' },
        { name: 'Auto-healing errors', status: 'pending' },
        { name: 'Security policy scan', status: 'pending' },
      ]
      let fixesApplied: Array<{ path: string; oldContent?: string; newContent: string }> = []
      let autoHealed = false
      let availableCidr: string | undefined

      // Read streaming response
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      if (!reader) {
        throw new Error('No response body')
      }

      // Helper function to process SSE line
      const processLine = (line: string) => {
        if (!line.startsWith('data: ')) return
        
        try {
          const data = JSON.parse(line.slice(6))
          console.log('📡 [SandboxTest] Stream event:', data)

          if (data.type === 'step') {
            // Update the appropriate step
            const stepName = stepNameMap[data.step] || data.step
            currentSteps = currentSteps.map(step => {
              if (step.name === stepName) {
                return {
                  ...step,
                  status: data.status as StepStatus,
                  message: data.message || step.message
                }
              }
              return step
            })
            
            // Store available CIDR if provided
            if (data.data?.available_cidr) {
              availableCidr = data.data.available_cidr
            }
            
            // Store duplicate fix details if provided
            let duplicateFixDetails = sandboxResults?.duplicateFixDetails
            if (data.step === 'duplicate_check' && data.data?.auto_fixed_vpcs) {
              duplicateFixDetails = {
                detailed_message: data.data.detailed_message,
                auto_fixed_vpcs: data.data.auto_fixed_vpcs
              }
            }
            
            setSandboxResults({ steps: currentSteps, availableCidr, fixesApplied, autoHealed, duplicateFixDetails })
          } else if (data.type === 'complete') {
            const durationMs = Date.now() - startTime
            
            if (data.success) {
              setSandboxStatus('passed')
              autoHealed = data.auto_healed || false
              fixesApplied = data.fixes_applied || []
              availableCidr = data.available_cidr
              
              // Update final step states
              currentSteps = currentSteps.map(step => ({
                ...step,
                status: step.status === 'running' ? 'passed' : step.status
              }))
              
              // Mark auto-heal appropriately
              currentSteps = currentSteps.map(step => {
                if (step.name === 'Auto-healing errors') {
                  return {
                    ...step,
                    status: (autoHealed ? 'passed' : 'skipped') as StepStatus,
                    message: autoHealed 
                      ? `${fixesApplied.length} fixes applied (${data.attempts} attempts)` 
                      : 'No errors to fix'
                  }
                }
                if (step.name === 'Security policy scan') {
                  return { ...step, message: `${data.security_issues || 0} issues found` }
                }
                return step
              })
              
              setSandboxResults({ 
                steps: currentSteps, 
                availableCidr, 
                fixesApplied, 
                autoHealed,
                resourcesDetected: data.resources_detected || [],
                providersUsed: data.providers_used || [],
                duplicateFixDetails: data.duplicate_fix_details || sandboxResults?.duplicateFixDetails,
              })
              
              // Persist fixes to workspace so Create PR / CI use fixed files (e.g. duplicate VPC → data source)
              if (fixesApplied.length > 0) {
                const [owner, repo] = repoFullName.split('/')
                const electronAPI = (window as any).electronAPI
                if (electronAPI?.writeFile) {
                  void (async () => {
                    for (const fix of fixesApplied) {
                      const path = fix.path
                      const newContent = fix.newContent ?? (fix as any).new_content
                      if (path && newContent != null) {
                        try {
                          const writeResult = await electronAPI.writeFile(owner, repo, path, newContent)
                          if (!writeResult?.success) {
                            console.warn('[SandboxTest] Failed to apply fix to workspace:', path, writeResult?.error)
                          }
                        } catch (e) {
                          console.warn('[SandboxTest] Error applying fix to workspace:', path, e)
                        }
                      }
                    }
                    onRefreshFileTree?.()
                    onRefreshGitStatus?.()
                  })()
                }
              }
              
              // Save to backend for team visibility (with file snapshot for deployment)
              saveSandboxRun('passed', {
                steps: currentSteps,
                availableCidr,
                autoHealed,
                fixesApplied,
                attempts: data.attempts || 1,
                securityIssues: data.security_issues || 0,
                resourcesDetected: data.resources_detected || [],
                providersUsed: data.providers_used || [],
                durationMs,
                testedFilesSnapshot: mergedFiles,  // Store exact files that were tested
              })
            } else {
              setSandboxStatus('failed')
              // Mark failed step
              const failedStepName = stepNameMap[data.failed_step] || data.failed_step
              currentSteps = currentSteps.map(step => {
                if (step.name === failedStepName) {
                  return { ...step, status: 'failed' as StepStatus }
                }
                if (step.status === 'running') {
                  return { ...step, status: 'failed' as StepStatus }
                }
                return step
              })
              
              const errors = data.errors || [data.error || 'Sandbox test failed']
              
              setSandboxResults({
                steps: currentSteps,
                errors,
                autoHealed: data.auto_healed,
                fixesApplied: data.fixes_applied,
              })
              
              // Save failed run for team visibility (with file snapshot for review)
              saveSandboxRun('failed', {
                steps: currentSteps,
                errors,
                autoHealed: data.auto_healed,
                fixesApplied: data.fixes_applied,
                attempts: data.attempts || 1,
                durationMs,
                testedFilesSnapshot: mergedFiles,  // Store files even for failed runs
              })
            }
          }
        } catch (e) {
          console.warn('[SandboxTest] Failed to parse SSE:', line)
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        
        buffer += decoder.decode(value, { stream: !done })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          processLine(line)
        }
        
        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            processLine(buffer)
          }
          break
        }
      }
    } catch (error: any) {
      clearTimeout(timeoutId)
      
      const errorMsg = error.name === 'AbortError' 
        ? 'Sandbox test timed out after 3 minutes'
        : error.message || 'Failed to connect to sandbox'
      
      setSandboxStatus('failed')
      setSandboxResults({
        steps: [
          { name: 'Collecting workspace files', status: 'failed' },
          { name: 'Checking for duplicate resources', status: 'pending' },
          { name: 'Validating Terraform syntax', status: 'pending' },
          { name: 'Running terraform init', status: 'pending' },
          { name: 'Running terraform plan', status: 'pending' },
          { name: 'Auto-healing errors', status: 'pending' },
          { name: 'Security policy scan', status: 'pending' },
        ],
        errors: [errorMsg],
      })
    }
  }

  // Save sandbox run to backend for team visibility
  const saveSandboxRun = async (
    status: 'passed' | 'failed',
    data: {
      steps?: Array<{ name: string; status: string; message?: string }>;
      errors?: string[];
      availableCidr?: string;
      autoHealed?: boolean;
      fixesApplied?: Array<any>;
      attempts?: number;
      securityIssues?: number;
      resourcesDetected?: Array<{ type: string; name: string; action: string; provider: string }>;
      providersUsed?: string[];
      durationMs?: number;
      filesTested?: number;
      testedFilesSnapshot?: { [path: string]: string };  // Snapshot of files that were tested
    }
  ) => {
    try {
      const response = await fetch(getApiEndpoint('/sandbox/runs'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repository: repoFullName,
          team_id: teamId,
          status,
          duration_ms: data.durationMs || 0,
          files_tested: data.filesTested || stagedContributors.reduce((acc, c) => acc + c.files.length, 0),
          steps: data.steps,
          errors: data.errors,
          available_cidr: data.availableCidr,
          auto_healed: data.autoHealed || false,
          fixes_applied: data.fixesApplied,
          attempts: data.attempts || 1,
          security_issues: data.securityIssues || 0,
          resources_detected: data.resourcesDetected || [],
          providers_used: data.providersUsed || [],
          tested_files_snapshot: data.testedFilesSnapshot || null,  // Store the exact files that were tested
        }),
      })
      
      if (!response.ok) {
        console.warn('[SandboxTest] Failed to save run:', await response.text())
      } else {
        console.log('[SandboxTest] Sandbox run saved for team', teamId, 'with', Object.keys(data.testedFilesSnapshot || {}).length, 'files in snapshot')
      }
    } catch (err) {
      console.warn('[SandboxTest] Error saving sandbox run:', err)
    }
  }

  // Reset sandbox state
  const resetSandbox = () => {
    setSandboxStatus('idle')
    setSandboxResults(null)
  }

  const handleUnstage = async (userId: string) => {
    try {
      const response = await fetch(
        getApiEndpoint(`/teams/${teamId}/staging/unstage?user_id=${userId}`),
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        }
      )
      
      if (response.ok) {
        // Refresh the staging data
        await loadStagingData()
      } else {
        const error = await response.json()
        alert(`Failed to unstage: ${error.detail || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Failed to unstage:', error)
      alert('Failed to unstage changes')
    }
  }

  const handleCreateTeamPR = async () => {
    if (!prTitle.trim()) {
      alert('Please enter a PR title')
      return
    }

    try {
      setCreating(true)
      setValidating(true)
      setPrError(null)
      
      const [owner, repo] = repoFullName.split('/')
      const branchName = `driftbox-team-${Date.now()}`
      
      // Files are already locked from "Create Team PR" button click
      // No need to lock again here
      
      // Initialize progress steps
      setPrSteps([
        { text: 'Preparing PR...', completed: false, current: true },
      ])
      
      // Create PR with existing validation + auto-heal flow
      const result = await createPullRequest(
        owner,
        repo,
        branchName,
        prTitle,
        token,
        (status) => {
          // Map auto-heal status to visible steps
          setAutoHealStatus(status)
          
          if (status === 'analyzing') {
            setPrSteps([
              { text: 'Preparing PR...', completed: true, current: false },
              { text: 'Analyzing Terraform errors...', completed: false, current: true },
            ])
          }
          if (status === 'generating') {
            setPrSteps([
              { text: 'Preparing PR...', completed: true, current: false },
              { text: 'Analyzing Terraform errors...', completed: true, current: false },
              { text: 'Generating fixes...', completed: false, current: true },
            ])
          }
          if (status === 'applying') {
            setPrSteps([
              { text: 'Preparing PR...', completed: true, current: false },
              { text: 'Analyzing Terraform errors...', completed: true, current: false },
              { text: 'Generating fixes...', completed: true, current: false },
              { text: 'Applying fixes...', completed: false, current: true },
            ])
          }
          if (status === 'retrying') {
            setPrSteps([
              { text: 'Preparing PR...', completed: true, current: false },
              { text: 'Analyzing Terraform errors...', completed: true, current: false },
              { text: 'Generating fixes...', completed: true, current: false },
              { text: 'Applying fixes...', completed: true, current: false },
              { text: 'Retrying validation...', completed: false, current: true },
            ])
          }
          if (status === 'success') {
            setPrSteps(prev => prev.map(s => ({ ...s, completed: true, current: false })))
          }
          if (status === 'failed') {
            setPrSteps(prev => prev.map((s, i) => i === prev.length - 1 ? { ...s, current: false } : s))
          }
        }
      )
      
      if (result.success) {
        // Mark all steps complete
        setPrSteps(prev => prev.map(step => ({ ...step, completed: true, current: false })))
        
        // Clear staging area
        await fetch(
          getApiEndpoint(`/teams/${teamId}/staging/clear`),
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
          }
        )
        
        // Auto-open PR in browser (like chat does)
        if (result.pr_url) {
          window.open(result.pr_url, '_blank')
        }
        
        // Refresh git status to clear yellow indicators (files are now committed)
        if (onRefreshGitStatus) {
          console.log('🔄 [StagingPanel] Refreshing git status after PR creation')
          onRefreshGitStatus()
        }
        
        // Refresh file tree
        if (onRefreshFileTree) {
          console.log('🔄 [StagingPanel] Refreshing file tree after PR creation')
          onRefreshFileTree()
        }
        
        // After PR is merged on GitHub, we need to sync. 
        // Trigger a git pull in 3 seconds (giving time for GitHub to process)
        // Then again in 10 seconds in case user merges shortly after
        const [ownerSync, repoSync] = repoFullName.split('/')
        if (window.electronAPI?.gitPull) {
          // Get GitHub token for authenticated pull
          const tokenResult = await window.electronAPI?.getGitHubToken?.()
          const githubToken = tokenResult?.token
          
          setTimeout(async () => {
            console.log('🔄 [StagingPanel] Running auto-sync (3s post-PR)')
            try {
              const pullResult = await window.electronAPI!.gitPull(ownerSync, repoSync, 'main', githubToken)
              if (pullResult.success) {
                console.log('✅ [StagingPanel] Post-PR sync successful')
                onRefreshGitStatus?.()
                onRefreshFileTree?.()
              }
            } catch (e) {
              console.log('⚠️ [StagingPanel] Post-PR sync skipped:', e)
            }
          }, 3000)
          
          setTimeout(async () => {
            console.log('🔄 [StagingPanel] Running auto-sync (10s post-PR)')
            try {
              const pullResult = await window.electronAPI!.gitPull(ownerSync, repoSync, 'main', githubToken)
              if (pullResult.success) {
                console.log('✅ [StagingPanel] Post-PR sync successful')
                onRefreshGitStatus?.()
                onRefreshFileTree?.()
              }
            } catch (e) {
              console.log('⚠️ [StagingPanel] Post-PR sync skipped:', e)
            }
          }, 10000)
        }
        
        // Close panel after short delay so user sees success
        setTimeout(() => {
          onClose()
        }, 500)
      } else {
        setPrError(result.error || 'Failed to create PR')
      }
    } catch (error: any) {
      console.error('Failed to create team PR:', error)
      setPrError(error.message || 'Unknown error')
    } finally {
      setCreating(false)
      setValidating(false)
      setAutoHealStatus(null)
      
      // Always unlock files when PR creation is done (success or failure)
      if (onUnlockFilesFromPR) {
        console.log('🔓 Unlocking files after PR creation')
        onUnlockFilesFromPR()
      }
    }
  }

  const getUserColor = (userId: string) => {
    const colors = ['bg-purple-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-pink-500']
    const index = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return colors[index % colors.length]
  }

  const stagedContributors = Object.values(stagedChanges)
  const myStaged = stagedChanges[currentUserId]

  return (
    <div className="fixed top-[35px] bottom-[24px] right-0 bg-black/95 backdrop-blur-md border-l border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.5)] z-50 flex flex-col" style={{ width: '360px' }}>
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-purple-500/20 flex items-center justify-center">
            <GitBranch className="w-4 h-4 text-purple-400" />
          </div>
          <h2 className="text-sm font-semibold text-white/90">Team Staging</h2>
        </div>
        <button
          onClick={onClose}
          className="p-2 text-white/40 hover:text-white hover:bg-white/10 transition-all duration-200 rounded-lg"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stats Summary */}
      {stats && (
        <div className="px-4 py-4 border-b border-white/5">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/5 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-white/90">{stats.total_files || 0}</div>
              <div className="text-[10px] text-white/40 uppercase tracking-wider mt-0.5">Files</div>
            </div>
            <div className="bg-emerald-500/10 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-emerald-400">+{stats.total_lines_added || 0}</div>
              <div className="text-[10px] text-white/40 uppercase tracking-wider mt-0.5">Added</div>
            </div>
            <div className="bg-red-500/10 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-red-400">-{stats.total_lines_removed || 0}</div>
              <div className="text-[10px] text-white/40 uppercase tracking-wider mt-0.5">Removed</div>
            </div>
          </div>
        </div>
      )}

      {/* Conflicts Warning */}
      {conflicts.length > 0 && (
        <div className="mx-4 mt-3 p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <div className="text-xs font-medium text-amber-300">
                {conflicts.length} file{conflicts.length > 1 ? 's' : ''} edited by multiple people
              </div>
              {conflicts.slice(0, 2).map((conflict, idx) => (
                <div key={idx} className="text-xs text-amber-200/60 mt-1">
                  {conflict.file}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Staged Contributors */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="text-[10px] font-semibold text-white/40 mb-3 uppercase tracking-widest">
          Staged Changes ({stagedContributors.length})
        </div>

        {loading ? (
          <div className="text-center py-12 text-white/40">
            <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
            <p className="text-sm">Loading...</p>
          </div>
        ) : stagedContributors.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-white/5 mx-auto mb-4 flex items-center justify-center">
              <GitBranch className="w-8 h-8 text-white/20" />
            </div>
            <p className="text-sm text-white/60">No staged changes yet</p>
            <p className="text-xs text-white/30 mt-1">Stage your changes to start building a team PR</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {stagedContributors.map(contributor => {
              const isMe = contributor.user_id === currentUserId
              const isExpanded = expandedUsers[contributor.user_id] || false
              
              return (
                <div
                  key={contributor.user_id}
                  className="rounded-xl border border-white/10 bg-white/5 hover:border-white/20 transition-all duration-200 overflow-hidden"
                >
                  {/* Header - Clickable to expand */}
                  <div 
                    className="p-3.5 flex items-center gap-3 cursor-pointer hover:bg-white/5 transition-all duration-200"
                    onClick={() => toggleExpanded(contributor.user_id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-white/40 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-white/40 flex-shrink-0" />
                    )}
                    
                    <div className={`w-9 h-9 rounded-full ${getUserColor(contributor.user_id)} flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 shadow-lg`}>
                      {contributor.user_name[0].toUpperCase()}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white/90 truncate">
                          {contributor.user_name}
                          {isMe && <span className="text-purple-400"> (You)</span>}
                        </span>
                        {contributor.metadata?.ai_assisted && (
                          <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] rounded-md font-medium">
                            AI
                          </span>
                        )}
                      </div>
                      
                      {!isExpanded && (
                        <div className="text-xs text-white/40 mt-0.5">
                          {contributor.files.length} file{contributor.files.length !== 1 ? 's' : ''} • 
                          <span className="text-emerald-400 ml-1">+{contributor.lines_added}</span>
                          <span className="text-red-400 ml-1">-{contributor.lines_removed}</span>
                        </div>
                      )}
                    </div>
                    
                    {isMe && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleUnstage(contributor.user_id)
                        }}
                        className="text-xs text-white/40 hover:text-red-400 transition-all duration-200 px-2.5 py-1.5 rounded-lg hover:bg-red-500/10"
                      >
                        Unstage
                      </button>
                    )}
                  </div>
                  
                  {/* Expanded Content - File List */}
                  {isExpanded && (
                    <div className="border-t border-white/5 bg-black/30">
                      <div className="px-3.5 py-3">
                        <div className="flex items-center justify-between text-xs text-white/40 mb-2.5">
                          <span>{contributor.files.length} file{contributor.files.length !== 1 ? 's' : ''} staged</span>
                          <span>
                            <span className="text-emerald-400">+{contributor.lines_added}</span>
                            <span className="text-red-400 ml-2">-{contributor.lines_removed}</span>
                          </span>
                        </div>
                        
                        <div className="space-y-1.5">
                          {contributor.files.map((file, idx) => {
                            const fileKey = `${contributor.user_id}:${file.path}`
                            const isFileExpanded = expandedFiles[fileKey] || false
                            
                            return (
                              <div key={idx} className="rounded-lg bg-white/5 overflow-hidden">
                                {/* File Header */}
                                <div 
                                  className="flex items-center justify-between p-2.5 hover:bg-white/5 group cursor-pointer transition-all duration-200"
                                  onClick={() => toggleFileExpanded(contributor.user_id, file.path)}
                                >
                                  <div className="flex items-center gap-2 text-xs text-white/70 min-w-0">
                                    {isFileExpanded ? (
                                      <ChevronDown className="w-3 h-3 text-white/40 flex-shrink-0" />
                                    ) : (
                                      <ChevronRight className="w-3 h-3 text-white/40 flex-shrink-0" />
                                    )}
                                    <FileText className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                                    <span className="truncate">{file.path}</span>
                                  </div>
                                  
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-emerald-400">+{file.lines_added}</span>
                                    <span className="text-xs text-red-400">-{file.lines_removed}</span>
                                    
                                    {isMe && (
                                      <button
                                        onClick={async (e) => {
                                          e.stopPropagation()
                                          // Actually unstage this user's changes
                                          await handleUnstage(contributor.user_id)
                                        }}
                                        className="opacity-0 group-hover:opacity-100 p-1.5 text-white/40 hover:text-red-400 transition-all duration-200 rounded-md hover:bg-red-500/10"
                                        title="Remove this file"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                                
                                {/* File Content Preview - ONLY show changed lines */}
                                {isFileExpanded && file.content && (() => {
                                  // Check if we have original content for proper diff
                                  if (!file.original_content) {
                                    return (
                                      <div className="border-t border-[#3a3a3a] bg-[#0d0d0d] px-3 py-4">
                                        <p className="text-xs text-yellow-400 mb-2">⚠️ Re-stage to see accurate diff</p>
                                        <p className="text-xs text-gray-500">Staged before diff tracking was enabled</p>
                                      </div>
                                    )
                                  }
                                  
                                  const diffLines = computeDiff(file.original_content, file.content)
                                  // Filter to only show changed lines (additions and deletions)
                                  const changedLines = diffLines.filter(l => l.type !== 'same')
                                  
                                  if (changedLines.length === 0) {
                                    return (
                                      <div className="border-t border-[#3a3a3a] bg-[#0d0d0d] px-3 py-4 text-center">
                                        <p className="text-xs text-gray-500">No changes detected</p>
                                      </div>
                                    )
                                  }
                                  
                                  return (
                                    <div className="border-t border-[#3a3a3a] bg-[#0d0d0d]">
                                      <pre className="text-xs overflow-x-auto max-h-64 overflow-y-auto font-mono">
                                        {changedLines.map((line, idx) => {
                                          const isAdd = line.type === 'add'
                                          const isRemove = line.type === 'remove'
                                          
                                          return (
                                            <div 
                                              key={idx} 
                                              className={`flex ${isAdd ? 'bg-green-500/20 border-l-2 border-green-500' : 'bg-red-500/20 border-l-2 border-red-500'}`}
                                            >
                                              <span className="text-gray-600 select-none w-8 text-right pr-2 flex-shrink-0 bg-black/20">
                                                {line.lineNum || ''}
                                              </span>
                                              <span className={`w-4 select-none text-center font-bold ${isAdd ? 'text-green-400' : 'text-red-400'}`}>
                                                {isAdd ? '+' : '-'}
                                              </span>
                                              <span className={`flex-1 whitespace-pre pr-3 ${isAdd ? 'text-green-300' : 'text-red-300'}`}>
                                                {line.content || ' '}
                                              </span>
                                            </div>
                                          )
                                        })}
                                      </pre>
                                    </div>
                                  )
                                })()}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-white/5 space-y-2.5">
        {!showPRForm ? (
          <>
            {/* Sandbox Test Results */}
            {sandboxResults && (
              <div className={`p-3 rounded-xl border ${
                sandboxStatus === 'passed' ? 'bg-emerald-500/5 border-emerald-500/20' :
                sandboxStatus === 'failed' ? 'bg-red-500/5 border-red-500/20' :
                'bg-blue-500/5 border-blue-500/20'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-white/60" />
                    <span className="text-xs font-semibold text-white/80">Sandbox Test</span>
                  </div>
                  {sandboxStatus !== 'running' && (
                    <button
                      onClick={resetSandbox}
                      className="text-[10px] text-white/40 hover:text-white/60 flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Reset
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {sandboxResults.steps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      {step.status === 'running' ? (
                        <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                      ) : step.status === 'passed' ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      ) : step.status === 'failed' ? (
                        <AlertCircle className="w-3 h-3 text-red-400" />
                      ) : step.status === 'skipped' ? (
                        <div className="w-3 h-3 rounded-full bg-white/10 flex items-center justify-center">
                          <span className="text-[8px] text-white/40">-</span>
                        </div>
                      ) : (
                        <div className="w-3 h-3 rounded-full border border-white/20" />
                      )}
                      <span className={`flex-1 ${
                        step.status === 'passed' ? 'text-emerald-400' :
                        step.status === 'failed' ? 'text-red-400' :
                        step.status === 'running' ? 'text-blue-300' : 
                        step.status === 'skipped' ? 'text-white/30' : 'text-white/40'
                      }`}>
                        {step.name}
                      </span>
                      {step.message && (
                        <span className="text-white/40 text-[10px]">{step.message}</span>
                      )}
                    </div>
                  ))}
                </div>
                {/* Show applied fixes if auto-heal ran */}
                {sandboxResults.autoHealed && sandboxResults.fixesApplied && sandboxResults.fixesApplied.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-amber-500/20">
                    <div className="flex items-center gap-1 mb-1">
                      <Zap className="w-3 h-3 text-amber-400" />
                      <span className="text-[10px] font-medium text-amber-400">
                        Auto-healed {sandboxResults.fixesApplied.length} file(s)
                      </span>
                    </div>
                    <div className="space-y-1">
                      {sandboxResults.fixesApplied.map((fix, idx) => (
                        <div key={idx} className="text-[10px] text-white/50 flex items-center gap-1">
                          <FileText className="w-2.5 h-2.5" />
                          <code className="bg-amber-500/10 px-1 rounded">{fix.path}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {sandboxResults.errors && sandboxResults.errors.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-red-500/20">
                    {sandboxResults.errors.map((err, idx) => (
                      <p key={idx} className="text-xs text-red-400">{err}</p>
                    ))}
                  </div>
                )}
                {sandboxResults.availableCidr && (
                  <div className="mt-2 pt-2 border-t border-emerald-500/20">
                    <p className="text-[10px] text-emerald-400">
                      ✓ Available CIDR: <code className="bg-emerald-500/10 px-1 rounded">{sandboxResults.availableCidr}</code>
                    </p>
                  </div>
                )}
                
                {/* Show detailed duplicate fix information */}
                {sandboxResults.duplicateFixDetails && sandboxResults.duplicateFixDetails.auto_fixed_vpcs && sandboxResults.duplicateFixDetails.auto_fixed_vpcs.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-amber-500/30">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-semibold text-amber-400">
                        Critical Infrastructure Conflict Auto-Resolved
                      </span>
                    </div>
                    <div className="space-y-4">
                      {sandboxResults.duplicateFixDetails.auto_fixed_vpcs.map((fix, idx) => (
                        <div key={idx} className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 rounded-lg p-4 border border-amber-500/30 shadow-lg">
                          {/* Header */}
                          <div className="mb-3 pb-3 border-b border-amber-500/20">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-bold text-amber-300">
                                Fix #{idx + 1}: <code className="bg-amber-500/20 px-2 py-0.5 rounded text-amber-200">{fix.file}</code>
                              </p>
                              {fix.impact && (
                                <span className={`text-[10px] font-bold px-2 py-1 rounded ${
                                  fix.impact.severity === 'critical' ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                                  'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                                }`}>
                                  {fix.impact.severity.toUpperCase()}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-white/80 font-medium">
                              Resource: <code className="bg-amber-500/10 px-1.5 py-0.5 rounded text-amber-200">{fix.label}</code> 
                              <span className="text-white/50"> (VPC Name: </span>
                              <code className="bg-amber-500/10 px-1.5 py-0.5 rounded text-amber-200">{fix.name}</code>
                              <span className="text-white/50">)</span>
                            </p>
                          </div>
                          
                          {/* Impact Summary */}
                          {fix.impact && (
                            <div className="mb-4 space-y-3">
                              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                                <p className="text-[10px] font-bold text-red-300 mb-2 flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" />
                                  What Would Have Broken:
                                </p>
                                <ul className="space-y-1.5">
                                  {fix.impact.would_have_broken.map((issue, issueIdx) => (
                                    <li key={issueIdx} className="text-[10px] text-red-200/90 flex items-start gap-2">
                                      <span className="text-red-400 mt-0.5">-</span>
                                      <span>{issue}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              
                              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                                <p className="text-[10px] font-bold text-emerald-300 mb-2 flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Benefits of Auto-Fix:
                                </p>
                                <ul className="space-y-1.5">
                                  {fix.impact.fix_benefits.map((benefit, benefitIdx) => (
                                    <li key={benefitIdx} className="text-[10px] text-emerald-200/90 flex items-start gap-2">
                                      <span className="text-emerald-400 mt-0.5">+</span>
                                      <span>{benefit}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          )}
                          
                          {/* Detailed Explanation */}
                          {fix.detailed_explanation && (
                            <div className="mb-4 bg-black/20 rounded-lg p-3 border border-white/10">
                              <div 
                                className="text-[10px] text-white/80 prose prose-invert max-w-none"
                                dangerouslySetInnerHTML={{ 
                                  __html: fix.detailed_explanation
                                    .replace(/\n/g, '<br/>')
                                    .replace(/```hcl\n([\s\S]*?)```/g, '<pre class="bg-black/40 p-2 rounded border border-white/10 overflow-x-auto my-2"><code class="text-[9px] text-emerald-300">$1</code></pre>')
                                    .replace(/`([^`]+)`/g, '<code class="bg-white/10 px-1 rounded text-amber-200">$1</code>')
                                    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
                                    .replace(/### (.*)/g, '<h3 class="text-xs font-bold text-amber-300 mt-3 mb-2">$1</h3>')
                                    .replace(/## (.*)/g, '<h2 class="text-sm font-bold text-amber-200 mt-4 mb-3">$1</h2>')
                                }}
                              />
                            </div>
                          )}
                          
                          {/* Code Changes */}
                          <div className="space-y-3">
                            <div>
                              <p className="text-[10px] font-bold text-red-400 mb-2 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                Before (Resource Block - Would Create Duplicate):
                              </p>
                              <pre className="text-[9px] bg-black/40 p-3 rounded-lg border-2 border-red-500/30 overflow-x-auto">
                                <code className="text-red-300 font-mono">{fix.before}</code>
                              </pre>
                            </div>
                            
                            <div>
                              <p className="text-[10px] font-bold text-emerald-400 mb-2 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                After (Data Source - References Existing):
                              </p>
                              <pre className="text-[9px] bg-black/40 p-3 rounded-lg border-2 border-emerald-500/30 overflow-x-auto">
                                <code className="text-emerald-300 font-mono">{fix.after}</code>
                              </pre>
                            </div>
                            
                            {fix.reference_updates && fix.reference_updates.length > 0 && (
                              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                                <p className="text-[10px] font-bold text-blue-400 mb-2 flex items-center gap-1">
                                  <FileText className="w-3 h-3" />
                                  Reference Updates:
                                </p>
                                <div className="space-y-2">
                                  {fix.reference_updates.map((ref, refIdx) => (
                                    <div key={refIdx} className="bg-black/20 rounded p-2 border border-blue-500/10">
                                      <p className="text-[9px] text-white/70 mb-1">
                                        <span className="text-white/50">File:</span> <code className="bg-blue-500/20 px-1.5 py-0.5 rounded text-blue-200">{ref.file}</code>
                                      </p>
                                      <div className="flex items-center gap-2 text-[9px]">
                                        <code className="bg-red-500/20 px-1.5 py-0.5 rounded text-red-300 border border-red-500/30">{ref.old_reference}</code>
                                        <span className="text-white/40">→</span>
                                        <code className="bg-emerald-500/20 px-1.5 py-0.5 rounded text-emerald-300 border border-emerald-500/30">{ref.new_reference}</code>
                                        <span className="text-white/50 ml-auto">({ref.count} occurrence{ref.count !== 1 ? 's' : ''})</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Sandbox Run Saved Notice */}
                {(sandboxStatus === 'passed' || sandboxStatus === 'failed') && (
                  <div className="mt-3 px-3 py-2 rounded-lg text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                    <span>Saved to team sandbox • Admins can review in Dashboard → Sandbox</span>
                  </div>
                )}
              </div>
            )}

            {/* Test in Sandbox Button */}
            <button
              onClick={runSandboxTest}
              disabled={stagedContributors.length === 0 || sandboxStatus === 'running'}
              className={`w-full px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${
                sandboxStatus === 'passed' 
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                  : sandboxStatus === 'failed'
                  ? 'bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20'
                  : 'bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {sandboxStatus === 'running' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Testing...
                </>
              ) : sandboxStatus === 'passed' ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Sandbox Passed ✓
                </>
              ) : sandboxStatus === 'failed' ? (
                <>
                  <AlertCircle className="w-4 h-4" />
                  Retry Sandbox Test
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Test in Sandbox
                </>
              )}
            </button>

            {/* Create Team PR Button - only enabled after sandbox passes */}
            <button
              onClick={() => {
                // Lock files IMMEDIATELY when user clicks "Create Team PR" (before form)
                const stagedFilePaths = Object.values(stagedChanges).flatMap(c => c.files.map(f => f.path))
                const gitModifiedFiles = gitStatus?.modifiedFiles || []
                const gitUntrackedFiles = gitStatus?.untrackedFiles || []
                const gitStagedFiles = gitStatus?.stagedFiles || []
                const allFilesToLock = [...new Set([
                  ...stagedFilePaths,
                  ...gitModifiedFiles,
                  ...gitUntrackedFiles,
                  ...gitStagedFiles
                ])]
                if (onLockFilesForPR && allFilesToLock.length > 0) {
                  console.log('🔒 Locking files on "Create Team PR" click:', allFilesToLock)
                  onLockFilesForPR(allFilesToLock)
                }
                setShowPRForm(true)
              }}
              disabled={stagedContributors.length === 0 || sandboxStatus !== 'passed'}
              className={`w-full px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 shadow-lg ${
                sandboxStatus === 'passed'
                  ? 'bg-white text-black hover:bg-white/90'
                  : 'bg-white/20 text-white/40 cursor-not-allowed'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <GitPullRequest className="w-4 h-4" />
              Create Team PR
              {sandboxStatus !== 'passed' && (
                <span className="text-[10px] ml-1">(Run sandbox first)</span>
              )}
            </button>
            
            <button
              onClick={onClose}
              className="w-full px-4 py-3 bg-transparent border border-white/10 text-white/70 rounded-xl text-sm font-medium hover:bg-white/5 hover:border-white/20 transition-all duration-200"
            >
              Close
            </button>
          </>
        ) : (
          <div className="space-y-3">
            {/* Risk Assessment Banner */}
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-amber-500/20">
                  <Shield className="h-4 w-4 text-amber-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-amber-400">Team Approval Required</p>
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">
                      {sandboxResults?.errors && sandboxResults.errors.length > 0 ? 'High' : 'Medium'} Risk
                    </span>
                  </div>
                  <p className="text-[10px] text-amber-400/70 mt-0.5">
                    This PR will require approval from a team member before deployment
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-white/40 mb-1.5 uppercase tracking-wider">
                PR Title
              </label>
              <input
                type="text"
                value={prTitle}
                onChange={(e) => setPrTitle(e.target.value)}
                placeholder="feat: Add new infrastructure"
                className="w-full px-3.5 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:bg-white/10 transition-all duration-200"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-white/40 mb-1.5 uppercase tracking-wider">
                Description
              </label>
              <textarea
                value={prDescription}
                onChange={(e) => setPrDescription(e.target.value)}
                placeholder="Describe changes..."
                rows={3}
                className="w-full px-3.5 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:bg-white/10 transition-all duration-200 resize-none"
              />
            </div>

            {/* PR Progress Steps */}
            {prSteps.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {prSteps.map((step, idx) => (
                  <div 
                    key={idx}
                    className={`flex items-center gap-2.5 text-xs p-2.5 rounded-xl transition-all duration-200 ${
                      step.completed 
                        ? 'bg-emerald-500/10 text-emerald-400' 
                        : step.current 
                          ? 'bg-blue-500/10 text-blue-300 border border-blue-500/20' 
                          : 'bg-white/5 text-white/40'
                    }`}
                  >
                    {step.completed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    ) : step.current ? (
                      <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-white/20 flex-shrink-0" />
                    )}
                    <span>{step.text}</span>
                  </div>
                ))}
              </div>
            )}
            
            {/* Error display */}
            {prError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                <div className="flex items-center gap-2.5 text-xs text-red-400">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{prError}</span>
                </div>
              </div>
            )}

            <div className="flex gap-2.5">
              <button
                onClick={() => {
                  // Unlock files when user clicks "Back" (cancelled PR)
                  if (onUnlockFilesFromPR) {
                    console.log('🔓 Unlocking files on "Back" click')
                    onUnlockFilesFromPR()
                  }
                  setShowPRForm(false)
                }}
                disabled={creating}
                className="flex-1 px-4 py-3 bg-transparent border border-white/10 text-white/70 rounded-xl text-sm font-medium hover:bg-white/5 hover:border-white/20 transition-all duration-200 disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={handleCreateTeamPR}
                disabled={creating || !prTitle.trim()}
                className="flex-1 px-4 py-3 bg-white text-black rounded-xl text-sm font-semibold hover:bg-white/90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Create
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

