'use client'

import { useEffect, useRef } from 'react'

export default function LoadingScreen() {
  const containerRef = useRef<HTMLDivElement>(null)
  
  // Force hardware acceleration and prevent animation pauses
  useEffect(() => {
    if (containerRef.current) {
      // Force GPU acceleration on the container
      containerRef.current.style.willChange = 'transform, opacity'
      containerRef.current.style.transform = 'translateZ(0)'
    }
  }, [])

  return (
    <div 
      ref={containerRef}
      className="min-h-screen w-full bg-[#141414] flex items-center justify-center overflow-hidden"
      style={{
        isolation: 'isolate', // Create stacking context to prevent paint issues
        backfaceVisibility: 'hidden', // Force hardware acceleration
        perspective: 1000 // Enable 3D rendering context
      }}
    >
      <div className="logo-spin-container relative">
        <div className="opacity-20 logo-spin">
          <img
            src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg" 
            alt="Logo" 
            width={120} 
            height={120}
            className="grayscale"
            draggable={false}
            style={{ 
              userSelect: 'none', 
              pointerEvents: 'none',
              willChange: 'transform', // Hint browser to optimize animation
              backfaceVisibility: 'hidden' // Prevent flickering
            }}
          />
        </div>
        {/* Purple sparks */}
        <div className="spark spark-1"></div>
        <div className="spark spark-2"></div>
        <div className="spark spark-3"></div>
        <div className="spark spark-4"></div>
        <div className="spark spark-5"></div>
        <div className="spark spark-6"></div>
      </div>
      <style jsx>{`
        .logo-spin-container {
          position: relative;
          user-select: none;
          will-change: contents;
          transform: translateZ(0);
        }
        
        .logo-spin img {
          animation: logoSpin 2s linear infinite;
          animation-play-state: running;
          user-select: none;
          -webkit-user-drag: none;
        }
        
        @keyframes logoSpin {
          0% {
            transform: rotate(0deg) translateZ(0);
          }
          100% {
            transform: rotate(360deg) translateZ(0);
          }
        }
        
        /* Purple sparks */
        .spark {
          position: absolute;
          width: 4px;
          height: 4px;
          background: #a855f7;
          border-radius: 50%;
          opacity: 0;
          box-shadow: 0 0 8px #a855f7;
          will-change: transform, opacity;
          transform: translateZ(0);
        }
        
        .spark-1 {
          top: 0;
          left: 50%;
          animation: spark1 2s ease-in-out infinite;
          animation-play-state: running;
        }
        
        .spark-2 {
          top: 25%;
          right: 0;
          animation: spark2 2s ease-in-out infinite 0.33s;
          animation-play-state: running;
        }
        
        .spark-3 {
          bottom: 25%;
          right: 0;
          animation: spark3 2s ease-in-out infinite 0.66s;
          animation-play-state: running;
        }
        
        .spark-4 {
          bottom: 0;
          left: 50%;
          animation: spark4 2s ease-in-out infinite 1s;
          animation-play-state: running;
        }
        
        .spark-5 {
          bottom: 25%;
          left: 0;
          animation: spark5 2s ease-in-out infinite 1.33s;
          animation-play-state: running;
        }
        
        .spark-6 {
          top: 25%;
          left: 0;
          animation: spark6 2s ease-in-out infinite 1.66s;
          animation-play-state: running;
        }
        
        @keyframes spark1 {
          0%, 100% {
            opacity: 0;
            transform: translate(-50%, 0) scale(0);
          }
          50% {
            opacity: 1;
            transform: translate(-50%, -20px) scale(1);
          }
        }
        
        @keyframes spark2 {
          0%, 100% {
            opacity: 0;
            transform: translate(0, 0) scale(0);
          }
          50% {
            opacity: 1;
            transform: translate(20px, -10px) scale(1);
          }
        }
        
        @keyframes spark3 {
          0%, 100% {
            opacity: 0;
            transform: translate(0, 0) scale(0);
          }
          50% {
            opacity: 1;
            transform: translate(20px, 10px) scale(1);
          }
        }
        
        @keyframes spark4 {
          0%, 100% {
            opacity: 0;
            transform: translate(-50%, 0) scale(0);
          }
          50% {
            opacity: 1;
            transform: translate(-50%, 20px) scale(1);
          }
        }
        
        @keyframes spark5 {
          0%, 100% {
            opacity: 0;
            transform: translate(0, 0) scale(0);
          }
          50% {
            opacity: 1;
            transform: translate(-20px, 10px) scale(1);
          }
        }
        
        @keyframes spark6 {
          0%, 100% {
            opacity: 0;
            transform: translate(0, 0) scale(0);
          }
          50% {
            opacity: 1;
            transform: translate(-20px, -10px) scale(1);
          }
        }
      `}</style>
    </div>
  )
}

