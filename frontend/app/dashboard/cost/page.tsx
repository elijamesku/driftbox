'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import Link from 'next/link'
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Wallet,
  RefreshCw,
  Server,
  Database,
  HardDrive,
  Globe,
  Cloud,
  Shield,
  Loader2,
  ChevronRight,
  ChevronDown,
  Calendar,
  Clock,
  Zap,
  PiggyBank,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  Info,
  CheckCircle,
  AlertCircle,
  Receipt,
  CreditCard,
} from 'lucide-react'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
  AreaChart,
  Area,
} from 'recharts'

// ===== Types =====
interface CostCategory {
  name: string
  total: number
  count: number
  color: string
}

interface ResourceCost {
  id: string
  name: string
  type: string
  category: string
  size?: string
  region?: string
  status?: string
  monthly_cost: number
  hourly_cost: number
  created_at?: string
  specs?: Record<string, any>
}

interface Invoice {
  invoice_uuid: string
  invoice_period?: string
  amount?: string
  product_charges?: Record<string, any>
  overages?: Record<string, any>
  taxes?: string
  credits_and_adjustments?: Record<string, any>
}

interface Subscription {
  last_invoice_amount?: string
  last_invoice_date?: string
  description?: string
  invoice_id?: string
  invoice_uuid?: string
}

interface UpcomingBill {
  projected_total: number
  projected_remaining: number
  days_remaining: number
  days_elapsed: number
  days_in_month: number
  daily_rate: number
  next_billing_date: string
  month_to_date_actual: number | null
}

interface CostData {
  summary: {
    total_monthly: number
    total_hourly: number
    resource_count: number
  }
  by_category: CostCategory[]
  by_resource: ResourceCost[]
  invoices?: Invoice[]
  subscription?: Subscription
  upcoming?: UpcomingBill
  billing: any[]
  balance: {
    month_to_date_balance: string
    account_balance: string
    month_to_date_usage: string
    generated_at: string
  } | null
}

// ===== Helper Functions =====
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(amount)
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

const getResourceIcon = (type: string) => {
  switch (type) {
    case 'Droplet': return Server
    case 'Database': return Database
    case 'Kubernetes': return Cloud
    case 'Load Balancer': return Globe
    case 'Volume': return HardDrive
    case 'App': return Zap
    default: return Server
  }
}

// ===== Components =====

// Summary Stat Card
function CostStatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  color = '#14b8a6'
}: {
  title: string
  value: string
  subtitle?: string
  icon: React.ElementType
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  color?: string
}) {
  return (
    <div className="rounded-lg bg-[#0f0f0f] p-5">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-[#666666]">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-[#fafafa]">{value}</p>
          {(trendValue || subtitle) && (
            <div className="mt-2 flex items-center gap-2">
              {trend && trendValue && (
                <span className={`flex items-center gap-1 text-xs ${
                  trend === 'up' ? 'text-[#ef4444]' : trend === 'down' ? 'text-[#22c55e]' : 'text-[#666666]'
                }`}>
                  {trend === 'up' ? <ArrowUpRight className="h-3 w-3" /> : 
                   trend === 'down' ? <ArrowDownRight className="h-3 w-3" /> : null}
                  {trendValue}
                </span>
              )}
              {subtitle && <span className="text-xs text-[#666666]">{subtitle}</span>}
            </div>
          )}
        </div>
        <div className="rounded-lg p-2" style={{ backgroundColor: `${color}15` }}>
          <Icon className="h-5 w-5" style={{ color }} />
        </div>
      </div>
    </div>
  )
}

// Cost by Category Chart
function CategoryBreakdownChart({ data }: { data: CostCategory[] }) {
  const total = data.reduce((acc, d) => acc + d.total, 0)
  
  return (
    <div className="rounded-lg bg-[#0f0f0f] p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-medium text-[#fafafa]">Cost by Service</h3>
          <p className="text-xs text-[#666666] mt-1">Monthly breakdown by resource type</p>
        </div>
        <span className="text-lg font-semibold text-[#fafafa]">{formatCurrency(total)}</span>
      </div>
      
      <div className="flex gap-6">
        {/* Donut Chart */}
        <div className="w-44 h-44">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={70}
                paddingAngle={2}
                dataKey="total"
                nameKey="name"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: '8px' }}
                formatter={(value: number) => [formatCurrency(value), '']}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        
        {/* Legend */}
        <div className="flex-1 space-y-3">
          {data.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-sm text-[#a1a1a1]">{item.name}</span>
                <span className="text-xs text-[#666666]">({item.count})</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-[#fafafa]">{formatCurrency(item.total)}</span>
                <span className="text-xs text-[#666666] w-12 text-right">
                  {total > 0 ? Math.round((item.total / total) * 100) : 0}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Stacked bar visualization */}
      <div className="mt-4 h-3 bg-[#1f1f1f] rounded-full overflow-hidden flex">
        {data.map((item, idx) => (
          <div
            key={idx}
            className="h-full transition-all"
            style={{
              width: `${total > 0 ? (item.total / total) * 100 : 0}%`,
              backgroundColor: item.color
            }}
          />
        ))}
      </div>
    </div>
  )
}

// Resource Cost Table
function ResourceCostTable({ resources }: { resources: ResourceCost[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'cost' | 'name'>('cost')
  
  const sortedResources = [...resources].sort((a, b) => {
    if (sortBy === 'cost') return b.monthly_cost - a.monthly_cost
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="rounded-lg bg-[#0f0f0f]">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1f1f]">
        <div>
          <h3 className="font-medium text-[#fafafa]">Resource Cost Details</h3>
          <p className="text-xs text-[#666666] mt-1">{resources.length} billable resources</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#666666]">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'cost' | 'name')}
            className="text-xs bg-[#0a0a0a] border border-[#1f1f1f] rounded px-2 py-1 text-[#a1a1a1]"
          >
            <option value="cost">Highest Cost</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>
      
      <div className="divide-y divide-[#1f1f1f]">
        {sortedResources.slice(0, 10).map((resource) => {
          const Icon = getResourceIcon(resource.type)
          const isExpanded = expanded === resource.id
          
          return (
            <div key={resource.id} className="px-5 py-3">
              <div 
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setExpanded(isExpanded ? null : resource.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-[#0a0a0a] p-2">
                    <Icon className="h-4 w-4 text-[#14b8a6]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#fafafa]">{resource.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-[#666666]">{resource.type}</span>
                      {resource.size && (
                        <span className="text-xs text-[#666666]">• {resource.size}</span>
                      )}
                      {resource.region && (
                        <span className="text-xs text-[#666666]">• {resource.region}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-[#fafafa]">{formatCurrency(resource.monthly_cost)}</p>
                    <p className="text-xs text-[#666666]">{formatCurrency(resource.hourly_cost)}/hr</p>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-[#666666] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>
              </div>
              
              {isExpanded && resource.specs && (
                <div className="mt-3 ml-11 p-3 rounded bg-[#0a0a0a]">
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    {Object.entries(resource.specs).map(([key, value]) => (
                      <div key={key}>
                        <span className="text-[#666666]">{key.replace(/_/g, ' ')}</span>
                        <p className="text-[#a1a1a1] mt-0.5">{String(value) || '-'}</p>
                      </div>
                    ))}
                    {resource.created_at && (
                      <div>
                        <span className="text-[#666666]">Created</span>
                        <p className="text-[#a1a1a1] mt-0.5">{formatDate(resource.created_at)}</p>
                      </div>
                    )}
                    {resource.status && (
                      <div>
                        <span className="text-[#666666]">Status</span>
                        <p className={`mt-0.5 ${resource.status === 'active' ? 'text-[#22c55e]' : 'text-[#a1a1a1]'}`}>
                          {resource.status}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      
      {resources.length > 10 && (
        <div className="px-5 py-3 border-t border-[#1f1f1f]">
          <button className="text-xs text-[#14b8a6] hover:text-[#0d9488] flex items-center gap-1">
            View all {resources.length} resources <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}

// Optimization Recommendations
function OptimizationRecommendations({ resources }: { resources: ResourceCost[] }) {
  // Generate recommendations based on actual resources
  const recommendations = []
  
  // Check for oversized droplets (simple heuristic)
  const largeDroplets = resources.filter(r => r.type === 'Droplet' && r.monthly_cost > 40)
  if (largeDroplets.length > 0) {
    recommendations.push({
      title: 'Review large Droplet sizing',
      description: `${largeDroplets.length} droplet(s) cost over $40/mo. Consider rightsizing if underutilized.`,
      savings: Math.round(largeDroplets.reduce((a, d) => a + d.monthly_cost * 0.3, 0)),
      priority: 'medium'
    })
  }
  
  // Check for unused volumes (no attachment info available, so estimate)
  const volumes = resources.filter(r => r.type === 'Volume')
  if (volumes.length > 0) {
    recommendations.push({
      title: 'Audit block storage volumes',
      description: `Review ${volumes.length} volume(s) for unused or oversized storage.`,
      savings: Math.round(volumes.reduce((a, v) => a + v.monthly_cost * 0.2, 0)),
      priority: 'low'
    })
  }
  
  // Check for multiple load balancers
  const lbs = resources.filter(r => r.type === 'Load Balancer')
  if (lbs.length > 1) {
    recommendations.push({
      title: 'Consolidate Load Balancers',
      description: `You have ${lbs.length} load balancers. Consider consolidating if possible.`,
      savings: (lbs.length - 1) * 12,
      priority: 'medium'
    })
  }
  
  // General recommendation
  recommendations.push({
    title: 'Enable Reserved Capacity',
    description: 'Lock in 1-year pricing for predictable workloads to save up to 20%.',
    savings: Math.round(resources.reduce((a, r) => a + r.monthly_cost, 0) * 0.15),
    priority: 'high'
  })
  
  const totalSavings = recommendations.reduce((a, r) => a + r.savings, 0)
  
  const priorityColors = {
    high: '#22c55e',
    medium: '#eab308',
    low: '#3b82f6'
  }
  
  return (
    <div className="rounded-lg bg-[#0f0f0f] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <PiggyBank className="h-4 w-4 text-[#22c55e]" />
          <h3 className="font-medium text-[#fafafa]">Optimization Opportunities</h3>
        </div>
        <span className="text-sm font-medium text-[#22c55e]">
          Potential: {formatCurrency(totalSavings)}/mo
        </span>
      </div>
      
      <div className="space-y-3">
        {recommendations.map((rec, idx) => (
          <div 
            key={idx} 
            className="p-3 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] hover:border-[#22c55e]/30 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span 
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: priorityColors[rec.priority as keyof typeof priorityColors] }}
                  />
                  <p className="text-sm font-medium text-[#fafafa]">{rec.title}</p>
                </div>
                <p className="text-xs text-[#666666] mt-1 ml-4">{rec.description}</p>
              </div>
              <span className="text-sm font-medium text-[#22c55e]">
                Save {formatCurrency(rec.savings)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Upcoming Bill Card
function UpcomingBillCard({ upcoming, budget, onSetBudget }: { 
  upcoming: UpcomingBill | undefined
  budget: number | null
  onSetBudget: (amount: number | null) => void 
}) {
  const [isEditingBudget, setIsEditingBudget] = useState(false)
  const [budgetInput, setBudgetInput] = useState(budget?.toString() || '')
  
  if (!upcoming) return null
  
  const projectedTotal = upcoming.projected_total
  const isOverBudget = budget && projectedTotal > budget
  const isNearBudget = budget && projectedTotal > budget * 0.8 && projectedTotal <= budget
  const budgetPercentage = budget ? Math.min((projectedTotal / budget) * 100, 100) : 0
  
  const handleSaveBudget = () => {
    const amount = parseFloat(budgetInput)
    if (!isNaN(amount) && amount > 0) {
      onSetBudget(amount)
      localStorage.setItem('do-budget-limit', amount.toString())
    } else if (budgetInput === '') {
      onSetBudget(null)
      localStorage.removeItem('do-budget-limit')
    }
    setIsEditingBudget(false)
  }
  
  return (
    <div className="rounded-lg bg-[#0f0f0f] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-[#f97316]" />
          <h3 className="font-medium text-[#fafafa]">Upcoming Bill</h3>
        </div>
        <span className="text-xs text-[#666666]">
          Next billing: {upcoming.next_billing_date}
        </span>
      </div>
      
      {/* Projected Total */}
      <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f] mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[#666666]">Projected Total</span>
          <span className="text-xs text-[#666666]">{upcoming.days_remaining} days left</span>
        </div>
        <p className={`text-2xl font-semibold ${isOverBudget ? 'text-[#ef4444]' : isNearBudget ? 'text-[#eab308]' : 'text-[#fafafa]'}`}>
          {formatCurrency(projectedTotal)}
        </p>
        
        {/* Budget Progress Bar */}
        {budget && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[#666666]">Budget: {formatCurrency(budget)}</span>
              <span className={isOverBudget ? 'text-[#ef4444]' : isNearBudget ? 'text-[#eab308]' : 'text-[#22c55e]'}>
                {Math.round(budgetPercentage)}%
              </span>
            </div>
            <div className="h-2 bg-[#1f1f1f] rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all ${
                  isOverBudget ? 'bg-[#ef4444]' : isNearBudget ? 'bg-[#eab308]' : 'bg-[#22c55e]'
                }`}
                style={{ width: `${Math.min(budgetPercentage, 100)}%` }}
              />
            </div>
            {isOverBudget && (
              <p className="text-xs text-[#ef4444] mt-2 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {formatCurrency(projectedTotal - budget)} over budget
              </p>
            )}
          </div>
        )}
      </div>
      
      {/* Breakdown */}
      <div className="space-y-2 mb-4">
        {upcoming.month_to_date_actual !== null && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#666666]">Month-to-date (actual)</span>
            <span className="text-[#fafafa]">{formatCurrency(upcoming.month_to_date_actual)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-[#666666]">Projected remaining</span>
          <span className="text-[#a1a1a1]">+{formatCurrency(upcoming.projected_remaining)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-[#666666]">Daily rate</span>
          <span className="text-[#a1a1a1]">{formatCurrency(upcoming.daily_rate)}/day</span>
        </div>
      </div>
      
      {/* Budget Setting */}
      <div className="pt-4 border-t border-[#1f1f1f]">
        {isEditingBudget ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666666]">$</span>
              <input
                type="number"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                placeholder="Set budget limit"
                className="w-full pl-7 pr-3 py-2 text-sm bg-[#0a0a0a] border border-[#1f1f1f] rounded-md text-[#fafafa] focus:outline-none focus:border-[#14b8a6]"
                autoFocus
              />
            </div>
            <button
              onClick={handleSaveBudget}
              className="px-3 py-2 text-sm bg-[#14b8a6] text-white rounded-md hover:bg-[#0d9488]"
            >
              Save
            </button>
            <button
              onClick={() => {
                setIsEditingBudget(false)
                setBudgetInput(budget?.toString() || '')
              }}
              className="px-3 py-2 text-sm text-[#666666] hover:text-[#a1a1a1]"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsEditingBudget(true)}
            className="w-full flex items-center justify-center gap-2 p-2 text-sm text-[#14b8a6] hover:text-[#0d9488] bg-[#14b8a6]/5 hover:bg-[#14b8a6]/10 rounded-md border border-[#14b8a6]/20 transition-colors"
          >
            <Wallet className="h-4 w-4" />
            {budget ? `Budget: ${formatCurrency(budget)}` : 'Set Budget Limit'}
          </button>
        )}
      </div>
    </div>
  )
}

// Invoice Details - Shows actual subscription charges
function InvoiceDetails({ invoices, subscription }: { invoices: Invoice[], subscription: Subscription | null }) {
  if ((!invoices || invoices.length === 0) && !subscription) {
    return null
  }
  
  return (
    <div className="rounded-lg bg-[#0f0f0f] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-[#8b5cf6]" />
          <h3 className="font-medium text-[#fafafa]">Subscription & Invoices</h3>
        </div>
        {subscription?.last_invoice_amount && (
          <span className="text-sm font-medium text-[#fafafa]">
            Last: {formatCurrency(parseFloat(subscription.last_invoice_amount))}
          </span>
        )}
      </div>
      
      {/* Latest Invoice Summary */}
      {subscription && (
        <div className="p-3 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f] mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#666666]">Latest Invoice</span>
            {subscription.last_invoice_date && (
              <span className="text-xs text-[#666666]">{formatDate(subscription.last_invoice_date)}</span>
            )}
          </div>
          <p className="text-lg font-semibold text-[#fafafa]">
            {subscription.last_invoice_amount ? formatCurrency(parseFloat(subscription.last_invoice_amount)) : '-'}
          </p>
          {subscription.description && (
            <p className="text-xs text-[#666666] mt-1">{subscription.description}</p>
          )}
        </div>
      )}
      
      {/* Invoice Breakdown */}
      {invoices && invoices.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-[#666666] font-medium uppercase tracking-wider">Invoice History</p>
          {invoices.map((inv, idx) => (
            <div key={idx} className="p-3 rounded bg-[#0a0a0a]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-[#fafafa]">{inv.invoice_period || 'Invoice'}</span>
                <span className="text-sm font-medium text-[#fafafa]">
                  {inv.amount ? formatCurrency(parseFloat(inv.amount)) : '-'}
                </span>
              </div>
              
              {/* Product charges breakdown */}
              {inv.product_charges && Object.keys(inv.product_charges).length > 0 && (
                <div className="mt-2 pt-2 border-t border-[#1f1f1f] space-y-1">
                  {Object.entries(inv.product_charges).map(([product, details]: [string, any]) => (
                    <div key={product} className="flex items-center justify-between text-xs">
                      <span className="text-[#666666] capitalize">{product.replace(/_/g, ' ')}</span>
                      <span className="text-[#a1a1a1]">
                        {details?.amount ? formatCurrency(parseFloat(details.amount)) : '-'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Taxes and credits */}
              {(inv.taxes || inv.credits_and_adjustments) && (
                <div className="mt-2 pt-2 border-t border-[#1f1f1f] space-y-1">
                  {inv.taxes && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#666666]">Taxes</span>
                      <span className="text-[#a1a1a1]">{formatCurrency(parseFloat(inv.taxes))}</span>
                    </div>
                  )}
                  {inv.credits_and_adjustments && Object.keys(inv.credits_and_adjustments).length > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#666666]">Credits/Adjustments</span>
                      <span className="text-[#22c55e]">
                        -{formatCurrency(Math.abs(parseFloat(inv.credits_and_adjustments.amount || '0')))}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      
      <a
        href="https://cloud.digitalocean.com/account/billing"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 flex items-center justify-center gap-1 text-xs text-[#0080FF] hover:text-[#0066CC] p-2 rounded bg-[#0080FF]/5 border border-[#0080FF]/20"
      >
        View Full Billing in DigitalOcean <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  )
}

// Billing History
function BillingHistory({ billing }: { billing: any[] }) {
  if (!billing || billing.length === 0) {
    return (
      <div className="rounded-lg bg-[#0f0f0f] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Receipt className="h-4 w-4 text-[#14b8a6]" />
          <h3 className="font-medium text-[#fafafa]">Payment History</h3>
        </div>
        <p className="text-sm text-[#666666]">No payment history available</p>
      </div>
    )
  }
  
  return (
    <div className="rounded-lg bg-[#0f0f0f] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-[#14b8a6]" />
          <h3 className="font-medium text-[#fafafa]">Payment History</h3>
        </div>
        <a
          href="https://cloud.digitalocean.com/account/billing"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[#0080FF] hover:text-[#0066CC] flex items-center gap-1"
        >
          View in DO Console <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      
      <div className="space-y-2">
        {billing.slice(0, 6).map((item, idx) => (
          <div key={idx} className="flex items-center justify-between p-2 rounded bg-[#0a0a0a]">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${
                item.type === 'Invoice' ? 'bg-[#3b82f6]' : 
                item.type === 'Payment' ? 'bg-[#22c55e]' : 'bg-[#666666]'
              }`} />
              <div>
                <p className="text-sm text-[#fafafa]">{item.description || item.type}</p>
                <p className="text-xs text-[#666666]">{formatDate(item.date)}</p>
              </div>
            </div>
            <span className={`text-sm font-medium ${
              item.type === 'Payment' ? 'text-[#22c55e]' : 'text-[#fafafa]'
            }`}>
              {item.type === 'Payment' ? '-' : ''}{formatCurrency(Math.abs(parseFloat(item.amount || 0)))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Connect DO CTA
function ConnectDigitalOceanCTA() {
  return (
    <div className="rounded-lg bg-gradient-to-r from-[#0080FF]/10 via-[#0080FF]/5 to-transparent border border-[#0080FF]/20 p-8 text-center">
      <Cloud className="h-12 w-12 text-[#0080FF] mx-auto mb-4" />
      <h3 className="text-xl font-medium text-[#fafafa] mb-2">Connect DigitalOcean</h3>
      <p className="text-sm text-[#666666] mb-6 max-w-md mx-auto">
        Connect your DigitalOcean account to see real-time cost data, resource breakdown, and optimization recommendations.
      </p>
      <Link
        href="/dashboard/settings#integrations"
        className="inline-flex items-center gap-2 rounded-md bg-[#0080FF] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#0066CC] transition-colors"
      >
        Connect Now
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  )
}

// Fetch function for cost data
const fetchCostData = async (): Promise<CostData> => {
  const token = localStorage.getItem('token')
  const response = await fetch(getApiEndpoint('/digitalocean/costs'), {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
  
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('DigitalOcean not connected')
    }
    throw new Error('Failed to fetch cost data')
  }
  
  return response.json()
}

// ===== Main Page Component =====
export default function CostPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [timeRange, setTimeRange] = useState('month')
  const [budgetLimit, setBudgetLimit] = useState<number | null>(null)
  
  const isDoConnected = user?.digitalocean_connected || (typeof window !== 'undefined' && localStorage.getItem('digitalocean_connected') === 'true')
  
  // TanStack Query for cost data - cached and "hot"
  const { 
    data: costData, 
    isLoading: loading, 
    error: queryError,
    refetch: refetchCostData 
  } = useQuery({
    queryKey: ['digitalocean-costs'],
    queryFn: fetchCostData,
    enabled: !!isDoConnected,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes cache
  })
  
  const error = queryError?.message || null
  
  // Load budget from localStorage on mount
  useEffect(() => {
    const savedBudget = localStorage.getItem('do-budget-limit')
    if (savedBudget) {
      setBudgetLimit(parseFloat(savedBudget))
    }
  }, [])
  
  // Calculate additional metrics
  const monthToDateUsage = costData?.balance ? parseFloat(costData.balance.month_to_date_usage || '0') : 0
  const accountBalance = costData?.balance ? parseFloat(costData.balance.account_balance || '0') : 0
  const estimatedMonthly = costData?.summary?.total_monthly || 0
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  const dayOfMonth = new Date().getDate()
  const projectedMonthly = monthToDateUsage > 0 ? (monthToDateUsage / dayOfMonth) * daysInMonth : estimatedMonthly
  
  return (
    <div className="min-h-screen bg-[#0a0a0a] p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#fafafa]">Cost Management</h1>
          <p className="mt-1 text-sm text-[#666666]">
            DigitalOcean infrastructure spending & optimization
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] px-3 py-2 text-sm text-[#a1a1a1] focus:outline-none focus:border-[#14b8a6]"
          >
            <option value="month">This Month</option>
            <option value="last_month">Last Month</option>
            <option value="quarter">Last 3 Months</option>
          </select>
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['digitalocean-costs'] })
              refetchCostData()
            }}
            disabled={loading}
            className="flex items-center gap-2 rounded-md bg-[#14b8a6] px-4 py-2 text-sm font-medium text-white hover:bg-[#0d9488] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Not Connected State */}
      {!isDoConnected && !loading && (
        <ConnectDigitalOceanCTA />
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-10 w-10 text-[#14b8a6] animate-spin mb-4" />
          <p className="text-sm text-[#666666]">Loading cost data from DigitalOcean...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/20 p-6 text-center">
          <AlertCircle className="h-10 w-10 text-[#ef4444] mx-auto mb-3" />
          <p className="text-[#ef4444] mb-3">{error}</p>
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['digitalocean-costs'] })
              refetchCostData()
            }}
            className="text-sm text-[#14b8a6] hover:text-[#0d9488]"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Main Content */}
      {isDoConnected && costData && !loading && (
        <>
          {/* Summary Stats */}
          <div className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <CostStatCard
              title="Month-to-Date"
              value={formatCurrency(monthToDateUsage)}
              subtitle={`Day ${dayOfMonth} of ${daysInMonth}`}
              icon={Calendar}
              color="#14b8a6"
            />
            <CostStatCard
              title="Estimated Monthly"
              value={formatCurrency(estimatedMonthly)}
              subtitle={`${costData.summary.resource_count} resources`}
              icon={DollarSign}
              color="#0080FF"
            />
            <CostStatCard
              title="Projected End of Month"
              value={formatCurrency(projectedMonthly)}
              trend={projectedMonthly > estimatedMonthly ? 'up' : 'down'}
              trendValue={`${Math.round(((projectedMonthly - estimatedMonthly) / estimatedMonthly) * 100)}% vs estimate`}
              icon={TrendingUp}
              color="#8b5cf6"
            />
            <CostStatCard
              title="Account Balance"
              value={formatCurrency(Math.abs(accountBalance))}
              subtitle={accountBalance < 0 ? 'Credit available' : 'Amount due'}
              icon={CreditCard}
              color={accountBalance < 0 ? '#22c55e' : '#eab308'}
            />
          </div>

          {/* Main Grid */}
          <div className="grid gap-6 lg:grid-cols-2 mb-6">
            {/* Cost by Category */}
            <CategoryBreakdownChart data={costData.by_category} />
            
            {/* Optimization Recommendations */}
            <OptimizationRecommendations resources={costData.by_resource} />
          </div>

          {/* Upcoming Bill + Budget */}
          <div className="mb-6">
            <UpcomingBillCard 
              upcoming={costData.upcoming}
              budget={budgetLimit}
              onSetBudget={setBudgetLimit}
            />
          </div>

          {/* Resource Details + Subscription */}
          <div className="grid gap-6 lg:grid-cols-3 mb-6">
            <div className="lg:col-span-2">
              <ResourceCostTable resources={costData.by_resource} />
            </div>
            <div className="space-y-6">
              {/* Invoice/Subscription Details */}
              <InvoiceDetails 
                invoices={costData.invoices || []} 
                subscription={costData.subscription || null} 
              />
              {/* Payment History */}
              <BillingHistory billing={costData.billing || []} />
            </div>
          </div>

          {/* Footer Stats */}
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-[#0f0f0f] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Server className="h-4 w-4 text-[#666666]" />
                <span className="text-xs text-[#666666]">Compute</span>
              </div>
              <p className="text-xl font-semibold text-[#fafafa]">
                {formatCurrency(costData.by_category.filter(c => c.name === 'Droplets' || c.name === 'Kubernetes').reduce((a, c) => a + c.total, 0))}
              </p>
            </div>
            <div className="rounded-lg bg-[#0f0f0f] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Database className="h-4 w-4 text-[#666666]" />
                <span className="text-xs text-[#666666]">Database</span>
              </div>
              <p className="text-xl font-semibold text-[#fafafa]">
                {formatCurrency(costData.by_category.find(c => c.name === 'Databases')?.total || 0)}
              </p>
            </div>
            <div className="rounded-lg bg-[#0f0f0f] p-4">
              <div className="flex items-center gap-2 mb-2">
                <HardDrive className="h-4 w-4 text-[#666666]" />
                <span className="text-xs text-[#666666]">Storage</span>
              </div>
              <p className="text-xl font-semibold text-[#fafafa]">
                {formatCurrency(costData.by_category.find(c => c.name === 'Volumes')?.total || 0)}
              </p>
            </div>
            <div className="rounded-lg bg-[#0f0f0f] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Globe className="h-4 w-4 text-[#666666]" />
                <span className="text-xs text-[#666666]">Networking</span>
              </div>
              <p className="text-xl font-semibold text-[#fafafa]">
                {formatCurrency(costData.by_category.find(c => c.name === 'Load Balancers')?.total || 0)}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
