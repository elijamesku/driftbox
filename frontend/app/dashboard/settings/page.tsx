'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useGitHub } from '@/contexts/GitHubContext'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import { 
  User, 
  Key, 
  Bell, 
  Shield, 
  Palette, 
  CreditCard,
  Github,
  Check,
  ExternalLink,
  Cloud,
  Loader2,
  X,
  Copy,
  ChevronRight,
  AlertCircle,
  CheckCircle2
} from 'lucide-react'

// DigitalOcean Setup Modal Component
function DOSetupModal({ 
  isOpen, 
  onClose, 
  onProceed,
  isConnecting 
}: { 
  isOpen: boolean
  onClose: () => void
  onProceed: () => void
  isConnecting: boolean
}) {
  const [currentStep, setCurrentStep] = useState(1)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  
  if (!isOpen) return null
  
  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }
  
  // Get the current environment's URLs
  const isProduction = typeof window !== 'undefined' && !window.location.hostname.includes('localhost')
  const backendUrl = isProduction 
    ? 'https://your-backend.com'  // Replace with actual production URL
    : 'http://localhost:8000'
  const frontendUrl = isProduction 
    ? window.location.origin 
    : 'http://localhost:3000'
  
  const callbackUrl = `${backendUrl}/auth/digitalocean/callback`
  
  const steps = [
    {
      number: 1,
      title: 'Create OAuth Application',
      content: (
        <div className="space-y-4">
          <p className="text-sm text-[#a1a1a1]">
            First, create a new OAuth application in your DigitalOcean account:
          </p>
          <a
            href="https://cloud.digitalocean.com/account/api/applications/new"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-4 rounded-lg bg-[#0080FF]/10 border border-[#0080FF]/20 hover:bg-[#0080FF]/15 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Cloud className="h-5 w-5 text-[#0080FF]" />
              <span className="text-sm font-medium text-[#fafafa]">Open DigitalOcean API Console</span>
            </div>
            <ExternalLink className="h-4 w-4 text-[#0080FF]" />
          </a>
          <p className="text-xs text-[#666666]">
            Click the link above to open the DigitalOcean API settings in a new tab.
          </p>
        </div>
      )
    },
    {
      number: 2,
      title: 'Configure Application',
      content: (
        <div className="space-y-4">
          <p className="text-sm text-[#a1a1a1]">
            Fill in these details when creating your OAuth application:
          </p>
          
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <label className="text-xs text-[#666666] block mb-1">Application Name</label>
              <div className="flex items-center justify-between">
                <code className="text-sm text-[#fafafa]">Driftbox Infrastructure</code>
                <button
                  onClick={() => copyToClipboard('Driftbox Infrastructure', 'name')}
                  className="p-1 rounded hover:bg-[#1f1f1f] transition-colors"
                >
                  {copiedField === 'name' ? (
                    <CheckCircle2 className="h-4 w-4 text-[#22c55e]" />
                  ) : (
                    <Copy className="h-4 w-4 text-[#666666]" />
                  )}
                </button>
              </div>
            </div>
            
            <div className="p-3 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <label className="text-xs text-[#666666] block mb-1">Homepage URL</label>
              <div className="flex items-center justify-between">
                <code className="text-sm text-[#fafafa] break-all">{frontendUrl}</code>
                <button
                  onClick={() => copyToClipboard(frontendUrl, 'homepage')}
                  className="p-1 rounded hover:bg-[#1f1f1f] transition-colors flex-shrink-0 ml-2"
                >
                  {copiedField === 'homepage' ? (
                    <CheckCircle2 className="h-4 w-4 text-[#22c55e]" />
                  ) : (
                    <Copy className="h-4 w-4 text-[#666666]" />
                  )}
                </button>
              </div>
            </div>
            
            <div className="p-3 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <label className="text-xs text-[#666666] block mb-1">Callback URL (Important!)</label>
              <div className="flex items-center justify-between">
                <code className="text-sm text-[#0080FF] break-all">{callbackUrl}</code>
                <button
                  onClick={() => copyToClipboard(callbackUrl, 'callback')}
                  className="p-1 rounded hover:bg-[#1f1f1f] transition-colors flex-shrink-0 ml-2"
                >
                  {copiedField === 'callback' ? (
                    <CheckCircle2 className="h-4 w-4 text-[#22c55e]" />
                  ) : (
                    <Copy className="h-4 w-4 text-[#666666]" />
                  )}
                </button>
              </div>
            </div>
          </div>
          
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[#eab308]/10 border border-[#eab308]/20">
            <AlertCircle className="h-4 w-4 text-[#eab308] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-[#eab308]">
              Make sure the Callback URL matches exactly, including the protocol (http/https).
            </p>
          </div>
        </div>
      )
    },
    {
      number: 3,
      title: 'Add Credentials to Backend',
      content: (
        <div className="space-y-4">
          <p className="text-sm text-[#a1a1a1]">
            After creating the app, copy the Client ID and Client Secret. Add them to your backend environment:
          </p>
          
          <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f] font-mono text-xs">
            <div className="text-[#666666]"># Add to your backend .env file</div>
            <div className="mt-2">
              <span className="text-[#22c55e]">DIGITALOCEAN_CLIENT_ID</span>
              <span className="text-[#666666]">=</span>
              <span className="text-[#f97316]">your_client_id_here</span>
            </div>
            <div>
              <span className="text-[#22c55e]">DIGITALOCEAN_CLIENT_SECRET</span>
              <span className="text-[#666666]">=</span>
              <span className="text-[#f97316]">your_client_secret_here</span>
            </div>
            <div>
              <span className="text-[#22c55e]">DIGITALOCEAN_REDIRECT_URI</span>
              <span className="text-[#666666]">=</span>
              <span className="text-[#f97316]">{callbackUrl}</span>
            </div>
          </div>
          
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[#3b82f6]/10 border border-[#3b82f6]/20">
            <AlertCircle className="h-4 w-4 text-[#3b82f6] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-[#3b82f6]">
              After adding the environment variables, restart your backend server for the changes to take effect.
            </p>
          </div>
        </div>
      )
    },
    {
      number: 4,
      title: 'Connect Your Account',
      content: (
        <div className="space-y-4">
          <p className="text-sm text-[#a1a1a1]">
            Once the backend is configured, click the button below to authorize Driftbox with your DigitalOcean account.
          </p>
          
          <div className="p-4 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/20">
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle2 className="h-5 w-5 text-[#22c55e]" />
              <span className="text-sm font-medium text-[#fafafa]">What you&apos;ll get access to:</span>
            </div>
            <ul className="text-xs text-[#a1a1a1] space-y-1 ml-8">
              <li>• Real-time Droplet monitoring</li>
              <li>• Database cluster management</li>
              <li>• Kubernetes cluster insights</li>
              <li>• Cost estimation & tracking</li>
              <li>• Security scanning for your infrastructure</li>
            </ul>
          </div>
          
          <button
            onClick={onProceed}
            disabled={isConnecting}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#0080FF] px-4 py-3 text-sm font-medium text-white hover:bg-[#0066CC] transition-colors disabled:opacity-50"
          >
            {isConnecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting to DigitalOcean...
              </>
            ) : (
              <>
                <Cloud className="h-4 w-4" />
                Connect DigitalOcean Account
              </>
            )}
          </button>
        </div>
      )
    }
  ]
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-[#0f0f0f] border border-[#1f1f1f] rounded-xl shadow-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f1f1f]">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[#0080FF]/10 p-2">
              <Cloud className="h-5 w-5 text-[#0080FF]" />
            </div>
            <div>
              <h2 className="font-semibold text-[#fafafa]">Connect DigitalOcean</h2>
              <p className="text-xs text-[#666666]">Step {currentStep} of {steps.length}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#1f1f1f] transition-colors"
          >
            <X className="h-5 w-5 text-[#666666]" />
          </button>
        </div>
        
        {/* Progress Bar */}
        <div className="px-6 py-3 border-b border-[#1f1f1f]">
          <div className="flex items-center gap-2">
            {steps.map((step, idx) => (
              <div key={step.number} className="flex items-center flex-1">
                <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium transition-colors ${
                  currentStep >= step.number 
                    ? 'bg-[#0080FF] text-white' 
                    : 'bg-[#1f1f1f] text-[#666666]'
                }`}>
                  {currentStep > step.number ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    step.number
                  )}
                </div>
                {idx < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 transition-colors ${
                    currentStep > step.number ? 'bg-[#0080FF]' : 'bg-[#1f1f1f]'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>
        
        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[50vh]">
          <h3 className="font-medium text-[#fafafa] mb-4">
            {steps[currentStep - 1].title}
          </h3>
          {steps[currentStep - 1].content}
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#1f1f1f] bg-[#0a0a0a]">
          <button
            onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
            disabled={currentStep === 1}
            className="px-4 py-2 text-sm text-[#a1a1a1] hover:text-[#fafafa] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Back
          </button>
          
          {currentStep < steps.length ? (
            <button
              onClick={() => setCurrentStep(currentStep + 1)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1f1f1f] text-sm text-[#fafafa] hover:bg-[#2a2a2a] transition-colors"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-[#666666] hover:text-[#fafafa] transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { user, logout, refreshUser } = useAuth()
  const { githubToken } = useGitHub()
  const [activeTab, setActiveTab] = useState('account')
  const [doConnecting, setDoConnecting] = useState(false)
  const [doDisconnecting, setDoDisconnecting] = useState(false)
  const [doError, setDoError] = useState<string | null>(null)
  const [showDoSetupModal, setShowDoSetupModal] = useState(false)
  
  // Check if DigitalOcean is connected
  const isDoConnected = user?.digitalocean_connected || false
  
  // Handle URL hash for tab navigation
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace('#', '')
      if (hash && ['account', 'integrations', 'notifications', 'security', 'appearance', 'billing'].includes(hash)) {
        setActiveTab(hash)
      }
    }
  }, [])
  
  const handleConnectDigitalOcean = async () => {
    setDoConnecting(true)
    setDoError(null)
    
    try {
      const response = await fetch(getApiEndpoint('/auth/digitalocean'))
      const data = await response.json()
      
      if (data.redirect_url) {
        // Redirect to DigitalOcean OAuth
        window.location.href = data.redirect_url
      } else {
        setDoError('DigitalOcean OAuth not configured. Please follow the setup instructions.')
        setShowDoSetupModal(true)
      }
    } catch (err: any) {
      setDoError('DigitalOcean OAuth not configured. Please follow the setup instructions.')
      setShowDoSetupModal(true)
    } finally {
      setDoConnecting(false)
    }
  }
  
  const handleDisconnectDigitalOcean = async () => {
    setDoDisconnecting(true)
    setDoError(null)
    
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(getApiEndpoint('/auth/digitalocean/disconnect'), {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      if (!response.ok) {
        throw new Error('Failed to disconnect')
      }
      
      // Refresh user data
      localStorage.removeItem('digitalocean_connected')
      localStorage.removeItem('digitalocean_id')
      if (refreshUser) {
        await refreshUser()
      }
      window.location.reload()
    } catch (err: any) {
      setDoError(err.message || 'Failed to disconnect DigitalOcean')
    } finally {
      setDoDisconnecting(false)
    }
  }

  const tabs = [
    { id: 'account', icon: User, label: 'Account' },
    { id: 'integrations', icon: Key, label: 'Integrations' },
    { id: 'notifications', icon: Bell, label: 'Notifications' },
    { id: 'security', icon: Shield, label: 'Security' },
    { id: 'appearance', icon: Palette, label: 'Appearance' },
    { id: 'billing', icon: CreditCard, label: 'Billing' },
  ]

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-[#fafafa]">Settings</h1>
          <p className="mt-1 text-sm text-[#666666]">
            Manage your account and preferences
          </p>
        </div>

        <div className="flex gap-8">
          {/* Sidebar */}
          <div className="w-48 flex-shrink-0">
            <nav className="space-y-1">
              {tabs.map((tab) => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                      activeTab === tab.id
                        ? 'bg-[#14b8a6]/10 text-[#14b8a6]'
                        : 'text-[#a1a1a1] hover:bg-[#141414] hover:text-[#fafafa]'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                )
              })}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1">
            {activeTab === 'account' && (
              <div className="rounded-lg border border-[#1f1f1f] bg-[#0f0f0f]">
                <div className="border-b border-[#1f1f1f] px-6 py-4">
                  <h2 className="font-medium text-[#fafafa]">Account Settings</h2>
                </div>
                <div className="p-6 space-y-6">
                  <div>
                    <label className="block text-sm text-[#666666] mb-2">Email</label>
                    <input
                      type="email"
                      value={user?.email || ''}
                      disabled
                      className="w-full rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 text-sm text-[#a1a1a1]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#666666] mb-2">GitHub Username</label>
                    <input
                      type="text"
                      value={user?.github_username || ''}
                      disabled
                      className="w-full rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 text-sm text-[#a1a1a1]"
                    />
                  </div>
                  <div className="pt-4 border-t border-[#1f1f1f]">
                    <button
                      onClick={() => logout()}
                      className="rounded-md border border-[#ef4444]/30 px-4 py-2 text-sm text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
                    >
                      Sign out
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'integrations' && (
              <div className="rounded-lg border border-[#1f1f1f] bg-[#0f0f0f]">
                <div className="border-b border-[#1f1f1f] px-6 py-4">
                  <h2 className="font-medium text-[#fafafa]">Integrations</h2>
                  <p className="text-xs text-[#666666] mt-1">Connect your cloud providers and version control</p>
                </div>
                <div className="p-6 space-y-4">
                  {/* GitHub Integration */}
                  <div className="flex items-center justify-between p-4 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
                    <div className="flex items-center gap-4">
                      <div className="rounded-lg bg-[#1a1a1a] p-2">
                        <Github className="h-5 w-5 text-[#fafafa]" />
                      </div>
                      <div>
                        <p className="font-medium text-[#fafafa]">GitHub</p>
                        <p className="text-xs text-[#666666]">
                          {githubToken ? `Connected as ${user?.github_username || 'user'}` : 'Not connected'}
                        </p>
                      </div>
                    </div>
                    {githubToken ? (
                      <span className="flex items-center gap-1 text-sm text-[#22c55e]">
                        <Check className="h-4 w-4" />
                        Connected
                      </span>
                    ) : (
                      <button className="rounded-md bg-[#14b8a6] px-3 py-1.5 text-sm text-white hover:bg-[#0d9488] transition-colors">
                        Connect
                      </button>
                    )}
                  </div>
                  
                  {/* DigitalOcean Integration */}
                  <div className="p-4 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="rounded-lg bg-[#0080FF]/10 p-2">
                          <Cloud className="h-5 w-5 text-[#0080FF]" />
                        </div>
                        <div>
                          <p className="font-medium text-[#fafafa]">DigitalOcean</p>
                          <p className="text-xs text-[#666666]">
                            {isDoConnected 
                              ? 'Connected - Access your droplets, databases & more' 
                              : 'Connect to manage your DigitalOcean infrastructure'}
                          </p>
                        </div>
                      </div>
                      {isDoConnected ? (
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1 text-sm text-[#22c55e]">
                            <Check className="h-4 w-4" />
                            Connected
                          </span>
                          <button 
                            onClick={handleDisconnectDigitalOcean}
                            disabled={doDisconnecting}
                            className="rounded-md border border-[#ef4444]/30 px-3 py-1.5 text-sm text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors disabled:opacity-50"
                          >
                            {doDisconnecting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'Disconnect'
                            )}
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => setShowDoSetupModal(true)}
                          className="rounded-md bg-[#0080FF] px-3 py-1.5 text-sm text-white hover:bg-[#0066CC] transition-colors flex items-center gap-2"
                        >
                          Connect
                        </button>
                      )}
                    </div>
                    
                    {/* Quick info when not connected */}
                    {!isDoConnected && (
                      <div className="mt-4 pt-4 border-t border-[#1f1f1f]">
                        <p className="text-xs text-[#666666] mb-2">What you can do with DigitalOcean connected:</p>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            'Monitor Droplets',
                            'Track Databases',
                            'View Kubernetes',
                            'Estimate Costs',
                            'Security Scans',
                            'Drift Detection'
                          ].map((feature) => (
                            <div key={feature} className="flex items-center gap-1.5 text-xs text-[#a1a1a1]">
                              <CheckCircle2 className="h-3 w-3 text-[#0080FF]" />
                              {feature}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* DigitalOcean Setup Modal */}
                  <DOSetupModal
                    isOpen={showDoSetupModal}
                    onClose={() => setShowDoSetupModal(false)}
                    onProceed={handleConnectDigitalOcean}
                    isConnecting={doConnecting}
                  />
                  
                  {doError && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/20 text-sm text-[#ef4444]">
                      <X className="h-4 w-4" />
                      {doError}
                    </div>
                  )}
                  
                  {/* AWS Integration (Coming Soon) */}
                  <div className="flex items-center justify-between p-4 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] opacity-60">
                    <div className="flex items-center gap-4">
                      <div className="rounded-lg bg-[#FF9900]/10 p-2">
                        <Cloud className="h-5 w-5 text-[#FF9900]" />
                      </div>
                      <div>
                        <p className="font-medium text-[#fafafa]">AWS</p>
                        <p className="text-xs text-[#666666]">
                          Coming soon - Connect your AWS account
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-[#666666] bg-[#1a1a1a] px-2 py-1 rounded">
                      Coming Soon
                    </span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="rounded-lg border border-[#1f1f1f] bg-[#0f0f0f]">
                <div className="border-b border-[#1f1f1f] px-6 py-4">
                  <h2 className="font-medium text-[#fafafa]">Notification Preferences</h2>
                </div>
                <div className="p-6 space-y-4">
                  {[
                    { label: 'Email notifications', desc: 'Receive email when changes are approved' },
                    { label: 'Drift alerts', desc: 'Get notified when drift is detected' },
                    { label: 'Cost alerts', desc: 'Alert when spending exceeds budget' },
                    { label: 'Team activity', desc: 'Updates when team members make changes' },
                  ].map((item, index) => (
                    <div key={index} className="flex items-center justify-between py-3 border-b border-[#1f1f1f] last:border-0">
                      <div>
                        <p className="text-sm font-medium text-[#fafafa]">{item.label}</p>
                        <p className="text-xs text-[#666666]">{item.desc}</p>
                      </div>
                      <button className="w-10 h-5 rounded-full bg-[#14b8a6] relative transition-colors">
                        <div className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-white" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="rounded-lg border border-[#1f1f1f] bg-[#0f0f0f]">
                <div className="border-b border-[#1f1f1f] px-6 py-4">
                  <h2 className="font-medium text-[#fafafa]">Security</h2>
                </div>
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between py-3 border-b border-[#1f1f1f]">
                    <div>
                      <p className="text-sm font-medium text-[#fafafa]">Two-factor authentication</p>
                      <p className="text-xs text-[#666666]">Add an extra layer of security</p>
                    </div>
                    <button className="rounded-md border border-[#1f1f1f] px-3 py-1.5 text-sm text-[#a1a1a1] hover:bg-[#141414] transition-colors">
                      Enable
                    </button>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-[#fafafa]">Active sessions</p>
                      <p className="text-xs text-[#666666]">Manage your logged in devices</p>
                    </div>
                    <button className="rounded-md border border-[#1f1f1f] px-3 py-1.5 text-sm text-[#a1a1a1] hover:bg-[#141414] transition-colors">
                      View
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="rounded-lg border border-[#1f1f1f] bg-[#0f0f0f]">
                <div className="border-b border-[#1f1f1f] px-6 py-4">
                  <h2 className="font-medium text-[#fafafa]">Appearance</h2>
                </div>
                <div className="p-6">
                  <p className="text-sm text-[#666666] mb-4">Theme</p>
                  <div className="grid grid-cols-3 gap-4">
                    <button className="p-4 rounded-lg border-2 border-[#14b8a6] bg-[#0a0a0a] text-center">
                      <div className="text-sm font-medium text-[#fafafa]">Dark</div>
                      <div className="text-xs text-[#666666]">Default</div>
                    </button>
                    <button className="p-4 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] text-center opacity-50">
                      <div className="text-sm font-medium text-[#fafafa]">Light</div>
                      <div className="text-xs text-[#666666]">Coming soon</div>
                    </button>
                    <button className="p-4 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] text-center opacity-50">
                      <div className="text-sm font-medium text-[#fafafa]">System</div>
                      <div className="text-xs text-[#666666]">Coming soon</div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'billing' && (
              <div className="rounded-lg border border-[#1f1f1f] bg-[#0f0f0f]">
                <div className="border-b border-[#1f1f1f] px-6 py-4">
                  <h2 className="font-medium text-[#fafafa]">Billing</h2>
                </div>
                <div className="p-6">
                  <div className="rounded-lg border border-[#14b8a6]/20 bg-[#14b8a6]/5 p-4 mb-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-[#fafafa]">Free Plan</p>
                        <p className="text-xs text-[#666666] mt-1">You are currently on the free plan</p>
                      </div>
                      <button className="rounded-md bg-[#14b8a6] px-4 py-2 text-sm font-medium text-white hover:bg-[#0d9488] transition-colors">
                        Upgrade
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#666666]">Repositories</span>
                      <span className="text-[#fafafa]">Unlimited</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#666666]">Team members</span>
                      <span className="text-[#fafafa]">Up to 3</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#666666]">Sandbox runs</span>
                      <span className="text-[#fafafa]">50/month</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

