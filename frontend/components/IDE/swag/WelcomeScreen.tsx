'use client'

import Image from 'next/image'

interface WelcomeScreenProps {
  onAgentMode?: () => void
}

export default function WelcomeScreen({ onAgentMode }: WelcomeScreenProps = {}) {
  return (
    <div className="h-full w-full flex items-center justify-center bg-[#181818]">
      <div className="flex flex-col items-center justify-center">
        {/* Logo - greyscale, no spin */}
        <div className="mb-4 opacity-20">
          <Image 
            src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg" 
            alt="Logo" 
            width={140} 
            height={140}
            className="grayscale"
            unoptimized
            draggable={false}
          />
        </div>

        {/* Menu items - even more compact */}
        <div className="flex flex-col gap-0.5 text-left min-w-[240px]">
          <div 
            onClick={onAgentMode}
            className="flex items-center justify-between gap-2 px-3 py-0.5 text-[13px] text-[#858585] hover:text-[#cccccc] cursor-pointer transition-colors"
          >
            <span>Agent mode</span>
            <div className="flex items-center gap-0.5 text-[11px]">
              <kbd className="px-1 py-0.5 bg-[#2a2a2a] rounded text-[#858585]">Ctrl</kbd>
              <span>+</span>
              <kbd className="px-1 py-0.5 bg-[#2a2a2a] rounded text-[#858585]">Shift</kbd>
              <span>+</span>
              <kbd className="px-1 py-0.5 bg-[#2a2a2a] rounded text-[#858585]">L</kbd>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-0.5 text-[13px] text-[#858585] hover:text-[#cccccc] cursor-pointer transition-colors">
            <span>Show Terminal</span>
            <div className="flex items-center gap-0.5 text-[11px]">
              <kbd className="px-1 py-0.5 bg-[#2a2a2a] rounded text-[#858585]">Ctrl</kbd>
              <span>+</span>
              <kbd className="px-1 py-0.5 bg-[#2a2a2a] rounded text-[#858585]">J</kbd>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-0.5 text-[13px] text-[#858585] hover:text-[#cccccc] cursor-pointer transition-colors">
            <span>Hide Files</span>
            <div className="flex items-center gap-0.5 text-[11px]">
              <kbd className="px-1 py-0.5 bg-[#2a2a2a] rounded text-[#858585]">Ctrl</kbd>
              <span>+</span>
              <kbd className="px-1 py-0.5 bg-[#2a2a2a] rounded text-[#858585]">B</kbd>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-0.5 text-[13px] text-[#858585] hover:text-[#cccccc] cursor-pointer transition-colors">
            <span>Search Files</span>
            <div className="flex items-center gap-0.5 text-[11px]">
              <kbd className="px-1 py-0.5 bg-[#2a2a2a] rounded text-[#858585]">Ctrl</kbd>
              <span>+</span>
              <kbd className="px-1 py-0.5 bg-[#2a2a2a] rounded text-[#858585]">P</kbd>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-0.5 text-[13px] text-[#858585] hover:text-[#cccccc] cursor-pointer transition-colors">
            <span>Open Browser</span>
            <div className="flex items-center gap-0.5 text-[11px]">
              <kbd className="px-1 py-0.5 bg-[#2a2a2a] rounded text-[#858585]">Ctrl</kbd>
              <span>+</span>
              <kbd className="px-1 py-0.5 bg-[#2a2a2a] rounded text-[#858585]">Shift</kbd>
              <span>+</span>
              <kbd className="px-1 py-0.5 bg-[#2a2a2a] rounded text-[#858585]">B</kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

