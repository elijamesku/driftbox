interface AuthLogoProps {
  size?: 'sm' | 'md' | 'lg'
  showGlow?: boolean
}

export default function AuthLogo({ size = 'md', showGlow = false }: AuthLogoProps) {
  const sizeClasses = {
    sm: 'w-12 h-12 rounded-xl text-[20px]',
    md: 'w-16 h-16 rounded-2xl text-[28px]',
    lg: 'w-20 h-20 rounded-3xl text-[36px]'
  }

  return (
    <div className="relative">
      {showGlow && (
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--cursor-accent)] to-[var(--cursor-blue)] rounded-3xl blur-xl opacity-50 animate-pulse" />
      )}
      <img
        src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg"
        alt="Logo"
        className={`relative ${sizeClasses[size]} object-contain`}
      />
    </div>
  )
}

