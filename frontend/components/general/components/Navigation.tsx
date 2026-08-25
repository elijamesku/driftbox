'use client'

import { motion } from 'framer-motion'
import LogoWithText from './Logo'

export default function Navigation() {
  return (
    <motion.nav
      className="fixed top-0 left-0 right-0 z-50 px-6 sm:px-8 lg:px-12 py-3 bg-[#0a0a0a] border-b border-[#0d0d0d]"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <LogoWithText size="sm" />
      </div>
    </motion.nav>
  )
}

