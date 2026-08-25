'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { X, Play, RotateCcw, Trophy, Gamepad2 } from 'lucide-react'

interface MiniGameProps {
  onClose: () => void
}

export default function MiniGame({ onClose }: MiniGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [gameState, setGameState] = useState<'idle' | 'playing' | 'gameover'>('idle')
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(0)
  
  // Game constants - tuned for easier gameplay
  const GRAVITY = 0.25  // Slower fall
  const JUMP_FORCE = -5.5  // Gentler jump
  const PIPE_SPEED = 2
  const PIPE_GAP = 140  // Bigger gap to fly through
  const PIPE_WIDTH = 45
  const BIRD_SIZE = 20
  
  // Game state refs (for animation loop)
  const birdY = useRef(200)  // Start more centered
  const birdVelocity = useRef(0)
  const pipes = useRef<{x: number, topHeight: number}[]>([])
  const frameCount = useRef(0)
  const scoreRef = useRef(0)
  const gameStateRef = useRef(gameState)
  const animationId = useRef<number>()
  
  // Load high score from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('driftbox-minigame-highscore')
    if (saved) setHighScore(parseInt(saved))
  }, [])
  
  // Update ref when state changes
  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])
  
  const resetGame = useCallback(() => {
    birdY.current = 200  // Start more centered
    birdVelocity.current = 0
    pipes.current = []
    frameCount.current = 0
    scoreRef.current = 0
    setScore(0)
  }, [])
  
  const startGame = useCallback(() => {
    resetGame()
    setGameState('playing')
  }, [resetGame])
  
  const jump = useCallback(() => {
    if (gameStateRef.current === 'playing') {
      birdVelocity.current = JUMP_FORCE
    } else if (gameStateRef.current === 'idle' || gameStateRef.current === 'gameover') {
      startGame()
    }
  }, [startGame])
  
  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault()
        jump()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [jump])
  
  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const gameLoop = () => {
      // Clear canvas with gradient sky (greyscale)
      const skyGradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
      skyGradient.addColorStop(0, '#1a1a1a')
      skyGradient.addColorStop(0.5, '#252525')
      skyGradient.addColorStop(1, '#1f1f1f')
      ctx.fillStyle = skyGradient
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      
      // Draw clouds (greyscale, parallax scrolling) - seamless loop
      const cloudSpeed = frameCount.current * 0.3
      const clouds = [
        { x: 50, y: 60, sizes: [25, 30, 25] },
        { x: 180, y: 90, sizes: [20, 25, 20] },
        { x: 300, y: 50, sizes: [22, 28, 22] },
        { x: 420, y: 110, sizes: [18, 24, 18] },
      ]
      const cloudLoopWidth = 500
      ctx.fillStyle = '#2a2a2a'
      clouds.forEach(cloud => {
        let cx = ((cloud.x - cloudSpeed) % cloudLoopWidth)
        if (cx < -80) cx += cloudLoopWidth
        ctx.beginPath()
        ctx.arc(cx, cloud.y, cloud.sizes[0], 0, Math.PI * 2)
        ctx.arc(cx + 25, cloud.y - 5, cloud.sizes[1], 0, Math.PI * 2)
        ctx.arc(cx + 55, cloud.y, cloud.sizes[2], 0, Math.PI * 2)
        ctx.fill()
      })
      
      // Draw city silhouette (greyscale, slower parallax) - seamless loop
      const citySpeed = frameCount.current * 0.5
      const buildings = [
        { x: 0, w: 40, h: 80 },
        { x: 50, w: 30, h: 60 },
        { x: 90, w: 50, h: 100 },
        { x: 150, w: 35, h: 70 },
        { x: 195, w: 45, h: 90 },
        { x: 250, w: 30, h: 55 },
        { x: 290, w: 55, h: 85 },
        { x: 355, w: 40, h: 75 },
        { x: 405, w: 35, h: 65 },
        { x: 450, w: 50, h: 95 },
      ]
      const buildingLoopWidth = 510
      buildings.forEach(b => {
        let bx = ((b.x - citySpeed) % buildingLoopWidth)
        if (bx < -60) bx += buildingLoopWidth
        
        // Building
        ctx.fillStyle = '#1a1a1a'
        ctx.fillRect(bx, canvas.height - b.h - 40, b.w, b.h)
        
        // Windows
        ctx.fillStyle = '#252525'
        for (let wy = canvas.height - b.h - 35; wy < canvas.height - 45; wy += 15) {
          for (let wx = bx + 5; wx < bx + b.w - 5; wx += 10) {
            if (wx >= 0 && wx < canvas.width) {
              ctx.fillRect(wx, wy, 5, 8)
            }
          }
        }
      })
      
      // Draw ground
      ctx.fillStyle = '#151515'
      ctx.fillRect(0, canvas.height - 40, canvas.width, 40)
      // Ground line
      ctx.fillStyle = '#2a2a2a'
      ctx.fillRect(0, canvas.height - 40, canvas.width, 3)
      // Ground texture (moving)
      ctx.fillStyle = '#1f1f1f'
      const groundOffset = (frameCount.current * 2) % 20
      for (let gx = -groundOffset; gx < canvas.width; gx += 20) {
        ctx.fillRect(gx, canvas.height - 35, 10, 2)
      }
      
      if (gameStateRef.current === 'playing') {
        // Update bird
        birdVelocity.current += GRAVITY
        birdY.current += birdVelocity.current
        
        // Spawn pipes - less frequent for easier gameplay
        frameCount.current++
        if (frameCount.current % 120 === 0) {
          const topHeight = 50 + Math.random() * (canvas.height - PIPE_GAP - 100)
          pipes.current.push({ x: canvas.width, topHeight })
        }
        
        // Update pipes
        pipes.current = pipes.current.filter(pipe => {
          pipe.x -= PIPE_SPEED
          
          // Check collision
          const birdLeft = 50
          const birdRight = 50 + BIRD_SIZE
          const birdTop = birdY.current
          const birdBottom = birdY.current + BIRD_SIZE
          
          const pipeLeft = pipe.x
          const pipeRight = pipe.x + PIPE_WIDTH
          const gapTop = pipe.topHeight
          const gapBottom = pipe.topHeight + PIPE_GAP
          
          if (birdRight > pipeLeft && birdLeft < pipeRight) {
            if (birdTop < gapTop || birdBottom > gapBottom) {
              setGameState('gameover')
              if (scoreRef.current > highScore) {
                setHighScore(scoreRef.current)
                localStorage.setItem('driftbox-minigame-highscore', scoreRef.current.toString())
              }
            }
          }
          
          // Score point
          if (pipe.x + PIPE_WIDTH < 50 && pipe.x + PIPE_WIDTH > 50 - PIPE_SPEED) {
            scoreRef.current++
            setScore(scoreRef.current)
          }
          
          return pipe.x > -PIPE_WIDTH
        })
        
        // Check bounds (ground is at canvas.height - 40)
        if (birdY.current < 0 || birdY.current > canvas.height - 40 - BIRD_SIZE) {
          setGameState('gameover')
          if (scoreRef.current > highScore) {
            setHighScore(scoreRef.current)
            localStorage.setItem('driftbox-minigame-highscore', scoreRef.current.toString())
          }
        }
      }
      
      // Draw pipes
      ctx.fillStyle = '#7c3aed'
      pipes.current.forEach(pipe => {
        // Top pipe
        ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.topHeight)
        // Pipe cap
        ctx.fillStyle = '#9333ea'
        ctx.fillRect(pipe.x - 3, pipe.topHeight - 15, PIPE_WIDTH + 6, 15)
        
        // Bottom pipe
        ctx.fillStyle = '#7c3aed'
        const bottomY = pipe.topHeight + PIPE_GAP
        ctx.fillRect(pipe.x, bottomY, PIPE_WIDTH, canvas.height - bottomY)
        // Pipe cap
        ctx.fillStyle = '#9333ea'
        ctx.fillRect(pipe.x - 3, bottomY, PIPE_WIDTH + 6, 15)
      })
      
      // Draw bird (Driftbox logo style - a simple K)
      const birdX = 50
      const by = birdY.current
      
      // Bird body (gradient circle)
      const gradient = ctx.createRadialGradient(birdX + 10, by + 10, 0, birdX + 10, by + 10, 12)
      gradient.addColorStop(0, '#a855f7')
      gradient.addColorStop(1, '#7c3aed')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(birdX + 10, by + 10, 12, 0, Math.PI * 2)
      ctx.fill()
      
      // Bird eye
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(birdX + 14, by + 8, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#000'
      ctx.beginPath()
      ctx.arc(birdX + 15, by + 8, 1.5, 0, Math.PI * 2)
      ctx.fill()
      
      // Wing
      ctx.fillStyle = '#9333ea'
      ctx.beginPath()
      const wingY = by + 12 + Math.sin(frameCount.current * 0.3) * 3
      ctx.ellipse(birdX + 5, wingY, 6, 4, -0.3, 0, Math.PI * 2)
      ctx.fill()
      
      // Draw score
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 24px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(scoreRef.current.toString(), canvas.width / 2, 35)
      
      // Draw high score
      ctx.fillStyle = '#666'
      ctx.font = '12px Inter, sans-serif'
      ctx.fillText(`Best: ${highScore}`, canvas.width / 2, 55)
      
      // Game over or idle screen
      if (gameStateRef.current === 'idle') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 18px Inter, sans-serif'
        ctx.fillText('Driftbox Bird', canvas.width / 2, canvas.height / 2 - 30)
        
        ctx.fillStyle = '#888'
        ctx.font = '13px Inter, sans-serif'
        ctx.fillText('Click or press Space to start', canvas.width / 2, canvas.height / 2 + 5)
        ctx.fillText('Space/↑ to jump', canvas.width / 2, canvas.height / 2 + 25)
      }
      
      if (gameStateRef.current === 'gameover') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        
        ctx.fillStyle = '#ef4444'
        ctx.font = 'bold 20px Inter, sans-serif'
        ctx.fillText('Game Over', canvas.width / 2, canvas.height / 2 - 30)
        
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 28px Inter, sans-serif'
        ctx.fillText(scoreRef.current.toString(), canvas.width / 2, canvas.height / 2 + 10)
        
        ctx.fillStyle = '#888'
        ctx.font = '12px Inter, sans-serif'
        ctx.fillText('Click to retry', canvas.width / 2, canvas.height / 2 + 40)
      }
      
      animationId.current = requestAnimationFrame(gameLoop)
    }
    
    gameLoop()
    
    return () => {
      if (animationId.current) {
        cancelAnimationFrame(animationId.current)
      }
    }
  }, [highScore])
  
  return (
    <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="px-3 py-2 bg-white/5 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gamepad2 className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-medium text-white/70">While you wait...</span>
        </div>
        <div className="flex items-center gap-1">
          {gameState !== 'idle' && (
            <button
              onClick={() => { resetGame(); setGameState('idle') }}
              className="p-1 hover:bg-white/10 rounded-lg transition-colors"
              title="Restart"
            >
              <RotateCcw className="w-3.5 h-3.5 text-white/50" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-3.5 h-3.5 text-white/50" />
          </button>
        </div>
      </div>
      
      {/* Game Canvas - fills available space */}
      <canvas
        ref={canvasRef}
        width={320}
        height={480}
        onClick={jump}
        className="cursor-pointer w-full"
        style={{ display: 'block' }}
      />
      
      {/* Footer with high score */}
      <div className="px-3 py-2 bg-white/5 border-t border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs text-white/50">High: {highScore}</span>
        </div>
        <span className="text-[10px] text-white/30">Space to jump</span>
      </div>
    </div>
  )
}

