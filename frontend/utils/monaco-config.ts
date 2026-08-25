'use client'

import * as monaco from 'monaco-editor'

/**
 * Monaco Editor worker configuration for Next.js
 * Uses inline workers to avoid CORS and path issues
 */
export function setupMonacoEnvironment() {
  if (typeof window !== 'undefined') {
    // @ts-ignore - Skip worker setup, let Monaco use inline workers
    if (!window.MonacoEnvironment) {
      // @ts-ignore
      window.MonacoEnvironment = {
        getWorker(_: any, label: string) {
          // Use inline worker to avoid CORS/path issues in Next.js
          // This runs workers in the main thread but prevents errors
          return new Worker(
            URL.createObjectURL(
              new Blob(['self.MonacoEnvironment = { baseUrl: "/" };'], {
                type: 'text/javascript'
              })
            )
          )
        }
      }
    }
  }
}

/**
 * Setup custom Monaco theme with Cursor-style diff colors
 */
export function setupMonacoTheme() {
  if (typeof window === 'undefined') return

  monaco.editor.defineTheme('cursor-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      // Soft pastel syntax colors - matching infrara-dark theme
      { token: 'keyword', foreground: 'BB9AF7', fontStyle: 'italic' },
      { token: 'keyword.block', foreground: 'BB9AF7', fontStyle: 'italic' },
      { token: 'string', foreground: '9ECE6A' },
      { token: 'string.quote', foreground: '9ECE6A' },
      { token: 'string.escape', foreground: '7DCFFF' },
      { token: 'string.invalid', foreground: 'DB4B4B' },
      { token: 'comment', foreground: '565F89', fontStyle: 'italic' },
      { token: 'number', foreground: 'E0AF68' },
      { token: 'number.float', foreground: 'E0AF68' },
      { token: 'number.hex', foreground: 'E0AF68' },
      { token: 'constant', foreground: 'F7768E' },
      { token: 'type', foreground: 'E0AF68' },
      { token: 'type.identifier', foreground: 'E0AF68' },
      { token: 'identifier', foreground: 'A9B1D6' },
      { token: 'attribute.name', foreground: '9ECE6A' },
      { token: 'function', foreground: '7AA2F7' },
      { token: 'operator', foreground: 'BB9AF7' },
      { token: 'delimiter', foreground: '9AA5CE' },
      { token: 'delimiter.bracket', foreground: '9AA5CE' },
      { token: 'delimiter.interpolation', foreground: 'E0AF68' },
      
      // JavaScript/TypeScript
      { token: 'keyword.js', foreground: 'BB9AF7', fontStyle: 'italic' },
      { token: 'keyword.ts', foreground: 'BB9AF7', fontStyle: 'italic' },
      { token: 'variable.name', foreground: 'A9B1D6' },
      { token: 'function.js', foreground: '7AA2F7' },
      { token: 'function.ts', foreground: '7AA2F7' },
      
      // Python
      { token: 'keyword.python', foreground: 'BB9AF7', fontStyle: 'italic' },
      { token: 'string.python', foreground: '9ECE6A' },
      { token: 'function.python', foreground: '7AA2F7' },
      { token: 'decorator', foreground: 'E0AF68' },
      { token: 'decorator.python', foreground: 'E0AF68' },
      
      // JSON
      { token: 'keyword.json', foreground: 'BB9AF7' },
      { token: 'string.key.json', foreground: '73DACA' },
      { token: 'string.value.json', foreground: '9ECE6A' },
      { token: 'number.json', foreground: 'E0AF68' },
      
      // YAML
      { token: 'keyword.yaml', foreground: 'BB9AF7' },
      { token: 'string.yaml', foreground: '9ECE6A' },
    ],
    colors: {
      // Background and editor colors
      'editor.background': '#181818',
      'editor.foreground': '#A9B1D6',
      'editorLineNumber.foreground': '#444444',
      'editorLineNumber.activeForeground': '#555555',
      'editor.lineHighlightBackground': '#1E1E1E',
      'editor.selectionBackground': '#3b3b3b',
      'editor.inactiveSelectionBackground': '#2a2a2a',
      'editorCursor.foreground': '#7AA2F7',
      'editorWhitespace.foreground': '#363B54',
      'editorIndentGuide.background': '#444444',
      'editorIndentGuide.activeBackground': '#555555',
      
      // Cursor-style diff colors (exactly like Cursor)
      'diffEditor.insertedTextBackground': '#21342880',  // Green for additions
      'diffEditor.removedTextBackground': '#39182280',   // Red for deletions
      'diffEditor.insertedLineBackground': '#21342840',  // Lighter green for line
      'diffEditor.removedLineBackground': '#39182240',   // Lighter red for line
      'diffEditor.border': '#2a2a2a',
    }
  })
}

