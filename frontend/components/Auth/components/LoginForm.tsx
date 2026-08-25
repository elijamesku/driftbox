import React, { useState } from 'react'
import { LogIn } from 'lucide-react'
import FormInput from './FormInput'
import PasswordInput from './PasswordInput'

interface LoginFormProps {
  onSubmit: (email: string, password: string) => Promise<void>
  isLoading: boolean
}

export default function LoginForm({ onSubmit, isLoading }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit(email, password)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormInput
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="you@example.com"
        required
      />

      <PasswordInput
        label="Password"
        value={password}
        onChange={setPassword}
        required
      />

      <div className="flex items-center justify-between text-[13px]">
        <label className="flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            className="w-4 h-4 rounded border-[var(--cursor-border)] bg-[var(--cursor-bg-lighter)] checked:bg-[var(--cursor-accent)] transition-colors"
          />
          <span className="text-[var(--cursor-text)] group-hover:text-[var(--cursor-text-bright)] transition-colors">Remember me</span>
        </label>
        <a href="#" className="text-[var(--cursor-accent)] hover:underline font-medium">
          Forgot password?
        </a>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-[var(--cursor-accent)] to-[var(--cursor-blue)] hover:opacity-90 text-white rounded-lg text-[15px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-[var(--cursor-accent)]/25"
      >
        {isLoading ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Signing in...
          </>
        ) : (
          <>
            <LogIn size={18} />
            Sign in
          </>
        )}
      </button>
    </form>
  )
}

