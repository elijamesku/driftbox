'use client'

/**
 * Dependency Graph Visualization
 * Shows a visual representation of resource dependencies
 * Uses a simple force-directed layout
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { X, ZoomIn, ZoomOut, Maximize2, RefreshCw, FileCode, GitBranch } from 'lucide-react'
import type { DependencyGraph as DependencyGraphType, DependencyNode, DependencyEdge } from '@/hooks/useTeamCollaboration'

interface DependencyGraphProps {
  graph: DependencyGraphType | null
  currentResource?: string
  onClose: () => void
  onRefresh: () => void
  onSelectResource?: (resource: string, file: string) => void
}

// Resource type colors
const TYPE_COLORS: Record<string, string> = {
  aws_vpc: '#FF9800',
  aws_subnet: '#4CAF50',
  aws_security_group: '#2196F3',
  aws_instance: '#9C27B0',
  aws_s3_bucket: '#F44336',
  aws_iam_role: '#00BCD4',
  aws_lambda_function: '#E91E63',
  aws_rds_instance: '#3F51B5',
  aws_dynamodb_table: '#009688',
  module: '#607D8B',
  default: '#757575'
}

function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || TYPE_COLORS.default
}

export default function DependencyGraph({
  graph,
  currentResource,
  onClose,
  onRefresh,
  onSelectResource
}: DependencyGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [hoveredNode, setHoveredNode] = useState<DependencyNode | null>(null)
  const [selectedNode, setSelectedNode] = useState<DependencyNode | null>(null)

  // Calculate node positions using simple force-directed layout
  const nodePositions = useMemo(() => {
    if (!graph || !graph.nodes.length) return {}

    const positions: Record<string, { x: number; y: number }> = {}
    const width = 800
    const height = 600
    const centerX = width / 2
    const centerY = height / 2

    // Initialize positions in a circle
    graph.nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / graph.nodes.length
      const radius = Math.min(width, height) / 3
      positions[node.id] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
      }
    })

    // Simple force simulation (10 iterations)
    for (let iter = 0; iter < 50; iter++) {
      // Repulsion between all nodes
      for (let i = 0; i < graph.nodes.length; i++) {
        for (let j = i + 1; j < graph.nodes.length; j++) {
          const nodeA = graph.nodes[i]
          const nodeB = graph.nodes[j]
          const posA = positions[nodeA.id]
          const posB = positions[nodeB.id]
          
          const dx = posB.x - posA.x
          const dy = posB.y - posA.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          
          const force = 5000 / (dist * dist)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          
          posA.x -= fx
          posA.y -= fy
          posB.x += fx
          posB.y += fy
        }
      }

      // Attraction along edges
      graph.edges.forEach(edge => {
        const fromPos = positions[edge.from]
        const toPos = positions[edge.to]
        
        if (!fromPos || !toPos) return
        
        const dx = toPos.x - fromPos.x
        const dy = toPos.y - fromPos.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        
        const force = dist * 0.01
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        
        fromPos.x += fx
        fromPos.y += fy
        toPos.x -= fx
        toPos.y -= fy
      })

      // Center gravity
      graph.nodes.forEach(node => {
        const pos = positions[node.id]
        pos.x += (centerX - pos.x) * 0.01
        pos.y += (centerY - pos.y) * 0.01
      })
    }

    return positions
  }, [graph])

  // Draw the graph
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !graph) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height

    // Clear canvas
    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, width, height)

    // Apply transformations
    ctx.save()
    ctx.translate(width / 2 + pan.x, height / 2 + pan.y)
    ctx.scale(zoom, zoom)
    ctx.translate(-width / 2, -height / 2)

    // Draw edges
    ctx.strokeStyle = '#333'
    ctx.lineWidth = 1
    graph.edges.forEach(edge => {
      const fromPos = nodePositions[edge.from]
      const toPos = nodePositions[edge.to]
      
      if (!fromPos || !toPos) return

      ctx.beginPath()
      ctx.moveTo(fromPos.x, fromPos.y)
      ctx.lineTo(toPos.x, toPos.y)
      ctx.stroke()

      // Draw arrow
      const angle = Math.atan2(toPos.y - fromPos.y, toPos.x - fromPos.x)
      const arrowLength = 10
      const arrowX = toPos.x - 20 * Math.cos(angle)
      const arrowY = toPos.y - 20 * Math.sin(angle)
      
      ctx.beginPath()
      ctx.moveTo(arrowX, arrowY)
      ctx.lineTo(
        arrowX - arrowLength * Math.cos(angle - Math.PI / 6),
        arrowY - arrowLength * Math.sin(angle - Math.PI / 6)
      )
      ctx.moveTo(arrowX, arrowY)
      ctx.lineTo(
        arrowX - arrowLength * Math.cos(angle + Math.PI / 6),
        arrowY - arrowLength * Math.sin(angle + Math.PI / 6)
      )
      ctx.stroke()
    })

    // Draw nodes
    graph.nodes.forEach(node => {
      const pos = nodePositions[node.id]
      if (!pos) return

      const isHovered = hoveredNode?.id === node.id
      const isSelected = selectedNode?.id === node.id
      const isCurrent = currentResource === node.id
      const radius = isHovered || isSelected ? 20 : 15

      // Node circle
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI)
      ctx.fillStyle = getTypeColor(node.type)
      ctx.fill()

      if (isCurrent) {
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 3
        ctx.stroke()
      } else if (isSelected) {
        ctx.strokeStyle = '#8844cc'
        ctx.lineWidth = 2
        ctx.stroke()
      }

      // Node label
      ctx.fillStyle = '#fff'
      ctx.font = '10px Inter, system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(node.label, pos.x, pos.y + radius + 5)
    })

    ctx.restore()
  }, [graph, nodePositions, zoom, pan, hoveredNode, selectedNode, currentResource])

  // Handle mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas || !graph) return

    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left - canvas.width / 2 - pan.x) / zoom + canvas.width / 2
    const y = (e.clientY - rect.top - canvas.height / 2 - pan.y) / zoom + canvas.height / 2

    // Check for node hover
    let found = false
    for (const node of graph.nodes) {
      const pos = nodePositions[node.id]
      if (!pos) continue

      const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2)
      if (dist < 20) {
        setHoveredNode(node)
        found = true
        break
      }
    }
    if (!found) setHoveredNode(null)

    // Handle panning
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      })
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleClick = (e: React.MouseEvent) => {
    if (hoveredNode) {
      setSelectedNode(hoveredNode)
      if (onSelectResource && hoveredNode.file) {
        onSelectResource(hoveredNode.id, hoveredNode.file)
      }
    } else {
      setSelectedNode(null)
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(z => Math.min(Math.max(z * delta, 0.5), 3))
  }

  if (!graph) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
        <div className="bg-[#1e1e1e] rounded-lg p-8 text-center">
          <RefreshCw className="w-8 h-8 text-gray-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading dependency graph...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#3a3a3a] bg-[#1e1e1e]">
        <div className="flex items-center gap-4">
          <GitBranch className="w-5 h-5 text-purple-400" />
          <h2 className="text-lg font-semibold text-white">Dependency Graph</h2>
          <span className="text-sm text-gray-400">
            {graph.resource_count} resources • {graph.dependency_count} dependencies
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="p-2 hover:bg-[#3a3a3a] rounded transition-colors"
            title="Refresh graph"
          >
            <RefreshCw size={16} className="text-gray-400" />
          </button>
          <button
            onClick={() => setZoom(z => Math.min(z * 1.2, 3))}
            className="p-2 hover:bg-[#3a3a3a] rounded transition-colors"
            title="Zoom in"
          >
            <ZoomIn size={16} className="text-gray-400" />
          </button>
          <button
            onClick={() => setZoom(z => Math.max(z * 0.8, 0.5))}
            className="p-2 hover:bg-[#3a3a3a] rounded transition-colors"
            title="Zoom out"
          >
            <ZoomOut size={16} className="text-gray-400" />
          </button>
          <button
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
            className="p-2 hover:bg-[#3a3a3a] rounded transition-colors"
            title="Reset view"
          >
            <Maximize2 size={16} className="text-gray-400" />
          </button>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#3a3a3a] rounded transition-colors"
          >
            <X size={16} className="text-gray-400" />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        <canvas
          ref={canvasRef}
          width={1200}
          height={800}
          className="w-full h-full cursor-grab"
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleClick}
          onWheel={handleWheel}
        />

        {/* Node tooltip */}
        {hoveredNode && (
          <div className="absolute top-4 left-4 bg-[#1e1e1e] border border-[#3a3a3a] rounded-lg p-4 shadow-xl">
            <div className="flex items-center gap-2 mb-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: getTypeColor(hoveredNode.type) }} 
              />
              <span className="text-white font-medium">{hoveredNode.id}</span>
            </div>
            <div className="text-xs text-gray-400">
              Type: <span className="text-gray-300">{hoveredNode.type}</span>
            </div>
            {hoveredNode.file && (
              <div className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                <FileCode size={10} />
                <span className="text-gray-300">{hoveredNode.file}</span>
              </div>
            )}
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-[#1e1e1e] border border-[#3a3a3a] rounded-lg p-4">
          <div className="text-xs text-gray-400 mb-2">Resource Types</div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(TYPE_COLORS).slice(0, -1).map(([type, color]) => (
              <div key={type} className="flex items-center gap-2">
                <div 
                  className="w-2 h-2 rounded-full" 
                  style={{ backgroundColor: color }} 
                />
                <span className="text-[10px] text-gray-300">{type}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

