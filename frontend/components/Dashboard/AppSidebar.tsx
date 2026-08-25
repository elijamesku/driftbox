'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import {
  LayoutDashboard,
  Code,
  GitPullRequest,
  Shield,
  ShieldCheck,
  FlaskConical,
  ScrollText,
  Wallet,
  Users,
  FolderGit2,
  Settings,
  Search,
  ChevronDown,
  Moon,
  Sun,
  BookOpen,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import GlobalSearchModal from './GlobalSearchModal'

interface NavItem {
  title: string
  href: string
  icon: React.ElementType
  badge?: string | number
  children?: { title: string; href: string }[]
}

const mainNavItems: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    children: [
      { title: 'Overview', href: '/dashboard' },
      { title: 'Insights', href: '/dashboard/insights' },
    ],
  },
  {
    title: 'IDE',
    href: '/dashboard/ide',
    icon: Code,
  },
  {
    title: 'Changes',
    href: '/dashboard/changes',
    icon: GitPullRequest,
  },
  {
    title: 'Policies',
    href: '/dashboard/policies',
    icon: Shield,
  },
  {
    title: 'Governance',
    href: '/dashboard/governance',
    icon: ShieldCheck,
  },
  {
    title: 'Sandbox',
    href: '/dashboard/sandbox',
    icon: FlaskConical,
  },
  {
    title: 'Audit Logs',
    href: '/dashboard/audit',
    icon: ScrollText,
  },
  {
    title: 'Cost',
    href: '/dashboard/cost',
    icon: Wallet,
  },
]

const secondaryNavItems: NavItem[] = [
  {
    title: 'Teams',
    href: '/dashboard/teams',
    icon: Users,
  },
  {
    title: 'Repos',
    href: '/dashboard/repos',
    icon: FolderGit2,
  },
  {
    title: 'Settings',
    href: '/dashboard/settings',
    icon: Settings,
  },
]

interface AppSidebarProps {
  isCollapsed?: boolean
  onToggleCollapsed?: () => void
}

export default function AppSidebar({ isCollapsed: controlledIsCollapsed, onToggleCollapsed }: AppSidebarProps = {}) {
  const pathname = usePathname()
  const { user } = useAuth()
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(false)
  const [expandedItems, setExpandedItems] = useState<string[]>(['Dashboard'])
  const [isDarkMode, setIsDarkMode] = useState(true) // Default to dark
  const [isSearchOpen, setIsSearchOpen] = useState(false)

  // Keyboard shortcut for search (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsSearchOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Use controlled or internal state
  const isCollapsed = controlledIsCollapsed !== undefined ? controlledIsCollapsed : internalIsCollapsed

  // Load collapsed state and theme from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    if (saved !== null) {
      const savedState = JSON.parse(saved)
      setInternalIsCollapsed(savedState)
    }
    
    // Load theme preference
    const savedTheme = localStorage.getItem('driftbox-theme')
    if (savedTheme === 'light') {
      setIsDarkMode(false)
      document.documentElement.classList.add('light-mode')
    }
  }, [])
  
  // Toggle theme
  const toggleTheme = () => {
    const newMode = !isDarkMode
    setIsDarkMode(newMode)
    localStorage.setItem('driftbox-theme', newMode ? 'dark' : 'light')
    
    if (newMode) {
      document.documentElement.classList.remove('light-mode')
    } else {
      document.documentElement.classList.add('light-mode')
    }
  }

  // Save collapsed state
  const toggleCollapsed = () => {
    if (onToggleCollapsed) {
      onToggleCollapsed()
    } else {
      const newState = !internalIsCollapsed
      setInternalIsCollapsed(newState)
      localStorage.setItem('sidebar-collapsed', JSON.stringify(newState))
    }
  }

  const toggleExpanded = (title: string) => {
    setExpandedItems((prev) =>
      prev.includes(title)
        ? prev.filter((t) => t !== title)
        : [...prev, title]
    )
  }

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard' || pathname === '/dashboard/'
    }
    return pathname.startsWith(href)
  }

  const NavItemComponent = ({ item, isChild = false }: { item: NavItem; isChild?: boolean }) => {
    const active = isActive(item.href)
    const hasChildren = item.children && item.children.length > 0
    const isExpanded = expandedItems.includes(item.title)
    const Icon = item.icon

    const content = (
      <div
        className={cn(
          'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150',
          isChild ? 'ml-6' : '',
          active
            ? 'bg-[#14b8a6]/10 text-[#14b8a6]'
            : 'text-[#a1a1a1] hover:bg-[#141414] hover:text-[#fafafa]',
          isCollapsed && !isChild ? 'justify-center px-2' : ''
        )}
      >
        <Icon
          className={cn(
            'h-4 w-4 flex-shrink-0 transition-colors',
            active ? 'text-[#14b8a6]' : 'text-[#666666] group-hover:text-[#a1a1a1]'
          )}
        />
        {!isCollapsed && (
          <>
            <span className="flex-1 truncate">{item.title}</span>
            {item.badge && (
              <span className="rounded-full bg-[#14b8a6]/20 px-2 py-0.5 text-xs text-[#14b8a6]">
                {item.badge}
              </span>
            )}
            {hasChildren && (
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-[#666666] transition-transform duration-200',
                  isExpanded ? 'rotate-180' : ''
                )}
              />
            )}
          </>
        )}
      </div>
    )

    if (isCollapsed && !isChild) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Link href={item.href} className="block">
              {content}
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" className="flex items-center gap-2">
            {item.title}
            {item.badge && (
              <span className="rounded-full bg-[#14b8a6]/20 px-2 py-0.5 text-xs text-[#14b8a6]">
                {item.badge}
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      )
    }

    if (hasChildren && !isChild) {
      return (
        <div>
          <button
            onClick={() => toggleExpanded(item.title)}
            className="w-full text-left"
          >
            {content}
          </button>
          {isExpanded && !isCollapsed && (
            <div className="mt-1 space-y-1">
              {item.children!.map((child) => (
                <Link key={child.href} href={child.href}>
                  <div
                    className={cn(
                      'ml-6 flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                      isActive(child.href)
                        ? 'text-[#14b8a6]'
                        : 'text-[#666666] hover:text-[#a1a1a1]'
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        isActive(child.href) ? 'bg-[#14b8a6]' : 'bg-[#333333]'
                      )}
                    />
                    {child.title}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )
    }

    return (
      <Link href={item.href} className="block">
        {content}
      </Link>
    )
  }

  return (
    <TooltipProvider>
      <aside
        className={cn(
          'relative flex h-screen flex-col border-r border-[#1f1f1f] bg-[#0d0d0d] transition-all duration-200',
          isCollapsed ? 'w-16' : 'w-60'
        )}
      >
        {/* Pull Tab Button - Only visible when collapsed */}
        {isCollapsed && (
          <button
            onClick={toggleCollapsed}
            className="absolute -right-3 top-1/2 z-50 flex h-12 w-6 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-[#1f1f1f] bg-[#0d0d0d] text-[#666666] shadow-lg transition-all hover:bg-[#141414] hover:text-[#14b8a6] hover:border-[#14b8a6]/30"
            title="Expand sidebar"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
        {/* Logo Header */}
        <div
          className={cn(
            'flex h-14 items-center border-b border-[#1f1f1f] px-4',
            isCollapsed ? 'justify-center' : 'justify-between'
          )}
        >
          {!isCollapsed ? (
            <Link href="/dashboard" className="flex items-center gap-2">
              <img
                src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg"
                alt="Logo"
                className="h-8 w-8"
              />
              <span className="text-lg font-semibold text-[#fafafa]">Driftbox</span>
            </Link>
          ) : (
            <Link href="/dashboard">
              <img
                src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg"
                alt="Logo"
                className="h-8 w-8"
              />
            </Link>
          )}
          {/* Collapse button - only visible when expanded */}
          {!isCollapsed && (
            <button
              onClick={toggleCollapsed}
              className="flex h-6 w-6 items-center justify-center rounded text-[#666666] hover:bg-[#141414] hover:text-[#14b8a6] transition-colors"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 space-y-2 overflow-y-auto p-3">
          {mainNavItems.map((item) => (
            <NavItemComponent key={item.href} item={item} />
          ))}

          <Separator className="my-4" />

          {secondaryNavItems.map((item) => (
            <NavItemComponent key={item.href} item={item} />
          ))}
        </nav>

        {/* Footer - Stacked like Mate Security */}
        <div className="p-3 space-y-2">
          {/* Search */}
          <button
            onClick={() => setIsSearchOpen(true)}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              isDarkMode 
                ? 'text-[#666666] hover:bg-[#141414] hover:text-[#a1a1a1]'
                : 'text-[#666666] hover:bg-gray-100 hover:text-gray-900',
              isCollapsed ? 'justify-center' : ''
            )}
          >
            <Search className="h-4 w-4" />
            {!isCollapsed && <span>Search</span>}
          </button>
          
          {/* Documentation */}
          <Link
            href="/dashboard/docs"
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              isDarkMode 
                ? 'text-[#666666] hover:bg-[#141414] hover:text-[#a1a1a1]'
                : 'text-[#666666] hover:bg-gray-100 hover:text-gray-900',
              isCollapsed ? 'justify-center' : ''
            )}
          >
            <BookOpen className="h-4 w-4" />
            {!isCollapsed && <span>Documentation</span>}
          </Link>
          
          {/* Day/Night Shift Button (NOT a toggle) */}
          <button
            onClick={toggleTheme}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              isDarkMode 
                ? 'text-[#666666] hover:bg-[#141414] hover:text-[#a1a1a1]'
                : 'text-[#666666] hover:bg-gray-100 hover:text-gray-900',
              isCollapsed ? 'justify-center' : ''
            )}
          >
            {isDarkMode ? (
              <Moon className="h-4 w-4" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
            {!isCollapsed && <span>{isDarkMode ? 'Day Shift' : 'Night Shift'}</span>}
          </button>

          {/* User Profile */}
          <div
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 mt-2',
              isCollapsed ? 'justify-center' : ''
            )}
          >
            <div className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium',
              isDarkMode 
                ? 'bg-gradient-to-br from-[#14b8a6] to-[#0d9488] text-white'
                : 'bg-gray-200 text-gray-700'
            )}>
              {user?.email?.[0]?.toUpperCase() || 'U'}
            </div>
            {!isCollapsed && (
              <div className="flex-1 truncate">
                <p className={cn(
                  'truncate text-sm font-medium',
                  isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'
                )}>
                  {user?.email?.split('@')[0] || 'User'}
                </p>
                <p className={cn(
                  'truncate text-xs',
                  isDarkMode ? 'text-[#666666]' : 'text-gray-500'
                )}>
                  {user?.github_username || 'Developer'}
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Global Search Modal */}
      <GlobalSearchModal 
        isOpen={isSearchOpen} 
        onClose={() => setIsSearchOpen(false)} 
      />
    </TooltipProvider>
  )
}

