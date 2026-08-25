'use client'

import { useAuth } from '@/contexts/AuthContext'
import { X, LogOut, Github, User, Hash } from 'lucide-react'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { user, logout } = useAuth()

  if (!isOpen) return null

  const handleSignOut = () => {
    // Call logout which will only clear auth data (cache is preserved)
    logout()
  }

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/70 z-50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md px-4">
        <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-white/5">
            <h2 className="text-[15px] font-semibold text-white/90">Settings</h2>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-white/10 rounded-lg transition-all duration-200 text-white/50 hover:text-white/80"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="p-5 space-y-5">
            {/* User Info Section */}
            <div>
              <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-wider mb-3">
                Account Information
              </h3>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
                {/* Email */}
                {user?.email && (
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-white/5 rounded-lg">
                      <User size={14} className="text-white/40" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-white/30 uppercase tracking-wide mb-0.5">Email</div>
                      <div className="text-[13px] text-white/80 font-medium truncate">{user.email}</div>
                    </div>
                  </div>
                )}
                
                {/* User ID */}
                {user?.id && (
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-white/5 rounded-lg">
                      <Hash size={14} className="text-white/40" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-white/30 uppercase tracking-wide mb-0.5">User ID</div>
                      <div className="text-[11px] text-white/40 font-mono truncate">{user.id}</div>
                    </div>
                  </div>
                )}
                
                {/* GitHub Token Status */}
                {user?.github_access_token && (
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-white/5 rounded-lg">
                      <Github size={14} className="text-white/40" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-white/30 uppercase tracking-wide mb-0.5">GitHub Connection</div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                        <span className="text-[13px] text-emerald-400 font-medium">Connected</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Actions Section */}
            <div>
              <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-wider mb-3">
                Actions
              </h3>
              <button
                onClick={handleSignOut}
                className="w-full px-4 py-3 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 hover:border-red-500/50 text-red-400 rounded-xl transition-all duration-200 text-[13px] font-medium flex items-center justify-center gap-2"
              >
                <LogOut size={15} />
                Sign Out
              </button>
              <p className="text-[11px] text-white/30 mt-2.5 text-center">
                This will sign you out. Thanks for using Driftbox!
              </p>
            </div>

            {/* Version Info */}
            <div className="pt-4 border-t border-white/5">
              <div className="flex items-center justify-between text-[11px] text-white/30">
                <span>Driftbox IDE</span>
                <span className="px-2 py-0.5 bg-white/5 rounded-md">v0.1.0 Founders Build</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
