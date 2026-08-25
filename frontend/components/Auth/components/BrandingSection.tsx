import { ReactNode } from 'react'
import AuthLogo from './AuthLogo'

interface BrandingSectionProps {
  headline: ReactNode
  description: string
  features: ReactNode
  mounted: boolean
}

export default function BrandingSection({ headline, description, features, mounted }: BrandingSectionProps) {
  return (
    <div className="hidden lg:flex lg:flex-1 items-center justify-center p-12 relative z-10">
      <div className={`max-w-lg transition-all duration-1000 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
        {/* Animated Logo */}
        <div className="flex items-center gap-4 mb-8">
          <AuthLogo size="lg" showGlow />
          <div>
            <h2 className="text-[28px] font-bold text-[var(--cursor-text-bright)]">
              Infrastructure Copilot
            </h2>
            <p className="text-[14px] text-[var(--cursor-text-dim)]">
              AI-powered DevOps magic
            </p>
          </div>
        </div>

        <h1 className="text-[42px] font-bold text-[var(--cursor-text-bright)] leading-tight mb-6">
          {headline}
        </h1>
        
        <p className="text-[18px] text-[var(--cursor-text-dim)] leading-relaxed mb-12">
          {description}
        </p>

        {features}
      </div>
    </div>
  )
}

