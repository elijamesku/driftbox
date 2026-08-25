'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './AuthContext'
import { GitHubProvider } from './GitHubContext'
import { IDEProvider } from './IDEContext'

// Create a QueryClient instance with default options
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes - data is fresh for 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes - cache garbage collection
      refetchOnWindowFocus: false, // Don't refetch on window focus
      retry: 1, // Only retry once on failure
    },
  },
})

/**
 * Root Providers component that wraps all context providers
 * Import this in app/layout.tsx to make contexts available throughout the app
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <GitHubProvider>
          <IDEProvider>
            {children}
          </IDEProvider>
        </GitHubProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

// Re-export hooks for convenience
export { useAuth } from './AuthContext'
export { useGitHub } from './GitHubContext'
export { useIDE, useSelectedRepo, useSelectedFile, useTeamWorkspace, useIDEUI } from './IDEContext'

