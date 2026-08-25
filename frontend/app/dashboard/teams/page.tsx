'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Users, Plus, Search, Crown, Sparkles, X, 
  TrendingUp, Activity, Shield, Clock, ChevronRight,
  Building2, MoreHorizontal, FolderGit2, Lock
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

const fetchTeams = async (): Promise<Team[]> => {
  const token = localStorage.getItem('token')
  const response = await fetch(getApiEndpoint('/teams/'), {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!response.ok) throw new Error('Failed to fetch teams')
  return response.json()
}

export default function TeamsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isDarkMode, setIsDarkMode] = useState(true)

  useEffect(() => {
    const checkTheme = () => {
      // Check localStorage first, then fall back to class check
      const savedTheme = localStorage.getItem('driftbox-theme')
      if (savedTheme) {
        setIsDarkMode(savedTheme === 'dark')
      } else {
        // Check if light-mode class is present (dark mode is default)
        setIsDarkMode(!document.documentElement.classList.contains('light-mode'))
      }
    }
    checkTheme()
    const observer = new MutationObserver(checkTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    
    // Also listen for storage changes
    window.addEventListener('storage', checkTheme)
    return () => {
      observer.disconnect()
      window.removeEventListener('storage', checkTheme)
    }
  }, [])

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: fetchTeams,
  })

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      setShowCreateModal(false)
      setTeamName('')
    }
  })

  const filteredTeams = teams.filter(team =>
    team.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const totalMembers = teams.reduce((sum, t) => sum + t.member_count, 0)
  const totalRepos = teams.reduce((sum, t) => sum + t.repo_count, 0)
  const enterpriseTeams = teams.filter(t => t.plan === 'enterprise').length

  const getPlanConfig = (plan: string) => {
    const configs = {
      free: { 
        icon: Sparkles, 
        gradient: 'from-[#14b8a6] to-[#0d9488]',
        bg: 'bg-[#14b8a6]/10',
        text: 'text-[#14b8a6]',
        label: 'Free',
        border: 'border-[#14b8a6]/20'
      },
      team: { 
        icon: Users, 
        gradient: 'from-[#a855f7] to-[#7c3aed]',
        bg: 'bg-[#a855f7]/10',
        text: 'text-[#a855f7]',
        label: 'Team',
        border: 'border-[#a855f7]/20'
      },
      enterprise: { 
        icon: Crown, 
        gradient: 'from-[#eab308] to-[#f59e0b]',
        bg: 'bg-[#eab308]/10',
        text: 'text-[#eab308]',
        label: 'Enterprise',
        border: 'border-[#eab308]/20'
      }
    }
    return configs[plan as keyof typeof configs] || configs.free
  }

  if (isLoading) {
    return (
      <div className={`flex h-full items-center justify-center ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="h-16 w-16 rounded-full border-4 border-[#14b8a6]/20" />
            <div className="absolute inset-0 h-16 w-16 animate-spin rounded-full border-4 border-transparent border-t-[#14b8a6]" />
          </div>
          <p className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Loading teams...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`min-h-screen p-6 ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className={`text-2xl font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
            Team Management
          </h1>
          <p className={`mt-1 text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
            Organize your infrastructure teams and collaborate with enterprise-grade security
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-[#14b8a6] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0d9488] transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Team
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {/* Total Teams */}
        <div className={`group relative p-6 rounded-xl overflow-hidden ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'} border hover:border-[#14b8a6]/30 transition-all duration-300`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#14b8a6]/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-[#14b8a6]/10 transition-all" />
          <div className="relative">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#14b8a6]/20 to-[#14b8a6]/5 flex items-center justify-center">
                <Building2 className="h-6 w-6 text-[#14b8a6]" />
              </div>
              <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-100 text-emerald-600'}`}>
                <TrendingUp className="h-3 w-3" />
                Active
              </div>
            </div>
            <p className={`text-sm font-medium ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Total Teams</p>
            <p className={`text-4xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{teams.length}</p>
            <div className="flex items-center gap-2 mt-3">
              {[...Array(Math.min(teams.length, 5))].map((_, i) => (
                <div 
                  key={i} 
                  className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#14b8a6] to-[#0d9488] flex items-center justify-center text-xs font-semibold text-white"
                >
                  {teams[i]?.name[0].toUpperCase()}
                </div>
              ))}
              {teams.length > 5 && (
                <div className={`w-8 h-8 rounded-lg ${isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100'} flex items-center justify-center text-xs font-medium ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                  +{teams.length - 5}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Total Members - Circular */}
        <div className={`group relative p-6 rounded-xl overflow-hidden ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'} border hover:border-[#a855f7]/30 transition-all duration-300`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#a855f7]/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-[#a855f7]/10 transition-all" />
          <div className="relative flex items-center gap-5">
            {/* Progress Ring */}
            <div className="relative w-24 h-24 flex-shrink-0">
              <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
                <circle cx="48" cy="48" r="40" fill="none" stroke={isDarkMode ? '#1f1f1f' : '#e5e7eb'} strokeWidth="8" />
                <circle
                  cx="48" cy="48" r="40" fill="none"
                  stroke="url(#memberGradient)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${Math.min(totalMembers * 5, 251)} 251`}
                  className="transition-all duration-1000"
                />
                <defs>
                  <linearGradient id="memberGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#a855f7" />
                    <stop offset="100%" stopColor="#7c3aed" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <Users className="h-8 w-8 text-[#a855f7]" />
              </div>
            </div>
            <div>
              <p className={`text-sm font-medium ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Total Members</p>
              <p className={`text-4xl font-bold text-[#a855f7]`}>{totalMembers}</p>
              <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mt-1`}>
                Across all teams
              </p>
            </div>
          </div>
        </div>

        {/* Total Repos */}
        <div className={`group relative p-6 rounded-xl overflow-hidden ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'} border hover:border-blue-500/30 transition-all duration-300`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-blue-500/10 transition-all" />
          <div className="relative">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-500/5 flex items-center justify-center">
                <FolderGit2 className="h-6 w-6 text-blue-400" />
              </div>
            </div>
            <p className={`text-sm font-medium ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Repositories</p>
            <p className={`text-4xl font-bold text-blue-400`}>{totalRepos}</p>
            {/* Mini chart */}
            <div className="flex items-end gap-1 h-10 mt-3">
              {[3, 5, 4, 8, 6, 9, 7, 11, 8, 13].map((h, i) => (
                <div 
                  key={i} 
                  className="flex-1 rounded-sm bg-gradient-to-t from-blue-500/40 to-blue-400 transition-all hover:from-blue-500/60"
                  style={{ height: `${h * 3}px` }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Enterprise Status */}
        <div className={`group relative p-6 rounded-xl overflow-hidden ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'} border hover:border-[#eab308]/30 transition-all duration-300`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#eab308]/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-[#eab308]/10 transition-all" />
          <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-[#eab308]/0 via-[#eab308]/50 to-[#eab308]/0" />
          <div className="relative">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#eab308]/20 to-[#eab308]/5 flex items-center justify-center">
                <Crown className="h-6 w-6 text-[#eab308]" />
              </div>
              <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-[#eab308]/10 text-[#eab308]`}>
                <Shield className="h-3 w-3" />
                Premium
              </div>
            </div>
            <p className={`text-sm font-medium ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Enterprise Teams</p>
            <p className={`text-4xl font-bold text-[#eab308]`}>{enterpriseTeams}</p>
            <div className="flex items-center gap-2 mt-3">
              <Lock className="h-3 w-3 text-[#eab308]" />
              <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                Advanced security enabled
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6 flex items-center gap-4">
        <div className={`flex-1 flex items-center gap-3 rounded-xl border px-4 py-3 ${isDarkMode ? 'border-[#1f1f1f] bg-[#0f0f0f]' : 'border-gray-200 bg-white'} focus-within:border-[#14b8a6]/50 transition-colors`}>
          <Search className={`h-5 w-5 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
          <input
            type="text"
            placeholder="Search teams by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`bg-transparent text-sm flex-1 focus:outline-none ${isDarkMode ? 'text-[#fafafa] placeholder-[#666666]' : 'text-gray-900 placeholder-gray-400'}`}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className={`${isDarkMode ? 'text-[#666666] hover:text-[#a1a1a1]' : 'text-gray-400 hover:text-gray-600'}`}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border ${isDarkMode ? 'border-[#1f1f1f] bg-[#0f0f0f]' : 'border-gray-200 bg-white'}`}>
          <span className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Showing</span>
          <span className={`text-sm font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{filteredTeams.length}</span>
          <span className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>teams</span>
        </div>
      </div>

      {/* Teams Grid */}
      {filteredTeams.length === 0 ? (
        <div className={`flex flex-col items-center justify-center rounded-2xl border py-20 ${isDarkMode ? 'border-[#1f1f1f] bg-[#0f0f0f]' : 'border-gray-200 bg-white'}`}>
          <div className="relative mb-6">
            <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-[#14b8a6]/20 to-[#14b8a6]/5 flex items-center justify-center">
              <Users className="h-12 w-12 text-[#14b8a6]" />
            </div>
            <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-xl bg-gradient-to-br from-[#14b8a6] to-[#0d9488] flex items-center justify-center shadow-lg">
              <Plus className="h-5 w-5 text-white" />
            </div>
          </div>
          <h3 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
            {teams.length === 0 ? 'Create your first team' : 'No teams found'}
          </h3>
          <p className={`text-sm text-center max-w-md mb-6 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
            Teams help you organize and collaborate on infrastructure projects with enterprise-grade security and compliance.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#14b8a6] to-[#0d9488] px-6 py-3 text-sm font-semibold text-white hover:shadow-lg hover:shadow-[#14b8a6]/25 transition-all"
          >
            <Plus className="h-5 w-5" />
            Create Team
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredTeams.map((team) => {
            const planConfig = getPlanConfig(team.plan)
            const PlanIcon = planConfig.icon
            
            return (
              <div
                key={team.id}
                onClick={() => router.push(`/dashboard/teams/${team.id}`)}
                className={`group relative p-6 rounded-xl cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f] hover:border-[#2a2a2a] hover:shadow-black/50' : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-gray-200/50'} border`}
              >
                {/* Gradient accent */}
                <div className={`absolute top-0 left-0 right-0 h-1 rounded-t-xl bg-gradient-to-r ${planConfig.gradient} opacity-0 group-hover:opacity-100 transition-opacity`} />
                
                {/* Header */}
                <div className="flex items-start justify-between mb-5">
                  <div className="flex items-center gap-4">
                    <div className={`relative w-14 h-14 rounded-xl bg-gradient-to-br ${planConfig.gradient} flex items-center justify-center text-xl font-bold text-white shadow-lg`}>
                      {team.name[0].toUpperCase()}
                      <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full ${planConfig.bg} border-2 ${isDarkMode ? 'border-[#0f0f0f]' : 'border-white'} flex items-center justify-center`}>
                        <PlanIcon className={`h-2.5 w-2.5 ${planConfig.text}`} />
                      </div>
                    </div>
                    <div>
                      <h3 className={`font-semibold text-lg ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'} group-hover:text-[#14b8a6] transition-colors`}>
                        {team.name}
                      </h3>
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${planConfig.bg} ${planConfig.text}`}>
                        <PlanIcon className="w-3 h-3" />
                        {planConfig.label}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation() }}
                    className={`p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all ${isDarkMode ? 'hover:bg-[#1f1f1f]' : 'hover:bg-gray-100'}`}
                  >
                    <MoreHorizontal className={`h-4 w-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
                  </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-[#0a0a0a]/50' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <FolderGit2 className={`h-4 w-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
                      <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Repositories</span>
                    </div>
                    <p className={`text-2xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{team.repo_count}</p>
                  </div>
                  <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-[#0a0a0a]/50' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Users className={`h-4 w-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
                      <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Members</span>
                    </div>
                    <p className={`text-2xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{team.member_count}</p>
                  </div>
                </div>

                {/* Footer */}
                <div className={`flex items-center justify-between pt-4 border-t ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-100'}`}>
                  <div className="flex items-center gap-2">
                    <Clock className={`h-3.5 w-3.5 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
                    <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                      Created {new Date(team.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                  <div className={`flex items-center gap-1 text-xs font-medium ${isDarkMode ? 'text-[#14b8a6]' : 'text-[#0d9488]'} opacity-0 group-hover:opacity-100 transition-opacity`}>
                    View Team
                    <ChevronRight className="h-3.5 w-3.5" />
                  </div>
                </div>
              </div>
            )
          })}

          {/* Add Team Card */}
          <div
            onClick={() => setShowCreateModal(true)}
            className={`group relative p-6 rounded-xl cursor-pointer transition-all duration-300 hover:-translate-y-1 border-2 border-dashed ${isDarkMode ? 'border-[#1f1f1f] hover:border-[#14b8a6]/50 bg-[#0a0a0a]/50' : 'border-gray-200 hover:border-[#14b8a6]/50 bg-gray-50/50'} flex flex-col items-center justify-center min-h-[260px]`}
          >
            <div className={`w-16 h-16 rounded-2xl mb-4 flex items-center justify-center transition-all ${isDarkMode ? 'bg-[#1f1f1f] group-hover:bg-[#14b8a6]/10' : 'bg-gray-100 group-hover:bg-[#14b8a6]/10'}`}>
              <Plus className={`h-8 w-8 transition-colors ${isDarkMode ? 'text-[#666666] group-hover:text-[#14b8a6]' : 'text-gray-400 group-hover:text-[#14b8a6]'}`} />
            </div>
            <p className={`text-sm font-medium mb-1 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Create New Team</p>
            <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Add a new team to your organization</p>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className={`w-full max-w-lg rounded-2xl border overflow-hidden ${isDarkMode ? 'border-[#1f1f1f] bg-[#0f0f0f]' : 'border-gray-200 bg-white'}`}>
            {/* Modal Header */}
            <div className={`px-5 py-4 border-b ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Create Team</h3>
                <button 
                  onClick={() => setShowCreateModal(false)} 
                  className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'text-[#666666] hover:text-[#a1a1a1] hover:bg-[#1f1f1f]' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6">
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-700'}`}>Team name</label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g., Engineering, Platform, DevOps"
                className={`w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#14b8a6]/50 transition-all ${isDarkMode ? 'border-[#1f1f1f] bg-[#0a0a0a] text-[#fafafa] placeholder-[#666666] focus:border-[#14b8a6]' : 'border-gray-200 bg-gray-50 text-gray-900 placeholder-gray-400 focus:border-[#14b8a6]'}`}
                autoFocus
              />
              
              {/* Features */}
              <div className={`mt-6 p-4 rounded-xl ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
                <p className={`text-xs font-medium mb-3 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Your team will include:</p>
                <div className="space-y-2">
                  {[
                    { icon: FolderGit2, text: 'Unlimited repository connections' },
                    { icon: Users, text: 'Collaborative workspace access' },
                    { icon: Shield, text: 'Role-based access control' },
                    { icon: Activity, text: 'Real-time activity monitoring' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center ${isDarkMode ? 'bg-[#14b8a6]/10' : 'bg-[#14b8a6]/10'}`}>
                        <item.icon className="h-3.5 w-3.5 text-[#14b8a6]" />
                      </div>
                      <span className={`text-sm ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${isDarkMode ? 'border-[#1f1f1f] text-[#a1a1a1] hover:bg-[#141414]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => createTeamMutation.mutate(teamName)}
                  disabled={!teamName.trim() || createTeamMutation.isPending}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#14b8a6] to-[#0d9488] px-4 py-3 text-sm font-semibold text-white hover:shadow-lg hover:shadow-[#14b8a6]/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {createTeamMutation.isPending ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Create Team
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

