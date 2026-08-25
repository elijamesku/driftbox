'use client'

import { useState } from 'react'
import { X, User, Key, CreditCard, Bell, Shield, Palette } from 'lucide-react'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState('account')

  if (!isOpen) return null

  const tabs = [
    { id: 'account', icon: User, label: 'Account' },
    { id: 'api-keys', icon: Key, label: 'API Keys' },
    { id: 'billing', icon: CreditCard, label: 'Billing' },
    { id: 'notifications', icon: Bell, label: 'Notifications' },
    { id: 'security', icon: Shield, label: 'Security' },
    { id: 'appearance', icon: Palette, label: 'Appearance' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-4xl h-[80vh] bg-[var(--cursor-bg)] border border-[var(--cursor-border)] rounded-lg flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 bg-[var(--cursor-bg-darker)] border-r border-[var(--cursor-border)] p-4">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[16px] font-semibold">Settings</h2>
            <button
              onClick={onClose}
              className="p-1 hover:bg-[var(--cursor-hover)] rounded"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded text-[13px] text-left ${
                  activeTab === tab.id
                    ? 'bg-[var(--cursor-hover)] text-[var(--cursor-text-bright)]'
                    : 'text-[var(--cursor-text)] hover:bg-[var(--cursor-hover)]'
                }`}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          {activeTab === 'account' && (
            <div>
              <h3 className="text-[18px] font-semibold mb-6">Account Settings</h3>
              <div className="space-y-6">
                <div>
                  <label className="block text-[13px] text-[var(--cursor-text)] mb-2">
                    Full Name
                  </label>
                  <input
                    type="text"
                    defaultValue="John Doe"
                    className="w-full px-3 py-2 bg-[var(--cursor-bg-lighter)] border border-[var(--cursor-border)] rounded text-[14px] focus:border-[var(--cursor-accent)] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[13px] text-[var(--cursor-text)] mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    defaultValue="user@example.com"
                    className="w-full px-3 py-2 bg-[var(--cursor-bg-lighter)] border border-[var(--cursor-border)] rounded text-[14px] focus:border-[var(--cursor-accent)] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[13px] text-[var(--cursor-text)] mb-2">
                    Company
                  </label>
                  <input
                    type="text"
                    defaultValue="Acme Inc."
                    className="w-full px-3 py-2 bg-[var(--cursor-bg-lighter)] border border-[var(--cursor-border)] rounded text-[14px] focus:border-[var(--cursor-accent)] outline-none"
                  />
                </div>

                <button className="px-4 py-2 bg-[var(--cursor-accent)] text-white rounded hover:bg-[var(--cursor-accent-hover)]">
                  Save Changes
                </button>
              </div>
            </div>
          )}

          {activeTab === 'api-keys' && (
            <div>
              <h3 className="text-[18px] font-semibold mb-2">API Keys</h3>
              <p className="text-[13px] text-[var(--cursor-text-dim)] mb-6">
                Manage your API keys for programmatic access
              </p>

              <button className="px-4 py-2 bg-[var(--cursor-accent)] text-white rounded hover:bg-[var(--cursor-accent-hover)] mb-6">
                Create New API Key
              </button>

              <div className="space-y-3">
                <div className="p-4 bg-[var(--cursor-bg-lighter)] border border-[var(--cursor-border)] rounded">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[13px]">ik_***************abc123</span>
                    <button className="text-[var(--cursor-red)] text-[13px] hover:underline">
                      Revoke
                    </button>
                  </div>
                  <div className="text-[12px] text-[var(--cursor-text-dim)]">
                    Created on Oct 31, 2025 • Last used 2 hours ago
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'billing' && (
            <div>
              <h3 className="text-[18px] font-semibold mb-2">Billing & Usage</h3>
              <p className="text-[13px] text-[var(--cursor-text-dim)] mb-6">
                Manage your subscription and view usage
              </p>

              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="p-4 bg-[var(--cursor-bg-lighter)] border border-[var(--cursor-border)] rounded">
                  <div className="text-[13px] text-[var(--cursor-text-dim)] mb-1">Credits Remaining</div>
                  <div className="text-[24px] font-semibold text-[var(--cursor-green)]">1,250</div>
                </div>
                <div className="p-4 bg-[var(--cursor-bg-lighter)] border border-[var(--cursor-border)] rounded">
                  <div className="text-[13px] text-[var(--cursor-text-dim)] mb-1">API Calls</div>
                  <div className="text-[24px] font-semibold">3,482</div>
                </div>
                <div className="p-4 bg-[var(--cursor-bg-lighter)] border border-[var(--cursor-border)] rounded">
                  <div className="text-[13px] text-[var(--cursor-text-dim)] mb-1">This Month</div>
                  <div className="text-[24px] font-semibold">$47.50</div>
                </div>
              </div>

              <button className="px-4 py-2 bg-[var(--cursor-accent)] text-white rounded hover:bg-[var(--cursor-accent-hover)]">
                Upgrade Plan
              </button>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div>
              <h3 className="text-[18px] font-semibold mb-6">Notification Preferences</h3>
              <div className="space-y-4">
                {[
                  { label: 'Infrastructure changes', description: 'Get notified when infrastructure is modified' },
                  { label: 'Security alerts', description: 'Receive alerts for security issues' },
                  { label: 'Cost alerts', description: 'Get notified when costs exceed thresholds' },
                  { label: 'Newsletter', description: 'Receive product updates and tips' },
                ].map((item, index) => (
                  <div key={index} className="flex items-center justify-between p-4 bg-[var(--cursor-bg-lighter)] border border-[var(--cursor-border)] rounded">
                    <div>
                      <div className="text-[14px] font-medium mb-1">{item.label}</div>
                      <div className="text-[12px] text-[var(--cursor-text-dim)]">{item.description}</div>
                    </div>
                    <input
                      type="checkbox"
                      defaultChecked={index < 3}
                      className="w-4 h-4 rounded border-[var(--cursor-border)] bg-[var(--cursor-bg-lighter)] checked:bg-[var(--cursor-accent)]"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div>
              <h3 className="text-[18px] font-semibold mb-6">Security Settings</h3>
              <div className="space-y-6">
                <div>
                  <label className="block text-[13px] text-[var(--cursor-text)] mb-2">
                    Change Password
                  </label>
                  <input
                    type="password"
                    placeholder="Current password"
                    className="w-full px-3 py-2 bg-[var(--cursor-bg-lighter)] border border-[var(--cursor-border)] rounded text-[14px] focus:border-[var(--cursor-accent)] outline-none mb-2"
                  />
                  <input
                    type="password"
                    placeholder="New password"
                    className="w-full px-3 py-2 bg-[var(--cursor-bg-lighter)] border border-[var(--cursor-border)] rounded text-[14px] focus:border-[var(--cursor-accent)] outline-none mb-2"
                  />
                  <input
                    type="password"
                    placeholder="Confirm new password"
                    className="w-full px-3 py-2 bg-[var(--cursor-bg-lighter)] border border-[var(--cursor-border)] rounded text-[14px] focus:border-[var(--cursor-accent)] outline-none"
                  />
                </div>

                <button className="px-4 py-2 bg-[var(--cursor-accent)] text-white rounded hover:bg-[var(--cursor-accent-hover)]">
                  Update Password
                </button>

                <div className="pt-6 border-t border-[var(--cursor-border)]">
                  <button className="text-[var(--cursor-red)] text-[13px] hover:underline">
                    Delete Account
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div>
              <h3 className="text-[18px] font-semibold mb-6">Appearance</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] text-[var(--cursor-text)] mb-2">
                    Theme
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {['Dark', 'Light', 'Auto'].map(theme => (
                      <button
                        key={theme}
                        className={`p-4 border border-[var(--cursor-border)] rounded text-[13px] ${
                          theme === 'Dark' ? 'bg-[var(--cursor-accent)] text-white' : 'bg-[var(--cursor-bg-lighter)] hover:bg-[var(--cursor-hover)]'
                        }`}
                      >
                        {theme}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[13px] text-[var(--cursor-text)] mb-2">
                    Font Size
                  </label>
                  <input
                    type="range"
                    min="12"
                    max="16"
                    defaultValue="13"
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

