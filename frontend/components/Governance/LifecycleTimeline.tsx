'use client'

/**
 * Lifecycle Timeline Component
 * Shows the complete governance journey of an infrastructure change
 */

import { useState } from 'react'
import { 
  FileText,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Play,
  CheckCheck,
  AlertOctagon,
  RefreshCw,
  Clock,
  User,
  ChevronDown,
  ChevronRight,
  ExternalLink
} from 'lucide-react'

interface LifecycleEvent {
  id: string
  event_type: string
  timestamp: string
  user_id?: string
  summary: string
  details: Record<string, any>
  sequence?: number
  duration_from_start?: string
}

interface LifecycleSummary {
  change_id: string
  current_status: string
  total_events: number
  started_at: string
  last_event_at: string
  duration: string
  compliance_status: string
  has_policy_check: boolean
  has_risk_assessment: boolean
  has_approval: boolean
  has_validation: boolean
}

interface LifecycleTimelineProps {
  changeId: string
  timeline: LifecycleEvent[]
  summary?: LifecycleSummary
  loading?: boolean
  compact?: boolean
}

// Event type configuration
const EVENT_CONFIG: Record<string, { 
  icon: typeof FileText
  color: string
  label: string 
}> = {
  change_proposed: { icon: FileText, color: '#3b82f6', label: 'Change Proposed' },
  policy_checked: { icon: Shield, color: '#8b5cf6', label: 'Policy Check' },
  risk_assessed: { icon: AlertTriangle, color: '#f97316', label: 'Risk Assessed' },
  approval_requested: { icon: Clock, color: '#eab308', label: 'Approval Requested' },
  change_approved: { icon: CheckCircle, color: '#22c55e', label: 'Approved' },
  change_rejected: { icon: XCircle, color: '#ef4444', label: 'Rejected' },
  apply_started: { icon: Play, color: '#14b8a6', label: 'Apply Started' },
  apply_completed: { icon: CheckCheck, color: '#22c55e', label: 'Apply Completed' },
  apply_failed: { icon: AlertOctagon, color: '#ef4444', label: 'Apply Failed' },
  validation_passed: { icon: CheckCheck, color: '#22c55e', label: 'Validation Passed' },
  validation_failed: { icon: AlertOctagon, color: '#ef4444', label: 'Validation Failed' },
  drift_detected: { icon: RefreshCw, color: '#f97316', label: 'Drift Detected' },
  drift_resolved: { icon: CheckCircle, color: '#22c55e', label: 'Drift Resolved' },
}

const STATUS_COLORS: Record<string, string> = {
  pending_review: '#3b82f6',
  pending_approval: '#eab308',
  awaiting_approval: '#f97316',
  approved: '#22c55e',
  rejected: '#ef4444',
  deploying: '#14b8a6',
  deployed: '#22c55e',
  failed: '#ef4444',
  validated: '#22c55e',
  validation_failed: '#ef4444',
  drifted: '#f97316',
  synchronized: '#22c55e',
}

export default function LifecycleTimeline({ 
  changeId,
  timeline, 
  summary,
  loading = false,
  compact = false 
}: LifecycleTimelineProps) {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())

  const toggleEvent = (eventId: string) => {
    setExpandedEvents(prev => {
      const next = new Set(prev)
      if (next.has(eventId)) {
        next.delete(eventId)
      } else {
        next.add(eventId)
      }
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="h-5 w-5 text-[#14b8a6] animate-spin" />
        <span className="ml-2 text-sm text-[#666666]">Loading timeline...</span>
      </div>
    )
  }

  if (timeline.length === 0) {
    return (
      <div className="text-center py-8 text-[#666666]">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No lifecycle events recorded yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary Header */}
      {summary && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-[#0f0f0f] border border-[#1f1f1f]">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-xs text-[#666666] uppercase tracking-wide">Status</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span 
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS[summary.current_status] || '#666666' }}
                />
                <span className="text-sm font-medium text-[#fafafa] capitalize">
                  {summary.current_status.replace(/_/g, ' ')}
                </span>
              </div>
            </div>
            <div className="h-8 w-px bg-[#1f1f1f]" />
            <div>
              <span className="text-xs text-[#666666] uppercase tracking-wide">Compliance</span>
              <div className="flex items-center gap-2 mt-0.5">
                {summary.compliance_status === 'compliant' ? (
                  <CheckCircle className="h-4 w-4 text-[#22c55e]" />
                ) : summary.compliance_status === 'failed' ? (
                  <XCircle className="h-4 w-4 text-[#ef4444]" />
                ) : (
                  <Clock className="h-4 w-4 text-[#eab308]" />
                )}
                <span className="text-sm text-[#fafafa] capitalize">
                  {summary.compliance_status}
                </span>
              </div>
            </div>
            <div className="h-8 w-px bg-[#1f1f1f]" />
            <div>
              <span className="text-xs text-[#666666] uppercase tracking-wide">Duration</span>
              <p className="text-sm text-[#fafafa] mt-0.5">{summary.duration}</p>
            </div>
          </div>

          {/* Governance Checkmarks */}
          <div className="flex items-center gap-3">
            <GovernanceCheck label="Policy" checked={summary.has_policy_check} />
            <GovernanceCheck label="Risk" checked={summary.has_risk_assessment} />
            <GovernanceCheck label="Approval" checked={summary.has_approval} />
            <GovernanceCheck label="Validation" checked={summary.has_validation} />
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-[#1f1f1f]" />

        {/* Events */}
        <div className="space-y-1">
          {timeline.map((event, index) => {
            const config = EVENT_CONFIG[event.event_type] || {
              icon: FileText,
              color: '#666666',
              label: event.event_type,
            }
            const Icon = config.icon
            const isExpanded = expandedEvents.has(event.id)
            const hasDetails = Object.keys(event.details).length > 0

            return (
              <div key={event.id} className="relative pl-10">
                {/* Icon */}
                <div 
                  className="absolute left-0 w-8 h-8 rounded-full flex items-center justify-center border-2 bg-[#0a0a0a]"
                  style={{ borderColor: config.color }}
                >
                  <Icon className="h-4 w-4" style={{ color: config.color }} />
                </div>

                {/* Event Card */}
                <div 
                  className={`rounded-lg border border-[#1f1f1f] transition-colors ${
                    hasDetails ? 'cursor-pointer hover:border-[#2f2f2f]' : ''
                  } ${compact ? 'p-2' : 'p-3'}`}
                  onClick={() => hasDetails && toggleEvent(event.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#fafafa]">
                          {config.label}
                        </span>
                        {event.sequence && (
                          <span className="text-xs text-[#666666]">
                            #{event.sequence}
                          </span>
                        )}
                        {hasDetails && (
                          isExpanded 
                            ? <ChevronDown className="h-3 w-3 text-[#666666]" />
                            : <ChevronRight className="h-3 w-3 text-[#666666]" />
                        )}
                      </div>
                      <p className="text-sm text-[#999999] mt-0.5">
                        {event.summary}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-[#666666] ml-4 flex-shrink-0">
                      {event.user_id && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {event.user_id.substring(0, 8)}
                        </span>
                      )}
                      <span>{formatTime(event.timestamp)}</span>
                      {event.duration_from_start && (
                        <span className="text-[#14b8a6]">+{event.duration_from_start}</span>
                      )}
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && hasDetails && (
                    <div className="mt-3 pt-3 border-t border-[#1f1f1f]">
                      <pre className="text-xs text-[#999999] overflow-x-auto">
                        {JSON.stringify(event.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}


function GovernanceCheck({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {checked ? (
        <CheckCircle className="h-4 w-4 text-[#22c55e]" />
      ) : (
        <div className="w-4 h-4 rounded-full border border-[#666666]" />
      )}
      <span className={`text-xs ${checked ? 'text-[#fafafa]' : 'text-[#666666]'}`}>
        {label}
      </span>
    </div>
  )
}


function formatTime(timestamp: string): string {
  try {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return timestamp
  }
}


/**
 * Compact timeline for embedding in other views
 */
export function CompactTimeline({ events }: { events: LifecycleEvent[] }) {
  return (
    <div className="flex items-center gap-1">
      {events.slice(0, 6).map((event, idx) => {
        const config = EVENT_CONFIG[event.event_type] || { color: '#666666' }
        return (
          <div
            key={event.id}
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: config.color }}
            title={`${event.event_type}: ${event.summary}`}
          />
        )
      })}
      {events.length > 6 && (
        <span className="text-xs text-[#666666]">+{events.length - 6}</span>
      )}
    </div>
  )
}

