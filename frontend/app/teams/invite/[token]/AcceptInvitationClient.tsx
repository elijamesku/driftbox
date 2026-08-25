'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * AcceptInvitationClient - Handles team invitation acceptance
 * Redirects to dashboard after processing
 */
export default function AcceptInvitationClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inviteToken = searchParams.get('inviteToken')

  useEffect(() => {
    // For now, redirect to dashboard teams
    // The actual invitation handling can be implemented in the dashboard
    router.replace('/dashboard/teams')
  }, [inviteToken, router])

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-6 h-6 border-2 border-[#333] border-t-[#14b8a6] rounded-full animate-spin"></div>
        <p className="text-sm text-[#666]">Processing invitation...</p>
      </div>
    </div>
  )
}

