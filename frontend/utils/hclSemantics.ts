import { HCLDecoration } from '@/utils/hclTypes'

export function computeHclDecorations(code: string): HCLDecoration[] {
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

  const pushDeco = (
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
        pushDeco(lineNumber, indent + 1, lineNumber, equalsPos, 'hcl-attribute')
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
          pushDeco(stringStartLine, stringStartCol - 1, lineNumber, col + 2, 'hcl-string')
          inString = false
          col++
          continue
        }
      }
      col++
    }

    if (!inString) {
      const commentIdx = line.indexOf('#')
      if (commentIdx >= 0) {
        pushDeco(lineNumber, commentIdx + 1, lineNumber, line.length + 1, 'hcl-comment')
      }
    }
  }

  return decorations
}

