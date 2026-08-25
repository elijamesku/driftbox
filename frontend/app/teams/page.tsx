'use client'

/**
 * Teams Page - Vercel-inspired with filters and status
 * Uses TanStack Query for fast data fetching with caching
 * In Electron/desktop mode, also handles team detail views via query params
 */

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'

// Dynamically import TeamDetailsClient for when viewing a specific team (desktop mode only)
const TeamDetailsClient = dynamic(
  () => import('./[teamId]/TeamDetailsClient'),
  { ssr: false }
)

// Dynamically import AcceptInvitationClient for invite handling (desktop mode only)
const AcceptInvitationClient = dynamic(
  () => import('./invite/[token]/AcceptInvitationClient'),
  { ssr: false }
)
import { 
  Users, Plus, ArrowRight, Crown, Sparkles, 
  Shield, TrendingUp, X, GitBranch, Activity,
  Clock, Calendar, Search, ChevronDown, Filter,
  MoreHorizontal, Check, Circle
} from 'lucide-react'
import { getApiEndpoint } from '@/utils/apiEndpoint'

interface Team {
  id: string
  name: string
  slug: string
  plan: string
  seats_limit: number
  member_count: number
  repo_count: number
  created_at: string
}

// Fetch functions
const fetchTeams = async (): Promise<Team[]> => {
  const token = localStorage.getItem('token')
  console.log('[Teams] Fetching teams with token:', token ? 'present' : 'missing')
  
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout
  
  try {
    const url = getApiEndpoint('/teams/')
    console.log('[Teams] API URL:', url)
    
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: controller.signal
    })
    
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      console.error('[Teams] Response not ok:', response.status, response.statusText)
      throw new Error(`Failed to fetch teams: ${response.status}`)
    }
    
    const data = await response.json()
    console.log('[Teams] Loaded teams:', data)
    return data
  } catch (error: any) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      console.error('[Teams] Request timed out')
      throw new Error('Request timed out. Please check your connection.')
    }
    throw error
  }
}

// Check if we're in desktop/Electron mode
const isDesktopMode = () => {
  if (typeof window === 'undefined') return false
  return !!(
    (window as any).electronAPI ||
    window.location.protocol === 'file:' ||
    (window.location.hostname === 'localhost' && window.location.port === '3000' && (window as any).electronAPI)
  )
}

// Inner component that handles query param routing (only used in desktop mode)
function TeamsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  
  // ALL HOOKS MUST BE DECLARED BEFORE ANY CONDITIONAL RETURNS
  const [inDesktopMode, setInDesktopMode] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  
  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [planFilter, setPlanFilter] = useState<string | null>(null)
  const [showPlanDropdown, setShowPlanDropdown] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [showStatusDropdown, setShowStatusDropdown] = useState(false)
  
  // Navigation states
  const [activeNavTab, setActiveNavTab] = useState<'overview' | 'activity' | 'settings'>('overview')
  const [globalSearch, setGlobalSearch] = useState('')
  const [showGlobalSearchResults, setShowGlobalSearchResults] = useState(false)
  const globalSearchRef = useRef<HTMLInputElement>(null)

  // Check if we're actually in desktop mode (not just dev server on localhost:3000)
  useEffect(() => {
    setInDesktopMode(isDesktopMode())
  }, [])

  // Keyboard shortcut for ⌘K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        globalSearchRef.current?.focus()
        setShowGlobalSearchResults(true)
      }
      if (e.key === 'Escape') {
        setShowGlobalSearchResults(false)
        globalSearchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // TanStack Query for teams
  const { data: teams = [], isLoading: loading, error, isError } = useQuery({
    queryKey: ['teams'],
    queryFn: fetchTeams,
    staleTime: 30 * 1000, // 30 seconds
    retry: 1, // Only retry once
    retryDelay: 1000,
  })

  // Helper to navigate to team details (uses query params in desktop mode)
  const navigateToTeam = (teamId: string) => {
    if (isDesktopMode()) {
      router.push(`/teams?teamId=${teamId}`)
    } else {
      router.push(`/teams/${teamId}`)
    }
  }

  // Create team mutation
  const createTeamMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await fetch(getApiEndpoint('/teams/'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ name })
      })
      if (!response.ok) throw new Error('Failed to create team')
      return response.json()
    },
    onSuccess: (newTeam) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      setTeamName('')
      setShowCreateModal(false)
      navigateToTeam(newTeam.id)
    },
    onError: () => {
      alert('Failed to create team')
    }
  })

  const createTeam = () => {
    if (!teamName.trim() || createTeamMutation.isPending) return
    createTeamMutation.mutate(teamName)
  }
  
  const creating = createTeamMutation.isPending

  // In desktop mode, check for teamId or inviteToken query params
  const teamIdFromQuery = searchParams.get('teamId')
  const inviteTokenFromQuery = searchParams.get('inviteToken')
  
  // Only render inline components in actual desktop mode (not dev server)
  // These returns are AFTER all hooks, so React is happy
  if (inDesktopMode && teamIdFromQuery) {
    return <TeamDetailsClient />
  }
  
  if (inDesktopMode && inviteTokenFromQuery) {
    return <AcceptInvitationClient />
  }

  const handleBackToIDE = () => {
    sessionStorage.setItem('restore_ide_state', 'true')
    router.push('/ide')
  }

  const handleJoinTeam = () => {
    if (!inviteLink.trim()) return
    
    // Extract token from driftbox://invite/{token} or just use as token
    let token = inviteLink.trim()
    if (token.startsWith('driftbox://invite/')) {
      token = token.replace('driftbox://invite/', '')
    } else if (token.includes('/invite/')) {
      token = token.split('/invite/')[1]
    }
    
    if (token) {
      if (isDesktopMode()) {
        router.push(`/teams?inviteToken=${token}`)
      } else {
        router.push(`/teams/invite/${token}`)
      }
    }
  }

  // Filter teams based on search and filters
  const filteredTeams = teams.filter(team => {
    const matchesSearch = searchQuery === '' || 
      team.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesPlan = planFilter === null || team.plan === planFilter
    return matchesSearch && matchesPlan
  })

  const getPlanBadge = (plan: string) => {
    const badges = {
      free: { icon: Sparkles, color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20', label: 'Free' },
      team: { icon: Users, color: 'text-purple-400 bg-purple-500/10 border-purple-500/20', label: 'Team' },
      enterprise: { icon: Crown, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: 'Enterprise' }
    }
    const badge = badges[plan as keyof typeof badges] || badges.free
    const Icon = badge.icon
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${badge.color}`}>
        <Icon className="w-3.5 h-3.5" />
        {badge.label}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-[#333] border-t-white rounded-full animate-spin"></div>
          <p className="text-sm text-[#666]">Loading teams...</p>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center max-w-md">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <X className="w-6 h-6 text-red-400" />
          </div>
          <p className="text-lg font-medium text-white">Failed to load teams</p>
          <p className="text-sm text-[#666]">{error?.message || 'Unable to connect to the server. Please check your connection.'}</p>
          <button 
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-white text-black rounded-md text-sm font-medium hover:bg-gray-100 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Top Navigation Bar */}
      <div className="border-b border-[#333] bg-[#0a0a0a]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            {/* Breadcrumb */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleBackToIDE}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 transition-colors"
              >
                <span className="font-bold text-sm">K</span>
              </button>
              <span className="text-[#444]">/</span>
              <span className="text-white font-medium">Teams</span>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#111] border border-[#333] rounded-md min-w-[200px]">
                  <Search className="w-4 h-4 text-[#666]" />
                  <input
                    ref={globalSearchRef}
                    type="text"
                    placeholder="Find teams, members..."
                    value={globalSearch}
                    onChange={(e) => {
                      setGlobalSearch(e.target.value)
                      setShowGlobalSearchResults(true)
                    }}
                    onFocus={() => setShowGlobalSearchResults(true)}
                    onBlur={() => setTimeout(() => setShowGlobalSearchResults(false), 200)}
                    className="bg-transparent text-sm text-white placeholder-[#666] focus:outline-none flex-1"
                  />
                  <span className="text-xs text-[#444] border border-[#333] rounded px-1">⌘K</span>
                </div>
                {showGlobalSearchResults && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-[#111] border border-[#333] rounded-lg shadow-xl z-50 overflow-hidden">
                    <div className="p-2 text-xs text-[#666] border-b border-[#333]">Quick Actions</div>
                    <button 
                      onClick={() => { setShowCreateModal(true); setShowGlobalSearchResults(false); setGlobalSearch(''); }}
                      className="w-full px-3 py-2 text-left text-sm text-[#888] hover:bg-[#222] flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" /> Create new team
                    </button>
                    <button 
                      onClick={() => { setShowJoinModal(true); setShowGlobalSearchResults(false); setGlobalSearch(''); }}
                      className="w-full px-3 py-2 text-left text-sm text-[#888] hover:bg-[#222] flex items-center gap-2"
                    >
                      <Users className="w-4 h-4" /> Join a team
                    </button>
                    {teams.filter(t => t.name.toLowerCase().includes(globalSearch.toLowerCase())).length > 0 && (
                      <>
                        <div className="p-2 text-xs text-[#666] border-t border-[#333]">Teams</div>
                        {teams.filter(t => t.name.toLowerCase().includes(globalSearch.toLowerCase())).slice(0, 3).map(team => (
                          <button 
                            key={team.id}
                            onClick={() => { navigateToTeam(team.id); setShowGlobalSearchResults(false); setGlobalSearch(''); }}
                            className="w-full px-3 py-2 text-left text-sm text-white hover:bg-[#222] flex items-center gap-2"
                          >
                            <Circle className="w-2 h-2 fill-green-500 text-green-500" />
                            {team.name}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={handleBackToIDE}
                className="p-2 rounded-md hover:bg-[#111] transition-colors"
                title="Back to IDE"
              >
                <X className="w-5 h-5 text-[#666]" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sub Navigation */}
      <div className="border-b border-[#333] bg-[#0a0a0a]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center gap-6 h-11 text-sm">
            <button 
              onClick={() => setActiveNavTab('overview')}
              className={`relative h-full flex items-center ${activeNavTab === 'overview' ? 'text-white' : 'text-[#888] hover:text-white'} transition-colors`}
            >
              <span>Overview</span>
              {activeNavTab === 'overview' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white"></div>}
            </button>
            <button 
              onClick={() => setActiveNavTab('activity')}
              className={`relative h-full flex items-center ${activeNavTab === 'activity' ? 'text-white' : 'text-[#888] hover:text-white'} transition-colors`}
            >
              <span>Activity</span>
              {activeNavTab === 'activity' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white"></div>}
            </button>
            <button 
              onClick={() => setActiveNavTab('settings')}
              className={`relative h-full flex items-center ${activeNavTab === 'settings' ? 'text-white' : 'text-[#888] hover:text-white'} transition-colors`}
            >
              <span>Settings</span>
              {activeNavTab === 'settings' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white"></div>}
            </button>
          </div>
        </div>
      </div>

      {/* Content based on active tab */}
      {activeNavTab === 'overview' && (
        <>
          {/* Header */}
          <div className="border-b border-[#333]">
            <div className="max-w-7xl mx-auto px-6">
              <div className="flex items-center justify-between py-8">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-4">
                    <h1 className="text-3xl font-bold">Teams</h1>
                    <span className="text-sm text-[#666] bg-[#222] px-2 py-0.5 rounded-full">{teams.length}</span>
                    <button className="p-1 hover:bg-[#222] rounded transition-colors">
                      <MoreHorizontal className="w-5 h-5 text-[#666]" />
                    </button>
                  </div>
                  <p className="text-sm text-[#666]">Manage your teams and collaborate on infrastructure</p>
                </div>
              </div>
            </div>
          </div>

      {/* Filter Bar */}
      <div className="bg-[#0a0a0a] py-6">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search */}
            <div className="flex items-center gap-2 px-3 py-2 bg-[#0a0a0a] border border-[#333] rounded-md min-w-[180px] hover:border-[#555] transition-colors">
              <Search className="w-4 h-4 text-[#666]" />
              <input
                type="text"
                placeholder="Search teams..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent text-sm text-white placeholder-[#666] focus:outline-none flex-1"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-[#666] hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Plan Filter */}
            <div className="relative">
              <button 
                onClick={() => { setShowPlanDropdown(!showPlanDropdown); setShowStatusDropdown(false); }}
                className="flex items-center gap-2 px-3 py-2 bg-[#0a0a0a] border border-[#333] rounded-md text-sm text-[#888] hover:border-[#555] transition-colors"
              >
                <Filter className="w-4 h-4 text-[#666]" />
                {planFilter ? planFilter.charAt(0).toUpperCase() + planFilter.slice(1) : 'All Plans'}
                <ChevronDown className="w-4 h-4 text-[#666]" />
              </button>
              {showPlanDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-[#111] border border-[#333] rounded-lg shadow-xl z-20 min-w-[140px] overflow-hidden">
                  <button 
                    onClick={() => { setPlanFilter(null); setShowPlanDropdown(false); }}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-[#222] transition-colors ${planFilter === null ? 'text-white bg-[#222]' : 'text-[#888]'}`}
                  >
                    All Plans
                  </button>
                  <button 
                    onClick={() => { setPlanFilter('free'); setShowPlanDropdown(false); }}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-[#222] transition-colors ${planFilter === 'free' ? 'text-white bg-[#222]' : 'text-[#888]'}`}
                  >
                    Free
                  </button>
                  <button 
                    onClick={() => { setPlanFilter('team'); setShowPlanDropdown(false); }}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-[#222] transition-colors ${planFilter === 'team' ? 'text-white bg-[#222]' : 'text-[#888]'}`}
                  >
                    Team
                  </button>
                  <button 
                    onClick={() => { setPlanFilter('enterprise'); setShowPlanDropdown(false); }}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-[#222] transition-colors ${planFilter === 'enterprise' ? 'text-white bg-[#222]' : 'text-[#888]'}`}
                  >
                    Enterprise
                  </button>
                </div>
              )}
            </div>

            {/* Status Filter */}
            <div className="relative">
              <button 
                onClick={() => { setShowStatusDropdown(!showStatusDropdown); setShowPlanDropdown(false); }}
                className="flex items-center gap-2 px-3 py-2 bg-[#0a0a0a] border border-[#333] rounded-md text-sm text-[#888] hover:border-[#555] transition-colors"
              >
                <div className="flex items-center gap-0.5">
                  <Circle className="w-2 h-2 fill-green-500 text-green-500" />
                  <Circle className="w-2 h-2 fill-yellow-500 text-yellow-500" />
                  <Circle className="w-2 h-2 fill-red-500 text-red-500" />
                </div>
                Status
                <span className="text-[#666]">{filteredTeams.length}/{teams.length}</span>
                <ChevronDown className="w-4 h-4 text-[#666]" />
              </button>
              {showStatusDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-[#111] border border-[#333] rounded-lg shadow-xl z-20 min-w-[140px] overflow-hidden">
                  <button 
                    onClick={() => { setStatusFilter(null); setShowStatusDropdown(false); }}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-[#222] transition-colors flex items-center gap-2 ${statusFilter === null ? 'text-white bg-[#222]' : 'text-[#888]'}`}
                  >
                    <div className="flex items-center gap-0.5">
                      <Circle className="w-2 h-2 fill-green-500 text-green-500" />
                      <Circle className="w-2 h-2 fill-yellow-500 text-yellow-500" />
                      <Circle className="w-2 h-2 fill-red-500 text-red-500" />
                    </div>
                    All Status
                  </button>
                  <button 
                    onClick={() => { setStatusFilter('active'); setShowStatusDropdown(false); }}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-[#222] transition-colors flex items-center gap-2 ${statusFilter === 'active' ? 'text-white bg-[#222]' : 'text-[#888]'}`}
                  >
                    <Circle className="w-2 h-2 fill-green-500 text-green-500" />
                    Active
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1" />

            {/* Action Buttons */}
            <button
              onClick={() => setShowJoinModal(true)}
              className="flex items-center gap-2 px-4 py-2 border border-[#333] rounded-md text-sm font-medium hover:bg-[#111] transition-colors"
            >
              Join team
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-md text-sm font-medium hover:bg-gray-100 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New team
            </button>
          </div>
        </div>
      </div>

      {/* Teams List */}
      <div className="max-w-7xl mx-auto px-6">
        {filteredTeams.length === 0 ? (
          /* Empty state */
          <div className="mt-16 text-center">
            <div className="inline-flex p-4 rounded-full bg-[#111] border border-[#333] mb-4">
              <Users className="w-8 h-8 text-[#666]" />
            </div>
            {teams.length === 0 ? (
              <>
                <h2 className="text-2xl font-semibold mb-2">Create your first team</h2>
                <p className="text-[#888] mb-6 max-w-md mx-auto">
                  Teams help you organize and collaborate on infrastructure projects with your organization.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-semibold mb-2">No teams match your filters</h2>
                <p className="text-[#888] mb-6 max-w-md mx-auto">
                  Try adjusting your search or filter criteria.
                </p>
                <button
                  onClick={() => { setSearchQuery(''); setPlanFilter(null); setStatusFilter(null); }}
                  className="px-4 py-2 border border-[#333] rounded-md text-sm font-medium hover:bg-[#111] transition-colors"
                >
                  Clear filters
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="border border-[#333] rounded-lg overflow-hidden bg-[#0a0a0a]">
            {filteredTeams.map((team, index) => (
              <button
                key={team.id}
                onClick={() => navigateToTeam(team.id)}
                className={`w-full group text-left hover:bg-[#111] transition-colors ${
                  index !== 0 ? 'border-t border-[#333]' : ''
                }`}
              >
                <div className="flex items-center gap-4 px-5 py-4">
                  {/* Status indicator */}
                  <div className="flex-shrink-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500" title="Active" />
                  </div>

                  {/* Team info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-0.5">
                      <span className="font-semibold text-white truncate">
                        {team.name}
                      </span>
                      {getPlanBadge(team.plan)}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-[#666]">
                      <GitBranch className="w-3.5 h-3.5" />
                      <span>{team.repo_count} repos</span>
                      <span className="text-[#444]">•</span>
                      <Users className="w-3.5 h-3.5" />
                      <span>{team.member_count} members</span>
                    </div>
                  </div>

                  {/* Created date */}
                  <div className="flex-shrink-0 text-right hidden md:block">
                    <span className="text-sm text-[#666]">
                      {new Date(team.created_at).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric' 
                      })}
                    </span>
                  </div>

                  {/* More button */}
                  <div className="flex-shrink-0">
                    <button className="p-1.5 rounded hover:bg-[#222] text-[#666] hover:text-white transition-colors">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
        </>
      )}

      {/* Activity Tab */}
      {activeNavTab === 'activity' && (
        <div className="max-w-7xl mx-auto px-6 py-8">
          <h2 className="text-2xl font-bold mb-6">Team Activity</h2>
          
          {teams.length === 0 ? (
            <div className="text-center py-16 border border-[#333] rounded-lg">
              <Activity className="w-12 h-12 mx-auto mb-3 text-[#666]" />
              <p className="text-[#888]">No activity yet</p>
              <p className="text-sm text-[#666] mt-1">Create a team to start tracking activity</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Activity summary cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="bg-[#111] border border-[#333] rounded-lg p-4">
                  <div className="text-sm text-[#666] mb-1">Total Teams</div>
                  <div className="text-3xl font-bold">{teams.length}</div>
                </div>
                <div className="bg-[#111] border border-[#333] rounded-lg p-4">
                  <div className="text-sm text-[#666] mb-1">Total Members</div>
                  <div className="text-3xl font-bold">{teams.reduce((acc, t) => acc + t.member_count, 0)}</div>
                </div>
                <div className="bg-[#111] border border-[#333] rounded-lg p-4">
                  <div className="text-sm text-[#666] mb-1">Total Repositories</div>
                  <div className="text-3xl font-bold">{teams.reduce((acc, t) => acc + t.repo_count, 0)}</div>
                </div>
              </div>

              {/* Recent activity */}
              <div className="border border-[#333] rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-[#333] bg-[#111]">
                  <h3 className="font-medium">Recent Activity</h3>
                </div>
                <div className="divide-y divide-[#333]">
                  {teams.slice(0, 5).map((team) => (
                    <div key={team.id} className="px-4 py-3 flex items-center gap-3 hover:bg-[#111] transition-colors">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xs font-bold">
                        {team.name[0].toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm">
                          <span className="font-medium">{team.name}</span>
                          <span className="text-[#666]"> was created</span>
                        </p>
                        <p className="text-xs text-[#666]">
                          {new Date(team.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                      <Circle className="w-2 h-2 fill-green-500 text-green-500" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {activeNavTab === 'settings' && (
        <div className="max-w-7xl mx-auto px-6 py-8">
          <h2 className="text-2xl font-bold mb-6">Settings</h2>
          
          <div className="space-y-6">
            {/* General Settings */}
            <div className="border border-[#333] rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-[#333] bg-[#111]">
                <h3 className="font-medium">General</h3>
              </div>
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Email Notifications</p>
                    <p className="text-sm text-[#666]">Receive emails when you're invited to a team</p>
                  </div>
                  <button className="w-12 h-6 bg-purple-600 rounded-full relative transition-colors">
                    <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Desktop Notifications</p>
                    <p className="text-sm text-[#666]">Get notified when team members make changes</p>
                  </div>
                  <button className="w-12 h-6 bg-purple-600 rounded-full relative transition-colors">
                    <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                  </button>
                </div>
              </div>
            </div>

            {/* Collaboration Settings */}
            <div className="border border-[#333] rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-[#333] bg-[#111]">
                <h3 className="font-medium">Collaboration</h3>
              </div>
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Auto-sync Changes</p>
                    <p className="text-sm text-[#666]">Automatically sync repository changes with team</p>
                  </div>
                  <button className="w-12 h-6 bg-purple-600 rounded-full relative transition-colors">
                    <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Show Online Status</p>
                    <p className="text-sm text-[#666]">Let team members see when you're online</p>
                  </div>
                  <button className="w-12 h-6 bg-purple-600 rounded-full relative transition-colors">
                    <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                  </button>
                </div>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="border border-red-500/30 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-red-500/30 bg-red-500/5">
                <h3 className="font-medium text-red-400">Danger Zone</h3>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Leave All Teams</p>
                    <p className="text-sm text-[#666]">Remove yourself from all teams you're a member of</p>
                  </div>
                  <button className="px-4 py-2 border border-red-500/30 text-red-400 rounded-md text-sm hover:bg-red-500/10 transition-colors">
                    Leave all
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <div className="w-full max-w-md bg-[#111] rounded-xl border border-[#333] shadow-2xl">
            <div className="px-5 py-4 border-b border-[#333] flex items-center justify-between">
              <h3 className="font-semibold text-lg">Create a new team</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-md hover:bg-[#222] transition-colors"
              >
                <X className="w-4 h-4 text-[#666]" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div>
                <label className="block text-sm font-medium text-[#888] mb-2">Team name</label>
                <input
                  type="text"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && createTeam()}
                  placeholder="e.g., Engineering"
                  className="w-full px-3 py-2.5 bg-black border border-[#333] rounded-lg text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#555]"
                  autoFocus
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-[#333] text-sm font-medium hover:bg-[#222] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={createTeam}
                  disabled={!teamName.trim() || creating}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-white text-black text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
                >
                  {creating ? 'Creating...' : 'Create team'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Join Team Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <div className="w-full max-w-md bg-[#111] rounded-xl border border-[#333] shadow-2xl">
            <div className="px-5 py-4 border-b border-[#333] flex items-center justify-between">
              <h3 className="font-semibold text-lg">Join a team</h3>
              <button
                onClick={() => setShowJoinModal(false)}
                className="p-1.5 rounded-md hover:bg-[#222] transition-colors"
              >
                <X className="w-4 h-4 text-[#666]" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div>
                <label className="block text-sm font-medium text-[#888] mb-2">Invite link or token</label>
                <input
                  type="text"
                  value={inviteLink}
                  onChange={(e) => setInviteLink(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleJoinTeam()}
                  placeholder="driftbox://invite/xxx or paste token"
                  className="w-full px-3 py-2.5 bg-black border border-[#333] rounded-lg text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#555]"
                  autoFocus
                />
                <p className="text-xs text-[#666] mt-2">
                  Paste the invite link from your email or the token shared by your team admin.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowJoinModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-[#333] text-sm font-medium hover:bg-[#222] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleJoinTeam}
                  disabled={!inviteLink.trim()}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-white text-black text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
                >
                  Join team
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Loading fallback for Suspense
function TeamsLoading() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-6 h-6 border-2 border-[#333] border-t-white rounded-full animate-spin"></div>
        <p className="text-sm text-[#666]">Loading teams...</p>
      </div>
    </div>
  )
}

// Main export - wraps content in Suspense for useSearchParams
export default function TeamsPage() {
  return (
    <Suspense fallback={<TeamsLoading />}>
      <TeamsPageContent />
    </Suspense>
  )
}
