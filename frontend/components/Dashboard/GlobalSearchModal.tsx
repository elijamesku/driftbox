'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  X,
  GitCommit,
  Shield,
  AlertTriangle,
  FileText,
  Users,
  Settings,
  LayoutDashboard,
  DollarSign,
  Activity,
  BookOpen,
  Terminal,
  History,
  ChevronRight,
  Sparkles,
  Clock,
  TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface SearchResult {
  id: string
  title: string
  description: string
  category: 'navigation' | 'recent' | 'commits' | 'resources' | 'actions'
  icon: React.ReactNode
  href?: string
  action?: () => void
}

interface GlobalSearchModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function GlobalSearchModal({ isOpen, onClose }: GlobalSearchModalProps) {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDarkMode, setIsDarkMode] = useState(true)

  // Theme detection
  useEffect(() => {
    const checkTheme = () => {
      const hasLightMode = document.documentElement.classList.contains('light-mode')
      setIsDarkMode(!hasLightMode)
    }
    checkTheme()
    const observer = new MutationObserver(checkTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (isOpen) {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Navigation items
  const navigationItems: SearchResult[] = [
    { id: 'dashboard', title: 'Dashboard', description: 'Cloud Governance Overview', category: 'navigation', icon: <LayoutDashboard className="h-4 w-4" />, href: '/dashboard' },
    { id: 'changes', title: 'Changes', description: 'View recent commits and changes', category: 'navigation', icon: <GitCommit className="h-4 w-4" />, href: '/dashboard/changes' },
    { id: 'cost', title: 'Cost Management', description: 'DigitalOcean billing and costs', category: 'navigation', icon: <DollarSign className="h-4 w-4" />, href: '/dashboard/cost' },
    { id: 'teams', title: 'Teams', description: 'Manage your teams', category: 'navigation', icon: <Users className="h-4 w-4" />, href: '/dashboard/teams' },
    { id: 'security', title: 'Security', description: 'Security scanning and policies', category: 'navigation', icon: <Shield className="h-4 w-4" />, href: '/dashboard/security' },
    { id: 'drift', title: 'Drift Detection', description: 'Infrastructure drift monitoring', category: 'navigation', icon: <AlertTriangle className="h-4 w-4" />, href: '/dashboard/drift' },
    { id: 'policies', title: 'Policies', description: 'Policy management', category: 'navigation', icon: <FileText className="h-4 w-4" />, href: '/dashboard/policies' },
    { id: 'sandbox', title: 'Sandbox', description: 'Pre-deployment validation and testing', category: 'navigation', icon: <Terminal className="h-4 w-4" />, href: '/dashboard/sandbox' },
    { id: 'audit', title: 'Audit Logs', description: 'View activity logs', category: 'navigation', icon: <History className="h-4 w-4" />, href: '/dashboard/audit' },
    { id: 'settings', title: 'Settings', description: 'Account and integrations', category: 'navigation', icon: <Settings className="h-4 w-4" />, href: '/dashboard/settings' },
  ]

  // Recent activity items (mock data - would come from API)
  const recentItems: SearchResult[] = [
    { id: 'recent-1', title: 'Last security scan completed', description: '2 issues found in backup repository', category: 'recent', icon: <Shield className="h-4 w-4 text-[#f97316]" />, href: '/dashboard/security' },
    { id: 'recent-2', title: 'Drift detected in production', description: 'digitalocean_droplet.web-server', category: 'recent', icon: <AlertTriangle className="h-4 w-4 text-[#eab308]" />, href: '/dashboard/drift' },
    { id: 'recent-3', title: 'Cost spike detected', description: 'Monthly costs increased by 15%', category: 'recent', icon: <TrendingUp className="h-4 w-4 text-[#ef4444]" />, href: '/dashboard/cost' },
  ]

  // Quick actions
  const actionItems: SearchResult[] = [
    { id: 'action-1', title: 'Run Security Scan', description: 'Scan all repositories for vulnerabilities', category: 'actions', icon: <Sparkles className="h-4 w-4 text-[#14b8a6]" /> },
    { id: 'action-2', title: 'Check for Drift', description: 'Compare infrastructure state', category: 'actions', icon: <Activity className="h-4 w-4 text-[#14b8a6]" /> },
    { id: 'action-3', title: 'Generate Report', description: 'Create compliance report', category: 'actions', icon: <FileText className="h-4 w-4 text-[#14b8a6]" /> },
  ]

  // Filter results based on search query
  const filterResults = (items: SearchResult[]) => {
    if (!searchQuery) return items
    const query = searchQuery.toLowerCase()
    return items.filter(
      item =>
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query)
    )
  }

  const filteredNavigation = filterResults(navigationItems)
  const filteredRecent = filterResults(recentItems)
  const filteredActions = filterResults(actionItems)

  const allResults = [...filteredNavigation, ...filteredRecent, ...filteredActions]

  // Handle selection
  const handleSelect = (result: SearchResult) => {
    if (result.href) {
      router.push(result.href)
    } else if (result.action) {
      result.action()
    }
    onClose()
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => (prev + 1) % allResults.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => (prev - 1 + allResults.length) % allResults.length)
      } else if (e.key === 'Enter' && allResults[selectedIndex]) {
        e.preventDefault()
        handleSelect(allResults[selectedIndex])
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, selectedIndex, allResults])

  if (!isOpen) return null

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'navigation': return <LayoutDashboard className="h-3.5 w-3.5" />
      case 'recent': return <Clock className="h-3.5 w-3.5" />
      case 'actions': return <Sparkles className="h-3.5 w-3.5" />
      default: return null
    }
  }

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'navigation': return 'Navigation'
      case 'recent': return 'Recent Activity'
      case 'actions': return 'Quick Actions'
      default: return category
    }
  }

  return (
    <>
      {/* Backdrop with blur */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
        <div
          className={cn(
            'w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden',
            isDarkMode
              ? 'bg-[#0f0f0f] border border-[#1f1f1f]'
              : 'bg-white border border-gray-200'
          )}
          onClick={e => e.stopPropagation()}
        >
          {/* Search Input */}
          <div className={cn(
            'flex items-center gap-3 px-4 py-4 border-b',
            isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'
          )}>
            <Search className={cn('h-5 w-5', isDarkMode ? 'text-[#666666]' : 'text-gray-400')} />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value)
                setSelectedIndex(0)
              }}
              placeholder="Search pages, actions, and more..."
              className={cn(
                'flex-1 bg-transparent text-base outline-none placeholder:text-[#666666]',
                isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'
              )}
            />
            <kbd className={cn(
              'hidden sm:flex items-center gap-1 px-2 py-1 rounded text-xs',
              isDarkMode ? 'bg-[#1f1f1f] text-[#666666]' : 'bg-gray-100 text-gray-500'
            )}>
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto">
            {/* Navigation Section */}
            {filteredNavigation.length > 0 && (
              <div className="p-2">
                <div className={cn(
                  'flex items-center gap-2 px-3 py-2 text-xs font-medium uppercase tracking-wider',
                  isDarkMode ? 'text-[#666666]' : 'text-gray-500'
                )}>
                  {getCategoryIcon('navigation')}
                  {getCategoryLabel('navigation')}
                </div>
                {filteredNavigation.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                      allResults.indexOf(item) === selectedIndex
                        ? isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100'
                        : isDarkMode ? 'hover:bg-[#141414]' : 'hover:bg-gray-50'
                    )}
                  >
                    <div className={cn(
                      'flex items-center justify-center w-8 h-8 rounded-lg',
                      isDarkMode ? 'bg-[#1a1a1a] text-[#a1a1a1]' : 'bg-gray-100 text-gray-600'
                    )}>
                      {item.icon}
                    </div>
                    <div className="flex-1 text-left">
                      <p className={cn('text-sm font-medium', isDarkMode ? 'text-[#fafafa]' : 'text-gray-900')}>
                        {item.title}
                      </p>
                      <p className={cn('text-xs', isDarkMode ? 'text-[#666666]' : 'text-gray-500')}>
                        {item.description}
                      </p>
                    </div>
                    <ChevronRight className={cn('h-4 w-4', isDarkMode ? 'text-[#444444]' : 'text-gray-300')} />
                  </button>
                ))}
              </div>
            )}

            {/* Recent Activity Section */}
            {filteredRecent.length > 0 && (
              <div className={cn('p-2 border-t', isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-100')}>
                <div className={cn(
                  'flex items-center gap-2 px-3 py-2 text-xs font-medium uppercase tracking-wider',
                  isDarkMode ? 'text-[#666666]' : 'text-gray-500'
                )}>
                  {getCategoryIcon('recent')}
                  {getCategoryLabel('recent')}
                </div>
                {filteredRecent.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                      allResults.indexOf(item) === selectedIndex
                        ? isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100'
                        : isDarkMode ? 'hover:bg-[#141414]' : 'hover:bg-gray-50'
                    )}
                  >
                    <div className={cn(
                      'flex items-center justify-center w-8 h-8 rounded-lg',
                      isDarkMode ? 'bg-[#1a1a1a]' : 'bg-gray-100'
                    )}>
                      {item.icon}
                    </div>
                    <div className="flex-1 text-left">
                      <p className={cn('text-sm font-medium', isDarkMode ? 'text-[#fafafa]' : 'text-gray-900')}>
                        {item.title}
                      </p>
                      <p className={cn('text-xs', isDarkMode ? 'text-[#666666]' : 'text-gray-500')}>
                        {item.description}
                      </p>
                    </div>
                    <ChevronRight className={cn('h-4 w-4', isDarkMode ? 'text-[#444444]' : 'text-gray-300')} />
                  </button>
                ))}
              </div>
            )}

            {/* Quick Actions Section */}
            {filteredActions.length > 0 && (
              <div className={cn('p-2 border-t', isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-100')}>
                <div className={cn(
                  'flex items-center gap-2 px-3 py-2 text-xs font-medium uppercase tracking-wider',
                  isDarkMode ? 'text-[#666666]' : 'text-gray-500'
                )}>
                  {getCategoryIcon('actions')}
                  {getCategoryLabel('actions')}
                </div>
                {filteredActions.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                      allResults.indexOf(item) === selectedIndex
                        ? isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100'
                        : isDarkMode ? 'hover:bg-[#141414]' : 'hover:bg-gray-50'
                    )}
                  >
                    <div className={cn(
                      'flex items-center justify-center w-8 h-8 rounded-lg',
                      isDarkMode ? 'bg-[#14b8a6]/10' : 'bg-teal-50'
                    )}>
                      {item.icon}
                    </div>
                    <div className="flex-1 text-left">
                      <p className={cn('text-sm font-medium', isDarkMode ? 'text-[#fafafa]' : 'text-gray-900')}>
                        {item.title}
                      </p>
                      <p className={cn('text-xs', isDarkMode ? 'text-[#666666]' : 'text-gray-500')}>
                        {item.description}
                      </p>
                    </div>
                    <ChevronRight className={cn('h-4 w-4', isDarkMode ? 'text-[#444444]' : 'text-gray-300')} />
                  </button>
                ))}
              </div>
            )}

            {/* No Results */}
            {allResults.length === 0 && searchQuery && (
              <div className="p-8 text-center">
                <Search className={cn('h-8 w-8 mx-auto mb-3', isDarkMode ? 'text-[#444444]' : 'text-gray-300')} />
                <p className={cn('text-sm', isDarkMode ? 'text-[#666666]' : 'text-gray-500')}>
                  No results found for "{searchQuery}"
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={cn(
            'flex items-center justify-between px-4 py-3 border-t text-xs',
            isDarkMode ? 'border-[#1f1f1f] text-[#666666]' : 'border-gray-200 text-gray-500'
          )}>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className={cn('px-1.5 py-0.5 rounded', isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100')}>↑</kbd>
                <kbd className={cn('px-1.5 py-0.5 rounded', isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100')}>↓</kbd>
                to navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className={cn('px-1.5 py-0.5 rounded', isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100')}>↵</kbd>
                to select
              </span>
            </div>
            <span className="flex items-center gap-1">
              <kbd className={cn('px-1.5 py-0.5 rounded', isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100')}>⌘</kbd>
              <kbd className={cn('px-1.5 py-0.5 rounded', isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-100')}>K</kbd>
              to toggle
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

