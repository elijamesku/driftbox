/**
 * Codebase Parser - Parses Terraform files into semantic chunks for RAG indexing
 * Handles local file parsing and change detection
 */

export interface CodebaseChunk {
  text: string
  meta: {
    file: string
    type: 'resource' | 'variable' | 'output' | 'data' | 'module' | 'file_overview'
    resource_type?: string
    resource_name?: string
    variable_name?: string
    output_name?: string
    data_type?: string
    data_name?: string
    module_name?: string
    line_start?: number
    line_end?: number
  }
}

export interface FileChange {
  path: string
  type: 'added' | 'modified' | 'deleted'
  content?: string
  hash?: string
}

/**
 * Find the end of a block using bracket matching (handles nested blocks)
 * Returns the index of the closing brace, or -1 if not found
 */
function findBlockEnd(content: string, startIndex: number): number {
  let depth = 0
  let inString = false
  let stringChar = ''
  let i = startIndex
  
  while (i < content.length) {
    const char = content[i]
    const prevChar = i > 0 ? content[i - 1] : ''
    
    // Handle string literals (skip brackets inside strings)
    if (!inString && (char === '"' || char === "'")) {
      inString = true
      stringChar = char
    } else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
    }
    
    if (!inString) {
      if (char === '{') {
        depth++
      } else if (char === '}') {
        depth--
        if (depth === 0) {
          return i
        }
      }
    }
    
    i++
  }
  
  return -1 // Block not properly closed
}

/**
 * Parse a single Terraform file into semantic chunks
 * Uses bracket matching to properly handle nested blocks
 */
export function parseTerraformFile(filePath: string, content: string): CodebaseChunk[] {
  const chunks: CodebaseChunk[] = []
  
  // Helper to calculate line numbers from character index
  const getLineNumber = (charIndex: number): number => {
    return content.substring(0, charIndex).split('\n').length
  }
  
  // Helper to extract block content using bracket matching
  const extractBlock = (startIndex: number, blockType: string, blockName: string, typeName?: string): { body: string; endIndex: number } | null => {
    // Find the opening brace
    const braceIndex = content.indexOf('{', startIndex)
    if (braceIndex === -1) return null
    
    // Find the matching closing brace
    const endIndex = findBlockEnd(content, braceIndex)
    if (endIndex === -1) return null
    
    // Extract block body (content between braces, excluding the braces themselves)
    const body = content.substring(braceIndex + 1, endIndex).trim()
    
    return { body, endIndex }
  }
  
  // Extract resources: resource "type" "name" { ... }
  const resourcePattern = /resource\s+"([^"]+)"\s+"([^"]+)"\s*/g
  let match
  while ((match = resourcePattern.exec(content)) !== null) {
    const resourceType = match[1]
    const resourceName = match[2]
    const blockResult = extractBlock(match.index + match[0].length, 'resource', resourceName, resourceType)
    
    if (blockResult) {
      const lineStart = getLineNumber(match.index)
      const lineEnd = getLineNumber(blockResult.endIndex)
      
      chunks.push({
        text: `resource ${resourceType} ${resourceName}:\n${blockResult.body}`,
        meta: {
          file: filePath,
          type: 'resource',
          resource_type: resourceType,
          resource_name: resourceName,
          line_start: lineStart,
          line_end: lineEnd
        }
      })
    }
  }
  
  // Extract variables: variable "name" { ... }
  const variablePattern = /variable\s+"([^"]+)"\s*/g
  while ((match = variablePattern.exec(content)) !== null) {
    const varName = match[1]
    const blockResult = extractBlock(match.index + match[0].length, 'variable', varName)
    
    if (blockResult) {
      const lineStart = getLineNumber(match.index)
      const lineEnd = getLineNumber(blockResult.endIndex)
      
      chunks.push({
        text: `variable ${varName}:\n${blockResult.body}`,
        meta: {
          file: filePath,
          type: 'variable',
          variable_name: varName,
          line_start: lineStart,
          line_end: lineEnd
        }
      })
    }
  }
  
  // Extract outputs: output "name" { ... }
  const outputPattern = /output\s+"([^"]+)"\s*/g
  while ((match = outputPattern.exec(content)) !== null) {
    const outputName = match[1]
    const blockResult = extractBlock(match.index + match[0].length, 'output', outputName)
    
    if (blockResult) {
      const lineStart = getLineNumber(match.index)
      const lineEnd = getLineNumber(blockResult.endIndex)
      
      chunks.push({
        text: `output ${outputName}:\n${blockResult.body}`,
        meta: {
          file: filePath,
          type: 'output',
          output_name: outputName,
          line_start: lineStart,
          line_end: lineEnd
        }
      })
    }
  }
  
  // Extract data sources: data "type" "name" { ... }
  const dataPattern = /data\s+"([^"]+)"\s+"([^"]+)"\s*/g
  while ((match = dataPattern.exec(content)) !== null) {
    const dataType = match[1]
    const dataName = match[2]
    const blockResult = extractBlock(match.index + match[0].length, 'data', dataName, dataType)
    
    if (blockResult) {
      const lineStart = getLineNumber(match.index)
      const lineEnd = getLineNumber(blockResult.endIndex)
      
      chunks.push({
        text: `data ${dataType} ${dataName}:\n${blockResult.body}`,
        meta: {
          file: filePath,
          type: 'data',
          data_type: dataType,
          data_name: dataName,
          line_start: lineStart,
          line_end: lineEnd
        }
      })
    }
  }
  
  // Extract modules: module "name" { ... }
  const modulePattern = /module\s+"([^"]+)"\s*/g
  while ((match = modulePattern.exec(content)) !== null) {
    const moduleName = match[1]
    const blockResult = extractBlock(match.index + match[0].length, 'module', moduleName)
    
    if (blockResult) {
      const lineStart = getLineNumber(match.index)
      const lineEnd = getLineNumber(blockResult.endIndex)
      
      chunks.push({
        text: `module ${moduleName}:\n${blockResult.body}`,
        meta: {
          file: filePath,
          type: 'module',
          module_name: moduleName,
          line_start: lineStart,
          line_end: lineEnd
        }
      })
    }
  }
  
  // Add file overview chunk (first 500 chars for context)
  const fileName = filePath.split('/').pop() || filePath
  chunks.push({
    text: `File ${fileName} contains:\n${content.substring(0, 500)}${content.length > 500 ? '...' : ''}`,
    meta: {
      file: filePath,
      type: 'file_overview'
    }
  })
  
  return chunks
}

/**
 * Calculate simple hash for file content (for change detection)
 */
export function calculateFileHash(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return hash.toString(36)
}

/**
 * Recursively find all .tf files in a file tree
 */
function findTfFiles(items: any[]): Array<{ path: string }> {
  const tfFiles: Array<{ path: string }> = []
  
  const traverse = (items: any[]) => {
    for (const item of items) {
      if (item.type === 'file' && item.path.endsWith('.tf')) {
        tfFiles.push({ path: item.path })
      } else if (item.type === 'folder' && item.children) {
        traverse(item.children)
      }
    }
  }
  
  traverse(items)
  return tfFiles
}

/**
 * Index entire codebase from local files
 */
export async function indexCodebase(
  owner: string,
  repo: string
): Promise<{ success: boolean; chunks?: CodebaseChunk[]; error?: string }> {
  try {
    const { isDesktop, getFileTree, readFile } = await import('./desktopBridge')
    
    if (!isDesktop) {
      return { success: false, error: 'Codebase indexing only available in desktop mode' }
    }
    
    // Get all .tf files
    const treeResult = await getFileTree(owner, repo, '')
    if (!treeResult.success || !treeResult.items) {
      return { success: false, error: 'Failed to get file tree' }
    }
    
    // Find all .tf files recursively
    const tfFiles = findTfFiles(treeResult.items)
    console.log(`📁 [codebaseParser] Found ${tfFiles.length} .tf files in ${owner}/${repo}`)
    
    // Parse each file
    const allChunks: CodebaseChunk[] = []
    for (const file of tfFiles) {
      console.log(`📄 [codebaseParser] Reading file: ${file.path}`)
      const fileResult = await readFile(owner, repo, file.path)
      if (fileResult.success && fileResult.content) {
        const chunks = parseTerraformFile(file.path, fileResult.content)
        console.log(`✅ [codebaseParser] Parsed ${chunks.length} chunks from ${file.path}`)
        allChunks.push(...chunks)
      } else {
        console.warn(`⚠️ [codebaseParser] Failed to read ${file.path}:`, fileResult.error)
      }
    }
    
    console.log(`📚 [codebaseParser] Total: ${allChunks.length} chunks from ${tfFiles.length} files`)
    
    return { success: true, chunks: allChunks }
  } catch (error: any) {
    console.error('Error indexing codebase:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Detect file changes by comparing current state with stored hashes
 */
export async function detectFileChanges(
  owner: string,
  repo: string,
  lastIndexHashes: Record<string, string>
): Promise<{ success: boolean; changes?: FileChange[]; error?: string }> {
  try {
    const { isDesktop, getFileTree, readFile } = await import('./desktopBridge')
    
    if (!isDesktop) {
      return { success: false, error: 'Change detection only available in desktop mode' }
    }
    
    const treeResult = await getFileTree(owner, repo, '')
    if (!treeResult.success || !treeResult.items) {
      return { success: false, error: 'Failed to get file tree' }
    }
    
    const tfFiles = findTfFiles(treeResult.items)
    const changes: FileChange[] = []
    const currentHashes: Record<string, string> = {}
    
    // Check each file
    for (const file of tfFiles) {
      const fileResult = await readFile(owner, repo, file.path)
      if (fileResult.success && fileResult.content) {
        const currentHash = calculateFileHash(fileResult.content)
        currentHashes[file.path] = currentHash
        
        if (!lastIndexHashes[file.path]) {
          // New file
          changes.push({
            path: file.path,
            type: 'added',
            content: fileResult.content,
            hash: currentHash
          })
        } else if (lastIndexHashes[file.path] !== currentHash) {
          // Modified file
          changes.push({
            path: file.path,
            type: 'modified',
            content: fileResult.content,
            hash: currentHash
          })
        }
      }
    }
    
    // Check for deleted files
    for (const filePath in lastIndexHashes) {
      if (!currentHashes[filePath]) {
        changes.push({
          path: filePath,
          type: 'deleted',
          hash: lastIndexHashes[filePath]
        })
      }
    }
    
    return { success: true, changes }
  } catch (error: any) {
    console.error('Error detecting file changes:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Parse only changed files for incremental updates
 */
export async function parseChangedFiles(
  owner: string,
  repo: string,
  changes: FileChange[]
): Promise<{ success: boolean; chunks?: CodebaseChunk[]; error?: string }> {
  try {
    const { readFile } = await import('./desktopBridge')
    
    const allChunks: CodebaseChunk[] = []
    
    for (const change of changes) {
      if (change.type === 'deleted') {
        console.log(`🗑️ [codebaseParser] Skipping deleted file: ${change.path}`)
        // Skip deleted files - they'll be removed from index
        continue
      }
      
      console.log(`📄 [codebaseParser] Parsing changed file: ${change.path} (${change.type})`)
      let content = change.content
      if (!content) {
        // Read file if content not provided
        const fileResult = await readFile(owner, repo, change.path)
        if (fileResult.success && fileResult.content) {
          content = fileResult.content
        } else {
          console.warn(`⚠️ [codebaseParser] Failed to read ${change.path}:`, fileResult.error)
        }
      }
      
      if (content) {
        const chunks = parseTerraformFile(change.path, content)
        console.log(`✅ [codebaseParser] Parsed ${chunks.length} chunks from ${change.path}`)
        allChunks.push(...chunks)
      }
    }
    
    console.log(`📚 [codebaseParser] Total chunks from changed files: ${allChunks.length}`)
    return { success: true, chunks: allChunks }
  } catch (error: any) {
    console.error('Error parsing changed files:', error)
    return { success: false, error: error.message }
  }
}

