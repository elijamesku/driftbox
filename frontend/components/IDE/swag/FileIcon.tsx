import React from 'react'

interface FileIconProps {
  fileName: string
  isFolder?: boolean
  isOpen?: boolean
  size?: number
}

// Iconify vscode-icons mappings
// Using Material Design icons from: https://icon-sets.iconify.design/vscode-icons/
const getIconName = (fileName: string): string => {
  const lowerName = fileName.toLowerCase()
  const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
  
  // Specific file name mappings
  if (lowerName === 'dockerfile') return 'vscode-icons:file-type-docker'
  if (lowerName === 'docker-compose.yml' || lowerName === 'docker-compose.yaml') return 'vscode-icons:file-type-docker2'
  if (lowerName === '.dockerignore') return 'vscode-icons:file-type-docker'
  if (lowerName === '.gitignore') return 'vscode-icons:file-type-git'
  if (lowerName === 'package.json') return 'vscode-icons:file-type-node'
  if (lowerName === 'package-lock.json') return 'vscode-icons:file-type-npm'
  if (lowerName === 'tsconfig.json') return 'vscode-icons:file-type-tsconfig'
  if (lowerName === 'next.config.js' || lowerName === 'next.config.ts') return 'vscode-icons:file-type-next'
  if (lowerName.startsWith('readme')) return 'vscode-icons:file-type-readme'
  if (lowerName === 'requirements.txt') return 'vscode-icons:file-type-python'
  if (lowerName.includes('.env')) return 'vscode-icons:file-type-tune'
  if (lowerName === 'license') return 'vscode-icons:file-type-license'
  
  // Extension mappings
  const extMap: Record<string, string> = {
    '.tf': 'vscode-icons:file-type-terraform',
    '.tfvars': 'vscode-icons:file-type-terraform',
    '.py': 'vscode-icons:file-type-python',
    '.js': 'vscode-icons:file-type-js-official',
    '.jsx': 'vscode-icons:file-type-reactjs',
    '.ts': 'vscode-icons:file-type-typescript-official',
    '.tsx': 'vscode-icons:file-type-reactts',
    '.json': 'vscode-icons:file-type-json',
    '.jsonc': 'vscode-icons:file-type-json',
    '.md': 'vscode-icons:file-type-markdown',
    '.mdx': 'vscode-icons:file-type-mdx',
    '.yaml': 'vscode-icons:file-type-yaml',
    '.yml': 'vscode-icons:file-type-yaml',
    '.css': 'vscode-icons:file-type-css',
    '.scss': 'vscode-icons:file-type-scss',
    '.sass': 'vscode-icons:file-type-sass',
    '.html': 'vscode-icons:file-type-html',
    '.xml': 'vscode-icons:file-type-xml',
    '.svg': 'vscode-icons:file-type-svg',
    '.png': 'vscode-icons:file-type-image',
    '.jpg': 'vscode-icons:file-type-image',
    '.jpeg': 'vscode-icons:file-type-image',
    '.gif': 'vscode-icons:file-type-image',
    '.webp': 'vscode-icons:file-type-image',
    '.ico': 'vscode-icons:file-type-favicon',
    '.sh': 'vscode-icons:file-type-shell',
    '.bash': 'vscode-icons:file-type-shell',
    '.zsh': 'vscode-icons:file-type-shell',
    '.fish': 'vscode-icons:file-type-shell',
    '.go': 'vscode-icons:file-type-go',
    '.rs': 'vscode-icons:file-type-rust',
    '.java': 'vscode-icons:file-type-java',
    '.c': 'vscode-icons:file-type-c',
    '.cpp': 'vscode-icons:file-type-cpp',
    '.h': 'vscode-icons:file-type-c',
    '.hpp': 'vscode-icons:file-type-cpp',
    '.sql': 'vscode-icons:file-type-sql',
    '.graphql': 'vscode-icons:file-type-graphql',
    '.gql': 'vscode-icons:file-type-graphql',
    '.lock': 'vscode-icons:file-type-lock',
    '.log': 'vscode-icons:file-type-log',
    '.txt': 'vscode-icons:file-type-text',
    '.pdf': 'vscode-icons:file-type-pdf',
    '.zip': 'vscode-icons:file-type-zip',
    '.tar': 'vscode-icons:file-type-zip',
    '.gz': 'vscode-icons:file-type-zip',
    '.rar': 'vscode-icons:file-type-zip',
    '.toml': 'vscode-icons:file-type-toml',
    '.ini': 'vscode-icons:file-type-settings',
    '.conf': 'vscode-icons:file-type-config',
    '.config': 'vscode-icons:file-type-config',
  }
  
  return extMap[ext] || 'vscode-icons:default-file'
}

export const FileIcon = React.memo(function FileIcon({ fileName, isFolder, isOpen, size = 16 }: FileIconProps) {
  // Don't show folder icons
  if (isFolder) {
    return (
      <span
        style={{
          width: size,
          height: size,
          display: 'inline-flex',
        }}
      />
    )
  }

  const iconName = getIconName(fileName)
  
  return (
    <span
      className="iconify"
      data-icon={iconName}
      data-inline="false"
      style={{
        fontSize: size,
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        pointerEvents: 'none', // Prevent interaction during transitions
      }}
    />
  )
})
