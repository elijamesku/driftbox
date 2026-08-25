'use client'

import { useAuth } from '@/contexts/AuthContext'
import { X, Award, Shield, Zap, GitPullRequest, Bug, Sparkles, Trophy, Star, Target, Rocket, Users, ChevronRight } from 'lucide-react'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getApiEndpoint } from '@/utils/apiEndpoint'

// Check if we're in desktop/Electron mode
const isDesktopMode = () => {
  if (typeof window === 'undefined') return false
  return !!(
    (window as any).electronAPI ||
    window.location.protocol === 'file:' ||
    (window.location.hostname === 'localhost' && window.location.port === '3000' && (window as any).electronAPI)
  )
}

interface Achievement {
  id: string
  name: string
  description: string
  icon: string
  tier: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond'
  earned: boolean
  earned_at?: string
  progress?: number
  max_progress?: number
}

interface Team {
  id: string
  name: string
  slug: string
  role: string
  member_count: number
}

interface ActivityDay {
  date: string
  count: number
  scans: number
  fixes: number
  aiChats: number
  diagrams: number
}

interface ProfileModalProps {
  isOpen: boolean
  onClose: () => void
  onEnterTeamWorkspace?: (teamId: string) => void
}

const tierColors = {
  bronze: 'from-amber-600 via-amber-400 to-amber-700 border-amber-500 shadow-amber-500/30',
  silver: 'from-gray-200 via-gray-100 to-gray-400 border-gray-300 shadow-gray-300/30',
  gold: 'from-yellow-300 via-yellow-200 to-amber-500 border-yellow-400 shadow-yellow-400/30',
  platinum: 'from-cyan-200 via-white to-blue-300 border-cyan-300 shadow-cyan-300/30',
  diamond: 'from-purple-300 via-pink-200 to-purple-500 border-purple-400 shadow-purple-400/30'
}

const tierBg = {
  bronze: 'bg-amber-900/20',
  silver: 'bg-gray-500/20',
  gold: 'bg-yellow-500/20',
  platinum: 'bg-cyan-500/20',
  diamond: 'bg-purple-500/20'
}

const tierGlow = {
  bronze: 'shadow-[0_0_15px_rgba(217,119,6,0.4)]',
  silver: 'shadow-[0_0_15px_rgba(156,163,175,0.4)]',
  gold: 'shadow-[0_0_20px_rgba(234,179,8,0.5)]',
  platinum: 'shadow-[0_0_20px_rgba(34,211,238,0.5)]',
  diamond: 'shadow-[0_0_25px_rgba(192,132,252,0.6)]'
}

const iconMap: Record<string, any> = {
  shield: Shield,
  zap: Zap,
  'git-pull-request': GitPullRequest,
  bug: Bug,
  sparkles: Sparkles,
  trophy: Trophy,
  star: Star,
  target: Target,
  rocket: Rocket,
  award: Award
}

// Generate activity data for the past year
const generateActivityData = (): ActivityDay[] => {
  const days: ActivityDay[] = []
  const today = new Date()
  
  for (let i = 365; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    
    // Generate realistic-looking activity (more recent = more likely to have activity)
    const recencyBoost = Math.max(0, (365 - i) / 365)
    const hasActivity = Math.random() < (0.3 + recencyBoost * 0.4)
    
    if (hasActivity) {
      const scans = Math.floor(Math.random() * 5)
      const fixes = Math.floor(Math.random() * 3)
      const aiChats = Math.floor(Math.random() * 8)
      const diagrams = Math.random() < 0.2 ? Math.floor(Math.random() * 2) + 1 : 0
      
      days.push({
        date: date.toISOString().split('T')[0],
        count: scans + fixes + aiChats + diagrams,
        scans,
        fixes,
        aiChats,
        diagrams
      })
    } else {
      days.push({
        date: date.toISOString().split('T')[0],
        count: 0,
        scans: 0,
        fixes: 0,
        aiChats: 0,
        diagrams: 0
      })
    }
  }
  
  return days
}

// Fetch teams with caching
const fetchTeams = async (): Promise<Team[]> => {
  const token = localStorage.getItem('token')
  const response = await fetch(getApiEndpoint('/teams/'), {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  if (!response.ok) return []
  return response.json()
}

export default function ProfileModal({ isOpen, onClose, onEnterTeamWorkspace }: ProfileModalProps) {
  const { user } = useAuth()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'activity' | 'achievements'>('activity')
  const [hoveredDay, setHoveredDay] = useState<ActivityDay | null>(null)
  const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null)

  // Default achievements - memoized to avoid recreating on every render
  const defaultAchievements: Achievement[] = useMemo(() => [
    { id: '1', name: 'First Scan', description: 'Run your first security scan', icon: 'shield', tier: 'bronze', earned: true },
    { id: '2', name: 'Drift Hunter', description: 'Detect 10 drifts', icon: 'target', tier: 'silver', earned: true },
    { id: '3', name: 'PR Master', description: 'Create 5 pull requests', icon: 'git-pull-request', tier: 'bronze', earned: true },
    { id: '4', name: 'Bug Squasher', description: 'Fix 25 issues', icon: 'bug', tier: 'gold', earned: false, progress: 18, max_progress: 25 },
    { id: '5', name: 'Speed Demon', description: 'Auto-fix 10 issues', icon: 'zap', tier: 'silver', earned: false, progress: 3, max_progress: 10 },
    { id: '6', name: 'Team Player', description: 'Join a team workspace', icon: 'trophy', tier: 'bronze', earned: true },
    { id: '7', name: 'Cost Cutter', description: 'Save $100 in cloud costs', icon: 'sparkles', tier: 'gold', earned: false, progress: 45, max_progress: 100 },
    { id: '8', name: 'Rocket Launch', description: 'Create your first deployment', icon: 'rocket', tier: 'platinum', earned: false },
    { id: '9', name: 'Star Dev', description: 'Reach 100 commits', icon: 'star', tier: 'diamond', earned: false, progress: 23, max_progress: 100 },
  ], [])
  
  // Extended achievement details
  const achievementDetails: Record<string, { howToEarn: string; reward: string; rarity: string }> = {
    '1': { howToEarn: 'Navigate to any repository and run a security scan from the dashboard.', reward: '+50 XP', rarity: 'Common' },
    '2': { howToEarn: 'Use drift detection to find 10 configuration drifts in your infrastructure.', reward: '+150 XP', rarity: 'Uncommon' },
    '3': { howToEarn: 'Create 5 pull requests using the AI assistant or manual staging.', reward: '+100 XP', rarity: 'Common' },
    '4': { howToEarn: 'Use auto-fix or manual fixes to resolve 25 security or configuration issues.', reward: '+300 XP', rarity: 'Rare' },
    '5': { howToEarn: 'Let the AI automatically fix 10 issues without manual intervention.', reward: '+200 XP', rarity: 'Uncommon' },
    '6': { howToEarn: 'Accept an invitation to join a team workspace or create your own.', reward: '+75 XP', rarity: 'Common' },
    '7': { howToEarn: 'Implement cost-saving recommendations that total $100 in monthly savings.', reward: '+400 XP', rarity: 'Rare' },
    '8': { howToEarn: 'Deploy infrastructure to a cloud provider for the first time.', reward: '+500 XP', rarity: 'Epic' },
    '9': { howToEarn: 'Make 100 commits across all your repositories using Driftbox.', reward: '+1000 XP', rarity: 'Legendary' },
  }

  // TanStack Query for teams - cached for 5 minutes
  const { data: teams = [], isLoading: loadingTeams } = useQuery({
    queryKey: ['profile', 'teams'],
    queryFn: fetchTeams,
    enabled: isOpen, // Only fetch when modal is open
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  })

  // Generate activity data once and cache it - memoized
  const activityData = useMemo(() => generateActivityData(), [])
  
  // Use default achievements (would come from API in production)
  const achievements = defaultAchievements
  const loading = loadingTeams

  // Get color intensity based on activity count
  const getActivityColor = (count: number) => {
    if (count === 0) return 'bg-[#1a1a1a]'
    if (count <= 2) return 'bg-purple-900/60'
    if (count <= 5) return 'bg-purple-700/70'
    if (count <= 8) return 'bg-purple-500/80'
    return 'bg-purple-400'
  }

  // Group activity by weeks for the calendar
  const getWeeks = () => {
    const weeks: ActivityDay[][] = []
    let currentWeek: ActivityDay[] = []
    
    // Pad the first week
    const firstDay = new Date(activityData[0]?.date || new Date())
    const firstDayOfWeek = firstDay.getDay()
    for (let i = 0; i < firstDayOfWeek; i++) {
      currentWeek.push({ date: '', count: -1, scans: 0, fixes: 0, aiChats: 0, diagrams: 0 })
    }
    
    activityData.forEach((day) => {
      currentWeek.push(day)
      if (currentWeek.length === 7) {
        weeks.push(currentWeek)
        currentWeek = []
      }
    })
    
    if (currentWeek.length > 0) {
      weeks.push(currentWeek)
    }
    
    return weeks
  }

  // Get month labels
  const getMonthLabels = () => {
    const months: { name: string; position: number }[] = []
    let currentMonth = -1
    
    activityData.forEach((day, index) => {
      const date = new Date(day.date)
      const month = date.getMonth()
      if (month !== currentMonth) {
        currentMonth = month
        months.push({
          name: date.toLocaleString('default', { month: 'short' }),
          position: Math.floor(index / 7)
        })
      }
    })
    
    return months
  }

  const totalActivity = activityData.reduce((sum, day) => sum + day.count, 0)

  const handleTeamClick = (teamId: string) => {
    // Enter team workspace (unlocks Drift, Diagrams, Docs)
    if (onEnterTeamWorkspace) {
      onEnterTeamWorkspace(teamId)
      onClose()
    } else {
      // Fallback to navigation if callback not provided
      const selectedRepo = sessionStorage.getItem('selectedRepo')
      const selectedFile = sessionStorage.getItem('selectedFile')
      if (selectedRepo) sessionStorage.setItem('ide_selectedRepo', selectedRepo)
      if (selectedFile) sessionStorage.setItem('ide_selectedFile', selectedFile)
      sessionStorage.setItem('ide_state_saved', 'true')
      
      onClose()
      // Use query params in desktop mode (static export doesn't have dynamic routes)
      if (isDesktopMode()) {
        router.push(`/teams?teamId=${teamId}`)
      } else {
        router.push(`/teams/${teamId}`)
      }
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 z-50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl">
        <div className="bg-[#0a0a0a] border border-[#333] rounded-lg shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#333]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center text-white font-semibold">
                {user?.email?.[0]?.toUpperCase() || 'U'}
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-[#cccccc]">
                  {user?.full_name || user?.email || 'Your Profile'}
                </h2>
                <p className="text-[11px] text-[#858585]">
                  Level {Math.floor(achievements.filter(a => a.earned).length / 2) + 1} Developer
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-[#858585] hover:text-[#cccccc] transition-colors"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-[#333]">
            <button
              onClick={() => setActiveTab('activity')}
              className={`flex-1 px-4 py-3 text-[13px] font-medium transition-colors relative ${
                activeTab === 'activity' ? 'text-white' : 'text-[#858585] hover:text-white'
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <Zap size={14} />
                Activity
              </span>
              {activeTab === 'activity' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 to-cyan-500" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('achievements')}
              className={`flex-1 px-4 py-3 text-[13px] font-medium transition-colors relative ${
                activeTab === 'achievements' ? 'text-white' : 'text-[#858585] hover:text-white'
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <Award size={14} />
                Achievements
              </span>
              {activeTab === 'achievements' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 to-cyan-500" />
              )}
            </button>
          </div>

          {/* Content */}
          <div className="p-6 min-h-[450px] max-h-[450px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
              </div>
            ) : activeTab === 'activity' ? (
              <>
                {/* Activity Header */}
                <div className="mb-4">
                  <div className="text-[13px] text-[#cccccc] mb-1">
                    <span className="font-semibold text-white">{totalActivity.toLocaleString()}</span> actions in the last year
                  </div>
                  <div className="text-[11px] text-[#666]">
                    Scans, fixes, AI conversations, and more
                  </div>
                </div>

                {/* Heatmap */}
                <div className="bg-[#0d0d0d] border border-[#333] rounded-lg p-4 overflow-x-auto">
                  {/* Month labels */}
                  <div className="flex mb-2 ml-8">
                    {getMonthLabels().map((month, i) => (
                      <div 
                        key={i} 
                        className="text-[10px] text-[#858585]"
                        style={{ 
                          position: 'relative',
                          left: `${month.position * 13}px`,
                          marginRight: i < getMonthLabels().length - 1 ? '0' : '0'
                        }}
                      >
                        {month.name}
                      </div>
                    ))}
                  </div>

                  {/* Grid */}
                  <div className="flex gap-[3px]">
                    {/* Day labels */}
                    <div className="flex flex-col gap-[3px] mr-1">
                      <div className="h-[10px]"></div>
                      <div className="h-[10px] text-[9px] text-[#858585] leading-[10px]">Mon</div>
                      <div className="h-[10px]"></div>
                      <div className="h-[10px] text-[9px] text-[#858585] leading-[10px]">Wed</div>
                      <div className="h-[10px]"></div>
                      <div className="h-[10px] text-[9px] text-[#858585] leading-[10px]">Fri</div>
                      <div className="h-[10px]"></div>
                    </div>

                    {/* Weeks */}
                    {getWeeks().map((week, weekIndex) => (
                      <div key={weekIndex} className="flex flex-col gap-[3px]">
                        {week.map((day, dayIndex) => (
                          <div
                            key={dayIndex}
                            className={`w-[10px] h-[10px] rounded-sm ${
                              day.count === -1 ? 'bg-transparent' : getActivityColor(day.count)
                            } ${day.count >= 0 ? 'cursor-pointer hover:ring-1 hover:ring-purple-400' : ''}`}
                            onMouseEnter={() => day.count >= 0 && setHoveredDay(day)}
                          />
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* Legend */}
                  <div className="flex items-center justify-end gap-2 mt-3 text-[10px] text-[#858585]">
                    <span>Less</span>
                    <div className="flex gap-[2px]">
                      <div className="w-[10px] h-[10px] rounded-sm bg-[#1a1a1a]" />
                      <div className="w-[10px] h-[10px] rounded-sm bg-purple-900/60" />
                      <div className="w-[10px] h-[10px] rounded-sm bg-purple-700/70" />
                      <div className="w-[10px] h-[10px] rounded-sm bg-purple-500/80" />
                      <div className="w-[10px] h-[10px] rounded-sm bg-purple-400" />
                    </div>
                    <span>More</span>
                  </div>
                </div>


                {/* Hover detail - always visible to prevent layout shift */}
                <div className="mt-3 p-3 bg-[#111] border border-[#333] rounded-lg min-h-[70px]">
                  {hoveredDay ? (
                    <>
                      <div className="text-[12px] text-white font-medium mb-2">
                        {new Date(hoveredDay.date).toLocaleDateString('en-US', { 
                          weekday: 'long', 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        })}
                      </div>
                      {hoveredDay.count === 0 ? (
                        <div className="text-[11px] text-[#666]">No activity</div>
                      ) : (
                        <div className="grid grid-cols-4 gap-2 text-[11px]">
                          <div className="flex items-center gap-1.5">
                            <Shield size={12} className="text-cyan-400" />
                            <span className="text-[#cccccc]">{hoveredDay.scans} scans</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Bug size={12} className="text-green-400" />
                            <span className="text-[#cccccc]">{hoveredDay.fixes} fixes</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Sparkles size={12} className="text-purple-400" />
                            <span className="text-[#cccccc]">{hoveredDay.aiChats} chats</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Target size={12} className="text-amber-400" />
                            <span className="text-[#cccccc]">{hoveredDay.diagrams} diagrams</span>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-[12px] text-[#666] flex items-center justify-center h-full">
                      Hover over the graph to see daily activity
                    </div>
                  )}
                </div>

                {/* Activity breakdown */}
                <div className="mt-4 grid grid-cols-4 gap-2">
                  <div className="bg-[#111] border border-[#333] rounded-lg p-3 text-center">
                    <Shield className="w-5 h-5 text-cyan-400 mx-auto mb-1" />
                    <div className="text-[14px] font-semibold text-white">
                      {activityData.reduce((sum, d) => sum + d.scans, 0)}
                    </div>
                    <div className="text-[10px] text-[#858585]">Scans</div>
                  </div>
                  <div className="bg-[#111] border border-[#333] rounded-lg p-3 text-center">
                    <Bug className="w-5 h-5 text-green-400 mx-auto mb-1" />
                    <div className="text-[14px] font-semibold text-white">
                      {activityData.reduce((sum, d) => sum + d.fixes, 0)}
                    </div>
                    <div className="text-[10px] text-[#858585]">Fixes</div>
                  </div>
                  <div className="bg-[#111] border border-[#333] rounded-lg p-3 text-center">
                    <Sparkles className="w-5 h-5 text-purple-400 mx-auto mb-1" />
                    <div className="text-[14px] font-semibold text-white">
                      {activityData.reduce((sum, d) => sum + d.aiChats, 0)}
                    </div>
                    <div className="text-[10px] text-[#858585]">AI Chats</div>
                  </div>
                  <div className="bg-[#111] border border-[#333] rounded-lg p-3 text-center">
                    <Target className="w-5 h-5 text-amber-400 mx-auto mb-1" />
                    <div className="text-[14px] font-semibold text-white">
                      {activityData.reduce((sum, d) => sum + d.diagrams, 0)}
                    </div>
                    <div className="text-[10px] text-[#858585]">Diagrams</div>
                  </div>
                </div>
              </>
            ) : activeTab === 'achievements' ? (
              <>
                {/* Premium Achievement Animations */}
                <style dangerouslySetInnerHTML={{ __html: `
                  @keyframes holographic {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                  }
                  @keyframes float-badge {
                    0%, 100% { transform: translateY(0) scale(1); }
                    50% { transform: translateY(-8px) scale(1.02); }
                  }
                  @keyframes pulse-ring {
                    0% { transform: scale(1); opacity: 0.8; }
                    100% { transform: scale(1.5); opacity: 0; }
                  }
                  @keyframes rotate-glow {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                  }
                  @keyframes shimmer-sweep {
                    0% { transform: translateX(-100%) rotate(45deg); }
                    100% { transform: translateX(200%) rotate(45deg); }
                  }
                  @keyframes star-twinkle {
                    0%, 100% { opacity: 0; transform: scale(0) rotate(0deg); }
                    50% { opacity: 1; transform: scale(1) rotate(180deg); }
                  }
                  @keyframes breathe {
                    0%, 100% { box-shadow: 0 0 20px var(--glow), 0 0 40px var(--glow), 0 0 60px var(--glow); }
                    50% { box-shadow: 0 0 30px var(--glow), 0 0 60px var(--glow), 0 0 90px var(--glow); }
                  }
                  @keyframes icon-bounce {
                    0%, 100% { transform: scale(1) rotate(0deg); }
                    25% { transform: scale(1.1) rotate(-5deg); }
                    75% { transform: scale(1.1) rotate(5deg); }
                  }
                  @keyframes card-shine {
                    0% { opacity: 0; }
                    50% { opacity: 1; }
                    100% { opacity: 0; }
                  }
                  .achievement-card {
                    transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
                  }
                  .achievement-card:hover {
                    transform: translateY(-8px) scale(1.05);
                    z-index: 10;
                  }
                  .achievement-card:hover .badge-inner {
                    animation: icon-bounce 0.6s ease-in-out;
                  }
                  .floating-badge {
                    animation: float-badge 4s ease-in-out infinite;
                  }
                  .glow-ring {
                    animation: pulse-ring 2s ease-out infinite;
                  }
                  .rotating-border {
                    animation: rotate-glow 8s linear infinite;
                  }
                  .shimmer-effect {
                    animation: shimmer-sweep 3s ease-in-out infinite;
                  }
                  .breathe-bronze { --glow: rgba(205, 127, 50, 0.3); animation: breathe 3s ease-in-out infinite; }
                  .breathe-silver { --glow: rgba(192, 192, 192, 0.3); animation: breathe 3s ease-in-out infinite; }
                  .breathe-gold { --glow: rgba(255, 215, 0, 0.4); animation: breathe 2.5s ease-in-out infinite; }
                  .breathe-platinum { --glow: rgba(229, 228, 226, 0.4); animation: breathe 2.5s ease-in-out infinite; }
                  .breathe-diamond { --glow: rgba(185, 242, 255, 0.5); animation: breathe 2s ease-in-out infinite; }
                  .star-particle {
                    animation: star-twinkle 2s ease-in-out infinite;
                  }
                  .holographic-bg {
                    background: linear-gradient(135deg, #ff0080, #ff8c00, #40e0d0, #ff0080, #ff8c00);
                    background-size: 400% 400%;
                    animation: holographic 6s ease infinite;
                  }
                `}} />
                
                {/* Achievements Grid */}
                <div className="grid grid-cols-3 gap-4">
                  {achievements.map((achievement, index) => {
                    const IconComponent = iconMap[achievement.icon] || Award
                    const earned = achievement.earned
                    
                    // Premium tier configurations
                    const tierConfig: Record<string, { gradient: string; glow: string; accent: string; border: string }> = {
                      bronze: {
                        gradient: 'from-amber-700 via-orange-500 to-yellow-600',
                        glow: 'rgba(205, 127, 50, 0.6)',
                        accent: '#cd7f32',
                        border: 'border-amber-500/50'
                      },
                      silver: {
                        gradient: 'from-slate-300 via-gray-100 to-slate-400',
                        glow: 'rgba(192, 192, 192, 0.6)',
                        accent: '#c0c0c0',
                        border: 'border-gray-300/50'
                      },
                      gold: {
                        gradient: 'from-yellow-300 via-amber-200 to-yellow-500',
                        glow: 'rgba(255, 215, 0, 0.7)',
                        accent: '#ffd700',
                        border: 'border-yellow-400/50'
                      },
                      platinum: {
                        gradient: 'from-cyan-200 via-white to-blue-200',
                        glow: 'rgba(6, 182, 212, 0.6)',
                        accent: '#06b6d4',
                        border: 'border-cyan-300/50'
                      },
                      diamond: {
                        gradient: 'from-violet-400 via-fuchsia-300 to-cyan-300',
                        glow: 'rgba(139, 92, 246, 0.7)',
                        accent: '#8b5cf6',
                        border: 'border-violet-400/50'
                      }
                    }
                    
                    const config = tierConfig[achievement.tier]
                    
                    return (
                      <div
                        key={achievement.id}
                        onClick={() => setSelectedAchievement(achievement)}
                        className={`achievement-card relative flex flex-col items-center p-4 rounded-2xl cursor-pointer overflow-hidden ${
                          earned 
                            ? `bg-gradient-to-br from-[#1a1a2e]/90 to-[#0f0f1a]/90 ${config.border} border backdrop-blur-sm` 
                            : 'bg-[#111]/60 border border-[#222] opacity-50 hover:opacity-70'
                        }`}
                        style={{ 
                          animationDelay: `${index * 0.1}s`,
                          boxShadow: earned ? `0 10px 40px -10px ${config.glow}` : 'none'
                        }}
                      >
                        {/* Background glow effect */}
                        {earned && (
                          <div 
                            className="absolute inset-0 opacity-20 rounded-2xl"
                            style={{ 
                              background: `radial-gradient(circle at 50% 30%, ${config.glow}, transparent 70%)`
                            }}
                          />
                        )}
                        
                        {/* Animated stars/particles for earned */}
                        {earned && (
                          <>
                            <div className="star-particle absolute w-1 h-1 bg-white rounded-full" style={{ top: '15%', left: '20%', animationDelay: '0s' }} />
                            <div className="star-particle absolute w-1.5 h-1.5 bg-white rounded-full" style={{ top: '25%', right: '15%', animationDelay: '0.5s' }} />
                            <div className="star-particle absolute w-1 h-1 bg-white rounded-full" style={{ bottom: '35%', left: '15%', animationDelay: '1s' }} />
                            <div className="star-particle absolute w-0.5 h-0.5 bg-white rounded-full" style={{ top: '45%', right: '25%', animationDelay: '1.5s' }} />
                          </>
                        )}

                        {/* Badge container */}
                        <div className={`relative mb-3 ${earned ? 'floating-badge' : ''}`} style={{ animationDelay: `${index * 0.2}s` }}>
                          {/* Pulsing outer ring */}
                          {earned && (
                            <>
                              <div 
                                className="glow-ring absolute inset-0 rounded-full"
                                style={{ 
                                  background: `conic-gradient(from 0deg, transparent, ${config.accent}, transparent)`,
                                  filter: 'blur(8px)'
                                }}
                              />
                              <div 
                                className="glow-ring absolute inset-0 rounded-full"
                                style={{ 
                                  background: `conic-gradient(from 180deg, transparent, ${config.accent}, transparent)`,
                                  filter: 'blur(8px)',
                                  animationDelay: '1s'
                                }}
                              />
                            </>
                          )}
                          
                          {/* Rotating gradient border */}
                          {earned && (
                            <div className="absolute -inset-1 rounded-full rotating-border opacity-70">
                              <div 
                                className="w-full h-full rounded-full"
                                style={{
                                  background: `conic-gradient(from 0deg, ${config.accent}, transparent 30%, ${config.accent} 50%, transparent 80%, ${config.accent})`
                                }}
                              />
                            </div>
                          )}
                          
                          {/* Main badge */}
                          <div 
                            className={`badge-inner relative w-16 h-16 rounded-full flex items-center justify-center ${
                              earned 
                                ? `bg-gradient-to-br ${config.gradient} breathe-${achievement.tier}` 
                                : 'bg-[#1a1a1a] border border-[#333]'
                            }`}
                            style={earned ? { 
                              boxShadow: `inset 0 2px 10px rgba(255,255,255,0.3), inset 0 -2px 10px rgba(0,0,0,0.3)`
                            } : {}}
                          >
                            {/* Shimmer overlay */}
                            {earned && (
                              <div className="absolute inset-0 rounded-full overflow-hidden">
                                <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/40 to-transparent" />
                                <div className="shimmer-effect absolute -inset-full w-[200%] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                              </div>
                            )}
                            
                            {/* Icon */}
                            <IconComponent 
                              className={`w-7 h-7 relative z-10 ${earned ? 'text-white drop-shadow-lg' : 'text-[#444]'}`}
                              style={earned ? { filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' } : {}}
                            />
                          </div>
                          
                          {/* Tier badge */}
                          {earned && (
                            <div 
                              className={`absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-gradient-to-br ${config.gradient} border-2 border-[#0a0a0a] flex items-center justify-center shadow-lg`}
                              style={{ boxShadow: `0 2px 10px ${config.glow}` }}
                            >
                              <span className="text-[9px] font-black text-white uppercase tracking-tight drop-shadow">
                                {achievement.tier === 'platinum' ? '✦' : achievement.tier === 'diamond' ? '◆' : achievement.tier[0].toUpperCase()}
                              </span>
                            </div>
                          )}
                        </div>
                        
                        {/* Name with glow */}
                        <span className={`text-[12px] font-bold text-center leading-tight relative ${
                          earned ? 'text-white' : 'text-[#555]'
                        }`}>
                          {achievement.name}
                          {earned && (
                            <span 
                              className="absolute inset-0 blur-sm opacity-50"
                              style={{ color: config.accent }}
                            >
                              {achievement.name}
                            </span>
                          )}
                        </span>

                        {/* Tier label */}
                        <span 
                          className={`text-[10px] mt-1 capitalize font-semibold tracking-wide ${
                            earned ? '' : 'text-[#444]'
                          }`}
                          style={earned ? { color: config.accent } : {}}
                        >
                          {achievement.tier}
                        </span>

                        {/* Progress bar for unearned */}
                        {!earned && achievement.progress !== undefined && achievement.max_progress && (
                          <div className="w-full mt-3">
                            <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
                              <div 
                                className="h-full rounded-full relative overflow-hidden"
                                style={{ 
                                  width: `${(achievement.progress / achievement.max_progress) * 100}%`,
                                  background: `linear-gradient(90deg, ${config.accent}, ${config.glow})`
                                }}
                              >
                                <div className="shimmer-effect absolute inset-0 w-[200%] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                              </div>
                            </div>
                            <span className="text-[9px] text-[#666] mt-1.5 block text-center font-medium">
                              {achievement.progress}/{achievement.max_progress}
                            </span>
                          </div>
                        )}

                      </div>
                    )
                  })}
                </div>
                
                {/* Achievement Detail Modal */}
                {selectedAchievement && (() => {
                  const IconComponent = iconMap[selectedAchievement.icon] || Award
                  const details = achievementDetails[selectedAchievement.id]
                  const tierConfig: Record<string, { gradient: string; glow: string; accent: string }> = {
                    bronze: { gradient: 'from-amber-700 via-orange-500 to-yellow-600', glow: 'rgba(205, 127, 50, 0.6)', accent: '#cd7f32' },
                    silver: { gradient: 'from-slate-300 via-gray-100 to-slate-400', glow: 'rgba(192, 192, 192, 0.6)', accent: '#c0c0c0' },
                    gold: { gradient: 'from-yellow-300 via-amber-200 to-yellow-500', glow: 'rgba(255, 215, 0, 0.7)', accent: '#ffd700' },
                    platinum: { gradient: 'from-cyan-200 via-white to-blue-200', glow: 'rgba(6, 182, 212, 0.6)', accent: '#06b6d4' },
                    diamond: { gradient: 'from-violet-400 via-fuchsia-300 to-cyan-300', glow: 'rgba(139, 92, 246, 0.7)', accent: '#8b5cf6' }
                  }
                  const config = tierConfig[selectedAchievement.tier]
                  
                  return (
                    <div 
                      className="fixed inset-0 z-[60] flex items-center justify-center"
                      onClick={() => setSelectedAchievement(null)}
                    >
                      {/* Backdrop */}
                      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
                      
                      {/* Modal */}
                      <div 
                        className="relative w-full max-w-sm mx-4 bg-gradient-to-br from-[#12121a] to-[#0a0a0f] border border-[#2a2a3e] rounded-2xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                        style={{ boxShadow: `0 25px 80px -20px ${config.glow}` }}
                      >
                        {/* Header glow */}
                        <div 
                          className="absolute top-0 left-0 right-0 h-32 opacity-30"
                          style={{ background: `radial-gradient(ellipse at 50% 0%, ${config.glow}, transparent 70%)` }}
                        />
                        
                        {/* Close button */}
                        <button
                          onClick={() => setSelectedAchievement(null)}
                          className="absolute top-4 right-4 text-[#666] hover:text-white transition-colors z-10"
                        >
                          <X size={20} />
                        </button>
                        
                        {/* Content */}
                        <div className="relative p-6 text-center">
                          {/* Large badge */}
                          <div className="relative inline-block mb-4">
                            {/* Glow rings */}
                            {selectedAchievement.earned && (
                              <>
                                <div className="absolute inset-0 rounded-full glow-ring" style={{ background: `conic-gradient(from 0deg, transparent, ${config.accent}, transparent)`, filter: 'blur(12px)' }} />
                                <div className="absolute -inset-2 rounded-full rotating-border opacity-50">
                                  <div className="w-full h-full rounded-full" style={{ background: `conic-gradient(from 0deg, ${config.accent}, transparent 30%, ${config.accent} 50%, transparent 80%, ${config.accent})` }} />
                                </div>
                              </>
                            )}
                            
                            <div 
                              className={`relative w-24 h-24 rounded-full flex items-center justify-center ${
                                selectedAchievement.earned 
                                  ? `bg-gradient-to-br ${config.gradient}` 
                                  : 'bg-[#1a1a1a] border border-[#333]'
                              }`}
                              style={selectedAchievement.earned ? { boxShadow: `inset 0 3px 12px rgba(255,255,255,0.3), inset 0 -3px 12px rgba(0,0,0,0.3), 0 0 40px ${config.glow}` } : {}}
                            >
                              {selectedAchievement.earned && (
                                <div className="absolute inset-0 rounded-full overflow-hidden">
                                  <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/40 to-transparent" />
                                  <div className="shimmer-effect absolute -inset-full w-[200%] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                                </div>
                              )}
                              <IconComponent className={`w-12 h-12 ${selectedAchievement.earned ? 'text-white drop-shadow-lg' : 'text-[#444]'}`} />
                            </div>
                            
                            {/* Tier badge */}
                            {selectedAchievement.earned && (
                              <div 
                                className={`absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-gradient-to-br ${config.gradient} border-3 border-[#12121a] flex items-center justify-center`}
                                style={{ boxShadow: `0 4px 15px ${config.glow}` }}
                              >
                                <span className="text-[11px] font-black text-white uppercase">
                                  {selectedAchievement.tier === 'platinum' ? '✦' : selectedAchievement.tier === 'diamond' ? '◆' : selectedAchievement.tier[0].toUpperCase()}
                                </span>
                              </div>
                            )}
                          </div>
                          
                          {/* Status badge */}
                          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold mb-3 ${
                            selectedAchievement.earned 
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                              : 'bg-[#222] text-[#666] border border-[#333]'
                          }`}>
                            {selectedAchievement.earned ? '✓ UNLOCKED' : '🔒 LOCKED'}
                          </div>
                          
                          {/* Title */}
                          <h3 className="text-xl font-bold text-white mb-1">{selectedAchievement.name}</h3>
                          
                          {/* Tier */}
                          <div className="text-[12px] font-semibold capitalize mb-4" style={{ color: config.accent }}>
                            {selectedAchievement.tier} Tier
                          </div>
                          
                          {/* Description */}
                          <p className="text-[13px] text-[#888] mb-5">{selectedAchievement.description}</p>
                          
                          {/* Details grid */}
                          <div className="grid grid-cols-3 gap-3 mb-5">
                            <div className="bg-[#1a1a2e]/50 rounded-lg p-3 border border-[#2a2a3e]">
                              <div className="text-[10px] text-[#666] uppercase mb-1">Reward</div>
                              <div className="text-[12px] font-semibold text-purple-400">{details?.reward || '+50 XP'}</div>
                            </div>
                            <div className="bg-[#1a1a2e]/50 rounded-lg p-3 border border-[#2a2a3e]">
                              <div className="text-[10px] text-[#666] uppercase mb-1">Rarity</div>
                              <div className={`text-[12px] font-semibold ${
                                details?.rarity === 'Legendary' ? 'text-amber-400' :
                                details?.rarity === 'Epic' ? 'text-purple-400' :
                                details?.rarity === 'Rare' ? 'text-blue-400' :
                                details?.rarity === 'Uncommon' ? 'text-green-400' : 'text-gray-400'
                              }`}>{details?.rarity || 'Common'}</div>
                            </div>
                            <div className="bg-[#1a1a2e]/50 rounded-lg p-3 border border-[#2a2a3e]">
                              <div className="text-[10px] text-[#666] uppercase mb-1">Progress</div>
                              <div className="text-[12px] font-semibold text-white">
                                {selectedAchievement.earned ? '100%' : selectedAchievement.progress && selectedAchievement.max_progress 
                                  ? `${Math.round((selectedAchievement.progress / selectedAchievement.max_progress) * 100)}%` 
                                  : '0%'}
                              </div>
                            </div>
                          </div>
                          
                          {/* Progress bar for unearned */}
                          {!selectedAchievement.earned && selectedAchievement.progress !== undefined && selectedAchievement.max_progress && (
                            <div className="mb-5">
                              <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
                                <div 
                                  className="h-full rounded-full relative overflow-hidden"
                                  style={{ 
                                    width: `${(selectedAchievement.progress / selectedAchievement.max_progress) * 100}%`,
                                    background: `linear-gradient(90deg, ${config.accent}, ${config.glow})`
                                  }}
                                >
                                  <div className="shimmer-effect absolute inset-0 w-[200%] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                                </div>
                              </div>
                              <div className="text-[11px] text-[#666] mt-2">
                                {selectedAchievement.progress} / {selectedAchievement.max_progress}
                              </div>
                            </div>
                          )}
                          
                          {/* How to earn */}
                          <div className="bg-[#0a0a0f] rounded-xl p-4 border border-[#222] text-left">
                            <div className="text-[10px] text-[#666] uppercase font-semibold mb-2">How to earn</div>
                            <p className="text-[12px] text-[#aaa] leading-relaxed">{details?.howToEarn || 'Complete the required actions to unlock this achievement.'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* Stats */}
                <div className="mt-4 pt-4 border-t border-[#333] flex items-center justify-between text-[12px]">
                  <span className="text-[#858585]">
                    <span className="text-white font-medium">{achievements.filter(a => a.earned).length}</span> / {achievements.length} earned
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-1">
                      {['bronze', 'silver', 'gold'].map((tier) => (
                        <div 
                          key={tier}
                          className={`w-4 h-4 rounded-full bg-gradient-to-br ${tierColors[tier as keyof typeof tierColors]} border`}
                        />
                      ))}
                    </div>
                    <span className="text-purple-400 font-medium">
                      Level {Math.floor(achievements.filter(a => a.earned).length / 2) + 1}
                    </span>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
}

