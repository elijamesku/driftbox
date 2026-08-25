// Dynamic imports for tree-sitter to avoid SSR issues
let Parser: any = null
let HCL: any = null

// Lazy-loaded parser instance
let parserInstance: any = null
let parserInitialized = false

// Flag to disable tree-sitter if it fails to load (prevents repeated import attempts)
let treeSitterDisabled = false

// Cache for parsed trees (keyed by code content hash)
const treeCache = new Map<string, { tree: any; timestamp: number }>()
const CACHE_TTL = 30000 // 30 second cache (increased for better performance)
const MAX_CACHE_SIZE = 50 // Increased cache size
const MAX_PARSE_SIZE = 50000 // Skip parsing for files larger than 50KB

// Simple hash function for caching
function hashCode(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(36)
}

async function getParser(): Promise<any> {
  // If tree-sitter was disabled due to errors, return early
  if (treeSitterDisabled) {
    return null
  }

  if (parserInstance && parserInitialized) {
    return parserInstance
  }

  if (typeof window === 'undefined') {
    throw new Error('Tree-sitter parser can only be used on the client side')
  }

  if (!Parser) {
    try {
      const webTreeSitterModule = await import('web-tree-sitter')
      // Handle different export patterns
      Parser = webTreeSitterModule.default || webTreeSitterModule
      
      // If still undefined, the import failed
      if (!Parser) {
        throw new Error('web-tree-sitter module has no default export')
      }
    } catch (error) {
      console.error('Failed to load web-tree-sitter:', error)
      treeSitterDisabled = true
      return null
    }
  }

  // Verify Parser is defined before using it
  if (!Parser) {
    treeSitterDisabled = true
    return null
  }

  const ParserClass = Parser as any
  
  // Check if ParserClass has the required methods
  if (!ParserClass || typeof ParserClass !== 'function') {
    console.error('web-tree-sitter Parser is not a constructor')
    treeSitterDisabled = true
    return null
  }

  try {
    if (typeof ParserClass.init === 'function') {
      await ParserClass.init()
    }
    
    parserInstance = new ParserClass()
  } catch (error) {
    console.error('Failed to initialize tree-sitter parser:', error)
    treeSitterDisabled = true
    return null
  }
  
  // Load HCL grammar - try to load WASM file from package
  // Note: The package tries to load Node.js bindings which don't work in browser
  // We'll catch this and gracefully degrade to semantic-only parsing
  if (!HCL) {
    try {
      // Check if we're in browser and the package would fail
      // The package structure for web-tree-sitter grammars is different
      // We need to load the WASM file directly, not the Node.js bindings
      
      // Try importing with a dynamic import that should be caught by webpack config
      const hclPackage = await import('@tree-sitter-grammars/tree-sitter-hcl')
      
      // Check for different export patterns
      if (hclPackage.default) {
        // Default export is typically the Language object for web-tree-sitter
        HCL = hclPackage.default
      } else if ((hclPackage as any).language) {
        // Some packages export as 'language' property
        HCL = (hclPackage as any).language
      } else {
        // Try to find any Language-like export
        throw new Error('No compatible HCL grammar export found')
      }
    } catch (error: any) {
      // If loading fails (likely due to Node.js bindings), disable tree-sitter entirely
      // Semantic highlighting will still work without tree-sitter
      const errorMsg = error?.message || String(error)
      
      // Only log once to avoid console spam
      if (!treeSitterDisabled) {
        console.warn('[HCL Parser] Tree-sitter grammar not available (Node.js bindings incompatible with browser). Validation disabled. Semantic highlighting will still work.')
        treeSitterDisabled = true
      }
      HCL = null
    }
  }
  
  if (HCL) {
    try {
      await parserInstance.setLanguage(HCL)
      parserInitialized = true
    } catch (error) {
      console.error('Failed to set HCL language:', error)
      parserInitialized = false
      HCL = null
    }
  } else {
    parserInitialized = false
  }

  return parserInstance
}

export interface HCLMarker {
  severity: 'error' | 'warning' | 'info'
  message: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

/**
 * Parse HCL code using tree-sitter
 */
export async function parseHCL(code: string): Promise<{ tree: any | null; errors: HCLMarker[] }> {
  try {
    // Skip parsing for very large files to avoid performance issues
    if (code.length > MAX_PARSE_SIZE) {
      console.warn(`[HCL Parser] Skipping parse for large file (${code.length} chars)`)
      return { tree: null, errors: [] }
    }

    const codeHash = hashCode(code)
    const cached = treeCache.get(codeHash)
    const now = Date.now()
    
    // Return cached tree if available and fresh
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      const errors: HCLMarker[] = []
      if (cached.tree) {
        // Walk tree to find syntax errors
        const walk = (node: any) => {
          if (node.hasError()) {
            const startPos = node.startPosition
            const endPos = node.endPosition
            errors.push({
              severity: 'error',
              message: `Syntax error: ${node.type}`,
              startLineNumber: startPos.row + 1,
              startColumn: startPos.column + 1,
              endLineNumber: endPos.row + 1,
              endColumn: endPos.column + 1,
            })
          }
          for (const child of node.children) {
            walk(child)
          }
        }
        walk(cached.tree.rootNode)
      }
      return { tree: cached.tree, errors }
    }
    
    const parser = await getParser()
    
    // If parser is not initialized (HCL grammar failed to load or tree-sitter disabled), return empty result
    if (!parser || !parserInitialized || !HCL || treeSitterDisabled) {
      return { tree: null, errors: [] }
    }
    
    const tree = parser.parse(code)
    
    // Manage cache size
    if (treeCache.size >= MAX_CACHE_SIZE) {
      const firstKey = treeCache.keys().next().value
      if (firstKey !== undefined) {
        treeCache.delete(firstKey)
      }
    }
    treeCache.set(codeHash, { tree, timestamp: now })
    
    // Extract syntax errors from tree
    const errors: HCLMarker[] = []
    if (tree) {
      const walk = (node: any) => {
        if (node.hasError()) {
          const startPos = node.startPosition
          const endPos = node.endPosition
          errors.push({
            severity: 'error',
            message: `Syntax error: ${node.type}`,
            startLineNumber: startPos.row + 1,
            startColumn: startPos.column + 1,
            endLineNumber: endPos.row + 1,
            endColumn: endPos.column + 1,
          })
        }
        for (const child of node.children) {
          walk(child)
        }
      }
      walk(tree.rootNode)
    }
    
    return { tree, errors }
  } catch (error) {
    console.error('Error parsing HCL:', error)
    return { tree: null, errors: [] }
  }
}

/**
 * Get cached tree if available
 */
export function getCachedTree(code: string): any | null {
  const codeHash = hashCode(code)
  const cached = treeCache.get(codeHash)
  if (cached) {
    return cached.tree
  }
  return null
}

/**
 * Validate HCL code using tree-sitter
 */
export async function validateHCLAsync(code: string): Promise<HCLMarker[]> {
  try {
    const { errors } = await parseHCL(code)
    return errors
  } catch (error) {
    console.error('Error validating HCL:', error)
    return []
  }
}

/**
 * Check if a position is inside a string using tree-sitter AST
 */
export async function isPositionInStringAsync(
  code: string,
  lineNumber: number,
  column: number
): Promise<boolean> {
  try {
    const { tree } = await parseHCL(code)
    if (!tree || !tree.rootNode) return false
    
    const targetRow = lineNumber - 1
    const targetColumn = column - 1
    
    let inString = false
    
    const walk = (node: any) => {
      const startPos = node.startPosition
      const endPos = node.endPosition
      
      // Check if position is within this node
      if (targetRow >= startPos.row && targetRow <= endPos.row) {
        if (targetRow === startPos.row && targetColumn < startPos.column) return
        if (targetRow === endPos.row && targetColumn >= endPos.column) return
        
        // Check if this node is a string
        const nodeType = node.type
        if (nodeType === 'string_literal' || 
            nodeType === 'quoted_template' || 
            nodeType === 'heredoc_template' ||
            nodeType === 'template_literal' ||
            nodeType === 'string' ||
            nodeType.toLowerCase().includes('string') ||
            nodeType.toLowerCase().includes('template')) {
          inString = true
          return
        }
      }
      
      // Recurse into children
      for (const child of node.children) {
        walk(child)
      }
    }
    
    walk(tree.rootNode)
    return inString
  } catch (error) {
    console.error('Error checking if position is in string:', error)
    return false
  }
}

/**
 * Synchronous version - uses cached tree if available
 */
export function isPositionInString(
  code: string,
  lineNumber: number,
  column: number
): boolean {
  const tree = getCachedTree(code)
  if (!tree || !tree.rootNode) return false
  
  const targetRow = lineNumber - 1
  const targetColumn = column - 1
  
  let inString = false
  
  const walk = (node: any) => {
    const startPos = node.startPosition
    const endPos = node.endPosition
    
    // Check if position is within this node
    if (targetRow >= startPos.row && targetRow <= endPos.row) {
      if (targetRow === startPos.row && targetColumn < startPos.column) return
      if (targetRow === endPos.row && targetColumn >= endPos.column) return
      
      // Check if this node is a string
      const nodeType = node.type
      if (nodeType === 'string_literal' || 
          nodeType === 'quoted_template' || 
          nodeType === 'heredoc_template' ||
          nodeType === 'template_literal' ||
          nodeType === 'string' ||
          nodeType.toLowerCase().includes('string') ||
          nodeType.toLowerCase().includes('template')) {
        inString = true
        return
      }
    }
    
    // Recurse into children
    for (const child of node.children) {
      walk(child)
    }
  }
  
  walk(tree.rootNode)
  return inString
}

/**
 * Find matching bracket using tree-sitter AST
 */
export async function findMatchingBracketAsync(
  code: string,
  lineNumber: number,
  column: number
): Promise<{ line: number; column: number } | null> {
  try {
    const { tree } = await parseHCL(code)
    if (!tree || !tree.rootNode) return null
    
    const targetRow = lineNumber - 1
    const targetColumn = column - 1
    
    // Find the node at this position
    let targetNode: any = null
    
    const findNode = (node: any) => {
      const startPos = node.startPosition
      const endPos = node.endPosition
      
      if (targetRow >= startPos.row && targetRow <= endPos.row) {
        if (targetRow === startPos.row && targetColumn < startPos.column) return
        if (targetRow === endPos.row && targetColumn >= endPos.column) return
        
        // Check if this is a bracket character
        const char = code.split('\n')[targetRow]?.[targetColumn]
        if (char === '{' || char === '}' || char === '[' || char === ']' || char === '(' || char === ')') {
          targetNode = node
          return
        }
      }
      
      for (const child of node.children) {
        findNode(child)
      }
    }
    
    findNode(tree.rootNode)
    if (!targetNode) return null
    
    // For now, return null - bracket matching logic would need more complex tree traversal
    // This is a placeholder that uses tree-sitter for structure
    return null
  } catch (error) {
    console.error('Error finding matching bracket:', error)
    return null
  }
}

/**
 * Synchronous version - uses cached tree
 */
export function findMatchingBracket(
  code: string,
  lineNumber: number,
  column: number
): { line: number; column: number } | null {
  const tree = getCachedTree(code)
  if (!tree || !tree.rootNode) return null
  
  // Similar logic to async version but using cached tree
  return null
}

/**
 * Get syntax highlighting decorations using pure semantic analysis (no tree-sitter dependency)
 * - Anything before = is green (attribute name)
 * - Booleans (true/false) are light red
 * - Resource names (second quoted string in resource/data/module blocks) are purple
 * - Strings are green
 * - Numbers are orange
 * - Comments are gray
 */
export function getSyntaxDecorations(code: string): Array<{
  range: { startLine: number; startColumn: number; endLine: number; endColumn: number }
  className: string
}> {
  const decorations: Array<{
    range: { startLine: number; startColumn: number; endLine: number; endColumn: number }
    className: string
  }> = []
  
  if (!code) {
    console.warn('⚠️ [Semantic Parser] No code provided')
    return decorations
  }
  
  console.log(`🔍 [Semantic Parser] Parsing ${code.length} chars, ${code.split('\n').length} lines`)
  const lines = code.split('\n')
  
  // Track string state for multi-line strings
  let inString = false
  let stringStartLine = -1
  let stringStartCol = -1
  let stringQuote = ''
  let inBracketString = false // For "[...]" or "{...}" patterns
  let bracketDepth = 0 // Tracks depth across ALL lines - maintained by parsing loop
  let expectedClose = '' // ']' or '}'
  
  // Semantic analysis: parse code to find attributes, resource names, booleans, etc.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1
    
    // Save depth at START of this line (before processing it)
    // This is needed for decoration code to correctly find closing pattern
    const depthAtLineStart = bracketDepth
    
    if (!line.trim() && !inString) {
      continue
    }
    
    // DETECT ATTRIBUTES FIRST (before string parsing)
    // This ensures attribute names are highlighted even when followed by quotes
    if (!inString) {
      const attrMatch = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*/)
      if (attrMatch) {
        console.log(`✅ [Semantic Parser] Found attribute on line ${lineNumber}:`, attrMatch[2])
        const indent = attrMatch[1].length
        const equalsPos = line.indexOf('=')
        
        // Highlight attribute name (green) - everything before the = sign
        decorations.push({
          range: {
            startLine: lineNumber,
            startColumn: indent + 1,
            endLine: lineNumber,
            endColumn: equalsPos,
          },
          className: 'hcl-attribute'
        })
      }
    }
    
    // THEN handle multi-line strings
    let col = 0
    while (col < line.length) {
      const char = line[col]
      const prevChar = col > 0 ? line[col - 1] : ''
      
      // Check if we're entering/exiting a string
      if (!inString && (char === '"' || char === "'")) {
        // Check if it's a bracket-quoted string: "[ or "{
        const nextChar = col + 1 < line.length ? line[col + 1] : ''
        if (nextChar === '[' || nextChar === '{') {
          inString = true
          inBracketString = true
          stringQuote = char
          stringStartLine = lineNumber
          stringStartCol = col + 1 // Start after the opening quote
          expectedClose = nextChar === '[' ? ']' : '}'
          bracketDepth = 0
          col += 2
          continue
        } else {
          // Regular string - check if it's after an = sign (attribute value)
          // Only start string if we're in a value context (after =)
          const beforeQuote = line.substring(0, col).trim()
          if (beforeQuote.endsWith('=')) {
            inString = true
            inBracketString = false
            stringQuote = char
            stringStartLine = lineNumber
            stringStartCol = col + 1 // Start after the opening quote
            col++
            continue
          }
          // Also handle strings that start with "{ or "[ (bracket-quoted strings)
          // These are always valid strings in HCL
          if (nextChar === '{' || nextChar === '[') {
            inString = true
            inBracketString = true
            stringQuote = char
            stringStartLine = lineNumber
            stringStartCol = col + 2 // Start after the quote and bracket
            expectedClose = nextChar === '[' ? ']' : '}'
            bracketDepth = 0
            col += 2
            continue
          }
        }
      } else if (inString) {
        // Check for closing quote
        if (inBracketString) {
          // For bracket strings, track depth and check for closing pattern: ]" or }"
          if (char === expectedClose) {
            bracketDepth--
            if (bracketDepth < 0) bracketDepth = 0
          } else if (char === '[' || char === '{') {
            // Only increment if it matches our expected bracket type
            if ((expectedClose === ']' && char === '[') || (expectedClose === '}' && char === '{')) {
              bracketDepth++
            }
          }
          
          // Check if next char is the closing quote - ONLY when depth is 0 (we've closed all nested brackets)
          const nextChar = col + 1 < line.length ? line[col + 1] : ''
          if (bracketDepth === 0 && char === expectedClose && nextChar === stringQuote) {
            // Found closing pattern: ]" or }" at depth 0 - this is THE closing
            inString = false
            inBracketString = false
            col += 2
            continue
          }
        } else {
          // Regular string - check for closing quote (not escaped)
          if (char === stringQuote && prevChar !== '\\') {
            // Remove incremental decorations and add complete one
            const stringLines: number[] = []
            for (let lineNum = stringStartLine; lineNum <= lineNumber; lineNum++) {
              stringLines.push(lineNum)
            }
            
            // Remove all hcl-string decorations for these lines
            const filtered = decorations.filter(dec => {
              if (dec.className === 'hcl-string') {
                return !stringLines.includes(dec.range.startLine)
              }
              return true
            })
            decorations.length = 0
            decorations.push(...filtered)
            
            // Add the complete string decoration
            decorations.push({
              range: {
                startLine: stringStartLine,
                startColumn: stringStartCol - 1, // Include opening quote
                endLine: lineNumber,
                endColumn: col + 1 + 1, // Include closing quote
              },
              className: 'hcl-string'
            })
            inString = false
            col++
            continue
          }
        }
      }
      
      col++
    }
     
    if (inString && inBracketString) { 

      let foundClosingOnThisLine = false
      let closingCol = -1
      
   
      
      let depthAtLineStart = bracketDepth
      
      let scanDepth = depthAtLineStart
      
      for (let checkCol = 0; checkCol < line.length - 1; checkCol++) {
        const ch = line[checkCol]
        const nextCh = line[checkCol + 1]
        
        // Update depth as we scan (same logic as parsing loop)
        if (ch === expectedClose) {
          scanDepth--
          if (scanDepth < 0) scanDepth = 0
        } else if ((expectedClose === ']' && ch === '[') || (expectedClose === '}' && ch === '{')) {
          scanDepth++
        }
        
        // Check for closing - ONLY when depth is 0 (all nested brackets closed)
        if (scanDepth === 0 && ch === expectedClose && nextCh === stringQuote) {
          foundClosingOnThisLine = true
          closingCol = checkCol // Position of the ] or }
          break
        }
      }
      
      // Decorate content, excluding brackets and closing quote
      let segmentStart = -1
      const endCol = foundClosingOnThisLine ? closingCol : line.length
      
      for (let c = 0; c < endCol; c++) {
        const ch = line[c]
        const isBracket = ch === '[' || ch === ']' || ch === '{' || ch === '}'
        
        // Skip characters before the string content starts (quote and bracket)
        if (stringStartLine === lineNumber && c < stringStartCol) {
          continue
        }
        
        if (isBracket) {
          // End current segment if we have one
          if (segmentStart >= 0 && segmentStart < c) {
            decorations.push({
              range: {
                startLine: lineNumber,
                startColumn: segmentStart + 1,
                endLine: lineNumber,
                endColumn: c + 1,
              },
              className: 'hcl-string'
            })
            segmentStart = -1
          }
        } else {
          // Start a new segment if we don't have one
          if (segmentStart < 0) {
            if (stringStartLine === lineNumber) {
              segmentStart = Math.max(c, stringStartCol)
            } else {
              segmentStart = c
            }
          }
        }
      }
      
      // Close any remaining segment (but stop before closing bracket if found)
      if (segmentStart >= 0 && segmentStart < endCol) {
        decorations.push({
          range: {
            startLine: lineNumber,
            startColumn: segmentStart + 1,
            endLine: lineNumber,
            endColumn: endCol + 1, // Stop before closing bracket
          },
          className: 'hcl-string'
        })
      }
      
      // For bracket-quoted strings, also detect syntax inside (keywords, numbers, booleans)
      // Helper to check if a position is inside a quoted string within the bracket-quoted string
      const isInQuotedString = (pos: number): boolean => {
        let quoteCount = 0
        for (let i = 0; i < pos && i < line.length; i++) {
          if (line[i] === '"' && (i === 0 || line[i - 1] !== '\\')) {
            quoteCount++
          }
        }
        return quoteCount % 2 === 1
      }
      
      // Find booleans inside the string (but not inside quoted strings)
      const boolMatch = line.match(/\b(true|false)\b/)
      if (boolMatch) {
        const boolValue = boolMatch[1]
        const boolStart = boolMatch.index!
        const boolEnd = boolStart + boolValue.length
        
        const isInsideString = stringStartLine === lineNumber 
          ? boolStart >= stringStartCol
          : true
        const beforeClosing = foundClosingOnThisLine ? boolStart < closingCol : true
        
        if (isInsideString && beforeClosing && !isInQuotedString(boolStart)) {
          decorations.push({
            range: {
              startLine: lineNumber,
              startColumn: boolStart + 1,
              endLine: lineNumber,
              endColumn: boolEnd + 1,
            },
            className: 'hcl-constant'
          })
        }
      }
      
      // Find numbers inside the string (but not inside quoted strings like "us-east-1")
      const numberMatch = line.match(/\b(\d+\.?\d*)\b/)
      if (numberMatch) {
        const numValue = numberMatch[1]
        const numStart = numberMatch.index!
        const numEnd = numStart + numValue.length
        
        const isInsideString = stringStartLine === lineNumber 
          ? numStart >= stringStartCol
          : true
        const beforeClosing = foundClosingOnThisLine ? numStart < closingCol : true
        
        if (isInsideString && beforeClosing && !isInQuotedString(numStart)) {
          decorations.push({
            range: {
              startLine: lineNumber,
              startColumn: numStart + 1,
              endLine: lineNumber,
              endColumn: numEnd + 1,
            },
            className: 'hcl-number'
          })
        }
      }
    } else if (inString) {
      // Regular string (not bracket-quoted) - decorate normally
      if (stringStartLine === lineNumber) {
        decorations.push({
          range: {
            startLine: lineNumber,
            startColumn: stringStartCol - 1, // Include opening quote
            endLine: lineNumber,
            endColumn: line.length + 1,
          },
          className: 'hcl-string'
        })
      } else {
        decorations.push({
          range: {
            startLine: lineNumber,
            startColumn: 1,
            endLine: lineNumber,
            endColumn: line.length + 1,
          },
          className: 'hcl-string'
        })
      }
    }
     
    const isInStringOnThisLine = inString && stringStartLine === lineNumber
    
      // Find resource/data/module blocks: resource "type" "name" {
      // Only if not in a string
      if (!inString) {
        const resourceMatch = line.match(/^\s*(resource|data|module|provider|variable|output|locals|terraform)\s+"([^"]+)"\s+"([^"]+)"\s*\{/)
        if (resourceMatch) {
          console.log(`✅ [Semantic Parser] Found resource block on line ${lineNumber}:`, resourceMatch[1])
      const keyword = resourceMatch[1]
      const keywordStart = line.indexOf(keyword)
      
      // Highlight keyword (purple)
      decorations.push({
        range: {
          startLine: lineNumber,
          startColumn: keywordStart + 1,
          endLine: lineNumber,
          endColumn: keywordStart + keyword.length + 1,
        },
        className: 'hcl-keyword'
      })
      
      // Find and highlight resource name (purple) - the second quoted string
      let quoteCount = 0
      let nameStart = -1
      let nameEnd = -1
      
      for (let j = 0; j < line.length; j++) {
        if (line[j] === '"' && (j === 0 || line[j - 1] !== '\\')) {
          quoteCount++
          if (quoteCount === 3) {
            nameStart = j
          } else if (quoteCount === 4 && nameStart >= 0) {
            nameEnd = j + 1
            break
          }
        }
      }
      
      if (nameStart >= 0 && nameEnd > nameStart) {
        decorations.push({
          range: {
            startLine: lineNumber,
            startColumn: nameStart + 1,
            endLine: lineNumber,
            endColumn: nameEnd + 1,
          },
          className: 'hcl-keyword'
        })
      }
      }
    }
     
    if (!inString) {
      const attrMatch = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*/)
      if (attrMatch) {
        // Attribute name already highlighted above, now check the value
      const afterEquals = line.substring(line.indexOf('=') + 1).trim()
      
      // Boolean values (light red)
      const boolMatch = afterEquals.match(/^(true|false)\b/)
      if (boolMatch) {
        const boolValue = boolMatch[1]
        const boolStart = line.indexOf(boolValue, line.indexOf('='))
        const boolEnd = boolStart + boolValue.length
        
        decorations.push({
          range: {
            startLine: lineNumber,
            startColumn: boolStart + 1,
            endLine: lineNumber,
            endColumn: boolEnd + 1,
          },
          className: 'hcl-constant'
        })
      }
      
      // Numbers
      const numberMatch = afterEquals.match(/^(\d+\.?\d*)/)
      if (numberMatch) {
        const numValue = numberMatch[1]
        const numStart = line.indexOf(numValue, line.indexOf('='))
        const numEnd = numStart + numValue.length
        
        decorations.push({
          range: {
            startLine: lineNumber,
            startColumn: numStart + 1,
            endLine: lineNumber,
            endColumn: numEnd + 1,
          },
          className: 'hcl-number'
        })
      }
      }
    }
    
    // Find standalone booleans (not after =)
    const standaloneBool = line.match(/\b(true|false)\b/)
    if (standaloneBool && !line.includes('=')) {
      const boolValue = standaloneBool[1]
      const boolStart = standaloneBool.index!
      const boolEnd = boolStart + boolValue.length
      
      decorations.push({
        range: {
          startLine: lineNumber,
          startColumn: boolStart + 1,
          endLine: lineNumber,
          endColumn: boolEnd + 1,
        },
        className: 'hcl-constant'
      })
    }
    
    // Find comments (only if not in string)
    if (!inString) {
      const commentMatch = line.match(/(\/\/|#|(?:\/\*)).*/)
      if (commentMatch) {
        const commentStart = commentMatch.index! + 1
        decorations.push({
          range: {
            startLine: lineNumber,
            startColumn: commentStart,
            endLine: lineNumber,
            endColumn: line.length + 1,
          },
          className: 'hcl-comment'
        })
      }
    }
  }
  
  console.log(`📊 [Semantic Parser] Total decorations generated: ${decorations.length}`)
  if (decorations.length === 0) {
    console.warn('⚠️ [Semantic Parser] No decorations found! First few lines:', lines.slice(0, 5))
  }
  
  return decorations
}
