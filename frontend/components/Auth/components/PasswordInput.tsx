import React, { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface PasswordInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  hint?: string
}

export default function PasswordInput({
  label,
  value,
  onChange,
  placeholder = '••••••••',
  required = false,
  hint
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--cursor-text)] mb-2">
        {label}
      </label>
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-4 py-3 pr-12 bg-[var(--cursor-bg-lighter)] border border-[var(--cursor-border)] rounded-lg text-[14px] focus:border-[var(--cursor-accent)] focus:ring-2 focus:ring-[var(--cursor-accent)] focus:ring-opacity-20 outline-none transition-all"
          required={required}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-2 hover:bg-[var(--cursor-hover)] rounded-lg transition-colors"
        >
          {showPassword ? (
            <EyeOff size={16} className="text-[var(--cursor-text-dim)]" />
          ) : (
            <Eye size={16} className="text-[var(--cursor-text-dim)]" />
          )}
        </button>
      </div>
      {hint && (
        <p className="mt-1 text-[11px] text-[var(--cursor-text-dim)]">
          {hint}
        </p>
      )}
    </div>
  )
}

