/**
 * Centralized API client that automatically includes role ID in requests.
 * 
 * This solves the problem where server restarts lose the default role context.
 * By including the role ID in every request (except auth/onboarding flows),
 * the server can always operate with the correct role context.
 */

import { useRolesStore } from '../store';

// Endpoints that should NOT include role ID (auth/onboarding flows)
const EXCLUDED_PATHS = [
  '/api/auth/login',
  '/api/auth/check-email',
  '/api/auth/signup',
  '/api/auth/signup/individual',
  '/api/auth/signup/group',
  '/api/auth/join',
  '/api/auth/logout',
  '/api/auth/google/start',
  '/api/auth/google/callback',
  '/api/auth/github/start',
  '/api/auth/github/callback',
  '/api/auth/oauth/token',
  '/api/env',
];

/**
 * Check if a path should be excluded from role ID injection
 */
function isExcludedPath(path: string): boolean {
  return EXCLUDED_PATHS.some(excluded => path.startsWith(excluded));
}

/**
 * Get the current role ID from the store
 */
function getCurrentRoleId(): string | null {
  const state = useRolesStore.getState();
  return state.currentRole?.id || state.currentRoleId;
}

/**
 * Options for API requests
 */
export interface ApiOptions extends RequestInit {
  /**
   * If true, role ID will NOT be included in the request
   * Useful for endpoints that don't require role context
   */
  excludeRoleId?: boolean;
}

/**
 * Enhanced fetch that automatically includes role ID in headers.
 * 
 * Usage:
 *   // Simple GET with automatic role ID
 *   const response = await apiFetch('/api/mcp/servers');
 *   
 *   // POST with body and automatic role ID
 *   const response = await apiFetch('/api/messages', {
 *     method: 'POST',
 *     body: JSON.stringify({ content: 'Hello' }),
 *   });
 *   
 *   // Exclude role ID for auth endpoints
 *   const response = await apiFetch('/api/auth/login', {
 *     method: 'POST',
 *     body: JSON.stringify({ email }),
 *   });
 */
export async function apiFetch(
  input: RequestInfo | URL,
  options: ApiOptions = {}
): Promise<Response> {
  const { excludeRoleId = false, ...fetchOptions } = options;
  
  // Determine the URL path
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  
  // Check if this path should have role ID
  const shouldIncludeRoleId = !excludeRoleId && !isExcludedPath(url);
  
  // Get current role ID
  const roleId = getCurrentRoleId();
  
  // Prepare headers
  const headers = new Headers(fetchOptions.headers);
  
  // Add Content-Type for JSON requests if not already set
  if (fetchOptions.body && !headers.has('Content-Type')) {
    const body = fetchOptions.body;
    if (typeof body === 'string') {
      headers.set('Content-Type', 'application/json');
    }
  }
  
  // Add role ID header if applicable
  if (shouldIncludeRoleId && roleId) {
    headers.set('X-Role-ID', roleId);
  }
  
  // Always include credentials for session cookies
  const finalOptions: RequestInit = {
    ...fetchOptions,
    headers,
    credentials: 'include',
  };
  
  return fetch(input, finalOptions);
}

/**
 * Convenience method for GET requests
 */
export async function apiGet(url: string, options: Omit<ApiOptions, 'method'> = {}): Promise<Response> {
  return apiFetch(url, { ...options, method: 'GET' });
}

/**
 * Convenience method for POST requests
 */
export async function apiPost(
  url: string, 
  body?: unknown, 
  options: Omit<ApiOptions, 'method' | 'body'> = {}
): Promise<Response> {
  const fetchOptions: ApiOptions = {
    ...options,
    method: 'POST',
  };
  
  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }
  
  return apiFetch(url, fetchOptions);
}

/**
 * Convenience method for PATCH requests
 */
export async function apiPatch(
  url: string, 
  body?: unknown, 
  options: Omit<ApiOptions, 'method' | 'body'> = {}
): Promise<Response> {
  const fetchOptions: ApiOptions = {
    ...options,
    method: 'PATCH',
  };
  
  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }
  
  return apiFetch(url, fetchOptions);
}

/**
 * Convenience method for DELETE requests
 */
export async function apiDelete(url: string, options: Omit<ApiOptions, 'method'> = {}): Promise<Response> {
  return apiFetch(url, { ...options, method: 'DELETE' });
}

/**
 * Helper to parse JSON response with error handling
 */
export async function parseApiResponse<T>(response: Response): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const json = await response.json();
    if (!response.ok) {
      return { 
        success: false, 
        error: json.error?.message || json.error || `HTTP ${response.status}` 
      };
    }
    return { success: true, data: json.data ?? json };
  } catch (e) {
    return { success: false, error: 'Failed to parse response' };
  }
}
