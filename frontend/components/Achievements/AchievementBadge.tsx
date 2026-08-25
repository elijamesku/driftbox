'use client'

/**
 * Achievement Badge Component
 * Displays individual achievement medals/badges
 */

import { Trophy, Star, Zap, Shield, DollarSign, Award } from 'lucide-react'

interface AchievementBadgeProps {
  achievement: {
    type: string
    tier: string
    name: string
    icon: string
    description: string
    earned_at: string
    value: number
  }
  size?: 'small' | 'medium' | 'large'
  showDetails?: boolean
}

export default function AchievementBadge({ 
  achievement, 
  size = 'medium',
  showDetails = true 
}: AchievementBadgeProps) {
  
  // Tier colors
  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'bronze': return 'from-amber-700 to-amber-900'
      case 'silver': return 'from-gray-400 to-gray-600'
      case 'gold': return 'from-yellow-400 to-yellow-600'
      case 'platinum': return 'from-cyan-400 to-cyan-600'
      case 'diamond': return 'from-purple-400 to-pink-500'
      default: return 'from-gray-500 to-gray-700'
    }
  }

  const getTierBorder = (tier: string) => {
    switch (tier) {
      case 'bronze': return 'border-amber-500'
      case 'silver': return 'border-gray-400'
      case 'gold': return 'border-yellow-400'
      case 'platinum': return 'border-cyan-400'
      case 'diamond': return 'border-purple-400'
      default: return 'border-gray-500'
    }
  }

  const getSizeClasses = () => {
    switch (size) {
      case 'small':
        return {
          container: 'w-12 h-12',
          icon: 'text-2xl',
          badge: 'text-xs px-1'
        }
      case 'large':
        return {
          container: 'w-24 h-24',
          icon: 'text-5xl',
          badge: 'text-sm px-2'
        }
      default:
        return {
          container: 'w-16 h-16',
          icon: 'text-3xl',
          badge: 'text-xs px-1.5'
        }
    }
  }

  const sizeClasses = getSizeClasses()

  return (
    <div className="relative group">
      {/* Badge */}
      <div
        className={`${sizeClasses.container} rounded-full bg-gradient-to-br ${getTierColor(achievement.tier)} ${getTierBorder(achievement.tier)} border-2 flex items-center justify-center shadow-lg hover:scale-110 transition-transform cursor-pointer`}
      >
        <span className={sizeClasses.icon}>{achievement.icon}</span>
      </div>

      {/* Tier Label */}
      <div className={`absolute -bottom-2 left-1/2 transform -translate-x-1/2 ${sizeClasses.badge} py-0.5 rounded-full bg-[#1e1e1e] border ${getTierBorder(achievement.tier)} text-white font-semibold uppercase`}>
        {achievement.tier}
      </div>

      {/* Tooltip on Hover */}
      {showDetails && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 bg-[#1e1e1e] border border-[#3a3a3a] rounded-lg p-3 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
          <div className="flex items-start gap-2 mb-2">
            <span className="text-2xl">{achievement.icon}</span>
            <div className="flex-1">
              <div className="text-sm font-bold text-white">{achievement.name}</div>
              <div className="text-xs text-gray-400 uppercase">{achievement.tier}</div>
            </div>
          </div>
          
          <div className="text-xs text-gray-300 mb-2">
            {achievement.description}
          </div>
          
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">
              {new Date(achievement.earned_at).toLocaleDateString()}
            </span>
            {achievement.value > 0 && (
              <span className="text-purple-400 font-semibold">
                {achievement.value.toLocaleString()} pts
              </span>
            )}
          </div>

          {/* Arrow */}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-[#3a3a3a]"></div>
        </div>
      )}
    </div>
  )
}

