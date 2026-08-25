'use client'

/**
 * Risk Assessment Badge Component
 * Displays risk level with color-coded badge and expandable details
 */

import { useState } from 'react'
import { 
  Shield, 
  ShieldAlert, 
  ShieldCheck, 
  ShieldX,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle,
  Info,
  Zap
} from 'lucide-react'

interface RiskFactor {
  name: string
  weight: number
  triggered: boolean
  reason: string
  category: string
}

interface RiskAssessment {
  risk_score: number
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  risk_color: string
  factors: RiskFactor[]
  auto_approve: boolean
  requires_approval_from: string | null
  approval_reason: string
  recommendations: string[]
  environment: string
  assessed_at: string
}

interface RiskBadgeProps {
  assessment: RiskAssessment | null
  size?: 'sm' | 'md' | 'lg'
  showDetails?: boolean
  onRecalculate?: () => void
}

export default function RiskBadge({ 
  assessment, 
  size = 'md',
  showDetails = true,
  onRecalculate 
}: RiskBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (!assessment) {
    return (
      <div className="flex items-center gap-2 text-[#666666]">
        <Shield className="h-4 w-4" />
        <span className="text-xs">Risk not assessed</span>
      </div>
    )
  }

  const { risk_score, risk_level, risk_color, auto_approve, factors, recommendations, approval_reason } = assessment

  // Size classes
  const sizeClasses = {
    sm: { badge: 'px-2 py-0.5 text-xs', icon: 'h-3 w-3', score: 'text-xs' },
    md: { badge: 'px-3 py-1 text-sm', icon: 'h-4 w-4', score: 'text-sm' },
    lg: { badge: 'px-4 py-1.5 text-base', icon: 'h-5 w-5', score: 'text-base' },
  }
  const classes = sizeClasses[size]

  // Icon based on risk level
  const RiskIcon = {
    low: ShieldCheck,
    medium: Shield,
    high: ShieldAlert,
    critical: ShieldX,
  }[risk_level]

  return (
    <div className="space-y-2">
      {/* Main Badge */}
      <div 
        className={`inline-flex items-center gap-2 rounded-lg cursor-pointer transition-all hover:opacity-80 ${classes.badge}`}
        style={{ 
          backgroundColor: `${risk_color}15`,
          border: `1px solid ${risk_color}40`,
        }}
        onClick={() => showDetails && setIsExpanded(!isExpanded)}
      >
        <RiskIcon className={classes.icon} style={{ color: risk_color }} />
        <span className="font-medium" style={{ color: risk_color }}>
          {risk_level.toUpperCase()}
        </span>
        <span className={`${classes.score} opacity-70`} style={{ color: risk_color }}>
          ({risk_score})
        </span>
        
        {auto_approve && (
          <span className="flex items-center gap-1 text-[#22c55e]">
            <Zap className="h-3 w-3" />
            <span className="text-xs">Auto</span>
          </span>
        )}

        {showDetails && (
          isExpanded 
            ? <ChevronUp className="h-3 w-3 ml-1" style={{ color: risk_color }} />
            : <ChevronDown className="h-3 w-3 ml-1" style={{ color: risk_color }} />
        )}
      </div>

      {/* Expanded Details */}
      {showDetails && isExpanded && (
        <div className="rounded-lg bg-[#0f0f0f] border border-[#1f1f1f] p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Approval Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {auto_approve ? (
                <>
                  <CheckCircle className="h-4 w-4 text-[#22c55e]" />
                  <span className="text-sm text-[#22c55e]">Eligible for auto-approval</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-[#f97316]" />
                  <span className="text-sm text-[#f97316]">
                    {assessment.requires_approval_from 
                      ? `Requires ${assessment.requires_approval_from.replace('_', ' ')} approval`
                      : 'Manual approval required'}
                  </span>
                </>
              )}
            </div>
            {onRecalculate && (
              <button
                onClick={(e) => { e.stopPropagation(); onRecalculate(); }}
                className="text-xs text-[#666666] hover:text-[#14b8a6] transition-colors"
              >
                Recalculate
              </button>
            )}
          </div>

          {/* Risk Factors */}
          {factors.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-[#666666] mb-2 uppercase tracking-wide">
                Risk Factors
              </h4>
              <div className="space-y-1.5">
                {factors.map((factor, idx) => (
                  <div 
                    key={idx}
                    className="flex items-start gap-2 text-sm"
                  >
                    <div 
                      className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                      style={{ 
                        backgroundColor: factor.weight >= 8 ? '#ef4444' : 
                                        factor.weight >= 5 ? '#f97316' : '#eab308'
                      }}
                    />
                    <span className="text-[#999999]">{factor.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-[#666666] mb-2 uppercase tracking-wide">
                Recommendations
              </h4>
              <div className="space-y-1.5">
                {recommendations.map((rec, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    <Info className="h-3.5 w-3.5 text-[#14b8a6] mt-0.5 flex-shrink-0" />
                    <span className="text-[#999999]">{rec}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Environment & Timestamp */}
          <div className="flex items-center justify-between text-xs text-[#666666] pt-2 border-t border-[#1f1f1f]">
            <span>Environment: <span className="text-[#fafafa]">{assessment.environment}</span></span>
            <span>Assessed: {new Date(assessment.assessed_at).toLocaleTimeString()}</span>
          </div>
        </div>
      )}
    </div>
  )
}


/**
 * Compact inline risk indicator for lists
 */
export function RiskIndicator({ 
  level, 
  score 
}: { 
  level: 'low' | 'medium' | 'high' | 'critical'
  score: number 
}) {
  const colors = {
    low: '#22c55e',
    medium: '#eab308',
    high: '#f97316',
    critical: '#ef4444',
  }
  const color = colors[level]

  return (
    <span 
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
      style={{ 
        backgroundColor: `${color}15`,
        color: color,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {score}
    </span>
  )
}

