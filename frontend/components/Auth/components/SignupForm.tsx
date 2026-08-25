import React, { useState } from 'react'
import { UserPlus } from 'lucide-react'
import FormInput from './FormInput'
import PasswordInput from './PasswordInput'

interface SignupFormProps {
  onSubmit: (data: {
    email: string
    password: string
    confirmPassword: string
    fullName: string
    company: string
  }) => Promise<void>
  isLoading: boolean
}

export default function SignupForm({ onSubmit, isLoading }: SignupFormProps) {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    fullName: '',
    company: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormInput
        label="Full Name"
        type="text"
        value={formData.fullName}
        onChange={(value) => setFormData({ ...formData, fullName: value })}
        placeholder="Jane Doe"
        required
      />

      <FormInput
        label="Email"
        type="email"
        value={formData.email}
        onChange={(value) => setFormData({ ...formData, email: value })}
        placeholder="you@example.com"
        required
      />

      <FormInput
        label="Company (optional)"
        type="text"
        value={formData.company}
        onChange={(value) => setFormData({ ...formData, company: value })}
        placeholder="Acme Inc."
      />

      <PasswordInput
        label="Password"
        value={formData.password}
        onChange={(value) => setFormData({ ...formData, password: value })}
        hint="Must be at least 8 characters"
        required
      />

      <PasswordInput
        label="Confirm Password"
        value={formData.confirmPassword}
        onChange={(value) => setFormData({ ...formData, confirmPassword: value })}
        required
      />

      <button
        type="submit"
        disabled={isLoading}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-[var(--cursor-accent)] to-[var(--cursor-blue)] hover:opacity-90 text-white rounded-lg text-[15px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-[var(--cursor-accent)]/25"
      >
        {isLoading ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Creating your account...
          </>
        ) : (
          <>
            <UserPlus size={18} />
            Create account
          </>
        )}
      </button>
    </form>
  )
}

