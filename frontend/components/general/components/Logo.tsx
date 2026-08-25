'use client'

import { motion } from 'framer-motion'

const sizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-16 h-16',
}

export default function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={`${sizeClasses[size]} relative`}>
      <img
        src="/logo-svgs/driftbox_logo_mark_color_v1.svg"
        alt="Logo"
        className="w-full h-full object-contain"
      />
    </div>
  )
}

export function LogoWithText({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <motion.div
      className="flex items-center gap-2.5"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <img
        src="/logo-svgs/driftbox_full_mark_knockout_v1.svg"
        alt="Logo"
        className={`${sizeClasses[size]} object-contain object-left`}
      />
    </motion.div>
  )
}

