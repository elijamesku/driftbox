'use client'

import React, { useMemo } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  Panel,
  NodeProps,
  Handle,
  Position,
  MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import AWSIcon from './AWSIcon'

interface DiagramData {
  nodes: Array<{
    id: string
    type: string
    label: string
    icon: string
    file: string
    line?: number
    category: string
  }>
  edges: Array<{
    source: string
    target: string
    relationship: string
  }>
}

// Custom AWS Resource Node Component - AWS Official Style
function AWSResourceNode({ data }: NodeProps) {
  const { label, type } = data

  return (
    <div
      className="bg-white rounded-lg border-2 border-gray-300 shadow-md hover:shadow-lg transition-shadow"
      style={{
        minWidth: 120,
        maxWidth: 180,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: '#555', width: 8, height: 8 }} />
      <div className="flex flex-col items-center p-3">
        {/* AWS Icon */}
        <div className="mb-2">
          <AWSIcon service={type} size={48} />
        </div>
        {/* Resource Label */}
        <div className="text-center w-full">
          <div className="text-xs font-semibold text-gray-900 truncate px-1" title={label}>
            {label}
          </div>
          <div className="text-[10px] text-gray-600 mt-0.5 truncate px-1">
            {type.replace('aws_', '').replace(/_/g, ' ')}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#555', width: 8, height: 8 }} />
    </div>
  )
}

// Custom VPC Group Node Component - AWS Official Style
function VPCGroupNode({ data }: NodeProps) {
  const { label } = data

  return (
    <div
      className="rounded-lg border-4 border-green-500 bg-green-50/30 p-4"
      style={{
        minWidth: 500,
        minHeight: 400,
        backgroundColor: 'rgba(240, 253, 244, 0.3)', // Light green background
      }}
    >
      <div className="flex items-center gap-2 mb-3 px-2 border-b-2 border-green-500 pb-2">
        <AWSIcon service="aws_vpc" size={24} />
        <div className="text-sm font-bold text-gray-900">
          {label}
        </div>
      </div>
      <div className="space-y-3">
        {/* Children will be rendered by ReactFlow */}
      </div>
    </div>
  )
}

// Custom Subnet Group Node Component - AWS Official Style
function SubnetGroupNode({ data }: NodeProps) {
  const { label } = data

  return (
    <div
      className="rounded-lg border-2 border-blue-500 bg-blue-50/30 p-3 mb-2"
      style={{
        minWidth: 450,
        minHeight: 250,
        backgroundColor: 'rgba(239, 246, 255, 0.3)', // Light blue background
      }}
    >
      <div className="flex items-center gap-2 mb-2 px-2 border-b border-blue-500 pb-1">
        <AWSIcon service="aws_subnet" size={20} />
        <div className="text-xs font-semibold text-gray-900">
          {label}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {/* Children will be rendered by ReactFlow */}
      </div>
    </div>
  )
}

const nodeTypes = {
  awsResource: AWSResourceNode,
  vpcGroup: VPCGroupNode,
  subnetGroup: SubnetGroupNode,
}

// Dagre layout configuration for hierarchical diagram
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  
  const nodeWidth = 150
  const nodeHeight = 100
  
  // Configure graph layout
  dagreGraph.setGraph({
    rankdir: direction, // TB = top to bottom, LR = left to right
    align: 'UL',
    nodesep: 80,  // Horizontal spacing between nodes
    ranksep: 120, // Vertical spacing between ranks
    edgesep: 50,
    marginx: 50,
    marginy: 50,
  })

  // Add nodes to dagre graph
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: nodeWidth,
      height: nodeHeight,
    })
  })

  // Add edges to dagre graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  // Calculate layout
  dagre.layout(dagreGraph)

  // Apply calculated positions to nodes
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    }
  })

  return { nodes: layoutedNodes, edges }
}

interface AWSDiagramProps {
  data: DiagramData
  isDarkBackground?: boolean
  onNodeClick?: (nodeId: string, file: string, line?: number) => void
}

export default function AWSDiagram({ data, isDarkBackground = true, onNodeClick }: AWSDiagramProps) {
  // Build nodes and edges with automatic layout
  const { nodes, edges } = useMemo(() => {
    // Helper to get human-readable relationship label
    const getRelationshipLabel = (rel: string): string => {
      if (rel === 'contains') return 'Contains'
      if (rel === 'hosts') return 'Hosts'
      if (rel === 'accesses') return 'Accesses'
      if (rel === 'invokes') return 'Invokes'
      if (rel === 'assumes') return 'Uses Role'
      if (rel === 'associated_with') return 'Associated'
      if (rel === 'connects_to') return 'Connects'
      return rel
    }

    // Helper to determine edge style based on relationship
    const getEdgeStyle = (rel: string): { stroke: string; strokeWidth: number; strokeDasharray?: string } => {
      if (rel === 'assumes') {
        return { stroke: '#dd344c', strokeWidth: 2, strokeDasharray: '5,5' } // Red dashed for IAM
      }
      if (rel === 'accesses') {
        return { stroke: '#3f48cc', strokeWidth: 2 } // Blue for data access
      }
      if (rel === 'invokes') {
        return { stroke: '#8c4fff', strokeWidth: 2 } // Purple for API calls
      }
      if (rel === 'contains' || rel === 'hosts') {
        return { stroke: '#10b981', strokeWidth: 2, strokeDasharray: '5,5' } // Green dashed for hierarchy
      }
      return { stroke: '#64748b', strokeWidth: 2 } // Gray for general connections
    }

    // Convert backend nodes to ReactFlow nodes
    const flowNodes: Node[] = data.nodes.map(node => ({
      id: node.id,
      type: 'awsResource',
      position: { x: 0, y: 0 }, // Will be set by dagre
      data: {
        label: node.label,
        type: node.type,
        category: node.category,
        file: node.file,
        line: node.line,
      },
    }))

    // Convert backend edges to ReactFlow edges with proper styling
    const flowEdges: Edge[] = data.edges.map(edge => {
      const label = getRelationshipLabel(edge.relationship)
      const style = getEdgeStyle(edge.relationship)
      
      return {
        id: `${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        label: label,
        type: 'smoothstep',
        animated: edge.relationship === 'invokes' || edge.relationship === 'accesses',
        style: style,
        labelStyle: {
          fill: style.stroke,
          fontWeight: 600,
          fontSize: 11,
          backgroundColor: 'white',
          padding: '2px 4px',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: style.stroke,
        },
      }
    })

    // Apply automatic hierarchical layout
    const layouted = getLayoutedElements(flowNodes, flowEdges, 'TB')

    return layouted
  }, [data])

  const handleNodeClick = (event: React.MouseEvent, node: Node) => {
    if (onNodeClick && node.data?.file) {
      onNodeClick(node.id, node.data.file, node.data.line)
    }
  }

  return (
    <div style={{ width: '100%', height: '100%', background: isDarkBackground ? '#1a1a1a' : '#0f172a' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        style={{ background: isDarkBackground ? '#1a1a1a' : '#ffffff', transition: 'background 300ms' }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
          style: { stroke: '#000000', strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
          },
        }}
      >
        <Background color="#f5f5f5" gap={20} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            if (node.type === 'vpcGroup') return '#10b981'
            if (node.type === 'subnetGroup') return '#3b82f6'
            return '#6b7280'
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
          style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb' }}
        />
        <Panel position="top-right" className="bg-white/90 border border-gray-300 rounded px-3 py-1 shadow-sm">
          <span className="text-gray-700 text-xs font-semibold">
            {data.nodes.length} resources
          </span>
        </Panel>
      </ReactFlow>
    </div>
  )
}

