'use client'

import { useState, useRef, useEffect } from 'react'
import { X, Upload, FileText, AlertCircle, CheckCircle, Loader2, ChevronDown, ChevronUp, Copy, GitBranch } from 'lucide-react'
import { useAuth } from '@/contexts'
import { useRouter } from 'next/navigation'
import { getApiEndpoint } from '@/utils/apiEndpoint'

interface Repository {
  id: string
  repo_full_name: string
  repo_owner: string
  repo_name: string
}

interface ImportInfraModalProps {
  isOpen: boolean
  onClose: () => void
  onImportComplete?: (resources: any[]) => void
  selectedRepo?: {
    owner: string
    repo: string
  } | null
  teamId?: string
  repositories?: Repository[]
}

export default function ImportInfraModal({ 
  isOpen, 
  onClose, 
  onImportComplete,
  selectedRepo,
  teamId,
  repositories = []
}: ImportInfraModalProps) {
  const { token } = useAuth()
  const router = useRouter()
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [importedResources, setImportedResources] = useState<any[]>([])
  const [showInstructions, setShowInstructions] = useState(true)
  const [activeProvider, setActiveProvider] = useState<'aws' | 'digitalocean'>('aws')
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [showRepoSelector, setShowRepoSelector] = useState(false)
  const [selectedRepoForGeneration, setSelectedRepoForGeneration] = useState<Repository | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load repositories if teamId is provided and repositories prop is empty
  const [loadedRepos, setLoadedRepos] = useState<Repository[]>(repositories)
  
  useEffect(() => {
    if (teamId && loadedRepos.length === 0 && token) {
      fetch(getApiEndpoint(`/teams/${teamId}/repositories`), {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data) && data.length > 0) {
            setLoadedRepos(data)
            setSelectedRepoForGeneration(data[0])
          }
        })
        .catch(console.error)
    } else if (repositories.length > 0 && loadedRepos.length === 0) {
      setLoadedRepos(repositories)
      setSelectedRepoForGeneration(repositories[0])
    }
  }, [teamId, repositories, token, loadedRepos.length])

  if (!isOpen) return null

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0])
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0])
    }
  }

  const handleFile = async (file: File) => {
    if (!token) {
      setErrorMessage('Authentication required')
      setUploadStatus('error')
      return
    }

    setUploading(true)
    setUploadStatus('idle')
    setErrorMessage('')
    setImportedResources([])

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(getApiEndpoint('/aws-import/import/upload'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail?.message || error.error || `Import failed: ${response.status}`)
      }

      const result = await response.json()

      if (result.ok && result.resources) {
        setImportedResources(result.resources)
        setUploadStatus('success')
        
        // Call completion callback
        if (onImportComplete) {
          onImportComplete(result.resources)
        }
      } else {
        throw new Error(result.message || 'Import failed')
      }
    } catch (error: any) {
      console.error('Import error:', error)
      setErrorMessage(error.message || 'Failed to import infrastructure')
      setUploadStatus('error')
    } finally {
      setUploading(false)
    }
  }

  const handleGenerateClick = () => {
    const availableRepos = loadedRepos.length > 0 ? loadedRepos : repositories
    
    if (availableRepos.length === 0) {
      setErrorMessage('No repositories available. Please add a repository to your team first.')
      return
    }
    
    if (availableRepos.length === 1) {
      // Only one repo, skip selector
      setSelectedRepoForGeneration(availableRepos[0])
      setShowConfirmDialog(true)
    } else {
      // Multiple repos, show selector
      setShowRepoSelector(true)
    }
  }

  const handleConfirmGenerate = async () => {
    if (!selectedRepoForGeneration || !token || importedResources.length === 0) return

    setShowConfirmDialog(false)
    setShowRepoSelector(false)

    try {
      // Build the prompt with imported resources
      const resourceSummary = importedResources
        .map(r => `${r.resource_type} named ${r.name}`)
        .join(', ')

      const prompt = `Generate Terraform code for these imported AWS resources: ${resourceSummary}. Use the following resource definitions: ${JSON.stringify(importedResources, null, 2)}`

      // Store the generation prompt in sessionStorage for the IDE to pick up
      sessionStorage.setItem('import_generation_prompt', prompt)
      sessionStorage.setItem('import_generation_repo', selectedRepoForGeneration.repo_full_name)
      sessionStorage.setItem('import_generation_mode', 'agent')
      
      // Store repo info for IDE to auto-select
      sessionStorage.setItem('import_selected_repo', JSON.stringify({
        full_name: selectedRepoForGeneration.repo_full_name,
        name: selectedRepoForGeneration.repo_name,
        owner: {
          login: selectedRepoForGeneration.repo_owner
        }
      }))
      
      // Close modal
      onClose()
      
      // Navigate to the IDE
      router.push('/ide')
    } catch (error: any) {
      console.error('Generate error:', error)
      setErrorMessage(error.message || 'Failed to start generation')
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-black/95 backdrop-blur-md border border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div>
            <h2 className="text-xl font-semibold text-white">Import Infrastructure</h2>
            <p className="text-sm text-gray-400 mt-1">
              Upload AWS export files (CSV, JSON) to convert to Terraform
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-white/10 text-white/40 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Instructions Section */}
          {uploadStatus !== 'success' && (
            <div className="mb-6">
              <button
                onClick={() => setShowInstructions(!showInstructions)}
                className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-white/70" />
                  <span className="text-white font-medium">How to Export Your Infrastructure</span>
                </div>
                {showInstructions ? (
                  <ChevronUp className="w-5 h-5 text-white/40" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-white/40" />
                )}
              </button>

              {showInstructions && (
                <div className="mt-3 bg-black/50 border border-white/10 rounded-xl p-5 space-y-4">
                  {/* Provider Tabs */}
                  <div className="flex gap-2 border-b border-white/10 pb-3">
                    <button
                      onClick={() => setActiveProvider('aws')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        activeProvider === 'aws'
                          ? 'bg-white text-black'
                          : 'bg-white/5 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      AWS
                    </button>
                    <button
                      onClick={() => setActiveProvider('digitalocean')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        activeProvider === 'digitalocean'
                          ? 'bg-white text-black'
                          : 'bg-white/5 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      DigitalOcean
                    </button>
                  </div>

                  {/* AWS Instructions */}
                  {activeProvider === 'aws' && (
                    <div className="space-y-6">
                      {/* AWS Migration Hub CSV */}
                      <div>
                        <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold">1</span>
                          AWS Migration Hub (CSV Export)
                        </h4>
                        <div className="ml-8 space-y-2 text-sm text-white/70">
                          <div className="flex items-start gap-2">
                            <span className="text-white/40 mt-1">•</span>
                            <span>Go to <strong className="text-white">AWS Migration Hub</strong> in the AWS Console</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-white/40 mt-1">•</span>
                            <span>Navigate to <strong className="text-white">Application Discovery</strong> → <strong className="text-white">Servers</strong></span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-white/40 mt-1">•</span>
                            <span>Click <strong className="text-white">Export</strong> and select <strong className="text-white">CSV</strong></span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-white/40 mt-1">•</span>
                            <span>Download the <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs">Server.csv</code> file</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-white/40 mt-1">•</span>
                            <span>Optionally export <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs">NetworkInterface.csv</code> for network resources</span>
                          </div>
                        </div>
                      </div>

                      {/* AWS CLI JSON */}
                      <div>
                        <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold">2</span>
                          AWS CLI (JSON Export)
                        </h4>
                        <div className="ml-8 space-y-3">
                          <p className="text-sm text-white/70">Install AWS CLI and configure credentials, then run:</p>
                          <div className="bg-black/70 border border-white/10 rounded-lg p-3 font-mono text-xs">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-white/60">EC2 Instances</span>
                              <button
                                onClick={() => navigator.clipboard.writeText('aws ec2 describe-instances > instances.json')}
                                className="text-white/40 hover:text-white/70"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <code className="text-green-400">aws ec2 describe-instances &gt; instances.json</code>
                          </div>
                          <div className="bg-black/70 border border-white/10 rounded-lg p-3 font-mono text-xs">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-white/60">S3 Buckets</span>
                              <button
                                onClick={() => navigator.clipboard.writeText('aws s3api list-buckets > buckets.json')}
                                className="text-white/40 hover:text-white/70"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <code className="text-green-400">aws s3api list-buckets &gt; buckets.json</code>
                          </div>
                          <div className="bg-black/70 border border-white/10 rounded-lg p-3 font-mono text-xs">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-white/60">VPCs & Subnets</span>
                              <button
                                onClick={() => navigator.clipboard.writeText('aws ec2 describe-vpcs > vpcs.json\naws ec2 describe-subnets > subnets.json')}
                                className="text-white/40 hover:text-white/70"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <code className="text-green-400">aws ec2 describe-vpcs &gt; vpcs.json</code>
                            <br />
                            <code className="text-green-400">aws ec2 describe-subnets &gt; subnets.json</code>
                          </div>
                          <div className="bg-black/70 border border-white/10 rounded-lg p-3 font-mono text-xs">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-white/60">RDS Databases</span>
                              <button
                                onClick={() => navigator.clipboard.writeText('aws rds describe-db-instances > rds.json')}
                                className="text-white/40 hover:text-white/70"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <code className="text-green-400">aws rds describe-db-instances &gt; rds.json</code>
                          </div>
                        </div>
                      </div>

                      {/* CloudFormation */}
                      <div>
                        <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold">3</span>
                          CloudFormation Template (Optional)
                        </h4>
                        <div className="ml-8 space-y-2 text-sm text-white/70">
                          <div className="flex items-start gap-2">
                            <span className="text-white/40 mt-1">•</span>
                            <span>If your infrastructure uses CloudFormation, export the template:</span>
                          </div>
                          <div className="bg-black/70 border border-white/10 rounded-lg p-3 font-mono text-xs mt-2">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-white/60">Export Template</span>
                              <button
                                onClick={() => navigator.clipboard.writeText('aws cloudformation get-template --stack-name MyStack --query TemplateBody > template.json')}
                                className="text-white/40 hover:text-white/70"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <code className="text-green-400">aws cloudformation get-template --stack-name MyStack --query TemplateBody &gt; template.json</code>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* DigitalOcean Instructions */}
                  {activeProvider === 'digitalocean' && (
                    <div className="space-y-6">
                      {/* DigitalOcean doctl CLI */}
                      <div>
                        <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold">1</span>
                          DigitalOcean CLI (doctl) - JSON Export
                        </h4>
                        <div className="ml-8 space-y-3">
                          <div className="flex items-start gap-2 mb-2">
                            <span className="text-white/40 mt-1">•</span>
                            <span className="text-sm text-white/70">Install doctl: <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs">brew install doctl</code> (Mac) or <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs">snap install doctl</code> (Linux)</span>
                          </div>
                          <div className="flex items-start gap-2 mb-2">
                            <span className="text-white/40 mt-1">•</span>
                            <span className="text-sm text-white/70">Authenticate: <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs">doctl auth init</code></span>
                          </div>
                          <div className="bg-black/70 border border-white/10 rounded-lg p-3 font-mono text-xs">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-white/60">Droplets</span>
                              <button
                                onClick={() => navigator.clipboard.writeText('doctl compute droplet list --format ID,Name,Region,Size,Image,Status --output json > droplets.json')}
                                className="text-white/40 hover:text-white/70"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <code className="text-green-400">doctl compute droplet list --format ID,Name,Region,Size,Image,Status --output json &gt; droplets.json</code>
                          </div>
                          <div className="bg-black/70 border border-white/10 rounded-lg p-3 font-mono text-xs">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-white/60">Databases</span>
                              <button
                                onClick={() => navigator.clipboard.writeText('doctl databases cluster list --output json > databases.json')}
                                className="text-white/40 hover:text-white/70"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <code className="text-green-400">doctl databases cluster list --output json &gt; databases.json</code>
                          </div>
                          <div className="bg-black/70 border border-white/10 rounded-lg p-3 font-mono text-xs">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-white/60">Kubernetes Clusters</span>
                              <button
                                onClick={() => navigator.clipboard.writeText('doctl kubernetes cluster list --output json > k8s.json')}
                                className="text-white/40 hover:text-white/70"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <code className="text-green-400">doctl kubernetes cluster list --output json &gt; k8s.json</code>
                          </div>
                          <div className="bg-black/70 border border-white/10 rounded-lg p-3 font-mono text-xs">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-white/60">Spaces (S3-compatible)</span>
                              <button
                                onClick={() => navigator.clipboard.writeText('doctl compute cdn list --output json > spaces.json')}
                                className="text-white/40 hover:text-white/70"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <code className="text-green-400">doctl compute cdn list --output json &gt; spaces.json</code>
                          </div>
                          <div className="bg-black/70 border border-white/10 rounded-lg p-3 font-mono text-xs">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-white/60">Load Balancers</span>
                              <button
                                onClick={() => navigator.clipboard.writeText('doctl compute load-balancer list --output json > loadbalancers.json')}
                                className="text-white/40 hover:text-white/70"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <code className="text-green-400">doctl compute load-balancer list --output json &gt; loadbalancers.json</code>
                          </div>
                          <div className="bg-black/70 border border-white/10 rounded-lg p-3 font-mono text-xs">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-white/60">VPCs</span>
                              <button
                                onClick={() => navigator.clipboard.writeText('doctl compute vpc list --output json > vpcs.json')}
                                className="text-white/40 hover:text-white/70"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <code className="text-green-400">doctl compute vpc list --output json &gt; vpcs.json</code>
                          </div>
                        </div>
                      </div>

                      {/* DigitalOcean API */}
                      <div>
                        <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold">2</span>
                          DigitalOcean API (Alternative)
                        </h4>
                        <div className="ml-8 space-y-2 text-sm text-white/70">
                          <div className="flex items-start gap-2">
                            <span className="text-white/40 mt-1">•</span>
                            <span>Get your API token from <strong className="text-white">DigitalOcean Console</strong> → <strong className="text-white">API</strong> → <strong className="text-white">Tokens</strong></span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-white/40 mt-1">•</span>
                            <span>Use curl to export resources:</span>
                          </div>
                          <div className="bg-black/70 border border-white/10 rounded-lg p-3 font-mono text-xs mt-2">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-white/60">Droplets via API</span>
                              <button
                                onClick={() => navigator.clipboard.writeText('curl -X GET "https://api.digitalocean.com/v2/droplets" -H "Authorization: Bearer YOUR_TOKEN" > droplets.json')}
                                className="text-white/40 hover:text-white/70"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <code className="text-green-400">curl -X GET &quot;https://api.digitalocean.com/v2/droplets&quot; -H &quot;Authorization: Bearer YOUR_TOKEN&quot; &gt; droplets.json</code>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="pt-4 border-t border-white/10 mt-4">
                    <p className="text-xs text-white/50">
                      💡 <strong className="text-white/70">Tip:</strong> Once you have your CSV or JSON files, drag and drop them below or click to browse.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Upload Area */}
          {uploadStatus !== 'success' && (
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
                dragActive
                  ? 'border-purple-500 bg-purple-500/10'
                  : 'border-white/10 hover:border-white/20 hover:bg-white/5'
              } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <Upload className="w-12 h-12 text-white/40 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white/90 mb-2">
                Drop files here or click to browse
              </h3>
              <p className="text-sm text-white/40 mb-4">
                Supports: CSV (AWS Migration Hub), JSON (AWS CLI, CloudFormation, Config)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json,.yaml,.yml"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-4 py-2 bg-white text-black rounded-xl text-sm font-semibold hover:bg-white/90 transition-all duration-200 disabled:opacity-50 shadow-lg"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 inline mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  'Select Files'
                )}
              </button>
            </div>
          )}

          {/* Error Message */}
          {uploadStatus === 'error' && errorMessage && (
            <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-400">Import Failed</p>
                <p className="text-sm text-gray-400 mt-1">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Success Message */}
          {uploadStatus === 'success' && importedResources.length > 0 && (
            <div className="mt-4 space-y-4">
              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-400">Import Successful</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Found {importedResources.length} resources ready to convert to Terraform
                  </p>
                </div>
              </div>

              {/* Resource Preview */}
              <div className="bg-black/50 border border-white/10 rounded-xl p-4 max-h-64 overflow-y-auto">
                <h4 className="text-sm font-medium text-white/90 mb-3">Imported Resources</h4>
                <div className="space-y-2">
                  {importedResources.slice(0, 10).map((resource, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <FileText className="w-4 h-4 text-white/40" />
                      <span className="text-white/70">
                        <span className="text-purple-400">{resource.resource_type}</span>
                        {' '}
                        <span className="text-white/90">{resource.name}</span>
                      </span>
                    </div>
                  ))}
                  {importedResources.length > 10 && (
                    <p className="text-xs text-white/40 mt-2">
                      + {importedResources.length - 10} more resources
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/5">
          {!isGenerating && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
              {uploadStatus === 'success' && importedResources.length > 0 && (
                <button
                  onClick={handleGenerateClick}
                  className="px-4 py-3 bg-white text-black rounded-xl text-sm font-semibold hover:bg-white/90 transition-all duration-200 shadow-lg"
                >
                  Generate Terraform
                </button>
              )}
            </>
          )}
          {isGenerating && (
            <div className="flex items-center gap-3 text-white/70">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">{generationProgress || 'Generating Terraform...'}</span>
              <button
                onClick={() => {
                  setIsGenerating(false)
                  setGenerationProgress('')
                }}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-all"
              >
                Close (still generating)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && selectedRepoForGeneration && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/90 backdrop-blur-sm">
          <div className="bg-black/95 backdrop-blur-md border border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] w-full max-w-md p-6">
            <h3 className="text-xl font-semibold text-white mb-2">Generate Terraform Code?</h3>
            <p className="text-sm text-white/70 mb-4">
              This will generate Terraform code for {importedResources.length} imported resources and add them to:
            </p>
            <div className="bg-white/5 border border-white/10 rounded-lg p-3 mb-6 flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-white/40" />
              <span className="text-white font-mono text-sm">{selectedRepoForGeneration.repo_full_name}</span>
            </div>
            <p className="text-xs text-white/50 mb-6">
              Generation will happen in the background. You can continue working while it processes.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmGenerate}
                className="px-4 py-2 bg-white text-black rounded-xl font-semibold hover:bg-white/90 transition-all"
              >
                Yes, Generate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Repo Selector Dialog */}
      {showRepoSelector && (loadedRepos.length > 0 || repositories.length > 0) && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/90 backdrop-blur-sm">
          <div className="bg-black/95 backdrop-blur-md border border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] w-full max-w-md p-6">
            <h3 className="text-xl font-semibold text-white mb-2">Select Repository</h3>
            <p className="text-sm text-white/70 mb-4">
              Choose where to generate Terraform code for {importedResources.length} imported resources:
            </p>
            <div className="space-y-2 mb-6 max-h-64 overflow-y-auto">
              {(loadedRepos.length > 0 ? loadedRepos : repositories).map((repo) => (
                <button
                  key={repo.id}
                  onClick={() => {
                    setSelectedRepoForGeneration(repo)
                    setShowRepoSelector(false)
                    setShowConfirmDialog(true)
                  }}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    selectedRepoForGeneration?.id === repo.id
                      ? 'bg-white/10 border-white/30'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-white/40" />
                    <span className="text-white font-mono text-sm">{repo.repo_full_name}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowRepoSelector(false)
                  setSelectedRepoForGeneration(null)
                }}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white rounded-xl transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

