'use client'

/**
 * Profile Achievements Component
 * Shows user's achievements, stats, and badges on their profile
 */

import { useState, useEffect } from 'react'
import { Trophy, TrendingUp, Zap, Target, Award } from 'lucide-react'
import AchievementBadge from './AchievementBadge'
import { getApiEndpoint } from '@/utils/apiEndpoint'

interface ProfileAchievementsProps {
  teamId: string
  userId: string
  token: string
  isOwnProfile?: boolean
}

export default function ProfileAchievements({ 
  teamId, 
  userId, 
  token,
  isOwnProfile = false 
}: ProfileAchievementsProps) {
  const [achievements, setAchievements] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAchievements()
    loadStats()
  }, [teamId, userId])

  const loadAchievements = async () => {
    try {
      const response = await fetch(
        getApiEndpoint(`/achievements/teams/${teamId}/users/${userId}/achievements`),
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      )
      
      if (response.ok) {
        const data = await response.json()
        setAchievements(data.achievements || [])
      }
    } catch (error) {
      console.error('Failed to load achievements:', error)
    }
  }

  const loadStats = async () => {
    try {
      const response = await fetch(
        getApiEndpoint(`/achievements/teams/${teamId}/users/${userId}/stats`),
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      )
      
      if (response.ok) {
        const data = await response.json()
        setStats(data.stats || {})
      }
    } catch (error) {
      console.error('Failed to load stats:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 bg-[#1e1e1e] rounded-lg border border-[#3a3a3a]">
        <div className="animate-pulse">
          <div className="h-6 bg-[#2a2a2a] rounded w-1/3 mb-4"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-20 bg-[#2a2a2a] rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Sort achievements by tier
  const tierOrder = { diamond: 5, platinum: 4, gold: 3, silver: 2, bronze: 1 }
  const sortedAchievements = [...achievements].sort((a, b) => 
    (tierOrder[b.tier as keyof typeof tierOrder] || 0) - (tierOrder[a.tier as keyof typeof tierOrder] || 0)
  )

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="bg-[#1e1e1e] rounded-lg border border-[#3a3a3a] p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-semibold text-white">Statistics</h3>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[#252526] rounded-lg p-4 border border-[#3a3a3a]">
            <div className="text-2xl font-bold text-white mb-1">
              {stats?.prs_created || 0}
            </div>
            <div className="text-xs text-gray-400">PRs Created</div>
          </div>

          <div className="bg-[#252526] rounded-lg p-4 border border-[#3a3a3a]">
            <div className="text-2xl font-bold text-purple-400 mb-1">
              {stats?.team_prs || 0}
            </div>
            <div className="text-xs text-gray-400">Team PRs</div>
          </div>

          <div className="bg-[#252526] rounded-lg p-4 border border-[#3a3a3a]">
            <div className="text-2xl font-bold text-blue-400 mb-1">
              {stats?.ai_assisted_changes || 0}
            </div>
            <div className="text-xs text-gray-400">AI Assisted</div>
          </div>

          <div className="bg-[#252526] rounded-lg p-4 border border-[#3a3a3a]">
            <div className="text-2xl font-bold text-orange-400 mb-1">
              {stats?.streak_days || 0} 🔥
            </div>
            <div className="text-xs text-gray-400">Day Streak</div>
          </div>
        </div>

        {/* Additional Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
          <div className="bg-[#252526] rounded-lg p-3 border border-[#3a3a3a]">
            <div className="flex items-center gap-2">
              <div className="text-green-400 text-lg">✅</div>
              <div>
                <div className="text-sm font-semibold text-white">
                  {stats?.validations_passed || 0}
                </div>
                <div className="text-xs text-gray-400">Validations Passed</div>
              </div>
            </div>
          </div>

          <div className="bg-[#252526] rounded-lg p-3 border border-[#3a3a3a]">
            <div className="flex items-center gap-2">
              <div className="text-red-400 text-lg">🛡️</div>
              <div>
                <div className="text-sm font-semibold text-white">
                  {stats?.security_fixes || 0}
                </div>
                <div className="text-xs text-gray-400">Security Fixes</div>
              </div>
            </div>
          </div>

          <div className="bg-[#252526] rounded-lg p-3 border border-[#3a3a3a]">
            <div className="flex items-center gap-2">
              <div className="text-yellow-400 text-lg">💰</div>
              <div>
                <div className="text-sm font-semibold text-white">
                  ${((stats?.cost_saved_usd || 0) / 1000).toFixed(1)}k
                </div>
                <div className="text-xs text-gray-400">Cost Saved</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Achievements */}
      <div className="bg-[#1e1e1e] rounded-lg border border-[#3a3a3a] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-400" />
            <h3 className="text-lg font-semibold text-white">
              Achievements ({achievements.length})
            </h3>
          </div>
          
          {achievements.length > 0 && (
            <div className="text-sm text-gray-400">
              {achievements.filter(a => a.tier === 'platinum' || a.tier === 'diamond').length} rare
            </div>
          )}
        </div>

        {achievements.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Award className="w-16 h-16 mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {isOwnProfile 
                ? "Start contributing to earn achievements!"
                : "No achievements yet"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
            {sortedAchievements.map((achievement, idx) => (
              <AchievementBadge
                key={idx}
                achievement={achievement}
                size="medium"
                showDetails={true}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity (if own profile) */}
      {isOwnProfile && stats && (
        <div className="bg-[#1e1e1e] rounded-lg border border-[#3a3a3a] p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-purple-400" />
            <h3 className="text-lg font-semibold text-white">Keep Going!</h3>
          </div>
          
          <div className="space-y-3">
            {/* Progress bars for next achievements */}
            <div className="bg-[#252526] rounded-lg p-3 border border-[#3a3a3a]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-300">Next: Team Player (Silver)</span>
                <span className="text-xs text-gray-500">{stats.team_prs || 0}/25</span>
              </div>
              <div className="w-full bg-[#1e1e1e] rounded-full h-2">
                <div 
                  className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(((stats.team_prs || 0) / 25) * 100, 100)}%` }}
                ></div>
              </div>
            </div>

            <div className="bg-[#252526] rounded-lg p-3 border border-[#3a3a3a]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-300">Next: AI Whisperer (Gold)</span>
                <span className="text-xs text-gray-500">{stats.ai_assisted_changes || 0}/200</span>
              </div>
              <div className="w-full bg-[#1e1e1e] rounded-full h-2">
                <div 
                  className="bg-gradient-to-r from-blue-500 to-cyan-500 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(((stats.ai_assisted_changes || 0) / 200) * 100, 100)}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

