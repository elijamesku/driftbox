const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

export interface AdminLoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: {
    id: string;
    email: string;
    full_name: string;
    tier: string;
    is_admin?: boolean;
  };
}

// API Client
class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    // Load token from localStorage on init
    this.token = localStorage.getItem('admin_token');
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('admin_token', token);
    } else {
      localStorage.removeItem('admin_token');
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token expired or invalid
        this.setToken(null);
        throw new Error('Unauthorized - please login again');
      }
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Auth endpoints
  async adminLogin(credentials: AdminLoginRequest): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>('/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    this.setToken(response.access_token);
    return response;
  }

  // Admin endpoints
  async getDashboard() {
    return this.request('/admin/dashboard');
  }

  async getUserAnalytics() {
    return this.request('/admin/analytics/users');
  }

  async getRevenueAnalytics() {
    return this.request('/admin/analytics/revenue');
  }

  async getTeamAnalytics() {
    return this.request('/admin/analytics/teams');
  }

  async getUsageAnalytics() {
    return this.request('/admin/analytics/usage');
  }

  async getProductAnalytics() {
    return this.request('/admin/analytics/product');
  }

  async getEngagementAnalytics() {
    return this.request('/admin/analytics/engagement');
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
