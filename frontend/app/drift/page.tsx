'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

interface PR {
  id: string
  repo_full_name: string
  branch_name: string
  commit_message: string
  pr_url: string | null
  pr_number: number | null
  files_changed: string[] | null
  terraform_valid: boolean
  status: string
  created_via: string
  created_at: string
}

interface Stats {
  total_prs: number
  created_prs: number
  merged_prs: number
  recent_prs: number
  top_repos: Array<{ repo: string; count: number }>
}

export default function DriftDetectionPage() {
  const { token, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [prs, setPrs] = useState<PR[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !token) {
      router.push('/auth/callback')
      return
    }

    if (token) {
      fetchData()
    }
  }, [token, authLoading, router])

  const fetchData = async () => {
    try {
      setLoading(true)
      
      // Fetch PRs
      const prsResponse = await fetch('/api/proxy/prs/list?limit=50', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      if (!prsResponse.ok) {
        throw new Error('Failed to fetch PRs')
      }
      
      const prsData = await prsResponse.json()
      setPrs(prsData)
      
      // Fetch stats
      const statsResponse = await fetch('/api/proxy/prs/stats', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      if (!statsResponse.ok) {
        throw new Error('Failed to fetch stats')
      }
      
      const statsData = await statsResponse.json()
      setStats(statsData)
      
    } catch (err: any) {
      setError(err.message)
      console.error('Error fetching drift data:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 60) {
      return `${diffMins}m ago`
    } else if (diffHours < 24) {
      return `${diffHours}h ago`
    } else {
      return `${diffDays}d ago`
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-red-500">Error: {error}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <div className="border-b border-[#2a2a2a] bg-[#141414]">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Pull Request Tracking</h1>
              <p className="text-gray-400">Monitor all infrastructure changes pushed through Infrara</p>
            </div>
            <button
              onClick={() => router.push('/ide')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              ← Back to IDE
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-lg p-6">
              <div className="text-gray-400 text-sm mb-1">Total PRs</div>
              <div className="text-3xl font-bold text-white">{stats.total_prs}</div>
            </div>
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-lg p-6">
              <div className="text-gray-400 text-sm mb-1">Open PRs</div>
              <div className="text-3xl font-bold text-blue-400">{stats.created_prs}</div>
            </div>
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-lg p-6">
              <div className="text-gray-400 text-sm mb-1">Merged</div>
              <div className="text-3xl font-bold text-green-400">{stats.merged_prs}</div>
            </div>
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-lg p-6">
              <div className="text-gray-400 text-sm mb-1">Last 7 Days</div>
              <div className="text-3xl font-bold text-purple-400">{stats.recent_prs}</div>
            </div>
          </div>
        )}

        {/* Top Repositories */}
        {stats && stats.top_repos.length > 0 && (
          <div className="bg-[#141414] border border-[#2a2a2a] rounded-lg p-6 mb-8">
            <h2 className="text-xl font-bold text-white mb-4">Top Repositories</h2>
            <div className="space-y-3">
              {stats.top_repos.map((repo, index) => (
                <div key={repo.repo} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="text-gray-500 font-mono text-sm">#{index + 1}</div>
                    <div className="text-white">{repo.repo}</div>
                  </div>
                  <div className="text-gray-400">{repo.count} PRs</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PR List */}
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-[#2a2a2a]">
            <h2 className="text-xl font-bold text-white">Recent Pull Requests</h2>
          </div>

          {prs.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-400">
              <div className="text-6xl mb-4">🚀</div>
              <p className="text-lg mb-2">No Pull Requests yet</p>
              <p className="text-sm">PRs created through Infrara will appear here</p>
            </div>
          ) : (
            <div className="divide-y divide-[#2a2a2a]">
              {prs.map((pr) => (
                <div key={pr.id} className="px-6 py-4 hover:bg-[#1a1a1a] transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <a
                          href={pr.pr_url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 font-medium truncate"
                        >
                          {pr.repo_full_name}
                        </a>
                        <span className="text-gray-500">·</span>
                        <code className="text-sm text-gray-400 bg-[#0a0a0a] px-2 py-1 rounded">
                          {pr.branch_name}
                        </code>
                      </div>
                      
                      <p className="text-gray-300 text-sm mb-2 truncate">
                        {pr.commit_message || 'No commit message'}
                      </p>
                      
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>{formatDate(pr.created_at)}</span>
                        {pr.files_changed && (
                          <span>{pr.files_changed.length} files changed</span>
                        )}
                        <span className="capitalize">{pr.created_via}</span>
                        {pr.terraform_valid ? (
                          <span className="text-green-400">✓ Validated</span>
                        ) : (
                          <span className="text-red-400">✗ Validation failed</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        pr.status === 'created' ? 'bg-blue-500/20 text-blue-400' :
                        pr.status === 'merged' ? 'bg-green-500/20 text-green-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {pr.status}
                      </span>
                      
                      {pr.pr_url && (
                        <a
                          href={pr.pr_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 hover:bg-[#2a2a2a] rounded transition-colors"
                          title="View on GitHub"
                        >
                          <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                            <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

