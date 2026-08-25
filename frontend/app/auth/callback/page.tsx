'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getApiEndpoint } from '@/utils/apiEndpoint'

export default function GitHubCallbackPage() {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Process immediately on mount
    // Check both query params (dev) and hash fragment (production file:// URLs)
    let token = searchParams.get('token')
    let code = searchParams.get('code')
    let error = searchParams.get('error')
    
    // If not in query params, check hash fragment (for file:// URLs in production)
    if (!token && !code && !error && typeof window !== 'undefined') {
      const hash = window.location.hash.substring(1) // Remove #
      if (hash) {
        const hashParams = new URLSearchParams(hash)
        token = hashParams.get('token') || token
        code = hashParams.get('code') || code
        error = hashParams.get('error') || error
      }
    }
    
    console.log('🔐 [Callback] Token received:', !!token)
    console.log('🔐 [Callback] Code received:', !!code)
    console.log('🔐 [Callback] Error:', error)
    
    // Detect if we're in Electron or browser
    const isElectron = typeof window !== 'undefined' && (window as any).electronAPI?.isDesktop
    console.log('🔐 [Callback] Running in Electron:', isElectron)
    
    if (error) {
      setError(`Authentication failed: ${error}`)
    } else if (token) {
      // Store token and redirect immediately
      localStorage.setItem('token', token)
      console.log('🔐 [Callback] Redirecting to Dashboard...')
      window.location.href = '/dashboard'
    } else if (code) {
      console.log('🔐 [Callback] Exchanging code for token via backend...')
      const apiUrl = getApiEndpoint(`/auth/github/callback?code=${code}`)
      
      // Exchange code for token
      fetch(apiUrl, {
        redirect: 'manual',
        headers: {
          'Referer': 'http://localhost:3000'
        }
      })
        .then(async (response) => {
          console.log('🔐 [Callback] Backend response status:', response.status)
          
          // Backend returns 302 redirect to /auth/callback?token=...
          if (response.status === 302 || response.status === 301 || response.status === 307) {
            const redirectUrl = response.headers.get('location')
            console.log('🔐 [Callback] Redirect URL:', redirectUrl)
            
            if (redirectUrl) {
              // Extract token from redirect URL
              const redirectUrlObj = new URL(redirectUrl, 'http://localhost:3000')
              const extractedToken = redirectUrlObj.searchParams.get('token')
              
              if (extractedToken) {
                console.log('🔐 [Callback] Token extracted!')
                
                // Store token and redirect to Dashboard (works for both Electron and browser)
                localStorage.setItem('token', extractedToken)
                console.log('🔐 [Callback] Redirecting to Dashboard...')
                window.location.href = '/dashboard'
              } else {
                throw new Error('No token in redirect URL')
              }
            } else {
              throw new Error('No redirect URL in response')
            }
          } else if (!response.ok) {
            const errorText = await response.text()
            throw new Error(errorText || `HTTP ${response.status}`)
          } else {
            throw new Error(`Unexpected response status: ${response.status}`)
          }
        })
        .catch((err) => {
          console.error('🔐 [Callback] Error exchanging code:', err)
          setError(`Failed to complete authentication: ${err.message}`)
        })
    } else {
      console.error('🔐 [Callback] No token or code received')
      setError('No authentication token received from GitHub')
    }
  }, [searchParams])

  if (error) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#141414]">
        <div className="text-center">
          <div className="mb-8" style={{ animation: 'logoPulse 2s ease-in-out infinite' }}>
            <img 
              src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg" 
              alt="Logo" 
              width={120} 
              height={120}
              className="mx-auto grayscale opacity-20"
              draggable={false}
            />
          </div>
          <h2 className="text-[20px] font-semibold text-red-500 mb-2">
            Authentication Failed
          </h2>
          <p className="text-[14px] text-[#858585] mb-4">
            {error}
          </p>
          <button
            onClick={() => window.location.href = '/'}
            className="px-4 py-2 bg-white text-black rounded hover:bg-gray-200 text-[14px]"
          >
            Back to Home
          </button>
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes logoPulse {
              0% { filter: drop-shadow(0 0 10px rgba(168, 85, 247, 0.5)); opacity: 0.8; }
              50% { filter: drop-shadow(0 0 25px rgba(168, 85, 247, 0.9)); opacity: 1; }
              100% { filter: drop-shadow(0 0 10px rgba(168, 85, 247, 0.5)); opacity: 0.8; }
            }
          `}} />
        </div>
      </div>
    )
  }

  // Show loading state with Driftbox logo
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#141414]">
      <div className="text-center">
        <div className="mb-8" style={{ animation: 'logoPulse 2s ease-in-out infinite' }}>
          <img 
            src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg" 
            alt="Logo" 
            width={120} 
            height={120}
            className="mx-auto"
            draggable={false}
          />
        </div>
        <p className="text-[#888] text-sm">Completing authentication...</p>
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes logoPulse {
            0% { filter: drop-shadow(0 0 10px rgba(168, 85, 247, 0.5)); opacity: 0.8; }
            50% { filter: drop-shadow(0 0 25px rgba(168, 85, 247, 0.9)); opacity: 1; }
            100% { filter: drop-shadow(0 0 10px rgba(168, 85, 247, 0.5)); opacity: 0.8; }
          }
        `}} />
      </div>
    </div>
  )
}

