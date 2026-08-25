'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import { 
  Shield, Plus, AlertTriangle, CheckCircle, Search, Filter,
  ChevronRight, Clock, TrendingUp, TrendingDown, Activity,
  FileText, Settings, Eye, Edit2, Trash2, Copy, MoreHorizontal,
  XCircle, AlertCircle, Info, Zap, Lock, Globe, Server,
  Database, Cloud, Code, GitBranch, RefreshCw, X,
  ChevronUp, ChevronDown, Play, Pause, BarChart3, Target,
  Loader2, Users
} from 'lucide-react'

interface Policy {
  id: string
  name: string
  description: string
  status: 'active' | 'inactive' | 'draft'
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
  violations: number
  last_checked: string | null
  created_at: string
  scope: string[]
  auto_remediate: boolean
  enforcement: 'block' | 'warn' | 'audit'
  rego_code?: string
  conditions?: Record<string, any>
}

interface Violation {
  id: string
  policy_id: string
  policy_name: string
  resource: string
  resource_type: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  timestamp: string
  status: 'open' | 'resolved' | 'suppressed'
  details: string
}

interface PoliciesResponse {
  policies: Policy[]
  total: number
  active: number
  violations_count: number
  compliance_rate: number
}

interface ViolationsResponse {
  violations: Violation[]
  total: number
  open: number
  resolved: number
  suppressed: number
}

// Fetch user's teams
interface Team {
  id: string
  name: string
}

async function fetchUserTeams(token: string): Promise<Team[]> {
  const response = await fetch(getApiEndpoint('/teams/'), {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!response.ok) return []
  const data = await response.json()
  const list = Array.isArray(data) ? data : (data.teams || [])
  return list.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }))
}

// API helper functions
async function fetchPolicies(token: string, params?: { category?: string; status?: string; search?: string; team_id?: string }): Promise<PoliciesResponse> {
  const searchParams = new URLSearchParams()
  if (params?.category && params.category !== 'all') searchParams.set('category', params.category)
  if (params?.status && params.status !== 'all') searchParams.set('status', params.status)
  if (params?.search) searchParams.set('search', params.search)
  if (params?.team_id) searchParams.set('team_id', params.team_id)
  
  const url = getApiEndpoint(`/policies/policies${searchParams.toString() ? '?' + searchParams.toString() : ''}`)
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  if (!response.ok) throw new Error('Failed to fetch policies')
  return response.json()
}

async function fetchViolations(token: string): Promise<ViolationsResponse> {
  const url = getApiEndpoint('/policies/violations')
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  if (!response.ok) throw new Error('Failed to fetch violations')
  return response.json()
}

async function togglePolicy(token: string, policyId: string): Promise<{ success: boolean; new_status: string }> {
  const url = getApiEndpoint(`/policies/policies/${policyId}/toggle`)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  })
  if (!response.ok) throw new Error('Failed to toggle policy')
  return response.json()
}

async function resolveViolation(token: string, violationId: string): Promise<{ success: boolean }> {
  const url = getApiEndpoint(`/policies/violations/${violationId}/resolve`)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  })
  if (!response.ok) throw new Error('Failed to resolve violation')
  return response.json()
}

interface CreatePolicyData {
  name: string
  description: string
  category: string
  severity: string
  enforcement: string
  scope: string[]
  auto_remediate: boolean
  team_id?: string  // If provided, create as team policy; otherwise personal
}

async function createPolicy(token: string, data: CreatePolicyData): Promise<Policy> {
  const url = getApiEndpoint('/policies/policies')
  const response = await fetch(url, {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  })
  if (!response.ok) throw new Error('Failed to create policy')
  return response.json()
}

async function deletePolicy(token: string, policyId: string): Promise<{ success: boolean }> {
  const url = getApiEndpoint(`/policies/policies/${policyId}`)
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  })
  if (!response.ok) throw new Error('Failed to delete policy')
  return response.json()
}

// Pre-built policy templates library
interface PolicyTemplate {
  id: string
  name: string
  description: string
  category: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  enforcement: 'block' | 'warn' | 'audit'
  scope: string[]
  auto_remediate: boolean
  tags: string[]
  popular?: boolean
}

const POLICY_LIBRARY: PolicyTemplate[] = [
  // Security - Critical (DigitalOcean)
  {
    id: 'tpl-1',
    name: 'No Public Spaces Buckets',
    description: 'Prevent DigitalOcean Spaces from being publicly accessible',
    category: 'Security',
    severity: 'critical',
    enforcement: 'block',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['SOC2', 'HIPAA', 'PCI-DSS'],
    popular: true,
  },
  {
    id: 'tpl-2',
    name: 'No Wide Open Firewall Rules',
    description: 'Block firewall rules allowing 0.0.0.0/0 on sensitive ports (22, 3389, 3306, 5432)',
    category: 'Security',
    severity: 'critical',
    enforcement: 'block',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['SOC2', 'CIS'],
    popular: true,
  },
  {
    id: 'tpl-3',
    name: 'No Hardcoded Secrets',
    description: 'Detect hardcoded passwords, API keys, and secrets in Terraform',
    category: 'Security',
    severity: 'critical',
    enforcement: 'block',
    scope: ['all'],
    auto_remediate: false,
    tags: ['SOC2', 'OWASP'],
    popular: true,
  },
  {
    id: 'tpl-4',
    name: 'Database Public Access Disabled',
    description: 'DigitalOcean database clusters must not be publicly accessible',
    category: 'Security',
    severity: 'critical',
    enforcement: 'block',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['SOC2', 'HIPAA'],
    popular: true,
  },
  {
    id: 'tpl-5',
    name: 'Droplet SSH Key Required',
    description: 'All Droplets must have SSH keys configured (no password auth)',
    category: 'Security',
    severity: 'high',
    enforcement: 'block',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['SOC2', 'CIS'],
  },
  {
    id: 'tpl-6',
    name: 'Firewall Required for Droplets',
    description: 'All Droplets must be protected by a firewall',
    category: 'Security',
    severity: 'high',
    enforcement: 'warn',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['SOC2', 'Best Practice'],
  },
  {
    id: 'tpl-7',
    name: 'No Default Firewall Rules',
    description: 'Firewalls must have explicit rules, not default allow-all',
    category: 'Security',
    severity: 'medium',
    enforcement: 'warn',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['CIS', 'Best Practice'],
  },
  {
    id: 'tpl-8',
    name: 'VPC Required for Production',
    description: 'Production resources must be deployed in VPCs, not default network',
    category: 'Security',
    severity: 'medium',
    enforcement: 'warn',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['CIS', 'Best Practice'],
  },
  // Cost (DigitalOcean)
  {
    id: 'tpl-9',
    name: 'Cost Threshold Alert',
    description: 'Alert when estimated monthly cost exceeds threshold',
    category: 'Cost',
    severity: 'medium',
    enforcement: 'warn',
    scope: ['all'],
    auto_remediate: false,
    tags: ['FinOps'],
    popular: true,
  },
  {
    id: 'tpl-10',
    name: 'Droplet Size Limits (Dev)',
    description: 'Limit Droplet sizes in dev/staging to prevent cost overruns (max s-2vcpu-4gb)',
    category: 'Cost',
    severity: 'medium',
    enforcement: 'block',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['FinOps'],
    popular: true,
  },
  {
    id: 'tpl-11',
    name: 'No Premium Droplets in Dev',
    description: 'Block premium Droplet types (CPU-Optimized, Memory-Optimized) in non-prod',
    category: 'Cost',
    severity: 'high',
    enforcement: 'block',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['FinOps'],
  },
  {
    id: 'tpl-12',
    name: 'Volume Size Limit',
    description: 'Limit block storage volume sizes to prevent excessive storage costs',
    category: 'Cost',
    severity: 'low',
    enforcement: 'warn',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['FinOps'],
  },
  {
    id: 'tpl-13',
    name: 'Load Balancer Cost Alert',
    description: 'Alert when multiple load balancers are created (cost optimization)',
    category: 'Cost',
    severity: 'low',
    enforcement: 'warn',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['FinOps'],
  },
  // Governance (All Providers)
  {
    id: 'tpl-14',
    name: 'Required Tags',
    description: 'All resources must have tags: environment, owner, project, cost-center',
    category: 'Governance',
    severity: 'low',
    enforcement: 'audit',
    scope: ['all'],
    auto_remediate: false,
    tags: ['FinOps', 'Best Practice'],
    popular: true,
  },
  {
    id: 'tpl-15',
    name: 'Naming Convention',
    description: 'Resource names must follow organizational naming conventions',
    category: 'Governance',
    severity: 'low',
    enforcement: 'warn',
    scope: ['all'],
    auto_remediate: false,
    tags: ['Best Practice'],
  },
  {
    id: 'tpl-16',
    name: 'Approved Regions Only',
    description: 'Resources can only be deployed in approved DigitalOcean regions',
    category: 'Governance',
    severity: 'high',
    enforcement: 'block',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['Compliance', 'GDPR'],
  },
  {
    id: 'tpl-17',
    name: 'No Unapproved Images',
    description: 'Only approved, hardened images can be used for Droplets',
    category: 'Governance',
    severity: 'medium',
    enforcement: 'block',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['Security', 'CIS'],
  },
  // Network (DigitalOcean)
  {
    id: 'tpl-18',
    name: 'Private Network for Databases',
    description: 'Database clusters must use private networking only',
    category: 'Network',
    severity: 'high',
    enforcement: 'block',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['Security', 'Best Practice'],
  },
  {
    id: 'tpl-19',
    name: 'VPC Required for Multi-Region',
    description: 'Resources spanning multiple regions must use VPCs',
    category: 'Network',
    severity: 'medium',
    enforcement: 'warn',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['Best Practice'],
  },
  // Compliance (DigitalOcean)
  {
    id: 'tpl-20',
    name: 'Backup Retention Policy',
    description: 'All databases must have backup retention of at least 7 days',
    category: 'Compliance',
    severity: 'medium',
    enforcement: 'warn',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['SOC2', 'Best Practice'],
    popular: true,
  },
  {
    id: 'tpl-21',
    name: 'Monitoring Enabled',
    description: 'All Droplets must have monitoring enabled',
    category: 'Compliance',
    severity: 'low',
    enforcement: 'warn',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['SOC2', 'Monitoring'],
  },
  {
    id: 'tpl-22',
    name: 'Kubernetes Cluster Security',
    description: 'K8s clusters must have auto-upgrade and monitoring enabled',
    category: 'Compliance',
    severity: 'high',
    enforcement: 'warn',
    scope: ['digitalocean'],
    auto_remediate: false,
    tags: ['SOC2', 'Best Practice'],
  },
]

// Severity badge component
function SeverityBadge({ severity }: { severity: string }) {
  const config = {
    critical: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
    high: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
    medium: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' },
    low: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  }
  const c = config[severity as keyof typeof config] || config.low
  
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium capitalize ${c.bg} ${c.text} ${c.border}`}>
      {severity}
    </span>
  )
}

// Status badge component  
function StatusBadge({ status }: { status: string }) {
  const config = {
    active: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', icon: Play },
    inactive: { bg: 'bg-gray-500/10', text: 'text-gray-400', icon: Pause },
    draft: { bg: 'bg-purple-500/10', text: 'text-purple-400', icon: Edit2 },
  }
  const c = config[status as keyof typeof config] || config.draft
  const Icon = c.icon
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium capitalize ${c.bg} ${c.text}`}>
      <Icon className="h-3 w-3" />
      {status}
    </span>
  )
}

// Enforcement badge
function EnforcementBadge({ enforcement, isDarkMode }: { enforcement: string; isDarkMode: boolean }) {
  const config = {
    block: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Block' },
    warn: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', label: 'Warn' },
    audit: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Audit Only' },
  }
  const c = config[enforcement as keyof typeof config] || config.audit
  
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  )
}

// Category icon
function getCategoryIcon(category: string) {
  const icons: Record<string, typeof Shield> = {
    'Security': Shield,
    'Cost': BarChart3,
    'Governance': FileText,
    'Network': Globe,
    'Compliance': CheckCircle,
  }
  return icons[category] || Shield
}

// Format relative time
function formatRelativeTime(timestamp: string): string {
  if (!timestamp) return 'Never'
  const now = new Date()
  const date = new Date(timestamp)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

// Policy Library Modal
function PolicyLibraryModal({
  onClose,
  onAddPolicy,
  isDarkMode,
  existingPolicies,
  isAdding,
}: {
  onClose: () => void
  onAddPolicy: (template: PolicyTemplate) => void
  isDarkMode: boolean
  existingPolicies: Policy[]
  isAdding: boolean
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<string>('all')
  
  const existingNames = new Set(existingPolicies.map(p => p.name.toLowerCase()))
  
  const filteredTemplates = POLICY_LIBRARY.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         t.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter
    const matchesTag = tagFilter === 'all' || t.tags.includes(tagFilter)
    return matchesSearch && matchesCategory && matchesTag
  })
  
  const allTags = [...new Set(POLICY_LIBRARY.flatMap(t => t.tags))].sort()
  const categories = [...new Set(POLICY_LIBRARY.map(t => t.category))]
  
  const popularTemplates = POLICY_LIBRARY.filter(t => t.popular)
  
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />
      <div className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl max-h-[85vh] z-50 rounded-xl border shadow-2xl flex flex-col ${isDarkMode ? 'bg-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
        {/* Header */}
        <div className={`px-6 py-4 border-b flex-shrink-0 ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Policy Library</h2>
              <p className={`text-sm mt-1 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                Pre-built policies for security, compliance, and cost management
              </p>
            </div>
            <button onClick={onClose} className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-[#1f1f1f] text-[#666666]' : 'hover:bg-gray-100 text-gray-500'}`}>
              <X className="h-5 w-5" />
            </button>
          </div>
          
          {/* Filters */}
          <div className="flex gap-3 mt-4">
            <div className="flex-1 relative">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
              <input
                type="text"
                placeholder="Search policies..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full pl-9 pr-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f] text-[#fafafa] placeholder-[#666666]' : 'bg-white border-gray-300 text-gray-900'} focus:outline-none focus:border-[#14b8a6]`}
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className={`px-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f] text-[#fafafa]' : 'bg-white border-gray-300 text-gray-900'}`}
            >
              <option value="all">All Categories</option>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className={`px-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f] text-[#fafafa]' : 'bg-white border-gray-300 text-gray-900'}`}
            >
              <option value="all">All Frameworks</option>
              {allTags.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Popular Section */}
          {categoryFilter === 'all' && tagFilter === 'all' && !searchQuery && (
            <div className="mb-6">
              <h3 className={`text-sm font-medium mb-3 flex items-center gap-2 ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-700'}`}>
                <Zap className="h-4 w-4 text-amber-400" />
                Popular Policies
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {popularTemplates.map(template => {
                  const isAdded = existingNames.has(template.name.toLowerCase())
                  return (
                    <div
                      key={template.id}
                      className={`p-4 rounded-xl border transition-all ${
                        isAdded 
                          ? isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f] opacity-60' : 'bg-gray-50 border-gray-200 opacity-60'
                          : isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f] hover:border-[#14b8a6]/50' : 'bg-white border-gray-200 hover:border-[#14b8a6]/50'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className={`text-sm font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{template.name}</h4>
                            <SeverityBadge severity={template.severity} />
                          </div>
                          <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{template.description}</p>
                          <div className="flex gap-1 mt-2">
                            {template.tags.slice(0, 2).map(tag => (
                              <span key={tag} className={`px-1.5 py-0.5 rounded text-[9px] ${isDarkMode ? 'bg-[#1f1f1f] text-[#888888]' : 'bg-gray-100 text-gray-600'}`}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={() => !isAdded && onAddPolicy(template)}
                          disabled={isAdded || isAdding}
                          className={`ml-3 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            isAdded
                              ? isDarkMode ? 'bg-[#1f1f1f] text-[#666666]' : 'bg-gray-100 text-gray-400'
                              : 'bg-[#14b8a6] text-white hover:bg-[#0d9488]'
                          } disabled:cursor-not-allowed`}
                        >
                          {isAdded ? 'Added' : isAdding ? '...' : 'Add'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          
          {/* All Policies */}
          <div>
            <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-700'}`}>
              {searchQuery || categoryFilter !== 'all' || tagFilter !== 'all' ? 'Search Results' : 'All Policies'} ({filteredTemplates.length})
            </h3>
            <div className="space-y-2">
              {filteredTemplates.map(template => {
                const isAdded = existingNames.has(template.name.toLowerCase())
                const CategoryIcon = getCategoryIcon(template.category)
                return (
                  <div
                    key={template.id}
                    className={`p-4 rounded-xl border transition-all ${
                      isAdded 
                        ? isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f] opacity-60' : 'bg-gray-50 border-gray-200 opacity-60'
                        : isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f] hover:border-[#333333]' : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${
                        template.category === 'Security' ? 'bg-red-500/10' :
                        template.category === 'Cost' ? 'bg-amber-500/10' :
                        template.category === 'Governance' ? 'bg-purple-500/10' :
                        template.category === 'Network' ? 'bg-blue-500/10' : 'bg-emerald-500/10'
                      }`}>
                        <CategoryIcon className={`h-4 w-4 ${
                          template.category === 'Security' ? 'text-red-400' :
                          template.category === 'Cost' ? 'text-amber-400' :
                          template.category === 'Governance' ? 'text-purple-400' :
                          template.category === 'Network' ? 'text-blue-400' : 'text-emerald-400'
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h4 className={`text-sm font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{template.name}</h4>
                          <SeverityBadge severity={template.severity} />
                          <span className={`px-1.5 py-0.5 rounded text-[9px] ${
                            template.enforcement === 'block' ? 'bg-red-500/10 text-red-400' :
                            template.enforcement === 'warn' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-blue-500/10 text-blue-400'
                          }`}>
                            {template.enforcement}
                          </span>
                        </div>
                        <p className={`text-xs truncate ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{template.description}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`text-[10px] ${isDarkMode ? 'text-[#555555]' : 'text-gray-400'}`}>
                            {template.scope.includes('all') ? 'All providers' : template.scope.join(', ').toUpperCase()}
                          </span>
                          <span className={`text-[10px] ${isDarkMode ? 'text-[#333333]' : 'text-gray-300'}`}>•</span>
                          <div className="flex gap-1">
                            {template.tags.map(tag => (
                              <span key={tag} className={`px-1.5 py-0.5 rounded text-[9px] ${isDarkMode ? 'bg-[#1f1f1f] text-[#888888]' : 'bg-gray-100 text-gray-600'}`}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => !isAdded && onAddPolicy(template)}
                        disabled={isAdded || isAdding}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                          isAdded
                            ? isDarkMode ? 'bg-[#1f1f1f] text-[#666666]' : 'bg-gray-100 text-gray-400'
                            : 'bg-[#14b8a6] text-white hover:bg-[#0d9488]'
                        } disabled:cursor-not-allowed`}
                      >
                        {isAdded ? (
                          <>
                            <CheckCircle className="h-4 w-4" />
                            Added
                          </>
                        ) : isAdding ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Adding...
                          </>
                        ) : (
                          <>
                            <Plus className="h-4 w-4" />
                            Add Policy
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
              
              {filteredTemplates.length === 0 && (
                <div className={`text-center py-12 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                  <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No policies match your search</p>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div className={`px-6 py-4 border-t flex-shrink-0 ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
          <div className="flex items-center justify-between">
            <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
              {POLICY_LIBRARY.length} policies available • Covers SOC2, HIPAA, PCI-DSS, CIS, and more
            </p>
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isDarkMode ? 'bg-[#1f1f1f] text-[#a1a1a1] hover:bg-[#333333]' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// Create Policy Modal
function CreatePolicyModal({
  onClose,
  onSubmit,
  isDarkMode,
  isLoading,
  selectedTeamId,
}: {
  onClose: () => void
  onSubmit: (data: CreatePolicyData) => void
  isDarkMode: boolean
  isLoading: boolean
  selectedTeamId: string | null
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Security')
  const [severity, setSeverity] = useState('medium')
  const [enforcement, setEnforcement] = useState('warn')
  const [scope, setScope] = useState<string[]>(['digitalocean'])
  const [autoRemediate, setAutoRemediate] = useState(false)
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      category,
      severity,
      enforcement,
      scope,
      auto_remediate: autoRemediate,
      team_id: selectedTeamId || undefined,
    })
  }
  
  const toggleScope = (s: string) => {
    if (s === 'all') {
      setScope(['all'])
    } else {
      const newScope = scope.filter(x => x !== 'all')
      if (newScope.includes(s)) {
        setScope(newScope.filter(x => x !== s))
      } else {
        setScope([...newScope, s])
      }
    }
  }
  
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />
      <div className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg z-50 rounded-xl border shadow-2xl ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
        <div className={`px-6 py-4 border-b ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
          <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Create New Policy</h2>
          <p className={`text-sm mt-1 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Define a governance rule for your infrastructure</p>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-700'}`}>Policy Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., No Public S3 Buckets"
              className={`w-full px-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#0a0a0a] border-[#1f1f1f] text-[#fafafa] placeholder-[#666666]' : 'bg-white border-gray-300 text-gray-900'} focus:outline-none focus:border-[#14b8a6]`}
              required
            />
          </div>
          
          {/* Description */}
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-700'}`}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this policy enforces..."
              rows={2}
              className={`w-full px-3 py-2 rounded-lg border text-sm resize-none ${isDarkMode ? 'bg-[#0a0a0a] border-[#1f1f1f] text-[#fafafa] placeholder-[#666666]' : 'bg-white border-gray-300 text-gray-900'} focus:outline-none focus:border-[#14b8a6]`}
            />
          </div>
          
          {/* Category & Severity Row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-700'}`}>Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={`w-full px-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#0a0a0a] border-[#1f1f1f] text-[#fafafa]' : 'bg-white border-gray-300 text-gray-900'} focus:outline-none focus:border-[#14b8a6]`}
              >
                <option value="Security">Security</option>
                <option value="Cost">Cost</option>
                <option value="Governance">Governance</option>
                <option value="Network">Network</option>
                <option value="Compliance">Compliance</option>
              </select>
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-700'}`}>Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className={`w-full px-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#0a0a0a] border-[#1f1f1f] text-[#fafafa]' : 'bg-white border-gray-300 text-gray-900'} focus:outline-none focus:border-[#14b8a6]`}
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          
          {/* Enforcement */}
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-700'}`}>Enforcement</label>
            <div className="flex gap-2">
              {[
                { value: 'block', label: 'Block', desc: 'Prevent deployment' },
                { value: 'warn', label: 'Warn', desc: 'Allow with warning' },
                { value: 'audit', label: 'Audit', desc: 'Log only' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEnforcement(opt.value)}
                  className={`flex-1 p-3 rounded-lg border text-center transition-all ${
                    enforcement === opt.value
                      ? 'border-[#14b8a6] bg-[#14b8a6]/10'
                      : isDarkMode ? 'border-[#1f1f1f] hover:border-[#333333]' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className={`text-sm font-medium ${enforcement === opt.value ? 'text-[#14b8a6]' : isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{opt.label}</p>
                  <p className={`text-[10px] mt-0.5 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>
          
          {/* Scope */}
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-700'}`}>Scope</label>
            <div className="flex flex-wrap gap-2">
              {['all', 'digitalocean'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleScope(s)}
                  className={`px-3 py-1.5 rounded-lg border text-sm transition-all ${
                    scope.includes(s)
                      ? 'border-[#14b8a6] bg-[#14b8a6]/10 text-[#14b8a6]'
                      : isDarkMode ? 'border-[#1f1f1f] text-[#666666] hover:border-[#333333]' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {s === 'all' ? 'All Providers' : 'DigitalOcean'}
                </button>
              ))}
            </div>
          </div>
          
          {/* Auto Remediate */}
          <div className={`flex items-center justify-between p-3 rounded-lg ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
            <div>
              <p className={`text-sm font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Auto-Remediate</p>
              <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Automatically fix violations when possible</p>
            </div>
            <button
              type="button"
              onClick={() => setAutoRemediate(!autoRemediate)}
              className={`relative w-12 h-6 rounded-full transition-colors ${autoRemediate ? 'bg-[#14b8a6]' : isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${autoRemediate ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
          
          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${isDarkMode ? 'border-[#1f1f1f] text-[#a1a1a1] hover:bg-[#1f1f1f]' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isLoading}
              className="flex-1 px-4 py-2.5 rounded-lg bg-[#14b8a6] text-white text-sm font-medium hover:bg-[#0d9488] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Create Policy
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// Detail Panel Component
function PolicyDetailPanel({
  policy,
  violations,
  onClose,
  isDarkMode,
  onToggle,
  onResolveViolation,
  onDelete,
}: {
  policy: Policy
  violations: Violation[]
  onClose: () => void
  isDarkMode: boolean
  onToggle?: () => void
  onResolveViolation?: (id: string) => void
  onDelete?: () => void
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'violations' | 'history' | 'settings'>('overview')
  const CategoryIcon = getCategoryIcon(policy.category)
  const policyViolations = violations.filter(v => v.policy_id === policy.id)
  
  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/60 z-30" onClick={onClose} />
      
      {/* Navigation */}
      <div className="fixed left-[410px] top-20 z-50 flex flex-col items-center gap-2">
        <button
          onClick={onClose}
          className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all shadow-lg ${
            isDarkMode 
              ? 'border-[#444444] bg-[#1a1a1a] text-[#888888] hover:text-[#fafafa] hover:border-[#14b8a6]'
              : 'border-gray-300 bg-white text-gray-500 hover:text-gray-900 hover:border-[#14b8a6]'
          }`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      
      {/* Panel */}
      <div className={`fixed top-0 right-0 bottom-0 w-[calc(100%-460px)] flex flex-col overflow-hidden z-40 shadow-2xl ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-white'}`}>
        {/* Header */}
        <div className={`px-6 py-5 border-b ${isDarkMode ? 'border-[#1f1f1f] bg-[#0f0f0f]' : 'border-gray-200 bg-gray-50'}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className={`rounded-xl p-3 ${
                policy.severity === 'critical' ? 'bg-red-500/10' :
                policy.severity === 'high' ? 'bg-orange-500/10' :
                policy.severity === 'medium' ? 'bg-yellow-500/10' : 'bg-blue-500/10'
              }`}>
                <CategoryIcon className={`h-6 w-6 ${
                  policy.severity === 'critical' ? 'text-red-400' :
                  policy.severity === 'high' ? 'text-orange-400' :
                  policy.severity === 'medium' ? 'text-yellow-400' : 'text-blue-400'
                }`} />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{policy.name}</h2>
                  <StatusBadge status={policy.status} />
                </div>
                <p className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{policy.description}</p>
                <div className="flex items-center gap-4 mt-3">
                  <SeverityBadge severity={policy.severity} />
                  <EnforcementBadge enforcement={policy.enforcement} isDarkMode={isDarkMode} />
                  <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                    Last checked: {formatRelativeTime(policy.last_checked || '')}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-[#1f1f1f] text-[#666666]' : 'hover:bg-gray-100 text-gray-500'}`}>
                <Edit2 className="h-4 w-4" />
              </button>
              <button className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-[#1f1f1f] text-[#666666]' : 'hover:bg-gray-100 text-gray-500'}`}>
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        
        {/* Tabs */}
        <div className={`flex gap-1 px-6 py-2 border-b ${isDarkMode ? 'border-[#1f1f1f]' : 'border-gray-200'}`}>
          {(['overview', 'violations', 'history', 'settings'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors capitalize ${
                activeTab === tab
                  ? 'bg-[#14b8a6]/10 text-[#14b8a6]'
                  : isDarkMode ? 'text-[#666666] hover:text-[#fafafa]' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {tab}
              {tab === 'violations' && policyViolations.length > 0 && (
                <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] bg-red-500/20 text-red-400">
                  {policyViolations.length}
                </span>
              )}
            </button>
          ))}
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Quick Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                  <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Violations</p>
                  <p className={`text-2xl font-bold ${policy.violations > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {policy.violations}
                  </p>
                </div>
                <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                  <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Resources Scanned</p>
                  <p className={`text-2xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>47</p>
                </div>
                <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                  <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Compliance</p>
                  <p className={`text-2xl font-bold ${policy.violations > 0 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                    {policy.violations > 0 ? '96%' : '100%'}
                  </p>
                </div>
              </div>
              
              {/* Policy Details */}
              <div className={`p-5 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                <h3 className={`text-sm font-medium mb-4 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Policy Configuration</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Category</p>
                    <p className={`text-sm ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{policy.category}</p>
                  </div>
                  <div>
                    <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Enforcement</p>
                    <p className={`text-sm capitalize ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{policy.enforcement}</p>
                  </div>
                  <div>
                    <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Auto-Remediate</p>
                    <p className={`text-sm ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{policy.auto_remediate ? 'Enabled' : 'Disabled'}</p>
                  </div>
                  <div>
                    <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-1`}>Created</p>
                    <p className={`text-sm ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{policy.created_at ? new Date(policy.created_at).toLocaleDateString() : 'Unknown'}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'} mb-2`}>Scope</p>
                  <div className="flex flex-wrap gap-2">
                    {policy.scope.map((s) => (
                      <span key={s} className={`px-2 py-1 rounded text-xs ${isDarkMode ? 'bg-[#1f1f1f] text-[#a1a1a1]' : 'bg-gray-200 text-gray-700'}`}>
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Recent Violations */}
              {policyViolations.length > 0 && (
                <div className={`p-5 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                  <h3 className={`text-sm font-medium mb-4 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Recent Violations</h3>
                  <div className="space-y-3">
                    {policyViolations.slice(0, 3).map((v) => (
                      <div key={v.id} className={`p-3 rounded-lg ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-white'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-sm font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{v.resource}</span>
                          <SeverityBadge severity={v.severity} />
                        </div>
                        <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{v.details}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {activeTab === 'violations' && (
            <div className="space-y-4">
              {policyViolations.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto mb-4" />
                  <p className={`${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>No violations found</p>
                  <p className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>This policy is fully compliant</p>
                </div>
              ) : (
                policyViolations.map((v) => (
                  <div key={v.id} className={`p-4 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-red-500/10">
                          <AlertTriangle className="h-4 w-4 text-red-400" />
                        </div>
                        <div>
                          <p className={`font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{v.resource}</p>
                          <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{v.resource_type}</p>
                        </div>
                      </div>
                      <SeverityBadge severity={v.severity} />
                    </div>
                    <p className={`text-sm mb-3 ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>{v.details}</p>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                        {formatRelativeTime(v.timestamp)}
                      </span>
                      <div className="flex gap-2">
                        <button className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#14b8a6]/10 text-[#14b8a6] hover:bg-[#14b8a6]/20 transition-colors">
                          Remediate
                        </button>
                        <button className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDarkMode ? 'bg-[#1f1f1f] text-[#a1a1a1] hover:bg-[#2f2f2f]' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                          Suppress
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
          
          {activeTab === 'history' && (
            <div className="space-y-4">
              {[
                { action: 'Policy check completed', status: 'success', time: '5 minutes ago', details: '47 resources scanned, 2 violations found' },
                { action: 'Policy check completed', status: 'success', time: '1 hour ago', details: '45 resources scanned, 2 violations found' },
                { action: 'Policy updated', status: 'info', time: '2 days ago', details: 'Severity changed from high to critical' },
                { action: 'Violation resolved', status: 'success', time: '3 days ago', details: 'test-bucket-public remediated' },
                { action: 'Policy created', status: 'info', time: policy.created_at, details: 'Initial policy creation' },
              ].map((event, i) => (
                <div key={i} className={`flex items-start gap-4 p-4 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                  <div className={`p-2 rounded-lg ${
                    event.status === 'success' ? 'bg-emerald-500/10' : 'bg-blue-500/10'
                  }`}>
                    {event.status === 'success' ? (
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Info className="h-4 w-4 text-blue-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className={`font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{event.action}</p>
                    <p className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{event.details}</p>
                  </div>
                  <span className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{event.time}</span>
                </div>
              ))}
            </div>
          )}
          
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <div className={`p-5 rounded-xl ${isDarkMode ? 'bg-[#0f0f0f] border border-[#1f1f1f]' : 'bg-gray-50 border border-gray-200'}`}>
                <h3 className={`text-sm font-medium mb-4 ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Enforcement Settings</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className={`text-sm ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Auto-Remediate</p>
                      <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Automatically fix violations when possible</p>
                    </div>
                    <button className={`relative w-12 h-6 rounded-full transition-colors ${policy.auto_remediate ? 'bg-[#14b8a6]' : isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-300'}`}>
                      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${policy.auto_remediate ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className={`text-sm ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>Block Deployments</p>
                      <p className={`text-xs ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Prevent non-compliant resources from being created</p>
                    </div>
                    <button className={`relative w-12 h-6 rounded-full transition-colors ${policy.enforcement === 'block' ? 'bg-[#14b8a6]' : isDarkMode ? 'bg-[#1f1f1f]' : 'bg-gray-300'}`}>
                      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${policy.enforcement === 'block' ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>
                </div>
              </div>
              
              <div className={`p-5 rounded-xl border border-red-500/20 ${isDarkMode ? 'bg-red-500/5' : 'bg-red-50'}`}>
                <h3 className="text-sm font-medium text-red-400 mb-2">Danger Zone</h3>
                <p className={`text-xs mb-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>These actions are destructive and cannot be undone.</p>
                <button 
                  onClick={() => {
                    if (confirm('Are you sure you want to delete this policy? This action cannot be undone.')) {
                      onDelete?.()
                    }
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  Delete Policy
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default function PoliciesPage() {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  
  // Initialize selectedTeamId from localStorage or IDE context
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem('policies-selected-team-id')
    if (saved) {
      setSelectedTeamId(saved)
    } else {
      try {
        const ideState = sessionStorage.getItem('ide_context_state')
        if (ideState) {
          const parsed = JSON.parse(ideState)
          if (parsed.currentTeamId) setSelectedTeamId(parsed.currentTeamId)
        }
      } catch {}
    }
  }, [])
  
  // Persist team selection
  useEffect(() => {
    if (selectedTeamId) {
      localStorage.setItem('policies-selected-team-id', selectedTeamId)
    } else {
      localStorage.removeItem('policies-selected-team-id')
    }
  }, [selectedTeamId])
  
  // Fetch user's teams
  const { data: teams = [] } = useQuery({
    queryKey: ['user-teams', token],
    queryFn: () => fetchUserTeams(token || ''),
    enabled: !!token,
    staleTime: 60000,
  })
  
  // Validate selectedTeamId is still in user's teams
  useEffect(() => {
    if (selectedTeamId && teams.length > 0) {
      const isStillMember = teams.some(t => t.id === selectedTeamId)
      if (!isStillMember) {
        setSelectedTeamId(null)
      }
    }
  }, [teams, selectedTeamId])
  
  // Fetch policies
  const { data: policiesData, isLoading: policiesLoading, refetch: refetchPolicies } = useQuery({
    queryKey: ['policies', categoryFilter, statusFilter, searchQuery, selectedTeamId],
    queryFn: () => fetchPolicies(token || localStorage.getItem('token') || '', {
      category: categoryFilter,
      status: statusFilter,
      search: searchQuery,
      team_id: selectedTeamId || undefined,
    }),
    staleTime: 30 * 1000,
    enabled: true,
  })
  
  // Fetch violations
  const { data: violationsData, refetch: refetchViolations } = useQuery({
    queryKey: ['violations'],
    queryFn: () => fetchViolations(token || localStorage.getItem('token') || ''),
    staleTime: 30 * 1000,
    enabled: true,
  })
  
  // Toggle policy mutation
  const toggleMutation = useMutation({
    mutationFn: (policyId: string) => togglePolicy(token || localStorage.getItem('token') || '', policyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] })
    },
  })
  
  // Resolve violation mutation
  const resolveMutation = useMutation({
    mutationFn: (violationId: string) => resolveViolation(token || localStorage.getItem('token') || '', violationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['violations'] })
      queryClient.invalidateQueries({ queryKey: ['policies'] })
    },
  })
  
  // Create policy mutation
  const createMutation = useMutation({
    mutationFn: (data: CreatePolicyData) => createPolicy(token || localStorage.getItem('token') || '', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] })
      setShowCreateModal(false)
    },
  })
  
  // Delete policy mutation
  const deleteMutation = useMutation({
    mutationFn: (policyId: string) => deletePolicy(token || localStorage.getItem('token') || '', policyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] })
      setSelectedPolicy(null)
    },
  })
  
  // Add policy from library
  const handleAddFromLibrary = (template: PolicyTemplate) => {
    createMutation.mutate({
      name: template.name,
      description: template.description,
      category: template.category,
      severity: template.severity,
      enforcement: template.enforcement,
      scope: template.scope,
      auto_remediate: template.auto_remediate,
      team_id: selectedTeamId || undefined,
    })
  }
  
  // Theme detection
  useEffect(() => {
    const checkTheme = () => {
      const savedTheme = localStorage.getItem('driftbox-theme')
      if (savedTheme) {
        setIsDarkMode(savedTheme === 'dark')
      } else {
        setIsDarkMode(!document.documentElement.classList.contains('light-mode'))
      }
    }
    checkTheme()
    const observer = new MutationObserver(checkTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    window.addEventListener('storage', checkTheme)
    return () => {
      observer.disconnect()
      window.removeEventListener('storage', checkTheme)
    }
  }, [])
  
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['policies'] })
    queryClient.invalidateQueries({ queryKey: ['violations'] })
    refetchPolicies()
    refetchViolations()
  }
  
  // Data from API
  const policies = policiesData?.policies || []
  const violations = violationsData?.violations || []
  const totalPolicies = policiesData?.total || 0
  const activePolicies = policiesData?.active || 0
  const totalViolations = policiesData?.violations_count || 0
  const criticalViolations = violations.filter(v => v.severity === 'critical' && v.status === 'open').length
  const complianceRate = policiesData?.compliance_rate || 100
  
  // Filter policies client-side for search (API handles category/status)
  const filteredPolicies = policies.filter(p => {
    if (!searchQuery) return true
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         p.description.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  })
  
  const categories = ['all', ...new Set(policies.map(p => p.category))].filter(Boolean)
  
  return (
    <div className={`min-h-screen p-6 ${isDarkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
      {/* Detail Panel */}
      {selectedPolicy && (
        <PolicyDetailPanel
          policy={selectedPolicy}
          violations={violations}
          onClose={() => setSelectedPolicy(null)}
          isDarkMode={isDarkMode}
          onToggle={() => toggleMutation.mutate(selectedPolicy.id)}
          onResolveViolation={(id) => resolveMutation.mutate(id)}
          onDelete={() => deleteMutation.mutate(selectedPolicy.id)}
        />
      )}
      
      {/* Create Policy Modal */}
      {showCreateModal && (
        <CreatePolicyModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={(data) => createMutation.mutate(data)}
          isDarkMode={isDarkMode}
          isLoading={createMutation.isPending}
          selectedTeamId={selectedTeamId}
        />
      )}
      
      {/* Policy Library Modal */}
      {showLibrary && (
        <PolicyLibraryModal
          onClose={() => setShowLibrary(false)}
          onAddPolicy={handleAddFromLibrary}
          isDarkMode={isDarkMode}
          existingPolicies={policies}
          isAdding={createMutation.isPending}
        />
      )}
      
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className={`text-2xl font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>
            Policy Management
          </h1>
          <p className={`mt-1 text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
            Define and enforce infrastructure governance rules across your organization
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={policiesLoading}
            className={`p-2 rounded-md transition-colors ${
              isDarkMode
                ? 'bg-[#1f1f1f] text-[#888] hover:text-[#fafafa]'
                : 'bg-gray-100 text-gray-500 hover:text-gray-900'
            }`}
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${policiesLoading ? 'animate-spin' : ''}`} />
          </button>
          <button 
            onClick={() => setShowLibrary(true)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors border ${
              isDarkMode 
                ? 'border-[#1f1f1f] text-[#a1a1a1] hover:bg-[#1f1f1f] hover:text-[#fafafa]' 
                : 'border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Database className="h-4 w-4" />
            Policy Library
          </button>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 rounded-lg bg-[#14b8a6] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0d9488] transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create Policy
          </button>
        </div>
      </div>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {/* Total Policies */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-[#14b8a6]/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#14b8a6]/5 rounded-full blur-2xl -mr-8 -mt-8" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="h-4 w-4 text-[#14b8a6]" />
              <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Total Policies</p>
            </div>
            <p className={`text-3xl font-bold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{totalPolicies}</p>
            <p className="text-xs text-[#14b8a6] mt-1">{activePolicies} active</p>
          </div>
        </div>
        
        {/* Open Violations */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-red-500/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          {totalViolations > 0 && (
            <div className="absolute top-3 right-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
            </div>
          )}
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Violations</p>
            </div>
            <p className={`text-3xl font-bold ${totalViolations > 0 ? 'text-red-400' : isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{totalViolations}</p>
            <p className="text-xs text-red-400 mt-1">{criticalViolations} critical</p>
          </div>
        </div>
        
        {/* Compliance Rate - Circular */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-emerald-500/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          <div className="relative flex items-center gap-4">
            <div className="relative w-16 h-16 flex-shrink-0">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="26" fill="none" stroke={isDarkMode ? "#1f1f1f" : "#e5e7eb"} strokeWidth="6" />
                <circle
                  cx="32" cy="32" r="26" fill="none"
                  stroke={complianceRate >= 80 ? "#22c55e" : complianceRate >= 60 ? "#eab308" : "#ef4444"}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${complianceRate * 1.63} 163`}
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-sm font-bold ${complianceRate >= 80 ? 'text-emerald-400' : complianceRate >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {complianceRate}%
                </span>
              </div>
            </div>
            <div>
              <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Compliance</p>
              <p className={`text-sm mt-1 ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>
                {policies.filter(p => p.violations === 0).length} passing
              </p>
            </div>
          </div>
        </div>
        
        {/* Categories */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-purple-500/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-4 w-4 text-purple-400" />
              <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Categories</p>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {['Security', 'Cost', 'Governance'].map((cat) => (
                <span key={cat} className={`px-2 py-0.5 rounded text-[10px] ${isDarkMode ? 'bg-[#1f1f1f] text-[#a1a1a1]' : 'bg-gray-200 text-gray-600'}`}>
                  {cat}
                </span>
              ))}
            </div>
          </div>
        </div>
        
        {/* Last Scan */}
        <div className={`relative p-5 rounded-xl border overflow-hidden group hover:border-blue-500/30 transition-all ${isDarkMode ? 'bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-blue-400" />
              <p className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>Last Scan</p>
            </div>
            <p className={`text-lg font-semibold ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>5 min ago</p>
            <p className={`text-xs mt-1 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>47 resources</p>
          </div>
        </div>
      </div>
      
      {/* Filters */}
      <div className="flex items-center gap-4 mb-4">
        {/* Team Selector */}
        <select
          value={selectedTeamId || ''}
          onChange={(e) => {
            setSelectedTeamId(e.target.value || null)
          }}
          className={`px-3 py-2.5 rounded-lg border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#14b8a6]/50 ${
            isDarkMode 
              ? 'bg-[#0f0f0f] border-[#1f1f1f] text-[#fafafa]'
              : 'bg-white border-gray-200 text-gray-900'
          }`}
        >
          <option value="">My policies</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
        
        <div className="relative flex-1 max-w-md">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
          <input
            type="text"
            placeholder="Search policies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full pl-9 pr-4 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[#14b8a6]/50 ${
              isDarkMode 
                ? 'bg-[#0f0f0f] border-[#1f1f1f] text-[#fafafa] placeholder-[#666666]'
                : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
            }`}
          />
        </div>
        
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className={`px-3 py-2.5 rounded-lg border text-sm focus:outline-none ${
            isDarkMode 
              ? 'bg-[#0f0f0f] border-[#1f1f1f] text-[#fafafa]'
              : 'bg-white border-gray-200 text-gray-900'
          }`}
        >
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat === 'all' ? 'All Categories' : cat}</option>
          ))}
        </select>
        
        <div className="flex items-center gap-2">
          {(['all', 'active', 'inactive', 'draft'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors capitalize ${
                statusFilter === status
                  ? 'bg-[#14b8a6]/10 text-[#14b8a6] border border-[#14b8a6]/30'
                  : isDarkMode
                    ? 'bg-[#0f0f0f] text-[#666666] border border-[#1f1f1f] hover:border-[#2f2f2f]'
                    : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
        
        <button className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-[#14b8a6] hover:bg-[#14b8a6]/10 transition-colors">
          <RefreshCw className="h-4 w-4" />
          Run All Checks
        </button>
      </div>
      
      {/* Policies Table */}
      <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'bg-[#0f0f0f] border-[#1f1f1f]' : 'bg-white border-gray-200'}`}>
        {/* Table Header */}
        <div className={`grid grid-cols-12 gap-4 px-5 py-3 border-b text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'border-[#1f1f1f] text-[#666666] bg-[#0a0a0a]' : 'border-gray-200 text-gray-500 bg-gray-50'}`}>
          <div className="col-span-4">Policy</div>
          <div className="col-span-1">Category</div>
          <div className="col-span-1">Severity</div>
          <div className="col-span-1">Status</div>
          <div className="col-span-1">Enforcement</div>
          <div className="col-span-1">Violations</div>
          <div className="col-span-2">Last Checked</div>
          <div className="col-span-1"></div>
        </div>
        
        {/* Table Body */}
        <div className={`divide-y ${isDarkMode ? 'divide-[#1f1f1f]' : 'divide-gray-100'}`}>
          {filteredPolicies.map((policy) => {
            const CategoryIcon = getCategoryIcon(policy.category)
            return (
              <div
                key={policy.id}
                onClick={() => setSelectedPolicy(policy)}
                className={`grid grid-cols-12 gap-4 px-5 py-4 cursor-pointer transition-colors ${
                  selectedPolicy?.id === policy.id
                    ? 'bg-[#14b8a6]/5'
                    : isDarkMode ? 'hover:bg-[#141414]' : 'hover:bg-gray-50'
                }`}
              >
                <div className="col-span-4">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${
                      policy.status === 'active' ? 'bg-emerald-500/10' : 
                      policy.status === 'draft' ? 'bg-purple-500/10' : 'bg-gray-500/10'
                    }`}>
                      <CategoryIcon className={`h-4 w-4 ${
                        policy.status === 'active' ? 'text-emerald-400' :
                        policy.status === 'draft' ? 'text-purple-400' : 'text-gray-400'
                      }`} />
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${isDarkMode ? 'text-[#fafafa]' : 'text-gray-900'}`}>{policy.name}</p>
                      <p className={`text-xs line-clamp-1 ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>{policy.description}</p>
                    </div>
                  </div>
                </div>
                <div className="col-span-1 flex items-center">
                  <span className={`text-xs ${isDarkMode ? 'text-[#a1a1a1]' : 'text-gray-600'}`}>{policy.category}</span>
                </div>
                <div className="col-span-1 flex items-center">
                  <SeverityBadge severity={policy.severity} />
                </div>
                <div className="col-span-1 flex items-center">
                  <StatusBadge status={policy.status} />
                </div>
                <div className="col-span-1 flex items-center">
                  <EnforcementBadge enforcement={policy.enforcement} isDarkMode={isDarkMode} />
                </div>
                <div className="col-span-1 flex items-center">
                  {policy.violations > 0 ? (
                    <span className="flex items-center gap-1.5 text-sm text-red-400">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {policy.violations}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                      <CheckCircle className="h-3.5 w-3.5" />
                      0
                    </span>
                  )}
                </div>
                <div className="col-span-2 flex items-center">
                  <span className={`text-sm ${isDarkMode ? 'text-[#666666]' : 'text-gray-500'}`}>
                    {formatRelativeTime(policy.last_checked || '')}
                  </span>
                </div>
                <div className="col-span-1 flex items-center justify-end">
                  <ChevronRight className={`h-4 w-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
                </div>
              </div>
            )
          })}
        </div>
        
        {filteredPolicies.length === 0 && (
          <div className="py-12 text-center">
            <Shield className={`h-12 w-12 mx-auto mb-4 ${isDarkMode ? 'text-[#666666]' : 'text-gray-400'}`} />
            <p className={isDarkMode ? 'text-[#666666]' : 'text-gray-500'}>No policies found</p>
          </div>
        )}
      </div>
    </div>
  )
}
