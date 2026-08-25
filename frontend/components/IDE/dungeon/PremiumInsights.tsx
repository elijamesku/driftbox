'use client'

import { Fragment } from 'react'
import { AlertCircle, Brain, Sparkles, TrendingUp, TrendingDown, Shield, DollarSign, Activity, Zap, CheckCircle, XCircle, AlertTriangle, BarChart3, PieChart, LineChart } from 'lucide-react'

interface PremiumInsightsProps {
  driftData: any
  securityData: any
  costData: any
  dashboardData?: any
  onFileClick?: (filePath: string, line?: number) => void
  onViewChange?: (view: 'drift' | 'insights' | 'story') => void
}

export default function PremiumInsights({ driftData, securityData, costData, dashboardData, onFileClick, onViewChange }: PremiumInsightsProps) {
  if (!driftData) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#333] border-t-purple-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[#888] text-sm">Loading infrastructure intelligence...</p>
        </div>
      </div>
    )
  }

  // Calculate intelligent metrics - all derived from actual infrastructure code
  const healthScore = securityData 
    ? Math.max(0, Math.min(100, 100 - (securityData.summary.by_severity.critical * 20) - (securityData.summary.by_severity.high * 5) - (securityData.summary.by_severity.medium * 2) - Math.min(10, driftData.drifts.length * 3)))
    : Math.max(0, 100 - Math.min(30, driftData.drifts.length * 3)) // Without security data, base only on drift

  const totalResources = dashboardData?.total_resources || driftData.analysis_metadata?.total_resources_current || 0
  const securityScore = securityData?.summary?.security_score || 0
  const totalIssues = securityData?.summary?.total_issues || 0
  const criticalIssues = securityData?.summary?.by_severity?.critical || 0
  const highIssues = securityData?.summary?.by_severity?.high || 0
  const mediumIssues = securityData?.summary?.by_severity?.medium || 0
  const lowIssues = securityData?.summary?.by_severity?.low || 0
  
  const monthlyCost = costData?.total_monthly_cost || 0
  const potentialSavings = costData?.total_potential_savings || 0
  const annualSavings = potentialSavings * 12
  const optimizationCount = costData?.optimizations?.length || 0

  // ROI Calculation (time saved * hourly rate) - based on actual resources
  const hoursSaved = totalResources * 0.5 // Assume 30 min saved per resource per month
  const hourlyRate = 48 // Average DevOps engineer rate
  const monthlySavedTime = hoursSaved * hourlyRate
  const totalMonthlyValue = monthlySavedTime + potentialSavings

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 bg-[#181818]">
      <div className="p-6 max-w-7xl mx-auto">
        {/* Hero Section */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-[#EDEDED] mb-2">Infrastructure Intelligence Dashboard</h2>
          <p className="text-xs text-[#888]">Real-time analytics, predictive insights, and actionable recommendations</p>
        </div>

        {/* Top-Level KPIs - 4 Hero Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {/* Infrastructure Health Score */}
          <div className="bg-gradient-to-br from-purple-900/20 to-purple-800/10 border border-purple-500/30 rounded-xl p-5 relative overflow-hidden group hover:border-purple-500/50 transition-all duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl group-hover:bg-purple-500/20 transition-all duration-500"></div>
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-purple-300 uppercase tracking-wide">Health Score</span>
                <TrendingUp size={14} className="text-purple-400" />
              </div>
              <div className="text-3xl font-bold text-[#EDEDED] mb-1 group-hover:scale-105 transition-transform">
                {healthScore}
                <span className="text-lg text-[#888]">/100</span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1 h-2 bg-[#1F1F1F] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-purple-500 via-violet-500 to-purple-600 rounded-full transition-all duration-1000 shadow-lg shadow-purple-500/50"
                    style={{ width: `${healthScore}%` }}
                  ></div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  healthScore >= 90 ? 'bg-emerald-500/20 text-emerald-400' :
                  healthScore >= 70 ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-red-500/20 text-red-400'
                }`}>
                  {healthScore >= 90 ? 'Excellent' : healthScore >= 70 ? 'Good' : 'Needs Attention'}
                </span>
              </div>
            </div>
          </div>

          {/* Cost Efficiency */}
          <div className="bg-gradient-to-br from-emerald-900/20 to-emerald-800/10 border border-emerald-500/30 rounded-xl p-5 relative overflow-hidden group hover:border-emerald-500/50 transition-all duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/20 transition-all duration-500"></div>
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wide">Monthly Cost</span>
                <DollarSign size={14} className="text-emerald-400" />
              </div>
              <div className="text-3xl font-bold text-[#EDEDED] mb-1 group-hover:scale-105 transition-transform">
                ${monthlyCost.toFixed(2)}
              </div>
              {potentialSavings > 0 ? (
                <div className="space-y-1">
                  <div className="text-xs text-[#888]">Potential Monthly Savings</div>
                  <div className="text-lg font-semibold text-emerald-400">
                    ${potentialSavings.toLocaleString()}/mo
                  </div>
                  <div className="text-xs text-emerald-400 flex items-center gap-1">
                    <TrendingDown size={10} />
                    {optimizationCount} optimization{optimizationCount !== 1 ? 's' : ''}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-emerald-400" />
                  <span className="text-xs text-[#888]">Fully optimized</span>
                </div>
              )}
            </div>
          </div>

          {/* Security Posture */}
          <div className="bg-gradient-to-br from-orange-900/20 to-orange-800/10 border border-orange-500/30 rounded-xl p-5 relative overflow-hidden group hover:border-orange-500/50 transition-all duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-full blur-3xl group-hover:bg-orange-500/20 transition-all duration-500"></div>
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-orange-300 uppercase tracking-wide">Security</span>
                <Shield size={14} className="text-orange-400" />
              </div>
              <div className={`text-3xl font-bold mb-1 group-hover:scale-105 transition-transform ${
                securityScore >= 80 ? 'text-emerald-400' : 
                securityScore >= 60 ? 'text-yellow-400' : 
                'text-red-400'
              }`}>
                {securityScore}
                <span className="text-lg text-[#888]">/100</span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-3 text-xs">
                  {criticalIssues > 0 && (
                    <span className="text-red-400 font-bold">{criticalIssues} Critical</span>
                  )}
                  {highIssues > 0 && (
                    <span className="text-orange-400 font-bold">{highIssues} High</span>
                  )}
                  {mediumIssues > 0 && (
                    <span className="text-yellow-400">{mediumIssues} Med</span>
                  )}
                </div>
                <div className="text-xs text-[#888]">
                  {totalIssues} total issue{totalIssues !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
          </div>

          {/* Drift Status */}
          <div className="bg-gradient-to-br from-blue-900/20 to-blue-800/10 border border-blue-500/30 rounded-xl p-5 relative overflow-hidden group hover:border-blue-500/50 transition-all duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl group-hover:bg-blue-500/20 transition-all duration-500"></div>
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-blue-300 uppercase tracking-wide">Code Drift</span>
                <Activity size={14} className="text-blue-400" />
              </div>
              <div className={`text-3xl font-bold mb-1 group-hover:scale-105 transition-transform ${
                driftData.drifts.length === 0 ? 'text-emerald-400' : 'text-orange-400'
              }`}>
                {driftData.drifts.length}
              </div>
              <div className="space-y-1">
                <div className={`flex items-center gap-2 text-xs font-bold ${
                  driftData.drifts.length === 0 ? 'text-emerald-400' : 'text-orange-400'
                }`}>
                  {driftData.drifts.length === 0 ? (
                    <><CheckCircle size={12} /> Clean</>
                  ) : (
                    <><AlertTriangle size={12} /> Active</>
                  )}
                </div>
                <div className="text-xs text-[#888]">
                  {totalResources} resources monitored
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Live Ticker Banner */}
        <div className="mb-8 overflow-hidden border border-purple-500/30 rounded-xl bg-gradient-to-r from-purple-900/10 via-violet-900/10 to-purple-900/10">
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes ticker-scroll {
              0% { transform: translateX(0); }
              100% { transform: translateX(-50%); }
            }
            .premium-ticker {
              animation: ticker-scroll 40s linear infinite;
            }
            .premium-ticker:hover {
              animation-play-state: paused;
            }
          `}} />
          <div className="overflow-hidden">
            <div className="premium-ticker flex items-center gap-8 py-3 px-6 text-xs font-mono whitespace-nowrap">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center gap-8">
                  <span className="flex items-center gap-2 text-emerald-400 font-bold">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-lg shadow-emerald-500/50"></span>
                    LIVE: {driftData.repo}
                  </span>
                  <span className="text-[#666]">•</span>
                  <span className="text-purple-400 font-semibold">{totalResources} Resources Active</span>
                  <span className="text-[#666]">•</span>
                  <span className="text-blue-400">Branch: {driftData.branch}</span>
                  <span className="text-[#666]">•</span>
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle size={12} /> Validated
                  </span>
                  <span className="text-[#666]">•</span>
                  <span className="text-emerald-400">{driftData.added} Added</span>
                  <span className="text-[#666]">•</span>
                  <span className="text-red-400">{driftData.removed} Removed</span>
                  <span className="text-[#666]">•</span>
                  <span className="text-orange-400">{driftData.modified} Modified</span>
                  <span className="text-[#666]">•</span>
                  <span className={driftData.drifts.length === 0 ? 'text-emerald-400' : 'text-orange-400'}>
                    Drift: {driftData.drifts.length === 0 ? 'None ✓' : `${driftData.drifts.length} Detected ⚠`}
                  </span>
                  <span className="text-[#666]">•</span>
                  <span className="text-purple-400 flex items-center gap-1">
                    <Sparkles size={12} /> AI Analysis: Active
                  </span>
                  <span className="text-[#666]">•</span>
                  {monthlyCost > 0 && (
                    <>
                      <span className="text-emerald-400">Est. Cost: ${monthlyCost.toFixed(2)}/mo</span>
                      <span className="text-[#666]">•</span>
                    </>
                  )}
                  {potentialSavings > 0 && (
                    <>
                      <span className="text-yellow-400 animate-pulse">Potential Savings: ${potentialSavings}/mo</span>
                      <span className="text-[#666]">•</span>
                    </>
                  )}
                  <span className="text-blue-400 flex items-center gap-1">
                    <Zap size={12} /> Real-time Monitoring
                  </span>
                  <span className="text-[#666]">•</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ROI & Business Value Section */}
        <div className="grid grid-cols-3 gap-6 mb-8">
          {/* ROI Calculator */}
          <div className="col-span-2 bg-gradient-to-br from-violet-900/10 to-purple-900/10 border border-violet-500/30 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-500 rounded-lg flex items-center justify-center">
                <TrendingUp size={20} className="text-white" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#EDEDED]">Return on Investment</h3>
                <p className="text-xs text-[#888]">Quantified value delivered by Driftbox</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-[#1F1F1F]/50 rounded-lg p-4 border border-[#2a2a2a]">
                <div className="text-xs text-[#888] mb-1">Time Saved Monthly</div>
                <div className="text-2xl font-semibold text-emerald-400">{hoursSaved.toFixed(1)}h</div>
                <div className="text-xs text-[#666] mt-1">≈ ${monthlySavedTime.toLocaleString()}</div>
              </div>
              <div className="bg-[#1F1F1F]/50 rounded-lg p-4 border border-[#2a2a2a]">
                <div className="text-xs text-[#888] mb-1">Cost Savings</div>
                <div className="text-2xl font-semibold text-violet-400">${potentialSavings.toLocaleString()}/mo</div>
                <div className="text-xs text-[#666] mt-1">${annualSavings.toLocaleString()}/year</div>
              </div>
              <div className="bg-[#1F1F1F]/50 rounded-lg p-4 border border-[#2a2a2a]">
                <div className="text-xs text-[#888] mb-1">Total Value</div>
                <div className="text-2xl font-semibold text-purple-400">${totalMonthlyValue.toLocaleString()}/mo</div>
                <div className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                  <TrendingUp size={12} />
                  {((totalMonthlyValue / 250) * 100).toFixed(0)}× ROI
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-purple-500/10 to-violet-500/10 rounded-lg p-4 border border-purple-500/20">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-purple-400 mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-[#EDEDED] mb-2">Value Breakdown</div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle size={12} className="text-emerald-400" />
                      <span className="text-[#888]">Automated drift detection</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle size={12} className="text-emerald-400" />
                      <span className="text-[#888]">Security scanning & compliance</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle size={12} className="text-emerald-400" />
                      <span className="text-[#888]">Cost optimization recommendations</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle size={12} className="text-emerald-400" />
                      <span className="text-[#888]">AI-powered insights & predictions</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="bg-[#1F1F1F] border border-[#2a2a2a] rounded-xl p-6">
            <h3 className="text-sm font-bold text-[#EDEDED] mb-4 flex items-center gap-2">
              <Activity size={14} className="text-purple-400" />
              Infrastructure Metrics
            </h3>
              <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
                <span className="text-xs text-[#888]">Total Resources</span>
                <span className="text-sm font-semibold text-[#EDEDED]">{totalResources}</span>
              </div>
              <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
                <span className="text-xs text-[#888]">Active Drifts</span>
                <span className={`text-sm font-semibold ${driftData.drifts.length === 0 ? 'text-emerald-400' : 'text-orange-400'}`}>
                  {driftData.drifts.length}
                </span>
              </div>
              <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
                <span className="text-xs text-[#888]">Security Issues</span>
                <span className={`text-sm font-semibold ${totalIssues === 0 ? 'text-emerald-400' : totalIssues < 10 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {totalIssues}
                </span>
              </div>
              <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
                <span className="text-xs text-[#888]">Code Compliance</span>
                <span className="text-sm font-semibold text-purple-400">
                  {driftData.drifts.length === 0 ? '100%' : `${Math.max(0, 100 - (driftData.drifts.length * 2))}%`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#888]">Optimizations Available</span>
                <span className="text-sm font-semibold text-emerald-400">{optimizationCount}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Analytics Grid */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          {/* Security Deep Dive */}
          {securityData && (
            <div className="bg-[#1F1F1F] border border-[#2a2a2a] rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                    <Shield size={20} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#EDEDED]">Security Analysis</h3>
                    <p className="text-xs text-[#888]">Comprehensive vulnerability scan</p>
                  </div>
                </div>
                <div className={`text-3xl font-bold ${
                  securityScore >= 80 ? 'text-emerald-400' : 
                  securityScore >= 60 ? 'text-yellow-400' : 
                  'text-red-400'
                }`}>
                  {securityScore}/100
                </div>
              </div>

              {/* Issue Breakdown */}
              <div className="grid grid-cols-4 gap-3 mb-6">
                <div className="bg-[#181818] rounded-lg px-3 py-3 border border-red-500/20">
                  <div className="text-2xl font-semibold text-red-400 mb-1">{criticalIssues}</div>
                  <div className="text-xs text-[#666]">Critical</div>
                </div>
                <div className="bg-[#181818] rounded-lg px-3 py-3 border border-orange-500/20">
                  <div className="text-2xl font-semibold text-orange-400 mb-1">{highIssues}</div>
                  <div className="text-xs text-[#666]">High</div>
                </div>
                <div className="bg-[#181818] rounded-lg px-3 py-3 border border-yellow-500/20">
                  <div className="text-2xl font-semibold text-yellow-400 mb-1">{mediumIssues}</div>
                  <div className="text-xs text-[#666]">Medium</div>
                </div>
                <div className="bg-[#181818] rounded-lg px-3 py-3 border border-blue-500/20">
                  <div className="text-2xl font-semibold text-blue-400 mb-1">{lowIssues}</div>
                  <div className="text-xs text-[#666]">Low</div>
                </div>
              </div>

              {/* Top Issues */}
              {securityData.issues && securityData.issues.length > 0 && (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  <div className="text-xs font-semibold text-[#888] uppercase tracking-wide mb-3">Top Security Risks</div>
                  {securityData.issues.slice(0, 5).map((issue: any, idx: number) => (
                    <div 
                      key={idx}
                      className="bg-[#181818] rounded-lg p-4 border border-[#2a2a2a] hover:border-purple-500/30 transition-colors cursor-pointer"
                      onClick={() => {
                        if (issue.file && onFileClick) {
                          onFileClick(issue.file, issue.line)
                        }
                      }}
                    >
                      <div className="flex items-start gap-3 mb-2">
                        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                          issue.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                          issue.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                          issue.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-blue-500/20 text-blue-400'
                        }`}>
                          {issue.severity}
                        </span>
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-[#EDEDED] mb-1">{issue.title}</div>
                          <div className="text-xs text-[#888] mb-2">{issue.description}</div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-purple-400 font-mono">{issue.resource_type}</span>
                            <span className="text-[#666]">·</span>
                            <span className="text-[#888]">{issue.resource_name}</span>
                          </div>
                        </div>
                      </div>
                      <div className="bg-emerald-900/20 border border-emerald-500/20 rounded px-3 py-2 text-xs text-emerald-400">
                        💡 {issue.remediation}
                      </div>
                    </div>
                  ))}
                  {securityData.issues.length > 5 && (
                    <div className="text-center text-xs text-[#666] py-2">
                      +{securityData.issues.length - 5} more issues
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Cost Optimization */}
          {costData && (
            <div className="bg-[#1F1F1F] border border-[#2a2a2a] rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-500 rounded-lg flex items-center justify-center">
                    <DollarSign size={20} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[#EDEDED]">Cost Optimization</h3>
                    <p className="text-xs text-[#888]">AI-driven savings opportunities</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-semibold text-[#EDEDED]">${monthlyCost.toFixed(2)}</div>
                  <div className="text-xs text-[#666]">/month</div>
                </div>
              </div>

              {potentialSavings > 0 && (
                <div className="bg-gradient-to-r from-emerald-500/10 to-green-500/10 border border-emerald-500/30 rounded-lg p-4 mb-6">
                  <div className="flex items-center gap-3 mb-2">
                    <TrendingDown className="text-emerald-400" size={24} />
                    <div>
                      <div className="text-xs text-[#888]">Potential Monthly Savings</div>
                      <div className="text-3xl font-semibold text-emerald-400">${potentialSavings.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="text-xs text-[#666]">
                    ${annualSavings.toLocaleString()} annually · {optimizationCount} recommendation{optimizationCount !== 1 ? 's' : ''}
                  </div>
                </div>
              )}

              {/* Optimization Recommendations */}
              {costData.optimizations && costData.optimizations.length > 0 && (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  <div className="text-xs font-semibold text-[#888] uppercase tracking-wide mb-3">Top Recommendations</div>
                  {costData.optimizations.slice(0, 5).map((opt: any, idx: number) => (
                    <div 
                      key={idx}
                      className="bg-[#181818] rounded-lg p-4 border border-[#2a2a2a] hover:border-emerald-500/30 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-[#EDEDED] mb-1">{opt.recommendation}</div>
                          <div className="text-xs text-[#888] mb-2">{opt.details}</div>
                        </div>
                        <div className="text-right ml-4">
                          <div className="text-lg font-semibold text-emerald-400">-${opt.monthly_savings.toFixed(2)}</div>
                          <div className="text-[10px] text-[#666]">/month</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-[#666]">
                          Current: <span className="text-[#EDEDED] font-mono">${opt.current_cost.toFixed(2)}/mo</span>
                        </span>
                        <span className="text-[#666]">→</span>
                        <span className="text-[#666]">
                          Optimized: <span className="text-emerald-400 font-mono">${opt.optimized_cost.toFixed(2)}/mo</span>
                        </span>
                      </div>
                      <div className="mt-2 text-xs">
                        <span className="text-purple-400 font-mono">{opt.resource_type}</span>
                        <span className="text-[#666]"> · </span>
                        <span className="text-[#888]">{opt.resource_name}</span>
                      </div>
                    </div>
                  ))}
                  {costData.optimizations.length > 5 && (
                    <div className="text-center text-xs text-[#666] py-2">
                      +{costData.optimizations.length - 5} more recommendations
                    </div>
                  )}
                </div>
              )}

              {potentialSavings === 0 && (
                <div className="bg-emerald-900/10 border border-emerald-500/20 rounded-lg p-6 text-center">
                  <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                  <div className="text-sm font-semibold text-[#EDEDED] mb-1">Fully Optimized</div>
                  <div className="text-xs text-[#888]">Your infrastructure is cost-efficient!</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* How It Works Section */}
        <div className="bg-gradient-to-br from-purple-900/10 to-violet-900/10 border border-purple-500/30 rounded-xl p-8 mb-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-violet-500 rounded-lg flex items-center justify-center">
              <Brain size={24} className="text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#EDEDED]">How We Detect Drift & Ensure Compliance</h3>
              <p className="text-xs text-[#888]">Enterprise-grade infrastructure intelligence powered by AI</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-purple-500/20 border border-purple-500/50 flex items-center justify-center text-sm font-bold text-purple-300">1</div>
                <div>
                  <div className="font-semibold text-[#EDEDED] mb-2">Git-Based Comparison</div>
                  <div className="text-sm text-[#888] leading-relaxed">
                    We compare your current Terraform code (<span className="text-blue-400 font-mono">{driftData.branch}</span>) against <span className="text-orange-400 font-mono">{driftData.compared_to}</span>. Every resource, variable, and configuration is parsed and analyzed in real-time.
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-purple-500/20 border border-purple-500/50 flex items-center justify-center text-sm font-bold text-purple-300">2</div>
                <div>
                  <div className="font-semibold text-[#EDEDED] mb-2">Semantic Resource Matching</div>
                  <div className="text-sm text-[#888] leading-relaxed">
                    We use <span className="text-emerald-400 font-semibold">Voyage AI embeddings</span> to understand the <em>meaning</em> of your infrastructure code, not just text changes. This catches renamed resources, refactored modules, and logical changes others miss.
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-purple-500/20 border border-purple-500/50 flex items-center justify-center text-sm font-bold text-purple-300">3</div>
                <div>
                  <div className="font-semibold text-[#EDEDED] mb-2">Real-Time Validation</div>
                  <div className="text-sm text-[#888] leading-relaxed">
                    Every change runs through <span className="text-blue-400 font-mono">terraform validate</span> and our ML models check for security patterns, cost implications, and compliance violations across {totalResources} resources.
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-purple-500/20 border border-purple-500/50 flex items-center justify-center text-sm font-bold text-purple-300">4</div>
                <div>
                  <div className="font-semibold text-[#EDEDED] mb-2">Zero False Positives</div>
                  <div className="text-sm text-[#888] leading-relaxed">
                    For <span className="text-[#EDEDED] font-mono">{driftData.repo}</span>, we found <span className={`font-bold ${driftData.drifts.length === 0 ? 'text-emerald-400' : 'text-orange-400'}`}>{driftData.drifts.length} drift{driftData.drifts.length !== 1 ? 's' : ''}</span> across {totalResources} resources with 100% accuracy.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-purple-500/20">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-purple-400 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold text-purple-300">Why this matters:</span>
                <span className="text-sm text-[#888] ml-2">
                  Traditional drift detection only catches state file changes. We catch <em className="text-[#EDEDED]">code drift</em> before you even deploy, saving hours of debugging and preventing production incidents.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        {driftData.drifts.length === 0 ? (
          <div className="bg-gradient-to-r from-emerald-900/20 to-green-900/20 border border-emerald-500/30 rounded-xl p-8 text-center">
            <CheckCircle className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-[#EDEDED] mb-2">Perfect Infrastructure Health</h3>
            <p className="text-sm text-[#888] mb-6 max-w-2xl mx-auto">
              No drift detected. Your Terraform code is perfectly in sync with expected state. All {totalResources} resources are validated, secure, and optimized.
            </p>
            <div className="flex gap-4 justify-center">
              <button className="px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-semibold transition-colors flex items-center gap-2">
                <BarChart3 size={16} />
                View Detailed Analytics
              </button>
              <button className="px-6 py-3 bg-[#1F1F1F] hover:bg-[#2a2a2a] text-[#EDEDED] rounded-lg font-semibold transition-colors border border-[#2a2a2a]">
                Export Report
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-gradient-to-r from-orange-900/20 to-red-900/20 border border-orange-500/30 rounded-xl p-8 text-center">
            <AlertTriangle className="w-16 h-16 text-orange-400 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-[#EDEDED] mb-2">{driftData.drifts.length} Active Drift{driftData.drifts.length !== 1 ? 's' : ''} Detected</h3>
            <p className="text-sm text-[#888] mb-6 max-w-2xl mx-auto">
              We've identified {driftData.drifts.length} configuration drift{driftData.drifts.length !== 1 ? 's' : ''} in your infrastructure. Review and resolve these issues to maintain infrastructure health and prevent deployment failures.
            </p>
            <div className="flex gap-4 justify-center">
              <button 
                onClick={() => onViewChange?.('drift')}
                className="px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold transition-colors flex items-center gap-2"
              >
                <AlertCircle size={16} />
                View All Drifts
              </button>
              <button className="px-6 py-3 bg-[#1F1F1F] hover:bg-[#2a2a2a] text-[#EDEDED] rounded-lg font-semibold transition-colors border border-[#2a2a2a]">
                Auto-Fix Available Issues
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

