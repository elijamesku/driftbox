'use client'

import React, { useState, useEffect } from 'react'
import { ChevronLeft, Command, Github } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getApiEndpoint } from '@/utils/apiEndpoint'

interface SignupProps {
  onSignup?: (token: string) => void
  onSwitchToLogin?: () => void
  onBack?: () => void
}

export default function Signup({ onSignup, onSwitchToLogin, onBack }: SignupProps) {
  const { login } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [isGitHubLoading, setIsGitHubLoading] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      handleGitHubSignup()
    } catch (err: any) {
      setError(err.message || 'Signup failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGitHubSignup = async () => {
    setIsGitHubLoading(true)
    try {
      const isDesktop = typeof window !== 'undefined' && (window as any).electronAPI?.isDesktop
      
      const apiUrl = getApiEndpoint('/auth/github')
      const response = await fetch(apiUrl)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      if (data.redirect_url) {
        if (isDesktop) {
          const url = new URL(data.redirect_url)
          const state = url.searchParams.get('state')
          const clientId = url.searchParams.get('client_id')
          
          const desktopRedirectUri = 'driftbox://auth/callback'
          const githubUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(desktopRedirectUri)}&scope=repo%20user&state=${state}`
          
          await (window as any).electronAPI.openExternal(githubUrl)
        } else {
          window.location.href = data.redirect_url
        }
      } else {
        setError('GitHub OAuth not configured')
      }
    } catch (err: any) {
      console.error('GitHub OAuth error:', err)
      setError(`Failed to initiate GitHub signup: ${err.message || 'Unknown error'}`)
    } finally {
      setIsGitHubLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full bg-[#0a0a0a] flex flex-col">
      {/* Back Button */}
      <div className="p-6">
        <button 
          onClick={onBack || (() => window.history.back())}
          className="flex items-center gap-1 text-sm text-[#888] hover:text-white transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center px-6 pb-20">
        <div 
          className={`w-full max-w-sm transition-all duration-700 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="text-white">
              <Command className="h-8 w-8" strokeWidth={1.5} />
            </div>
          </div>

          {/* Heading */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-semibold text-white mb-2">Create an account</h1>
            <p className="text-sm text-[#888]">
              Enter your email to get started
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Email Form */}
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-4 py-3 rounded-lg border border-[#333] bg-[#141414] text-white placeholder-[#666] text-sm focus:outline-none focus:ring-2 focus:ring-white/10 focus:border-[#555] transition-all"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-white hover:bg-gray-100 text-[#0a0a0a] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-[#0a0a0a]/30 border-t-[#0a0a0a] rounded-full animate-spin" />
                  Creating account...
                </span>
              ) : (
                'Sign Up with Email'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#333]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[#0a0a0a] px-4 text-[#666] uppercase tracking-wider">
                Or continue with
              </span>
            </div>
          </div>

          {/* GitHub Button */}
          <button
            onClick={handleGitHubSignup}
            disabled={isGitHubLoading}
            className="w-full py-3 px-4 bg-[#141414] hover:bg-[#1a1a1a] border border-[#333] rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isGitHubLoading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Github className="h-5 w-5" />
            )}
            Github
          </button>

          {/* Terms */}
          <p className="mt-6 text-center text-xs text-[#666]">
            By signing up, you agree to our{' '}
            <a href="#" className="text-white hover:underline">Terms</a>
            {' '}and{' '}
            <a href="#" className="text-white hover:underline">Privacy Policy</a>
          </p>

          {/* Sign In Link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-[#888]">
              Already have an account?{' '}
              <button
                onClick={onSwitchToLogin}
                className="text-white hover:text-[#14b8a6] font-medium underline underline-offset-2 transition-colors"
              >
                Sign In
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
