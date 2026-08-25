'use client'

import { useEffect, useRef } from 'react'

export default function GradientBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    // Create animated gradient mesh
    let frame = 0
    const animate = () => {
      frame++
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Create multiple gradient circles
      const time = frame * 0.01
      const gradient1 = ctx.createRadialGradient(
        canvas.width * 0.3 + Math.sin(time) * 100,
        canvas.height * 0.3,
        0,
        canvas.width * 0.3 + Math.sin(time) * 100,
        canvas.height * 0.3,
        canvas.width * 0.8
      )
      gradient1.addColorStop(0, 'rgba(120, 119, 198, 0.3)')
      gradient1.addColorStop(1, 'rgba(120, 119, 198, 0)')

      const gradient2 = ctx.createRadialGradient(
        canvas.width * 0.7 - Math.sin(time) * 100,
        canvas.height * 0.7,
        0,
        canvas.width * 0.7 - Math.sin(time) * 100,
        canvas.height * 0.7,
        canvas.width * 0.9
      )
      gradient2.addColorStop(0, 'rgba(139, 92, 246, 0.3)')
      gradient2.addColorStop(1, 'rgba(139, 92, 246, 0)')

      const gradient3 = ctx.createRadialGradient(
        canvas.width * 0.5,
        canvas.height * 0.5 + Math.cos(time) * 150,
        0,
        canvas.width * 0.5,
        canvas.height * 0.5 + Math.cos(time) * 150,
        canvas.width * 0.7
      )
      gradient3.addColorStop(0, 'rgba(59, 130, 246, 0.2)')
      gradient3.addColorStop(1, 'rgba(59, 130, 246, 0)')

      ctx.fillStyle = gradient1
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.fillStyle = gradient2
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.fillStyle = gradient3
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resizeCanvas)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.6 }}
    />
  )
}

