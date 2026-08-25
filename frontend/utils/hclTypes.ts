export interface HCLMarker {
  severity: 'error' | 'warning' | 'info'
  message: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface HCLDecoration {
  range: {
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
  }
  className: string
}

