'use client'

import { useEffect, useState, useRef, createContext, useContext } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useIDETopBarControls } from '@/hooks/useIDETopBarControls'
import AppSidebar from '@/components/Dashboard/AppSidebar'
import IDETopBarControls from '@/components/IDE/swag/IDETopBarControls'

// Context for sidebar state
interface SidebarContextType {
  isCollapsed: boolean
  toggleSidebar: () => void
}

const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: false,
  toggleSidebar: () => {},
})

export const useSidebar = () => useContext(SidebarContext)

// Get page title based on current route
const getPageTitle = (pathname: string): string => {
  if (pathname === '/dashboard') return 'Cloud Governance Overview'
  if (pathname === '/dashboard/changes') return 'Changes'
  if (pathname === '/dashboard/cost') return 'Cost Management'
  if (pathname === '/dashboard/teams') return 'Teams'
  if (pathname.startsWith('/dashboard/teams/')) return 'Team Details'
  if (pathname === '/dashboard/settings') return 'Settings'
  if (pathname === '/dashboard/ide') return 'IDE Workspace'
  if (pathname === '/dashboard/policies') return 'Policies'
  if (pathname === '/dashboard/governance') return 'Governance & Compliance'
  if (pathname === '/dashboard/drift') return 'Drift Detection'
  if (pathname === '/dashboard/security') return 'Security'
  if (pathname === '/dashboard/sandbox') return 'Sandbox'
  if (pathname === '/dashboard/audit') return 'Audit Logs'
  return 'Dashboard'
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { isAuthenticated, isLoading, token } = useAuth()
  const [isChecking, setIsChecking] = useState(true)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const hasCheckedRef = useRef(false)
  
  const pageTitle = getPageTitle(pathname)
  const isIDEView = pathname === '/dashboard/ide'
  const ideTopBar = useIDETopBarControls()

  // Load sidebar state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    if (saved !== null) {
      setIsCollapsed(JSON.parse(saved))
    }
  }, [])

  const toggleSidebar = () => {
    const newState = !isCollapsed
    setIsCollapsed(newState)
    localStorage.setItem('sidebar-collapsed', JSON.stringify(newState))
  }

  useEffect(() => {
    // Prevent duplicate checks in React Strict Mode
    if (hasCheckedRef.current) return
    
    // Wait for auth state to load
    if (isLoading) return

    hasCheckedRef.current = true

    // Check for token in localStorage as backup
    const storedToken = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    
    if (!isAuthenticated && !token && !storedToken) {
      // Not authenticated, redirect to login
      console.log('🔒 [Dashboard] Not authenticated, redirecting to login')
      router.replace('/')
      return
    }

    setIsChecking(false)
  }, [isAuthenticated, isLoading, token, router])

  // Show loading while checking auth
  if (isChecking || isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="flex flex-col items-center gap-4">
          <img
            src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg"
            alt="Logo"
            className="h-16 w-16 animate-pulse"
          />
          <p className="text-sm text-[#666666]">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <SidebarContext.Provider value={{ isCollapsed, toggleSidebar }}>
      <div className="flex h-screen bg-[#0a0a0a]">
        {/* Sidebar */}
        <AppSidebar isCollapsed={isCollapsed} onToggleCollapsed={toggleSidebar} />
        
        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Top bar */}
          <div className="sticky top-0 z-10 flex h-14 items-center gap-4 bg-[#0a0a0a] px-4 border-b border-[#1f1f1f]">
            {!isIDEView ? (
              <>
                {/* Page Title */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#666666]">{pageTitle}</span>
                </div>
                
                <div className="flex-1" />
              </>
            ) : (
              /* IDE Top Bar Controls */
              ideTopBar.onToggleChat ? (
                <IDETopBarControls />
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#666666]">{pageTitle}</span>
                </div>
              )
            )}
          </div>
          
          {/* Page content */}
          {isIDEView ? (
            <div className="flex-1 overflow-hidden">
              {children}
            </div>
          ) : (
            <div className="h-[calc(100vh-3.5rem)] overflow-auto">
              {children}
            </div>
          )}
        </main>
      </div>
    </SidebarContext.Provider>
  )
}

