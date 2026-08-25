'use client'

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Download, RefreshCw, FileText, CheckCircle } from 'lucide-react'
// @ts-ignore - html2canvas types available via @types/html2canvas (optional)
import html2canvas from 'html2canvas'
// @ts-ignore - jspdf includes types
import jsPDF from 'jspdf'
import { useDocumentationData } from '@/hooks/useInfrastructureData'
import { clearCachedDocumentation, cacheDocumentation } from '@/utils/documentationCache'
import { useRefreshLock } from '@/hooks/useRefreshLock'
import { useAuth } from '@/contexts'

interface DocumentationViewProps {
  selectedRepo?: {
    id: number
    name: string
    full_name: string
    default_branch?: string
  } | null
  onFileClick?: (filePath: string, line?: number) => void
  currentTeamId?: string | null
}

interface ResourceSection {
  type: string
  display_name: string
  icon: string
  count: number
  resources: Array<{
    name: string
    tf_name: string
    file: string
    line?: number
    attributes: Record<string, any>
  }>
}

interface DocumentationData {
  ok: boolean
  repo: string
  branch: string
  summary: {
    total_resources: number
    resource_types: number
    files: number
  }
  sections: ResourceSection[]
  analysis: string
  recommendations: string[]
}

export default function DocumentationView({ selectedRepo, onFileClick, currentTeamId }: DocumentationViewProps) {
  const documentRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const { token } = useAuth()
  const [refreshStatus, setRefreshStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [owner, repo] = selectedRepo?.full_name.split('/') || [null, null]
  const branch = selectedRepo?.default_branch || 'main'

  const { data: docData, isLoading: loading, error, refetch: refetchDoc, isFetching } = useDocumentationData(
    owner,
    repo,
    branch,
    !!selectedRepo
  )

  const errorMessage = error instanceof Error ? error.message : error ? String(error) : null
  const isGenerating = isFetching && !docData // Only show generating if we don't have data yet

  // 24-hour refresh lock (per-repo) - team workspaces get unlimited refreshes
  const lockKey = owner && repo ? `documentation_${owner}_${repo}_${branch}` : 'documentation'
  const { isLocked, timeRemainingFormatted, lockRefresh } = useRefreshLock(lockKey, !!currentTeamId)

  const handleRefresh = async () => {
    if (!selectedRepo || !owner || !repo || isRefreshing || isLocked) return
    
    console.log('🔄 [Documentation] Refresh triggered - fetching fresh documentation from network...')
    setIsRefreshing(true)
    
    // Clear all caches (TanStack Query, localStorage, and file system)
    queryClient.removeQueries({ 
      queryKey: ['documentation', owner, repo, branch]
    })
    
    // Clear persistent cache (localStorage + file system)
    await clearCachedDocumentation(owner, repo, branch)
    console.log('🔄 [Documentation] Cleared all caches for fresh fetch')
    
    // Use fetchQuery directly to bypass all cache and force network request
    // This ensures we get fresh data from the server, not cached data
    try {
      const freshData = await queryClient.fetchQuery({
        queryKey: ['documentation', owner, repo, branch],
        queryFn: async () => {
          if (!owner || !repo || !token) {
            throw new Error('Missing required parameters')
          }

          console.log('📄 [Documentation] 🔄 Forced refresh - fetching from network (bypassing all cache)')

          // Create the documentation request directly (bypassing in-progress check for forced refresh)
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 240000) // 4 minutes

          const { getApiEndpoint } = await import('@/utils/apiEndpoint')
          const response = await fetch(getApiEndpoint(`/documentation/generate/${owner}/${repo}?branch=${branch}`), {
            headers: {
              'Authorization': `Bearer ${token}`
            },
            signal: controller.signal
          })

          clearTimeout(timeoutId)

          if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            if (response.status === 504) {
              throw new Error('Documentation generation timed out. This may be due to platform limits. Try again or contact support.')
            }
            throw new Error(error.detail || error.error || `Failed to generate documentation: ${response.status}`)
          }

          const result = await response.json()
          
          // Cache successful result to persistent storage
          await cacheDocumentation(owner, repo, branch, result)
          
          return result
        },
        staleTime: 0, // Force fresh fetch
      })
      
      // Lock only after successful fetch
      if (freshData) {
        lockRefresh()
        setRefreshStatus('success')
        console.log('✅ [Documentation] Refresh completed with fresh data, button locked for 24 hours')
        setTimeout(() => setRefreshStatus('idle'), 2000)
      }
    } catch (error: any) {
      console.error('❌ [Documentation] Refresh failed:', error)
      setRefreshStatus('error')
      setTimeout(() => setRefreshStatus('idle'), 3000)
      // Don't lock if refresh failed
    } finally {
      setIsRefreshing(false)
    }
  }

  // Clean up markdown formatting if data exists
  if (docData?.analysis) {
    docData.analysis = docData.analysis
      .replace(/^##\s+/gm, '')  // Remove ## headers
      .replace(/^#\s+/gm, '')    // Remove # headers
  }

  const handleExportPDF = async () => {
    if (!docData || !documentRef.current) return
    
    try {
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      let yPos = 15
      
      // Title
      pdf.setFontSize(20)
      pdf.setFont('helvetica', 'bold')
      pdf.text(`${selectedRepo?.name}`, 15, yPos)
      yPos += 8
      
      pdf.setFontSize(12)
      pdf.setFont('helvetica', 'normal')
      pdf.text('Infrastructure Documentation', 15, yPos)
      yPos += 10
      
      // Summary
      pdf.setFontSize(14)
      pdf.setFont('helvetica', 'bold')
      pdf.text('Summary', 15, yPos)
      yPos += 7
      
      pdf.setFontSize(10)
      pdf.setFont('helvetica', 'normal')
      pdf.text(`Total Resources: ${docData.summary.total_resources}`, 15, yPos)
      yPos += 5
      pdf.text(`Resource Types: ${docData.summary.resource_types}`, 15, yPos)
      yPos += 5
      pdf.text(`Files: ${docData.summary.files}`, 15, yPos)
      yPos += 12
      
      // Analysis
      pdf.setFontSize(14)
      pdf.setFont('helvetica', 'bold')
      pdf.text('Architecture Analysis', 15, yPos)
      yPos += 7
      
      pdf.setFontSize(9)
      pdf.setFont('helvetica', 'normal')
      const analysisLines = pdf.splitTextToSize(docData.analysis, pageWidth - 30)
      pdf.text(analysisLines, 15, yPos)
      yPos += analysisLines.length * 4 + 10
      
      // Check if need new page
      if (yPos > pageHeight - 40) {
        pdf.addPage()
        yPos = 15
      }
      
      // Recommendations
      pdf.setFontSize(14)
      pdf.setFont('helvetica', 'bold')
      pdf.text('Recommendations', 15, yPos)
      yPos += 7
      
      pdf.setFontSize(9)
      pdf.setFont('helvetica', 'normal')
      docData.recommendations.forEach((rec, idx) => {
        if (yPos > pageHeight - 20) {
          pdf.addPage()
          yPos = 15
        }
        const recText = `${idx + 1}. ${rec}`
        const recLines = pdf.splitTextToSize(recText, pageWidth - 30)
        pdf.text(recLines, 15, yPos)
        yPos += recLines.length * 4 + 3
      })
      
      // Resource Sections - REMOVED (only summary, analysis, and recommendations)
      
      // Save PDF
      pdf.save(`${selectedRepo?.name}-documentation.pdf`)
    } catch (err) {
      console.error('Failed to export PDF:', err)
      alert('Failed to export PDF. Please try again.')
    }
  }

  if (!selectedRepo) {
    return (
      <div className="flex-1 h-full w-full flex items-center justify-center bg-[#181818]">
        <div className="text-center">
          <FileText className="w-12 h-12 text-[#666] mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-[#EDEDED] mb-1">No Repository Selected</h2>
          <p className="text-[#888] text-sm">Select a repository to generate documentation</p>
        </div>
      </div>
    )
  }

  if ((loading && !docData) || isRefreshing) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#181818] h-full">
        <div className="text-center max-w-md">
          <div className="mb-12 relative" style={{ width: '120px', height: '120px', margin: '0 auto' }}>
            <div className="absolute inset-0" style={{ 
              animation: 'logoPulse 2s ease-in-out infinite'
            }}>
              <img
                src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg"
                alt="Logo"
                width={120}
                height={120}
                draggable={false}
              />
            </div>
            {/* Purple sparks */}
            <div className="absolute top-0 left-1/2 w-1 h-1 bg-purple-500 rounded-full opacity-0 animate-pulse" style={{ 
              transform: 'translate(-50%, 0)',
              boxShadow: '0 0 8px #a855f7',
              animation: 'spark1 2s ease-in-out infinite'
            }} />
            <div className="absolute top-1/4 right-0 w-1 h-1 bg-purple-500 rounded-full opacity-0" style={{ 
              boxShadow: '0 0 8px #a855f7',
              animation: 'spark2 2s ease-in-out infinite 0.33s'
            }} />
            <div className="absolute bottom-1/4 right-0 w-1 h-1 bg-purple-500 rounded-full opacity-0" style={{ 
              boxShadow: '0 0 8px #a855f7',
              animation: 'spark3 2s ease-in-out infinite 0.66s'
            }} />
            <div className="absolute bottom-0 left-1/2 w-1 h-1 bg-purple-500 rounded-full opacity-0" style={{ 
              transform: 'translate(-50%, 0)',
              boxShadow: '0 0 8px #a855f7',
              animation: 'spark4 2s ease-in-out infinite 1s'
            }} />
            <div className="absolute bottom-1/4 left-0 w-1 h-1 bg-purple-500 rounded-full opacity-0" style={{ 
              boxShadow: '0 0 8px #a855f7',
              animation: 'spark5 2s ease-in-out infinite 1.33s'
            }} />
            <div className="absolute top-1/4 left-0 w-1 h-1 bg-purple-500 rounded-full opacity-0" style={{ 
              boxShadow: '0 0 8px #a855f7',
              animation: 'spark6 2s ease-in-out infinite 1.66s'
            }} />
          </div>
          <h2 className="text-xl font-semibold text-[#EDEDED] mb-3" style={{ fontWeight: 600 }}>
            {isRefreshing ? 'Refreshing Documentation' : 'Generating Professional Documentation'}
          </h2>
          <p className="text-[#888] text-sm mb-2">
            {isRefreshing 
              ? 'Fetching the latest documentation from the server...'
              : 'Analyzing your infrastructure and generating comprehensive documentation...'
            }
          </p>
          <p className="text-[#666] text-xs">
            This may take 30-60 seconds depending on repository size
          </p>
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes logoPulse {
              0% { filter: drop-shadow(0 0 10px rgba(168, 85, 247, 0.5)); opacity: 0.8; }
              50% { filter: drop-shadow(0 0 25px rgba(168, 85, 247, 0.9)); opacity: 1; }
              100% { filter: drop-shadow(0 0 10px rgba(168, 85, 247, 0.5)); opacity: 0.8; }
            }
            @keyframes spark1 {
              0%, 100% { opacity: 0; transform: translate(-50%, 0) scale(0); }
              50% { opacity: 1; transform: translate(-50%, -20px) scale(1); }
            }
            @keyframes spark2 {
              0%, 100% { opacity: 0; transform: translate(0, 0) scale(0); }
              50% { opacity: 1; transform: translate(20px, -10px) scale(1); }
            }
            @keyframes spark3 {
              0%, 100% { opacity: 0; transform: translate(0, 0) scale(0); }
              50% { opacity: 1; transform: translate(20px, 10px) scale(1); }
            }
            @keyframes spark4 {
              0%, 100% { opacity: 0; transform: translate(-50%, 0) scale(0); }
              50% { opacity: 1; transform: translate(-50%, 20px) scale(1); }
            }
            @keyframes spark5 {
              0%, 100% { opacity: 0; transform: translate(0, 0) scale(0); }
              50% { opacity: 1; transform: translate(-20px, 10px) scale(1); }
            }
            @keyframes spark6 {
              0%, 100% { opacity: 0; transform: translate(0, 0) scale(0); }
              50% { opacity: 1; transform: translate(-20px, -10px) scale(1); }
            }
          `}} />
        </div>
      </div>
    )
  }

  if (errorMessage) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#181818]">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-[#F85149] mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-[#EDEDED] mb-2">Error Loading Documentation</h2>
          <p className="text-[#888] text-sm mb-4">{errorMessage}</p>
          <button
            onClick={handleRefresh}
            disabled={isLocked}
            className="px-4 py-2 bg-[#EDEDED] text-[#0A0A0A] rounded-md hover:bg-white transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            title={isLocked ? `Refresh locked. Available in ${timeRemainingFormatted}` : undefined}
          >
            {isLocked ? `Locked (${timeRemainingFormatted})` : 'Retry'}
          </button>
        </div>
      </div>
    )
  }

  if (!docData) {
    return null
  }

  return (
    <div 
      className="h-full w-full flex flex-col bg-[#181818]"
      style={{ fontFamily: 'var(--font-sans)' }}
    >
      {/* Header */}
      <div className="flex-shrink-0 border-b border-[#1a1a1a] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-[#EDEDED] flex items-center gap-2" style={{ fontWeight: 600 }}>
              Infrastructure Documentation
              {isRefreshing && (
                <span className="flex items-center gap-1.5 text-[10px] text-[#A78BFA] font-normal">
                  <RefreshCw size={12} className="animate-spin" />
                  <span>Updating...</span>
                </span>
              )}
            </h1>
            <p className="text-xs text-[#888] mt-0.5">
              {selectedRepo.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={!!isRefreshing || isLocked}
              className={`flex items-center gap-2 px-3 py-2 border rounded-md transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                refreshStatus === 'success'
                  ? 'bg-green-500/20 border-green-500/50 text-green-400'
                  : refreshStatus === 'error'
                  ? 'bg-red-500/20 border-red-500/50 text-red-400'
                  : 'bg-[#1F1F1F] border-[#2a2a2a] text-[#EDEDED] hover:border-[#3a3a3a]'
              }`}
              title={isLocked ? `Refresh locked. Available in ${timeRemainingFormatted}` : undefined}
            >
              {refreshStatus === 'success' ? (
                <>
                  <CheckCircle size={16} />
                  <span>Updated!</span>
                </>
              ) : refreshStatus === 'error' ? (
                <>
                  <AlertCircle size={16} />
                  <span>Failed</span>
                </>
              ) : isRefreshing ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Updating...</span>
                </>
              ) : isLocked ? (
                <>
                  <RefreshCw size={16} />
                  <span>{timeRemainingFormatted ? `Locked (${timeRemainingFormatted})` : 'Locked'}</span>
                </>
              ) : (
                <>
                  <RefreshCw size={16} />
                  <span>Refresh</span>
                </>
              )}
            </button>
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-2 px-3 py-2 bg-[#EDEDED] text-[#0A0A0A] rounded-md hover:bg-white transition-colors text-sm font-medium"
            >
              <Download size={16} />
              Export PDF
            </button>
          </div>
        </div>
      </div>

      {/* Documentation Content - Scrollable */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ minHeight: 0 }}>
        <div ref={documentRef} className="p-6 max-w-5xl mx-auto pb-12">
          {/* Summary Card */}
          <div className="bg-[#1F1F1F] border border-[#2a2a2a] rounded-lg p-6 mb-6">
            <h2 className="text-base font-semibold text-[#EDEDED] mb-4" style={{ fontWeight: 600 }}>
              Summary
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-2xl font-bold text-[#EDEDED]">{docData.summary.total_resources}</div>
                <div className="text-xs text-[#888]">Total Resources</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-[#EDEDED]">{docData.summary.resource_types}</div>
                <div className="text-xs text-[#888]">Resource Types</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-[#EDEDED]">{docData.summary.files}</div>
                <div className="text-xs text-[#888]">Terraform Files</div>
              </div>
            </div>
          </div>

          {/* Architecture Analysis */}
          <div className="bg-[#1F1F1F] border border-[#2a2a2a] rounded-lg p-6 mb-6">
            <h2 className="text-base font-semibold text-[#EDEDED] mb-3" style={{ fontWeight: 600 }}>
              Architecture Analysis
            </h2>
            <div 
              className="text-sm text-[#EDEDED] leading-relaxed whitespace-pre-wrap"
              dangerouslySetInnerHTML={{
                __html: docData.analysis
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Convert **bold** to <strong>
                  .replace(/\n/g, '<br>') // Preserve line breaks
              }}
            />
          </div>

          {/* Recommendations */}
          <div className="bg-[#1F1F1F] border border-[#2a2a2a] rounded-lg p-6 mb-6">
            <h2 className="text-base font-semibold text-[#EDEDED] mb-4" style={{ fontWeight: 600 }}>
              Recommendations
            </h2>
            <ul className="space-y-3">
              {docData.recommendations.map((rec, idx) => (
                <li key={idx} className="flex gap-3 text-sm text-[#EDEDED]">
                  <span className="text-[#888] flex-shrink-0">{idx + 1}.</span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Resource Sections - REMOVED */}
          {/* Keeping only Summary, Analysis, and Recommendations */}
          {false && docData?.sections?.map((section, idx) => (
            <div key={idx} className="bg-[#1F1F1F] border border-[#2a2a2a] rounded-lg p-6 mb-6">
              <h2 className="text-base font-semibold text-[#EDEDED] mb-4 flex items-center gap-2" style={{ fontWeight: 600 }}>
                <span>{section.icon}</span>
                <span>{section.display_name}</span>
                <span className="text-xs text-[#666] font-normal">({section.count})</span>
              </h2>
              <div className="space-y-3">
                {section.resources.map((resource, resIdx) => (
                  <div 
                    key={resIdx}
                    onClick={() => onFileClick && onFileClick(resource.file, resource.line)}
                    className="p-3 bg-[#141414] border border-[#2a2a2a] rounded hover:border-[#3a3a3a] transition-colors cursor-pointer group"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-sm font-medium text-[#EDEDED] mb-1 group-hover:text-white transition-colors">
                          {resource.name}
                        </h3>
                        <div className="flex items-center gap-2 text-xs text-[#666]">
                          <i className="codicon codicon-file-code" style={{ fontSize: 12 }} />
                          <span>{resource.file}</span>
                          {resource.line && <span>:{resource.line}</span>}
                        </div>
                        {Object.keys(resource.attributes).length > 0 && (
                          <div className="mt-2 pt-2 border-t border-[#2a2a2a]">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                              {Object.entries(resource.attributes).slice(0, 4).map(([key, value]) => (
                                <div key={key} className="text-xs">
                                  <span className="text-[#666]">{key}:</span>{' '}
                                  <span className="text-[#888]">{String(value).slice(0, 50)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <i className="codicon codicon-link-external text-[#666] group-hover:text-[#EDEDED] transition-colors" style={{ fontSize: 14 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

