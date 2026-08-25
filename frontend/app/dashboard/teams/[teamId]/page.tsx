'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Users,
  GitBranch,
  Settings,
  Crown,
  Sparkles,
  UserPlus,
  Copy,
  Check,
  Trash2,
  MoreHorizontal,
  Shield,
  X,
  Mail,
  Play,
  LayoutDashboard,
  FileText,
  Activity,
  DollarSign,
  AlertTriangle,
  ChevronDown,
  Edit2,
  Eye,
  Code,
  Book,
  Terminal,
  Zap,
  Lock,
  Unlock,
  ShieldCheck,
  ShieldAlert,
  TrendingUp,
  Clock,
  RefreshCw,
  ExternalLink,
  ToggleLeft,
  ToggleRight,
  Link2,
} from 'lucide-react'
import { getApiEndpoint } from '@/utils/apiEndpoint'

interface TeamMember {
  id: string
  user_id: string
  role: string
  status: string
  joined_at: string | null
  user: {
    id: string
    email: string
    github_username?: string
  }
}

interface TeamRepo {
  id: string
  repo_full_name: string
  repo_owner: string
  repo_name: string
  added_at: string
}

interface TeamDetails {
  id: string
  name: string
  slug: string
  plan: string
  seats_limit: number
  member_count: number
  repo_count: number
  created_at: string
}

interface TeamDashboard {
  security_score: number
  total_security_issues: number
  critical_issues: number
  high_issues: number
  medium_issues: number
  low_issues: number
  estimated_monthly_cost: number
  weekly_stats: {
    prs_created: number
    files_changed: number
    issues_resolved: number
    daily_activity: number[]
  }
  ai_time_saved_hours: number
  pending_staged: Array<{
    user_name: string
    file_count: number
  }>
}

const fetchTeamDetails = async (teamId: string): Promise<TeamDetails> => {
  const token = localStorage.getItem('token')
  const response = await fetch(getApiEndpoint(`/teams/${teamId}`), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error('Failed to fetch team')
  return response.json()
}

const fetchTeamMembers = async (teamId: string): Promise<TeamMember[]> => {
  const token = localStorage.getItem('token')
  const response = await fetch(getApiEndpoint(`/teams/${teamId}/members`), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error('Failed to fetch members')
  return response.json()
}

const fetchTeamRepos = async (teamId: string): Promise<TeamRepo[]> => {
  const token = localStorage.getItem('token')
  const response = await fetch(getApiEndpoint(`/teams/${teamId}/repositories`), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error('Failed to fetch repositories')
  return response.json()
}

const fetchTeamDashboard = async (teamId: string): Promise<TeamDashboard> => {
  const token = localStorage.getItem('token')
  const response = await fetch(getApiEndpoint(`/teams/${teamId}/dashboard`), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error('Failed to fetch dashboard')
  return response.json()
}

const fetchMyPermissions = async (teamId: string) => {
  const token = localStorage.getItem('token')
  const response = await fetch(getApiEndpoint(`/teams/${teamId}/permissions`), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error('Failed to fetch permissions')
  return response.json()
}

// Role permissions display
const ROLE_INFO = {
  admin: {
    label: 'Admin',
    color: 'text-[#a855f7] bg-[#a855f7]/10',
    icon: Crown,
    permissions: ['Full access', 'Manage members', 'Manage repos', 'Billing access'],
  },
  developer: {
    label: 'Developer',
    color: 'text-[#14b8a6] bg-[#14b8a6]/10',
    icon: Code,
    permissions: ['Read/write code', 'Create PRs', 'View members'],
  },
  viewer: {
    label: 'Viewer',
    color: 'text-[#666666] bg-[#666666]/10',
    icon: Eye,
    permissions: ['Read-only access', 'View repos', 'View members'],
  },
}

export default function TeamDetailsPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const teamId = params.teamId as string

  const [activeTab, setActiveTab] = useState<'dashboard' | 'members' | 'repos' | 'wiki' | 'settings'>('dashboard')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'developer' | 'viewer'>('developer')
  const [copied, setCopied] = useState(false)
  const [showRoleDropdown, setShowRoleDropdown] = useState<string | null>(null)
  const [wikiContent, setWikiContent] = useState<Record<string, string>>({})
  const [editingWiki, setEditingWiki] = useState<string | null>(null)
  const [selectedWikiRepo, setSelectedWikiRepo] = useState<string | null>(null)
  const [wikiData, setWikiData] = useState<Record<string, any>>({})
  const [loadingWiki, setLoadingWiki] = useState<string | null>(null)
  const [selectedWikiFile, setSelectedWikiFile] = useState<any>(null)
  const [wikiSimpleMode, setWikiSimpleMode] = useState(true) // Toggle between simple/technical

  // Helper function to fetch files from GitHub/Electron and generate wiki
  const fetchWikiForRepo = async (repoFullName: string, simpleMode: boolean) => {
    setLoadingWiki(repoFullName)
    try {
      const [owner, repoName] = repoFullName.split('/')
      const token = localStorage.getItem('token')
      const ghToken = localStorage.getItem('github_token')
      
      let fileContents: Array<{ path: string; content: string }> = []
      const codeExtensions = ['.tf', '.json', '.yaml', '.yml', '.md', '.hcl', '.tfvars']
      
      // PRIORITY 1: Try Electron API for local files (like TeamWiki)
      const electronAPI = (window as any).electronAPI
      if (electronAPI?.getFileTree && electronAPI?.readFile) {
        console.log('📚 Wiki: Using Electron to read files...')
        try {
          // Get file tree from Electron
          const treeResult = await electronAPI.getFileTree(owner, repoName, '')
          console.log('📚 Wiki: File tree result:', treeResult)
          
          if (treeResult?.success && treeResult?.items) {
            // Recursively collect ALL code files
            const collectFiles = async (items: any[], basePath: string = ''): Promise<void> => {
              for (const item of items) {
                const itemPath = basePath ? `${basePath}/${item.name}` : item.name
                const isCodeFile = codeExtensions.some(ext => item.name.endsWith(ext))
                
                if (item.type === 'file' && isCodeFile) {
                  try {
                    const result = await electronAPI.readFile(owner, repoName, itemPath)
                    if (result?.success && result?.content) {
                      fileContents.push({ path: itemPath, content: result.content })
                      console.log(`📚 Wiki: Read file ${itemPath} (${result.content.length} chars)`)
                    }
                  } catch (e) {
                    console.warn(`Failed to read file ${itemPath}:`, e)
                  }
                } else if (item.type === 'folder' || item.type === 'directory') {
                  // Recursively get files from subdirectories
                  const subTreeResult = await electronAPI.getFileTree(owner, repoName, itemPath)
                  if (subTreeResult?.success && subTreeResult?.items) {
                    await collectFiles(subTreeResult.items, itemPath)
                  }
                }
              }
            }
            await collectFiles(treeResult.items)
          }
        } catch (e) {
          console.warn('Failed to read files from Electron:', e)
        }
      }
      
      // PRIORITY 2: Try GitHub API if no files from Electron
      if (fileContents.length === 0 && ghToken) {
        console.log('📚 Wiki: Falling back to GitHub API...')
        // Try main branch first, then master
        let treeData = null
        for (const branch of ['main', 'master']) {
          try {
            const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/trees/${branch}?recursive=1`, {
              headers: { Authorization: `token ${ghToken}` }
            })
            if (treeRes.ok) {
              treeData = await treeRes.json()
              console.log(`📚 Wiki: Got tree from ${branch} branch`)
              break
            }
          } catch (e) {
            continue
          }
        }
        
        if (treeData?.tree) {
          // Get all code files
          const codeFiles = treeData.tree.filter((f: any) => 
            f.type === 'blob' && codeExtensions.some(ext => f.path.endsWith(ext))
          ) || []
          
          console.log(`📚 Wiki: Found ${codeFiles.length} code files in ${repoFullName}`)
          
          // Fetch content for each file (limit to 50 for performance)
          for (const file of codeFiles.slice(0, 50)) {
            try {
              const contentRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${file.path}`, {
                headers: { Authorization: `token ${ghToken}` }
              })
              if (contentRes.ok) {
                const contentData = await contentRes.json()
                if (contentData.content) {
                  const content = atob(contentData.content)
                  fileContents.push({ path: file.path, content })
                  console.log(`📚 Wiki: Fetched ${file.path} from GitHub`)
                }
              }
            } catch (e) {
              console.warn(`Failed to fetch ${file.path}:`, e)
            }
          }
        }
      }
      
      console.log(`📚 Wiki: Sending ${fileContents.length} files to backend`)
      
      const response = await fetch(getApiEndpoint(`/wiki/generate/${owner}/${repoName}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ simple_mode: simpleMode, files: fileContents }),
      })
      
      if (response.ok) {
        const data = await response.json()
        console.log('📚 Wiki: Got response with', data.files?.length, 'files')
        setWikiData(prev => ({ ...prev, [repoFullName]: data }))
      }
    } catch (error) {
      console.error('Failed to fetch wiki:', error)
    } finally {
      setLoadingWiki(null)
    }
  }
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isCheckingDrift, setIsCheckingDrift] = useState(false)
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
  const [scanResults, setScanResults] = useState<any>(null)
  const [driftResults, setDriftResults] = useState<any>(null)
  const [showResultsModal, setShowResultsModal] = useState<'security' | 'drift' | 'report' | null>(null)

  const { data: team, isLoading, error } = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => fetchTeamDetails(teamId),
    enabled: !!teamId,
  })

  const { data: members = [] } = useQuery({
    queryKey: ['team-members', teamId],
    queryFn: () => fetchTeamMembers(teamId),
    enabled: !!teamId,
  })

  const { data: repos = [] } = useQuery({
    queryKey: ['team-repos', teamId],
    queryFn: () => fetchTeamRepos(teamId),
    enabled: !!teamId,
  })

  const { data: dashboard } = useQuery({
    queryKey: ['team-dashboard', teamId],
    queryFn: () => fetchTeamDashboard(teamId),
    enabled: !!teamId,
  })

  const { data: myPermissions } = useQuery({
    queryKey: ['team-permissions', teamId],
    queryFn: () => fetchMyPermissions(teamId),
    enabled: !!teamId,
  })

  const isAdmin = myPermissions?.role === 'admin'

  const inviteMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      const response = await fetch(getApiEndpoint(`/teams/${teamId}/invitations`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ email, role }),
      })
      if (!response.ok) throw new Error('Failed to invite')
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team', teamId] })
      queryClient.invalidateQueries({ queryKey: ['team-members', teamId] })
      setShowInviteModal(false)
      setInviteEmail('')
    },
  })

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const response = await fetch(getApiEndpoint(`/teams/${teamId}/members/${userId}/role`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ role }),
      })
      if (!response.ok) throw new Error('Failed to update role')
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members', teamId] })
      setShowRoleDropdown(null)
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await fetch(getApiEndpoint(`/teams/${teamId}/members/${userId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      })
      if (!response.ok) throw new Error('Failed to remove member')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members', teamId] })
    },
  })

  const handleEnterWorkspace = () => {
    // Store team ID in session storage for IDE to pick up
    sessionStorage.setItem('enter_team_workspace', teamId)
    router.push('/dashboard/ide')
  }

  const copyInviteLink = () => {
    const link = `driftbox://invite/${teamId}`
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const getPlanBadge = (plan: string) => {
    const badges = {
      free: { icon: Sparkles, color: 'text-[#14b8a6] bg-[#14b8a6]/10', label: 'Free' },
      team: { icon: Users, color: 'text-[#a855f7] bg-[#a855f7]/10', label: 'Team' },
      enterprise: { icon: Crown, color: 'text-[#eab308] bg-[#eab308]/10', label: 'Enterprise' },
    }
    const badge = badges[plan as keyof typeof badges] || badges.free
    const Icon = badge.icon
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>
        <Icon className="w-3 h-3" />
        {badge.label}
      </span>
    )
  }

  const getRoleBadge = (role: string) => {
    const info = ROLE_INFO[role as keyof typeof ROLE_INFO] || ROLE_INFO.viewer
    const Icon = info.icon
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${info.color}`}>
        <Icon className="w-3 h-3" />
        {info.label}
      </span>
    )
  }

  const getSecurityScoreColor = (score: number) => {
    if (score >= 80) return 'text-[#22c55e]'
    if (score >= 60) return 'text-[#eab308]'
    return 'text-[#ef4444]'
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0a0a]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1f1f1f] border-t-[#14b8a6]" />
      </div>
    )
  }

  if (error || !team) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#0a0a0a]">
        <p className="text-[#ef4444] mb-4">Failed to load team</p>
        <button
          onClick={() => router.push('/dashboard/teams')}
          className="text-sm text-[#14b8a6] hover:underline"
        >
          Back to Teams
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/dashboard/teams')}
          className="flex items-center gap-2 text-sm text-[#666666] hover:text-[#a1a1a1] mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Teams
        </button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-[#14b8a6] to-[#0d9488] text-2xl font-bold text-white">
              {team.name[0].toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-[#fafafa]">{team.name}</h1>
                {getPlanBadge(team.plan)}
                {myPermissions?.role && getRoleBadge(myPermissions.role)}
              </div>
              <p className="text-sm text-[#666666] mt-1">
                {team.member_count} members · {team.repo_count} repos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-2 rounded-md border border-[#1f1f1f] px-4 py-2 text-sm font-medium text-[#a1a1a1] hover:bg-[#141414] transition-colors"
            >
              <UserPlus className="h-4 w-4" />
              Invite
            </button>
            <button
              onClick={handleEnterWorkspace}
              className="flex items-center gap-2 rounded-md bg-[#14b8a6] px-4 py-2 text-sm font-medium text-white hover:bg-[#0d9488] transition-colors"
            >
              <Play className="h-4 w-4" />
              Enter Workspace
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <div className="flex gap-6">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
            { id: 'members', icon: Users, label: 'Members' },
            { id: 'repos', icon: GitBranch, label: 'Repositories' },
            { id: 'wiki', icon: Book, label: 'Wiki' },
            { id: 'settings', icon: Settings, label: 'Settings' },
          ].map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-2 pb-3 text-sm font-medium transition-colors relative ${
                  activeTab === tab.id
                    ? 'text-[#14b8a6]'
                    : 'text-[#666666] hover:text-[#a1a1a1]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#14b8a6]" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Refresh Button */}
          <div className="flex justify-end">
            <button
              onClick={() => {
                setIsRefreshing(true)
                queryClient.invalidateQueries({ queryKey: ['team-dashboard', teamId] })
                setTimeout(() => setIsRefreshing(false), 1000)
              }}
              disabled={isRefreshing}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#1f1f1f] bg-[#0f0f0f] text-[#666666] hover:bg-[#141414] hover:text-[#a1a1a1] transition-colors disabled:opacity-50"
              title="Refresh dashboard"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Stats Grid - Enterprise Design */}
          <div className="grid grid-cols-4 gap-4">
            {/* Security Score - Circular Gauge */}
            <div className="relative p-5 rounded-xl border overflow-hidden group hover:border-[#14b8a6]/30 transition-all bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#14b8a6]/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-[#14b8a6]/10 transition-all" />
              <div className="relative flex items-center gap-4">
                <div className="relative w-20 h-20 flex-shrink-0">
                  <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="32" fill="none" stroke="#1f1f1f" strokeWidth="6" />
                    <circle
                      cx="40" cy="40" r="32" fill="none"
                      stroke={(dashboard?.security_score || 100) >= 80 ? '#22c55e' : (dashboard?.security_score || 100) >= 60 ? '#eab308' : '#ef4444'}
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${((dashboard?.security_score || 100) / 100) * 201} 201`}
                      className="transition-all duration-1000"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <ShieldCheck className={`h-6 w-6 ${(dashboard?.security_score || 100) >= 80 ? 'text-[#22c55e]' : (dashboard?.security_score || 100) >= 60 ? 'text-[#eab308]' : 'text-[#ef4444]'}`} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-[#666666] mb-1">Security Score</p>
                  <p className={`text-3xl font-bold ${getSecurityScoreColor(dashboard?.security_score || 100)}`}>
                    {dashboard?.security_score || 100}
                  </p>
                  <p className="text-xs text-[#666666] mt-1">{dashboard?.total_security_issues || 0} issues found</p>
                </div>
              </div>
            </div>

            {/* Monthly Cost - Money Style */}
            <div className="relative p-5 rounded-xl border overflow-hidden group hover:border-[#22c55e]/30 transition-all bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#22c55e]/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-[#22c55e]/10 transition-all" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-[#22c55e]" />
                  <p className="text-xs font-medium uppercase tracking-wider text-[#666666]">Est. Monthly Cost</p>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-sm text-[#22c55e]">$</span>
                  <span className="text-4xl font-bold text-[#fafafa]">{dashboard?.estimated_monthly_cost?.toFixed(0) || 0}</span>
                </div>
                <p className="text-xs text-[#666666] mt-2">Across all repos</p>
              </div>
            </div>

            {/* Weekly PRs - Activity Style */}
            <div className="relative p-5 rounded-xl border overflow-hidden group hover:border-[#a855f7]/30 transition-all bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#a855f7]/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-[#a855f7]/10 transition-all" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <GitBranch className="h-4 w-4 text-[#a855f7]" />
                  <p className="text-xs font-medium uppercase tracking-wider text-[#666666]">PRs This Week</p>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-4xl font-bold text-[#fafafa]">{dashboard?.weekly_stats?.prs_created || 0}</p>
                    <p className="text-xs text-[#22c55e] mt-1 flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      {dashboard?.weekly_stats?.issues_resolved || 0} merged
                    </p>
                  </div>
                  {/* Mini bar chart */}
                  <div className="flex items-end gap-1 h-12">
                    {(dashboard?.weekly_stats?.daily_activity || [3, 5, 2, 7, 4, 6, 5]).map((h, i) => (
                      <div 
                        key={i} 
                        className="w-1.5 rounded-full bg-gradient-to-t from-[#a855f7]/40 to-[#a855f7] transition-all hover:from-[#a855f7]/60"
                        style={{ height: `${Math.max(h * 5, 8)}px` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* AI Time Saved - Glow Style */}
            <div className="relative p-5 rounded-xl border overflow-hidden group hover:border-[#f59e0b]/30 transition-all bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#f59e0b]/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-[#f59e0b]/10 transition-all" />
              <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-[#f59e0b]/0 via-[#f59e0b]/50 to-[#f59e0b]/0" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="h-4 w-4 text-[#f59e0b]" />
                  <p className="text-xs font-medium uppercase tracking-wider text-[#666666]">AI Time Saved</p>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-[#f59e0b]">{dashboard?.ai_time_saved_hours || 0}</span>
                  <span className="text-lg text-[#f59e0b]/60">h</span>
                </div>
                <p className="text-xs text-[#666666] mt-2">This week</p>
              </div>
            </div>
          </div>

          {/* Two Column Layout */}
          <div className="grid grid-cols-2 gap-4">
            {/* Security Issues - Enhanced */}
            <div className="rounded-lg border border-[#1f1f1f] bg-[#0f0f0f] overflow-hidden">
              <div className="px-5 py-4 flex items-center justify-between border-b border-[#1f1f1f]">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-[#ef4444]" />
                  <h2 className="font-medium text-[#fafafa]">Security Issues</h2>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-[#1a1a1a] text-[#666666]">
                  {(dashboard?.critical_issues || 0) + (dashboard?.high_issues || 0) + (dashboard?.medium_issues || 0) + (dashboard?.low_issues || 0)} total
                </span>
              </div>
              <div className="p-5 space-y-3">
                {[
                  { label: 'Critical', count: dashboard?.critical_issues || 0, color: 'bg-[#ef4444]', textColor: 'text-[#ef4444]' },
                  { label: 'High', count: dashboard?.high_issues || 0, color: 'bg-[#f97316]', textColor: 'text-[#f97316]' },
                  { label: 'Medium', count: dashboard?.medium_issues || 0, color: 'bg-[#eab308]', textColor: 'text-[#eab308]' },
                  { label: 'Low', count: dashboard?.low_issues || 0, color: 'bg-[#22c55e]', textColor: 'text-[#22c55e]' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between group hover:bg-[#141414] -mx-2 px-2 py-1.5 rounded transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                      <span className="text-sm text-[#a1a1a1]">{item.label}</span>
                    </div>
                    <span className={`text-sm font-semibold ${item.count > 0 ? item.textColor : 'text-[#666666]'}`}>{item.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pending Reviews - Enhanced */}
            <div className="rounded-lg border border-[#1f1f1f] bg-[#0f0f0f] overflow-hidden">
              <div className="px-5 py-4 flex items-center justify-between border-b border-[#1f1f1f]">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-[#eab308]" />
                  <h2 className="font-medium text-[#fafafa]">Pending Reviews</h2>
                </div>
                {dashboard?.pending_staged && dashboard.pending_staged.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-[#eab308]/10 text-[#eab308]">
                    {dashboard.pending_staged.length} pending
                  </span>
                )}
              </div>
              {dashboard?.pending_staged && dashboard.pending_staged.length > 0 ? (
                <div className="divide-y divide-[#1f1f1f]">
                  {dashboard.pending_staged.map((item, idx) => (
                    <div key={idx} className="px-5 py-3 flex items-center justify-between hover:bg-[#141414] transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#14b8a6] to-[#0d9488] flex items-center justify-center text-xs font-semibold text-white">
                          {item.user_name[0].toUpperCase()}
                        </div>
                        <div>
                          <span className="text-sm font-medium text-[#fafafa]">{item.user_name}</span>
                          <p className="text-xs text-[#666666]">{item.file_count} files staged</p>
                        </div>
                      </div>
                      <button className="text-xs text-[#14b8a6] hover:text-[#0d9488] transition-colors">
                        Review →
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center">
                  <div className="w-12 h-12 rounded-full bg-[#22c55e]/10 flex items-center justify-center mx-auto mb-3">
                    <Check className="h-6 w-6 text-[#22c55e]" />
                  </div>
                  <p className="text-sm font-medium text-[#fafafa] mb-1">No pending reviews</p>
                  <p className="text-xs text-[#666666]">All changes have been reviewed</p>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions - Enterprise Style */}
          <div>
            <h2 className="text-sm font-medium text-[#666666] uppercase tracking-wider mb-4">Quick Actions</h2>
            <div className="grid grid-cols-4 gap-3">
              <button
                onClick={async () => {
                  if (repos.length === 0) {
                    alert('No repositories connected. Add repos to run security scan.')
                    return
                  }
                  setIsScanning(true)
                  try {
                    const allIssues: any[] = []
                    for (const repo of repos) {
                      const totalIssues = (dashboard?.critical_issues || 0) + (dashboard?.high_issues || 0) + (dashboard?.medium_issues || 0) + (dashboard?.low_issues || 0)
                      const repoIssues = {
                        repo: repo.repo_full_name,
                        summary: {
                          total_issues: totalIssues,
                          by_severity: {
                            critical: dashboard?.critical_issues || 0,
                            high: dashboard?.high_issues || 0,
                            medium: dashboard?.medium_issues || 0,
                            low: dashboard?.low_issues || 0,
                          }
                        },
                        issues: totalIssues > 0 ? [
                          ...(dashboard?.critical_issues ? [{ severity: 'critical', message: `${dashboard.critical_issues} critical security issue(s) detected` }] : []),
                          ...(dashboard?.high_issues ? [{ severity: 'high', message: `${dashboard.high_issues} high security issue(s) detected` }] : []),
                          ...(dashboard?.medium_issues ? [{ severity: 'medium', message: `${dashboard.medium_issues} medium security issue(s) detected` }] : []),
                          ...(dashboard?.low_issues ? [{ severity: 'low', message: `${dashboard.low_issues} low security issue(s) detected` }] : []),
                        ] : []
                      }
                      allIssues.push(repoIssues)
                    }
                    setScanResults(allIssues)
                    setShowResultsModal('security')
                    queryClient.invalidateQueries({ queryKey: ['team-dashboard', teamId] })
                  } catch (error) {
                    console.error('Security scan failed:', error)
                    alert('Security scan failed. Please try again.')
                  } finally {
                    setIsScanning(false)
                  }
                }}
                disabled={isScanning}
                className="relative p-4 rounded-xl border border-[#1f1f1f] bg-[#0f0f0f] hover:bg-[#141414] hover:border-[#a855f7]/30 transition-all group disabled:opacity-50 text-left"
              >
                <div className="absolute top-0 right-0 w-20 h-20 bg-[#a855f7]/5 rounded-full blur-2xl -mr-6 -mt-6 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="w-10 h-10 rounded-lg bg-[#a855f7]/10 flex items-center justify-center mb-3">
                    <Shield className={`h-5 w-5 text-[#a855f7] ${isScanning ? 'animate-pulse' : ''}`} />
                  </div>
                  <p className="text-sm font-medium text-[#fafafa] group-hover:text-[#a855f7] transition-colors">
                    {isScanning ? 'Scanning...' : 'Run Security Scan'}
                  </p>
                  <p className="text-xs text-[#666666] mt-1">Analyze all repositories</p>
                </div>
              </button>
              
              <button
                onClick={async () => {
                  if (repos.length === 0) {
                    alert('No repositories connected. Add repos to check drift.')
                    return
                  }
                  setIsCheckingDrift(true)
                  try {
                    const token = localStorage.getItem('token')
                    const allDrifts: any[] = []
                    for (const repo of repos) {
                      const [owner, repoName] = repo.repo_full_name.split('/')
                      const response = await fetch(getApiEndpoint(`/drift/?owner=${owner}&repo=${repoName}&branch=main`), {
                        headers: { Authorization: `Bearer ${token}` },
                      })
                      if (response.ok) {
                        const data = await response.json()
                        allDrifts.push({ repo: repo.repo_full_name, ...data })
                      }
                    }
                    setDriftResults(allDrifts)
                    setShowResultsModal('drift')
                    queryClient.invalidateQueries({ queryKey: ['team-dashboard', teamId] })
                  } catch (error) {
                    console.error('Drift check failed:', error)
                    alert('Drift check failed. Please try again.')
                  } finally {
                    setIsCheckingDrift(false)
                  }
                }}
                disabled={isCheckingDrift}
                className="relative p-4 rounded-xl border border-[#1f1f1f] bg-[#0f0f0f] hover:bg-[#141414] hover:border-[#14b8a6]/30 transition-all group disabled:opacity-50 text-left"
              >
                <div className="absolute top-0 right-0 w-20 h-20 bg-[#14b8a6]/5 rounded-full blur-2xl -mr-6 -mt-6 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="w-10 h-10 rounded-lg bg-[#14b8a6]/10 flex items-center justify-center mb-3">
                    <Activity className={`h-5 w-5 text-[#14b8a6] ${isCheckingDrift ? 'animate-pulse' : ''}`} />
                  </div>
                  <p className="text-sm font-medium text-[#fafafa] group-hover:text-[#14b8a6] transition-colors">
                    {isCheckingDrift ? 'Checking...' : 'Check Drift'}
                  </p>
                  <p className="text-xs text-[#666666] mt-1">Detect configuration drift</p>
                </div>
              </button>
              
              <button
                onClick={async () => {
                  setIsGeneratingReport(true)
                  try {
                    const reportContent = `# ${team.name} Infrastructure Report
Generated: ${new Date().toLocaleString()}

## Team Overview
- Members: ${members.length}
- Repositories: ${repos.length}
- Plan: ${team.plan}

## Security Score
Score: ${dashboard?.security_score || 100}/100
- Critical Issues: ${dashboard?.critical_issues || 0}
- High Issues: ${dashboard?.high_issues || 0}
- Medium Issues: ${dashboard?.medium_issues || 0}
- Low Issues: ${dashboard?.low_issues || 0}

## Cost Estimate
Monthly: $${dashboard?.estimated_monthly_cost?.toFixed(2) || '0.00'}

## Weekly Activity
- PRs Created: ${dashboard?.weekly_stats?.prs_created || 0}
- Files Changed: ${dashboard?.weekly_stats?.files_changed || 0}
- Issues Resolved: ${dashboard?.weekly_stats?.issues_resolved || 0}
- AI Time Saved: ${dashboard?.ai_time_saved_hours || 0} hours

## Repositories
${repos.map(r => `- ${r.repo_full_name}`).join('\n')}

## Team Members
${members.map(m => `- ${m.user?.github_username || m.user?.email} (${m.role})`).join('\n')}
`
                    const blob = new Blob([reportContent], { type: 'text/markdown' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${team.slug}-report-${new Date().toISOString().split('T')[0]}.md`
                    a.click()
                    URL.revokeObjectURL(url)
                    setShowResultsModal('report')
                  } catch (error) {
                    console.error('Report generation failed:', error)
                    alert('Report generation failed. Please try again.')
                  } finally {
                    setIsGeneratingReport(false)
                  }
                }}
                disabled={isGeneratingReport}
                className="relative p-4 rounded-xl border border-[#1f1f1f] bg-[#0f0f0f] hover:bg-[#141414] hover:border-[#22c55e]/30 transition-all group disabled:opacity-50 text-left"
              >
                <div className="absolute top-0 right-0 w-20 h-20 bg-[#22c55e]/5 rounded-full blur-2xl -mr-6 -mt-6 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="w-10 h-10 rounded-lg bg-[#22c55e]/10 flex items-center justify-center mb-3">
                    <FileText className={`h-5 w-5 text-[#22c55e] ${isGeneratingReport ? 'animate-pulse' : ''}`} />
                  </div>
                  <p className="text-sm font-medium text-[#fafafa] group-hover:text-[#22c55e] transition-colors">
                    {isGeneratingReport ? 'Generating...' : 'Generate Report'}
                  </p>
                  <p className="text-xs text-[#666666] mt-1">Download infrastructure report</p>
                </div>
              </button>
              
              <button
                onClick={() => setShowInviteModal(true)}
                className="relative p-4 rounded-xl border border-[#1f1f1f] bg-[#0f0f0f] hover:bg-[#141414] hover:border-[#eab308]/30 transition-all group text-left"
              >
                <div className="absolute top-0 right-0 w-20 h-20 bg-[#eab308]/5 rounded-full blur-2xl -mr-6 -mt-6 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="w-10 h-10 rounded-lg bg-[#eab308]/10 flex items-center justify-center mb-3">
                    <UserPlus className="h-5 w-5 text-[#eab308]" />
                  </div>
                  <p className="text-sm font-medium text-[#fafafa] group-hover:text-[#eab308] transition-colors">Invite Member</p>
                  <p className="text-xs text-[#666666] mt-1">Add team collaborators</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results Modal */}
      {showResultsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="w-full max-w-2xl max-h-[80vh] rounded-lg bg-[#0f0f0f] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1f1f]">
              <h3 className="font-semibold text-[#fafafa]">
                {showResultsModal === 'security' && 'Security Scan Results'}
                {showResultsModal === 'drift' && 'Drift Detection Results'}
                {showResultsModal === 'report' && 'Report Generated'}
              </h3>
              <button
                onClick={() => setShowResultsModal(null)}
                className="text-[#666666] hover:text-[#a1a1a1]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              {showResultsModal === 'security' && (
                <div className="space-y-4">
                  {!scanResults || scanResults.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="h-16 w-16 rounded-full bg-[#22c55e]/10 flex items-center justify-center mx-auto mb-4">
                        <Shield className="h-8 w-8 text-[#22c55e]" />
                      </div>
                      <p className="text-[#fafafa] font-medium mb-2">No Security Issues Found</p>
                      <p className="text-sm text-[#666666]">
                        {repos.length === 0 
                          ? 'Connect repositories to run security scans.'
                          : 'All repositories passed security checks!'}
                      </p>
                    </div>
                  ) : (
                    scanResults.map((result: any, idx: number) => (
                      <div key={idx} className="rounded-lg bg-[#141414] p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <GitBranch className="h-4 w-4 text-[#14b8a6]" />
                          <span className="font-medium text-[#fafafa]">{result.repo}</span>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            (result.summary?.total_issues || result.issues?.length || 0) === 0 
                              ? 'bg-[#22c55e]/10 text-[#22c55e]' 
                              : 'bg-[#ef4444]/10 text-[#ef4444]'
                          }`}>
                            {(result.summary?.total_issues || result.issues?.length || 0)} issues
                          </span>
                        </div>
                        {result.summary || result.issues ? (
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-[#666666]">Total Issues:</span>
                              <span className="text-[#fafafa]">{result.summary?.total_issues || result.issues?.length || 0}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[#666666]">Critical:</span>
                              <span className="text-[#ef4444]">{result.summary?.by_severity?.critical || result.issues?.filter((i: any) => i.severity === 'critical').length || 0}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[#666666]">High:</span>
                              <span className="text-[#f97316]">{result.summary?.by_severity?.high || result.issues?.filter((i: any) => i.severity === 'high').length || 0}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[#666666]">Medium:</span>
                              <span className="text-[#eab308]">{result.summary?.by_severity?.medium || result.issues?.filter((i: any) => i.severity === 'medium').length || 0}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[#666666]">Low:</span>
                              <span className="text-[#3b82f6]">{result.summary?.by_severity?.low || result.issues?.filter((i: any) => i.severity === 'low').length || 0}</span>
                            </div>
                            
                            {/* Show individual issues */}
                            {result.issues && result.issues.length > 0 && (
                              <div className="mt-4 pt-4 border-t border-[#1f1f1f] space-y-2">
                                <p className="text-xs text-[#666666] uppercase font-medium">Issues Found:</p>
                                {result.issues.slice(0, 5).map((issue: any, i: number) => (
                                  <div key={i} className="flex items-start gap-2 text-xs">
                                    <span className={`px-1.5 py-0.5 rounded ${
                                      issue.severity === 'critical' ? 'bg-[#ef4444]/10 text-[#ef4444]' :
                                      issue.severity === 'high' ? 'bg-[#f97316]/10 text-[#f97316]' :
                                      issue.severity === 'medium' ? 'bg-[#eab308]/10 text-[#eab308]' :
                                      'bg-[#3b82f6]/10 text-[#3b82f6]'
                                    }`}>
                                      {issue.severity?.toUpperCase() || 'INFO'}
                                    </span>
                                    <span className="text-[#a1a1a1]">{issue.message || issue.title || issue.description || 'Security issue detected'}</span>
                                  </div>
                                ))}
                                {result.issues.length > 5 && (
                                  <p className="text-xs text-[#666666]">...and {result.issues.length - 5} more</p>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-[#22c55e]">✓ No issues found</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
              
              {showResultsModal === 'drift' && (
                <div className="space-y-4">
                  {!driftResults || driftResults.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="h-16 w-16 rounded-full bg-[#14b8a6]/10 flex items-center justify-center mx-auto mb-4">
                        <Activity className="h-8 w-8 text-[#14b8a6]" />
                      </div>
                      <p className="text-[#fafafa] font-medium mb-2">No Drift Detected</p>
                      <p className="text-sm text-[#666666]">
                        {repos.length === 0 
                          ? 'Connect repositories to check for drift.'
                          : 'All repositories are in sync with their infrastructure state.'}
                      </p>
                    </div>
                  ) : (
                    driftResults.map((result: any, idx: number) => (
                      <div key={idx} className="rounded-lg bg-[#141414] p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <GitBranch className="h-4 w-4 text-[#14b8a6]" />
                          <span className="font-medium text-[#fafafa]">{result.repo}</span>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            (result.total_changes || result.changes?.length || 0) === 0 
                              ? 'bg-[#22c55e]/10 text-[#22c55e]' 
                              : 'bg-[#eab308]/10 text-[#eab308]'
                          }`}>
                            {(result.total_changes || result.changes?.length || 0)} changes
                          </span>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-[#666666]">Total Changes:</span>
                            <span className="text-[#fafafa]">{result.total_changes || result.changes?.length || 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#666666]">Added:</span>
                            <span className="text-[#22c55e]">+{result.summary?.added || result.changes?.filter((c: any) => c.action === 'add').length || 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#666666]">Removed:</span>
                            <span className="text-[#ef4444]">-{result.summary?.removed || result.changes?.filter((c: any) => c.action === 'destroy').length || 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#666666]">Modified:</span>
                            <span className="text-[#eab308]">~{result.summary?.modified || result.changes?.filter((c: any) => c.action === 'change' || c.action === 'update').length || 0}</span>
                          </div>
                          
                          {/* Show individual changes */}
                          {result.changes && result.changes.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-[#1f1f1f] space-y-2">
                              <p className="text-xs text-[#666666] uppercase font-medium">Changes Detected:</p>
                              {result.changes.slice(0, 5).map((change: any, i: number) => (
                                <div key={i} className="flex items-start gap-2 text-xs">
                                  <span className={`px-1.5 py-0.5 rounded font-mono ${
                                    change.action === 'add' ? 'bg-[#22c55e]/10 text-[#22c55e]' :
                                    change.action === 'destroy' ? 'bg-[#ef4444]/10 text-[#ef4444]' :
                                    'bg-[#eab308]/10 text-[#eab308]'
                                  }`}>
                                    {change.action === 'add' ? '+' : change.action === 'destroy' ? '-' : '~'}
                                  </span>
                                  <span className="text-[#14b8a6] font-mono">{change.resource_type || change.type}</span>
                                  <span className="text-[#a1a1a1]">{change.resource_name || change.name}</span>
                                </div>
                              ))}
                              {result.changes.length > 5 && (
                                <p className="text-xs text-[#666666]">...and {result.changes.length - 5} more</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
              
              {showResultsModal === 'report' && (
                <div className="text-center py-8">
                  <div className="h-16 w-16 rounded-full bg-[#22c55e]/10 flex items-center justify-center mx-auto mb-4">
                    <Check className="h-8 w-8 text-[#22c55e]" />
                  </div>
                  <p className="text-[#fafafa] font-medium mb-2">Report Downloaded!</p>
                  <p className="text-sm text-[#666666]">
                    Your infrastructure report has been downloaded as a Markdown file.
                  </p>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-[#1f1f1f]">
              <button
                onClick={() => setShowResultsModal(null)}
                className="w-full rounded-md bg-[#14b8a6] px-4 py-2 text-sm font-medium text-white hover:bg-[#0d9488] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members Tab */}
      {activeTab === 'members' && (
        <div className="space-y-6">
          {/* RBAC Info Banner - Enhanced */}
          {isAdmin && (
            <div className="relative rounded-xl border border-[#14b8a6]/20 bg-gradient-to-r from-[#14b8a6]/5 to-transparent p-4 flex items-start gap-4 overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#14b8a6]/10 rounded-full blur-3xl -mr-10 -mt-10" />
              <div className="w-10 h-10 rounded-lg bg-[#14b8a6]/10 flex items-center justify-center flex-shrink-0">
                <Shield className="h-5 w-5 text-[#14b8a6]" />
              </div>
              <div className="relative">
                <p className="text-sm font-medium text-[#fafafa]">Admin Access Enabled</p>
                <p className="text-xs text-[#666666] mt-1">
                  You can manage member roles, remove members, and control access permissions for this team.
                </p>
              </div>
            </div>
          )}

          {/* Members Table - Enterprise Style */}
          <div className="rounded-lg border border-[#1f1f1f] bg-[#0f0f0f] overflow-hidden">
            {/* Table Header */}
            <div className="px-4 py-3 border-b border-[#1f1f1f] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Users className="h-4 w-4 text-[#14b8a6]" />
                <h2 className="font-medium text-[#fafafa]">Team Members</h2>
                <span className="text-xs px-2 py-0.5 rounded bg-[#1a1a1a] text-[#666666]">{members.length}</span>
              </div>
              {isAdmin && (
                <button
                  onClick={() => setShowInviteModal(true)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] text-sm text-[#a1a1a1] hover:bg-[#141414] hover:border-[#14b8a6]/30 transition-all"
                >
                  <UserPlus className="h-4 w-4 text-[#14b8a6]" />
                  Add member
                </button>
              )}
            </div>
            
            {/* Table Column Headers */}
            <div className="grid grid-cols-12 gap-4 px-4 py-2 border-b border-[#1f1f1f] text-xs font-medium uppercase tracking-wider text-[#666666]">
              <div className="col-span-4">Member</div>
              <div className="col-span-2">Role</div>
              <div className="col-span-3">Status</div>
              <div className="col-span-2">Joined</div>
              <div className="col-span-1"></div>
            </div>
            
            {members.length > 0 ? (
              <div className="divide-y divide-[#1f1f1f]">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-[#141414] transition-colors items-center"
                  >
                    {/* Member Info */}
                    <div className="col-span-4 flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#14b8a6] to-[#0d9488] text-xs font-semibold text-white">
                        {(member.user?.github_username || member.user?.email || '?')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#fafafa] truncate">
                          {member.user?.github_username || member.user?.email?.split('@')[0] || 'Unknown'}
                        </p>
                        <p className="text-xs text-[#666666] truncate">{member.user?.email || 'No email'}</p>
                      </div>
                    </div>
                    
                    {/* Role */}
                    <div className="col-span-2">
                      {getRoleBadge(member.role)}
                    </div>
                    
                    {/* Status */}
                    <div className="col-span-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs ${member.joined_at ? 'text-[#22c55e]' : 'text-[#eab308]'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${member.joined_at ? 'bg-[#22c55e]' : 'bg-[#eab308] animate-pulse'}`} />
                        {member.joined_at ? 'Active' : 'Pending Invite'}
                      </span>
                    </div>
                    
                    {/* Joined */}
                    <div className="col-span-2">
                      <span className="text-xs text-[#666666]">
                        {member.joined_at ? new Date(member.joined_at).toLocaleDateString() : '—'}
                      </span>
                    </div>
                    
                    {/* Actions */}
                    <div className="col-span-1 flex justify-end">
                      {isAdmin && member.role !== 'admin' && (
                        <div className="relative">
                          <button 
                            onClick={() => setShowRoleDropdown(showRoleDropdown === member.id ? null : member.id)}
                            className="p-1.5 rounded-md hover:bg-[#1a1a1a] text-[#666666] hover:text-[#a1a1a1] transition-colors"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          
                          {showRoleDropdown === member.id && (
                            <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-[#1f1f1f] bg-[#0f0f0f] shadow-xl z-10 overflow-hidden">
                              <div className="px-3 py-2 border-b border-[#1f1f1f] text-xs text-[#666666] uppercase tracking-wider">
                                Change Role
                              </div>
                              {['developer', 'viewer'].map((role) => (
                                <button
                                  key={role}
                                  onClick={() => updateRoleMutation.mutate({ userId: member.user_id, role })}
                                  className={`w-full px-3 py-2 text-left text-sm hover:bg-[#141414] flex items-center gap-2 transition-colors ${
                                    member.role === role ? 'text-[#14b8a6]' : 'text-[#a1a1a1]'
                                  }`}
                                >
                                  {member.role === role && <Check className="h-3 w-3" />}
                                  {role.charAt(0).toUpperCase() + role.slice(1)}
                                </button>
                              ))}
                              <div className="border-t border-[#1f1f1f]">
                                <button
                                  onClick={() => {
                                    if (confirm('Remove this member from the team?')) {
                                      removeMemberMutation.mutate(member.user_id)
                                    }
                                    setShowRoleDropdown(null)
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm text-[#ef4444] hover:bg-[#ef4444]/5 flex items-center gap-2 transition-colors"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  Remove from team
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center">
                <div className="w-12 h-12 rounded-full bg-[#1a1a1a] flex items-center justify-center mx-auto mb-3">
                  <Users className="h-6 w-6 text-[#666666]" />
                </div>
                <p className="text-sm font-medium text-[#fafafa] mb-1">No members yet</p>
                <p className="text-xs text-[#666666]">Invite team members to collaborate</p>
              </div>
            )}
          </div>

          {/* Role Permissions Reference - Card Grid */}
          <div>
            <h2 className="text-sm font-medium text-[#666666] uppercase tracking-wider mb-4">Role Permissions</h2>
            <div className="grid grid-cols-3 gap-4">
              {Object.entries(ROLE_INFO).map(([key, info]) => {
                const Icon = info.icon
                const colorMap: Record<string, string> = {
                  admin: '#a855f7',
                  developer: '#14b8a6',
                  viewer: '#666666'
                }
                const color = colorMap[key] || '#666666'
                return (
                  <div key={key} className="relative rounded-xl border border-[#1f1f1f] bg-[#0f0f0f] p-5 overflow-hidden group hover:border-[${color}]/30 transition-all">
                    <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl -mr-8 -mt-8 opacity-0 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: `${color}10` }} />
                    <div className="relative">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: `${color}15` }}>
                        <Icon className="h-5 w-5" style={{ color }} />
                      </div>
                      <h3 className="font-medium text-[#fafafa] mb-3">{info.label}</h3>
                      <ul className="space-y-2">
                        {info.permissions.map((perm, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-xs text-[#a1a1a1]">
                            <Check className="h-3 w-3 text-[#22c55e]" />
                            {perm}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Repos Tab */}
      {activeTab === 'repos' && (
        <div className="space-y-6">
          {/* Repos Table */}
          <div className="rounded-lg border border-[#1f1f1f] bg-[#0f0f0f] overflow-hidden">
            {/* Table Header */}
            <div className="px-4 py-3 border-b border-[#1f1f1f] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <GitBranch className="h-4 w-4 text-[#a855f7]" />
                <h2 className="font-medium text-[#fafafa]">Connected Repositories</h2>
                <span className="text-xs px-2 py-0.5 rounded bg-[#1a1a1a] text-[#666666]">{repos.length}</span>
              </div>
              <button
                onClick={handleEnterWorkspace}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] text-sm text-[#a1a1a1] hover:bg-[#141414] hover:border-[#a855f7]/30 transition-all"
              >
                <Play className="h-4 w-4 text-[#a855f7]" />
                Open IDE
              </button>
            </div>
            
            {/* Table Column Headers */}
            <div className="grid grid-cols-12 gap-4 px-4 py-2 border-b border-[#1f1f1f] text-xs font-medium uppercase tracking-wider text-[#666666]">
              <div className="col-span-5">Repository</div>
              <div className="col-span-2">Owner</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Added</div>
              <div className="col-span-1"></div>
            </div>
            
            {repos.length > 0 ? (
              <div className="divide-y divide-[#1f1f1f]">
                {repos.map((repo, idx) => (
                  <div
                    key={repo.id}
                    onClick={() => {
                      sessionStorage.setItem('enter_team_workspace', teamId)
                      sessionStorage.setItem('open_repo', repo.repo_full_name)
                      router.push('/dashboard/ide')
                    }}
                    className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-[#141414] transition-colors cursor-pointer items-center group"
                  >
                    {/* Repository Name */}
                    <div className="col-span-5 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#a855f7]/20 to-[#a855f7]/5 flex items-center justify-center">
                        <GitBranch className="h-4 w-4 text-[#a855f7]" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#fafafa] truncate group-hover:text-[#a855f7] transition-colors">
                          {repo.repo_name}
                        </p>
                        <p className="text-xs text-[#666666] truncate font-mono">{repo.repo_full_name}</p>
                      </div>
                    </div>
                    
                    {/* Owner */}
                    <div className="col-span-2">
                      <span className="text-sm text-[#a1a1a1]">{repo.repo_owner}</span>
                    </div>
                    
                    {/* Status */}
                    <div className="col-span-2">
                      <span className="inline-flex items-center gap-1.5 text-xs text-[#22c55e]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                        Connected
                      </span>
                    </div>
                    
                    {/* Added Date */}
                    <div className="col-span-2">
                      <span className="text-xs text-[#666666]">
                        {new Date(repo.added_at).toLocaleDateString()}
                      </span>
                    </div>
                    
                    {/* Action */}
                    <div className="col-span-1 flex justify-end">
                      <span className="text-xs text-[#666666] group-hover:text-[#a855f7] transition-colors">
                        Open →
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#a855f7]/20 to-[#a855f7]/5 flex items-center justify-center mx-auto mb-4">
                  <GitBranch className="h-7 w-7 text-[#a855f7]" />
                </div>
                <p className="text-sm font-medium text-[#fafafa] mb-1">No repositories connected</p>
                <p className="text-xs text-[#666666] mb-4">Open a repo in the IDE while in team mode to add it</p>
                <button
                  onClick={handleEnterWorkspace}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#a855f7] text-white text-sm font-medium hover:bg-[#9333ea] transition-colors"
                >
                  <Play className="h-4 w-4" />
                  Enter Workspace
                </button>
              </div>
            )}
          </div>
          
          {/* Quick Info Cards */}
          {repos.length > 0 && (
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-xl border border-[#1f1f1f] bg-[#0f0f0f] p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-[#22c55e]/10 flex items-center justify-center">
                    <Check className="h-4 w-4 text-[#22c55e]" />
                  </div>
                  <span className="text-2xl font-bold text-[#fafafa]">{repos.length}</span>
                </div>
                <p className="text-xs text-[#666666]">Connected repos</p>
              </div>
              <div className="rounded-xl border border-[#1f1f1f] bg-[#0f0f0f] p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-[#14b8a6]/10 flex items-center justify-center">
                    <Activity className="h-4 w-4 text-[#14b8a6]" />
                  </div>
                  <span className="text-2xl font-bold text-[#fafafa]">{dashboard?.weekly_stats?.files_changed || 0}</span>
                </div>
                <p className="text-xs text-[#666666]">Files changed this week</p>
              </div>
              <div className="rounded-xl border border-[#1f1f1f] bg-[#0f0f0f] p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-[#a855f7]/10 flex items-center justify-center">
                    <GitBranch className="h-4 w-4 text-[#a855f7]" />
                  </div>
                  <span className="text-2xl font-bold text-[#fafafa]">{dashboard?.weekly_stats?.prs_created || 0}</span>
                </div>
                <p className="text-xs text-[#666666]">PRs this week</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Wiki Tab - Per-Repo Documentation */}
      {activeTab === 'wiki' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Repo List Sidebar */}
          <div className="lg:col-span-1 rounded-lg bg-[#0f0f0f] overflow-hidden h-fit">
            <div className="px-4 py-3">
              <h3 className="text-sm font-medium text-[#fafafa]">Repositories</h3>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {/* Team Overview */}
              <button
                onClick={() => {
                  setSelectedWikiRepo(null)
                  setSelectedWikiFile(null)
                }}
                className={`w-full px-4 py-3 text-left hover:bg-[#141414] transition-colors flex items-center gap-3 ${
                  selectedWikiRepo === null ? 'bg-[#14b8a6]/10 border-l-2 border-[#14b8a6]' : ''
                }`}
              >
                <div className="h-8 w-8 rounded-md bg-[#1a1a1a] flex items-center justify-center">
                  <Users className="h-4 w-4 text-[#14b8a6]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${selectedWikiRepo === null ? 'text-[#14b8a6]' : 'text-[#fafafa]'}`}>
                    Team Overview
                  </p>
                  <p className="text-xs text-[#666666]">General docs</p>
                </div>
              </button>
              
              {/* Individual Repos */}
              {repos.map((repo) => (
                <button
                  key={repo.id}
                  onClick={async () => {
                    setSelectedWikiRepo(repo.repo_full_name)
                    setSelectedWikiFile(null)
                    
                    // Auto-fetch wiki if not already loaded
                    if (!wikiData[repo.repo_full_name]) {
                      await fetchWikiForRepo(repo.repo_full_name, wikiSimpleMode)
                    }
                  }}
                  className={`w-full px-4 py-3 text-left hover:bg-[#141414] transition-colors flex items-center gap-3 ${
                    selectedWikiRepo === repo.repo_full_name ? 'bg-[#14b8a6]/10 border-l-2 border-[#14b8a6]' : ''
                  }`}
                >
                  <div className="h-8 w-8 rounded-md bg-[#1a1a1a] flex items-center justify-center">
                    <GitBranch className="h-4 w-4 text-[#666666]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${selectedWikiRepo === repo.repo_full_name ? 'text-[#14b8a6]' : 'text-[#fafafa]'}`}>
                      {repo.repo_name}
                    </p>
                    <p className="text-xs text-[#666666] truncate">{repo.repo_owner}</p>
                  </div>
                  {wikiData[repo.repo_full_name] && (
                    <div className="h-2 w-2 rounded-full bg-[#22c55e]" title="Documentation loaded" />
                  )}
                </button>
              ))}
              
              {repos.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-[#666666]">No repos connected</p>
                </div>
              )}
            </div>
          </div>
          
          {/* Wiki Content Area */}
          <div className="lg:col-span-3 rounded-lg bg-[#0f0f0f] overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 flex items-center justify-between border-b border-[#1f1f1f]">
              <div className="flex items-center gap-3">
                {selectedWikiRepo ? (
                  <>
                    <GitBranch className="h-4 w-4 text-[#14b8a6]" />
                    <h2 className="font-medium text-[#fafafa]">{selectedWikiRepo}</h2>
                    {wikiData[selectedWikiRepo]?.stats && (
                      <div className="flex items-center gap-3 ml-4">
                        <span className="text-xs text-[#666666]">
                          {wikiData[selectedWikiRepo].stats.totalFiles} files
                        </span>
                        <span className="text-xs text-[#666666]">
                          {wikiData[selectedWikiRepo].stats.resources} resources
                        </span>
                        <span className={`text-xs ${wikiData[selectedWikiRepo].stats.securityScore >= 80 ? 'text-[#22c55e]' : wikiData[selectedWikiRepo].stats.securityScore >= 60 ? 'text-[#eab308]' : 'text-[#ef4444]'}`}>
                          {wikiData[selectedWikiRepo].stats.securityScore}/100 security
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <Book className="h-4 w-4 text-[#14b8a6]" />
                    <h2 className="font-medium text-[#fafafa]">Team Overview</h2>
                  </>
                )}
              </div>
              
              {/* Simple/Technical Toggle */}
              {selectedWikiRepo && wikiData[selectedWikiRepo] && (
                <button
                  onClick={() => {
                    const newMode = !wikiSimpleMode
                    setWikiSimpleMode(newMode)
                    // Regenerate wiki with new mode
                    fetchWikiForRepo(selectedWikiRepo, newMode)
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#141414] text-xs text-[#a1a1a1] hover:bg-[#1a1a1a] transition-colors"
                >
                  {wikiSimpleMode ? (
                    <>
                      <ToggleLeft className="h-4 w-4 text-[#14b8a6]" />
                      <span>Simple</span>
                    </>
                  ) : (
                    <>
                      <ToggleRight className="h-4 w-4 text-[#a855f7]" />
                      <span>Technical</span>
                    </>
                  )}
                </button>
              )}
            </div>
            
            {/* Content */}
            <div className="flex">
              {/* File List for Repo */}
              {selectedWikiRepo && wikiData[selectedWikiRepo]?.files && (
                <div className="w-64 border-r border-[#1f1f1f] max-h-[60vh] overflow-y-auto">
                  <div className="px-3 py-2 text-xs font-medium text-[#666666] uppercase tracking-wider">
                    Files
                  </div>
                  {wikiData[selectedWikiRepo].files.map((file: any, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedWikiFile(file)}
                      className={`w-full px-3 py-2 text-left hover:bg-[#141414] transition-colors flex items-center gap-2 ${
                        selectedWikiFile?.path === file.path ? 'bg-[#14b8a6]/10 text-[#14b8a6]' : 'text-[#a1a1a1]'
                      }`}
                    >
                      <Code className="h-3 w-3 flex-shrink-0" />
                      <span className="text-xs truncate">{file.name}</span>
                      {file.resources?.length > 0 && (
                        <span className="ml-auto text-[10px] text-[#666666]">{file.resources.length}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              
              {/* Main Content */}
              <div className="flex-1 p-5 max-h-[60vh] overflow-y-auto">
                {loadingWiki === selectedWikiRepo ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <RefreshCw className="h-6 w-6 text-[#14b8a6] animate-spin" />
                      <p className="text-sm text-[#666666]">Generating documentation...</p>
                    </div>
                  </div>
                ) : selectedWikiRepo && wikiData[selectedWikiRepo] ? (
                  selectedWikiFile ? (
                    // Show file details
                    <div className="space-y-6">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Code className="h-4 w-4 text-[#14b8a6]" />
                          <h3 className="font-medium text-[#fafafa]">{selectedWikiFile.name}</h3>
                          <span className="text-xs text-[#666666]">{selectedWikiFile.line_count || 0} lines</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-[#1a1a1a] text-[#666666]">.{selectedWikiFile.extension}</span>
                        </div>
                        {selectedWikiFile.explanation && (
                          <div className="rounded-lg bg-[#141414] p-4 mt-3">
                            <p className="text-sm text-[#a1a1a1]">
                              {typeof selectedWikiFile.explanation === 'string'
                                ? selectedWikiFile.explanation
                                : wikiSimpleMode 
                                  ? (selectedWikiFile.explanation?.simple || selectedWikiFile.explanation?.technical || '')
                                  : (selectedWikiFile.explanation?.technical || selectedWikiFile.explanation?.simple || '')}
                            </p>
                          </div>
                        )}
                      </div>
                      
                      {/* Security & Cost */}
                      <div className="grid grid-cols-2 gap-4">
                        {selectedWikiFile.security && (
                          <div className="rounded-lg bg-[#141414] p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Shield className="h-4 w-4 text-[#a855f7]" />
                              <span className="text-sm font-medium text-[#fafafa]">Security</span>
                            </div>
                            <div className={`text-2xl font-bold ${selectedWikiFile.security.score >= 80 ? 'text-[#22c55e]' : selectedWikiFile.security.score >= 60 ? 'text-[#eab308]' : 'text-[#ef4444]'}`}>
                              {selectedWikiFile.security.score}/100
                            </div>
                            {selectedWikiFile.security.issues?.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {selectedWikiFile.security.issues.slice(0, 3).map((issue: any, idx: number) => (
                                  <p key={idx} className="text-xs text-[#ef4444]">• {typeof issue === 'string' ? issue : issue.message || issue.title}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {selectedWikiFile.cost && (
                          <div className="rounded-lg bg-[#141414] p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <DollarSign className="h-4 w-4 text-[#22c55e]" />
                              <span className="text-sm font-medium text-[#fafafa]">Cost</span>
                            </div>
                            <div className="text-2xl font-bold text-[#fafafa]">{selectedWikiFile.cost.estimate}</div>
                            <p className="text-xs text-[#666666] mt-1">{selectedWikiFile.cost.breakdown}</p>
                          </div>
                        )}
                      </div>
                      
                      {/* Resources with Registry Links */}
                      {selectedWikiFile.resources?.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-[#fafafa] mb-3">
                            Resources ({selectedWikiFile.resources.length})
                          </h4>
                          <div className="space-y-3">
                            {selectedWikiFile.resources.map((resource: any, idx: number) => {
                              // Generate Terraform Registry link
                              const resourceType = resource.type || ''
                              const [provider, ...resourceParts] = resourceType.split('_')
                              const resourceName = resourceParts.join('_')
                              const registryUrl = provider === 'aws' 
                                ? `https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/${resourceName}`
                                : provider === 'google'
                                ? `https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/${resourceName}`
                                : provider === 'azurerm'
                                ? `https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/${resourceName}`
                                : provider === 'digitalocean'
                                ? `https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/${resourceName}`
                                : `https://registry.terraform.io/search/providers?q=${resourceType}`
                              
                              return (
                                <div key={idx} className="rounded-lg bg-[#141414] p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-mono text-[#14b8a6]">{resource.type}</span>
                                      <span className="text-sm text-[#666666]">.</span>
                                      <span className="text-sm font-medium text-[#fafafa]">{resource.name}</span>
                                    </div>
                                    <a
                                      href={registryUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1 text-xs text-[#14b8a6] hover:text-[#0d9488] transition-colors"
                                    >
                                      <Link2 className="h-3 w-3" />
                                      Registry Docs
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </div>
                                  {resource.explanation && (
                                    <p className="text-sm text-[#a1a1a1] mt-2">
                                      {typeof resource.explanation === 'string' 
                                        ? resource.explanation 
                                        : wikiSimpleMode
                                          ? (resource.explanation?.simple || resource.explanation?.technical || '')
                                          : (resource.explanation?.technical || resource.explanation?.simple || '')}
                                    </p>
                                  )}
                                  {/* Show provider badge */}
                                  <div className="flex items-center gap-2 mt-3">
                                    <span className={`text-[10px] px-2 py-0.5 rounded ${
                                      provider === 'aws' ? 'bg-[#ff9900]/10 text-[#ff9900]' :
                                      provider === 'google' ? 'bg-[#4285f4]/10 text-[#4285f4]' :
                                      provider === 'azurerm' ? 'bg-[#0078d4]/10 text-[#0078d4]' :
                                      provider === 'digitalocean' ? 'bg-[#0080ff]/10 text-[#0080ff]' :
                                      'bg-[#666666]/10 text-[#666666]'
                                    }`}>
                                      {provider.toUpperCase()}
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      
                      {/* Variables */}
                      {selectedWikiFile.variables?.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-[#fafafa] mb-3">Variables ({selectedWikiFile.variables.length})</h4>
                          <div className="rounded-lg bg-[#141414] overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-[#1f1f1f]">
                                  <th className="text-left px-3 py-2 text-[#666666] font-medium">Name</th>
                                  <th className="text-left px-3 py-2 text-[#666666] font-medium">Type</th>
                                  <th className="text-left px-3 py-2 text-[#666666] font-medium">Default</th>
                                  <th className="text-left px-3 py-2 text-[#666666] font-medium">Description</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedWikiFile.variables.map((v: any, idx: number) => (
                                  <tr key={idx} className="border-b border-[#1f1f1f] last:border-0">
                                    <td className="px-3 py-2 font-mono text-[#14b8a6]">{v.name}</td>
                                    <td className="px-3 py-2 text-[#a1a1a1]">{v.type || 'string'}</td>
                                    <td className="px-3 py-2 text-[#666666] font-mono text-[10px]">{v.default || '-'}</td>
                                    <td className="px-3 py-2 text-[#666666]">{v.description || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                      
                      {/* Outputs */}
                      {selectedWikiFile.outputs?.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-[#fafafa] mb-3">Outputs ({selectedWikiFile.outputs.length})</h4>
                          <div className="rounded-lg bg-[#141414] overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-[#1f1f1f]">
                                  <th className="text-left px-3 py-2 text-[#666666] font-medium">Name</th>
                                  <th className="text-left px-3 py-2 text-[#666666] font-medium">Value</th>
                                  <th className="text-left px-3 py-2 text-[#666666] font-medium">Description</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedWikiFile.outputs.map((o: any, idx: number) => (
                                  <tr key={idx} className="border-b border-[#1f1f1f] last:border-0">
                                    <td className="px-3 py-2 font-mono text-[#a855f7]">{o.name}</td>
                                    <td className="px-3 py-2 text-[#666666] font-mono text-[10px]">{o.value || '-'}</td>
                                    <td className="px-3 py-2 text-[#666666]">{o.description || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                      
                      {/* Providers */}
                      {selectedWikiFile.providers?.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-[#fafafa] mb-3">Providers</h4>
                          <div className="flex flex-wrap gap-2">
                            {selectedWikiFile.providers.map((p: any, idx: number) => (
                              <a
                                key={idx}
                                href={`https://registry.terraform.io/providers/hashicorp/${typeof p === 'string' ? p : p.name}/latest`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#141414] text-sm text-[#a1a1a1] hover:bg-[#1a1a1a] transition-colors"
                              >
                                <span>{typeof p === 'string' ? p : p.name}</span>
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Modules */}
                      {selectedWikiFile.modules?.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-[#fafafa] mb-3">Modules</h4>
                          <div className="space-y-2">
                            {selectedWikiFile.modules.map((m: any, idx: number) => (
                              <div key={idx} className="rounded-lg bg-[#141414] p-3 flex items-center justify-between">
                                <div>
                                  <span className="text-sm font-medium text-[#fafafa]">{typeof m === 'string' ? m : m.name}</span>
                                  {m.source && (
                                    <p className="text-xs text-[#666666] font-mono mt-1">{m.source}</p>
                                  )}
                                </div>
                                {m.source?.includes('registry.terraform.io') && (
                                  <a
                                    href={`https://${m.source}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-[#14b8a6] hover:text-[#0d9488]"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Sections */}
                      {selectedWikiFile.sections?.map((section: any, idx: number) => (
                        <div key={idx}>
                          <h4 className="text-sm font-medium text-[#fafafa] mb-2">{section.title}</h4>
                          <p className="text-sm text-[#a1a1a1]">
                            {typeof section.content === 'string' ? section.content : JSON.stringify(section.content)}
                          </p>
                        </div>
                      ))}
                      
                      {/* Open in IDE */}
                      <div className="pt-4 border-t border-[#1f1f1f]">
                        <button
                          onClick={() => {
                            sessionStorage.setItem('enter_team_workspace', teamId)
                            sessionStorage.setItem('open_file', selectedWikiFile.path)
                            router.push('/dashboard/ide')
                          }}
                          className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#14b8a6] text-white text-sm hover:bg-[#0d9488] transition-colors"
                        >
                          <Code className="h-4 w-4" />
                          Open in IDE
                        </button>
                      </div>
                    </div>
                  ) : (
                    // Show repo overview
                    <div className="space-y-6">
                      <div>
                        <h3 className="font-medium text-[#fafafa] mb-2">Summary</h3>
                        <p className="text-sm text-[#a1a1a1]">
                          {typeof wikiData[selectedWikiRepo].summary === 'string'
                            ? wikiData[selectedWikiRepo].summary
                            : wikiData[selectedWikiRepo].summary?.simple || wikiData[selectedWikiRepo].summary?.technical || 'No summary available'}
                        </p>
                      </div>
                      
                      {/* Stats Cards */}
                      <div className="grid grid-cols-4 gap-4">
                        <div className="rounded-lg bg-[#141414] p-4 text-center">
                          <div className="text-2xl font-bold text-[#fafafa]">{wikiData[selectedWikiRepo].stats?.totalFiles || 0}</div>
                          <div className="text-xs text-[#666666]">Files</div>
                        </div>
                        <div className="rounded-lg bg-[#141414] p-4 text-center">
                          <div className="text-2xl font-bold text-[#fafafa]">{wikiData[selectedWikiRepo].stats?.resources || 0}</div>
                          <div className="text-xs text-[#666666]">Resources</div>
                        </div>
                        <div className="rounded-lg bg-[#141414] p-4 text-center">
                          <div className={`text-2xl font-bold ${(wikiData[selectedWikiRepo].stats?.securityScore || 100) >= 80 ? 'text-[#22c55e]' : 'text-[#eab308]'}`}>
                            {wikiData[selectedWikiRepo].stats?.securityScore || 100}
                          </div>
                          <div className="text-xs text-[#666666]">Security</div>
                        </div>
                        <div className="rounded-lg bg-[#141414] p-4 text-center">
                          <div className="text-2xl font-bold text-[#fafafa]">{wikiData[selectedWikiRepo].stats?.estimatedCost || '$0'}</div>
                          <div className="text-xs text-[#666666]">Est. Cost</div>
                        </div>
                      </div>
                      
                      <p className="text-xs text-[#666666]">← Select a file from the sidebar to view detailed documentation</p>
                    </div>
                  )
                ) : selectedWikiRepo ? (
                  // No wiki data yet
                  <div className="flex items-center justify-center py-16">
                    <div className="text-center">
                      <Book className="h-12 w-12 text-[#666666] mx-auto mb-4" />
                      <p className="text-[#666666] mb-4">Click to generate documentation</p>
                      <button
                        onClick={() => fetchWikiForRepo(selectedWikiRepo, wikiSimpleMode)}
                        className="flex items-center gap-2 mx-auto px-4 py-2 rounded-md bg-[#14b8a6] text-white text-sm hover:bg-[#0d9488] transition-colors"
                      >
                        <Zap className="h-4 w-4" />
                        Generate Documentation
                      </button>
                    </div>
                  </div>
                ) : (
                  // Team Overview
                  <div className="space-y-6">
                    <div>
                      <h3 className="font-medium text-[#fafafa] mb-4">Team Documentation</h3>
                      <p className="text-sm text-[#a1a1a1] mb-6">
                        Welcome to the {team.name} infrastructure documentation. Select a repository from the sidebar to view its auto-generated documentation including files, resources, security scores, and cost estimates.
                      </p>
                    </div>
                    
                    {/* Quick Stats */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="rounded-lg bg-[#141414] p-4 text-center">
                        <div className="text-3xl font-bold text-[#fafafa]">{repos.length}</div>
                        <div className="text-xs text-[#666666]">Repositories</div>
                      </div>
                      <div className="rounded-lg bg-[#141414] p-4 text-center">
                        <div className="text-3xl font-bold text-[#fafafa]">{members.length}</div>
                        <div className="text-xs text-[#666666]">Members</div>
                      </div>
                      <div className="rounded-lg bg-[#141414] p-4 text-center">
                        <div className="text-3xl font-bold text-[#22c55e]">{dashboard?.security_score || 100}</div>
                        <div className="text-xs text-[#666666]">Avg Security</div>
                      </div>
                    </div>
                    
                    {/* Repo Links */}
                    <div>
                      <h4 className="text-sm font-medium text-[#fafafa] mb-3">Quick Links</h4>
                      <div className="space-y-2">
                        {repos.slice(0, 5).map((repo) => (
                          <button
                            key={repo.id}
                            onClick={() => setSelectedWikiRepo(repo.repo_full_name)}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-[#141414] hover:bg-[#1a1a1a] transition-colors text-left"
                          >
                            <GitBranch className="h-4 w-4 text-[#14b8a6]" />
                            <span className="text-sm text-[#fafafa]">{repo.repo_name}</span>
                            <span className="text-xs text-[#666666] ml-auto">View docs →</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          {/* General Settings */}
          <div className="rounded-lg border border-[#1f1f1f] bg-[#0f0f0f] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1f1f1f] flex items-center gap-3">
              <Settings className="h-4 w-4 text-[#14b8a6]" />
              <h2 className="font-medium text-[#fafafa]">General Settings</h2>
            </div>
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-medium text-[#666666] uppercase tracking-wider mb-2">Team Name</label>
                  <input
                    type="text"
                    defaultValue={team.name}
                    disabled={!isAdmin}
                    className="w-full rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-2.5 text-sm text-[#fafafa] focus:outline-none focus:border-[#14b8a6] disabled:opacity-50 transition-colors"
                  />
                  <p className="text-xs text-[#666666] mt-1.5">The display name for your team</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#666666] uppercase tracking-wider mb-2">Team Slug</label>
                  <input
                    type="text"
                    defaultValue={team.slug}
                    disabled
                    className="w-full rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-2.5 text-sm text-[#666666] font-mono"
                  />
                  <p className="text-xs text-[#666666] mt-1.5">Used in URLs and API references</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-medium text-[#666666] uppercase tracking-wider mb-2">Plan</label>
                  <div className="flex items-center gap-3">
                    {getPlanBadge(team.plan)}
                    <span className="text-xs text-[#666666]">{team.seats_limit} seats available</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#666666] uppercase tracking-wider mb-2">Created</label>
                  <p className="text-sm text-[#a1a1a1]">{new Date(team.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Invite Link */}
          <div className="rounded-lg border border-[#1f1f1f] bg-[#0f0f0f] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1f1f1f] flex items-center gap-3">
              <Link2 className="h-4 w-4 text-[#a855f7]" />
              <h2 className="font-medium text-[#fafafa]">Invite Link</h2>
            </div>
            <div className="p-5">
              <p className="text-sm text-[#666666] mb-4">
                Share this link to invite people to your team. Anyone with this link can request to join.
              </p>
              <div className="flex items-center gap-3">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={`driftbox://invite/${team.id}`}
                    readOnly
                    className="w-full rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] pl-4 pr-12 py-2.5 text-sm text-[#a1a1a1] font-mono"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Link2 className="h-4 w-4 text-[#666666]" />
                  </div>
                </div>
                <button
                  onClick={copyInviteLink}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                    copied 
                      ? 'bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/30'
                      : 'bg-[#a855f7] text-white hover:bg-[#9333ea]'
                  }`}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="rounded-lg border border-[#1f1f1f] bg-[#0f0f0f] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1f1f1f] flex items-center gap-3">
              <Activity className="h-4 w-4 text-[#22c55e]" />
              <h2 className="font-medium text-[#fafafa]">Notifications</h2>
            </div>
            <div className="divide-y divide-[#1f1f1f]">
              {[
                { label: 'Security alerts', desc: 'Get notified about security issues', enabled: true },
                { label: 'PR activity', desc: 'Notifications for PR reviews and merges', enabled: true },
                { label: 'Drift detection', desc: 'Alerts when infrastructure drift is detected', enabled: false },
              ].map((item, idx) => (
                <div key={idx} className="px-5 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[#fafafa]">{item.label}</p>
                    <p className="text-xs text-[#666666] mt-0.5">{item.desc}</p>
                  </div>
                  <button className={`relative w-11 h-6 rounded-full transition-colors ${item.enabled ? 'bg-[#14b8a6]' : 'bg-[#1f1f1f]'}`}>
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${item.enabled ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Danger Zone */}
          {isAdmin && (
            <div className="rounded-lg border border-[#ef4444]/20 bg-[#ef4444]/5 overflow-hidden">
              <div className="px-4 py-3 border-b border-[#ef4444]/20 flex items-center gap-3">
                <AlertTriangle className="h-4 w-4 text-[#ef4444]" />
                <h2 className="font-medium text-[#ef4444]">Danger Zone</h2>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-4">
                  <div>
                    <p className="text-sm font-medium text-[#fafafa]">Transfer Ownership</p>
                    <p className="text-xs text-[#666666] mt-0.5">Transfer this team to another admin</p>
                  </div>
                  <button className="rounded-lg border border-[#1f1f1f] px-4 py-2 text-sm text-[#a1a1a1] hover:bg-[#141414] transition-colors">
                    Transfer
                  </button>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-[#ef4444]/20 bg-[#ef4444]/5 p-4">
                  <div>
                    <p className="text-sm font-medium text-[#fafafa]">Delete Team</p>
                    <p className="text-xs text-[#666666] mt-0.5">Permanently delete this team and all its data</p>
                  </div>
                  <button className="rounded-lg border border-[#ef4444]/30 bg-[#ef4444]/10 px-4 py-2 text-sm font-medium text-[#ef4444] hover:bg-[#ef4444]/20 transition-colors">
                    Delete Team
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="w-full max-w-md rounded-lg bg-[#0f0f0f]">
            <div className="flex items-center justify-between px-5 py-4">
              <h3 className="font-semibold text-[#fafafa]">Invite team member</h3>
              <button
                onClick={() => setShowInviteModal(false)}
                className="text-[#666666] hover:text-[#a1a1a1]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm text-[#666666] mb-2">Email address</label>
                <div className="flex items-center gap-2 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2">
                  <Mail className="h-4 w-4 text-[#666666]" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="flex-1 bg-transparent text-sm text-[#fafafa] placeholder-[#666666] focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm text-[#666666] mb-2">Role</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['admin', 'developer', 'viewer'] as const).map((role) => {
                    const info = ROLE_INFO[role]
                    const Icon = info.icon
                    return (
                      <button
                        key={role}
                        onClick={() => setInviteRole(role)}
                        className={`p-3 rounded-md border text-left transition-colors ${
                          inviteRole === role
                            ? 'border-[#14b8a6] bg-[#14b8a6]/10'
                            : 'border-[#1f1f1f] hover:border-[#333333]'
                        }`}
                      >
                        <Icon className={`h-4 w-4 mb-1 ${inviteRole === role ? 'text-[#14b8a6]' : 'text-[#666666]'}`} />
                        <p className={`text-sm font-medium ${inviteRole === role ? 'text-[#14b8a6]' : 'text-[#a1a1a1]'}`}>
                          {info.label}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowInviteModal(false)}
                  className="flex-1 rounded-md border border-[#1f1f1f] px-4 py-2 text-sm text-[#a1a1a1] hover:bg-[#141414] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => inviteMutation.mutate({ email: inviteEmail, role: inviteRole })}
                  disabled={!inviteEmail.trim() || inviteMutation.isPending}
                  className="flex-1 rounded-md bg-[#14b8a6] px-4 py-2 text-sm font-medium text-white hover:bg-[#0d9488] disabled:opacity-50 transition-colors"
                >
                  {inviteMutation.isPending ? 'Sending...' : 'Send Invite'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
