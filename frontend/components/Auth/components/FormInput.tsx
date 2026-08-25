import React from 'react'

interface FormInputProps {
  label: string
  type?: 'text' | 'email' | 'password'
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  hint?: string
}

export default function FormInput({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  required = false,
  hint
}: FormInputProps) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--cursor-text)] mb-2">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 bg-[var(--cursor-bg-lighter)] border border-[var(--cursor-border)] rounded-lg text-[14px] focus:border-[var(--cursor-accent)] focus:ring-2 focus:ring-[var(--cursor-accent)] focus:ring-opacity-20 outline-none transition-all"
        required={required}
      />
      {hint && (
        <p className="mt-1 text-[11px] text-[var(--cursor-text-dim)]">
          {hint}
        </p>
      )}
    </div>
  )
}

