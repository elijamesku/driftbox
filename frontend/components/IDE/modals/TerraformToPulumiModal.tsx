'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts'
import { getApiEndpoint } from '@/utils/apiEndpoint'

interface TerraformToPulumiModalProps {
  isOpen: boolean
  onClose: () => void
  selectedRepo?: any
  terraformFiles?: string[]
  onRefreshFileTree?: () => void
}

export default function TerraformToPulumiModal({ isOpen, onClose, selectedRepo, terraformFiles = [], onRefreshFileTree }: TerraformToPulumiModalProps) {
  const { token } = useAuth()
  const [selectedLanguage, setSelectedLanguage] = useState<'typescript' | 'python' | 'go' | 'csharp'>('typescript')
  const [isConverting, setIsConverting] = useState(false)
  const [conversionStatus, setConversionStatus] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleConvert = async () => {
    if (!selectedRepo) {
      setError('No repository selected')
      return
    }

    setIsConverting(true)
    setError(null)
    setConversionStatus('Analyzing Terraform files...')

    try {
      const [owner, repo] = selectedRepo.full_name.split('/')
      
      setConversionStatus('Converting to Pulumi...')
      
      const response = await fetch(getApiEndpoint('/terraform-to-pulumi'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          owner,
          repo,
          language: selectedLanguage,
          files: terraformFiles
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMsg = errorData.detail || errorData.error || `Conversion failed with status ${response.status}`
        throw new Error(errorMsg)
      }

      const data = await response.json()
      
      console.log('Conversion response:', data)
      
      setConversionStatus('Creating pulumi folder and saving files...')
      
      // Success - show completion message with actual files created
      const filesCreated = data.files_created || []
      const fileContents = data.file_contents || {}
      
      if (filesCreated.length > 0) {
        setConversionStatus(`Successfully converted ${data.files_converted || 0} files to Pulumi (${selectedLanguage})! ${filesCreated.length} files ready to review. You can commit these via terminal.`)
        
        // Log the files for the user to see
        console.log('Converted Pulumi files:', fileContents)
        
        // TODO: Open the main file in the editor
        // For now, just show success message
      } else {
        setConversionStatus(`Conversion completed but no files were created.`)
      }
      
      // Close modal after 3 seconds
      setTimeout(() => {
        onClose()
        setConversionStatus('')
      }, 3000)
      
    } catch (err: any) {
      setError(err.message || 'Failed to convert Terraform to Pulumi')
      setConversionStatus('')
    } finally {
      setIsConverting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div 
        className="bg-[#181818] border border-[#3e3e42] rounded-lg shadow-2xl w-[500px] max-h-[600px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#3e3e42]">
          <div className="flex items-center gap-2">
            <i className="codicon codicon-arrow-swap text-[var(--cursor-accent)]" style={{ fontSize: 20 }} />
            <h2 className="text-[15px] font-semibold text-white">Convert Terraform to Pulumi</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#858585] hover:text-white transition-colors"
          >
            <i className="codicon codicon-close" style={{ fontSize: 16 }} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Repository Info */}
          {selectedRepo && (
            <div className="flex items-center gap-2 text-[13px] text-[#858585]">
              <i className="codicon codicon-repo" style={{ fontSize: 14 }} />
              <span>{selectedRepo.full_name}</span>
            </div>
          )}

          {/* Language Selection */}
          <div className="space-y-2">
            <label className="block text-[13px] text-[#cccccc] font-medium">
              Target Language
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'typescript', label: 'TypeScript', icon: 'codicon-symbol-method' },
                { id: 'python', label: 'Python', icon: 'codicon-symbol-class' },
                { id: 'go', label: 'Go', icon: 'codicon-symbol-interface' },
                { id: 'csharp', label: 'C#', icon: 'codicon-symbol-namespace' }
              ].map((lang) => (
                <button
                  key={lang.id}
                  onClick={() => setSelectedLanguage(lang.id as any)}
                  className={`flex items-center gap-2 px-4 py-3 rounded-md text-[13px] transition-all ${
                    selectedLanguage === lang.id
                      ? 'bg-[var(--cursor-accent)]/20 text-[var(--cursor-accent)] border border-[var(--cursor-accent)]'
                      : 'bg-[#2a2a2a] text-[#858585] hover:bg-[#333333] border border-transparent'
                  }`}
                >
                  <i className={`codicon ${lang.icon}`} style={{ fontSize: 14 }} />
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {/* Files Info */}
          {terraformFiles.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[12px] text-[#cccccc] font-medium">
                Converting:
              </div>
              <div className="p-2 bg-[#2a2a2a] rounded text-[12px] text-[#858585] font-mono">
                {terraformFiles[0]}
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-[#858585]">
              No Terraform file selected
            </div>
          )}

          {/* Status */}
          {conversionStatus && (
            <div className="flex items-center gap-2 p-3 bg-[#2a2a2a] rounded-md text-[12px] text-[#cccccc]">
              {isConverting && (
                <i className="codicon codicon-loading codicon-modifier-spin" style={{ fontSize: 14 }} />
              )}
              <span>{conversionStatus}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-md text-[12px] text-red-400">
              <i className="codicon codicon-error" style={{ fontSize: 14 }} />
              <span>{error}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-4">
            <button
              onClick={handleConvert}
              disabled={isConverting || !selectedRepo}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[var(--cursor-accent)] to-[var(--cursor-blue)] hover:opacity-90 text-white rounded-md text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isConverting ? (
                <>
                  <i className="codicon codicon-loading codicon-modifier-spin" style={{ fontSize: 14 }} />
                  Converting...
                </>
              ) : (
                <>
                  <i className="codicon codicon-arrow-swap" style={{ fontSize: 14 }} />
                  Convert to Pulumi
                </>
              )}
            </button>
            <button
              onClick={onClose}
              disabled={isConverting}
              className="px-4 py-2.5 bg-[#2a2a2a] hover:bg-[#333333] text-[#cccccc] rounded-md text-[13px] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

