'use client'

/**
 * Admin Leaderboard Dashboard
 * Shows team rankings, top achievers, and statistics
 */

import { useState, useEffect } from 'react'
import { Trophy, TrendingUp, Zap, Users, Award, Medal, Crown } from 'lucide-react'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import AchievementBadge from './AchievementBadge'

interface AdminLeaderboardProps {
  teamId: string
  token: string
}

export default function AdminLeaderboard({ teamId, token }: AdminLeaderboardProps) {
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'achievers' | 'overview'>('leaderboard')
  const [metric, setMetric] = useState('prs_created')
  const [leaderboard, setLeaderboard] = useState<any[]>([])
  const [topAchievers, setTopAchievers] = useState<any[]>([])
  const [overview, setOverview] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [teamId, metric])

  const loadData = async () => {
    setLoading(true)
    try {
      // Load leaderboard
      const leaderboardRes = await fetch(
        getApiEndpoint(`/achievements/teams/${teamId}/leaderboard?metric=${metric}&limit=20`),
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (leaderboardRes.ok) {
        const data = await leaderboardRes.json()
        setLeaderboard(data.leaderboard || [])
      }

      // Load top achievers
      const achieversRes = await fetch(
        getApiEndpoint(`/achievements/teams/${teamId}/top-achievers?limit=10`),
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (achieversRes.ok) {
        const data = await achieversRes.json()
        setTopAchievers(data.top_achievers || [])
      }

      // Load overview
      const overviewRes = await fetch(
        getApiEndpoint(`/achievements/teams/${teamId}/overview`),
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (overviewRes.ok) {
        const data = await overviewRes.json()
        setOverview(data)
      }
    } catch (error) {
      console.error('Failed to load leaderboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const getRankMedal = (rank: number) => {
    if (rank === 1) return { icon: '🥇', color: 'text-yellow-400' }
    if (rank === 2) return { icon: '🥈', color: 'text-gray-400' }
    if (rank === 3) return { icon: '🥉', color: 'text-amber-600' }
    return { icon: `#${rank}`, color: 'text-gray-500' }
  }

  const metricLabels: Record<string, string> = {
    prs_created: 'Total PRs',
    team_prs: 'Team PRs',
    ai_assisted: 'AI Changes',
    cost_saved: 'Cost Saved',
    streak: 'Current Streak'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#1e1e1e] rounded-lg border border-[#3a3a3a] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Trophy className="w-6 h-6 text-yellow-400" />
            <h2 className="text-2xl font-bold text-white">Team Leaderboard</h2>
          </div>
          
          {overview && (
            <div className="text-right">
              <div className="text-2xl font-bold text-white">{overview.total_members}</div>
              <div className="text-xs text-gray-400">Active Members</div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('leaderboard')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'leaderboard'
                ? 'bg-purple-600 text-white'
                : 'bg-[#2a2a2a] text-gray-400 hover:text-white'
            }`}
          >
            📊 Rankings
          </button>
          <button
            onClick={() => setActiveTab('achievers')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'achievers'
                ? 'bg-purple-600 text-white'
                : 'bg-[#2a2a2a] text-gray-400 hover:text-white'
            }`}
          >
            🏆 Top Achievers
          </button>
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'overview'
                ? 'bg-purple-600 text-white'
                : 'bg-[#2a2a2a] text-gray-400 hover:text-white'
            }`}
          >
            📈 Overview
          </button>
        </div>
      </div>

      {/* Leaderboard Tab */}
      {activeTab === 'leaderboard' && (
        <div className="bg-[#1e1e1e] rounded-lg border border-[#3a3a3a] p-6">
          {/* Metric Selector */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Rank By
            </label>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(metricLabels).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setMetric(key)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    metric === key
                      ? 'bg-purple-600 text-white'
                      : 'bg-[#2a2a2a] text-gray-400 hover:text-white hover:bg-[#3a3a3a]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Leaderboard List */}
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="animate-pulse bg-[#2a2a2a] h-16 rounded-lg"></div>
              ))}
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Trophy className="w-16 h-16 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No data yet - start contributing!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((entry, idx) => {
                const medal = getRankMedal(entry.rank)
                const isTopThree = entry.rank <= 3
                
                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-4 p-4 rounded-lg border transition-all hover:scale-[1.02] ${
                      isTopThree
                        ? 'bg-gradient-to-r from-purple-900/20 to-pink-900/20 border-purple-500/30'
                        : 'bg-[#2a2a2a] border-[#3a3a3a]'
                    }`}
                  >
                    {/* Rank */}
                    <div className={`text-2xl font-bold ${medal.color} w-12 text-center`}>
                      {medal.icon}
                    </div>

                    {/* User Avatar */}
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-semibold">
                      {entry.user_id[0].toUpperCase()}
                    </div>

                    {/* User Info */}
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-white">
                        {entry.user_id}
                      </div>
                      <div className="text-xs text-gray-400">
                        {entry.achievements_count} achievement{entry.achievements_count !== 1 ? 's' : ''}
                      </div>
                    </div>

                    {/* Score */}
                    <div className="text-right">
                      <div className="text-xl font-bold text-white">
                        {typeof entry.value === 'number' && metric === 'cost_saved'
                          ? `$${(entry.value / 1000).toFixed(1)}k`
                          : entry.value}
                      </div>
                      <div className="text-xs text-gray-400">{metricLabels[metric]}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Top Achievers Tab */}
      {activeTab === 'achievers' && (
        <div className="bg-[#1e1e1e] rounded-lg border border-[#3a3a3a] p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Award className="w-5 h-5 text-yellow-400" />
            Most Accomplished
          </h3>

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="animate-pulse bg-[#2a2a2a] h-32 rounded-lg"></div>
              ))}
            </div>
          ) : topAchievers.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Award className="w-16 h-16 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No achievements yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {topAchievers.map((achiever, idx) => (
                <div
                  key={idx}
                  className="bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-lg">
                        {achiever.user_id[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {achiever.user_id}
                        </div>
                        <div className="text-xs text-gray-400">
                          {achiever.achievement_count} achievements • {achiever.prs_created} PRs
                        </div>
                      </div>
                    </div>

                    {idx === 0 && (
                      <Crown className="w-6 h-6 text-yellow-400" />
                    )}
                  </div>

                  {/* Achievements */}
                  {achiever.achievements && achiever.achievements.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {achiever.achievements.slice(0, 8).map((achievement: any, aIdx: number) => (
                        <AchievementBadge
                          key={aIdx}
                          achievement={achievement}
                          size="small"
                          showDetails={true}
                        />
                      ))}
                      {achiever.achievements.length > 8 && (
                        <div className="w-12 h-12 rounded-full bg-[#3a3a3a] flex items-center justify-center text-gray-400 text-xs">
                          +{achiever.achievements.length - 8}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Overview Tab */}
      {activeTab === 'overview' && overview && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#1e1e1e] rounded-lg border border-[#3a3a3a] p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <Users className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">{overview.total_members}</div>
                  <div className="text-xs text-gray-400">Team Members</div>
                </div>
              </div>
            </div>

            <div className="bg-[#1e1e1e] rounded-lg border border-[#3a3a3a] p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">{overview.total_prs}</div>
                  <div className="text-xs text-gray-400">Total PRs</div>
                </div>
              </div>
            </div>

            <div className="bg-[#1e1e1e] rounded-lg border border-[#3a3a3a] p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">{overview.total_ai_changes}</div>
                  <div className="text-xs text-gray-400">AI Changes</div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#1e1e1e] rounded-lg border border-[#3a3a3a] p-6">
            <h3 className="text-lg font-semibold text-white mb-3">Cost Savings</h3>
            <div className="text-4xl font-bold text-green-400 mb-2">
              ${(overview.total_cost_saved_usd / 1000).toFixed(1)}k
            </div>
            <div className="text-sm text-gray-400">
              Total infrastructure cost saved by the team
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

