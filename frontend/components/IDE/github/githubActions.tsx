import { useState } from 'react'
import { GitBranch, X, Code, Check, Lock, Shield, DollarSign, Download, Copy, Settings } from 'lucide-react'
import { GITHUB_ACTIONS_TEMPLATES } from '../utils/models'
type ActionTemplateKey = keyof typeof GITHUB_ACTIONS_TEMPLATES

// GitHub Actions Modal - Standalone popup
export default function GitHubActionsModal({ 
  selectedRepo, 
  onClose,
  onRefreshFileTree
}: { 
  selectedRepo: { id: number; name: string; full_name: string }
  onClose: () => void
  onRefreshFileTree?: () => void
}) {
  const [selectedActions, setSelectedActions] = useState<Set<ActionTemplateKey>>(new Set())
  const [generatedYaml, setGeneratedYaml] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const toggleAction = (actionKey: ActionTemplateKey) => {
    setSelectedActions(prev => {
      const newSet = new Set(prev)
      if (newSet.has(actionKey)) {
        newSet.delete(actionKey)
      } else {
        newSet.add(actionKey)
      }
      return newSet
    })
    setGeneratedYaml(null)
  }

  const generateCombinedYaml = () => {
    if (selectedActions.size === 0) return
    
    if (selectedActions.size === 1) {
      const actionKey = Array.from(selectedActions)[0]
      const template = GITHUB_ACTIONS_TEMPLATES[actionKey]
      setGeneratedYaml(template.template)
      return
    }
    
    let combined = `# Create separate workflow files in .github/workflows/\n# Example: ${Array.from(selectedActions).map(k => `${k}.yml`).join(', ')}\n\n`
    
    for (const actionKey of Array.from(selectedActions)) {
      const template = GITHUB_ACTIONS_TEMPLATES[actionKey]
      combined += `# === ${actionKey}.yml ===\n${template.template}\n\n`
    }
    
    setGeneratedYaml(combined)
  }

  const writeWorkflowFile = async () => {
    if (!generatedYaml || !selectedRepo) return
    
    const electronAPI = (window as any).electronAPI
    if (!electronAPI?.createFile) {
      alert('This feature is only available in the desktop app. Copy the YAML and create the file manually.')
      return
    }
    
    setIsSaving(true)
    
    try {
      const [owner, repo] = selectedRepo.full_name.split('/')
      
      const filename = selectedActions.size === 1 
        ? `${Array.from(selectedActions)[0]}.yml`
        : 'workflow.yml'
      
      // Use createFile which handles directory creation and git add automatically
      const filePath = `.github/workflows/${filename}`
      
      console.log(`📝 Creating workflow file: ${filePath}`)
      
      const result = await electronAPI.createFile(owner, repo, filePath, generatedYaml)
      
      if (result?.success) {
        console.log(`✅ Workflow file created and staged: ${filePath}`)
        
        // Refresh file tree to show the new file (yellow/staged)
        if (onRefreshFileTree) {
          setTimeout(() => {
            onRefreshFileTree()
          }, 100)
        }
        
        onClose()
      } else {
        console.error('Failed to create file:', result?.error)
        alert(`Failed to create file: ${result?.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Failed to write workflow file:', error)
      alert('Failed to create file. Copy the YAML and create it manually.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex items-center justify-center p-6">
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/15 rounded-full blur-[128px]" />
      </div>
      
      <div className="relative bg-[#0d0d0d]/90 backdrop-blur-xl border border-white/10 rounded-2xl max-w-5xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl shadow-purple-500/10">
        {/* Header with gradient */}
        <div className="relative p-5 border-b border-white/10">
          <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 via-transparent to-blue-500/10" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-purple-500/30 blur-xl rounded-xl" />
                <div className="relative p-3 bg-gradient-to-br from-purple-500/30 to-purple-600/20 rounded-xl border border-purple-500/30">
                  <GitBranch className="w-6 h-6 text-purple-400" />
                </div>
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">GitHub Actions</h2>
                <p className="text-sm text-white/40 font-mono">{selectedRepo.full_name}</p>
              </div>
            </div>
            <button 
              onClick={onClose} 
              className="p-2.5 hover:bg-white/10 rounded-xl transition-all duration-200 group"
            >
              <X className="w-5 h-5 text-white/40 group-hover:text-white transition-colors" />
            </button>
          </div>
        </div>
        
        {/* Body */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left - Templates */}
          <div className="w-1/2 border-r border-white/5 overflow-y-auto p-5">
            <div className="space-y-6">
              {/* Terraform */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-purple-400/80 mb-3 flex items-center gap-2">
                  <Code className="w-4 h-4" />
                  Terraform Workflows
                </h3>
                <div className="space-y-2">
                  {Object.entries(GITHUB_ACTIONS_TEMPLATES)
                    .filter(([_, t]) => t.category === 'terraform')
                    .map(([key, template]) => (
                      <button
                        key={key}
                        onClick={() => toggleAction(key as ActionTemplateKey)}
                        className={`group w-full p-4 rounded-xl border text-left transition-all duration-200 ${
                          selectedActions.has(key as ActionTemplateKey)
                            ? 'bg-purple-500/15 border-purple-500/40 shadow-lg shadow-purple-500/10'
                            : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05] hover:border-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-white">{template.name}</span>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                            selectedActions.has(key as ActionTemplateKey)
                              ? 'bg-purple-500 border-purple-500'
                              : 'border-white/20 group-hover:border-white/40'
                          }`}>
                            {selectedActions.has(key as ActionTemplateKey) && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </div>
                        <p className="text-xs text-white/40 mt-1.5 leading-relaxed">{template.description}</p>
                        {key.includes('oidc') && (
                          <span className="inline-flex items-center gap-1 mt-2.5 px-2 py-1 bg-emerald-500/15 text-emerald-400 text-[10px] font-medium rounded-md border border-emerald-500/20">
                            <Lock className="w-3 h-3" />
                            OIDC - No secrets needed
                          </span>
                        )}
                      </button>
                    ))}
                </div>
              </div>
              
              {/* Security */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400/80 mb-3 flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Security & Quality
                </h3>
                <div className="space-y-2">
                  {Object.entries(GITHUB_ACTIONS_TEMPLATES)
                    .filter(([_, t]) => t.category === 'security' || t.category === 'docs')
                    .map(([key, template]) => (
                      <button
                        key={key}
                        onClick={() => toggleAction(key as ActionTemplateKey)}
                        className={`group w-full p-4 rounded-xl border text-left transition-all duration-200 ${
                          selectedActions.has(key as ActionTemplateKey)
                            ? 'bg-emerald-500/15 border-emerald-500/40 shadow-lg shadow-emerald-500/10'
                            : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05] hover:border-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-white">{template.name}</span>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                            selectedActions.has(key as ActionTemplateKey)
                              ? 'bg-emerald-500 border-emerald-500'
                              : 'border-white/20 group-hover:border-white/40'
                          }`}>
                            {selectedActions.has(key as ActionTemplateKey) && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </div>
                        <p className="text-xs text-white/40 mt-1.5 leading-relaxed">{template.description}</p>
                      </button>
                    ))}
                </div>
              </div>
              
              {/* Cost */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400/80 mb-3 flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  Cost Management
                </h3>
                <div className="space-y-2">
                  {Object.entries(GITHUB_ACTIONS_TEMPLATES)
                    .filter(([_, t]) => t.category === 'cost')
                    .map(([key, template]) => (
                      <button
                        key={key}
                        onClick={() => toggleAction(key as ActionTemplateKey)}
                        className={`group w-full p-4 rounded-xl border text-left transition-all duration-200 ${
                          selectedActions.has(key as ActionTemplateKey)
                            ? 'bg-amber-500/15 border-amber-500/40 shadow-lg shadow-amber-500/10'
                            : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05] hover:border-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-white">{template.name}</span>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                            selectedActions.has(key as ActionTemplateKey)
                              ? 'bg-amber-500 border-amber-500'
                              : 'border-white/20 group-hover:border-white/40'
                          }`}>
                            {selectedActions.has(key as ActionTemplateKey) && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </div>
                        <p className="text-xs text-white/40 mt-1.5 leading-relaxed">{template.description}</p>
                      </button>
                    ))}
                </div>
              </div>
            </div>
          </div>
          
          {/* Right - Preview */}
          <div className="w-1/2 flex flex-col bg-black/20">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${selectedActions.size > 0 ? 'bg-purple-500 animate-pulse' : 'bg-white/20'}`} />
                <span className="text-sm text-white/60 font-medium">{selectedActions.size} workflow{selectedActions.size !== 1 ? 's' : ''} selected</span>
              </div>
              <button
                onClick={generateCombinedYaml}
                disabled={selectedActions.size === 0}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                  selectedActions.size > 0
                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white shadow-lg shadow-purple-500/25'
                    : 'bg-white/5 text-white/30 cursor-not-allowed'
                }`}
              >
                Generate YAML
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-4">
              {generatedYaml ? (
                <div className="relative group">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(generatedYaml)
                    }}
                    className="absolute top-3 right-3 p-2 bg-white/10 hover:bg-white/20 rounded-lg opacity-0 group-hover:opacity-100 transition-all z-10"
                    title="Copy"
                  >
                    <Copy className="w-4 h-4 text-white/70" />
                  </button>
                  <pre className="text-[11px] text-emerald-300/80 font-mono whitespace-pre-wrap bg-black/40 p-4 rounded-xl border border-white/5 leading-relaxed">
                    {generatedYaml}
                  </pre>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="relative mb-4">
                    <div className="absolute inset-0 bg-white/5 blur-2xl rounded-full" />
                    <div className="relative p-6 rounded-2xl bg-white/[0.02] border border-white/5">
                      <Settings className="w-10 h-10 text-white/20" />
                    </div>
                  </div>
                  <p className="text-sm text-white/40 font-medium">Select workflows to generate YAML</p>
                  <p className="text-xs text-white/20 mt-1">Click on templates from the left panel</p>
                </div>
              )}
            </div>
            
            {generatedYaml && (
              <div className="p-4 border-t border-white/5 flex gap-3">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generatedYaml)
                  }}
                  className="flex-1 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-sm text-white font-medium flex items-center justify-center gap-2 transition-all"
                >
                  <Copy className="w-4 h-4" />
                  Copy to Clipboard
                </button>
                <button
                  onClick={writeWorkflowFile}
                  disabled={isSaving}
                  className={`flex-1 px-4 py-2.5 rounded-xl text-sm text-white font-semibold flex items-center justify-center gap-2 transition-all ${
                    isSaving 
                      ? 'bg-purple-500/30 cursor-not-allowed' 
                      : 'bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 shadow-lg shadow-purple-500/25'
                  }`}
                >
                  {isSaving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Save to Repo
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
        
        {/* Setup Instructions */}
        {generatedYaml && (
          <div className="p-5 bg-gradient-to-r from-white/[0.02] to-transparent border-t border-white/5 max-h-[220px] overflow-y-auto">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white/60 mb-4 flex items-center gap-2">
              <Lock className="w-4 h-4 text-blue-400" />
              Setup Instructions
            </h4>
            
            {/* AWS OIDC Instructions */}
            {selectedActions.has('terraform-oidc-aws') && (
              <div className="mb-4 p-4 bg-gradient-to-r from-orange-500/10 to-transparent border border-orange-500/20 rounded-xl">
                <p className="text-sm font-semibold text-orange-400 mb-3 flex items-center gap-2">
                  <span className="w-6 h-6 bg-orange-500/20 rounded-lg flex items-center justify-center text-xs">🔐</span>
                  AWS OIDC Setup
                </p>
                <ol className="text-xs text-white/50 space-y-2 list-decimal list-inside leading-relaxed">
                  <li>Go to AWS IAM → Identity providers → Add provider</li>
                  <li>Select OpenID Connect, URL: <code className="px-1.5 py-0.5 bg-orange-500/20 text-orange-300 rounded">token.actions.githubusercontent.com</code></li>
                  <li>Audience: <code className="px-1.5 py-0.5 bg-orange-500/20 text-orange-300 rounded">sts.amazonaws.com</code></li>
                  <li>Create an IAM Role with trust policy for GitHub Actions</li>
                  <li>Add GitHub Variables: <code className="px-1.5 py-0.5 bg-orange-500/20 text-orange-300 rounded">AWS_ROLE_ARN</code>, <code className="px-1.5 py-0.5 bg-orange-500/20 text-orange-300 rounded">AWS_REGION</code></li>
                </ol>
                <a href="https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 mt-3 transition-colors">
                  📖 Full AWS OIDC Guide →
                </a>
              </div>
            )}
            
            {/* Azure OIDC Instructions */}
            {selectedActions.has('terraform-oidc-azure') && (
              <div className="mb-4 p-4 bg-gradient-to-r from-cyan-500/10 to-transparent border border-cyan-500/20 rounded-xl">
                <p className="text-sm font-semibold text-cyan-400 mb-3 flex items-center gap-2">
                  <span className="w-6 h-6 bg-cyan-500/20 rounded-lg flex items-center justify-center text-xs">☁️</span>
                  Azure OIDC Setup
                </p>
                <ol className="text-xs text-white/50 space-y-2 list-decimal list-inside leading-relaxed">
                  <li>Go to Azure AD → App registrations → New registration</li>
                  <li>Add Federated credential for GitHub Actions</li>
                  <li>Set Organization, Repository, and Entity type (Branch/PR)</li>
                  <li>Assign required Azure roles to the app</li>
                  <li>Add GitHub Variables: <code className="px-1.5 py-0.5 bg-cyan-500/20 text-cyan-300 rounded">AZURE_CLIENT_ID</code>, <code className="px-1.5 py-0.5 bg-cyan-500/20 text-cyan-300 rounded">AZURE_TENANT_ID</code>, <code className="px-1.5 py-0.5 bg-cyan-500/20 text-cyan-300 rounded">AZURE_SUBSCRIPTION_ID</code></li>
                </ol>
                <a href="https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-azure" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 mt-3 transition-colors">
                  📖 Full Azure OIDC Guide →
                </a>
              </div>
            )}
            
            {/* DigitalOcean Instructions */}
            {selectedActions.has('terraform-digitalocean') && (
              <div className="mb-4 p-4 bg-gradient-to-r from-blue-500/10 to-transparent border border-blue-500/20 rounded-xl">
                <p className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
                  <span className="w-6 h-6 bg-blue-500/20 rounded-lg flex items-center justify-center text-xs">🌊</span>
                  DigitalOcean Setup
                </p>
                <ol className="text-xs text-white/50 space-y-2 list-decimal list-inside leading-relaxed">
                  <li>Go to DigitalOcean → API → Generate New Token</li>
                  <li>Give it a name and select Read + Write scopes</li>
                  <li>Copy the token (you won't see it again!)</li>
                  <li>In GitHub: Settings → Secrets → Actions → New secret</li>
                  <li>Name: <code className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded">DIGITALOCEAN_TOKEN</code>, paste your token</li>
                </ol>
                <div className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-start gap-2">
                  <span className="text-emerald-400 text-sm">✨</span>
                  <p className="text-xs text-emerald-400 leading-relaxed">
                    <strong>Smart Duplicate Detection:</strong> This workflow automatically checks for existing VPCs/Droplets and finds available CIDRs to prevent conflicts!
                  </p>
                </div>
                <a href="https://docs.digitalocean.com/reference/api/create-personal-access-token/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-3 transition-colors">
                  📖 DigitalOcean API Token Guide →
                </a>
              </div>
            )}
            
            {/* Generic instructions for non-OIDC */}
            {!selectedActions.has('terraform-oidc-aws') && 
             !selectedActions.has('terraform-oidc-azure') && 
             !selectedActions.has('terraform-digitalocean') && (
              <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl">
                <p className="text-sm text-white/60 flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  No additional setup required. Just commit and push the workflow file!
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}