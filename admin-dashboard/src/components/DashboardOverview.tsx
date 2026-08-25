import { useEffect, useState } from 'react';
import { apiClient } from '../services/api';

interface DashboardMetrics {
  total_users: number;
  active_users_30d: number;
  total_teams: number;
  total_repositories: number;
  total_prs: number;
  total_revenue_mrr: number;
  total_usage_events: number;
}

export default function DashboardOverview() {
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const response = await apiClient.getDashboard();
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-red-600">Error: {error}</div>;
  }

  if (!data) return null;

  const metrics = [
    { label: 'Total Users', value: data.total_users.toLocaleString(), color: 'blue' },
    { label: 'Active Users (30d)', value: data.active_users_30d.toLocaleString(), color: 'green' },
    { label: 'Total Teams', value: data.total_teams.toLocaleString(), color: 'purple' },
    { label: 'Total Repositories', value: data.total_repositories.toLocaleString(), color: 'indigo' },
    { label: 'Total PRs', value: data.total_prs.toLocaleString(), color: 'pink' },
    { label: 'MRR', value: `$${data.total_revenue_mrr.toLocaleString()}`, color: 'yellow' },
    { label: 'Usage Events', value: data.total_usage_events.toLocaleString(), color: 'orange' },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard Overview</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="bg-white rounded-lg shadow p-6 border-l-4"
            style={{ borderLeftColor: `var(--color-${metric.color})` }}
          >
            <div className="text-sm font-medium text-gray-600 mb-1">{metric.label}</div>
            <div className="text-2xl font-bold text-gray-900">{metric.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
