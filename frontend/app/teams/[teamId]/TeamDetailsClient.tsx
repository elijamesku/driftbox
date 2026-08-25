'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * TeamDetailsClient - Redirects to the new dashboard teams page
 * This is a stub to handle the old route structure
 */
export default function TeamDetailsClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')

  useEffect(() => {
    // Redirect to the new dashboard teams page
    if (teamId) {
      router.replace(`/dashboard/teams/${teamId}`)
    } else {
      router.replace('/dashboard/teams')
    }
  }, [teamId, router])

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-6 h-6 border-2 border-[#333] border-t-[#14b8a6] rounded-full animate-spin"></div>
        <p className="text-sm text-[#666]">Loading team...</p>
      </div>
    </div>
  )
}

