import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import DashboardOverview from '../components/DashboardOverview';
import {
  UserAnalytics,
  RevenueAnalytics,
  TeamAnalytics,
  UsageAnalytics,
  ProductAnalytics,
  EngagementAnalytics,
} from '../components/AnalyticsSection';

type Tab = 'overview' | 'users' | 'revenue' | 'teams' | 'usage' | 'product' | 'engagement';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users' },
    { id: 'revenue', label: 'Revenue' },
    { id: 'teams', label: 'Teams' },
    { id: 'usage', label: 'Usage' },
    { id: 'product', label: 'Product' },
    { id: 'engagement', label: 'Engagement' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
              <p className="text-sm text-gray-600">Welcome, {user?.full_name || user?.email}</p>
            </div>
            <button
              onClick={logout}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'overview' && <DashboardOverview />}
        {activeTab === 'users' && <UserAnalytics />}
        {activeTab === 'revenue' && <RevenueAnalytics />}
        {activeTab === 'teams' && <TeamAnalytics />}
        {activeTab === 'usage' && <UsageAnalytics />}
        {activeTab === 'product' && <ProductAnalytics />}
        {activeTab === 'engagement' && <EngagementAnalytics />}
      </main>
    </div>
  );
}
