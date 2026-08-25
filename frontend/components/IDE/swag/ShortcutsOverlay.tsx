'use client'

import { useEffect, useState } from 'react'

interface ShortcutsOverlayProps {
  isOpen: boolean
  onClose: () => void
}

const shortcuts = [
  {
    category: 'General',
    items: [
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['⌘', 'P'], description: 'Search files' },
      { keys: ['⌘', 'B'], description: 'Toggle sidebar' },
      { keys: ['⌘', 'J'], description: 'Toggle terminal' },
      { keys: ['Esc'], description: 'Close panel / Cancel' },
    ]
  },
  {
    category: 'Editor',
    items: [
      { keys: ['⌘', 'S'], description: 'Save file' },
      { keys: ['⌘', 'Z'], description: 'Undo' },
      { keys: ['⌘', '⇧', 'Z'], description: 'Redo' },
      { keys: ['⌘', 'F'], description: 'Find in file' },
      { keys: ['⌘', '/'], description: 'Toggle comment' },
    ]
  },
  {
    category: 'Collaboration',
    items: [
      { keys: ['⌘', '⇧', 'S'], description: 'Stage changes' },
      { keys: ['⌘', '⇧', 'P'], description: 'Create pull request' },
      { keys: ['⌘', 'K'], description: 'Quick search (Teams)' },
    ]
  },
  {
    category: 'AI Assistant',
    items: [
      { keys: ['⌘', '⇧', 'L'], description: 'Toggle Agent mode' },
      { keys: ['⌘', '↵'], description: 'Keep all changes' },
      { keys: ['⌘', '⇧', '⌫'], description: 'Undo all changes' },
    ]
  },
  {
    category: 'DevOps (Right-click)',
    items: [
      { keys: ['⌘', 'D'], description: 'Show resource definition' },
      { keys: ['Right-click'], description: 'Estimate cost' },
      { keys: ['Right-click'], description: 'Security check' },
      { keys: ['Right-click'], description: 'Find dependencies' },
    ]
  }
]

export default function ShortcutsOverlay({ isOpen, onClose }: ShortcutsOverlayProps) {
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    // Detect OS
    setIsMac(navigator.platform.toLowerCase().includes('mac'))
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  // Replace ⌘ with Ctrl for non-Mac
  const formatKey = (key: string) => {
    if (!isMac) {
      if (key === '⌘') return 'Ctrl'
      if (key === '⌥') return 'Alt'
    }
    return key
  }

  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div 
        className="bg-[#0a0a0a] border border-[#333] rounded-xl shadow-2xl w-[700px] max-h-[80vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#333]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
              <span className="text-white text-lg">⌨</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Keyboard Shortcuts</h2>
              <p className="text-xs text-gray-500">Press any shortcut to use it</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors p-2 hover:bg-[#1a1a1a] rounded-lg"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Shortcuts Grid */}
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)]">
          <div className="grid grid-cols-2 gap-6">
            {shortcuts.map((section) => (
              <div key={section.category} className="space-y-3">
                <h3 className="text-sm font-medium text-purple-400 uppercase tracking-wider">
                  {section.category}
                </h3>
                <div className="space-y-2">
                  {section.items.map((shortcut, idx) => (
                    <div 
                      key={idx}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[#1a1a1a] transition-colors group"
                    >
                      <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                        {shortcut.description}
                      </span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIdx) => (
                          <kbd 
                            key={keyIdx}
                            className="min-w-[28px] h-7 px-2 flex items-center justify-center bg-[#1e1e1e] border border-[#3e3e42] rounded-md text-xs font-mono text-gray-300 shadow-sm"
                          >
                            {formatKey(key)}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#333] bg-[#0d0d0d]">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Press <kbd className="px-1.5 py-0.5 bg-[#1e1e1e] border border-[#3e3e42] rounded text-[10px]">?</kbd> to toggle this overlay</span>
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
              Driftbox
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

