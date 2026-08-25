/// <reference lib="webworker" />

import { HCLMarker, HCLDecoration } from '@/utils/hclTypes'
import { computeHclDecorations } from '@/utils/hclSemantics'

let Parser: any = null
let HCL: any = null

let parserInstance: any = null
let parserInitialized = false
let treeSitterDisabled = false

const treeCache = new Map<string, { tree: any; timestamp: number }>()
const CACHE_TTL = 30000
const MAX_CACHE_SIZE = 50
const MAX_PARSE_SIZE = 50000

function hashCode(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash.toString(36)
}

async function getParser(): Promise<any | null> {
  if (treeSitterDisabled) {
    return null
  }

  if (parserInstance && parserInitialized) {
    return parserInstance
  }

  if (typeof self === 'undefined') {
    return null
  }

  if (!Parser) {
    try {
      const webTreeSitterModule = await import('web-tree-sitter')
      Parser = webTreeSitterModule.default || webTreeSitterModule
      if (!Parser) {
        throw new Error('web-tree-sitter module has no default export')
      }
    } catch (error) {
      console.error('[HCL Worker] Failed to load web-tree-sitter:', error)
      treeSitterDisabled = true
      return null
    }
  }

  const ParserClass = Parser as any
  if (!ParserClass || typeof ParserClass !== 'function') {
    treeSitterDisabled = true
    return null
  }

  try {
    if (typeof ParserClass.init === 'function') {
      await ParserClass.init()
    }
    parserInstance = new ParserClass()
  } catch (error) {
    console.error('[HCL Worker] Failed to initialize parser:', error)
    treeSitterDisabled = true
    return null
  }

  if (!HCL) {
    try {
      const hclPackage = await import('@tree-sitter-grammars/tree-sitter-hcl')
      if (hclPackage.default) {
        HCL = hclPackage.default
      } else if ((hclPackage as any).language) {
        HCL = (hclPackage as any).language
      } else {
        throw new Error('No compatible HCL grammar export found')
      }
    } catch (error) {
      console.warn('[HCL Worker] tree-sitter grammar unavailable, disabling validation.', error)
      treeSitterDisabled = true
      HCL = null
    }
  }

  if (HCL) {
    try {
      await parserInstance.setLanguage(HCL)
      parserInitialized = true
    } catch (error) {
      console.error('[HCL Worker] Failed to set HCL language:', error)
      parserInitialized = false
      HCL = null
    }
  } else {
    parserInitialized = false
  }

  return parserInstance
}

async function parseHCL(code: string): Promise<{ tree: any | null; errors: HCLMarker[] }> {
  if (code.length > MAX_PARSE_SIZE) {
    return { tree: null, errors: [] }
  }

  const codeHash = hashCode(code)
  const cached = treeCache.get(codeHash)
  const now = Date.now()

  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    const errors: HCLMarker[] = []
    if (cached.tree) {
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
  if (!parser || !parserInitialized || !HCL || treeSitterDisabled) {
    return { tree: null, errors: [] }
  }

  const tree = parser.parse(code)

  if (treeCache.size >= MAX_CACHE_SIZE) {
    const firstKey = treeCache.keys().next().value
    if (firstKey !== undefined) {
      treeCache.delete(firstKey)
    }
  }
  treeCache.set(codeHash, { tree, timestamp: now })

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
}

async function validateHCL(code: string): Promise<HCLMarker[]> {
  try {
    const { errors } = await parseHCL(code)
    return errors
  } catch (error) {
    console.error('[HCL Worker] validate error:', error)
    return []
  }
}

function legacyGetSyntaxDecorations(code: string): HCLDecoration[] {
  const decorations: HCLDecoration[] = []
  if (!code) {
    return decorations
  }

  const lines = code.split('\n')
  let inString = false
  let stringStartLine = -1
  let stringStartCol = -1
  let stringQuote = ''
  let inBracketString = false
  let bracketDepth = 0
  let expectedClose = ''

  const pushDecoration = (
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
    className: string
  ) => {
    decorations.push({
      range: { startLine, startColumn, endLine, endColumn },
      className,
    })
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1

    if (!line.trim() && !inString) {
      continue
    }

    if (!inString) {
      const attrMatch = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*/)
      if (attrMatch) {
        const indent = attrMatch[1].length
        const equalsPos = line.indexOf('=')
        pushDecoration(lineNumber, indent + 1, lineNumber, equalsPos, 'hcl-attribute')
      }
    }

    let col = 0
    while (col < line.length) {
      const char = line[col]
      const prevChar = col > 0 ? line[col - 1] : ''

      if (!inString && (char === '"' || char === "'")) {
        const nextChar = col + 1 < line.length ? line[col + 1] : ''
        if (nextChar === '[' || nextChar === '{') {
          inString = true
          inBracketString = true
          stringQuote = char
          stringStartLine = lineNumber
          stringStartCol = col + 1
          expectedClose = nextChar === '[' ? ']' : '}'
          bracketDepth = 0
          col += 2
          continue
        } else {
          const beforeQuote = line.substring(0, col).trim()
          if (beforeQuote.endsWith('=')) {
            inString = true
            inBracketString = false
            stringQuote = char
            stringStartLine = lineNumber
            stringStartCol = col + 1
            col++
            continue
          }
          if (nextChar === '{' || nextChar === '[') {
            inString = true
            inBracketString = true
            stringQuote = char
            stringStartLine = lineNumber
            stringStartCol = col + 2
            expectedClose = nextChar === '[' ? ']' : '}'
            bracketDepth = 0
            col += 2
            continue
          }
        }
      } else if (inString) {
        if (inBracketString) {
          if (char === expectedClose) {
            bracketDepth = Math.max(0, bracketDepth - 1)
          } else if ((expectedClose === ']' && char === '[') || (expectedClose === '}' && char === '{')) {
            bracketDepth++
          }
          const nextChar = col + 1 < line.length ? line[col + 1] : ''
          if (bracketDepth === 0 && char === expectedClose && nextChar === stringQuote) {
            inString = false
            inBracketString = false
            col += 2
            continue
          }
        } else if (char === stringQuote && prevChar !== '\\') {
          decorations.push({
            range: {
              startLine: stringStartLine,
              startColumn: stringStartCol - 1,
              endLine: lineNumber,
              endColumn: col + 2,
            },
            className: 'hcl-string',
          })
          inString = false
          col++
          continue
        }
      }
      col++
    }
  }

  return decorations
}

const getSyntaxDecorations = (code: string): HCLDecoration[] => {
  try {
    return computeHclDecorations(code)
  } catch (error) {
    console.warn('[HCL Worker] computeHclDecorations failed, falling back to legacy parser:', error)
    return legacyGetSyntaxDecorations(code)
  }
}

type WorkerRequest =
  | { id: string; type: 'validate'; payload: { code: string } }
  | { id: string; type: 'decorations'; payload: { code: string } }

type WorkerResponse =
  | { id: string; result: any }
  | { id: string; error: string }

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope

ctx.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data
  try {
    let result: WorkerResponse['result'] = null
    if (type === 'validate') {
      const markers = await validateHCL(payload.code)
      result = { markers }
    } else if (type === 'decorations') {
      result = getSyntaxDecorations(payload.code)
    }
    ctx.postMessage({ id, result })
  } catch (error: any) {
    ctx.postMessage({ id, error: error?.message || String(error) })
  }
})

export {}

