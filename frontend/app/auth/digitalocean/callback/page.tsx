'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { getApiEndpoint } from '@/utils/apiEndpoint'

export default function DigitalOceanCallbackPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('Completing DigitalOcean connection...')

  useEffect(() => {
    // Get params from URL
    const access_token = searchParams.get('access_token')
    const refresh_token = searchParams.get('refresh_token')
    const expires_in = searchParams.get('expires_in')
    const do_uuid = searchParams.get('do_uuid')
    const errorParam = searchParams.get('error')
    
    console.log('🌊 [DO Callback] Access token received:', !!access_token)
    console.log('🌊 [DO Callback] DO UUID:', do_uuid)
    
    if (errorParam) {
      setError(`DigitalOcean authentication failed: ${errorParam}`)
      return
    }
    
    if (!access_token) {
      setError('No access token received from DigitalOcean')
      return
    }
    
    // Get stored auth token
    const authToken = localStorage.getItem('token')
    if (!authToken) {
      setError('You must be logged in to connect DigitalOcean')
      return
    }
    
    // Connect DigitalOcean to user account
    setStatus('Connecting your DigitalOcean account...')
    
    const connectUrl = getApiEndpoint('/auth/digitalocean/connect')
    const params = new URLSearchParams({
      access_token: access_token,
      ...(refresh_token && { refresh_token }),
      ...(expires_in && { expires_in }),
      ...(do_uuid && { do_uuid })
    })
    
    fetch(`${connectUrl}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    })
      .then(async (response) => {
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.detail || 'Failed to connect DigitalOcean')
        }
        return response.json()
      })
      .then((data) => {
        console.log('🌊 [DO Callback] Connected successfully:', data)
        setStatus('Connected! Redirecting to dashboard...')
        
        // Store DO connection status
        localStorage.setItem('digitalocean_connected', 'true')
        localStorage.setItem('digitalocean_id', do_uuid || '')
        
        // Redirect to dashboard settings
        setTimeout(() => {
          router.push('/dashboard?do_connected=true')
        }, 1000)
      })
      .catch((err) => {
        console.error('🌊 [DO Callback] Error:', err)
        setError(err.message)
      })
  }, [searchParams, router])

  if (error) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[var(--bg-base)]">
        <div className="text-center max-w-md px-4">
          <div className="mb-8">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          </div>
          <h2 className="text-[20px] font-semibold text-red-500 mb-2">
            Connection Failed
          </h2>
          <p className="text-[14px] text-[var(--text-secondary)] mb-6">
            {error}
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-4 py-2 bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] text-[14px] transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[var(--bg-base)]">
      <div className="text-center">
        <div className="mb-8">
          {/* DigitalOcean logo/icon */}
          <div className="w-16 h-16 mx-auto rounded-full bg-[#0080FF]/10 flex items-center justify-center animate-pulse">
            <svg className="w-8 h-8 text-[#0080FF]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12c3.2 0 6.2-1.3 8.5-3.5l-4.2-4.2c-1.2 1.2-2.7 1.7-4.3 1.7-3.3 0-6-2.7-6-6s2.7-6 6-6c1.6 0 3.1.6 4.3 1.7l4.2-4.2C18.2 1.3 15.2 0 12 0z"/>
            </svg>
          </div>
        </div>
        <p className="text-[var(--text-secondary)] text-sm">{status}</p>
        <div className="mt-4 flex justify-center">
          <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    </div>
  )
}

