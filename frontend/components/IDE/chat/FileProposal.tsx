'use client'

import { useState } from 'react'
import { Check, X, FileText, FilePlus, FileEdit } from 'lucide-react'
import ReactDiffViewer from 'react-diff-viewer-continued'

export interface FileProposalData {
  action: 'create' | 'edit' | 'delete'
  path: string
  oldContent?: string
  newContent: string
  description?: string
}

interface FileProposalProps {
  proposal: FileProposalData
  onAccept: () => void
  onReject: () => void
  isProcessing?: boolean
  totalProposals?: number
  onAcceptAll?: () => void
}

export default function FileProposal({ proposal, onAccept, onReject, isProcessing, totalProposals = 1, onAcceptAll }: FileProposalProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const getActionIcon = () => {
    switch (proposal.action) {
      case 'create':
        return <FilePlus size={16} className="text-green-500" />
      case 'edit':
        return <FileEdit size={16} className="text-blue-500" />
      case 'delete':
        return <X size={16} className="text-red-500" />
    }
  }

  const getActionText = () => {
    switch (proposal.action) {
      case 'create':
        return 'Create'
      case 'edit':
        return 'Edit'
      case 'delete':
        return 'Delete'
    }
  }

  const getActionColor = () => {
    switch (proposal.action) {
      case 'create':
        return 'border-green-500/30 bg-green-500/5'
      case 'edit':
        return 'border-blue-500/30 bg-blue-500/5'
      case 'delete':
        return 'border-red-500/30 bg-red-500/5'
    }
  }

  return (
    <div className={`border rounded-lg overflow-hidden ${getActionColor()} my-3`}>
      {/* Header */}
      <div 
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2 flex-1">
          {getActionIcon()}
          <span className="font-semibold text-sm text-[#EDEDED]">
            {getActionText()} <code className="text-xs bg-[#2a2a2a] px-2 py-1 rounded">{proposal.path}</code>
          </span>
        </div>
        {proposal.description && (
          <span className="text-xs text-[#888] mr-3">{proposal.description}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded(!isExpanded)
          }}
          className="text-[#888] hover:text-[#EDEDED]"
        >
          <span className="text-xs">{isExpanded ? '▼' : '▶'}</span>
        </button>
      </div>

      {/* Diff View */}
      {isExpanded && (
        <div className="border-t border-[#2a2a2a]">
          {proposal.action === 'delete' ? (
            <div className="p-4 text-center text-sm text-red-400">
              This file will be deleted
            </div>
          ) : proposal.action === 'create' ? (
            <div className="bg-[#0a0a0a] overflow-auto max-h-96">
              <pre className="p-4 text-xs text-[#EDEDED] font-mono">
                <code>{proposal.newContent}</code>
              </pre>
            </div>
          ) : (
            <div className="bg-[#0a0a0a] overflow-auto max-h-96">
              <ReactDiffViewer
                oldValue={proposal.oldContent || ''}
                newValue={proposal.newContent}
                splitView={false}
                hideLineNumbers={false}
                showDiffOnly={true}
                useDarkTheme={true}
                styles={{
                  diffContainer: {
                    fontSize: '11px',
                    fontFamily: '"Input Mono", "Cascadia Code", Consolas, monospace',
                  },
                  line: {
                    padding: '2px 8px',
                  },
                }}
              />
            </div>
          )}

          {/* Action Buttons - Advanced Style */}
          <div className="flex gap-3 p-3 bg-black/40 backdrop-blur-xl border-t border-white/10 shadow-[0_-4px_20px_rgba(0,0,0,0.3)]">
            <button
              onClick={onReject}
              disabled={isProcessing}
              className="group flex items-center gap-2 px-4 py-2 bg-[#2a2a2a] hover:bg-[#3a3a3a] disabled:bg-[#2a2a2a]/50 disabled:cursor-not-allowed text-[#888] hover:text-white rounded-md transition-all duration-200 text-xs font-medium border border-[#3e3e42] hover:border-[#505050] shadow-sm hover:shadow-md relative overflow-hidden"
              title="Ctrl+N"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
              <span className="relative z-10">Undo</span> <span className="text-[10px] ml-1 opacity-60 relative z-10">Ctrl+N</span>
            </button>
            <button
              onClick={onAccept}
              disabled={isProcessing}
              className="group flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 disabled:from-emerald-600/50 disabled:to-emerald-700/50 disabled:cursor-not-allowed text-white rounded-md transition-all duration-200 text-xs font-medium shadow-lg shadow-emerald-900/50 hover:shadow-emerald-800/60 hover:scale-105 relative overflow-hidden"
              title="Ctrl+Shift+="
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
              <span className="relative z-10">{isProcessing ? 'Applying...' : 'Keep'}</span> <span className="text-[10px] ml-1 opacity-60 relative z-10">Ctrl+Shift+=</span>
            </button>
            {totalProposals > 1 && onAcceptAll && (
              <button
                onClick={onAcceptAll}
                disabled={isProcessing}
                className="group flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 disabled:from-blue-600/50 disabled:to-blue-700/50 disabled:cursor-not-allowed text-white rounded-md transition-all duration-200 text-xs font-medium shadow-lg shadow-blue-900/50 hover:shadow-blue-800/60 hover:scale-105 ml-auto relative overflow-hidden"
                title="Keep all files and continue"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                <span className="relative z-10">Keep all ({totalProposals})</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

