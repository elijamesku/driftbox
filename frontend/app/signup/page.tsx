'use client'

import { useRouter } from 'next/navigation'
import Signup from '@/components/Auth/pages/Signup'

export default function SignupPage() {
  const router = useRouter()

  const handleSignup = (token: string) => {
    // Navigate to the IDE after successful signup
    router.push('/ide')
  }

  const handleSwitchToLogin = () => {
    // Navigate back to login page
    router.push('/')
  }

  return (
    <Signup 
      onSignup={handleSignup}
      onSwitchToLogin={handleSwitchToLogin}
    />
  )
}

