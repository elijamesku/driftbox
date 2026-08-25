'use client'

/**
 * Dependency Notification Panel
 * Shows notifications when resources you're working on are affected by changes
 */

import { useState } from 'react'
import { AlertTriangle, X, ChevronDown, ChevronUp, FileCode, GitBranch, ExternalLink } from 'lucide-react'
import type { DependencyNotification } from '@/hooks/useTeamCollaboration'

interface DependencyNotificationPanelProps {
  notifications: DependencyNotification[]
  onDismiss: (index: number) => void
  onNavigateToFile?: (file: string) => void
}

export default function DependencyNotificationPanel({
  notifications,
  onDismiss,
  onNavigateToFile
}: DependencyNotificationPanelProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  if (notifications.length === 0) return null

  return (
    <div className="fixed top-20 right-6 z-50 w-96 max-h-[60vh] overflow-y-auto space-y-2">
      {notifications.map((notification, index) => (
        <div
          key={`${notification.changed_resource}-${notification.timestamp}`}
          className="bg-[#1e1e1e] border border-yellow-500/30 rounded-lg shadow-2xl overflow-hidden animate-slide-in"
        >
          {/* Header */}
          <div className="px-4 py-3 bg-yellow-500/10 border-b border-yellow-500/20 flex items-start justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-yellow-300">
                  Dependency Changed
                </div>
                <div className="text-xs text-yellow-200/80 mt-0.5">
                  {notification.changed_by} {notification.change_type} a resource
                </div>
              </div>
            </div>
            <button
              onClick={() => onDismiss(index)}
              className="p-1 hover:bg-yellow-500/20 rounded transition-colors"
            >
              <X size={14} className="text-yellow-400" />
            </button>
          </div>

          {/* Changed Resource */}
          <div className="px-4 py-3 border-b border-[#3a3a3a]">
            <div className="text-xs text-gray-400 mb-1">Changed Resource</div>
            <div className="flex items-center gap-2">
              <GitBranch size={14} className="text-purple-400" />
              <code className="text-sm text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded">
                {notification.changed_resource}
              </code>
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                notification.change_type === 'deleted' 
                  ? 'bg-red-500/20 text-red-400'
                  : notification.change_type === 'created'
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-blue-500/20 text-blue-400'
              }`}>
                {notification.change_type}
              </span>
            </div>
          </div>

          {/* Affected Resources */}
          <div className="px-4 py-3">
            <button
              onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
              className="w-full flex items-center justify-between text-xs text-gray-400 hover:text-gray-300 transition-colors"
            >
              <span>
                {notification.affected_resources.length} dependent resource{notification.affected_resources.length !== 1 ? 's' : ''} affected
              </span>
              {expandedIndex === index ? (
                <ChevronUp size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
            </button>

            {expandedIndex === index && (
              <div className="mt-3 space-y-2">
                {notification.affected_resources.map((affected, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2 bg-[#252525] rounded hover:bg-[#2a2a2a] transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileCode size={14} className="text-gray-500 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs text-white truncate">
                          {affected.resource}
                        </div>
                        <div className="text-[10px] text-gray-500 truncate">
                          {affected.file}
                        </div>
                      </div>
                    </div>
                    {onNavigateToFile && (
                      <button
                        onClick={() => onNavigateToFile(affected.file)}
                        className="p-1 hover:bg-[#3a3a3a] rounded transition-colors"
                        title="Open file"
                      >
                        <ExternalLink size={12} className="text-gray-400" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Timestamp */}
          <div className="px-4 py-2 bg-[#151515] text-[10px] text-gray-500">
            {new Date(notification.timestamp).toLocaleTimeString()}
          </div>
        </div>
      ))}

      <style jsx>{`
        @keyframes slide-in {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </div>
  )
}

// Compact inline notification for editor
export function DependencyWarningBadge({ 
  affectedCount,
  onClick 
}: { 
  affectedCount: number
  onClick?: () => void 
}) {
  if (affectedCount === 0) return null

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 text-xs bg-yellow-500/20 text-yellow-400 rounded hover:bg-yellow-500/30 transition-colors"
      title={`${affectedCount} dependent resources may need updates`}
    >
      <AlertTriangle size={12} />
      <span>{affectedCount} dependencies</span>
    </button>
  )
}

