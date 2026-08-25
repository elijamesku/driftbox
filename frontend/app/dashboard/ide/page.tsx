'use client'

import dynamic from 'next/dynamic'

// Dynamically import IDELayout to avoid SSR issues with Monaco
const IDELayout = dynamic(
  () => import('@/components/IDE/IDELayout'),
  { 
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-[#0a0a0a]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1f1f1f] border-t-[#14b8a6]" />
          <p className="text-sm text-[#666666]">Loading IDE...</p>
        </div>
      </div>
    )
  }
)

export default function IDEPage() {
  return (
    <div className="h-full w-full">
      <IDELayout />
    </div>
  )
}

