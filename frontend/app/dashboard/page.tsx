'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useGitHub } from '@/contexts/GitHubContext'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import Link from 'next/link'
import {
  AlertTriangle,
  GitPullRequest,
  Shield,
  DollarSign,
  Users,
  Activity,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  AlertCircle,
  CheckCircle,
  Clock,
  FolderGit2,
  Cloud,
  Server,
  Database,
  HardDrive,
  Globe,
  Loader2,
  ExternalLink,
  Layers,
  GitBranch,
  Eye,
  Lock,
  FileCheck,
  History,
  Zap,
  Target,
  BarChart3,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  X,
  Info,
  Network,
  Settings,
  Terminal,
  GitCommit,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
  LineChart,
  Line,
} from 'recharts'

// ===== TYPES =====
interface LifecyclePhase {
  name: string
  status: 'healthy' | 'warning' | 'critical' | 'inactive'
  checks: number
  passed: number
}

// Selected item for detail panel
interface SelectedItem {
  id: string
  type: 'drift' | 'policy' | 'risk' | 'cost' | 'resource' | 'investigation'
  title: string
  data: any
}

interface DriftItem {
  resource: string
  type: string
  field: string
  expected: string
  actual: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  detected: string
}

interface PolicyViolation {
  id: string
  rule: string
  resource: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
  remediation: string
}

interface ChangeRisk {
  id: string
  change: string
  resource: string
  riskLevel: 'critical' | 'high' | 'medium' | 'low'
  blastRadius: number
  requiresApproval: boolean
  status: 'pending' | 'approved' | 'rejected' | 'applied'
}

// ===== MOCK DATA (Will be replaced with real API data) =====
const lifecyclePhases: LifecyclePhase[] = [
  { name: 'Pre-Deployment', status: 'healthy', checks: 24, passed: 23 },
  { name: 'Deployment', status: 'healthy', checks: 12, passed: 12 },
  { name: 'Post-Deployment', status: 'warning', checks: 18, passed: 15 },
]

const driftData = [
  { date: 'Mon', detected: 2, resolved: 1 },
  { date: 'Tue', detected: 3, resolved: 2 },
  { date: 'Wed', detected: 1, resolved: 3 },
  { date: 'Thu', detected: 4, resolved: 2 },
  { date: 'Fri', detected: 2, resolved: 4 },
  { date: 'Sat', detected: 1, resolved: 1 },
  { date: 'Sun', detected: 0, resolved: 1 },
]

const policyComplianceData = [
  { name: 'Security', compliant: 85, total: 100 },
  { name: 'Cost', compliant: 72, total: 100 },
  { name: 'Network', compliant: 95, total: 100 },
  { name: 'Identity', compliant: 88, total: 100 },
  { name: 'Data', compliant: 91, total: 100 },
]

const changeRiskDistribution = [
  { name: 'Low Risk', value: 45, color: '#22c55e' },
  { name: 'Medium Risk', value: 30, color: '#eab308' },
  { name: 'High Risk', value: 20, color: '#f97316' },
  { name: 'Critical Risk', value: 5, color: '#ef4444' },
]

const costTrendData = [
  { month: 'Aug', cost: 2100, budget: 2500 },
  { month: 'Sep', cost: 2300, budget: 2500 },
  { month: 'Oct', cost: 2450, budget: 2500 },
  { month: 'Nov', cost: 2600, budget: 2500 },
  { month: 'Dec', cost: 2750, budget: 2800 },
  { month: 'Jan', cost: 2847, budget: 2800 },
]

const recentDriftItems: DriftItem[] = [
  { resource: 'droplet-web-01', type: 'Droplet', field: 'size', expected: 's-2vcpu-4gb', actual: 's-4vcpu-8gb', severity: 'high', detected: '2h ago' },
  { resource: 'db-postgres-main', type: 'Database', field: 'backup_enabled', expected: 'true', actual: 'false', severity: 'critical', detected: '4h ago' },
  { resource: 'fw-web-tier', type: 'Firewall', field: 'inbound_rules', expected: '3 rules', actual: '5 rules', severity: 'medium', detected: '1d ago' },
]

const recentPolicyViolations: PolicyViolation[] = [
  { id: 'pv-001', rule: 'require-encryption', resource: 'volume-data-01', severity: 'critical', category: 'Security', remediation: 'Enable encryption at rest' },
  { id: 'pv-002', rule: 'cost-threshold', resource: 'droplet-ml-gpu', severity: 'high', category: 'Cost', remediation: 'Review resource sizing' },
  { id: 'pv-003', rule: 'backup-policy', resource: 'db-redis-cache', severity: 'medium', category: 'Data', remediation: 'Configure automated backups' },
]

const pendingChanges: ChangeRisk[] = [
  { id: 'ch-001', change: 'Scale droplet cluster', resource: 'droplet-api-*', riskLevel: 'medium', blastRadius: 3, requiresApproval: true, status: 'pending' },
  { id: 'ch-002', change: 'Update firewall rules', resource: 'fw-database-tier', riskLevel: 'high', blastRadius: 8, requiresApproval: true, status: 'pending' },
  { id: 'ch-003', change: 'Add DNS record', resource: 'domain-api.driftbox.io', riskLevel: 'low', blastRadius: 1, requiresApproval: false, status: 'approved' },
]

// ===== COMPONENTS =====

// Control Plane Layer Visualization
function ControlPlaneArchitecture() {
  const layers = [
    { name: 'Audit & Evidence', icon: History, color: '#8b5cf6', status: 'active' },
    { name: 'Runtime Drift Detection', icon: Eye, color: '#ef4444', status: 'active' },
    { name: 'Risk Assessment', icon: Target, color: '#f97316', status: 'active' },
    { name: 'State Reasoning', icon: Layers, color: '#eab308', status: 'active' },
    { name: 'Policy Evaluation', icon: Shield, color: '#22c55e', status: 'active' },
    { name: 'Terraform Interaction', icon: GitBranch, color: '#14b8a6', status: 'active' },
  ]

  return (
    <div className="rounded-lg bg-[#0f0f0f] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-[#14b8a6]" />
          <h3 className="font-medium text-[#fafafa]">Control Plane Architecture</h3>
        </div>
        <span className="text-xs text-[#22c55e] bg-[#22c55e]/10 px-2 py-1 rounded">All Systems Operational</span>
      </div>
      <div className="space-y-2">
        {layers.map((layer, idx) => (
          <div
            key={layer.name}
            className="flex items-center gap-3 p-3 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f] hover:border-[#2f2f2f] transition-colors"
            style={{ marginLeft: `${idx * 8}px` }}
          >
            <div className="rounded-md p-1.5" style={{ backgroundColor: `${layer.color}15` }}>
              <layer.icon className="h-4 w-4" style={{ color: layer.color }} />
            </div>
            <span className="text-sm text-[#a1a1a1] flex-1">{layer.name}</span>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
              <span className="text-xs text-[#666666]">Active</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Lifecycle Governance Status - Expanded with governance details
function LifecycleGovernanceStatus({ phases }: { phases: LifecyclePhase[] }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return '#22c55e'
      case 'warning': return '#eab308'
      case 'critical': return '#ef4444'
      default: return '#666666'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return CheckCircle2
      case 'warning': return AlertTriangle
      case 'critical': return XCircle
      default: return Info
    }
  }

  // Recent governance checks
  const recentChecks = [
    { name: 'Security policy scan', phase: 'Pre-Deployment', status: 'passed', time: '5m ago' },
    { name: 'Cost threshold check', phase: 'Pre-Deployment', status: 'warning', time: '12m ago' },
    { name: 'Terraform plan validation', phase: 'Deployment', status: 'passed', time: '1h ago' },
    { name: 'Drift reconciliation', phase: 'Post-Deployment', status: 'failed', time: '2h ago' },
  ]

  // Governance metrics
  const metrics = [
    { label: 'Policies Active', value: 24, color: '#14b8a6' },
    { label: 'Auto-Remediated', value: 8, color: '#22c55e' },
    { label: 'Manual Review', value: 3, color: '#eab308' },
  ]

  const totalChecks = phases.reduce((acc, p) => acc + p.checks, 0)
  const totalPassed = phases.reduce((acc, p) => acc + p.passed, 0)
  const overallRate = Math.round((totalPassed / totalChecks) * 100)

  return (
    <div className="rounded-lg bg-[#0f0f0f] p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-[#14b8a6]" />
          <h3 className="font-medium text-[#fafafa]">Lifecycle Governance</h3>
        </div>
        <span className="text-xs text-[#666666]">Continuous enforcement</span>
      </div>
      
      {/* Phase Cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {phases.map((phase) => {
          const StatusIcon = getStatusIcon(phase.status)
          const color = getStatusColor(phase.status)
          const passRate = Math.round((phase.passed / phase.checks) * 100)
          
          return (
            <div key={phase.name} className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <div className="flex items-center gap-2 mb-3">
                <StatusIcon className="h-4 w-4" style={{ color }} />
                <span className="text-xs font-medium text-[#a1a1a1]">{phase.name}</span>
              </div>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-2xl font-semibold text-[#fafafa]">{passRate}%</span>
                <span className="text-xs text-[#666666]">pass rate</span>
              </div>
              <div className="w-full h-1.5 bg-[#1f1f1f] rounded-full overflow-hidden">
                <div 
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${passRate}%`, backgroundColor: color }}
                />
              </div>
              <p className="text-xs text-[#666666] mt-2">{phase.passed}/{phase.checks} checks passed</p>
            </div>
          )
        })}
      </div>

      {/* Governance Metrics + Recent Checks */}
      <div className="grid grid-cols-2 gap-4 flex-1">
        {/* Left: Metrics Summary */}
        <div className="space-y-3">
          <p className="text-xs text-[#666666] font-medium uppercase tracking-wider">Enforcement Summary</p>
          
          {/* Overall Score */}
          <div className="p-3 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[#666666]">Overall Governance Score</span>
              <span className={`text-lg font-semibold ${
                overallRate >= 90 ? 'text-[#22c55e]' : overallRate >= 70 ? 'text-[#eab308]' : 'text-[#ef4444]'
              }`}>{overallRate}%</span>
            </div>
            <div className="h-1.5 bg-[#1f1f1f] rounded-full overflow-hidden">
              <div 
                className="h-full rounded-full"
                style={{ 
                  width: `${overallRate}%`, 
                  backgroundColor: overallRate >= 90 ? '#22c55e' : overallRate >= 70 ? '#eab308' : '#ef4444' 
                }}
              />
            </div>
          </div>

          {/* Metric Pills */}
          <div className="space-y-2">
            {metrics.map((m, idx) => (
              <div key={idx} className="flex items-center justify-between p-2 rounded bg-[#0a0a0a]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
                  <span className="text-xs text-[#a1a1a1]">{m.label}</span>
                </div>
                <span className="text-sm font-medium text-[#fafafa]">{m.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Recent Checks */}
        <div>
          <p className="text-xs text-[#666666] font-medium uppercase tracking-wider mb-3">Recent Checks</p>
          <div className="space-y-2">
            {recentChecks.map((check, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 rounded bg-[#0a0a0a]">
                <div className={`w-1.5 h-1.5 rounded-full ${
                  check.status === 'passed' ? 'bg-[#22c55e]' : 
                  check.status === 'warning' ? 'bg-[#eab308]' : 'bg-[#ef4444]'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[#fafafa] truncate">{check.name}</p>
                  <p className="text-[10px] text-[#666666]">{check.phase}</p>
                </div>
                <span className="text-[10px] text-[#666666]">{check.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// Drift Detection Chart
function DriftDetectionPanel({ data, items, onItemClick }: { data: typeof driftData, items: DriftItem[], onItemClick?: (item: SelectedItem) => void }) {
  const severityColors = {
    critical: '#ef4444',
    high: '#f97316',
    medium: '#eab308',
    low: '#3b82f6',
  }

  return (
    <div className="rounded-lg bg-[#0f0f0f] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-[#14b8a6]" />
          <h3 className="font-medium text-[#fafafa]">Infrastructure Drift Detection</h3>
          <span className="rounded-full bg-[#ef4444]/10 px-2 py-0.5 text-xs text-[#ef4444]">
            {items.length} active
          </span>
        </div>
        <Link href="/dashboard/drift" className="text-xs text-[#14b8a6] hover:text-[#0d9488] flex items-center gap-1">
          View all <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      
      {/* Drift Chart */}
      <div className="h-40 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="driftDetected" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="driftResolved" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
            <XAxis dataKey="date" stroke="#666666" fontSize={10} />
            <YAxis stroke="#666666" fontSize={10} />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: '8px' }}
              labelStyle={{ color: '#fafafa' }}
            />
            <Area type="monotone" dataKey="detected" stroke="#ef4444" fillOpacity={1} fill="url(#driftDetected)" strokeWidth={2} />
            <Area type="monotone" dataKey="resolved" stroke="#22c55e" fillOpacity={1} fill="url(#driftResolved)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Drift Items */}
      <div className="space-y-2">
        {items.slice(0, 3).map((item, idx) => (
          <div 
            key={idx} 
            className="flex items-center justify-between p-2 rounded bg-[#0a0a0a] hover:bg-[#141414] cursor-pointer transition-colors"
            onClick={() => onItemClick?.({ id: `drift-${idx}`, type: 'drift', title: item.resource, data: item })}
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: severityColors[item.severity] }} />
              <div>
                <p className="text-sm text-[#fafafa]">{item.resource}</p>
                <p className="text-xs text-[#666666]">
                  <span className="text-[#a1a1a1]">{item.field}:</span> {item.expected} → {item.actual}
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-[#666666]" />
          </div>
        ))}
      </div>
    </div>
  )
}

// Policy Compliance Scorecard
function PolicyComplianceCard({ data, violations, onItemClick }: { data: typeof policyComplianceData, violations: PolicyViolation[], onItemClick?: (item: SelectedItem) => void }) {
  const overallCompliance = Math.round(data.reduce((acc, d) => acc + d.compliant, 0) / data.length)
  
  const severityColors = {
    critical: '#ef4444',
    high: '#f97316',
    medium: '#eab308',
    low: '#3b82f6',
  }

  return (
    <div className="rounded-lg bg-[#0f0f0f] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#14b8a6]" />
          <h3 className="font-medium text-[#fafafa]">Policy Compliance</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-lg font-semibold ${overallCompliance >= 80 ? 'text-[#22c55e]' : overallCompliance >= 60 ? 'text-[#eab308]' : 'text-[#ef4444]'}`}>
            {overallCompliance}%
          </span>
          <span className="text-xs text-[#666666]">overall</span>
        </div>
      </div>
      
      {/* Compliance by Category */}
      <div className="h-36 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} stroke="#666666" fontSize={10} />
            <YAxis dataKey="name" type="category" stroke="#666666" fontSize={10} width={60} />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: '8px' }}
              labelStyle={{ color: '#fafafa' }}
            />
            <Bar dataKey="compliant" fill="#14b8a6" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Violations */}
      <div className="border-t border-[#1f1f1f] pt-4">
        <p className="text-xs text-[#666666] mb-2">Recent Violations ({violations.length})</p>
        <div className="space-y-2">
          {violations.slice(0, 2).map((v) => (
            <div 
              key={v.id} 
              className="flex items-center justify-between p-2 rounded bg-[#0a0a0a] hover:bg-[#141414] cursor-pointer transition-colors"
              onClick={() => onItemClick?.({ id: `policy-${v.id}`, type: 'policy', title: v.rule, data: v })}
            >
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: severityColors[v.severity] }} />
                <div>
                  <p className="text-sm text-[#fafafa]">{v.rule}</p>
                  <p className="text-xs text-[#666666]">{v.resource}</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-[#666666]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Risk Assessment Panel
function RiskAssessmentPanel({ distribution, changes, onItemClick }: { distribution: typeof changeRiskDistribution, changes: ChangeRisk[], onItemClick?: (item: SelectedItem) => void }) {
  const pendingCount = changes.filter(c => c.status === 'pending').length
  const requiresApproval = changes.filter(c => c.requiresApproval && c.status === 'pending').length

  return (
    <div className="rounded-lg bg-[#0f0f0f] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-[#14b8a6]" />
          <h3 className="font-medium text-[#fafafa]">Change Risk Assessment</h3>
        </div>
        {requiresApproval > 0 && (
          <span className="text-xs text-[#f97316] bg-[#f97316]/10 px-2 py-1 rounded">
            {requiresApproval} awaiting approval
          </span>
        )}
      </div>
      
      <div className="flex gap-6">
        {/* Risk Distribution Pie */}
        <div className="w-32 h-32">
          <ResponsiveContainer width="100%" height="100%">
            <RechartsPieChart>
              <Pie
                data={distribution}
                cx="50%"
                cy="50%"
                innerRadius={25}
                outerRadius={45}
                paddingAngle={2}
                dataKey="value"
              >
                {distribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: '8px' }}
              />
            </RechartsPieChart>
          </ResponsiveContainer>
        </div>

        {/* Risk Legend */}
        <div className="flex-1 space-y-2">
          {distribution.map((item) => (
            <div key={item.name} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-xs text-[#a1a1a1]">{item.name}</span>
              </div>
              <span className="text-xs text-[#fafafa]">{item.value}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Pending Changes */}
      <div className="mt-4 pt-4 border-t border-[#1f1f1f]">
        <p className="text-xs text-[#666666] mb-2">Pending Changes ({pendingCount})</p>
        <div className="space-y-2">
          {changes.filter(c => c.status === 'pending').slice(0, 2).map((c) => (
            <div 
              key={c.id} 
              className="flex items-center justify-between p-2 rounded bg-[#0a0a0a] hover:bg-[#141414] cursor-pointer transition-colors"
              onClick={() => onItemClick?.({ id: `risk-${c.id}`, type: 'risk', title: c.change, data: c })}
            >
              <div>
                <p className="text-sm text-[#fafafa]">{c.change}</p>
                <p className="text-xs text-[#666666]">Blast radius: {c.blastRadius} resources</p>
              </div>
              <ChevronRight className="h-4 w-4 text-[#666666]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Cost Tracking Panel
function CostTrackingPanel({ data, currentCost }: { data: typeof costTrendData, currentCost: number }) {
  const lastMonth = data[data.length - 2]?.cost || 0
  const costChange = currentCost - lastMonth
  const costChangePercent = lastMonth ? Math.round((costChange / lastMonth) * 100) : 0

  // Calculate dynamic Y-axis domain based on actual cost values
  const allCosts = data.map(d => d.cost).filter(c => c > 0)
  const allBudgets = data.map(d => d.budget || 0).filter(b => b > 0)
  const allValues = [...allCosts, ...allBudgets, currentCost].filter(v => v > 0)
  
  // If no values, use a default small range
  if (allValues.length === 0) {
    allValues.push(0, 50) // Default to $0-$50 range
  }
  
  const maxValue = Math.max(...allValues, 1)
  const minValue = Math.min(...allValues, 0)
  
  // Add padding based on the scale of the values
  let padding: number
  if (maxValue < 10) {
    padding = Math.max(maxValue * 0.2, 2) // 20% or $2 for very small values
  } else if (maxValue < 100) {
    padding = Math.max(maxValue * 0.15, 5) // 15% or $5 for small values
  } else {
    padding = Math.max(maxValue * 0.1, 10) // 10% or $10 for larger values
  }
  
  const yAxisMax = maxValue + padding
  const yAxisMin = Math.max(0, minValue - (minValue > 0 ? padding : 0))
  
  // Round to nice numbers for Y-axis ticks based on scale
  const roundToNiceNumber = (num: number) => {
    if (num < 5) return Math.ceil(num / 0.5) * 0.5 // $0.50 increments for very small
    if (num < 20) return Math.ceil(num / 1) * 1 // $1 increments
    if (num < 100) return Math.ceil(num / 5) * 5 // $5 increments
    if (num < 500) return Math.ceil(num / 25) * 25 // $25 increments
    if (num < 1000) return Math.ceil(num / 50) * 50 // $50 increments
    return Math.ceil(num / 100) * 100 // $100 increments for large values
  }
  
  const niceMax = roundToNiceNumber(yAxisMax)
  const niceMin = Math.max(0, Math.floor(yAxisMin / (niceMax < 20 ? 1 : 5)) * (niceMax < 20 ? 1 : 5))

  return (
    <div className="rounded-lg bg-[#0f0f0f] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-[#14b8a6]" />
          <h3 className="font-medium text-[#fafafa]">Infrastructure Cost</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-[#fafafa]">${currentCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className={`text-xs flex items-center gap-0.5 ${costChange >= 0 ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
            {costChange >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(costChangePercent)}%
          </span>
        </div>
      </div>
      
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
            <XAxis dataKey="month" stroke="#666666" fontSize={10} />
            <YAxis 
              stroke="#666666" 
              fontSize={10} 
              tickFormatter={(v) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
              domain={[niceMin, niceMax]}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: '8px' }}
              labelStyle={{ color: '#fafafa' }}
              formatter={(value: number) => [`$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, '']}
            />
            <Line type="monotone" dataKey="cost" stroke="#14b8a6" strokeWidth={2} dot={{ fill: '#14b8a6', strokeWidth: 0, r: 3 }} />
            <Line type="monotone" dataKey="budget" stroke="#666666" strokeWidth={1} strokeDasharray="5 5" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      <div className="flex items-center justify-between mt-2 text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-[#14b8a6] rounded" />
            <span className="text-[#666666]">Actual</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-[#666666] rounded border-dashed" />
            <span className="text-[#666666]">Budget</span>
          </div>
        </div>
        <span className="text-[#666666]">6-month trend</span>
      </div>
    </div>
  )
}

// DigitalOcean Infrastructure Panel - Enhanced with detailed resource view
function DigitalOceanPanel({ summary, loading, error, onRefresh }: {
  summary: any
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  const resourceTypes = [
    { key: 'droplets', name: 'Droplets', icon: Server, color: '#0080FF', description: 'Virtual machines' },
    { key: 'databases', name: 'Databases', icon: Database, color: '#22c55e', description: 'Managed DBs' },
    { key: 'kubernetes_clusters', name: 'Kubernetes', icon: Cloud, color: '#3b82f6', description: 'K8s clusters' },
    { key: 'load_balancers', name: 'Load Balancers', icon: Globe, color: '#8b5cf6', description: 'Traffic distribution' },
    { key: 'volumes', name: 'Volumes', icon: HardDrive, color: '#f97316', description: 'Block storage' },
    { key: 'firewalls', name: 'Firewalls', icon: Shield, color: '#ef4444', description: 'Network security' },
    { key: 'vpcs', name: 'VPCs', icon: Network, color: '#14b8a6', description: 'Private networks' },
    { key: 'domains', name: 'Domains', icon: Globe, color: '#eab308', description: 'DNS management' },
  ]

  // Calculate cost breakdown from real data
  const getCostBreakdown = () => {
    if (!summary) return []
    const breakdown: { name: string; cost: number; color: string }[] = []
    
    // Droplet costs (estimate based on count)
    const dropletCount = summary.droplets?.count || 0
    if (dropletCount > 0) {
      // Average droplet cost estimate
      const avgDropletCost = summary.droplets?.items?.reduce((acc: number, d: any) => {
        const sizeMap: Record<string, number> = {
          's-1vcpu-1gb': 6, 's-1vcpu-2gb': 12, 's-2vcpu-2gb': 18, 's-2vcpu-4gb': 24,
          's-4vcpu-8gb': 48, 's-8vcpu-16gb': 96, 'default': 12
        }
        return acc + (sizeMap[d.size_slug] || sizeMap['default'])
      }, 0) || dropletCount * 12
      breakdown.push({ name: 'Droplets', cost: avgDropletCost, color: '#0080FF' })
    }
    
    // Database costs
    const dbCount = summary.databases?.count || 0
    if (dbCount > 0) {
      breakdown.push({ name: 'Databases', cost: dbCount * 15, color: '#22c55e' })
    }
    
    // Load balancer costs ($12/month each)
    const lbCount = summary.load_balancers?.count || 0
    if (lbCount > 0) {
      breakdown.push({ name: 'Load Balancers', cost: lbCount * 12, color: '#8b5cf6' })
    }
    
    // Volume costs ($0.10/GB - estimate 100GB avg)
    const volCount = summary.volumes?.count || 0
    if (volCount > 0) {
      const volCost = summary.volumes?.items?.reduce((acc: number, v: any) => acc + (v.size_gigabytes || 100) * 0.1, 0) || volCount * 10
      breakdown.push({ name: 'Volumes', cost: volCost, color: '#f97316' })
    }
    
    return breakdown.sort((a, b) => b.cost - a.cost)
  }

  const costBreakdown = getCostBreakdown()
  const totalCost = summary?.estimated_monthly_cost || costBreakdown.reduce((a, b) => a + b.cost, 0)

  // Get all resources with status
  const getAllResources = () => {
    if (!summary) return []
    const resources: any[] = []
    
    // Add droplets
    summary.droplets?.items?.forEach((d: any) => {
      resources.push({
        id: d.id,
        name: d.name,
        type: 'Droplet',
        status: d.status,
        region: d.region,
        detail: d.size_slug,
        icon: Server,
        color: '#0080FF'
      })
    })
    
    // Add databases
    summary.databases?.items?.forEach((d: any) => {
      resources.push({
        id: d.id,
        name: d.name,
        type: 'Database',
        status: d.status,
        region: d.region,
        detail: d.engine,
        icon: Database,
        color: '#22c55e'
      })
    })
    
    // Add kubernetes
    summary.kubernetes_clusters?.items?.forEach((k: any) => {
      resources.push({
        id: k.id,
        name: k.name,
        type: 'Kubernetes',
        status: k.status,
        detail: k.version,
        icon: Cloud,
        color: '#3b82f6'
      })
    })
    
    // Add load balancers
    summary.load_balancers?.items?.forEach((lb: any) => {
      resources.push({
        id: lb.id,
        name: lb.name,
        type: 'Load Balancer',
        status: lb.status,
        detail: lb.ip,
        icon: Globe,
        color: '#8b5cf6'
      })
    })
    
    return resources
  }

  const allResources = getAllResources()
  const activeResources = allResources.filter(r => r.status === 'active' || r.status === 'running' || r.status === 'online')
  const healthPercentage = allResources.length > 0 ? Math.round((activeResources.length / allResources.length) * 100) : 100

  // Show loading state
  if (loading && !summary) {
    return (
      <div className="rounded-lg bg-[#0f0f0f] p-8">
        <div className="flex flex-col items-center justify-center">
          <Loader2 className="h-8 w-8 text-[#0080FF] animate-spin mb-3" />
          <p className="text-sm text-[#666666]">Fetching DigitalOcean infrastructure...</p>
        </div>
      </div>
    )
  }

  // Show error state
  if (error && !summary) {
    return (
      <div className="rounded-lg bg-[#0f0f0f] p-8">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 text-[#ef4444] mx-auto mb-3" />
          <p className="text-sm text-[#ef4444]">{error}</p>
          <button onClick={onRefresh} className="mt-3 text-sm text-[#0080FF] hover:text-[#0066CC]">
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-[#0f0f0f]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1f1f]">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-[#0080FF]/10 p-2">
            <Cloud className="h-5 w-5 text-[#0080FF]" />
          </div>
          <div>
            <h2 className="font-medium text-[#fafafa]">DigitalOcean Infrastructure</h2>
            <p className="text-xs text-[#666666]">
              {summary?.total_resources || 0} managed resources • {healthPercentage}% healthy
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-[#666666]">Est. Monthly</p>
            <p className="text-lg font-semibold text-[#fafafa]">
              ${totalCost.toLocaleString()}
            </p>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-2 rounded-md bg-[#0080FF]/10 px-3 py-1.5 text-sm text-[#0080FF] hover:bg-[#0080FF]/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Sync
          </button>
        </div>
      </div>

      <div className="p-5">
        {/* Main Grid: Resource Types + Cost Breakdown + Health */}
        <div className="grid grid-cols-12 gap-6">
          
          {/* Resource Type Grid - 5 cols */}
          <div className="col-span-5">
            <p className="text-xs text-[#666666] mb-3 font-medium uppercase tracking-wider">Resource Inventory</p>
            <div className="grid grid-cols-2 gap-2">
              {resourceTypes.slice(0, 6).map((rt) => {
                const count = summary?.[rt.key]?.count || 0
                const Icon = rt.icon
                return (
                  <div key={rt.key} className="p-3 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f] hover:border-[#2f2f2f] transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <div className="rounded-md p-1.5" style={{ backgroundColor: `${rt.color}15` }}>
                        <Icon className="h-3.5 w-3.5" style={{ color: rt.color }} />
                      </div>
                      <span className="text-xl font-semibold text-[#fafafa]">{count}</span>
                    </div>
                    <p className="text-xs text-[#a1a1a1]">{rt.name}</p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Cost Breakdown - 4 cols */}
          <div className="col-span-4">
            <p className="text-xs text-[#666666] mb-3 font-medium uppercase tracking-wider">Cost Breakdown</p>
            <div className="space-y-2">
              {costBreakdown.length > 0 ? costBreakdown.slice(0, 4).map((item, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-sm text-[#a1a1a1] flex-1">{item.name}</span>
                  <span className="text-sm font-medium text-[#fafafa]">${item.cost.toFixed(0)}</span>
                  <span className="text-xs text-[#666666] w-10 text-right">
                    {totalCost > 0 ? Math.round((item.cost / totalCost) * 100) : 0}%
                  </span>
                </div>
              )) : (
                <p className="text-sm text-[#666666] py-4">No cost data available</p>
              )}
              {costBreakdown.length > 4 && (
                <p className="text-xs text-[#666666]">+{costBreakdown.length - 4} more categories</p>
              )}
            </div>
            
            {/* Cost Chart */}
            {costBreakdown.length > 0 && (
              <div className="mt-3 h-3 bg-[#1f1f1f] rounded-full overflow-hidden flex">
                {costBreakdown.map((item, idx) => (
                  <div
                    key={idx}
                    className="h-full transition-all"
                    style={{
                      width: `${(item.cost / totalCost) * 100}%`,
                      backgroundColor: item.color
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Health Score + Quick Actions - 3 cols */}
          <div className="col-span-3">
            <p className="text-xs text-[#666666] mb-3 font-medium uppercase tracking-wider">Infrastructure Health</p>
            
            {/* Health Gauge */}
            <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f] mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[#666666]">Overall Health</span>
                <span className={`text-lg font-semibold ${
                  healthPercentage >= 90 ? 'text-[#22c55e]' :
                  healthPercentage >= 70 ? 'text-[#eab308]' : 'text-[#ef4444]'
                }`}>
                  {healthPercentage}%
                </span>
              </div>
              <div className="h-2 bg-[#1f1f1f] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${healthPercentage}%`,
                    backgroundColor: healthPercentage >= 90 ? '#22c55e' : healthPercentage >= 70 ? '#eab308' : '#ef4444'
                  }}
                />
              </div>
              <p className="text-xs text-[#666666] mt-2">
                {activeResources.length}/{allResources.length} resources active
              </p>
            </div>

            {/* Quick Actions */}
            <div className="space-y-1.5">
              <button className="w-full flex items-center gap-2 p-2 rounded bg-[#0a0a0a] border border-[#1f1f1f] hover:border-[#14b8a6] text-xs text-[#a1a1a1] hover:text-[#14b8a6] transition-colors">
                <Eye className="h-3 w-3" />
                Run Drift Check
              </button>
              <button className="w-full flex items-center gap-2 p-2 rounded bg-[#0a0a0a] border border-[#1f1f1f] hover:border-[#14b8a6] text-xs text-[#a1a1a1] hover:text-[#14b8a6] transition-colors">
                <Shield className="h-3 w-3" />
                Security Scan
              </button>
            </div>
          </div>
        </div>

        {/* Live Resources Table */}
        {allResources.length > 0 && (
          <div className="mt-5 pt-5 border-t border-[#1f1f1f]">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-[#666666] font-medium uppercase tracking-wider">Live Resource Status</p>
              <span className="text-xs text-[#666666]">{allResources.length} resources</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {allResources.slice(0, 8).map((resource, idx) => {
                const Icon = resource.icon
                const isHealthy = resource.status === 'active' || resource.status === 'running' || resource.status === 'online'
                return (
                  <div
                    key={idx}
                    className="flex items-center gap-2 p-2.5 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]"
                  >
                    <div className="rounded-md p-1.5" style={{ backgroundColor: `${resource.color}15` }}>
                      <Icon className="h-3.5 w-3.5" style={{ color: resource.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#fafafa] truncate">{resource.name}</p>
                      <p className="text-xs text-[#666666] truncate">{resource.type} • {resource.detail || resource.region}</p>
                    </div>
                    <div className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-[#22c55e]' : 'bg-[#ef4444]'}`} />
                  </div>
                )
              })}
            </div>
            {allResources.length > 8 && (
              <p className="text-xs text-[#666666] mt-2 text-center">
                +{allResources.length - 8} more resources
              </p>
            )}
          </div>
        )}

        {/* Account Status Footer */}
        {summary?.account && (
          <div className="mt-4 pt-4 border-t border-[#1f1f1f] flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className={`px-2 py-1 rounded text-xs ${
                summary.account.status === 'active' 
                  ? 'bg-[#22c55e]/10 text-[#22c55e]' 
                  : 'bg-[#666666]/10 text-[#666666]'
              }`}>
                {summary.account.status}
              </span>
              <span className="text-xs text-[#666666]">{summary.account.email}</span>
              {summary.account.droplet_limit && (
                <span className="text-xs text-[#666666]">
                  Limit: {summary.droplets?.count || 0}/{summary.account.droplet_limit} droplets
                </span>
              )}
            </div>
            <a
              href="https://cloud.digitalocean.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-[#0080FF] hover:text-[#0066CC]"
            >
              Open Console <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

// Connect DigitalOcean CTA
function ConnectDigitalOceanCTA() {
  return (
    <div className="rounded-lg bg-gradient-to-r from-[#0080FF]/10 via-[#0080FF]/5 to-transparent border border-[#0080FF]/20 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="rounded-lg bg-[#0080FF]/20 p-3">
            <Cloud className="h-6 w-6 text-[#0080FF]" />
          </div>
          <div>
            <h3 className="font-medium text-[#fafafa]">Connect DigitalOcean</h3>
            <p className="text-sm text-[#666666] mt-1">
              Enable real-time infrastructure monitoring, drift detection, and cost tracking for your DigitalOcean resources.
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/settings#integrations"
          className="flex items-center gap-2 rounded-md bg-[#0080FF] px-4 py-2 text-sm font-medium text-white hover:bg-[#0066CC] transition-colors"
        >
          Connect Now
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  )
}

// Stat Card Component (Mate-style with border and click-through)
function StatCard({
  title,
  value,
  change,
  changeType,
  icon: Icon,
  description,
  color = '#14b8a6',
  href,
}: {
  title: string
  value: string | number
  change?: string
  changeType?: 'positive' | 'negative' | 'neutral'
  icon: React.ElementType
  description?: string
  color?: string
  href?: string
}) {
  const content = (
    <div className="rounded-lg bg-[#0f0f0f] border border-[#1f1f1f] p-5 hover:border-[#2a2a2a] hover:bg-[#111111] transition-all cursor-pointer group">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-[#666666]">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-[#fafafa]">{value}</p>
          {change && (
            <div className="mt-2 flex items-center gap-1">
              {changeType === 'positive' && (
                <span className="text-[#22c55e]">↗</span>
              )}
              {changeType === 'negative' && (
                <span className="text-[#ef4444]">↗</span>
              )}
              {changeType === 'neutral' && (
                <span className="text-[#666666]">—</span>
              )}
              <span className={`text-xs ${
                changeType === 'positive' ? 'text-[#22c55e]' :
                changeType === 'negative' ? 'text-[#ef4444]' : 'text-[#666666]'
              }`}>
                {change}
              </span>
            </div>
          )}
          {description && <p className="mt-1 text-xs text-[#666666]">{description}</p>}
        </div>
        <div className="rounded-lg p-2.5" style={{ backgroundColor: `${color}15` }}>
          <Icon className="h-5 w-5" style={{ color }} />
        </div>
      </div>
    </div>
  )

  if (href) {
    return <Link href={href}>{content}</Link>
  }
  return content
}

// Top Investigation Card (Mate-style with sparkline)
function InvestigationCard({
  title,
  source,
  sourceIcon: SourceIcon,
  sourceColor,
  open,
  total,
  mttr,
  trendData,
  trendColor = '#3b82f6',
  href,
  onClick,
}: {
  title: string
  source: string
  sourceIcon: React.ElementType
  sourceColor: string
  open: number
  total: number
  mttr: string
  trendData: number[]
  trendColor?: string
  href?: string
  onClick?: () => void
}) {
  // Normalize trend data for sparkline
  const maxVal = Math.max(...trendData, 1)
  const sparklineData = trendData.map((val, i) => ({ x: i, y: val }))

  const content = (
    <div 
      className="rounded-lg bg-[#0f0f0f] border border-[#1f1f1f] p-4 hover:border-[#2a2a2a] hover:bg-[#111111] transition-all cursor-pointer"
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded bg-[#1f1f1f] flex items-center justify-center">
              <SourceIcon className="h-3 w-3" style={{ color: sourceColor }} />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[#fafafa] truncate">{title}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#666666]">{source}</span>
            </div>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-[#666666]" />
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-[10px] text-[#666666] uppercase tracking-wider">Open</p>
          <p className="text-lg font-semibold text-[#fafafa]">
            {open}<span className="text-[#666666] text-sm font-normal">/{total}</span>
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[#666666] uppercase tracking-wider">MTTR</p>
          <p className="text-lg font-semibold text-[#fafafa]">{mttr}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#666666] uppercase tracking-wider">Trend</p>
          <div className="h-8 mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparklineData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`trend-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={trendColor} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={trendColor} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <Area 
                  type="monotone" 
                  dataKey="y" 
                  stroke={trendColor} 
                  strokeWidth={1.5}
                  fill={`url(#trend-${title.replace(/\s/g, '')})`}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )

  if (href && !onClick) {
    return <Link href={href}>{content}</Link>
  }
  return content
}

// Activity Item Component
function ActivityItem({
  user,
  action,
  target,
  time,
  type,
}: {
  user: string
  action: string
  target: string
  time: string
  type: 'approve' | 'create' | 'run' | 'fix' | 'alert'
}) {
  const typeColors = {
    approve: '#22c55e',
    create: '#3b82f6',
    run: '#14b8a6',
    fix: '#eab308',
    alert: '#ef4444',
  }

  return (
    <div className="flex items-start gap-3 py-3">
      <div 
        className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium text-white"
        style={{ backgroundColor: typeColors[type] }}
      >
        {user[0].toUpperCase()}
      </div>
      <div className="flex-1">
        <p className="text-sm text-[#fafafa]">
          <span className="font-medium">{user}</span>{' '}
          <span className="text-[#666666]">{action}</span>{' '}
          <span className="text-[#14b8a6]">{target}</span>
        </p>
        <p className="text-xs text-[#666666] mt-0.5">{time}</p>
      </div>
    </div>
  )
}

// Fetch function for DO summary
const fetchDoSummary = async (): Promise<any> => {
  const token = localStorage.getItem('token')
  const response = await fetch(getApiEndpoint('/digitalocean/summary'), {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('DigitalOcean not connected')
    }
    throw new Error('Failed to fetch DigitalOcean data')
  }

  return response.json()
}

// Fetch function for dashboard stats
const fetchDashboardStats = async (): Promise<any> => {
  const token = localStorage.getItem('token')
  const response = await fetch(getApiEndpoint('/dashboard/stats'), {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })

  if (!response.ok) {
    throw new Error('Failed to fetch dashboard statistics')
  }

  return response.json()
}

// ===== DETAIL PANEL COMPONENT =====
function DetailPanel({
  item,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  item: SelectedItem
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  hasPrev: boolean
  hasNext: boolean
}) {
  const getIcon = () => {
    switch (item.type) {
      case 'drift': return Eye
      case 'policy': return Shield
      case 'risk': return Target
      case 'cost': return DollarSign
      case 'resource': return Server
      case 'investigation': return AlertTriangle
      default: return Info
    }
  }

  const getColor = () => {
    switch (item.type) {
      case 'drift': return '#ef4444'
      case 'policy': return '#f97316'
      case 'risk': return '#eab308'
      case 'cost': return '#22c55e'
      case 'resource': return '#0080FF'
      case 'investigation': return '#8b5cf6'
      default: return '#14b8a6'
    }
  }

  const Icon = getIcon()
  const color = getColor()

  // Render content based on type
  const renderContent = () => {
    switch (item.type) {
      case 'drift':
        return (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <p className="text-xs text-[#666666] mb-2">Resource</p>
              <p className="text-lg font-medium text-[#fafafa]">{item.data.resource}</p>
              <p className="text-sm text-[#666666] mt-1">{item.data.type}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
                <p className="text-xs text-[#666666] mb-2">Expected</p>
                <p className="text-sm text-[#22c55e] font-mono">{item.data.expected}</p>
              </div>
              <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
                <p className="text-xs text-[#666666] mb-2">Actual</p>
                <p className="text-sm text-[#ef4444] font-mono">{item.data.actual}</p>
              </div>
            </div>
            <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <p className="text-xs text-[#666666] mb-2">Field Changed</p>
              <p className="text-sm text-[#fafafa] font-mono">{item.data.field}</p>
            </div>
            <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <p className="text-xs text-[#666666] mb-2">Detected</p>
              <p className="text-sm text-[#fafafa]">{item.data.detected}</p>
            </div>
            <div className="flex gap-2 mt-6">
              <button className="flex-1 px-4 py-2 rounded-md bg-[#14b8a6] text-white text-sm font-medium hover:bg-[#0d9488] transition-colors">
                Reconcile Drift
              </button>
              <button className="flex-1 px-4 py-2 rounded-md bg-[#1f1f1f] text-[#fafafa] text-sm font-medium hover:bg-[#2a2a2a] transition-colors">
                Ignore
              </button>
            </div>
          </div>
        )

      case 'policy':
        return (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <p className="text-xs text-[#666666] mb-2">Rule</p>
              <p className="text-lg font-medium text-[#fafafa]">{item.data.rule}</p>
              <span className={`inline-block mt-2 text-xs px-2 py-1 rounded ${
                item.data.severity === 'critical' ? 'bg-[#ef4444]/20 text-[#ef4444]' :
                item.data.severity === 'high' ? 'bg-[#f97316]/20 text-[#f97316]' :
                item.data.severity === 'medium' ? 'bg-[#eab308]/20 text-[#eab308]' : 'bg-[#3b82f6]/20 text-[#3b82f6]'
              }`}>
                {item.data.severity}
              </span>
            </div>
            <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <p className="text-xs text-[#666666] mb-2">Resource</p>
              <p className="text-sm text-[#fafafa] font-mono">{item.data.resource}</p>
            </div>
            <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <p className="text-xs text-[#666666] mb-2">Category</p>
              <p className="text-sm text-[#fafafa]">{item.data.category}</p>
            </div>
            <div className="p-4 rounded-lg bg-[#14b8a6]/5 border border-[#14b8a6]/20">
              <p className="text-xs text-[#14b8a6] mb-2">Recommended Remediation</p>
              <p className="text-sm text-[#fafafa]">{item.data.remediation}</p>
            </div>
            <div className="flex gap-2 mt-6">
              <button className="flex-1 px-4 py-2 rounded-md bg-[#14b8a6] text-white text-sm font-medium hover:bg-[#0d9488] transition-colors">
                Auto-Remediate
              </button>
              <button className="flex-1 px-4 py-2 rounded-md bg-[#1f1f1f] text-[#fafafa] text-sm font-medium hover:bg-[#2a2a2a] transition-colors">
                Suppress
              </button>
            </div>
          </div>
        )

      case 'risk':
        return (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <p className="text-xs text-[#666666] mb-2">Change</p>
              <p className="text-lg font-medium text-[#fafafa]">{item.data.change}</p>
            </div>
            <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <p className="text-xs text-[#666666] mb-2">Resource</p>
              <p className="text-sm text-[#fafafa] font-mono">{item.data.resource}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
                <p className="text-xs text-[#666666] mb-2">Risk Level</p>
                <span className={`text-sm font-medium ${
                  item.data.riskLevel === 'critical' ? 'text-[#ef4444]' :
                  item.data.riskLevel === 'high' ? 'text-[#f97316]' :
                  item.data.riskLevel === 'medium' ? 'text-[#eab308]' : 'text-[#22c55e]'
                }`}>
                  {item.data.riskLevel.toUpperCase()}
                </span>
              </div>
              <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
                <p className="text-xs text-[#666666] mb-2">Blast Radius</p>
                <p className="text-sm text-[#fafafa]">{item.data.blastRadius} resources</p>
              </div>
            </div>
            <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <p className="text-xs text-[#666666] mb-2">Status</p>
              <span className={`text-sm px-2 py-1 rounded ${
                item.data.status === 'pending' ? 'bg-[#eab308]/20 text-[#eab308]' :
                item.data.status === 'approved' ? 'bg-[#22c55e]/20 text-[#22c55e]' :
                item.data.status === 'rejected' ? 'bg-[#ef4444]/20 text-[#ef4444]' : 'bg-[#3b82f6]/20 text-[#3b82f6]'
              }`}>
                {item.data.status}
              </span>
            </div>
            {item.data.status === 'pending' && item.data.requiresApproval && (
              <div className="flex gap-2 mt-6">
                <button className="flex-1 px-4 py-2 rounded-md bg-[#22c55e] text-white text-sm font-medium hover:bg-[#16a34a] transition-colors">
                  Approve
                </button>
                <button className="flex-1 px-4 py-2 rounded-md bg-[#ef4444] text-white text-sm font-medium hover:bg-[#dc2626] transition-colors">
                  Reject
                </button>
              </div>
            )}
          </div>
        )

      case 'investigation':
        return (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <p className="text-xs text-[#666666] mb-2">Issue Type</p>
              <p className="text-lg font-medium text-[#fafafa]">{item.data.title}</p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
                <p className="text-xs text-[#666666] mb-1">Open</p>
                <p className="text-xl font-semibold text-[#fafafa]">{item.data.open}</p>
              </div>
              <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
                <p className="text-xs text-[#666666] mb-1">Total</p>
                <p className="text-xl font-semibold text-[#fafafa]">{item.data.total}</p>
              </div>
              <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
                <p className="text-xs text-[#666666] mb-1">MTTR</p>
                <p className="text-xl font-semibold text-[#fafafa]">{item.data.mttr}</p>
              </div>
            </div>
            <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <p className="text-xs text-[#666666] mb-2">Source</p>
              <p className="text-sm text-[#fafafa]">{item.data.source}</p>
            </div>
            <div className="flex gap-2 mt-6">
              <button className="flex-1 px-4 py-2 rounded-md bg-[#14b8a6] text-white text-sm font-medium hover:bg-[#0d9488] transition-colors">
                View All Issues
              </button>
              <button className="flex-1 px-4 py-2 rounded-md bg-[#1f1f1f] text-[#fafafa] text-sm font-medium hover:bg-[#2a2a2a] transition-colors">
                Run Scan
              </button>
            </div>
          </div>
        )

      default:
        return (
          <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
            <p className="text-sm text-[#666666]">Details for this item</p>
            <pre className="mt-2 text-xs text-[#a1a1a1] overflow-auto">
              {JSON.stringify(item.data, null, 2)}
            </pre>
          </div>
        )
    }
  }

  return (
    <>
      {/* Full screen dim overlay */}
      <div 
        className="fixed inset-0 bg-black/60 z-30"
        onClick={onClose}
      />
      
      {/* Navigation Controls */}
      <div className="fixed left-[410px] top-20 z-50 flex flex-col items-center gap-2">
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full border border-[#444444] bg-[#1a1a1a] flex items-center justify-center text-[#888888] hover:text-[#fafafa] hover:border-[#14b8a6] transition-all shadow-lg"
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
        
        <button
          onClick={onPrev}
          disabled={!hasPrev}
          className={`w-10 h-10 rounded-full border border-[#444444] bg-[#1a1a1a] flex items-center justify-center transition-all shadow-lg ${
            !hasPrev 
              ? 'text-[#444444] cursor-not-allowed' 
              : 'text-[#888888] hover:text-[#fafafa] hover:border-[#14b8a6]'
          }`}
          title="Previous (↑)"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        
        <button
          onClick={onNext}
          disabled={!hasNext}
          className={`w-10 h-10 rounded-full border border-[#444444] bg-[#1a1a1a] flex items-center justify-center transition-all shadow-lg ${
            !hasNext 
              ? 'text-[#444444] cursor-not-allowed' 
              : 'text-[#888888] hover:text-[#fafafa] hover:border-[#14b8a6]'
          }`}
          title="Next (↓)"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {/* Detail Panel */}
      <div className="fixed top-0 right-0 bottom-0 w-[calc(100%-460px)] flex flex-col bg-[#0a0a0a] overflow-hidden z-40 shadow-2xl">
        {/* Header */}
        <div className="px-6 py-6 border-b border-[#1f1f1f] bg-[#0f0f0f]">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg p-2" style={{ backgroundColor: `${color}15` }}>
                <Icon className="h-5 w-5" style={{ color }} />
              </div>
              <div>
                <p className="text-xs text-[#666666] mb-1 capitalize">{item.type}</p>
                <h2 className="text-lg font-semibold text-[#fafafa]">{item.title}</h2>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="p-2 rounded-md hover:bg-[#1f1f1f] text-[#666666] hover:text-[#fafafa] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {renderContent()}
        </div>
      </div>
    </>
  )
}

// ===== MAIN DASHBOARD =====
export default function DashboardPage() {
  const { user } = useAuth()
  const { repos } = useGitHub()
  const queryClient = useQueryClient()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null)

  const isDoConnected = user?.digitalocean_connected || (typeof window !== 'undefined' && localStorage.getItem('digitalocean_connected') === 'true')

  // TanStack Query for DO summary - cached and "hot"
  const { 
    data: doSummary, 
    isLoading: doLoading, 
    error: doQueryError,
    refetch: refetchDoSummary 
  } = useQuery({
    queryKey: ['digitalocean-summary'],
    queryFn: fetchDoSummary,
    enabled: !!isDoConnected,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes cache
  })

  // TanStack Query for dashboard stats
  const {
    data: dashboardStats,
    isLoading: statsLoading,
    error: statsError,
    refetch: refetchStats
  } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: fetchDashboardStats,
    staleTime: 1 * 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes cache
    refetchOnWindowFocus: false, // Only refresh on manual refresh button click
  })

  const doError = doQueryError?.message || null

  const handleRefresh = () => {
    setIsRefreshing(true)
    // Invalidate all dashboard-related queries for fresh data
    queryClient.invalidateQueries({ queryKey: ['digitalocean-summary'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    if (isDoConnected) {
      refetchDoSummary()
    }
    refetchStats()
    setTimeout(() => setIsRefreshing(false), 1500)
  }

  // Calculate dynamic values from DO data
  // Prioritize dashboardStats cost, then doSummary, then 0
  const estimatedCost = dashboardStats?.cost?.estimated || doSummary?.estimated_monthly_cost || 0
  const totalResources = doSummary?.total_resources || 0
  
  // Debug log to see what cost we're getting
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    console.log('[Dashboard] Cost values:', {
      dashboardStatsCost: dashboardStats?.cost?.estimated,
      doSummaryCost: doSummary?.estimated_monthly_cost,
      finalCost: estimatedCost
    })
  }

  // Extract dynamic data from dashboard stats
  const stats = dashboardStats || {}
  const lifecyclePhases = stats.lifecycle_phases || [
    { name: 'Pre-Deployment', status: 'healthy', checks: 24, passed: 23 },
    { name: 'Deployment', status: 'healthy', checks: 12, passed: 12 },
    { name: 'Post-Deployment', status: 'warning', checks: 18, passed: 15 },
  ]
  
  // Convert sandbox activity to drift data format
  const driftData = stats.sandbox_activity?.map((item: any, idx: number) => ({
    date: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][idx % 7] || item.date,
    detected: item.count || 0,
    resolved: Math.floor((item.count || 0) * 0.8), // Estimate resolved
  })) || [
    { date: 'Mon', detected: 2, resolved: 1 },
    { date: 'Tue', detected: 3, resolved: 2 },
    { date: 'Wed', detected: 1, resolved: 3 },
    { date: 'Thu', detected: 4, resolved: 2 },
    { date: 'Fri', detected: 2, resolved: 4 },
    { date: 'Sat', detected: 1, resolved: 1 },
    { date: 'Sun', detected: 0, resolved: 1 },
  ]

  const policyComplianceData = stats.policy_compliance || [
    { name: 'Security', compliant: 85, total: 100 },
    { name: 'Cost', compliant: 72, total: 100 },
    { name: 'Network', compliant: 95, total: 100 },
    { name: 'Identity', compliant: 88, total: 100 },
    { name: 'Data', compliant: 91, total: 100 },
  ]

  const changeRiskDistribution = [
    { name: 'Low Risk', value: 45, color: '#22c55e' },
    { name: 'Medium Risk', value: 30, color: '#eab308' },
    { name: 'High Risk', value: 20, color: '#f97316' },
    { name: 'Critical Risk', value: 5, color: '#ef4444' },
  ]

  // Generate cost trend data based on actual cost
  // If we have actual cost data, use it; otherwise create a simple trend from current cost
  const costTrendData = stats.cost?.trend && stats.cost.trend.length > 0 
    ? stats.cost.trend 
    : (() => {
        // Generate last 6 months trend based on actual cost
        const months = ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan']
        const currentMonthIndex = 5 // January
        const baseCost = estimatedCost > 0 ? estimatedCost : (stats.cost?.estimated || 0)
        
        // If we have a real cost, create a trend showing gradual growth
        if (baseCost > 0) {
          return months.map((month, idx) => {
            // Simulate gradual growth: start at 80% of current, grow to current
            const monthCost = baseCost * (0.8 + (idx / currentMonthIndex) * 0.2)
            return {
              month,
              cost: Math.round(monthCost * 100) / 100, // Round to 2 decimals
              budget: baseCost * 1.2 // Budget is 20% above current cost
            }
          })
        }
        
        // If no cost data, return empty/minimal data
        return months.map(month => ({
          month,
          cost: 0,
          budget: 0
        }))
      })()

  const recentDriftItems: DriftItem[] = stats.drift?.items || [
    { resource: 'droplet-web-01', type: 'Droplet', field: 'size', expected: 's-2vcpu-4gb', actual: 's-4vcpu-8gb', severity: 'high', detected: '2h ago' },
    { resource: 'db-postgres-main', type: 'Database', field: 'backup_enabled', expected: 'true', actual: 'false', severity: 'critical', detected: '4h ago' },
    { resource: 'fw-web-tier', type: 'Firewall', field: 'inbound_rules', expected: '3 rules', actual: '5 rules', severity: 'medium', detected: '1d ago' },
  ]

  const recentPolicyViolations: PolicyViolation[] = stats.policy_violations?.recent?.map((v: any) => ({
    id: v.id,
    rule: v.rule,
    resource: v.resource,
    severity: v.severity,
    category: v.category,
    remediation: v.remediation,
  })) || [
    { id: 'pv-001', rule: 'require-encryption', resource: 'volume-data-01', severity: 'critical', category: 'Security', remediation: 'Enable encryption at rest' },
    { id: 'pv-002', rule: 'cost-threshold', resource: 'droplet-ml-gpu', severity: 'high', category: 'Cost', remediation: 'Review resource sizing' },
    { id: 'pv-003', rule: 'backup-policy', resource: 'db-redis-cache', severity: 'medium', category: 'Data', remediation: 'Configure automated backups' },
  ]

  const pendingChanges: ChangeRisk[] = stats.change_risk?.pending || [
    { id: 'ch-001', change: 'Scale droplet cluster', resource: 'droplet-api-*', riskLevel: 'medium', blastRadius: 3, requiresApproval: true, status: 'pending' },
    { id: 'ch-002', change: 'Update firewall rules', resource: 'fw-database-tier', riskLevel: 'high', blastRadius: 8, requiresApproval: true, status: 'pending' },
    { id: 'ch-003', change: 'Add DNS record', resource: 'domain-api.driftbox.io', riskLevel: 'low', blastRadius: 1, requiresApproval: false, status: 'approved' },
  ]

  // Build a list of all items for navigation
  const allItems: SelectedItem[] = [
    ...recentDriftItems.map((d, i) => ({
      id: `drift-${i}`,
      type: 'drift' as const,
      title: d.resource,
      data: d,
    })),
    ...recentPolicyViolations.map((v) => ({
      id: `policy-${v.id}`,
      type: 'policy' as const,
      title: v.rule,
      data: v,
    })),
    ...pendingChanges.map((c) => ({
      id: `risk-${c.id}`,
      type: 'risk' as const,
      title: c.change,
      data: c,
    })),
  ]

  // Navigation handlers
  const currentIndex = selectedItem ? allItems.findIndex(i => i.id === selectedItem.id) : -1
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < allItems.length - 1

  const goToPrev = () => {
    if (hasPrev) setSelectedItem(allItems[currentIndex - 1])
  }

  const goToNext = () => {
    if (hasNext) setSelectedItem(allItems[currentIndex + 1])
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedItem) return
      if (e.key === 'Escape') setSelectedItem(null)
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); goToPrev() }
      else if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); goToNext() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedItem, currentIndex, hasPrev, hasNext])

  // Show loading state
  if (statsLoading && !dashboardStats) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] p-6 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 text-[#14b8a6] animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#666666]">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-6 relative">
      {/* Detail Panel */}
      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onPrev={goToPrev}
          onNext={goToNext}
          hasPrev={hasPrev}
          hasNext={hasNext}
        />
      )}

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#fafafa]">
            Policy-Driven Infrastructure Control Plane
          </h1>
          <p className="mt-1 text-sm text-[#666666]">
            Continuous governance across the infrastructure lifecycle
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing || statsLoading}
          className="flex items-center gap-2 rounded-md bg-[#14b8a6] px-4 py-2 text-sm font-medium text-white hover:bg-[#0d9488] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing || statsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Top Stats Row */}
      <div className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Managed Resources"
          value={totalResources || repos?.length || 0}
          change={isDoConnected ? 'Synced' : 'Connect DO'}
          changeType="neutral"
          icon={Layers}
          description="Across all providers"
          color="#14b8a6"
          href="/dashboard/settings#integrations"
        />
        <StatCard
          title="Active Drift"
          value={recentDriftItems.length}
          change={stats.drift?.items?.length ? `${recentDriftItems.length} detected` : 'No drift detected'}
          changeType={recentDriftItems.length > 0 ? "negative" : "positive"}
          icon={AlertTriangle}
          description="Resources out of sync"
          color="#ef4444"
          href="/dashboard/drift"
        />
        <StatCard
          title="Policy Violations"
          value={stats.policy?.total_violations || recentPolicyViolations.length}
          change={stats.policy?.total_violations ? `${stats.policy.total_violations} open` : 'All compliant'}
          changeType={stats.policy?.total_violations > 0 ? "negative" : "positive"}
          icon={Shield}
          description="Require remediation"
          color="#f97316"
          href="/dashboard/security"
        />
        <StatCard
          title="Est. Monthly Cost"
          value={`$${estimatedCost.toLocaleString()}`}
          change={estimatedCost > 0 ? 'Active' : 'No data'}
          changeType="neutral"
          icon={DollarSign}
          description="All infrastructure"
          color="#eab308"
          href="/dashboard/cost"
        />
      </div>

      {/* Top Investigations / Issues Row */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#fafafa]">Top Issues</h2>
          <div className="flex items-center gap-2">
            <select className="text-xs bg-[#0f0f0f] border border-[#1f1f1f] rounded px-2 py-1 text-[#666666]">
              <option>Total Count</option>
              <option>By Severity</option>
              <option>By Age</option>
            </select>
            <div className="flex items-center gap-1">
              <button className="p-1 hover:bg-[#1f1f1f] rounded text-[#666666]">
                <ChevronRight className="h-4 w-4 rotate-180" />
              </button>
              <button className="p-1 hover:bg-[#1f1f1f] rounded text-[#666666]">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {(stats.investigations || []).map((inv: any, idx: number) => {
            const iconMap: Record<string, React.ElementType> = {
              'Security Misconfigurations': Shield,
              'Infrastructure Drift': AlertTriangle,
              'Cost Anomalies': DollarSign,
              'Policy Violations': FileCheck,
            }
            const colorMap: Record<string, string> = {
              'Security Misconfigurations': '#ef4444',
              'Infrastructure Drift': '#f97316',
              'Cost Anomalies': '#eab308',
              'Policy Violations': '#8b5cf6',
            }
            const Icon = iconMap[inv.title] || Shield
            const color = colorMap[inv.title] || '#3b82f6'
            
            return (
              <InvestigationCard
                key={idx}
                title={inv.title}
                source={inv.source}
                sourceIcon={Icon}
                sourceColor={color}
                open={inv.open}
                total={inv.total}
                mttr={inv.mttr}
                trendData={inv.trend || [0, 0, 0, 0, 0, 0, 0]}
                trendColor={inv.open > 0 ? '#3b82f6' : '#22c55e'}
                onClick={() => setSelectedItem({
                  id: `inv-${idx}`,
                  type: 'investigation',
                  title: inv.title,
                  data: inv
                })}
              />
            )
          })}
        </div>
      </div>

      {/* Main Grid - Control Plane Overview */}
      <div className="grid gap-6 lg:grid-cols-3 mb-6">
        {/* Control Plane Architecture */}
        <ControlPlaneArchitecture />
        
        {/* Lifecycle Governance - spans 2 columns */}
        <div className="lg:col-span-2">
          <LifecycleGovernanceStatus phases={lifecyclePhases} />
        </div>
      </div>

      {/* DigitalOcean Infrastructure */}
      {isDoConnected ? (
        <div className="mb-6">
          <DigitalOceanPanel
            summary={doSummary}
            loading={doLoading}
            error={doError}
            onRefresh={fetchDoSummary}
          />
        </div>
      ) : (
        <div className="mb-6">
          <ConnectDigitalOceanCTA />
        </div>
      )}

      {/* Drift, Policy, Risk Row */}
      <div className="grid gap-6 lg:grid-cols-3 mb-6">
        <DriftDetectionPanel data={driftData} items={recentDriftItems} onItemClick={setSelectedItem} />
        <PolicyComplianceCard data={policyComplianceData} violations={recentPolicyViolations} onItemClick={setSelectedItem} />
        <RiskAssessmentPanel distribution={changeRiskDistribution} changes={pendingChanges} onItemClick={setSelectedItem} />
      </div>

      {/* Cost & Activity Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Cost Tracking */}
        <CostTrackingPanel data={costTrendData} currentCost={estimatedCost} />

        {/* Recent Activity / Audit Trail */}
        <div className="rounded-lg bg-[#0f0f0f] p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[#14b8a6]" />
              <h3 className="font-medium text-[#fafafa]">Audit Trail</h3>
            </div>
            <Link href="/dashboard/audit" className="text-xs text-[#14b8a6] hover:text-[#0d9488] flex items-center gap-1">
              Full history <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-[#1f1f1f]">
            {stats.recent_activity && stats.recent_activity.length > 0 ? (
              stats.recent_activity.map((activity: any, idx: number) => (
                <ActivityItem
                  key={idx}
                  user={activity.user}
                  action={activity.action}
                  target={activity.target}
                  time={activity.time}
                  type={activity.type as 'approve' | 'create' | 'run' | 'fix' | 'alert'}
                />
              ))
            ) : (
              <>
                <ActivityItem
                  user="System"
                  action="detected drift in"
                  target="No activity yet"
                  time="Just now"
                  type="alert"
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats Footer */}
      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg bg-[#0f0f0f] p-4">
          <div className="flex items-center gap-2 mb-2">
            <FolderGit2 className="h-4 w-4 text-[#666666]" />
            <span className="text-xs text-[#666666]">Connected Repos</span>
          </div>
          <p className="text-xl font-semibold text-[#fafafa]">{repos?.length || stats.quick_stats?.connected_repos || 0}</p>
        </div>
        <div className="rounded-lg bg-[#0f0f0f] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4 text-[#666666]" />
            <span className="text-xs text-[#666666]">Active Teams</span>
          </div>
          <p className="text-xl font-semibold text-[#fafafa]">{stats.teams?.active || stats.quick_stats?.active_teams || 0}</p>
        </div>
        <div className="rounded-lg bg-[#0f0f0f] p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="h-4 w-4 text-[#666666]" />
            <span className="text-xs text-[#666666]">Sandbox Pass Rate</span>
          </div>
          <p className="text-xl font-semibold text-[#22c55e]">{stats.sandbox?.pass_rate || stats.quick_stats?.sandbox_pass_rate || 0}%</p>
        </div>
        <div className="rounded-lg bg-[#0f0f0f] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-[#666666]" />
            <span className="text-xs text-[#666666]">Avg. Resolution Time</span>
          </div>
          <p className="text-xl font-semibold text-[#fafafa]">{stats.quick_stats?.avg_resolution_time || '4.2h'}</p>
        </div>
      </div>
    </div>
  )
}
