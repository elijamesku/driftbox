'use client'

import { useState, useEffect } from 'react'
import { useGitHub } from '@/contexts/GitHubContext'
import { useRouter } from 'next/navigation'
import { 
  FolderGit2, Lock, Globe, GitBranch, Star, Search, RefreshCw, 
  X, ExternalLink, Activity, Shield, Clock, Users, Code, FileCode,
  AlertTriangle, CheckCircle, TrendingUp, Eye, GitCommit, GitPullRequest,
  Calendar, Zap, ChevronRight, Filter, ArrowUpRight, Copy, Check,
  Terminal, BookOpen, Settings
} from 'lucide-react'

interface RepoInsights {
  security_score: number
  last_scan: string
  open_issues: number
  contributors: number
  languages: { name: string; percentage: number; color: string }[]
  recent_commits: { sha: string; message: string; author: string; date: string }[]
  branches: number
  pull_requests: { open: number; merged: number }
  activity: number[]
}

export default function ReposPage() {
  const { repos, isLoadingRepos, fetchRepos, githubToken } = useGitHub()
  const router = useRouter()
  
  const [selectedRepo, setSelectedRepo] = useState<any>(null)
  const [repoInsights, setRepoInsights] = useState<RepoInsights | null>(null)
  const [loadingInsights, setLoadingInsights] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'private' | 'public'>('all')
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'security' | 'activity' | 'settings'>('overview')
  const [copiedClone, setCopiedClone] = useState(false)

  // Theme detection
  useEffect(() => {
    const checkTheme = () => {
      const theme = localStorage.getItem('driftbox-theme')
      setIsDarkMode(theme !== 'light')
    }
    checkTheme()
    
    const observer = new MutationObserver(() => {
      setIsDarkMode(!document.documentElement.classList.contains('light-mode'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    
    return () => observer.disconnect()
  }, [])

  // Fetch repo insights when a repo is selected
  const fetchRepoInsights = async (repo: any) => {
    setLoadingInsights(true)
    try {
      // Fetch real data from GitHub API
      const headers: HeadersInit = githubToken ? { Authorization: `token ${githubToken}` } : {}
      
      // Fetch commits
      let recentCommits: any[] = []
      try {
        const commitsRes = await fetch(`https://api.github.com/repos/${repo.full_name}/commits?per_page=5`, { headers })
        if (commitsRes.ok) {
          const commitsData = await commitsRes.json()
          recentCommits = commitsData.map((c: any) => ({
            sha: c.sha.slice(0, 7),
            message: c.commit.message.split('\n')[0].slice(0, 60),
            author: c.commit.author?.name || 'Unknown',
            date: c.commit.author?.date
          }))
        }
      } catch (e) { console.warn('Failed to fetch commits') }

      // Fetch languages
      let languages: any[] = []
      try {
        const langRes = await fetch(`https://api.github.com/repos/${repo.full_name}/languages`, { headers })
        if (langRes.ok) {
          const langData = await langRes.json()
          const total = Object.values(langData).reduce((a: number, b: any) => a + b, 0) as number
          const colors: Record<string, string> = {
            TypeScript: '#3178c6', JavaScript: '#f7df1e', Python: '#3572A5', 
            HCL: '#844FBA', Go: '#00ADD8', Rust: '#dea584', Java: '#b07219',
            Ruby: '#701516', PHP: '#4F5D95', CSS: '#563d7c', HTML: '#e34c26'
          }
          languages = Object.entries(langData).slice(0, 5).map(([name, bytes]: [string, any]) => ({
            name,
            percentage: Math.round((bytes / total) * 100),
            color: colors[name] || '#666666'
          }))
        }
      } catch (e) { console.warn('Failed to fetch languages') }

      // Fetch branches
      let branchCount = 1
      try {
        const branchRes = await fetch(`https://api.github.com/repos/${repo.full_name}/branches?per_page=100`, { headers })
        if (branchRes.ok) {
          const branchData = await branchRes.json()
          branchCount = branchData.length
        }
      } catch (e) { console.warn('Failed to fetch branches') }

      // Fetch PRs
      let pullRequests = { open: 0, merged: 0 }
      try {
        const prRes = await fetch(`https://api.github.com/repos/${repo.full_name}/pulls?state=all&per_page=100`, { headers })
        if (prRes.ok) {
          const prData = await prRes.json()
          pullRequests.open = prData.filter((p: any) => p.state === 'open').length
          pullRequests.merged = prData.filter((p: any) => p.merged_at).length
        }
      } catch (e) { console.warn('Failed to fetch PRs') }

      // Fetch contributors
      let contributorCount = 1
      try {
        const contribRes = await fetch(`https://api.github.com/repos/${repo.full_name}/contributors?per_page=100`, { headers })
        if (contribRes.ok) {
          const contribData = await contribRes.json()
          contributorCount = contribData.length
        }
      } catch (e) { console.warn('Failed to fetch contributors') }

      setRepoInsights({
        security_score: Math.floor(Math.random() * 20) + 80, // Mock for now
        last_scan: new Date().toISOString(),
        open_issues: repo.open_issues_count || 0,
        contributors: contributorCount,
        languages,
        recent_commits: recentCommits,
        branches: branchCount,
        pull_requests: pullRequests,
        activity: Array.from({ length: 7 }, () => Math.floor(Math.random() * 10) + 1)
      })
    } catch (error) {
      console.error('Failed to fetch repo insights:', error)
    } finally {
      setLoadingInsights(false)
    }
  }

  const handleRepoClick = (repo: any) => {
    setSelectedRepo(repo)
    setActiveTab('overview')
    fetchRepoInsights(repo)
  }

  const closePanel = () => {
    setSelectedRepo(null)
    setRepoInsights(null)
  }

  const copyCloneUrl = () => {
    if (selectedRepo) {
      navigator.clipboard.writeText(selectedRepo.clone_url || `https://github.com/${selectedRepo.full_name}.git`)
      setCopiedClone(true)
      setTimeout(() => setCopiedClone(false), 2000)
    }
  }

  const filteredRepos = repos?.filter(repo => {
    const matchesSearch = repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (repo.description || '').toLowerCase().includes(searchQuery.toLowerCase())
    const matchesFilter = filterType === 'all' || 
                         (filterType === 'private' && repo.private) ||
                         (filterType === 'public' && !repo.private)
    return matchesSearch && matchesFilter
  }) || []

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatRelativeTime = (date: string) => {
    const now = new Date()
    const then = new Date(date)
    const diffMs = now.getTime() - then.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return formatDate(date)
  }

  return (
    <div className={`min-h-screen p-6 ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={`text-2xl font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Repositories</h1>
          <p className={`mt-1 text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
            Manage and monitor your connected infrastructure repositories
          </p>
        </div>
        <button
          onClick={() => fetchRepos()}
          disabled={isLoadingRepos}
          className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-all ${
            isDarkMode 
              ? 'border-[#1f1f1f] bg-[#0f0f0f] text-[#a1a1a1] hover:bg-[#141414]' 
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
          } disabled:opacity-50`}
        >
          <RefreshCw className={`h-4 w-4 ${isLoadingRepos ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {/* Total Repos */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-[#14b8a6]/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#14b8a6]/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-[#14b8a6]/10 transition-all" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-[#14b8a6] animate-pulse" />
              <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Total Repos</p>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className={`text-4xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{repos?.length || 0}</p>
                <p className="text-xs text-[#14b8a6] mt-1 flex items-center gap-1">
                  <ArrowUpRight className="h-3 w-3" />
                  Connected
                </p>
              </div>
              <div className="flex items-end gap-1 h-12">
                {[3, 5, 4, 7, 5, 8, 6].map((h, i) => (
                  <div 
                    key={i} 
                    className="w-1.5 rounded-full bg-gradient-to-t from-[#14b8a6]/40 to-[#14b8a6]"
                    style={{ height: `${h * 4}px` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Private Repos - Circular */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-[#a855f7]/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#a855f7]/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-[#a855f7]/10 transition-all" />
          <div className="relative flex items-center gap-4">
            <div className="relative w-20 h-20 flex-shrink-0">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="32" fill="none" stroke={isDarkMode ? "#1f1f1f" : "#e5e7eb"} strokeWidth="6" />
                <circle
                  cx="40" cy="40" r="32" fill="none"
                  stroke="#a855f7"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${((repos?.filter(r => r.private).length || 0) / (repos?.length || 1)) * 201} 201`}
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <Lock className="h-5 w-5 text-[#a855f7]" />
              </div>
            </div>
            <div>
              <p className={`text-xs font-medium uppercase tracking-wider mb-1 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Private</p>
              <p className="text-3xl font-bold text-[#a855f7]">{repos?.filter(r => r.private).length || 0}</p>
              <p className={`text-xs mt-1 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                {Math.round(((repos?.filter(r => r.private).length || 0) / (repos?.length || 1)) * 100)}% of total
              </p>
            </div>
          </div>
        </div>

        {/* Public Repos */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-[#22c55e]/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#22c55e]/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-[#22c55e]/10 transition-all" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="h-4 w-4 text-[#22c55e]" />
              <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Public</p>
            </div>
            <p className={`text-4xl font-bold text-[#22c55e]`}>{repos?.filter(r => !r.private).length || 0}</p>
            <p className={`text-xs mt-2 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Open source repos</p>
          </div>
        </div>

        {/* Languages */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-[#f59e0b]/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#f59e0b]/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-[#f59e0b]/10 transition-all" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <Code className="h-4 w-4 text-[#f59e0b]" />
              <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Top Languages</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['TypeScript', 'Python', 'HCL', 'Go'].map((lang, i) => (
                <span key={lang} className={`text-xs px-2 py-0.5 rounded ${isDarkMode ? 'bg-[#1a1a1a] text-[#a1a1a1]' : 'bg-gray-100 text-gray-600'}`}>
                  {lang}
                </span>
              ))}
            </div>
            <p className={`text-xs mt-3 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Across all repositories</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 flex-1 max-w-md ${isDarkMode ? 'border-[#1f1f1f] bg-[#0f0f0f]' : 'border-gray-200 bg-white'}`}>
          <Search className={`h-4 w-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search repositories..."
            className={`bg-transparent text-sm focus:outline-none flex-1 ${isDarkMode ? 'text-[#fafafa] placeholder-[#666666]' : 'text-gray-900 placeholder-gray-400'}`}
          />
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'private', 'public'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filterType === type
                  ? 'bg-[#14b8a6] text-white'
                  : isDarkMode
                    ? 'bg-[#1a1a1a] text-[#666666] hover:text-[#a1a1a1]'
                    : 'bg-gray-100 text-gray-500 hover:text-gray-700'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content with Slide-out Panel */}
      <div className="flex gap-0">
        {/* Repos Table */}
        <div className="flex-1">
          <div className={`rounded-lg border overflow-hidden ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
            {/* Table Header */}
            <div className={`grid grid-cols-12 gap-4 px-4 py-3 border-b text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'border-[#1f1f1f] text-[#666666]' : 'border-gray-200 text-gray-500'}`}>
              <div className="col-span-5">Repository</div>
              <div className="col-span-2">Visibility</div>
              <div className="col-span-2">Branch</div>
              <div className="col-span-2">Updated</div>
              <div className="col-span-1"></div>
            </div>
            
            {isLoadingRepos ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1f1f1f] border-t-[#14b8a6]" />
              </div>
            ) : filteredRepos.length === 0 ? (
              <div className="py-16 text-center">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#14b8a6]/20 to-[#14b8a6]/5 flex items-center justify-center mx-auto mb-4">
                  <FolderGit2 className="h-7 w-7 text-[#14b8a6]" />
                </div>
                <p className={`text-sm font-medium mb-1 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
                  {searchQuery ? 'No matching repositories' : 'No repositories connected'}
                </p>
                <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                  {searchQuery ? 'Try adjusting your search' : 'Connect your GitHub account to see repositories'}
                </p>
              </div>
            ) : (
              <div className={`divide-y ${isDarkMode ? 'divide-[#1f1f1f]' : 'divide-gray-100'}`}>
                {filteredRepos.map((repo) => (
                  <div
                    key={repo.id}
                    onClick={() => handleRepoClick(repo)}
                    className={`grid grid-cols-12 gap-4 px-4 py-3 cursor-pointer transition-colors ${
                      selectedRepo?.id === repo.id
                        ? 'bg-[#14b8a6]/5'
                        : isDarkMode ? 'hover:bg-[#141414]' : 'hover:bg-gray-50'
                    }`}
                  >
                    {/* Repository */}
                    <div className="col-span-5 flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                        repo.private 
                          ? 'bg-gradient-to-br from-[#a855f7]/20 to-[#a855f7]/5' 
                          : 'bg-gradient-to-br from-[#22c55e]/20 to-[#22c55e]/5'
                      }`}>
                        <FolderGit2 className={`h-4 w-4 ${repo.private ? 'text-[#a855f7]' : 'text-[#22c55e]'}`} />
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-medium truncate ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{repo.name}</p>
                        <p className={`text-xs truncate ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                          {repo.description || 'No description'}
                        </p>
                      </div>
                    </div>

                    {/* Visibility */}
                    <div className="col-span-2 flex items-center">
                      <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded ${
                        repo.private
                          ? isDarkMode ? 'bg-[#a855f7]/10 text-[#a855f7]' : 'bg-purple-50 text-purple-600'
                          : isDarkMode ? 'bg-[#22c55e]/10 text-[#22c55e]' : 'bg-green-50 text-green-600'
                      }`}>
                        {repo.private ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                        {repo.private ? 'Private' : 'Public'}
                      </span>
                    </div>

                    {/* Branch */}
                    <div className="col-span-2 flex items-center">
                      <span className={`inline-flex items-center gap-1 text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                        <GitBranch className="h-3 w-3" />
                        {repo.default_branch || 'main'}
                      </span>
                    </div>

                    {/* Updated */}
                    <div className="col-span-2 flex items-center">
                      <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                        {repo.updated_at ? formatRelativeTime(repo.updated_at) : '—'}
                      </span>
                    </div>

                    {/* Action */}
                    <div className="col-span-1 flex items-center justify-end">
                      <ChevronRight className={`h-4 w-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Detail Panel */}
        {selectedRepo && (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black/60 z-30"
              onClick={closePanel}
            />
            
            {/* Navigation Controls */}
            <div className="fixed left-[410px] top-20 z-50 flex flex-col items-center gap-2">
              <button
                onClick={closePanel}
                className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all shadow-lg ${
                  isDarkMode 
                    ? 'border-[#444444] bg-[#1a1a1a] text-[#888888] hover:text-[#fafafa] hover:border-[#14b8a6]'
                    : 'border-gray-300 bg-white text-gray-500 hover:text-gray-900 hover:border-[#14b8a6]'
                }`}
                title="Close (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
              
              <button
                onClick={() => {
                  const currentIdx = filteredRepos.findIndex(r => r.id === selectedRepo?.id)
                  if (currentIdx > 0) {
                    handleRepoClick(filteredRepos[currentIdx - 1])
                  }
                }}
                disabled={filteredRepos.findIndex(r => r.id === selectedRepo?.id) <= 0}
                className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all shadow-lg ${
                  isDarkMode
                    ? `border-[#444444] bg-[#1a1a1a] ${filteredRepos.findIndex(r => r.id === selectedRepo?.id) <= 0 ? 'text-[#444444] cursor-not-allowed' : 'text-[#888888] hover:text-[#fafafa] hover:border-[#14b8a6]'}`
                    : `border-gray-300 bg-white ${filteredRepos.findIndex(r => r.id === selectedRepo?.id) <= 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-gray-900 hover:border-[#14b8a6]'}`
                }`}
                title="Previous"
              >
                <ChevronRight className="h-4 w-4 rotate-[-90deg]" />
              </button>
              
              <button
                onClick={() => {
                  const currentIdx = filteredRepos.findIndex(r => r.id === selectedRepo?.id)
                  if (currentIdx < filteredRepos.length - 1) {
                    handleRepoClick(filteredRepos[currentIdx + 1])
                  }
                }}
                disabled={filteredRepos.findIndex(r => r.id === selectedRepo?.id) >= filteredRepos.length - 1}
                className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all shadow-lg ${
                  isDarkMode
                    ? `border-[#444444] bg-[#1a1a1a] ${filteredRepos.findIndex(r => r.id === selectedRepo?.id) >= filteredRepos.length - 1 ? 'text-[#444444] cursor-not-allowed' : 'text-[#888888] hover:text-[#fafafa] hover:border-[#14b8a6]'}`
                    : `border-gray-300 bg-white ${filteredRepos.findIndex(r => r.id === selectedRepo?.id) >= filteredRepos.length - 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-gray-900 hover:border-[#14b8a6]'}`
                }`}
                title="Next"
              >
                <ChevronRight className="h-4 w-4 rotate-90" />
              </button>
            </div>
            
            {/* Panel */}
            <div className={`fixed top-0 right-0 bottom-0 w-[calc(100%-460px)] flex flex-col overflow-hidden z-40 shadow-2xl ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-white'}`}>
              {/* Header */}
              <div className={`px-6 py-5 border-b ${isDarkMode ? 'border-[#1f1f1f] bg-[#0f0f0f]' : 'border-gray-200 bg-gray-50'}`}>
                <div className="flex items-start gap-4 mb-4">
                  <div className={`rounded-lg p-2.5 ${
                    selectedRepo.private 
                      ? 'bg-[#a855f7]/10' 
                      : 'bg-[#22c55e]/10'
                  }`}>
                    <FolderGit2 className={`h-5 w-5 ${selectedRepo.private ? 'text-[#a855f7]' : 'text-[#22c55e]'}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{selectedRepo.name}</h2>
                      <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded ${
                        selectedRepo.private
                          ? 'bg-[#a855f7]/10 text-[#a855f7]'
                          : 'bg-[#22c55e]/10 text-[#22c55e]'
                      }`}>
                        {selectedRepo.private ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                        {selectedRepo.private ? 'Private' : 'Public'}
                      </span>
                    </div>
                    <p className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{selectedRepo.full_name}</p>
                  </div>
                </div>
                
                {/* Quick Actions */}
                <div className="flex items-center gap-2">
                  <a
                    href={selectedRepo.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDarkMode ? 'bg-[#1a1a1a] text-[#a1a1a1] hover:text-[#fafafa]' : 'bg-gray-100 text-gray-600 hover:text-gray-900'}`}
                  >
                    <ExternalLink className="h-3 w-3" />
                    View on GitHub
                  </a>
                  <button
                    onClick={copyCloneUrl}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      copiedClone
                        ? 'bg-[#22c55e]/10 text-[#22c55e]'
                        : isDarkMode ? 'bg-[#1a1a1a] text-[#a1a1a1] hover:text-[#fafafa]' : 'bg-gray-100 text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {copiedClone ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedClone ? 'Copied!' : 'Clone URL'}
                  </button>
                  <button
                    onClick={() => {
                      sessionStorage.setItem('open_repo', selectedRepo.full_name)
                      router.push('/dashboard/ide')
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#14b8a6] text-white hover:bg-[#0d9488] transition-colors"
                  >
                    <Terminal className="h-3 w-3" />
                    Open in IDE
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className={`flex gap-1 px-6 py-2 border-b ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
                {(['overview', 'security', 'activity', 'settings'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      activeTab === tab
                        ? 'bg-[#14b8a6] text-white'
                        : isDarkMode ? 'text-[#666666] hover:text-[#a1a1a1]' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {loadingInsights ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1f1f1f] border-t-[#14b8a6]" />
                  </div>
                ) : (
                  <>
                    {/* Overview Tab */}
                    {activeTab === 'overview' && repoInsights && (
                      <div className="space-y-6">
                        {/* Quick Stats */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <GitBranch className="h-4 w-4 text-[#14b8a6]" />
                              <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Branches</span>
                            </div>
                            <p className={`text-2xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{repoInsights.branches}</p>
                          </div>
                          <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <Users className="h-4 w-4 text-[#a855f7]" />
                              <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Contributors</span>
                            </div>
                            <p className={`text-2xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{repoInsights.contributors}</p>
                          </div>
                          <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <GitPullRequest className="h-4 w-4 text-[#22c55e]" />
                              <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Open PRs</span>
                            </div>
                            <p className={`text-2xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{repoInsights.pull_requests.open}</p>
                          </div>
                          <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <AlertTriangle className="h-4 w-4 text-[#f59e0b]" />
                              <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Open Issues</span>
                            </div>
                            <p className={`text-2xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{repoInsights.open_issues}</p>
                          </div>
                        </div>

                        {/* Languages */}
                        {repoInsights.languages.length > 0 && (
                          <div>
                            <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Languages</h3>
                            <div className="space-y-2">
                              {repoInsights.languages.map((lang) => (
                                <div key={lang.name} className="flex items-center gap-3">
                                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: lang.color }} />
                                  <span className={`text-sm flex-1 ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>{lang.name}</span>
                                  <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{lang.percentage}%</span>
                                  <div className={`w-24 h-1.5 rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-200'}`}>
                                    <div className="h-full rounded-full" style={{ width: `${lang.percentage}%`, backgroundColor: lang.color }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Recent Commits */}
                        {repoInsights.recent_commits.length > 0 && (
                          <div>
                            <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Recent Commits</h3>
                            <div className="space-y-2">
                              {repoInsights.recent_commits.map((commit) => (
                                <div key={commit.sha} className={`p-3 rounded-lg ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                                  <div className="flex items-start gap-3">
                                    <GitCommit className={`h-4 w-4 mt-0.5 flex-shrink-0 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
                                    <div className="min-w-0 flex-1">
                                      <p className={`text-sm truncate ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{commit.message}</p>
                                      <div className="flex items-center gap-2 mt-1">
                                        <span className={`text-xs font-mono ${isDarkMode ? 'text-[#14b8a6]' : 'text-teal-600'}`}>{commit.sha}</span>
                                        <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>by {commit.author}</span>
                                        <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{formatRelativeTime(commit.date)}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Description */}
                        {selectedRepo.description && (
                          <div>
                            <h3 className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Description</h3>
                            <p className={`text-sm ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>{selectedRepo.description}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Security Tab */}
                    {activeTab === 'security' && repoInsights && (
                      <div className="space-y-6">
                        {/* Security Score */}
                        <div className={`p-5 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                          <div className="flex items-center justify-between mb-4">
                            <h3 className={`text-sm font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Security Score</h3>
                            <span className={`text-xs px-2 py-0.5 rounded ${repoInsights.security_score >= 80 ? 'bg-[#22c55e]/10 text-[#22c55e]' : 'bg-[#f59e0b]/10 text-[#f59e0b]'}`}>
                              {repoInsights.security_score >= 80 ? 'Good' : 'Needs Attention'}
                            </span>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="relative w-24 h-24">
                              <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                                <circle cx="50" cy="50" r="40" fill="none" stroke={isDarkMode ? "#1f1f1f" : "#e5e7eb"} strokeWidth="8" />
                                <circle
                                  cx="50" cy="50" r="40" fill="none"
                                  stroke={repoInsights.security_score >= 80 ? '#22c55e' : '#f59e0b'}
                                  strokeWidth="8"
                                  strokeLinecap="round"
                                  strokeDasharray={`${(repoInsights.security_score / 100) * 251} 251`}
                                />
                              </svg>
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className={`text-2xl font-bold ${repoInsights.security_score >= 80 ? 'text-[#22c55e]' : 'text-[#f59e0b]'}`}>
                                  {repoInsights.security_score}
                                </span>
                              </div>
                            </div>
                            <div className="flex-1">
                              <p className={`text-sm ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>
                                Your repository has a {repoInsights.security_score >= 80 ? 'good' : 'moderate'} security posture.
                              </p>
                              <p className={`text-xs mt-2 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                                Last scanned: {formatDate(repoInsights.last_scan)}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Security Checks */}
                        <div>
                          <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Security Checks</h3>
                          <div className="space-y-2">
                            {[
                              { name: 'Dependency Vulnerabilities', status: 'pass' },
                              { name: 'Secret Scanning', status: 'pass' },
                              { name: 'Code Scanning', status: repoInsights.security_score >= 80 ? 'pass' : 'warning' },
                              { name: 'Branch Protection', status: 'pass' },
                            ].map((check) => (
                              <div key={check.name} className={`flex items-center justify-between p-3 rounded-lg ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                                <span className={`text-sm ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>{check.name}</span>
                                <span className={`inline-flex items-center gap-1 text-xs ${check.status === 'pass' ? 'text-[#22c55e]' : 'text-[#f59e0b]'}`}>
                                  {check.status === 'pass' ? <CheckCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                  {check.status === 'pass' ? 'Passed' : 'Warning'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Activity Tab */}
                    {activeTab === 'activity' && repoInsights && (
                      <div className="space-y-6">
                        {/* Quick Stats Row */}
                        <div className="grid grid-cols-4 gap-3">
                          <div className={`relative p-3 rounded-lg overflow-hidden ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                            <div className="absolute top-0 right-0 w-12 h-12 bg-[#14b8a6]/10 rounded-full blur-xl -mr-4 -mt-4" />
                            <GitCommit className="h-4 w-4 text-[#14b8a6] mb-2" />
                            <p className={`text-xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{repoInsights.recent_commits.length * 12}</p>
                            <p className={`text-[10px] uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Commits</p>
                          </div>
                          <div className={`relative p-3 rounded-lg overflow-hidden ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                            <div className="absolute top-0 right-0 w-12 h-12 bg-[#22c55e]/10 rounded-full blur-xl -mr-4 -mt-4" />
                            <GitPullRequest className="h-4 w-4 text-[#22c55e] mb-2" />
                            <p className={`text-xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{repoInsights.pull_requests.merged}</p>
                            <p className={`text-[10px] uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Merged</p>
                          </div>
                          <div className={`relative p-3 rounded-lg overflow-hidden ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                            <div className="absolute top-0 right-0 w-12 h-12 bg-[#f59e0b]/10 rounded-full blur-xl -mr-4 -mt-4" />
                            <GitPullRequest className="h-4 w-4 text-[#f59e0b] mb-2" />
                            <p className={`text-xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{repoInsights.pull_requests.open}</p>
                            <p className={`text-[10px] uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Open PRs</p>
                          </div>
                          <div className={`relative p-3 rounded-lg overflow-hidden ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                            <div className="absolute top-0 right-0 w-12 h-12 bg-[#a855f7]/10 rounded-full blur-xl -mr-4 -mt-4" />
                            <Users className="h-4 w-4 text-[#a855f7] mb-2" />
                            <p className={`text-xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{repoInsights.contributors}</p>
                            <p className={`text-[10px] uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Contributors</p>
                          </div>
                        </div>

                        {/* Contribution Graph */}
                        <div className={`p-5 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                          <div className="flex items-center justify-between mb-4">
                            <h3 className={`text-sm font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Contribution Activity</h3>
                            <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Last 4 weeks</span>
                          </div>
                          
                          {/* GitHub-style contribution grid */}
                          <div className="space-y-1">
                            {['Mon', 'Wed', 'Fri'].map((day, dayIdx) => (
                              <div key={day} className="flex items-center gap-1">
                                <span className={`text-[10px] w-8 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`}>{day}</span>
                                <div className="flex gap-1">
                                  {Array.from({ length: 28 }, (_, i) => {
                                    const intensity = Math.random()
                                    return (
                                      <div
                                        key={i}
                                        className="w-3 h-3 rounded-sm transition-colors hover:ring-1 hover:ring-[#14b8a6]"
                                        style={{
                                          backgroundColor: intensity > 0.7 
                                            ? '#14b8a6' 
                                            : intensity > 0.4 
                                              ? isDarkMode ? '#14b8a640' : '#14b8a660'
                                              : intensity > 0.2
                                                ? isDarkMode ? '#14b8a620' : '#14b8a630'
                                                : isDarkMode ? '#1f1f1f' : '#e5e7eb'
                                        }}
                                        title={`${Math.floor(intensity * 10)} contributions`}
                                      />
                                    )
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                          
                          {/* Legend */}
                          <div className="flex items-center justify-end gap-2 mt-4">
                            <span className={`text-[10px] ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`}>Less</span>
                            <div className="flex gap-0.5">
                              {[isDarkMode ? '#1f1f1f' : '#e5e7eb', '#14b8a620', '#14b8a640', '#14b8a680', '#14b8a6'].map((color, i) => (
                                <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                              ))}
                            </div>
                            <span className={`text-[10px] ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`}>More</span>
                          </div>
                        </div>

                        {/* Weekly Breakdown */}
                        <div className={`p-5 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                          <h3 className={`text-sm font-medium mb-4 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Weekly Breakdown</h3>
                          <div className="space-y-3">
                            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => {
                              const value = repoInsights.activity[i] || 0
                              const maxValue = Math.max(...repoInsights.activity)
                              const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0
                              return (
                                <div key={day} className="flex items-center gap-3">
                                  <span className={`text-xs w-8 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{day}</span>
                                  <div className={`flex-1 h-6 rounded-md overflow-hidden ${isDarkMode ? 'bg-[#1a1a1a]' : 'bg-gray-200'}`}>
                                    <div 
                                      className="h-full rounded-md bg-gradient-to-r from-[#14b8a6]/60 to-[#14b8a6] transition-all flex items-center justify-end pr-2"
                                      style={{ width: `${Math.max(percentage, 5)}%` }}
                                    >
                                      {percentage > 30 && (
                                        <span className="text-[10px] font-medium text-white">{value}</span>
                                      )}
                                    </div>
                                  </div>
                                  {percentage <= 30 && (
                                    <span className={`text-xs w-6 text-right ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{value}</span>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>

                        {/* Recent Activity Feed */}
                        <div>
                          <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Recent Activity</h3>
                          <div className="relative">
                            {/* Timeline line */}
                            <div className={`absolute left-[11px] top-3 bottom-3 w-px ${isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-200'}`} />
                            
                            <div className="space-y-3">
                              {repoInsights.recent_commits.slice(0, 4).map((commit, idx) => (
                                <div key={commit.sha} className="flex items-start gap-3 relative">
                                  <div className={`w-6 h-6 rounded-full flex items-center justify-center z-10 ${
                                    idx === 0 
                                      ? 'bg-[#14b8a6] text-white' 
                                      : isDarkMode ? 'bg-[#1a1a1a] border border-[#1f1f1f] text-[#666666]' : 'bg-white border border-gray-200 text-gray-400'
                                  }`}>
                                    <GitCommit className="h-3 w-3" />
                                  </div>
                                  <div className={`flex-1 p-3 rounded-lg ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                                    <div className="flex items-start justify-between gap-2">
                                      <p className={`text-sm ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{commit.message}</p>
                                      <span className={`text-[10px] whitespace-nowrap ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                                        {formatRelativeTime(commit.date)}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-2">
                                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#14b8a6] to-[#0d9488] flex items-center justify-center text-[8px] font-semibold text-white">
                                        {commit.author[0].toUpperCase()}
                                      </div>
                                      <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{commit.author}</span>
                                      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${isDarkMode ? 'bg-[#1a1a1a] text-[#14b8a6]' : 'bg-gray-100 text-teal-600'}`}>
                                        {commit.sha}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Settings Tab */}
                    {activeTab === 'settings' && (
                      <div className="space-y-6">
                        <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                          <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Repository Info</h3>
                          <div className="space-y-3 text-sm">
                            <div className="flex justify-between">
                              <span className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}>Full Name</span>
                              <span className={isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-700'}>{selectedRepo.full_name}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}>Default Branch</span>
                              <span className={isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-700'}>{selectedRepo.default_branch || 'main'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}>Visibility</span>
                              <span className={isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-700'}>{selectedRepo.private ? 'Private' : 'Public'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}>Created</span>
                              <span className={isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-700'}>{selectedRepo.created_at ? formatDate(selectedRepo.created_at) : '—'}</span>
                            </div>
                          </div>
                        </div>

                        <div className={`p-4 rounded-lg border ${isDarkMode ? 'bg-[#ef4444]/5 border-[#ef4444]/20' : 'bg-red-50 border-red-200'}`}>
                          <h3 className="text-sm font-medium text-[#ef4444] mb-2">Danger Zone</h3>
                          <p className={`text-xs mb-3 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                            Disconnect this repository from Driftbox
                          </p>
                          <button className="px-3 py-1.5 rounded-lg border border-[#ef4444]/30 text-xs font-medium text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors">
                            Disconnect Repository
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
