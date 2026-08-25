/**
 * Get the correct API endpoint for desktop or web mode
 * 
 * In web mode: Uses Next.js API proxy routes (/api/proxy/...)
 * In desktop mode: Calls backend directly (http://129.212.181.126/...)
 */
export function getApiEndpoint(path: string): string {
  // Check if running in desktop mode - multiple detection methods
  // In Electron, electronAPI should always be available via preload script
  const hasElectronAPI = typeof window !== 'undefined' && (window as any).electronAPI !== undefined
  const isElectronDesktop = hasElectronAPI && (window as any).electronAPI?.isDesktop === true
  const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:'
  
  // If electronAPI exists, we're definitely in Electron (even if isDesktop flag isn't set yet)
  // Also check if we're on localhost:3000 (Electron static server) but electronAPI exists
  const isLocalhostStatic = typeof window !== 'undefined' && 
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    window.location.port === '3000' &&
    hasElectronAPI
  
  const isDesktop = isElectronDesktop || hasElectronAPI || isFileProtocol || isLocalhostStatic
  
  // Debug logging
  if (typeof window !== 'undefined') {
    console.log('[API Endpoint] Detection:', {
      hasElectronAPI,
      isElectronDesktop,
      isFileProtocol,
      isLocalhostStatic,
      hostname: window.location.hostname,
      port: window.location.port,
      protocol: window.location.protocol,
      isDesktop,
      path
    })
  }
  
  if (isDesktop) {
    // Desktop mode - call backend directly
    // Use environment variable if set, otherwise default to production backend
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://129.212.181.126'
    console.log('[API] Desktop mode - using backend:', apiUrl)
    // Remove /api/proxy prefix if present
    const cleanPath = path.replace(/^\/api\/proxy/, '')
    const fullUrl = `${apiUrl}${cleanPath}`
    console.log('[API] Full endpoint URL:', fullUrl)
    return fullUrl
  } else {
    // Web mode - use Next.js proxy (which handles the backend URL server-side)
    const proxyPath = path.startsWith('/api/proxy') ? path : `/api/proxy${path}`
    console.log('[API] Web mode - using proxy:', proxyPath)
    return proxyPath
  }
}

/**
 * Fetch wrapper that automatically uses the correct endpoint
 */
export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const endpoint = getApiEndpoint(path)
  console.log(`[API] ${options?.method || 'GET'} ${endpoint}`)
  return fetch(endpoint, options)
}

