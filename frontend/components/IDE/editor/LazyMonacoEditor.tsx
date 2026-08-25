'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'

// Lazy load Monaco ONLY when needed (after first render)
const MonacoEditor = dynamic(() => import('./MonacoEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-[#858585] text-sm">Loading editor...</div>
    </div>
  )
})

interface LazyMonacoEditorProps {
  [key: string]: any
}

export default function LazyMonacoEditor(props: LazyMonacoEditorProps) {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    // Defer Monaco loading until after initial paint
    const timer = setTimeout(() => setIsReady(true), 100)
    return () => clearTimeout(timer)
  }, [])

  if (!isReady) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-[#858585] text-sm">Initializing...</div>
      </div>
    )
  }

  return <MonacoEditor {...props} />
}

