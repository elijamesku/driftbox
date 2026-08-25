import { useEffect, useState } from 'react';
import { apiClient } from '../services/api';

interface AnalyticsSectionProps {
  title: string;
  endpoint: () => Promise<any>;
  renderData: (data: any) => React.ReactNode;
}

export default function AnalyticsSection({ title, endpoint, renderData }: AnalyticsSectionProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const response = await endpoint();
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to load ${title}`);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">{title}</h2>
        <div className="text-center py-8 text-gray-500">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">{title}</h2>
        <div className="text-center py-8 text-red-600">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">{title}</h2>
      {data && renderData(data)}
    </div>
  );
}

// User Analytics Component
export function UserAnalytics() {
  return (
    <AnalyticsSection
      title="User Analytics"
      endpoint={() => apiClient.getUserAnalytics()}
      renderData={(data) => (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">Total Users</div>
              <div className="text-2xl font-bold">{data.total_users?.toLocaleString() || 0}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">New Users (7d)</div>
              <div className="text-2xl font-bold">{data.new_users_7d?.toLocaleString() || 0}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">New Users (30d)</div>
              <div className="text-2xl font-bold">{data.new_users_30d?.toLocaleString() || 0}</div>
            </div>
          </div>
          <div className="p-4 bg-gray-50 rounded">
            <div className="text-sm text-gray-600 mb-2">Users by Tier</div>
            <pre className="text-xs overflow-auto">{JSON.stringify(data.users_by_tier, null, 2)}</pre>
          </div>
        </div>
      )}
    />
  );
}

// Revenue Analytics Component
export function RevenueAnalytics() {
  return (
    <AnalyticsSection
      title="Revenue Analytics"
      endpoint={() => apiClient.getRevenueAnalytics()}
      renderData={(data) => (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">MRR</div>
              <div className="text-2xl font-bold">${data.mrr?.toLocaleString() || 0}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">ARR</div>
              <div className="text-2xl font-bold">${data.arr?.toLocaleString() || 0}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">Total Revenue</div>
              <div className="text-2xl font-bold">${data.total_revenue?.toLocaleString() || 0}</div>
            </div>
          </div>
          <div className="p-4 bg-gray-50 rounded">
            <div className="text-sm text-gray-600 mb-2">Revenue by Tier</div>
            <pre className="text-xs overflow-auto">{JSON.stringify(data.revenue_by_tier, null, 2)}</pre>
          </div>
        </div>
      )}
    />
  );
}

// Team Analytics Component
export function TeamAnalytics() {
  return (
    <AnalyticsSection
      title="Team Analytics"
      endpoint={() => apiClient.getTeamAnalytics()}
      renderData={(data) => (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">Total Teams</div>
              <div className="text-2xl font-bold">{data.total_teams?.toLocaleString() || 0}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">Avg Team Size</div>
              <div className="text-2xl font-bold">{data.average_team_size?.toFixed(1) || 0}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">Active Teams (30d)</div>
              <div className="text-2xl font-bold">{data.active_teams_30d?.toLocaleString() || 0}</div>
            </div>
          </div>
        </div>
      )}
    />
  );
}

// Usage Analytics Component
export function UsageAnalytics() {
  return (
    <AnalyticsSection
      title="Usage Analytics"
      endpoint={() => apiClient.getUsageAnalytics()}
      renderData={(data) => (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">Total Events</div>
              <div className="text-2xl font-bold">{data.total_events_all_time?.toLocaleString() || 0}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">Events (30d)</div>
              <div className="text-2xl font-bold">{data.total_events_30d?.toLocaleString() || 0}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">Avg per User</div>
              <div className="text-2xl font-bold">{data.average_usage_per_user?.toFixed(1) || 0}</div>
            </div>
          </div>
        </div>
      )}
    />
  );
}

// Product Analytics Component
export function ProductAnalytics() {
  return (
    <AnalyticsSection
      title="Product Analytics"
      endpoint={() => apiClient.getProductAnalytics()}
      renderData={(data) => (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">Total PRs</div>
              <div className="text-2xl font-bold">{data.total_prs_all_time?.toLocaleString() || 0}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">PRs (30d)</div>
              <div className="text-2xl font-bold">{data.total_prs_30d?.toLocaleString() || 0}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">Conversations</div>
              <div className="text-2xl font-bold">{data.conversations_created?.toLocaleString() || 0}</div>
            </div>
          </div>
        </div>
      )}
    />
  );
}

// Engagement Analytics Component
export function EngagementAnalytics() {
  return (
    <AnalyticsSection
      title="Engagement Analytics"
      endpoint={() => apiClient.getEngagementAnalytics()}
      renderData={(data) => (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">DAU</div>
              <div className="text-2xl font-bold">{data.dau?.toLocaleString() || 0}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">MAU</div>
              <div className="text-2xl font-bold">{data.mau?.toLocaleString() || 0}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">DAU/MAU Ratio</div>
              <div className="text-2xl font-bold">{(data.dau_mau_ratio * 100)?.toFixed(1) || 0}%</div>
            </div>
          </div>
        </div>
      )}
    />
  );
}
