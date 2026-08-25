import { ReactNode } from 'react'
import AuthLogo from './AuthLogo'

interface AuthCardProps {
  title: string
  subtitle: string
  children: ReactNode
}

export default function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <div className="bg-[var(--cursor-bg-darker)] border border-[var(--cursor-border)] rounded-2xl p-8 shadow-2xl backdrop-blur-xl">
      {/* Mobile Logo */}
      <div className="flex lg:hidden justify-center mb-8">
        <AuthLogo size="md" showGlow />
      </div>

      {/* Title */}
      <div className="text-center mb-8">
        <h1 className="text-[28px] font-bold text-[var(--cursor-text-bright)] mb-2">
          {title}
        </h1>
        <p className="text-[15px] text-[var(--cursor-text-dim)]">
          {subtitle}
        </p>
      </div>

      {children}
    </div>
  )
}

