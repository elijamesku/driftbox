'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useGitHub } from '@/contexts/GitHubContext'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import {
  GitCommit,
  GitBranch,
  GitPullRequest,
  GitMerge,
  User,
  Calendar,
  Clock,
  FileText,
  FilePlus,
  FileMinus,
  FileEdit,
  Shield,
  Lock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronRight,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  RefreshCw,
  Loader2,
  Eye,
  MessageSquare,
  Activity,
  Layers,
  Tag,
  History,
  Search,
  Filter,
  X,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Info,
  Copy,
  Check,
  Code,
  Terminal,
  AlertCircle,
  Zap,
  FileCheck,
  Plus,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

// Types
interface GitHubCommit {
  sha: string
  commit: {
    author: {
      name: string
      email: string
      date: string
    }
    committer: {
      name: string
      email: string
      date: string
    }
    message: string
    tree: {
      sha: string
    }
  }
  author: {
    login: string
    avatar_url: string
    html_url: string
  } | null
  committer: {
    login: string
    avatar_url: string
  } | null
  html_url: string
  stats?: {
    additions: number
    deletions: number
    total: number
  }
  files?: Array<{
    sha: string
    filename: string
    status: 'added' | 'removed' | 'modified' | 'renamed'
    additions: number
    deletions: number
    changes: number
    patch?: string
  }>
  parents: Array<{
    sha: string
  }>
  repository?: string
  repoFullName?: string
}

interface SecurityFinding {
  severity: 'critical' | 'high' | 'medium' | 'low'
  rule: string
  file: string
  line?: number
  message: string
}

interface PolicyCheck {
  name: string
  status: 'passed' | 'failed' | 'warning' | 'skipped'
  category: string
  details?: string
}

// Severity colors
const severityColors = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
}

// Status colors
const statusColors = {
  passed: '#22c55e',
  failed: '#ef4444',
  warning: '#eab308',
  skipped: '#666666',
}

// File status icons
const fileStatusIcon = {
  added: FilePlus,
  removed: FileMinus,
  modified: FileEdit,
  renamed: FileText,
}

const fileStatusColor = {
  added: '#22c55e',
  removed: '#ef4444',
  modified: '#eab308',
  renamed: '#3b82f6',
}

// Fetch function for commits
const fetchAllCommits = async (repos: any[], githubToken: string): Promise<GitHubCommit[]> => {
  if (!repos || repos.length === 0 || !githubToken) {
    return []
  }

  const allCommits: GitHubCommit[] = []

  for (const repo of repos.slice(0, 10)) { // Limit to first 10 repos for performance
    try {
      const response = await fetch(
        `https://api.github.com/repos/${repo.full_name}/commits?per_page=15`,
        {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      )
      if (response.ok) {
        const repoCommits = await response.json()
        const commitsWithRepo = repoCommits.map((c: GitHubCommit) => ({
          ...c,
          repository: repo.name,
          repoFullName: repo.full_name,
        }))
        allCommits.push(...commitsWithRepo)
      }
    } catch (error) {
      console.error(`Error fetching commits for ${repo.full_name}:`, error)
    }
  }

  // Sort by date (most recent first)
  allCommits.sort((a, b) => 
    new Date(b.commit.author.date).getTime() - new Date(a.commit.author.date).getTime()
  )

  return allCommits
}

// Fetch function for commit details
const fetchCommitDetails = async (
  repoFullName: string, 
  sha: string, 
  githubToken: string,
  repository: string
): Promise<GitHubCommit> => {
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/commits/${sha}`,
    {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    }
  )
  if (!response.ok) {
    throw new Error('Failed to fetch commit details')
  }
  const details = await response.json()
  return {
    ...details,
    repository,
    repoFullName,
  }
}

export default function ChangesPage() {
  const { user } = useAuth()
  const { repos, githubToken } = useGitHub()
  const queryClient = useQueryClient()
  const [selectedCommit, setSelectedCommit] = useState<GitHubCommit | null>(null)
  const [isDarkMode, setIsDarkMode] = useState(true)

  // Load theme preference and watch for changes
  useEffect(() => {
    const checkTheme = () => {
      const hasLightMode = document.documentElement.classList.contains('light-mode')
      const savedTheme = localStorage.getItem('driftbox-theme')
      setIsDarkMode(!hasLightMode && savedTheme !== 'light')
    }
    
    checkTheme()
    
    // Watch for class changes on document
    const observer = new MutationObserver(checkTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    
    // Also listen for storage changes
    window.addEventListener('storage', checkTheme)
    
    return () => {
      observer.disconnect()
      window.removeEventListener('storage', checkTheme)
    }
  }, [])

  const [activeTab, setActiveTab] = useState<'story' | 'files' | 'security' | 'policy' | 'activity'>('story')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterRepo, setFilterRepo] = useState<string | null>(null)
  const [securityFindings, setSecurityFindings] = useState<SecurityFinding[]>([])
  const [policyChecks, setPolicyChecks] = useState<PolicyCheck[]>([])
  const [copiedSha, setCopiedSha] = useState(false)
  const [textSize, setTextSize] = useState<'sm' | 'md' | 'lg'>('sm')
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())

  // Toggle file expansion
  const toggleFileExpansion = (filename: string) => {
    setExpandedFiles(prev => {
      const newSet = new Set(prev)
      if (newSet.has(filename)) {
        newSet.delete(filename)
      } else {
        newSet.add(filename)
      }
      return newSet
    })
  }

  // Expand/collapse all files
  const expandAllFiles = () => {
    if (commitDetails?.files) {
      setExpandedFiles(new Set(commitDetails.files.map(f => f.filename)))
    }
  }

  const collapseAllFiles = () => {
    setExpandedFiles(new Set())
  }

  // TanStack Query for commits - cached and "hot"
  const { 
    data: commits = [], 
    isLoading: loading,
    refetch: refetchCommits 
  } = useQuery({
    queryKey: ['github-commits', repos?.map(r => r.full_name).join(',')],
    queryFn: () => fetchAllCommits(repos || [], githubToken || ''),
    enabled: !!repos && repos.length > 0 && !!githubToken,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes cache
  })

  // TanStack Query for commit details - cached per commit
  const { 
    data: commitDetails,
    isLoading: detailsLoading 
  } = useQuery({
    queryKey: ['commit-details', selectedCommit?.repoFullName, selectedCommit?.sha],
    queryFn: () => fetchCommitDetails(
      selectedCommit!.repoFullName!,
      selectedCommit!.sha,
      githubToken || '',
      selectedCommit!.repository!
    ),
    enabled: !!selectedCommit && !!githubToken,
    staleTime: 5 * 60 * 1000, // 5 minutes - commit details don't change
    gcTime: 30 * 60 * 1000, // 30 minutes cache
  })

  // Generate security findings when commit details change
  useEffect(() => {
    if (commitDetails?.files) {
      generateSecurityFindings(commitDetails.files)
      generatePolicyChecks(commitDetails)
    }
  }, [commitDetails])

  // Text size classes
  const textSizeClasses = {
    sm: {
      message: 'text-xs',
      tag: 'text-[10px]',
      meta: 'text-[10px]',
      avatar: 'w-6 h-6',
      avatarIcon: 'h-3 w-3',
      padding: 'px-3 py-2',
    },
    md: {
      message: 'text-sm',
      tag: 'text-xs',
      meta: 'text-xs',
      avatar: 'w-7 h-7',
      avatarIcon: 'h-3.5 w-3.5',
      padding: 'px-3 py-2.5',
    },
    lg: {
      message: 'text-base',
      tag: 'text-xs',
      meta: 'text-xs',
      avatar: 'w-8 h-8',
      avatarIcon: 'h-4 w-4',
      padding: 'px-4 py-3',
    },
  }

  const currentSize = textSizeClasses[textSize]

  // Generate security findings from files (mock for now - would be real scan)
  const generateSecurityFindings = (files: GitHubCommit['files']) => {
    const findings: SecurityFinding[] = []
    
    files?.forEach(file => {
      // Check for potential security issues in Terraform files
      if (file.filename.endsWith('.tf') && file.patch) {
        if (file.patch.includes('0.0.0.0/0')) {
          findings.push({
            severity: 'high',
            rule: 'overly-permissive-cidr',
            file: file.filename,
            message: 'CIDR block 0.0.0.0/0 allows access from anywhere',
          })
        }
        if (file.patch.includes('publicly_accessible = true')) {
          findings.push({
            severity: 'critical',
            rule: 'public-resource-exposure',
            file: file.filename,
            message: 'Resource is publicly accessible',
          })
        }
        if (file.patch.includes('encryption = false') || file.patch.includes('encrypted = false')) {
          findings.push({
            severity: 'critical',
            rule: 'encryption-disabled',
            file: file.filename,
            message: 'Encryption is disabled for this resource',
          })
        }
      }
      
      // Check for secrets in any file
      if (file.patch) {
        if (/(?:password|secret|api_key|apikey|token)\s*=\s*["'][^"']+["']/i.test(file.patch)) {
          findings.push({
            severity: 'critical',
            rule: 'hardcoded-secret',
            file: file.filename,
            message: 'Potential hardcoded secret detected',
          })
        }
      }
    })

    // Add some baseline findings if none found
    if (findings.length === 0) {
      findings.push({
        severity: 'low',
        rule: 'best-practice',
        file: 'general',
        message: 'Consider adding resource tagging for cost tracking',
      })
    }

    setSecurityFindings(findings)
  }

  // Generate policy checks (mock for now)
  const generatePolicyChecks = (commit: GitHubCommit) => {
    const hasSecurityIssue = securityFindings.some(f => f.severity === 'critical' || f.severity === 'high')
    
    const checks: PolicyCheck[] = [
      {
        name: 'Code Review Required',
        status: commit.parents?.length > 1 ? 'passed' : 'warning',
        category: 'Governance',
        details: commit.parents?.length > 1 ? 'Merge commit with review' : 'Direct commit without PR',
      },
      {
        name: 'Security Scan',
        status: hasSecurityIssue ? 'failed' : 'passed',
        category: 'Security',
        details: hasSecurityIssue ? 'Security issues detected' : 'No critical issues found',
      },
      {
        name: 'Terraform Validation',
        status: 'passed',
        category: 'Validation',
        details: 'Terraform configuration is valid',
      },
      {
        name: 'Cost Impact Analysis',
        status: 'passed',
        category: 'FinOps',
        details: 'No significant cost impact detected',
      },
      {
        name: 'Compliance Check',
        status: 'passed',
        category: 'Compliance',
        details: 'Meets organizational standards',
      },
    ]

    setPolicyChecks(checks)
  }

  // Filter commits
  const filteredCommits = commits.filter(commit => {
    const matchesSearch = 
      commit.commit.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      commit.sha.toLowerCase().includes(searchQuery.toLowerCase()) ||
      commit.commit.author.name.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesRepo = !filterRepo || commit.repository === filterRepo

    return matchesSearch && matchesRepo
  })

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Format relative time
  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return formatDate(dateStr)
  }

  // Copy SHA to clipboard
  const copySha = () => {
    if (commitDetails) {
      navigator.clipboard.writeText(commitDetails.sha)
      setCopiedSha(true)
      setTimeout(() => setCopiedSha(false), 2000)
    }
  }

  // Get current commit index
  const currentCommitIndex = selectedCommit 
    ? filteredCommits.findIndex(c => c.sha === selectedCommit.sha)
    : -1

  // Navigate to previous commit
  const goToPreviousCommit = () => {
    if (currentCommitIndex > 0) {
      setSelectedCommit(filteredCommits[currentCommitIndex - 1])
      setActiveTab('story')
    }
  }

  // Navigate to next commit
  const goToNextCommit = () => {
    if (currentCommitIndex < filteredCommits.length - 1) {
      setSelectedCommit(filteredCommits[currentCommitIndex + 1])
      setActiveTab('story')
    }
  }

  // Close detail panel
  const closeDetailPanel = () => {
    setSelectedCommit(null)
    setCommitDetails(null)
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedCommit) return
      
      if (e.key === 'Escape') {
        closeDetailPanel()
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        goToPreviousCommit()
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        goToNextCommit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedCommit, currentCommitIndex, filteredCommits])

  // Get unique repos for filter
  const uniqueRepos = [...new Set(commits.map(c => c.repository))]

  return (
    <div className="flex h-[calc(100vh-4rem)] relative">
      {/* Full screen dim overlay - sits behind detail panel */}
      {selectedCommit && (
        <div 
          className="fixed inset-0 bg-black/60 z-30"
          onClick={closeDetailPanel}
        />
      )}
      {/* Left Panel - Commits List */}
      <div className={`${selectedCommit ? 'w-[400px]' : 'flex-1'} flex flex-col transition-all duration-300 relative`}>
        {/* Header */}
        <div className="p-4 border-b border-[#1f1f1f]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <GitCommit className="h-5 w-5 text-[#14b8a6]" />
              <h1 className="text-lg font-semibold text-[#fafafa]">Changes</h1>
              <span className="text-xs text-[#666666] bg-[#1f1f1f] px-2 py-0.5 rounded">
                {filteredCommits.length} commits
              </span>
            </div>
            <div className="flex items-center gap-1">
              {/* Text Size Controls */}
              <button
                onClick={() => setTextSize(prev => prev === 'lg' ? 'md' : prev === 'md' ? 'sm' : 'sm')}
                disabled={textSize === 'sm'}
                className={`p-1.5 rounded-md transition-colors ${
                  textSize === 'sm' 
                    ? 'text-[#3a3a3a] cursor-not-allowed' 
                    : 'hover:bg-[#1f1f1f] text-[#666666] hover:text-[#fafafa]'
                }`}
                title="Decrease text size"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-[10px] text-[#666666] w-6 text-center uppercase">{textSize}</span>
              <button
                onClick={() => setTextSize(prev => prev === 'sm' ? 'md' : prev === 'md' ? 'lg' : 'lg')}
                disabled={textSize === 'lg'}
                className={`p-1.5 rounded-md transition-colors ${
                  textSize === 'lg' 
                    ? 'text-[#3a3a3a] cursor-not-allowed' 
                    : 'hover:bg-[#1f1f1f] text-[#666666] hover:text-[#fafafa]'
                }`}
                title="Increase text size"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              
              <div className="w-px h-4 bg-[#1f1f1f] mx-1" />
              
              {/* Refresh Button */}
              <button
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ['github-commits'] })
                  refetchCommits()
                }}
                className="p-1.5 rounded-md hover:bg-[#1f1f1f] text-[#666666] hover:text-[#fafafa] transition-colors"
                title="Refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Search and Filter */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#666666]" />
              <input
                type="text"
                placeholder="Search commits..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-md bg-[#0a0a0a] border border-[#1f1f1f] text-sm text-[#fafafa] placeholder-[#666666] focus:outline-none focus:border-[#14b8a6]/40"
              />
            </div>
            <select
              value={filterRepo || ''}
              onChange={(e) => setFilterRepo(e.target.value || null)}
              className="px-3 py-2 rounded-md bg-[#0a0a0a] border border-[#1f1f1f] text-sm text-[#fafafa] focus:outline-none focus:border-[#14b8a6]/40"
            >
              <option value="">All repos</option>
              {uniqueRepos.map(repo => (
                <option key={repo} value={repo}>{repo}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Commits List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 text-[#14b8a6] animate-spin" />
            </div>
          ) : filteredCommits.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#666666]">
              <GitCommit className="h-12 w-12 mb-4" />
              <p>No commits found</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filteredCommits.map((commit) => (
                <button
                  key={`${commit.repoFullName}-${commit.sha}`}
                  onClick={() => {
                    setSelectedCommit(commit)
                    setActiveTab('story')
                  }}
                  className={`w-full ${currentSize.padding} text-left transition-colors rounded-md border ${
                    isDarkMode 
                      ? 'border-[#1f1f1f] hover:bg-[#141414] hover:border-[#2a2a2a]' 
                      : 'border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                  } ${
                    selectedCommit?.sha === commit.sha 
                      ? `${isDarkMode ? 'bg-[#141414] border-[#14b8a6]' : 'bg-gray-100 border-[#14b8a6]'}` 
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Author Avatar */}
                    <div className="flex-shrink-0">
                      {commit.author?.avatar_url ? (
                        <img
                          src={commit.author.avatar_url}
                          alt={commit.commit.author.name}
                          className={`${currentSize.avatar} rounded-full`}
                        />
                      ) : (
                        <div className={`${currentSize.avatar} rounded-full bg-[#1f1f1f] flex items-center justify-center`}>
                          <User className={`${currentSize.avatarIcon} text-[#666666]`} />
                        </div>
                      )}
                    </div>

                    {/* Commit Info */}
                    <div className="flex-1 min-w-0 flex items-center gap-3">
                      <p className={`${currentSize.message} text-[#fafafa] font-medium truncate flex-1`}>
                        {commit.commit.message.split('\n')[0]}
                      </p>
                      <span className={`${currentSize.tag} text-[#14b8a6] bg-[#14b8a6]/10 px-1.5 py-0.5 rounded flex-shrink-0`}>
                        {commit.repository}
                      </span>
                      <span className={`${currentSize.meta} text-[#666666] flex-shrink-0`}>
                        {commit.sha.substring(0, 7)}
                      </span>
                    </div>

                    {/* Author & Time */}
                    <div className={`flex items-center gap-2 ${currentSize.meta} text-[#666666] flex-shrink-0`}>
                      <span>{commit.commit.author.name}</span>
                      <span>•</span>
                      <span>{formatRelativeTime(commit.commit.author.date)}</span>
                    </div>

                    {/* Chevron */}
                    <ChevronRight className={`${currentSize.avatarIcon} text-[#666666] flex-shrink-0`} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Navigation Controls - Positioned beside detail panel */}
      {selectedCommit && (
        <div className="fixed left-[410px] top-20 z-50 flex flex-col items-center gap-2">
          {/* Close */}
          <button
            onClick={closeDetailPanel}
            className="w-10 h-10 rounded-full border border-[#444444] bg-[#1a1a1a] flex items-center justify-center text-[#888888] hover:text-[#fafafa] hover:border-[#14b8a6] transition-all shadow-lg"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
          
          {/* Previous */}
          <button
            onClick={goToPreviousCommit}
            disabled={currentCommitIndex <= 0}
            className={`w-10 h-10 rounded-full border border-[#444444] bg-[#1a1a1a] flex items-center justify-center transition-all shadow-lg ${
              currentCommitIndex <= 0 
                ? 'text-[#444444] cursor-not-allowed' 
                : 'text-[#888888] hover:text-[#fafafa] hover:border-[#14b8a6]'
            }`}
            title="Previous commit (↑)"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          
          {/* Next */}
          <button
            onClick={goToNextCommit}
            disabled={currentCommitIndex >= filteredCommits.length - 1}
            className={`w-10 h-10 rounded-full border border-[#444444] bg-[#1a1a1a] flex items-center justify-center transition-all shadow-lg ${
              currentCommitIndex >= filteredCommits.length - 1 
                ? 'text-[#444444] cursor-not-allowed' 
                : 'text-[#888888] hover:text-[#fafafa] hover:border-[#14b8a6]'
            }`}
            title="Next commit (↓)"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Right Panel - Commit Details (Mate-style) - Full height overlay */}
      {selectedCommit && (
        <div className="fixed top-0 right-0 bottom-0 w-[calc(100%-460px)] flex flex-col bg-[#0a0a0a] overflow-hidden z-40 shadow-2xl">
          {/* Header */}
          <div className="px-4 py-6 border-b border-[#1f1f1f] bg-[#0f0f0f]">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-[#14b8a6]/10 p-2">
                  <GitCommit className="h-5 w-5 text-[#14b8a6]" />
                </div>
                <div>
                  <p className="text-xs text-[#666666] mb-1">Commit</p>
                  <h2 className="text-lg font-semibold text-[#fafafa]">
                    {selectedCommit.commit.message.split('\n')[0]}
                  </h2>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={selectedCommit.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-md hover:bg-[#1f1f1f] text-[#666666] hover:text-[#fafafa] transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  onClick={() => setSelectedCommit(null)}
                  className="p-2 rounded-md hover:bg-[#1f1f1f] text-[#666666] hover:text-[#fafafa] transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Metadata Row */}
            <div className="flex items-center gap-6 mt-4 text-sm">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-[#666666]" />
                <span className="text-[#a1a1a1]">{selectedCommit.commit.author.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-[#666666]" />
                <span className="text-[#a1a1a1]">{formatDate(selectedCommit.commit.author.date)}</span>
              </div>
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-[#666666]" />
                <span className="text-[#14b8a6]">{selectedCommit.repository}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={copySha}
                  className="flex items-center gap-1 text-[#666666] hover:text-[#fafafa] transition-colors"
                >
                  <Code className="h-4 w-4" />
                  <span className="font-mono text-xs">{selectedCommit.sha.substring(0, 7)}</span>
                  {copiedSha ? <Check className="h-3 w-3 text-[#22c55e]" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-[#1f1f1f]">
            {[
              { id: 'story', label: 'Story', count: null },
              { id: 'files', label: 'Files', count: commitDetails?.files?.length || 0 },
              { id: 'security', label: 'Security', count: securityFindings.length },
              { id: 'policy', label: 'Policy', count: policyChecks.filter(p => p.status !== 'passed').length },
              { id: 'activity', label: 'Activity', count: null },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                  activeTab === tab.id
                    ? 'text-[#fafafa]'
                    : 'text-[#666666] hover:text-[#a1a1a1]'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== null && tab.count > 0 && (
                  <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded ${
                    tab.id === 'security' && securityFindings.some(f => f.severity === 'critical' || f.severity === 'high')
                      ? 'bg-[#ef4444]/20 text-[#ef4444]'
                      : 'bg-[#1f1f1f] text-[#666666]'
                  }`}>
                    {tab.count}
                  </span>
                )}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#14b8a6]" />
                )}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {detailsLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 text-[#14b8a6] animate-spin" />
              </div>
            ) : (
              <>
                {/* Story Tab */}
                {activeTab === 'story' && (
                  <div className="space-y-6">
                    {/* Investigation Status Card */}
                    <div className="rounded-lg bg-[#0f0f0f] p-4 border border-[#1f1f1f]">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[#666666]">Investigation status</span>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${
                          securityFindings.some(f => f.severity === 'critical')
                            ? 'bg-[#ef4444]/20 text-[#ef4444]'
                            : securityFindings.some(f => f.severity === 'high')
                            ? 'bg-[#f97316]/20 text-[#f97316]'
                            : 'bg-[#22c55e]/20 text-[#22c55e]'
                        }`}>
                          {securityFindings.some(f => f.severity === 'critical' || f.severity === 'high')
                            ? 'Needs Review'
                            : 'Passed'}
                        </span>
                      </div>
                      <p className="text-sm text-[#a1a1a1]">
                        {selectedCommit.commit.message}
                      </p>
                    </div>

                    {/* Trigger Card */}
                    <div className="rounded-lg bg-[#0f0f0f] p-4 border border-[#1f1f1f]">
                      <div className="flex items-center gap-3">
                        {selectedCommit.author?.avatar_url ? (
                          <img
                            src={selectedCommit.author.avatar_url}
                            alt=""
                            className="w-10 h-10 rounded-full"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-[#1f1f1f] flex items-center justify-center">
                            <User className="h-5 w-5 text-[#666666]" />
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="text-xs text-[#666666]">
                            Trigger: {formatDate(selectedCommit.commit.author.date)}
                          </p>
                          <p className="text-sm font-medium text-[#fafafa]">
                            Code pushed by {selectedCommit.commit.author.name}
                          </p>
                        </div>
                        <a
                          href={selectedCommit.author?.html_url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-md bg-[#14b8a6]/10 text-[#14b8a6] hover:bg-[#14b8a6]/20 transition-colors"
                        >
                          <User className="h-4 w-4" />
                        </a>
                      </div>
                    </div>

                    {/* Risk Assessment Card */}
                    <div className="rounded-lg bg-[#0f0f0f] p-4 border border-[#1f1f1f]">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-[#14b8a6]" />
                          <span className="text-sm font-medium text-[#fafafa]">Risk Assessment</span>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded font-medium ${
                          securityFindings.some(f => f.severity === 'critical')
                            ? 'bg-[#ef4444]/20 text-[#ef4444]'
                            : securityFindings.some(f => f.severity === 'high')
                            ? 'bg-[#f97316]/20 text-[#f97316]'
                            : securityFindings.length > 0
                            ? 'bg-[#eab308]/20 text-[#eab308]'
                            : 'bg-[#22c55e]/20 text-[#22c55e]'
                        }`}>
                          {securityFindings.some(f => f.severity === 'critical') ? 'Critical' :
                           securityFindings.some(f => f.severity === 'high') ? 'High' :
                           securityFindings.length > 0 ? 'Medium' : 'Low'}
                          {' '}({securityFindings.some(f => f.severity === 'critical') ? 90 :
                                securityFindings.some(f => f.severity === 'high') ? 75 :
                                securityFindings.length > 0 ? 45 : 15})
                        </span>
                      </div>

                      {/* Risk Factors */}
                      <div className="space-y-2 mb-4">
                        <div className="flex items-start gap-2 text-sm">
                          <div className="w-2 h-2 rounded-full bg-[#eab308] mt-1.5 flex-shrink-0" />
                          <span className="text-[#999999]">
                            {commitDetails?.files?.length || 0} file(s) modified in this change
                          </span>
                        </div>
                        {commitDetails?.files?.some((f: any) => f.filename.includes('iam') || f.filename.includes('security')) && (
                          <div className="flex items-start gap-2 text-sm">
                            <div className="w-2 h-2 rounded-full bg-[#f97316] mt-1.5 flex-shrink-0" />
                            <span className="text-[#999999]">Security-sensitive files detected</span>
                          </div>
                        )}
                        {securityFindings.length > 0 && (
                          <div className="flex items-start gap-2 text-sm">
                            <div className="w-2 h-2 rounded-full bg-[#ef4444] mt-1.5 flex-shrink-0" />
                            <span className="text-[#999999]">{securityFindings.length} security finding(s) require review</span>
                          </div>
                        )}
                      </div>

                      {/* Approval Required Banner */}
                      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-3">
                        <div className="p-2 rounded-full bg-amber-500/20">
                          <Lock className="h-4 w-4 text-amber-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-amber-400">
                            {securityFindings.some(f => f.severity === 'critical') ? 'Security Team Approval Required' :
                             securityFindings.some(f => f.severity === 'high') ? 'Senior Engineer Approval Required' :
                             'Team Approval Required'}
                          </p>
                          <p className="text-xs text-amber-400/70">
                            All infrastructure changes require approval before deployment
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Analysis Results */}
                    <div className="rounded-lg bg-[#0f0f0f] p-4 border border-[#1f1f1f]">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Eye className="h-4 w-4 text-[#14b8a6]" />
                          <span className="text-sm font-medium text-[#fafafa]">Analysis Results</span>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${
                          securityFindings.some(f => f.severity === 'critical' || f.severity === 'high')
                            ? 'bg-[#ef4444]/20 text-[#ef4444]'
                            : 'bg-[#22c55e]/20 text-[#22c55e]'
                        }`}>
                          {securityFindings.some(f => f.severity === 'critical' || f.severity === 'high')
                            ? 'Issues Found'
                            : 'Clean'}
                        </span>
                      </div>

                      <div className="space-y-3">
                        {/* Files Changed */}
                        <button 
                          onClick={() => setActiveTab('files')}
                          className="w-full flex items-center justify-between p-3 rounded-lg bg-[#0a0a0a] hover:bg-[#141414] transition-colors text-left"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-[#3b82f6]" />
                            <div>
                              <p className="text-sm text-[#fafafa]">Files Changed</p>
                              <p className="text-xs text-[#666666]">{commitDetails?.files?.length || 0} files modified</p>
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-[#666666]" />
                        </button>

                        {/* Security Findings */}
                        <button 
                          onClick={() => setActiveTab('security')}
                          className="w-full flex items-center justify-between p-3 rounded-lg bg-[#0a0a0a] hover:bg-[#141414] transition-colors text-left"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${
                              securityFindings.some(f => f.severity === 'critical') ? 'bg-[#ef4444]' :
                              securityFindings.some(f => f.severity === 'high') ? 'bg-[#f97316]' :
                              securityFindings.some(f => f.severity === 'medium') ? 'bg-[#eab308]' : 'bg-[#22c55e]'
                            }`} />
                            <div>
                              <p className="text-sm text-[#fafafa]">Security Scan</p>
                              <p className="text-xs text-[#666666]">{securityFindings.length} findings</p>
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-[#666666]" />
                        </button>

                        {/* Policy Checks */}
                        <button 
                          onClick={() => setActiveTab('policy')}
                          className="w-full flex items-center justify-between p-3 rounded-lg bg-[#0a0a0a] hover:bg-[#141414] transition-colors text-left"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${
                              policyChecks.some(p => p.status === 'failed') ? 'bg-[#ef4444]' :
                              policyChecks.some(p => p.status === 'warning') ? 'bg-[#eab308]' : 'bg-[#22c55e]'
                            }`} />
                            <div>
                              <p className="text-sm text-[#fafafa]">Policy Compliance</p>
                              <p className="text-xs text-[#666666]">
                                {policyChecks.filter(p => p.status === 'passed').length}/{policyChecks.length} checks passed
                              </p>
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-[#666666]" />
                        </button>

                        {/* Stats - goes to files tab */}
                        {commitDetails?.stats && (
                          <button 
                            onClick={() => setActiveTab('files')}
                            className="w-full flex items-center justify-between p-3 rounded-lg bg-[#0a0a0a] hover:bg-[#141414] transition-colors text-left"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-2 h-2 rounded-full bg-[#8b5cf6]" />
                              <div>
                                <p className="text-sm text-[#fafafa]">Code Impact</p>
                                <p className="text-xs text-[#666666]">
                                  <span className="text-[#22c55e]">+{commitDetails.stats.additions}</span>
                                  {' / '}
                                  <span className="text-[#ef4444]">-{commitDetails.stats.deletions}</span>
                                </p>
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-[#666666]" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Deep Analysis */}
                    <div className="rounded-lg bg-[#0f0f0f] p-4 border border-[#1f1f1f]">
                      <p className="text-xs text-[#666666] mb-3">Deep analysis</p>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 px-2 py-1 rounded bg-[#14b8a6]/10 text-[#14b8a6] text-xs">
                          <Zap className="h-3 w-3" />
                          Security Analyzer
                        </div>
                        <div className="flex items-center gap-1 px-2 py-1 rounded bg-[#8b5cf6]/10 text-[#8b5cf6] text-xs">
                          <Shield className="h-3 w-3" />
                          Policy Engine
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Files Tab */}
                {activeTab === 'files' && (
                  <div className="space-y-3">
                    {/* Expand/Collapse All Controls */}
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm text-[#666666]">
                        {commitDetails?.files?.length || 0} files changed
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={expandAllFiles}
                          className="text-xs px-2 py-1 rounded bg-[#1f1f1f] text-[#a1a1a1] hover:bg-[#2a2a2a] hover:text-[#fafafa] transition-colors"
                        >
                          Expand All
                        </button>
                        <button
                          onClick={collapseAllFiles}
                          className="text-xs px-2 py-1 rounded bg-[#1f1f1f] text-[#a1a1a1] hover:bg-[#2a2a2a] hover:text-[#fafafa] transition-colors"
                        >
                          Collapse All
                        </button>
                      </div>
                    </div>

                    {commitDetails?.files?.map((file, idx) => {
                      const StatusIcon = fileStatusIcon[file.status] || FileText
                      const statusColor = fileStatusColor[file.status] || '#666666'
                      const isExpanded = expandedFiles.has(file.filename)
                      const patchLines = file.patch?.split('\n') || []
                      const previewLines = 8

                      return (
                        <div
                          key={idx}
                          className="rounded-lg bg-[#0f0f0f] border border-[#1f1f1f] overflow-hidden"
                        >
                          {/* File Header - Always visible */}
                          <div 
                            className="flex items-center justify-between p-3 cursor-pointer hover:bg-[#141414] transition-colors"
                            onClick={() => toggleFileExpansion(file.filename)}
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <button className="flex-shrink-0">
                                <ChevronRight 
                                  className={`h-4 w-4 text-[#666666] transition-transform ${isExpanded ? 'rotate-90' : ''}`} 
                                />
                              </button>
                              <StatusIcon className="h-4 w-4 flex-shrink-0" style={{ color: statusColor }} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-[#fafafa] font-mono truncate">{file.filename}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0 text-xs">
                                <span className="text-[#22c55e]">+{file.additions}</span>
                                <span className="text-[#ef4444]">-{file.deletions}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 ml-2">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#666666] capitalize">
                                {file.status}
                              </span>
                              <a
                                href={`${selectedCommit.html_url}#diff-${file.sha}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#666666] hover:text-[#fafafa] transition-colors p-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </div>
                          </div>

                          {/* Code Diff - Expandable */}
                          {file.patch && (
                            <div className={`border-t border-[#1f1f1f] bg-[#0a0a0a] overflow-hidden transition-all ${
                              isExpanded ? 'max-h-[800px]' : 'max-h-0'
                            }`}>
                              <div className="overflow-x-auto overflow-y-auto max-h-[780px]">
                                <pre className="text-xs font-mono p-3">
                                  {patchLines.map((line, lineIdx) => {
                                    const isAddition = line.startsWith('+') && !line.startsWith('+++')
                                    const isDeletion = line.startsWith('-') && !line.startsWith('---')
                                    const isHeader = line.startsWith('@@') || line.startsWith('diff') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++')
                                    
                                    return (
                                      <div
                                        key={lineIdx}
                                        className={`px-2 py-0.5 ${
                                          isAddition
                                            ? 'text-[#22c55e] bg-[#22c55e]/10'
                                            : isDeletion
                                            ? 'text-[#ef4444] bg-[#ef4444]/10'
                                            : isHeader
                                            ? 'text-[#3b82f6] bg-[#3b82f6]/5'
                                            : 'text-[#a1a1a1]'
                                        }`}
                                      >
                                        <span className="select-none text-[#444444] mr-3 inline-block w-8 text-right">
                                          {lineIdx + 1}
                                        </span>
                                        {line || ' '}
                                      </div>
                                    )
                                  })}
                                </pre>
                              </div>
                            </div>
                          )}

                          {/* Preview when collapsed (show first few lines) */}
                          {file.patch && !isExpanded && (
                            <div className="border-t border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2">
                              <pre className="text-xs font-mono">
                                {patchLines.slice(0, previewLines).map((line, lineIdx) => {
                                  const isAddition = line.startsWith('+') && !line.startsWith('+++')
                                  const isDeletion = line.startsWith('-') && !line.startsWith('---')
                                  
                                  return (
                                    <div
                                      key={lineIdx}
                                      className={`truncate ${
                                        isAddition
                                          ? 'text-[#22c55e]'
                                          : isDeletion
                                          ? 'text-[#ef4444]'
                                          : 'text-[#666666]'
                                      }`}
                                    >
                                      {line || ' '}
                                    </div>
                                  )
                                })}
                              </pre>
                              {patchLines.length > previewLines && (
                                <button 
                                  onClick={() => toggleFileExpansion(file.filename)}
                                  className="text-xs text-[#14b8a6] hover:text-[#0d9488] mt-2 flex items-center gap-1"
                                >
                                  <ChevronDown className="h-3 w-3" />
                                  Show {patchLines.length - previewLines} more lines
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Security Tab */}
                {activeTab === 'security' && (
                  <div className="space-y-3">
                    {securityFindings.map((finding, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg bg-[#0f0f0f] p-4 border border-[#1f1f1f]"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="rounded-md p-1.5"
                            style={{ backgroundColor: `${severityColors[finding.severity]}15` }}
                          >
                            <AlertTriangle
                              className="h-4 w-4"
                              style={{ color: severityColors[finding.severity] }}
                            />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span
                                className="text-xs font-medium px-1.5 py-0.5 rounded uppercase"
                                style={{
                                  backgroundColor: `${severityColors[finding.severity]}20`,
                                  color: severityColors[finding.severity],
                                }}
                              >
                                {finding.severity}
                              </span>
                              <span className="text-xs text-[#666666] font-mono">{finding.rule}</span>
                            </div>
                            <p className="text-sm text-[#fafafa]">{finding.message}</p>
                            <p className="text-xs text-[#666666] mt-1 font-mono">{finding.file}</p>
                          </div>
                        </div>
                      </div>
                    ))}

                    {securityFindings.length === 0 && (
                      <div className="rounded-lg bg-[#0f0f0f] p-8 border border-[#1f1f1f] text-center">
                        <CheckCircle className="h-12 w-12 text-[#22c55e] mx-auto mb-4" />
                        <p className="text-[#fafafa] font-medium">No security issues found</p>
                        <p className="text-sm text-[#666666] mt-1">This commit passed all security checks</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Policy Tab */}
                {activeTab === 'policy' && (
                  <div className="space-y-3">
                    {policyChecks.map((check, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg bg-[#0f0f0f] p-4 border border-[#1f1f1f]"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="rounded-md p-1.5"
                            style={{ backgroundColor: `${statusColors[check.status]}15` }}
                          >
                            {check.status === 'passed' ? (
                              <CheckCircle className="h-4 w-4" style={{ color: statusColors[check.status] }} />
                            ) : check.status === 'failed' ? (
                              <XCircle className="h-4 w-4" style={{ color: statusColors[check.status] }} />
                            ) : check.status === 'warning' ? (
                              <AlertTriangle className="h-4 w-4" style={{ color: statusColors[check.status] }} />
                            ) : (
                              <Minus className="h-4 w-4" style={{ color: statusColors[check.status] }} />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium text-[#fafafa]">{check.name}</p>
                              <span className="text-xs text-[#666666] bg-[#1f1f1f] px-2 py-0.5 rounded">
                                {check.category}
                              </span>
                            </div>
                            {check.details && (
                              <p className="text-xs text-[#666666] mt-1">{check.details}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Activity Tab - Git Graph Style */}
                {activeTab === 'activity' && commitDetails && (
                  <div className="space-y-0">
                    {/* Git Graph Header */}
                    <div className="flex items-center gap-3 mb-4 pb-3 border-b border-[#1f1f1f]">
                      <span className="text-xs text-[#666666]">GRAPH</span>
                      <div className="flex items-center gap-1 text-[#666666]">
                        <GitBranch className="h-3.5 w-3.5" />
                        <span className="text-xs">Auto</span>
                      </div>
                      <div className="flex-1" />
                      <RefreshCw 
                        className="h-3.5 w-3.5 text-[#666666] hover:text-[#fafafa] cursor-pointer transition-colors" 
                        onClick={() => {
                          queryClient.invalidateQueries({ queryKey: ['github-commits'] })
                          refetchCommits()
                        }}
                      />
                    </div>

                    {/* Git Graph Tree - Specific to this commit */}
                    <div className="relative font-mono text-sm">
                      {(() => {
                        // Build the commit chain specific to this commit
                        // Start with current commit, then show its parents chain
                        const commitChain: Array<{
                          sha: string
                          message: string
                          author: string
                          date: string
                          isCurrent: boolean
                          isMerge: boolean
                          parentCount: number
                          branchName?: string
                        }> = []

                        // Add the current selected commit
                        commitChain.push({
                          sha: commitDetails.sha,
                          message: commitDetails.commit.message.split('\n')[0],
                          author: commitDetails.author?.login || commitDetails.commit.author.name,
                          date: commitDetails.commit.author.date,
                          isCurrent: true,
                          isMerge: commitDetails.parents?.length > 1,
                          parentCount: commitDetails.parents?.length || 0,
                          branchName: 'main',
                        })

                        // Find parent commits from the loaded commits list
                        const findCommit = (sha: string) => 
                          filteredCommits.find(c => c.sha === sha || c.sha.startsWith(sha.substring(0, 7)))

                        // Add parent commits to build the chain
                        if (commitDetails.parents) {
                          commitDetails.parents.forEach((parent, pIdx) => {
                            const parentCommit = findCommit(parent.sha)
                            if (parentCommit) {
                              commitChain.push({
                                sha: parentCommit.sha,
                                message: parentCommit.commit.message.split('\n')[0],
                                author: parentCommit.author?.login || parentCommit.commit.author.name,
                                date: parentCommit.commit.author.date,
                                isCurrent: false,
                                isMerge: parentCommit.parents?.length > 1,
                                parentCount: parentCommit.parents?.length || 0,
                                branchName: pIdx > 0 ? `branch-${pIdx}` : undefined,
                              })
                            } else {
                              // Parent not in loaded list - show as truncated
                              commitChain.push({
                                sha: parent.sha,
                                message: 'Parent commit...',
                                author: '...',
                                date: commitDetails.commit.author.date,
                                isCurrent: false,
                                isMerge: false,
                                parentCount: 0,
                                branchName: pIdx > 0 ? `branch-${pIdx}` : undefined,
                              })
                            }
                          })
                        }

                        // Add some ancestor commits for context
                        const lastParent = commitChain[commitChain.length - 1]
                        if (lastParent) {
                          const ancestorCommit = findCommit(lastParent.sha)
                          if (ancestorCommit?.parents?.[0]) {
                            const grandparent = findCommit(ancestorCommit.parents[0].sha)
                            if (grandparent) {
                              commitChain.push({
                                sha: grandparent.sha,
                                message: grandparent.commit.message.split('\n')[0],
                                author: grandparent.author?.login || grandparent.commit.author.name,
                                date: grandparent.commit.author.date,
                                isCurrent: false,
                                isMerge: grandparent.parents?.length > 1,
                                parentCount: grandparent.parents?.length || 0,
                              })
                            }
                          }
                        }

                        // Color palette for branches
                        const branchColors = ['#f97316', '#3b82f6', '#22c55e', '#8b5cf6', '#ec4899']
                        
                        return (
                          <div className="relative">
                            {commitChain.map((commit, idx) => {
                              const isFirst = idx === 0
                              const isLast = idx === commitChain.length - 1
                              const color = commit.isCurrent ? '#f97316' : 
                                           commit.branchName?.startsWith('branch') ? '#3b82f6' : '#f97316'
                              
                              // Check if this is part of a merge visualization
                              const showMergeLine = commit.isMerge || (idx === 1 && commitChain[0]?.isMerge)
                              const isMergeSource = idx > 0 && commitChain[0]?.isMerge && commit.branchName?.startsWith('branch')
                              
                              return (
                                <div 
                                  key={commit.sha}
                                  className={`flex items-start gap-2 py-1.5 hover:bg-[#141414] rounded px-2 -mx-2 ${
                                    commit.isCurrent ? 'bg-[#f97316]/5' : ''
                                  }`}
                                >
                                  {/* Git Graph Lines */}
                                  <div className="w-14 flex-shrink-0 relative h-6 flex items-center">
                                    <svg className="absolute inset-0 w-14 h-full overflow-visible" style={{ minHeight: '24px' }}>
                                      {/* Main vertical line from top */}
                                      {!isFirst && !isMergeSource && (
                                        <line 
                                          x1="10" y1="0" x2="10" y2="12" 
                                          stroke={color} 
                                          strokeWidth="2"
                                        />
                                      )}
                                      
                                      {/* Main vertical line to bottom */}
                                      {!isLast && (
                                        <line 
                                          x1="10" y1="12" x2="10" y2="28" 
                                          stroke={branchColors[0]} 
                                          strokeWidth="2"
                                        />
                                      )}
                                      
                                      {/* Merge branch line (secondary line for merge commits) */}
                                      {isMergeSource && (
                                        <>
                                          {/* Curved merge line */}
                                          <path 
                                            d="M 30 0 L 30 6 Q 30 12, 14 12" 
                                            fill="none" 
                                            stroke="#3b82f6" 
                                            strokeWidth="2"
                                          />
                                        </>
                                      )}
                                      
                                      {/* Show branch line if merge commit */}
                                      {commit.isMerge && idx === 0 && (
                                        <line 
                                          x1="30" y1="12" x2="30" y2="28" 
                                          stroke="#3b82f6" 
                                          strokeWidth="2"
                                        />
                                      )}
                                    </svg>
                                    
                                    {/* Commit dot */}
                                    <div 
                                      className={`absolute left-[6px] top-1/2 -translate-y-1/2 rounded-full ${
                                        commit.isCurrent 
                                          ? 'w-3 h-3 ring-2 ring-[#f97316]/30' 
                                          : 'w-2 h-2'
                                      }`}
                                      style={{ backgroundColor: isMergeSource ? '#3b82f6' : color }}
                                    />
                                    
                                    {/* Secondary dot for merge visualization */}
                                    {commit.isMerge && idx === 0 && (
                                      <div 
                                        className="absolute left-[26px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
                                        style={{ backgroundColor: '#3b82f6' }}
                                      />
                                    )}
                                  </div>
                                  
                                  {/* Commit Info */}
                                  <div className="flex-1 flex items-center gap-2 min-w-0 py-0.5">
                                    {/* Commit message */}
                                    <span className={`truncate flex-1 text-xs ${
                                      commit.isCurrent ? 'text-[#fafafa] font-medium' : 'text-[#888888]'
                                    }`}>
                                      {commit.message.substring(0, 45)}
                                      {commit.message.length > 45 ? '...' : ''}
                                    </span>
                                    
                                    {/* Branch label for current commit */}
                                    {commit.branchName === 'main' && (
                                      <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-[#f97316]/50 text-[#f97316] bg-[#f97316]/10 flex items-center gap-1">
                                        <span className="w-1 h-1 rounded-full bg-[#f97316]" />
                                        main
                                      </span>
                                    )}
                                    
                                    {/* Remote indicator */}
                                    {commit.branchName === 'main' && (
                                      <span className="flex-shrink-0 p-0.5 rounded bg-[#3b82f6]/10">
                                        <svg className="w-3 h-3 text-[#3b82f6]" fill="currentColor" viewBox="0 0 20 20">
                                          <path d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.977A4.5 4.5 0 1113.5 16h-8z" />
                                        </svg>
                                      </span>
                                    )}
                                    
                                    {/* Author */}
                                    <span className="flex-shrink-0 text-[10px] text-[#555555]">
                                      {commit.author}
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                            
                            {/* More commits indicator */}
                            {commitChain.length > 0 && (
                              <div className="flex items-center gap-2 py-1.5 px-2 -mx-2 text-[#444444]">
                                <div className="w-14 flex-shrink-0 relative h-4 flex items-center">
                                  <div className="absolute left-[7px] flex flex-col gap-0.5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#333333]" />
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#333333]" />
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#333333]" />
                                  </div>
                                </div>
                                <span className="text-[10px]">more commits...</span>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>

                    {/* Commit Activity Events */}
                    <div className="mt-6 pt-4 border-t border-[#1f1f1f]">
                      <p className="text-xs text-[#666666] mb-3 uppercase tracking-wider">Activity for this commit</p>
                      <div className="space-y-2">
                        {[
                          {
                            icon: GitCommit,
                            color: '#14b8a6',
                            title: 'Commit created',
                            time: commitDetails.commit.author.date,
                            description: `by ${commitDetails.commit.author.name}`,
                          },
                          {
                            icon: Shield,
                            color: '#22c55e',
                            title: 'Security scan completed',
                            time: commitDetails.commit.author.date,
                            description: `${securityFindings.length} findings`,
                          },
                          {
                            icon: FileCheck,
                            color: '#3b82f6',
                            title: 'Policy checks executed',
                            time: commitDetails.commit.author.date,
                            description: `${policyChecks.filter(p => p.status === 'passed').length}/${policyChecks.length} passed`,
                          },
                        ].map((event, idx) => (
                          <div key={idx} className="flex items-center gap-3 p-2 rounded hover:bg-[#141414]">
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: `${event.color}15` }}
                            >
                              <event.icon className="h-3 w-3" style={{ color: event.color }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-[#fafafa]">{event.title}</p>
                              <p className="text-[10px] text-[#666666]">{event.description}</p>
                            </div>
                            <span className="text-[10px] text-[#666666] flex-shrink-0">
                              {formatRelativeTime(event.time)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
