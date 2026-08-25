'use client'

import { useRef, useEffect, useCallback } from 'react'
import * as monaco from 'monaco-editor'
import { validateHCLAsync, isPositionInString as hclIsPositionInString, findMatchingBracket as hclFindMatchingBracket, parseHCL, getSyntaxDecorations, type HCLMarker } from '@/utils/hclParser'

// Remote cursor from another user
export interface RemoteCursor {
  userId: string
  userName: string
  line: number
  column: number
  color: string
}

// Remote text change from another user
export interface RemoteChange {
  userId: string
  changes: {
    range: { startLine: number; startColumn: number; endLine: number; endColumn: number }
    text: string
  }[]
}

interface MonacoEditorProps {
  value: string
  language: string
  onChange?: (value: string) => void
  readOnly?: boolean
  originalValue?: string
  onAccept?: () => void
  onReject?: () => void
  originalContent?: string
  isDirty?: boolean
  onCursorPositionChange?: (line: number, column: number) => void
  onDiagnosticsChange?: (errors: number, warnings: number) => void
  targetLine?: number
  totalProposals?: number
  onAcceptAll?: () => void
  onSelectionChange?: (startLine: number, endLine: number, selectedText: string) => void
  // Real-time collaboration
  remoteCursors?: RemoteCursor[]
  // Resource definition lookup
  onShowDefinition?: (resourceType: string) => void
  // DevOps context menu actions
  onEstimateCost?: (resourceType: string, resourceName: string, resourceBlock: string) => void
  onSecurityCheck?: (resourceType: string, resourceName: string, resourceBlock: string) => void
  onFindDependencies?: (resourceType: string, resourceName: string, resourceBlock: string) => void
}

function formatTerraform(code: string): string {
  const lines = code.split('\n')
  let formatted: string[] = []
  let indentLevel = 0
  const indent = '  '

  for (let line of lines) {
    const trimmed = line.trim()
    
    if (!trimmed) {
      formatted.push('')
      continue
    }
    
    if (trimmed.startsWith('}')) {
      indentLevel = Math.max(0, indentLevel - 1)
    }
    
    formatted.push(indent.repeat(indentLevel) + trimmed)
    
    if (trimmed.endsWith('{')) {
      indentLevel++
    }
  }
  
  return formatted.join('\n')
}

// Helper to find resource block at a given line position
function findResourceAtPosition(model: monaco.editor.ITextModel, lineNumber: number): { resourceType: string; resourceName: string; resourceBlock: string } {
  const totalLines = model.getLineCount()
  
  // Search backwards to find the resource/data block start
  let startLine = lineNumber
  let resourceType = ''
  let resourceName = ''
  
  for (let i = lineNumber; i >= 1; i--) {
    const line = model.getLineContent(i)
    const resourceMatch = line.match(/^(resource|data)\s+"([^"]+)"\s+"([^"]+)"/)
    if (resourceMatch) {
      startLine = i
      resourceType = resourceMatch[2]
      resourceName = resourceMatch[3]
      break
    }
    // Stop if we hit another block type that's not resource/data
    if (line.match(/^(module|variable|output|locals|terraform|provider)\s/)) {
      break
    }
  }
  
  if (!resourceType) {
    return { resourceType: '', resourceName: '', resourceBlock: '' }
  }
  
  // Find the end of the block (matching closing brace)
  let endLine = startLine
  let braceCount = 0
  let foundStart = false
  
  for (let i = startLine; i <= totalLines; i++) {
    const line = model.getLineContent(i)
    for (const char of line) {
      if (char === '{') {
        braceCount++
        foundStart = true
      } else if (char === '}') {
        braceCount--
        if (foundStart && braceCount === 0) {
          endLine = i
          break
        }
      }
    }
    if (foundStart && braceCount === 0) break
  }
  
  // Extract the full resource block
  const lines: string[] = []
  for (let i = startLine; i <= endLine; i++) {
    lines.push(model.getLineContent(i))
  }
  
  return {
    resourceType,
    resourceName,
    resourceBlock: lines.join('\n')
  }
}

function isInsideString(
  model: monaco.editor.ITextModel,
  lineNumber: number,
  column: number
): boolean {
  const code = model.getValue()
  return hclIsPositionInString(code, lineNumber, column)
}

function findMatchingBracket(
  model: monaco.editor.ITextModel,
  position: monaco.Position
): monaco.Position | null {
  const code = model.getValue()
  const match = hclFindMatchingBracket(code, position.lineNumber, position.column)
  
  if (!match) {
    return null
  }
  
  return new monaco.Position(match.line, match.column)
}

function updateBracketMatching(
  editor: monaco.editor.IStandaloneCodeEditor,
  decorations: string[]
): string[] {
  const model = editor.getModel()
  if (!model) return decorations
  
  const position = editor.getPosition()
  if (!position) {
    return editor.deltaDecorations(decorations, [])
  }
  
  const lineText = model.getLineContent(position.lineNumber)
  const char = lineText.charAt(position.column - 1)
  const bracketPairs: { [key: string]: string } = { '{': '}', '[': ']', '(': ')' }
  const reversePairs: { [key: string]: string } = { '}': '{', ']': '[', ')': '(' }
  
  if (!(char in bracketPairs) && !(char in reversePairs)) {
    return editor.deltaDecorations(decorations, [])
  }
  
  const match = findMatchingBracket(model, position)
  if (!match) {
    return editor.deltaDecorations(decorations, [])
  }
  const newDecorations: monaco.editor.IModelDeltaDecoration[] = [
    {
      range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column + 1),
      options: {
        inlineClassName: 'monaco-bracket-match',
      }
    },
    {
      range: new monaco.Range(match.lineNumber, match.column, match.lineNumber, match.column + 1),
      options: {
        inlineClassName: 'monaco-bracket-match',
      }
    }
  ]
  
  return editor.deltaDecorations(decorations, newDecorations)
}

// Apply syntax highlighting using pure semantic parsing (no tree-sitter dependency)
function applySemanticSyntax(
  editor: monaco.editor.IStandaloneCodeEditor,
  code: string,
  decorationsRef: React.MutableRefObject<string[]>
): void {
  try {
    const decorations = getSyntaxDecorations(code)
    const model = editor.getModel()
    if (!model) {
      return
    }
    
    const monacoDecorations: monaco.editor.IModelDeltaDecoration[] = decorations.map(dec => ({
      range: new monaco.Range(
        dec.range.startLine,
        dec.range.startColumn,
        dec.range.endLine,
        dec.range.endColumn
      ),
      options: {
        inlineClassName: dec.className,
        inlineStyle: {
          color: 'inherit',
        },
      }
    }))
    
    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      monacoDecorations
    )
  } catch (error) {
    console.error('Error applying semantic syntax:', error)
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [])
  }
}

function isPositionInString(code: string, lineNumber: number, column: number): boolean {
  return hclIsPositionInString(code, lineNumber, column)
}


function validateTerraform(code: string): monaco.editor.IMarkerData[] {
  const lines = code.split('\n')
  
  if (lines.length === 0 || lines.every(line => !line.trim())) {
    return []
  }
  
  const hclMarkers: HCLMarker[] = []
  
  const markers: monaco.editor.IMarkerData[] = hclMarkers.map((marker: HCLMarker) => ({
    severity: marker.severity === 'error' ? monaco.MarkerSeverity.Error :
               marker.severity === 'warning' ? monaco.MarkerSeverity.Warning :
               monaco.MarkerSeverity.Info,
    message: marker.message,
    startLineNumber: marker.startLineNumber,
    startColumn: marker.startColumn,
    endLineNumber: marker.endLineNumber,
    endColumn: marker.endColumn,
  }))
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1
    
    if (line.includes('resource "aws_s3_bucket"') && !code.includes('bucket =')) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: 'Missing required argument: bucket',
        startLineNumber: lineNumber,
        startColumn: 1,
        endLineNumber: lineNumber,
        endColumn: line.length + 1,
      })
    }
    
    if (line.includes('count.index') && !line.includes('each')) {
      markers.push({
        severity: monaco.MarkerSeverity.Warning,
        message: 'Consider using for_each instead of count for better resource tracking',
        startLineNumber: lineNumber,
        startColumn: line.indexOf('count.index') + 1,
        endLineNumber: lineNumber,
        endColumn: line.indexOf('count.index') + 12,
      })
    }
    
    const assignmentMatch = line.match(/=\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*$/)
    if (assignmentMatch && !['true', 'false', 'null'].includes(assignmentMatch[1])) {
      const startCol = line.indexOf(assignmentMatch[1]) + 1
      markers.push({
        severity: monaco.MarkerSeverity.Warning,
        message: 'String values should be quoted',
        startLineNumber: lineNumber,
        startColumn: startCol,
        endLineNumber: lineNumber,
        endColumn: startCol + assignmentMatch[1].length,
      })
    }
    
    const resourceMatch = line.match(/resource\s+"[^"]+"\s+"([^"]+)"/)
    if (resourceMatch && !/^[a-zA-Z0-9_-]+$/.test(resourceMatch[1])) {
      const startCol = line.indexOf(resourceMatch[1]) + 1
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: 'Resource names must contain only letters, numbers, underscores, and hyphens',
        startLineNumber: lineNumber,
        startColumn: startCol,
        endLineNumber: lineNumber,
        endColumn: startCol + resourceMatch[1].length,
      })
    }
  }
  
  return markers
}

export default function MonacoEditor({ value, language, onChange, readOnly = false, originalValue, onAccept, onReject, originalContent, isDirty, onCursorPositionChange, onDiagnosticsChange, targetLine, totalProposals = 1, onAcceptAll, onSelectionChange, remoteCursors = [], onShowDefinition, onEstimateCost, onSecurityCheck, onFindDependencies }: MonacoEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const monacoEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | monaco.editor.IStandaloneDiffEditor | null>(null)
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null)
  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null)
  const originalValueRef = useRef<string>(value)
  const bracketDecorationsRef = useRef<string[]>([])
  const changeDecorationsRef = useRef<string[]>([])
  const syntaxDecorationsRef = useRef<string[]>([])
  const lastModelIdRef = useRef<string | null>(null)
  const remoteCursorDecorationsRef = useRef<string[]>([])
  const cursorWidgetsRef = useRef<Map<string, monaco.editor.IContentWidget>>(new Map())
  const isApplyingRemoteChangeRef = useRef(false)
  
  const updateDiagnosticsCounts = useCallback((model: monaco.editor.ITextModel) => {
    const markers = monaco.editor.getModelMarkers({ resource: model.uri })
    const errors = markers.filter(m => m.severity === monaco.MarkerSeverity.Error).length
    const warnings = markers.filter(m => m.severity === monaco.MarkerSeverity.Warning).length
    onDiagnosticsChange?.(errors, warnings)
  }, [onDiagnosticsChange])
  
  const isDiffMode = originalValue !== undefined

  useEffect(() => {
    if (monacoEditorRef.current) {
      return
    }

    if (!editorRef.current || !(editorRef.current instanceof HTMLElement)) {
      return
    }

    // @ts-ignore
    if (!window.MonacoEnvironment) {
      // @ts-ignore
      window.MonacoEnvironment = {
        getWorker(_: any, label: string) {
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

    const initTimeout = setTimeout(() => {
      if (!editorRef.current) {
        console.error('Editor ref became null during initialization')
        return
      }

      monaco.languages.register({ id: 'hcl' })
    
    monaco.languages.setMonarchTokensProvider('hcl', {
      defaultToken: 'source.hcl',
      tokenPostfix: '.hcl',
      tokenizer: {
        root: [
          [/./, ''],
        ],
      },
    })

    monaco.languages.setLanguageConfiguration('hcl', {
      comments: {
        lineComment: '//',
        blockComment: ['/*', '*/']
      },
      brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')']
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"', notIn: ['string'] },
        { open: "'", close: "'", notIn: ['string', 'comment'] },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      colorizedBracketPairs: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')']
      ],
    })

    monaco.languages.registerCompletionItemProvider('hcl', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }

        const suggestions: monaco.languages.CompletionItem[] = [
          {
            label: 'resource',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'resource "${1:type}" "${2:name}" {\n  $0\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Define a resource',
            range: range,
          },
          {
            label: 'aws_s3_bucket',
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: 'resource "aws_s3_bucket" "${1:name}" {\n  bucket = "${2:bucket-name}"\n  \n  tags = {\n    Name = "${3:My Bucket}"\n  }\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'AWS S3 Bucket resource',
            range: range,
          },
          {
            label: 'aws_instance',
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: 'resource "aws_instance" "${1:name}" {\n  ami           = "${2:ami-id}"\n  instance_type = "${3:t2.micro}"\n  \n  tags = {\n    Name = "${4:My Instance}"\n  }\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'AWS EC2 Instance resource',
            range: range,
          },
          {
            label: 'provider',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'provider "${1:aws}" {\n  region = "${2:us-east-1}"\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Configure a provider',
            range: range,
          },
          {
            label: 'variable',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'variable "${1:name}" {\n  type        = ${2:string}\n  description = "${3:description}"\n  default     = "${4:default}"\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Define a variable',
            range: range,
          },
          {
            label: 'output',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'output "${1:name}" {\n  value       = ${2:value}\n  description = "${3:description}"\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Define an output',
            range: range,
          },
          {
            label: 'module',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'module "${1:name}" {\n  source = "${2:./modules/example}"\n  \n  $0\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Define a module',
            range: range,
          },
          {
            label: 'data',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'data "${1:type}" "${2:name}" {\n  $0\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Define a data source',
            range: range,
          },
          {
            label: 'terraform',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'terraform {\n  required_version = ">= ${1:1.0}"\n  \n  required_providers {\n    aws = {\n      source  = "hashicorp/aws"\n      version = "~> ${2:5.0}"\n    }\n  }\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Terraform configuration block',
            range: range,
          },
        ]

        return { suggestions }
      },
    })

    monaco.languages.registerHoverProvider('hcl', {
      provideHover: (model, position) => {
        const word = model.getWordAtPosition(position)
        if (!word) return null

        const hoverInfo: { [key: string]: string } = {
          'resource': '**resource** - Defines infrastructure resources\n\nSyntax: `resource "type" "name" { ... }`',
          'provider': '**provider** - Configures a provider (AWS, Azure, etc.)\n\nSyntax: `provider "aws" { region = "us-east-1" }`',
          'variable': '**variable** - Declares an input variable\n\nSyntax: `variable "name" { type = string }`',
          'output': '**output** - Declares an output value\n\nSyntax: `output "name" { value = ... }`',
          'module': '**module** - Calls a child module\n\nSyntax: `module "name" { source = "..." }`',
          'data': '**data** - Defines a data source\n\nSyntax: `data "type" "name" { ... }`',
          'locals': '**locals** - Defines local values\n\nSyntax: `locals { name = value }`',
          'terraform': '**terraform** - Terraform settings block\n\nConfigure Terraform behavior and required providers',
          'aws_s3_bucket': '**aws_s3_bucket** - Amazon S3 bucket resource\n\nCreates and manages an S3 bucket',
          'aws_instance': '**aws_instance** - Amazon EC2 instance resource\n\nProvides an EC2 instance resource',
          'for_each': '**for_each** - Create multiple instances\n\nLoop over a map or set to create resources',
          'count': '**count** - Create multiple instances\n\nCreate a specified number of resource instances',
          'depends_on': '**depends_on** - Explicit dependencies\n\nSpecify resource dependencies explicitly',
        }

        const info = hoverInfo[word.word]
        if (info) {
          return {
            range: new monaco.Range(
              position.lineNumber,
              word.startColumn,
              position.lineNumber,
              word.endColumn
            ),
            contents: [{ value: info }],
          }
        }

        return null
      },
    })

    monaco.languages.registerDocumentFormattingEditProvider('hcl', {
      provideDocumentFormattingEdits: (model) => {
        const text = model.getValue()
        const formatted = formatTerraform(text)
        
        return [
          {
            range: model.getFullModelRange(),
            text: formatted,
          },
        ]
      },
    })

    monaco.editor.defineTheme('infrara-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
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
        
        { token: 'keyword.js', foreground: 'BB9AF7', fontStyle: 'italic' },
        { token: 'keyword.ts', foreground: 'BB9AF7', fontStyle: 'italic' },
        { token: 'variable.name', foreground: 'A9B1D6' },
        { token: 'function.js', foreground: '7AA2F7' },
        { token: 'function.ts', foreground: '7AA2F7' },
        
        { token: 'keyword.python', foreground: 'BB9AF7', fontStyle: 'italic' },
        { token: 'string.python', foreground: '9ECE6A' },
        { token: 'function.python', foreground: '7AA2F7' },
        { token: 'decorator', foreground: 'E0AF68' },
        { token: 'decorator.python', foreground: 'E0AF68' },
        
        { token: 'keyword.json', foreground: 'BB9AF7' },
        { token: 'string.key.json', foreground: '73DACA' },
        { token: 'string.value.json', foreground: '9ECE6A' },
        { token: 'number.json', foreground: 'E0AF68' },
        
        { token: 'keyword.yaml', foreground: 'BB9AF7' },
        { token: 'string.yaml', foreground: '9ECE6A' },
      ],
      colors: {
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
        'editorBracketMatch.background': '#2D3F7680',
        'editorBracketMatch.border': '#7DCFFF',
        'editorWidget.background': '#0a0a0a',
        'editorWidget.border': '#333333',
        'editorSuggestWidget.background': '#0a0a0a',
        'editorSuggestWidget.selectedBackground': '#7c3aed40',
        'editorHoverWidget.background': '#0a0a0a',
        'editorHoverWidget.border': '#333333',
        // Context menu styling
        'menu.background': '#0a0a0a',
        'menu.foreground': '#e5e5e5',
        'menu.selectionBackground': '#333333',
        'menu.selectionForeground': '#ffffff',
        'menu.separatorBackground': '#333333',
        'menu.border': '#333333',
        'editorGutter.addedBackground': '#587c0c',
        'editorGutter.modifiedBackground': '#0c7d9d',
        'editorGutter.deletedBackground': '#94151b',
        'editorOverviewRuler.addedForeground': '#587c0c',
        'editorOverviewRuler.modifiedForeground': '#0c7d9d',
        'editorOverviewRuler.deletedForeground': '#94151b',
        'diffEditor.insertedTextBackground': '#2ea04333',
        'diffEditor.removedTextBackground': '#f8514933',
        'diffEditor.insertedLineBackground': '#2ea04320',
        'diffEditor.removedLineBackground': '#f8514920',
        'diffEditor.border': '#2a2a2a',
      }
    })

    if (!editorRef.current) {
      console.error('Cannot create editor: ref is null')
      return
    }

    const lang = language === 'hcl' ? 'hcl' : language
    const editorConfig = {
      theme: 'infrara-dark',
      automaticLayout: true,
      fontSize: 13,
      fontFamily: '"Input Mono", "Cascadia Code", Consolas, "Courier New", monospace',
      fontLigatures: false,
      fontWeight: '400' as const,
      lineHeight: 19,
      letterSpacing: 0,
      tabSize: 4,
      insertSpaces: true,
      detectIndentation: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: 'on' as const,
      renderLineHighlight: 'none' as const, // Completely disable for max performance
      selectOnLineNumbers: true,
      roundedSelection: false,
      cursorStyle: 'line' as const,
      cursorBlinking: 'solid' as const,
      folding: true,
      foldingHighlight: false,
      showFoldingControls: 'mouseover' as const,
      matchBrackets: 'never' as const, // Disable completely for performance
      bracketPairColorization: {
        enabled: false,
      },
      renderWhitespace: 'none' as const,
      wordWrap: 'off' as const,
      renderLineHighlightOnlyWhenFocus: true,
      renderValidationDecorations: 'on' as const,
      glyphMargin: true,
      // PERFORMANCE: Optimize scrolling
      smoothScrolling: false, // Instant scroll
      mouseWheelScrollSensitivity: 1,
      fastScrollSensitivity: 5,
      scrollPredominantAxis: true,
      scrollbar: {
        vertical: 'visible' as const,
        horizontal: 'visible' as const,
        useShadows: false,
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10
      },
      lineNumbersMinChars: 3,
      padding: { top: 0, bottom: 0 },
    }

    if (isDiffMode) {
      const editor = monaco.editor.create(editorRef.current, {
        ...editorConfig,
        value: value,
        language: lang,
        readOnly: false,
      })

      monacoEditorRef.current = editor

      const model = editor.getModel()
      if (model) {
        model.setEOL(monaco.editor.EndOfLineSequence.LF)
        
        const originalLines = (originalValue || '').split('\n')
        const modifiedLines = value.split('\n')
        const decorations: monaco.editor.IModelDeltaDecoration[] = []
        
        let lineNumber = 1
        for (let i = 0; i < modifiedLines.length; i++) {
          const modifiedLine = modifiedLines[i]
          const originalLine = i < originalLines.length ? originalLines[i] : null
          
          if (originalLine === null) {
            // New line (appended)
            decorations.push({
              range: new monaco.Range(lineNumber, 1, lineNumber, modifiedLine.length + 1),
              options: {
                isWholeLine: true,
                className: 'line-insert',
                linesDecorationsClassName: 'line-insert-gutter',
                marginClassName: 'line-insert-margin'
              }
            })
          } else if (originalLine !== modifiedLine) {
            // Modified line
            decorations.push({
              range: new monaco.Range(lineNumber, 1, lineNumber, modifiedLine.length + 1),
              options: {
                isWholeLine: true,
                className: 'line-modified',
                linesDecorationsClassName: 'line-modified-gutter',
                marginClassName: 'line-modified-margin'
              }
            })
          }
          lineNumber++
        }
        
        // Apply decorations
        editor.deltaDecorations([], decorations)
        
        // Auto-scroll to first changed line
        const firstChangedLine = decorations.length > 0 ? decorations[0].range.startLineNumber : 1
        setTimeout(() => {
          if (firstChangedLine > 1) {
            editor.revealLineInCenter(firstChangedLine)
          }
        }, 100)
      }

      // Listen for cursor position changes to update bracket matching (HCL only, debounced)
      let bracketTimeout: NodeJS.Timeout | null = null
      if (language === 'hcl') {
        editor.onDidChangeCursorPosition(() => {
          if (bracketTimeout) clearTimeout(bracketTimeout)
          bracketTimeout = setTimeout(() => {
            bracketDecorationsRef.current = updateBracketMatching(editor, bracketDecorationsRef.current)
          }, 50)
        })
      }

      // Listen for cursor position changes (for status bar)
      editor.onDidChangeCursorPosition((e) => {
        const position = e.position
        onCursorPositionChange?.(position.lineNumber, position.column)
      })
      
      // Trigger initial position (deferred)
      setTimeout(() => {
        const initialPosition = editor.getPosition()
        if (initialPosition && onCursorPositionChange) {
          onCursorPositionChange(initialPosition.lineNumber, initialPosition.column)
        }
      }, 50)

      // Listen for content changes and validate (debounced)
      let validationTimeout: NodeJS.Timeout | null = null
      editor.onDidChangeModelContent((e) => {
        // Skip if this is a remote change being applied
        if (isApplyingRemoteChangeRef.current) return
        
        const newValue = editor.getValue()
        onChange?.(newValue)
        
        // Update bracket matching after content changes (HCL only, debounced)
        if (language === 'hcl') {
          if (bracketTimeout) clearTimeout(bracketTimeout)
          bracketTimeout = setTimeout(() => {
            bracketDecorationsRef.current = updateBracketMatching(editor, bracketDecorationsRef.current)
          }, 100)
        }
        
        // Run validation for HCL/Terraform files (debounced to avoid slowdown)
        // Skip validation in read-only mode and use longer debounce for better performance
        if (language === 'hcl' && model && !readOnly) {
          if (validationTimeout) clearTimeout(validationTimeout)
          validationTimeout = setTimeout(async () => {
            if (model && editor) {
              // Use requestIdleCallback for non-critical parsing to avoid blocking UI
              const scheduleParse = (callback: () => void) => {
                if ('requestIdleCallback' in window) {
                  requestIdleCallback(callback, { timeout: 2000 })
                } else {
                  setTimeout(callback, 100)
                }
              }

              scheduleParse(async () => {
                // Use async tree-sitter validation
                const hclMarkers = await validateHCLAsync(newValue)
                const markers: monaco.editor.IMarkerData[] = hclMarkers.map(marker => ({
                  severity: marker.severity === 'error' ? monaco.MarkerSeverity.Error :
                             marker.severity === 'warning' ? monaco.MarkerSeverity.Warning :
                             monaco.MarkerSeverity.Info,
                  message: marker.message,
                  startLineNumber: marker.startLineNumber,
                  startColumn: marker.startColumn,
                  endLineNumber: marker.endLineNumber,
                  endColumn: marker.endColumn,
                }))
                
                // Add Terraform-specific validations
                const terraformMarkers = validateTerraform(newValue)
                markers.push(...terraformMarkers)
                
                monaco.editor.setModelMarkers(model, 'terraform', markers)
                updateDiagnosticsCounts(model)
              })
              
              // Apply semantic syntax highlighting immediately (lightweight, no tree-sitter)
              applySemanticSyntax(editor, newValue, syntaxDecorationsRef)
            }
          }, 2000) // Increased from 500ms to 2000ms for better performance
        } else if (language === 'hcl' && model) {
          // For read-only or non-HCL files, still apply syntax highlighting but skip validation
          applySemanticSyntax(editor, newValue, syntaxDecorationsRef)
        }
      })

      // Initial validation (async) - only for non-read-only files
      if (language === 'hcl' && model && editor && !readOnly) {
        // Use requestIdleCallback to avoid blocking initial render
        const scheduleInitialValidation = (callback: () => void) => {
          if ('requestIdleCallback' in window) {
            requestIdleCallback(callback, { timeout: 3000 })
          } else {
            setTimeout(callback, 500)
          }
        }

        scheduleInitialValidation(() => {
          validateHCLAsync(value).then(async hclMarkers => {
            if (!model || !editor) return
            
            const markers: monaco.editor.IMarkerData[] = hclMarkers.map(marker => ({
              severity: marker.severity === 'error' ? monaco.MarkerSeverity.Error :
                         marker.severity === 'warning' ? monaco.MarkerSeverity.Warning :
                         monaco.MarkerSeverity.Info,
              message: marker.message,
              startLineNumber: marker.startLineNumber,
              startColumn: marker.startColumn,
              endLineNumber: marker.endLineNumber,
              endColumn: marker.endColumn,
            }))
            
            // Add Terraform-specific validations
            const terraformMarkers = validateTerraform(value)
            markers.push(...terraformMarkers)
            
            monaco.editor.setModelMarkers(model, 'terraform', markers)
            updateDiagnosticsCounts(model)
          }).catch(err => {
            console.error('HCL validation error:', err)
          })
        })
      }

      // Initial bracket matching (HCL only)
      if (language === 'hcl') {
        bracketDecorationsRef.current = updateBracketMatching(editor, bracketDecorationsRef.current)
        // Apply initial syntax highlighting (deferred for performance)
        setTimeout(() => {
          applySemanticSyntax(editor, value, syntaxDecorationsRef)
        }, 100)
      }
    } else {
      // Create normal editor
      const editor = monaco.editor.create(editorRef.current, {
        ...editorConfig,
        value: value,
        language: lang,
        readOnly: readOnly,
      })

      monacoEditorRef.current = editor

      // Set up diff detection by creating an original model
      const model = editor.getModel()
      if (model) {
        model.setEOL(monaco.editor.EndOfLineSequence.LF)
      }

      // Listen for cursor position changes to update bracket matching (HCL only, debounced)
      let bracketTimeout: NodeJS.Timeout | null = null
      if (language === 'hcl') {
        // Defer syntax highlighting to avoid blocking UI
        setTimeout(() => {
          applySemanticSyntax(editor, value, syntaxDecorationsRef)
        }, 200)
        
        editor.onDidChangeCursorPosition(() => {
          if (bracketTimeout) clearTimeout(bracketTimeout)
          bracketTimeout = setTimeout(() => {
            bracketDecorationsRef.current = updateBracketMatching(editor, bracketDecorationsRef.current)
          }, 200)
        })
      }

      // Listen for cursor position changes (for status bar)
      editor.onDidChangeCursorPosition((e) => {
        const position = e.position
        onCursorPositionChange?.(position.lineNumber, position.column)
      })
      
      // Listen for selection changes (for code references in team chat)
      editor.onDidChangeCursorSelection((e) => {
        const selection = e.selection
        if (!selection.isEmpty()) {
          const model = editor.getModel()
          if (model) {
            const selectedText = model.getValueInRange(selection)
            onSelectionChange?.(selection.startLineNumber, selection.endLineNumber, selectedText)
            
            // Also store in sessionStorage for clipboard integration
            if (selectedText.trim()) {
              const codeRef = {
                startLine: selection.startLineNumber,
                endLine: selection.endLineNumber,
                code: selectedText,
                timestamp: Date.now()
              }
              sessionStorage.setItem('driftbox-editor-selection', JSON.stringify(codeRef))
            }
          }
        }
      })
      
      // Add "Show Definition" context menu action for Terraform resources
      if (language === 'hcl' && onShowDefinition) {
        editor.addAction({
          id: 'driftbox-show-definition',
          label: 'Show Definition',
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD],
          contextMenuGroupId: 'navigation',
          contextMenuOrder: 1.5,
          run: (ed) => {
            const model = ed.getModel()
            const selection = ed.getSelection()
            if (!model || !selection) return
            
            // Get selected text or word at cursor
            let resourceType = ''
            if (!selection.isEmpty()) {
              resourceType = model.getValueInRange(selection).trim()
            } else {
              // Get word at cursor position
              const position = ed.getPosition()
              if (position) {
                const wordInfo = model.getWordAtPosition(position)
                if (wordInfo) {
                  resourceType = wordInfo.word
                }
              }
            }
            
            // Extract resource type (e.g., "aws_instance" from "resource "aws_instance" "main"")
            // Also handle provider references like "digitalocean_spaces_bucket"
            if (resourceType) {
              // Check if it's a resource block definition
              const lineContent = model.getLineContent(selection.startLineNumber || 1)
              const resourceMatch = lineContent.match(/resource\s+"([^"]+)"/)
              if (resourceMatch) {
                resourceType = resourceMatch[1]
              }
              
              onShowDefinition(resourceType)
            }
          }
        })
      }
      
      // Add "Estimate Cost" context menu action
      if (language === 'hcl' && onEstimateCost) {
        editor.addAction({
          id: 'driftbox-estimate-cost',
          label: 'Estimate Cost',
          contextMenuGroupId: 'driftbox',
          contextMenuOrder: 2.1,
          run: (ed) => {
            const model = ed.getModel()
            const selection = ed.getSelection()
            if (!model || !selection) return
            
            // Find the resource block at cursor
            const position = ed.getPosition()
            if (!position) return
            
            const { resourceType, resourceName, resourceBlock } = findResourceAtPosition(model, position.lineNumber)
            if (resourceType && resourceName) {
              onEstimateCost(resourceType, resourceName, resourceBlock)
            }
          }
        })
      }
      
      // Add "Security Check" context menu action
      if (language === 'hcl' && onSecurityCheck) {
        editor.addAction({
          id: 'driftbox-security-check',
          label: 'Security Check',
          contextMenuGroupId: 'driftbox',
          contextMenuOrder: 2.2,
          run: (ed) => {
            const model = ed.getModel()
            const position = ed.getPosition()
            if (!model || !position) return
            
            const { resourceType, resourceName, resourceBlock } = findResourceAtPosition(model, position.lineNumber)
            if (resourceType && resourceName) {
              onSecurityCheck(resourceType, resourceName, resourceBlock)
            }
          }
        })
      }
      
      // Add "Find Dependencies" context menu action
      if (language === 'hcl' && onFindDependencies) {
        editor.addAction({
          id: 'driftbox-find-dependencies',
          label: 'Find Dependencies',
          contextMenuGroupId: 'driftbox',
          contextMenuOrder: 2.3,
          run: (ed) => {
            const model = ed.getModel()
            const position = ed.getPosition()
            if (!model || !position) return
            
            const { resourceType, resourceName, resourceBlock } = findResourceAtPosition(model, position.lineNumber)
            if (resourceType && resourceName) {
              onFindDependencies(resourceType, resourceName, resourceBlock)
            }
          }
        })
      }
      
      // Trigger initial position (deferred to avoid blocking)
      setTimeout(() => {
        const initialPosition = editor.getPosition()
        if (initialPosition && onCursorPositionChange) {
          onCursorPositionChange(initialPosition.lineNumber, initialPosition.column)
        }
      }, 50)

      // Listen for content changes and validate (debounced)
      let validationTimeout: NodeJS.Timeout | null = null
      editor.onDidChangeModelContent((e) => {
        // Skip if this is a remote change being applied
        if (isApplyingRemoteChangeRef.current) return
        
        const newValue = editor.getValue()
        onChange?.(newValue)
        
        // Update bracket matching after content changes (HCL only, debounced)
        if (language === 'hcl') {
          if (bracketTimeout) clearTimeout(bracketTimeout)
          bracketTimeout = setTimeout(() => {
            bracketDecorationsRef.current = updateBracketMatching(editor, bracketDecorationsRef.current)
          }, 100)
        }
        
        // Show diff indicators by comparing with original
        const currentModel = editor.getModel()
        if (currentModel && originalValueRef.current !== newValue) {
          currentModel.pushEditOperations([], [], () => null)
        }
        
        // Run validation for HCL/Terraform files (debounced to avoid slowdown)
        // Skip validation in read-only mode and use longer debounce for better performance
        if (language === 'hcl' && currentModel && !readOnly) {
          if (validationTimeout) clearTimeout(validationTimeout)
          validationTimeout = setTimeout(() => {
            if (currentModel) {
              // Use requestIdleCallback for non-critical parsing to avoid blocking UI
              const scheduleParse = (callback: () => void) => {
                if ('requestIdleCallback' in window) {
                  requestIdleCallback(callback, { timeout: 2000 })
                } else {
                  setTimeout(callback, 100)
                }
              }

              scheduleParse(async () => {
                // Use async tree-sitter validation
                const hclMarkers = await validateHCLAsync(newValue)
                const markers: monaco.editor.IMarkerData[] = hclMarkers.map(marker => ({
                  severity: marker.severity === 'error' ? monaco.MarkerSeverity.Error :
                             marker.severity === 'warning' ? monaco.MarkerSeverity.Warning :
                             monaco.MarkerSeverity.Info,
                  message: marker.message,
                  startLineNumber: marker.startLineNumber,
                  startColumn: marker.startColumn,
                  endLineNumber: marker.endLineNumber,
                  endColumn: marker.endColumn,
                }))
                
                // Add Terraform-specific validations
                const terraformMarkers = validateTerraform(newValue)
                markers.push(...terraformMarkers)
                
                monaco.editor.setModelMarkers(currentModel, 'terraform', markers)
                updateDiagnosticsCounts(currentModel)
              })
              
              // Apply semantic syntax highlighting immediately (lightweight, no tree-sitter)
              applySemanticSyntax(editor, newValue, syntaxDecorationsRef)
            }
          }, 2000) // Increased from 500ms to 2000ms for better performance
        } else if (language === 'hcl' && currentModel) {
          // For read-only or non-HCL files, still apply syntax highlighting but skip validation
          applySemanticSyntax(editor, newValue, syntaxDecorationsRef)
        }
      })

      // Initial validation - only for non-read-only files
      if (language === 'hcl' && !readOnly) {
        const model = editor.getModel()
        if (model) {
          // Use requestIdleCallback to avoid blocking initial render
          const scheduleInitialValidation = (callback: () => void) => {
            if ('requestIdleCallback' in window) {
              requestIdleCallback(callback, { timeout: 3000 })
            } else {
              setTimeout(callback, 500)
            }
          }

          scheduleInitialValidation(() => {
            validateHCLAsync(value).then(async hclMarkers => {
              if (!model) return
              
              const markers: monaco.editor.IMarkerData[] = hclMarkers.map(marker => ({
                severity: marker.severity === 'error' ? monaco.MarkerSeverity.Error :
                           marker.severity === 'warning' ? monaco.MarkerSeverity.Warning :
                           monaco.MarkerSeverity.Info,
                message: marker.message,
                startLineNumber: marker.startLineNumber,
                startColumn: marker.startColumn,
                endLineNumber: marker.endLineNumber,
                endColumn: marker.endColumn,
              }))
              
              // Add Terraform-specific validations
              const terraformMarkers = validateTerraform(value)
              markers.push(...terraformMarkers)
              
              monaco.editor.setModelMarkers(model, 'terraform', markers)
              updateDiagnosticsCounts(model)
            }).catch(err => {
              console.error('HCL validation error:', err)
            })
          })
        }
      }

      // Initial bracket matching (HCL only)
      if (language === 'hcl') {
        bracketDecorationsRef.current = updateBracketMatching(editor, bracketDecorationsRef.current)
      }
    }

    }, 10) // 10ms delay for DOM to be fully ready

    return () => {
      // Clear the initialization timeout
      clearTimeout(initTimeout)
      
      // Clean up editor and decorations
      if (bracketDecorationsRef.current.length > 0) {
        bracketDecorationsRef.current = []
      }
      if (syntaxDecorationsRef.current.length > 0) {
        syntaxDecorationsRef.current = []
      }
      if (monacoEditorRef.current) {
        // Dispose the editor (works the same for both diff and normal mode now)
        monacoEditorRef.current.dispose()
      }
      monacoEditorRef.current = null
      originalModelRef.current = null
      modifiedModelRef.current = null
    }
  }, [isDiffMode, language])

  // Update readOnly when lock state changes (critical for real-time locking)
  useEffect(() => {
    if (!monacoEditorRef.current) return
    const editor = monacoEditorRef.current as monaco.editor.IStandaloneCodeEditor
    if (editor.updateOptions) {
      console.log(`🔒 [Monaco] Updating readOnly to: ${readOnly}`)
      editor.updateOptions({ readOnly })
    }
  }, [readOnly])

  // Update editor value when prop changes
  useEffect(() => {
    if (!monacoEditorRef.current) return
    if (value === undefined || value === null) return // Guard against invalid values

    const editor = monacoEditorRef.current as monaco.editor.IStandaloneCodeEditor
    if (editor.getValue() !== value) {
      editor.setValue(value)
      
      // If in diff mode, recalculate and update decorations
      if (isDiffMode) {
        const model = editor.getModel()
        if (model) {
          const originalLines = (originalValue || '').split('\n')
          const modifiedLines = value.split('\n')
          const decorations: monaco.editor.IModelDeltaDecoration[] = []
          
          // Detect what changed - simple line-based diff
          let lineNumber = 1
          for (let i = 0; i < modifiedLines.length; i++) {
            const modifiedLine = modifiedLines[i]
            const originalLine = i < originalLines.length ? originalLines[i] : null
            
            if (originalLine === null) {
              // New line (appended)
              decorations.push({
                range: new monaco.Range(lineNumber, 1, lineNumber, modifiedLine.length + 1),
                options: {
                  isWholeLine: true,
                  className: 'line-insert',
                  linesDecorationsClassName: 'line-insert-gutter',
                  marginClassName: 'line-insert-margin'
                }
              })
            } else if (originalLine !== modifiedLine) {
              // Modified line
              decorations.push({
                range: new monaco.Range(lineNumber, 1, lineNumber, modifiedLine.length + 1),
                options: {
                  isWholeLine: true,
                  className: 'line-modified',
                  linesDecorationsClassName: 'line-modified-gutter',
                  marginClassName: 'line-modified-margin'
                }
              })
            }
            lineNumber++
          }
          
          // Apply decorations
          editor.deltaDecorations([], decorations)
        }
      } else {
        // Update original value when new content is loaded (non-diff mode)
        originalValueRef.current = value
      }
    }
  }, [value, originalValue, isDiffMode])

  // Update gutter change indicators (for agent edits and manual edits)
  useEffect(() => {
    if (!monacoEditorRef.current || isDiffMode) return // Skip in diff mode (already has decorations)
    
    const editor = monacoEditorRef.current as monaco.editor.IStandaloneCodeEditor
    const model = editor.getModel()
    if (!model) return

    // Determine original content to compare against
    const baseContent = originalContent !== undefined ? originalContent : originalValueRef.current
    
    // Track model ID to detect tab switches - clear decorations if model changed
    const modelId = model.id
    if (lastModelIdRef.current !== null && lastModelIdRef.current !== modelId) {
      // Model changed (tab switch) - clear old decorations
      changeDecorationsRef.current = editor.deltaDecorations(changeDecorationsRef.current, [])
    }
    lastModelIdRef.current = modelId
    
    // If no original content, don't show indicators (file just opened, no changes yet)
    if (!baseContent || baseContent === '') {
      // Clear decorations if no baseline
      if (changeDecorationsRef.current.length > 0) {
        changeDecorationsRef.current = editor.deltaDecorations(changeDecorationsRef.current, [])
      }
      return
    }

    // Only show indicators if content has changed or file is dirty
    if (value === baseContent && !isDirty) {
      // Clear decorations if no changes
      if (changeDecorationsRef.current.length > 0) {
        changeDecorationsRef.current = editor.deltaDecorations(changeDecorationsRef.current, [])
      }
      return
    }
    
    // Updating gutter indicators (logging removed for performance)

    // Compare lines to find changes
    const originalLines = baseContent.split('\n')
    const currentLines = value.split('\n')
    const decorations: monaco.editor.IModelDeltaDecoration[] = []

    // Find changed lines
    const maxLines = Math.max(originalLines.length, currentLines.length)
    for (let i = 0; i < maxLines; i++) {
      const originalLine = i < originalLines.length ? originalLines[i] : null
      const currentLine = i < currentLines.length ? currentLines[i] : null
      const lineNumber = i + 1

      if (originalLine === null && currentLine !== null) {
        // New line (added)
        decorations.push({
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: 'git-change-indicator git-change-added',
            glyphMarginHoverMessage: { value: 'Added line' },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
          }
        })
      } else if (originalLine !== null && currentLine === null) {
        // Deleted line (show on last line if file was shortened)
        if (lineNumber <= model.getLineCount()) {
          decorations.push({
            range: new monaco.Range(lineNumber, 1, lineNumber, 1),
            options: {
              isWholeLine: false,
              glyphMarginClassName: 'git-change-indicator git-change-deleted',
              glyphMarginHoverMessage: { value: 'Deleted line' },
              stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
            }
          })
        }
      } else if (originalLine !== null && currentLine !== null && originalLine !== currentLine) {
        // Modified line
        decorations.push({
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: 'git-change-indicator git-change-modified',
            glyphMarginHoverMessage: { value: 'Modified line' },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
          }
        })
      }
    }

    // Apply decorations
    changeDecorationsRef.current = editor.deltaDecorations(changeDecorationsRef.current, decorations)
  }, [value, originalContent, isDirty, isDiffMode])

  // Navigate to target line when specified (for Dashboard/Drift clicks)
  useEffect(() => {
    if (!monacoEditorRef.current || !targetLine) return

    const timer = setTimeout(() => {
      try {
        const editor = monacoEditorRef.current
        if (!editor) return

        // Get the actual editor (handle both diff and normal mode)
        let actualEditor: monaco.editor.IStandaloneCodeEditor
        
        if (isDiffMode && 'getModifiedEditor' in editor) {
          actualEditor = (editor as monaco.editor.IStandaloneDiffEditor).getModifiedEditor()
        } else {
          actualEditor = editor as monaco.editor.IStandaloneCodeEditor
        }

        // Navigate to the target line
        actualEditor.revealLineInCenter(targetLine)
        
        // Set cursor position to the target line
        actualEditor.setPosition({ lineNumber: targetLine, column: 1 })
        
        // Focus the editor
        actualEditor.focus()
        
        // Add animated highlight decoration to the target line
        const decorations = actualEditor.deltaDecorations([], [
          {
            range: new monaco.Range(targetLine, 1, targetLine, 1),
            options: {
              isWholeLine: true,
              className: 'line-highlight-flash'
            }
          }
        ])
        
        // Remove the decoration after animation completes
        setTimeout(() => {
          actualEditor.deltaDecorations(decorations, [])
        }, 1000) // Match the CSS animation duration
      } catch (error) {
        console.error('Failed to navigate to line:', error)
      }
    }, 100) // Small delay to ensure editor is fully initialized

    return () => clearTimeout(timer)
  }, [targetLine, isDiffMode])

  // Render remote cursors from other users
  useEffect(() => {
    if (!monacoEditorRef.current || isDiffMode) return
    
    const editor = monacoEditorRef.current as monaco.editor.IStandaloneCodeEditor
    
    // Clear old cursor widgets
    cursorWidgetsRef.current.forEach((widget, userId) => {
      editor.removeContentWidget(widget)
    })
    cursorWidgetsRef.current.clear()
    
    // Create decorations for cursor lines and cursor widgets for names
    const decorations: monaco.editor.IModelDeltaDecoration[] = []
    
    remoteCursors.forEach(cursor => {
      // Add cursor line decoration (thin vertical bar)
      decorations.push({
        range: new monaco.Range(cursor.line, cursor.column, cursor.line, cursor.column),
        options: {
          className: `remote-cursor-${cursor.userId.replace(/[^a-zA-Z0-9]/g, '')}`,
          beforeContentClassName: `remote-cursor-bar`,
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      })
      
      // Create a content widget for the user's name label
      const widgetId = `cursor-label-${cursor.userId}`
      const widget: monaco.editor.IContentWidget = {
        getId: () => widgetId,
        getDomNode: () => {
          const node = document.createElement('div')
          node.className = 'remote-cursor-label'
          node.style.cssText = `
            background-color: ${cursor.color};
            color: white;
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 500;
            white-space: nowrap;
            pointer-events: none;
            z-index: 100;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          `
          node.textContent = cursor.userName
          return node
        },
        getPosition: () => ({
          position: { lineNumber: cursor.line, column: cursor.column },
          preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE]
        })
      }
      
      editor.addContentWidget(widget)
      cursorWidgetsRef.current.set(cursor.userId, widget)
    })
    
    // Apply cursor decorations
    remoteCursorDecorationsRef.current = editor.deltaDecorations(
      remoteCursorDecorationsRef.current,
      decorations
    )
    
    return () => {
      // Cleanup widgets on unmount
      cursorWidgetsRef.current.forEach((widget) => {
        try {
          editor.removeContentWidget(widget)
        } catch (e) {
          // Editor may be disposed
        }
      })
    }
  }, [remoteCursors, isDiffMode])

  return (
    <>
      <style>{`
        /* Animated line highlight for navigation */
        @keyframes lineHighlightFlash {
          0% {
            background-color: rgba(255, 182, 193, 0.15);
          }
          30% {
            background-color: rgba(255, 182, 193, 0.13);
          }
          60% {
            background-color: rgba(255, 182, 193, 0.09);
          }
          80% {
            background-color: rgba(255, 182, 193, 0.05);
          }
          100% {
            background-color: rgba(255, 182, 193, 0);
          }
        }
        
        .monaco-editor .line-highlight-flash {
          animation: lineHighlightFlash 1s ease-out;
          background-color: rgba(255, 182, 193, 0.15) !important;
        }
        
        .monaco-bracket-match {
          color: #E0AF68 !important;
          background-color: rgba(224, 175, 104, 0.15) !important;
          border-bottom: 2px solid #E0AF68 !important;
          font-weight: bold;
        }
        
        /* Semantic parsing based syntax highlighting - maximum specificity to override everything */
        .monaco-editor .view-lines .view-line span.hcl-string {
          color: #9ECE6A !important;
        }
        
        .monaco-editor .view-lines .view-line span.hcl-keyword {
          color: #BB9AF7 !important;
          font-style: italic;
        }
        
        .monaco-editor .view-lines .view-line span.hcl-identifier {
          color: #A9B1D6 !important;
        }
        
        .monaco-editor .view-lines .view-line span.hcl-number {
          color: #E0AF68 !important;
        }
        
        .monaco-editor .view-lines .view-line span.hcl-comment {
          color: #565F89 !important;
          font-style: italic;
        }
        
        .monaco-editor .view-lines .view-line span.hcl-attribute {
          color: #9ECE6A !important;
        }
        
        .monaco-editor .view-lines .view-line span.hcl-function {
          color: #7AA2F7 !important;
        }
        
        .monaco-editor .view-lines .view-line span.hcl-interpolation {
          color: #F7768E !important;
        }
        
        .monaco-editor .view-lines .view-line span.hcl-operator {
          color: #BB9AF7 !important;
        }
        
        .monaco-editor .view-lines .view-line span.hcl-constant {
          color: #F7768E !important; /* Light red for booleans */
        }
        
        /* Override default Monaco colors for HCL - ensure nothing is blue by default */
        .monaco-editor[data-language-id="hcl"] .view-lines .view-line span {
          color: #A9B1D6 !important; /* Default gray color instead of blue */
        }
        
        /* Green background for added/appended lines */
        .monaco-editor .line-insert {
          background-color: rgba(46, 160, 67, 0.20) !important;
        }
        
        /* Green gutter marker for added lines */
        .monaco-editor .line-insert-gutter {
          background-color: rgba(46, 160, 67, 0.6) !important;
          width: 3px !important;
        }
        
        /* Blue background for modified lines */
        .monaco-editor .line-modified {
          background-color: rgba(12, 125, 157, 0.20) !important;
        }
        
        /* Blue gutter marker for modified lines */
        .monaco-editor .line-modified-gutter {
          background-color: rgba(12, 125, 157, 0.6) !important;
          width: 3px !important;
        }
        
        /* VS Code-style git change indicators in gutter */
        /* Target the glyph margin decoration elements directly */
        .monaco-editor .git-change-indicator {
          display: inline-block !important;
          width: 3px !important;
          min-width: 3px !important;
          height: 19px !important; /* Match line height */
          margin: 0 !important;
          padding: 0 !important;
          vertical-align: top !important;
        }
        
        .monaco-editor .git-change-added {
          background-color: #4ade80 !important; /* Green for additions */
        }
        
        .monaco-editor .git-change-modified {
          background-color: #fbbf24 !important; /* Yellow for modifications */
        }
        
        .monaco-editor .git-change-deleted {
          background-color: #f87171 !important; /* Red for deletions */
        }
        
        /* Ensure glyph margin is visible */
        .monaco-editor .glyph-margin {
          width: 30px !important;
        }
        
        /* Scrollbar styling - darker and only visible on hover */
        .monaco-editor .scrollbar .slider {
          background: rgba(40, 40, 40, 0) !important;
          transition: background 0.2s ease;
        }
        
        .monaco-editor:hover .scrollbar .slider {
          background: rgba(50, 50, 50, 0.6) !important;
        }
        
        .monaco-editor .scrollbar .slider:hover {
          background: rgba(60, 60, 60, 0.8) !important;
        }
        
        .monaco-editor .scrollbar .slider.active {
          background: rgba(70, 70, 70, 0.9) !important;
        }
        
        /* Legacy diff editor styles (kept for compatibility) */
        .monaco-diff-editor .line-insert,
        .monaco-diff-editor .char-insert {
          background-color: rgba(46, 160, 67, 0.25) !important;
        }
        
        .monaco-diff-editor .line-delete,
        .monaco-diff-editor .char-delete {
          background-color: rgba(248, 81, 73, 0.25) !important;
        }
        
        /* Remote cursor styles for real-time collaboration */
        .remote-cursor-bar::before {
          content: '';
          position: absolute;
          width: 2px;
          height: 18px;
          background-color: var(--cursor-color, #ff6b6b);
          animation: cursor-blink 1s ease-in-out infinite;
        }
        
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        .remote-cursor-label {
          position: absolute;
          transform: translateY(-100%);
          margin-top: -2px;
        }
      `}</style>
      <div className="flex flex-col w-full h-full" style={{ minHeight: 0 }}>
        <div 
          ref={editorRef} 
          className="flex-1 w-full"
          style={{ minHeight: '100px', minWidth: '100px', height: '100%' }}
        />
        
        {/* Action buttons for diff mode */}
        {isDiffMode && onAccept && onReject && (
          <div className="flex items-center justify-end gap-3 px-4 py-3 bg-black/40 backdrop-blur-xl border-t border-white/10 shadow-[0_-4px_20px_rgba(0,0,0,0.3)]">
            <button
              onClick={onReject}
              className="group flex items-center gap-2 px-4 py-2 bg-[#2a2a2a] hover:bg-[#3a3a3a] text-[#888] hover:text-white rounded-md transition-all duration-200 text-xs font-medium border border-[#3e3e42] hover:border-[#505050] shadow-sm hover:shadow-md relative overflow-hidden"
              title="Reject changes (Ctrl+N)"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
              <i className="codicon codicon-close relative z-10" style={{ fontSize: 14 }} />
              <span className="relative z-10">Undo</span>
            </button>
            <button
              onClick={onAccept}
              className="group flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white rounded-md transition-all duration-200 text-xs font-medium shadow-lg shadow-emerald-900/50 hover:shadow-emerald-800/60 hover:scale-105 relative overflow-hidden"
              title="Accept changes (Ctrl+Shift+=)"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
              <i className="codicon codicon-check relative z-10" style={{ fontSize: 14 }} />
              <span className="relative z-10">Keep</span>
            </button>
            {totalProposals > 1 && onAcceptAll && (
              <button
                onClick={onAcceptAll}
                className="group flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white rounded-md transition-all duration-200 text-xs font-medium shadow-lg shadow-blue-900/50 hover:shadow-blue-800/60 hover:scale-105 relative overflow-hidden"
                title="Accept all changes and continue"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                <i className="codicon codicon-check-all relative z-10" style={{ fontSize: 14 }} />
                <span className="relative z-10">Keep all ({totalProposals})</span>
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}

