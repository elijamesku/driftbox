/**
 * Documentation Cache Utility
 * 
 * Provides persistent caching for documentation per repo:
 * - Uses localStorage (works everywhere)
 * - Also saves to file in Electron (for better persistence)
 * - Cache persists until explicit refresh (no time-based expiration)
 * - Each repo has its own cache
 */

interface DocumentationData {
  ok: boolean
  repo: string
  branch: string
  summary: {
    total_resources: number
    resource_types: number
    files: number
  }
  sections: Array<{
    type: string
    display_name: string
    icon: string
    count: number
    resources: Array<{
      name: string
      tf_name: string
      file: string
      line?: number
      attributes: Record<string, any>
    }>
  }>
  analysis: string
  recommendations: string[]
}

const isDesktop = typeof window !== 'undefined' && (window as any).electronAPI?.isDesktop === true

/**
 * Get cache key for a repo/branch combination
 */
function getCacheKey(owner: string, repo: string, branch: string): string {
  return `infrara_doc_cache_${owner}_${repo}_${branch}`
}

/**
 * Get file path for documentation cache in Electron
 */
function getCacheFilePath(owner: string, repo: string, branch: string): string {
  return `.driftbox/documentation_${branch}.json`
}

/**
 * Get cached documentation from localStorage
 */
export function getCachedDoc(owner: string, repo: string, branch: string): DocumentationData | null {
  const cacheKey = getCacheKey(owner, repo, branch)
  
  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      const { data } = JSON.parse(cached)
      console.log('📄 [DocumentationCache] ✅ Found cached data in localStorage')
      return data
    }
  } catch (e) {
    console.error('📄 [DocumentationCache] Failed to read localStorage cache:', e)
  }
  
  return null
}

/**
 * Get cached documentation from Electron file system
 */
async function getCachedDocFromFile(owner: string, repo: string, branch: string): Promise<DocumentationData | null> {
  if (!isDesktop || !(window as any).electronAPI) {
    return null
  }
  
  try {
    const filePath = getCacheFilePath(owner, repo, branch)
    const result = await (window as any).electronAPI.readFile(owner, repo, filePath)
    
    if (result.success && result.content) {
      const data = JSON.parse(result.content)
      console.log('📄 [DocumentationCache] ✅ Found cached data in file system')
      return data
    }
  } catch (e) {
    // File doesn't exist or error reading - that's okay
    console.log('📄 [DocumentationCache] No file cache found (this is normal for first fetch)')
  }
  
  return null
}

/**
 * Get cached documentation (checks both localStorage and file system)
 */
export async function getCachedDocumentation(
  owner: string,
  repo: string,
  branch: string
): Promise<DocumentationData | null> {
  // First check localStorage (fastest)
  const localStorageData = getCachedDoc(owner, repo, branch)
  if (localStorageData) {
    return localStorageData
  }
  
  // Then check file system (for Electron)
  if (isDesktop) {
    const fileData = await getCachedDocFromFile(owner, repo, branch)
    if (fileData) {
      // Also cache to localStorage for faster access next time
      cacheDoc(owner, repo, branch, fileData)
      return fileData
    }
  }
  
  return null
}

/**
 * Cache documentation to localStorage
 */
export function cacheDoc(owner: string, repo: string, branch: string, docData: DocumentationData): void {
  const cacheKey = getCacheKey(owner, repo, branch)
  
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      data: docData,
      timestamp: Date.now() // Keep timestamp for reference, but don't use for expiration
    }))
    console.log('📄 [DocumentationCache] 💾 Cached documentation to localStorage')
  } catch (e) {
    console.error('📄 [DocumentationCache] Failed to cache to localStorage:', e)
  }
}

/**
 * Cache documentation to file system (Electron)
 */
async function cacheDocToFile(owner: string, repo: string, branch: string, docData: DocumentationData): Promise<void> {
  if (!isDesktop || !(window as any).electronAPI) {
    return
  }
  
  try {
    const filePath = getCacheFilePath(owner, repo, branch)
    const content = JSON.stringify(docData, null, 2)
    
    // Ensure .driftbox directory exists by trying to create it first
    const dirPath = '.driftbox'
    try {
      await (window as any).electronAPI.createFile(owner, repo, `${dirPath}/.gitkeep`, '', false)
    } catch (e) {
      // Directory might already exist, that's fine
    }
    
    const result = await (window as any).electronAPI.writeFile(owner, repo, filePath, content)
    
    if (result.success) {
      console.log('📄 [DocumentationCache] 💾 Cached documentation to file system:', filePath)
    } else {
      console.warn('📄 [DocumentationCache] Failed to cache to file system:', result.error)
    }
  } catch (e) {
    console.error('📄 [DocumentationCache] Error caching to file system:', e)
  }
}

/**
 * Cache documentation (saves to both localStorage and file system)
 */
export async function cacheDocumentation(
  owner: string,
  repo: string,
  branch: string,
  docData: DocumentationData
): Promise<void> {
  // Cache to localStorage (always)
  cacheDoc(owner, repo, branch, docData)
  
  // Also cache to file system (Electron only)
  if (isDesktop) {
    await cacheDocToFile(owner, repo, branch, docData)
  }
}

/**
 * Clear cached documentation (removes from both localStorage and file system)
 */
export async function clearCachedDocumentation(owner: string, repo: string, branch: string): Promise<void> {
  const cacheKey = getCacheKey(owner, repo, branch)
  
  // Clear localStorage
  try {
    localStorage.removeItem(cacheKey)
    console.log('📄 [DocumentationCache] 🗑️ Cleared localStorage cache')
  } catch (e) {
    console.error('📄 [DocumentationCache] Failed to clear localStorage cache:', e)
  }
  
  // Clear file system cache (Electron)
  if (isDesktop && (window as any).electronAPI) {
    try {
      const filePath = getCacheFilePath(owner, repo, branch)
      await (window as any).electronAPI.deleteFile(owner, repo, filePath)
      console.log('📄 [DocumentationCache] 🗑️ Cleared file system cache')
    } catch (e) {
      // File might not exist, that's okay
      console.log('📄 [DocumentationCache] File cache already cleared or doesn\'t exist')
    }
  }
}

