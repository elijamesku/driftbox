'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import IDELayout from '@/components/IDE/IDELayout'

export default function IDEPage() {
  const { isAuthenticated, isLoading } = useAuth()
  const [isMounted, setIsMounted] = useState(false)

  // Ensure client-side only rendering to prevent hydration errors
  useEffect(() => {
    setIsMounted(true)
    
    // Remove any loading overlay from login page
    const overlay = document.getElementById('global-loading-overlay')
    if (overlay) {
      overlay.remove()
    }
  }, [])

  useEffect(() => {
    // Only redirect if auth has finished loading AND user is not authenticated
    if (isLoading) {
      return
    }
    
    if (!isAuthenticated) {
      console.log('🚫 [IDEPage] Not authenticated, redirecting to landing page')
      window.location.href = '/'
    }
  }, [isAuthenticated, isLoading])

  // Don't render anything until mounted on client (prevents hydration errors)
  if (!isMounted) {
    return null
  }

  // Don't render IDE until authenticated
  if (!isAuthenticated) {
    return null
  }

  // INSTANT - No loading overlay, just render the IDE immediately
  return <IDELayout />
}

