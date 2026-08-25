'use client'

import { useState } from 'react'

interface CompactDiffPreviewProps {
  filePath: string
  oldContent: string | null | undefined
  newContent: string
  onClick: () => void
}

/**
 * Compact diff preview for chat - shows first few changed lines
 * Click to open full diff in editor
 */
export default function CompactDiffPreview({
  filePath,
  oldContent,
  newContent,
  onClick
}: CompactDiffPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  
  // Calculate diff (simple line-by-line)
  const oldLines = oldContent ? oldContent.split('\n') : []
  const newLines = newContent ? newContent.split('\n') : []
  
  // Find changed lines
  const changedLines: Array<{ type: 'add' | 'remove' | 'modify', line: string, lineNumber: number }> = []
  const maxLines = Math.max(oldLines.length, newLines.length)
  
  // For new files (no old content), show all new lines as additions
  const isNewFile = oldLines.length === 0 || (oldLines.length === 1 && oldLines[0] === '')
  
  if (isNewFile) {
    // This is a new file - show all non-empty lines as additions
    for (let i = 0; i < newLines.length; i++) {
      if (newLines[i].trim()) { // Skip empty lines for preview
        changedLines.push({ type: 'add', line: newLines[i], lineNumber: i + 1 })
      }
    }
  } else {
    // This is an edit - compare line by line
    for (let i = 0; i < maxLines; i++) {
      const oldLine = oldLines[i] || ''
      const newLine = newLines[i] || ''
      
      if (oldLine !== newLine) {
        if (!oldLine && newLine) {
          changedLines.push({ type: 'add', line: newLine, lineNumber: i + 1 })
        } else if (oldLine && !newLine) {
          changedLines.push({ type: 'remove', line: oldLine, lineNumber: i + 1 })
        } else {
          changedLines.push({ type: 'modify', line: newLine, lineNumber: i + 1 })
        }
      }
    }
  }
  
  // Don't render if no changes AND no new content
  if (changedLines.length === 0 && newLines.length === 0) {
    return null
  }
  
  // If we have new content but no changedLines detected (edge case), show first 3 lines
  if (changedLines.length === 0 && newLines.length > 0) {
    for (let i = 0; i < Math.min(newLines.length, 3); i++) {
      if (newLines[i].trim()) {
        changedLines.push({ type: 'add', line: newLines[i], lineNumber: i + 1 })
      }
    }
  }
  
  // Calculate total changes
  const totalChanges = isNewFile 
    ? newLines.filter(line => line.trim()).length // For new files, count all non-empty lines
    : Math.max(changedLines.length, 1) // For edits, count changed lines (min 1 to always show something)
  
  const previewLines = isExpanded ? changedLines : changedLines.slice(0, 3) // Show first 3 or all changed lines
  
  return (
    <div 
      onClick={onClick}
      className="mt-2 relative overflow-hidden rounded cursor-pointer group transition-all"
      style={{
        background: '#1a1a1a',
        border: '1px solid rgba(74, 222, 128, 0.2)',
      }}
    >
      {/* Content wrapper */}
      <div className="relative z-10 px-2 py-1.5">
        {/* Compact header */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <i className="codicon codicon-file-code text-emerald-400" style={{ fontSize: 12 }} />
            <div className="text-[10px] font-medium text-gray-300">{filePath}</div>
            <div className="text-[9px] text-gray-500">
              {totalChanges} change{totalChanges !== 1 ? 's' : ''}
            </div>
          </div>
          {/* Collapse button - only show when expanded */}
          {changedLines.length > 3 && isExpanded && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsExpanded(false)
              }}
              className="text-[9px] text-gray-400 hover:text-emerald-400 flex items-center gap-0.5 transition-colors"
            >
              <span>Collapse</span>
              <i className="codicon codicon-chevron-up" style={{ fontSize: 9 }} />
            </button>
          )}
        </div>
        
        {/* Compact preview lines */}
        <div className="space-y-0.5 font-mono text-[10px]">
          {previewLines.map((change, idx) => (
            <div 
              key={idx}
              className={`flex items-start gap-1.5 px-1.5 py-0.5 rounded ${
                change.type === 'add' ? 'bg-emerald-500/10' : 
                change.type === 'remove' ? 'bg-red-500/10' : 
                'bg-amber-500/10'
              }`}
            >
              <span className={`flex-shrink-0 ${
                change.type === 'add' ? 'text-emerald-400' : 
                change.type === 'remove' ? 'text-red-400' : 
                'text-amber-400'
              }`}>
                {change.type === 'add' ? '+' : change.type === 'remove' ? '−' : '~'}
              </span>
              <span className="text-gray-300 leading-tight">{change.line}</span>
            </div>
          ))}
          
          {changedLines.length > 3 && !isExpanded && (
            <div className="flex items-center justify-center gap-1 text-gray-500 py-0.5">
              <span className="text-[9px]">
                {changedLines.length - 3} more line{changedLines.length - 3 !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
        
        {/* Compact CTA */}
        <div className="mt-1.5 pt-1.5 border-t border-emerald-500/10">
          {changedLines.length > 3 && !isExpanded ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsExpanded(true)
              }}
              className="flex items-center justify-center gap-1 text-[9px] font-medium text-gray-400 hover:text-emerald-400 transition-colors w-full"
            >
              <span>Expand {changedLines.length - 3} more lines</span>
              <i className="codicon codicon-chevron-down" style={{ fontSize: 9 }} />
            </button>
          ) : (
            <div className="flex items-center justify-center gap-1 text-[9px] font-medium text-gray-400 group-hover:text-emerald-400 transition-colors">
              <span>Click to view full diff</span>
              <i className="codicon codicon-arrow-right" style={{ fontSize: 9 }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

