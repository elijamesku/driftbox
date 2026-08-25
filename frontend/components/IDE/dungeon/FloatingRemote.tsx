'use client'

import { useState, useRef, useEffect } from 'react'
import { Code, LayoutDashboard, Network, GitBranch, GitCompareArrows, Lock } from 'lucide-react'

interface FloatingRemoteProps {
  currentView: 'code' | 'dashboard' | 'diagram' | 'documentation' | 'drift'
  onViewChange: (view: 'code' | 'dashboard' | 'diagram' | 'documentation' | 'drift') => void
  isTeamWorkspace?: boolean
  onOpenGitHubActions?: () => void
}

export default function FloatingRemote({ currentView, onViewChange, isTeamWorkspace = false, onOpenGitHubActions }: FloatingRemoteProps) {
  // Center horizontally, position 2 inches lower (about 60% + 192px down the screen)
  const [position, setPosition] = useState({ 
    x: typeof window !== 'undefined' ? (window.innerWidth / 2) - 100 : 20, 
    y: typeof window !== 'undefined' ? (window.innerHeight * 0.6) + 192 : 100 
  })
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const remoteRef = useRef<HTMLDivElement>(null)

  // Initialize position on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPosition({
        x: (window.innerWidth / 2) - 100,
        y: (window.innerHeight * 0.6) + 192
      })
    }
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return
      
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'move'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragOffset])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!remoteRef.current) return
    
    const rect = remoteRef.current.getBoundingClientRect()
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    })
    setIsDragging(true)
  }

  return (
    <div
      ref={remoteRef}
      className="fixed z-[200] backdrop-blur-md bg-[#1a1a1a]/80 border border-[#3a3a3a] rounded-lg shadow-2xl"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        cursor: isDragging ? 'move' : 'grab'
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Drag handle area */}
      <div className="px-2 py-1.5 border-b border-[#3a3a3a] flex items-center justify-center">
        <div className="flex gap-0.5">
          <div className="w-0.5 h-0.5 rounded-full bg-[#6b7280]" />
          <div className="w-0.5 h-0.5 rounded-full bg-[#6b7280]" />
          <div className="w-0.5 h-0.5 rounded-full bg-[#6b7280]" />
        </div>
      </div>

      {/* Button container */}
      <div className="flex gap-1.5 p-1.5">
        {/* Code View Button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onViewChange('code')
          }}
          className={`p-2 rounded-md transition-all ${
            currentView === 'code'
              ? 'bg-[#1a1a1a] text-white'
              : 'bg-[#2a2a2a] text-[#9ca3af] hover:bg-[#333333] hover:text-white'
          }`}
          title="Code View"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Code size={16} />
        </button>

        {/* Dashboard View Button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onViewChange('dashboard')
          }}
          className={`p-2 rounded-md transition-all ${
            currentView === 'dashboard'
              ? 'bg-[#1a1a1a] text-white'
              : 'bg-[#2a2a2a] text-[#9ca3af] hover:bg-[#333333] hover:text-white'
          }`}
          title="Dashboard View"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <LayoutDashboard size={16} />
        </button>

        {/* Team Features - Only visible in team workspace */}
        {isTeamWorkspace ? (
          <>
            {/* Drift Detection Button */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onViewChange('drift')
              }}
              className={`p-2 rounded-md transition-all ${
                currentView === 'drift'
                  ? 'bg-[#1a1a1a] text-white'
                  : 'bg-[#2a2a2a] text-[#9ca3af] hover:bg-[#333333] hover:text-white'
              }`}
              title="Drift Detection"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <GitCompareArrows size={16} />
            </button>

            {/* Diagram View Button */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onViewChange('diagram')
              }}
              className={`p-2 rounded-md transition-all ${
                currentView === 'diagram'
                  ? 'bg-[#1a1a1a] text-white'
                  : 'bg-[#2a2a2a] text-[#9ca3af] hover:bg-[#333333] hover:text-white'
              }`}
              title="Architecture Diagram"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Network size={16} />
            </button>

            {/* GitHub Actions Button */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onOpenGitHubActions?.()
              }}
              className="p-2 rounded-md transition-all bg-gradient-to-r from-purple-500/20 to-blue-500/20 text-purple-300 hover:from-purple-500/30 hover:to-blue-500/30 hover:text-white border border-purple-500/30"
              title="Add GitHub Actions"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <GitBranch size={16} />
            </button>

          </>
        ) : (
          /* Locked indicator for non-team users */
          <div 
            className="p-2 rounded-md bg-[#2a2a2a] text-[#6b7280] cursor-not-allowed opacity-50"
            title="Join a team workspace to unlock Drift, Diagrams & Docs"
          >
            <Lock size={16} />
          </div>
        )}
      </div>
    </div>
  )
}

