/**
 * Keyboard Shortcuts utilities for IDE
 * Handles global keyboard shortcuts and copy event handling
 */

// ========== Types ==========

export interface ShortcutHandlers {
  setAgentModeRef: React.MutableRefObject<(() => void) | null>
  openSearchRef: React.MutableRefObject<(() => void) | null>
  toggleTerminal: () => void
  toggleSidebar: () => void
  toggleShortcuts: () => void
}

export interface CopyContext {
  selectedFile: { path: string } | null
  selectedRepo: { full_name: string } | null
}

export interface CodeRef {
  file: string
  code: string
  startLine: number
  endLine: number
  repo: string
  timestamp: number
}

// ========== Functions ==========

/**
 * Create the keyboard shortcut handler
 */
export function createKeyDownHandler(handlers: ShortcutHandlers): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    // Ctrl+Shift+L - Agent mode
    if (e.ctrlKey && e.shiftKey && e.key === 'L') {
      e.preventDefault()
      if (handlers.setAgentModeRef.current) {
        handlers.setAgentModeRef.current()
      }
    }
    // Ctrl+J - Toggle Terminal
    else if (e.ctrlKey && !e.shiftKey && e.key === 'j') {
      e.preventDefault()
      handlers.toggleTerminal()
    }
    // Ctrl+B - Toggle Sidebar (Hide Files)
    else if (e.ctrlKey && !e.shiftKey && e.key === 'b') {
      e.preventDefault()
      handlers.toggleSidebar()
    }
    // Ctrl+P - Open Search Modal (Search Files)
    else if (e.ctrlKey && !e.shiftKey && e.key === 'p') {
      e.preventDefault()
      if (handlers.openSearchRef.current) {
        handlers.openSearchRef.current()
      }
    }
    // ? - Show keyboard shortcuts (only if not typing in input)
    else if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if (!isInput) {
        e.preventDefault()
        handlers.toggleShortcuts()
      }
    }
  }
}

/**
 * Create the copy event handler for code references
 */
export function createCopyHandler(context: CopyContext): () => void {
  return () => {
    console.log('📋 [Copy] Copy event fired, selectedFile:', context.selectedFile?.path)
    
    // Only capture if we have a file open
    if (!context.selectedFile?.path) {
      console.log('📋 [Copy] No file selected, skipping')
      return
    }
    
    // Monaco editor doesn't use browser's native selection
    // Check Monaco's stored selection first (set by MonacoEditor onSelectionChange)
    let selectedText = ''
    let startLine = 1
    let endLine = 1
    
    try {
      const editorSelection = sessionStorage.getItem('driftbox-editor-selection')
      console.log('📋 [Copy] Editor selection from storage:', editorSelection)
      if (editorSelection) {
        const selData = JSON.parse(editorSelection)
        // Only use if recent (within 2 seconds) to ensure it matches current selection
        if (Date.now() - selData.timestamp < 2000) {
          startLine = selData.startLine
          endLine = selData.endLine
          selectedText = selData.code || ''
          console.log('📋 [Copy] Using Monaco selection:', startLine, '-', endLine, 'code length:', selectedText.length)
        } else {
          console.log('📋 [Copy] Editor selection too old:', Date.now() - selData.timestamp, 'ms')
        }
      }
    } catch (e) {
      console.log('📋 [Copy] Error parsing editor selection:', e)
    }
    
    // Fallback to browser selection if Monaco selection not available
    if (!selectedText) {
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) {
        selectedText = selection.toString()
        endLine = startLine + selectedText.split('\n').length - 1
        console.log('📋 [Copy] Using browser selection, length:', selectedText.length)
      }
    }
    
    if (!selectedText.trim()) {
      console.log('📋 [Copy] No text to copy')
      return
    }
    
    // Store code reference in sessionStorage for chat to use
    const codeRef: CodeRef = {
      file: context.selectedFile.path,
      code: selectedText,
      startLine,
      endLine,
      repo: context.selectedRepo?.full_name || '',
      timestamp: Date.now()
    }
    
    console.log('📋 [Copy] Storing code ref:', codeRef.file, ':', codeRef.startLine, '-', codeRef.endLine)
    sessionStorage.setItem('driftbox-code-ref', JSON.stringify(codeRef))
  }
}

/**
 * Set up keyboard shortcuts and copy event listeners
 * Returns a cleanup function
 */
export function setupShortcuts(
  handlers: ShortcutHandlers,
  context: CopyContext
): () => void {
  const handleKeyDown = createKeyDownHandler(handlers)
  const handleCopy = createCopyHandler(context)
  
  window.addEventListener('keydown', handleKeyDown)
  document.addEventListener('copy', handleCopy)
  
  return () => {
    window.removeEventListener('keydown', handleKeyDown)
    document.removeEventListener('copy', handleCopy)
  }
}
