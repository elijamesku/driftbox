'use client'

import { useState, useEffect } from 'react'
import { useAuth, useGitHub } from '@/contexts'
import { FileIcon } from '../swag/FileIcon'
import { fetchGitHubContents } from '@/utils/apiClient'
import { isDesktop, cloneRepository } from '@/utils/desktopBridge'
import { Lock } from 'lucide-react'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import type { FileLock } from '@/hooks/useTeamCollaboration'

interface SidebarProps {
  activeTab: string
  setActiveTab: (tab: string) => void
  selectedRepo?: {
    id: number
    name: string
    full_name: string
  } | null
  onFileClick?: (file: FileNode) => void
  onFileDeleted?: (filePath: string) => void
  onRefreshFileTreeRef?: React.MutableRefObject<(() => void) | null>
  activeFilePath?: string | null
  gitStatus?: {
    stagedFiles?: string[]
    stagedAddedFiles?: string[]
    stagedModifiedFiles?: string[]
    modifiedFiles?: string[]
    untrackedFiles?: string[]
    deletedFiles?: string[]
  } | null
  isTeamWorkspace?: boolean
  // File locking props
  fileLocks?: Record<string, FileLock>
  currentUserId?: string
  onAcquireLock?: (filePath: string) => void
  onReleaseLock?: (filePath: string) => void
}

interface FileNode {
  name: string
  type: 'file' | 'folder'
  path: string
  children?: FileNode[]
  owner?: string
  repo?: string
  sha?: string
  url?: string
  isLoaded?: boolean
}

export default function Sidebar({ activeTab, setActiveTab, selectedRepo, onFileClick, onFileDeleted, onRefreshFileTreeRef, activeFilePath, gitStatus, isTeamWorkspace = false, fileLocks = {}, currentUserId, onAcquireLock, onReleaseLock }: SidebarProps) {
  const { token } = useAuth()
  const { githubToken } = useGitHub()
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['root', 'infrastructure']))
  const [isRepoExpanded, setIsRepoExpanded] = useState(true) // Track if entire repo tree is visible
  const [width, setWidth] = useState(310) // Default 310px (wider to match VS Code)
  const [isResizing, setIsResizing] = useState(false)
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [fileTreeError, setFileTreeError] = useState<string | null>(null)
  const [draggedNode, setDraggedNode] = useState<FileNode | null>(null)
  const [dragOverNode, setDragOverNode] = useState<string | null>(null)
  const [dragOverPosition, setDragOverPosition] = useState<'inside' | 'above' | 'below' | null>(null)
  const [isMoving, setIsMoving] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    node: FileNode | null
  }>({ visible: false, x: 0, y: 0, node: null })
  const [contextMenuStyle, setContextMenuStyle] = useState<{
    left: number
    top: number
    maxHeight?: string
  }>({ left: 0, top: 0 })
  const [isDeleting, setIsDeleting] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ node: FileNode | null }>({ node: null })
  const [createError, setCreateError] = useState<string | null>(null)
  const [creatingItem, setCreatingItem] = useState<{
    type: 'file' | 'folder'
    parentPath: string
    parentNode: FileNode
  } | null>(null)
  const [newItemName, setNewItemName] = useState('')

  // Handle resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      // Calculate width directly from mouse position
      const newWidth = e.clientX
      // Min 180px, max 1000px (buttons will adapt to narrow widths)
      setWidth(Math.min(Math.max(180, newWidth), 1000))
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  // Fetch repository files when a repo is selected
  useEffect(() => {
    if (selectedRepo) {
      fetchRepoFiles(selectedRepo)
    } else {
      // Default empty state
      setFileTree([])
    }
  }, [selectedRepo])

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu({ visible: false, x: 0, y: 0, node: null })
    }
    
    if (contextMenu.visible) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [contextMenu.visible])

  // Cancel creation when clicking outside the input
  useEffect(() => {
    if (!creatingItem) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.create-input-container')) {
        setCreatingItem(null)
        setNewItemName('')
      }
    }

    // Small delay to avoid canceling immediately when opening the input
    const timeout = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timeout)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [creatingItem])

  // Expose refresh function through ref
  useEffect(() => {
    if (onRefreshFileTreeRef) {
      onRefreshFileTreeRef.current = () => {
        if (selectedRepo) {
          fetchRepoFiles(selectedRepo)
        }
      }
    }
  }, [selectedRepo, onRefreshFileTreeRef])

  const fetchRepoFiles = async (repo: any) => {
    setIsLoadingFiles(true)
    setFileTreeError(null)
    try {
      console.log('🔍 fetchRepoFiles called for:', repo.full_name)
      console.log('🔍 isDesktop:', isDesktop)
      console.log('🔍 token available:', !!token)
      console.log('🔍 githubToken available:', !!githubToken)
      
      if (!token) {
        const errorMsg = 'No auth token available'
        console.error('❌', errorMsg)
        setFileTreeError(errorMsg)
        setFileTree([])
        setIsLoadingFiles(false)
        return
      }

      const [owner, repoName] = repo.full_name.split('/')

      // DESKTOP: Use Electron IPC
      if (isDesktop) {
        const electronAPI = (window as any).electronAPI
        if (!electronAPI) {
          throw new Error('Electron API not available')
        }

        // First, check if repo already exists locally
        console.log('🔍 Desktop: Checking if repo exists locally:', `${owner}/${repoName}`)
        const fileTreeResult = await electronAPI.getFileTree(owner, repoName, '')
        console.log('🔍 Desktop: getFileTree result:', fileTreeResult)
        
        if (fileTreeResult.success) {
          // Repo exists locally, just load the file tree (even if empty)
          console.log('✅ Desktop: Repo already exists locally, loading file tree')
          const tree: FileNode[] = (fileTreeResult.items || []).map((item: any) => ({
            name: item.name,
            type: item.type as 'folder' | 'file',
            path: item.path,
            owner,
            repo: repoName,
            children: item.type === 'folder' ? [] : undefined,
            isLoaded: item.type === 'file'
          }))
          setFileTree(tree)
          setIsLoadingFiles(false)
          return
        }

        // Repo doesn't exist, need to clone it
        console.log('📦 Desktop: Repo not found locally, need to clone')
        console.log('🔑 GitHub token available:', !!githubToken)
        
        if (!githubToken) {
          console.error('❌ GitHub token not available')
          throw new Error('GitHub token not available. Please authenticate with GitHub.')
        }

        console.log('🖥️  Desktop: Cloning repo via Electron:', `${owner}/${repoName}`)
        const cloneResult = await cloneRepository(owner, repoName, githubToken)
        console.log('📦 Desktop: Clone result:', cloneResult)
        
        if (!cloneResult.success) {
          console.error('❌ Desktop: Clone failed:', cloneResult.error)
          throw new Error(cloneResult.error || 'Failed to clone repository')
        }
        
        console.log('✅ Desktop: Repo cloned successfully to:', cloneResult.path)
        
        // Now get file tree via Electron IPC
        console.log('🔍 Desktop: Loading file tree after clone...')
        const newFileTreeResult = await electronAPI.getFileTree(owner, repoName, '')
        console.log('🔍 Desktop: getFileTree after clone:', newFileTreeResult)
        
        if (newFileTreeResult.success) {
          const tree: FileNode[] = (newFileTreeResult.items || []).map((item: any) => ({
            name: item.name,
            type: item.type as 'folder' | 'file',
            path: item.path,
            owner,
            repo: repoName,
            children: item.type === 'folder' ? [] : undefined,
            isLoaded: item.type === 'file'
          }))
          setFileTree(tree)
          setIsLoadingFiles(false)
          return
        } else {
          console.warn('⚠️ Desktop: Failed to load file tree after clone:', newFileTreeResult.error)
          // Still set empty tree so UI doesn't hang
          setFileTree([])
          setIsLoadingFiles(false)
          return
        }
      }
      
      // WEB: Use API proxy for cloning
      console.log('🌐 Web: Cloning repo via API:', `${owner}/${repoName}`)
      const cloneUrl = getApiEndpoint('/github/clone')
      
      // Step 1: Try to clone the repo locally (or pull if already exists)
      const cloneResponse = await fetch(cloneUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ owner, repo: repoName })
      })

      if (!cloneResponse.ok) {
        const error = await cloneResponse.json()
        throw new Error(error.error || 'Failed to clone repository')
      }

      const cloneData = await cloneResponse.json()
      
      // Check if we should use GitHub API instead (serverless environment)
      if (cloneData.useGitHubAPI) {
        // Fall back to GitHub API for serverless environments
        console.log('Using GitHub API fallback (serverless environment)')
        
        // Fetch from GitHub API (automatically handles desktop vs web mode)
        const contents = await fetchGitHubContents(owner, repoName, '', token)
        const tree: FileNode[] = contents.map((item: any) => ({
          name: item.name,
          type: (item.type === 'dir' ? 'folder' : 'file') as 'folder' | 'file',
          path: item.path,
          owner,
          repo: repoName,
          sha: item.sha,
          url: item.url,
          children: item.type === 'dir' ? [] : undefined,
          isLoaded: item.type === 'file'
        }))
        
        
        setFileTree(tree)
      } else {
        // Always use proxy
        const treeUrl = getApiEndpoint('/files/tree')
        
        const treeResponse = await fetch(treeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ owner, repo: repoName, path: '' })
        })

        if (!treeResponse.ok) {
          const error = await treeResponse.json()
          throw new Error(error.error || 'Failed to read repository files')
        }

        const { files } = await treeResponse.json()
        const tree = files.map((item: any) => ({
          name: item.name,
          type: item.type,
          path: item.path,
          owner,
          repo: repoName,
          children: item.children,
          isLoaded: item.isLoaded
        }))
        
        setFileTree(tree)
      }
    } catch (error: any) {
      const errorMsg = error.message || 'Failed to fetch repository files'
      console.error('❌ Failed to fetch repo files:', error)
      setFileTreeError(errorMsg)
      setFileTree([])
    } finally {
      setIsLoadingFiles(false)
    }
  }

  // Refresh file tree without cloning (for after file operations)
  const refreshFileTree = async (repo: any) => {
    try {
      if (!token) {
        console.error('No auth token available')
        return
      }

      const [owner, repoName] = repo.full_name.split('/') 
      // Always use proxy
      const treeUrl = '/api/proxy/files/tree'
      
      const treeResponse = await fetch(treeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ owner, repo: repoName, path: '' })
      })

      if (!treeResponse.ok) {
        const error = await treeResponse.json()
        console.error('Failed to refresh file tree:', error)
        throw new Error(error.error || 'Failed to refresh file tree')
      }

      const { files } = await treeResponse.json()
      const tree = files.map((item: any) => ({
        name: item.name,
        type: item.type,
        path: item.path,
        owner,
        repo: repoName,
        children: item.children,
        isLoaded: item.isLoaded
      }))
      
      setFileTree(tree)
      console.log('File tree refreshed:', tree.length, 'items')
    } catch (error: any) {
      console.error('Failed to refresh file tree:', error)
      // Fallback to full refresh
      await fetchRepoFiles(repo)
    }
  }

  // Lazy load folder contents from local filesystem or GitHub API (like VS Code)
  const loadFolderContents = async (node: FileNode) => {
    if (node.isLoaded || node.type !== 'folder' || !node.owner || !node.repo) {
      return node.children || []
    }

    try {
      // If node has a URL (from GitHub API), use GitHub API via proxy
      if (node.url && node.owner && node.repo) {
        if (!token) return []

        // Fetch folder contents (automatically handles desktop vs web mode)
        try {
          const contents = await fetchGitHubContents(node.owner, node.repo, node.path, token)
          // Handle both array (directory) and single file responses
          const items = Array.isArray(contents) ? contents : [contents]
          const children: FileNode[] = items.map((item: any) => ({
            name: item.name,
            type: (item.type === 'dir' ? 'folder' : 'file') as 'folder' | 'file',
            path: item.path,
            owner: node.owner,
            repo: node.repo,
            sha: item.sha,
            url: item.url,
            children: item.type === 'dir' ? [] : undefined,
            isLoaded: item.type === 'file'
          }))
          
          const updatedNode: FileNode = {
            ...node,
            type: node.type as 'folder' | 'file',
            children,
            isLoaded: true
          }
          updateNodeInTree(node.path, updatedNode)
          return children
        } catch (error) {
          console.error(`Failed to load folder ${node.path}:`, error)
          return []
        }
      } else {
        // Use local filesystem
        // DESKTOP: Use Electron IPC
        if (isDesktop && (window as any).electronAPI) {
          try {
            const electronAPI = (window as any).electronAPI
            const fileTreeResult = await electronAPI.getFileTree(node.owner, node.repo, node.path)
            if (fileTreeResult.success) {
              const children: FileNode[] = fileTreeResult.items.map((item: any) => ({
                name: item.name,
                type: item.type as 'folder' | 'file',
                path: item.path,
                owner: node.owner,
                repo: node.repo,
                children: item.type === 'folder' ? [] : undefined,
                isLoaded: item.type === 'file'
              }))
              
              updateNodeInTree(node.path, { ...node, children, isLoaded: true })
              return children
            }
          } catch (error) {
            console.error(`Failed to load folder ${node.path} via Electron:`, error)
            // Fall through to API fallback
          }
        }
        
        // WEB: Use proxy API
        const treeUrl = '/api/proxy/files/tree'
        
        const response = await fetch(treeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token || ''}`
          },
          body: JSON.stringify({ 
            owner: node.owner, 
            repo: node.repo, 
            path: node.path 
          })
        })

        if (response.ok) {
          const { files } = await response.json()
          const children = files.map((item: any) => ({
            name: item.name,
            type: item.type,
            path: item.path,
            owner: node.owner,
            repo: node.repo,
            children: item.children,
            isLoaded: item.isLoaded
          }))
          
          updateNodeInTree(node.path, { ...node, children, isLoaded: true })
          return children
        }
      }
    } catch (error) {
      console.error(`Failed to load folder ${node.path}:`, error)
    }

    return []
  }

  // Update a specific node in the file tree
  const updateNodeInTree = (path: string, updatedNode: FileNode) => {
    const updateNode = (nodes: FileNode[]): FileNode[] => {
      return nodes.map(node => {
        if (node.path === path) {
          return updatedNode
        }
        if (node.children) {
          return { ...node, children: updateNode(node.children) }
        }
        return node
      })
    }
    setFileTree(updateNode(fileTree))
  }

  // Find a node by path in the file tree
  const findNodeByPath = (nodes: FileNode[], targetPath: string): FileNode | null => {
    for (const node of nodes) {
      if (node.path === targetPath) {
        return node
      }
      if (node.children) {
        const found = findNodeByPath(node.children, targetPath)
        if (found) return found
      }
    }
    return null
  }

  const toggleFolder = async (path: string, node?: FileNode) => {
    const newExpanded = new Set(expandedFolders)
    if (newExpanded.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
      // Lazy load folder contents if not already loaded
      if (node && !node.isLoaded) {
        await loadFolderContents(node)
      }
    }
    setExpandedFolders(newExpanded)
  }


  // Move file - Electron IPC in desktop, proxy in web
  const moveFile = async (owner: string, repo: string, sourcePath: string, targetPath: string): Promise<{ success: boolean; error?: string }> => {
    const isDesktop = typeof window !== 'undefined' && 
      ((window as any).electronAPI !== undefined || window.location.protocol === 'file:')
    
    // Use Electron IPC if available
    if (isDesktop && (window as any).electronAPI?.moveFile) {
      try {
        const result = await (window as any).electronAPI.moveFile(owner, repo, sourcePath, targetPath)
        return result
      } catch (error: any) {
        console.error('Electron moveFile failed, falling back to API:', error)
        // Fall through to API fallback
      }
    }
    
    // Fallback to API (direct backend in Electron, proxy in web)
    const moveUrl = isDesktop
      ? getApiEndpoint('/local/files/move')
      : getApiEndpoint('/files/move')
    
    try {
      const response = await fetch(moveUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          owner,
          repo,
          source_path: sourcePath,
          target_path: targetPath
        })
      })

      const data = await response.json()

      if (!response.ok) {
        console.error('Move file API error:', data)
        return {
          success: false,
          error: data.detail || data.error || 'Failed to move file'
        }
      }

      console.log('Move file success:', { sourcePath, targetPath, data })
      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to move file'
      }
    }
  }

  // Delete file - Electron IPC in desktop, proxy in web
  const deleteFile = async (owner: string, repo: string, path: string): Promise<{ success: boolean; error?: string }> => {
    const isDesktop = typeof window !== 'undefined' && 
      ((window as any).electronAPI !== undefined || window.location.protocol === 'file:')
    
    // Use Electron IPC if available
    if (isDesktop && (window as any).electronAPI?.deleteFile) {
      try {
        const result = await (window as any).electronAPI.deleteFile(owner, repo, path)
        return result
      } catch (error: any) {
        console.error('Electron deleteFile failed, falling back to API:', error)
        // Fall through to API fallback
      }
    }
    
    // Fallback to API (direct backend in Electron, proxy in web)
    const deleteUrl = isDesktop
      ? getApiEndpoint('/local/files/delete')
      : getApiEndpoint('/files/delete')
    
    try {
      const response = await fetch(deleteUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          owner,
          repo,
          path
        })
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: data.detail || data.error || 'Failed to delete file'
        }
      }

      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to delete file'
      }
    }
  }

  // Create file - Electron IPC in desktop, proxy in web
  const createFile = async (owner: string, repo: string, path: string, content: string = '', isFolder: boolean = false): Promise<{ success: boolean; error?: string }> => {
    const isDesktop = typeof window !== 'undefined' && 
      ((window as any).electronAPI !== undefined || window.location.protocol === 'file:')
    
    // Use Electron IPC if available
    if (isDesktop && (window as any).electronAPI?.createFile) {
      try {
        const result = await (window as any).electronAPI.createFile(owner, repo, path, content, isFolder)
        return result
      } catch (error: any) {
        console.error('Electron createFile failed, falling back to API:', error)
        // Fall through to API fallback
      }
    }
    
    // Fallback to API (direct backend in Electron, proxy in web)
    const createUrl = isDesktop
      ? getApiEndpoint('/local/files/create')
      : getApiEndpoint('/files/create')
    
    try {
      const response = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          owner,
          repo,
          path,
          content,
          is_folder: isFolder
        })
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: data.detail || data.error || 'Failed to create file'
        }
      }

      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create file'
      }
    }
  }

  // Helper function to check if a path is a descendant of another path
  const isDescendant = (ancestorPath: string, descendantPath: string): boolean => {
    if (ancestorPath === descendantPath) return false
    return descendantPath.startsWith(ancestorPath + '/')
  }

  // Helper function to update paths recursively when moving a folder
  const updatePaths = (node: FileNode, newParentPath: string): FileNode => {
    const newPath = newParentPath ? `${newParentPath}/${node.name}` : node.name
    const updatedNode: FileNode = {
      ...node,
      path: newPath
    }
    if (node.children) {
      updatedNode.children = node.children.map(child => updatePaths(child, newPath))
    }
    return updatedNode
  }

  // Find and remove a node from the tree
  const removeNodeFromTree = (nodes: FileNode[], path: string): { updatedNodes: FileNode[], removedNode: FileNode | null } => {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].path === path) {
        const removed = nodes[i]
        const updated = [...nodes]
        updated.splice(i, 1)
        return { updatedNodes: updated, removedNode: removed }
      }
      if (nodes[i].children) {
        const result = removeNodeFromTree(nodes[i].children!, path)
        if (result.removedNode) {
          return {
            updatedNodes: nodes.map((node, idx) => 
              idx === i ? { ...node, children: result.updatedNodes } : node
            ),
            removedNode: result.removedNode
          }
        }
      }
    }
    return { updatedNodes: nodes, removedNode: null }
  }

  // Add a node to the tree at a specific location
  const addNodeToTree = (nodes: FileNode[], targetPath: string, newNode: FileNode, position: 'inside' | 'above' | 'below'): FileNode[] => {
    if (position === 'inside') {
      // Add as child of target (target must be a folder)
      return nodes.map(node => {
        if (node.path === targetPath && node.type === 'folder') {
          const children = node.children || []
          return {
            ...node,
            children: [...children, newNode]
          }
        }
        if (node.children) {
          return { ...node, children: addNodeToTree(node.children, targetPath, newNode, position) }
        }
        return node
      })
    } else {
      // Add as sibling (above or below)
      // First, try to find at current level
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].path === targetPath) {
          const updated = [...nodes]
          const insertIndex = position === 'above' ? i : i + 1
          updated.splice(insertIndex, 0, newNode)
          return updated
        }
      }
      // If not found, search in children
      return nodes.map(node => {
        if (node.children) {
          const updatedChildren = addNodeToTree(node.children, targetPath, newNode, position)
          if (updatedChildren !== node.children) {
            return { ...node, children: updatedChildren }
          }
        }
        return node
      })
    }
  }

  // Handle drag start
  const handleDragStart = (e: React.DragEvent, node: FileNode) => {
    console.log('Drag start:', node.path)
    setDraggedNode(node)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', node.path)
    e.dataTransfer.setData('application/json', JSON.stringify({ path: node.path, name: node.name }))
    // Make the drag image semi-transparent
    if (e.dataTransfer.setDragImage) {
      try {
        const dragImage = e.currentTarget.cloneNode(true) as HTMLElement
        dragImage.style.opacity = '0.5'
        dragImage.style.position = 'absolute'
        dragImage.style.top = '-1000px'
        document.body.appendChild(dragImage)
        e.dataTransfer.setDragImage(dragImage, 0, 0)
        setTimeout(() => {
          if (document.body.contains(dragImage)) {
            document.body.removeChild(dragImage)
          }
        }, 0)
      } catch (err) {
        console.warn('Failed to set drag image:', err)
      }
    }
  }

  // Handle drag over
  const handleDragOver = (e: React.DragEvent, node: FileNode) => {
    // Always prevent default to allow drop
    e.preventDefault()
    e.stopPropagation()
    
    // Get dragged path from state or dataTransfer (state might not be updated yet)
    const draggedPath = draggedNode?.path || e.dataTransfer.getData('text/plain')
    if (!draggedPath) return

    // Don't allow dropping on self or descendants
    if (draggedPath === node.path || isDescendant(draggedPath, node.path)) {
      e.dataTransfer.dropEffect = 'none'
      return
    }

    e.dataTransfer.dropEffect = 'move'

    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const height = rect.height
    const threshold = height / 3

    let position: 'inside' | 'above' | 'below' = 'below'
    if (node.type === 'folder' && y > threshold && y < height - threshold) {
      position = 'inside'
    } else if (y < threshold) {
      position = 'above'
    }

    setDragOverNode(node.path)
    setDragOverPosition(position)
  }

  // Handle drag leave
  const handleDragLeave = () => {
    setDragOverNode(null)
    setDragOverPosition(null)
  }

  // Handle drop
  const handleDrop = async (e: React.DragEvent, targetNode: FileNode) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Get dragged node from state or reconstruct from dataTransfer
    const draggedPath = draggedNode?.path || e.dataTransfer.getData('text/plain')
    if (!draggedPath || !dragOverPosition || !selectedRepo) {
      setDraggedNode(null)
      setDragOverNode(null)
      setDragOverPosition(null)
      return
    }

    // Find the dragged node in the tree if state wasn't set
    let actualDraggedNode = draggedNode
    if (!actualDraggedNode) {
      const findNode = (nodes: FileNode[]): FileNode | null => {
        for (const n of nodes) {
          if (n.path === draggedPath) return n
          if (n.children) {
            const found = findNode(n.children)
            if (found) return found
          }
        }
        return null
      }
      actualDraggedNode = findNode(fileTree)
      if (!actualDraggedNode) {
        setDraggedNode(null)
        setDragOverNode(null)
        setDragOverPosition(null)
        return
      }
    }

    // Don't allow dropping on self or descendants
    if (actualDraggedNode.path === targetNode.path || isDescendant(actualDraggedNode.path, targetNode.path)) {
      setDraggedNode(null)
      setDragOverNode(null)
      setDragOverPosition(null)
      return
    }

    // Don't allow dropping files inside files
    if (dragOverPosition === 'inside' && targetNode.type === 'file') {
      setDraggedNode(null)
      setDragOverNode(null)
      setDragOverPosition(null)
      return
    }

    // Calculate target path
    let targetPath: string
    if (dragOverPosition === 'inside' && targetNode.type === 'folder') {
      // Moving into a folder
      targetPath = `${targetNode.path}/${actualDraggedNode.name}`
    } else {
      // Moving as sibling - calculate parent path and new name
      const parentPath = targetNode.path.split('/').slice(0, -1).join('/')
      targetPath = parentPath ? `${parentPath}/${actualDraggedNode.name}` : actualDraggedNode.name
    }

    // Don't move if target is the same as source
    if (actualDraggedNode.path === targetPath) {
      setDraggedNode(null)
      setDragOverNode(null)
      setDragOverPosition(null)
      return
    }

    setIsMoving(true)
    setMoveError(null)

    try {
      const [owner, repoName] = selectedRepo.full_name.split('/')
      
      console.log('Moving file:', { 
        from: actualDraggedNode.path, 
        to: targetPath, 
        owner, 
        repo: repoName 
      })
      
      // Use Electron IPC if available, otherwise fall back to API
      const result = await moveFile(owner, repoName, actualDraggedNode.path, targetPath)

      console.log('Move file result:', result)

      if (!result.success) {
        throw new Error(result.error || 'Failed to move file')
      }

      // Small delay to ensure filesystem changes are visible
      await new Promise(resolve => setTimeout(resolve, 200))

      // Success - refresh the file tree (skip clone, just refresh tree)
      console.log('Refreshing file tree after move...')
      await refreshFileTree(selectedRepo)
      
      // Expand target folder if moving inside
      if (dragOverPosition === 'inside' && targetNode.type === 'folder') {
        setExpandedFolders(prev => new Set([...prev, targetNode.path]))
      }

      console.log('File move completed successfully')

    } catch (error: any) {
      console.error('Failed to move file:', error)
      setMoveError(error.message || 'Failed to move file. Please try again.')
      // Revert UI changes by refreshing the tree
      await fetchRepoFiles(selectedRepo)
    } finally {
      setIsMoving(false)
      setDraggedNode(null)
      setDragOverNode(null)
      setDragOverPosition(null)
    }
  }

  // Handle drag end
  const handleDragEnd = () => {
    setDraggedNode(null)
    setDragOverNode(null)
    setDragOverPosition(null)
  }

  // Handle right-click for context menu
  const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
    e.preventDefault()
    e.stopPropagation()
    
    const x = e.clientX
    const y = e.clientY
    const menuWidth = 180 // min-w-[180px]
    const estimatedMenuHeight = 150 // Estimated height for 3-4 items
    const maxMenuHeight = window.innerHeight * 0.8 // Max 80% of viewport height for scrolling
    const verticalOffset = 2 // Small offset to position menu just above cursor (like VS Code)
    
    // Calculate if menu would overflow at right
    const spaceRight = window.innerWidth - x
    const spaceLeft = x
    const wouldOverflowRight = spaceRight < menuWidth
     
    // Position menu at cursor tip - menu will expand upward
    let finalX = x
    let finalY = y - 20  // Small offset so cursor points at first menu item
    
    // If would overflow right, position to the left of cursor
    if (wouldOverflowRight && spaceLeft > spaceRight) {
      finalX = x - menuWidth
    }
    
    // If menu would go off-screen at top, position below cursor instead
    if (finalY < 0) {
      finalY = y  // Position menu top at cursor if not enough space above
    }
    
    // Set both state updates together - style must be set immediately
    // IMPORTANT: Set style BEFORE setting contextMenu to ensure it's ready
    setContextMenuStyle({
      left: finalX,
      top: finalY,
      maxHeight: `${maxMenuHeight}px` // Allow scrolling if menu is too tall
    })
    setContextMenu({
      visible: true,
      x: finalX, // Use finalX instead of x
      y: finalY, // Use finalY instead of y
      node
    })
  }

  // Handle delete file/folder
  const handleDelete = async () => {
    if (!contextMenu.node || !selectedRepo) return

    const node = contextMenu.node
    // Show custom confirmation dialog instead of window.confirm()
    setDeleteConfirmation({ node })
    setContextMenu({ visible: false, x: 0, y: 0, node: null })
  }

  const confirmDelete = async () => {
    const node = deleteConfirmation.node
    if (!node || !selectedRepo) return

    setIsDeleting(true)
    setDeleteError(null)
    setDeleteConfirmation({ node: null })

    try {
      const [owner, repoName] = selectedRepo.full_name.split('/')
      const result = await deleteFile(owner, repoName, node.path)

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete file')
      }

      // Success - refresh the file tree
      await fetchRepoFiles(selectedRepo)
      
      // Notify editor to close tabs for deleted file/folder
      if (onFileDeleted) {
        onFileDeleted(node.path)
      }
    } catch (error: any) {
      console.error('Failed to delete file:', error)
      setDeleteError(error.message || 'Failed to delete file. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  const cancelDelete = () => {
    setDeleteConfirmation({ node: null })
  }

  // Handle create new file - show input field
  const handleCreateFile = () => {
    if (!contextMenu.node || !selectedRepo) return

    const parentNode = contextMenu.node
    // If node has empty path, it's root level
    const parentPath = parentNode.path === '' 
      ? '' 
      : (parentNode.type === 'folder' ? parentNode.path : parentNode.path.split('/').slice(0, -1).join('/'))
    
    // If creating inside a folder, make sure it's expanded
    if (parentNode.type === 'folder' && parentNode.path !== '') {
      setExpandedFolders(prev => new Set([...prev, parentNode.path]))
      // Load folder contents if not already loaded
      if (parentNode && !parentNode.isLoaded) {
        loadFolderContents(parentNode)
      }
    }
    
    setCreatingItem({ type: 'file', parentPath, parentNode })
    setNewItemName('')
    setContextMenu({ visible: false, x: 0, y: 0, node: null })
  }

  // Handle create new folder - show input field
  const handleCreateFolder = () => {
    if (!contextMenu.node || !selectedRepo) return

    const parentNode = contextMenu.node
    // If node has empty path, it's root level
    const parentPath = parentNode.path === '' 
      ? '' 
      : (parentNode.type === 'folder' ? parentNode.path : parentNode.path.split('/').slice(0, -1).join('/'))
    
    // If creating inside a folder, make sure it's expanded
    if (parentNode.type === 'folder' && parentNode.path !== '') {
      setExpandedFolders(prev => new Set([...prev, parentNode.path]))
      // Load folder contents if not already loaded
      if (parentNode && !parentNode.isLoaded) {
        loadFolderContents(parentNode)
      }
    }
    
    setCreatingItem({ type: 'folder', parentPath, parentNode })
    setNewItemName('')
    setContextMenu({ visible: false, x: 0, y: 0, node: null })
  }

  // Confirm creation of file/folder
  const confirmCreate = async () => {
    if (!creatingItem || !selectedRepo || !newItemName.trim()) {
      setCreatingItem(null)
      setNewItemName('')
      return
    }

    setIsCreating(true)
    setCreateError(null)

    try {
      const [owner, repoName] = selectedRepo.full_name.split('/')
      const itemPath = creatingItem.parentPath 
        ? `${creatingItem.parentPath}/${newItemName.trim()}` 
        : newItemName.trim()
      
      const result = await createFile(
        owner, 
        repoName, 
        itemPath, 
        '', 
        creatingItem.type === 'folder'
      )

      if (!result.success) {
        throw new Error(result.error || `Failed to create ${creatingItem.type}`)
      }

      // Success - refresh the file tree and expand parent folder
      await fetchRepoFiles(selectedRepo)
      if (creatingItem.parentNode.type === 'folder' && creatingItem.parentNode.path !== '') {
        setExpandedFolders(prev => new Set([...prev, creatingItem.parentNode.path]))
      }

      // If we created a file (not a folder), automatically open it in the editor
      if (creatingItem.type === 'file' && onFileClick) {
        // Construct the file node directly and open it
        const createdFile: FileNode = {
          name: newItemName.trim(),
          type: 'file',
          path: itemPath,
          owner,
          repo: repoName
        }
        // Small delay to ensure file tree is updated
        setTimeout(() => {
          onFileClick(createdFile)
        }, 150)
      }

      setCreatingItem(null)
      setNewItemName('')
    } catch (error: any) {
      console.error(`Failed to create ${creatingItem.type}:`, error)
      setCreateError(error.message || `Failed to create ${creatingItem.type}. Please try again.`)
    } finally {
      setIsCreating(false)
    }
  }

  // Cancel creation
  const cancelCreate = () => {
    setCreatingItem(null)
    setNewItemName('')
  }

  // Helper to get git status for a file (VS Code style indicators)
  const getFileGitStatus = (filePath: string): 'added' | 'modified' | 'deleted' | null => {
    if (!gitStatus || !selectedRepo) return null
    
    // Normalize file path to forward slashes (git uses forward slashes)
    const normalizedPath = filePath.replace(/\\/g, '/')
    
    // Helper to check if paths match
    const pathsMatch = (gitPath: string, filePath: string): boolean => {
      const normalizedGitPath = gitPath.replace(/\\/g, '/')
      return normalizedGitPath === filePath || 
             normalizedGitPath.endsWith(`/${filePath}`) || 
             filePath.endsWith(`/${normalizedGitPath}`)
    }
    
    // Check deleted files first
    if (gitStatus.deletedFiles?.some((p: string) => pathsMatch(p, normalizedPath))) {
      return 'deleted'
    }
    
    // Check untracked files (new files) - these show green "A"
    if (gitStatus.untrackedFiles?.some(p => pathsMatch(p, normalizedPath))) {
      return 'added'
    }
    
    // Check staged added files (new files that were staged) - these show green "A"
    if (gitStatus.stagedAddedFiles?.some(p => pathsMatch(p, normalizedPath))) {
      return 'added'
    }
    
    // Check staged modified files and unstaged modified files - these show yellow "M"
    const isStagedModified = gitStatus.stagedModifiedFiles?.some(p => pathsMatch(p, normalizedPath))
    const isModified = gitStatus.modifiedFiles?.some(p => pathsMatch(p, normalizedPath))
    
    if (isStagedModified || isModified) {
      return 'modified'
    }
    
    // Fallback: if file is in stagedFiles but not in stagedAddedFiles or stagedModifiedFiles,
    // assume it's modified (for backward compatibility)
    const isStaged = gitStatus.stagedFiles?.some(p => pathsMatch(p, normalizedPath))
    if (isStaged) {
      return 'modified'
    }
    
    return null
  }
  
  // Helper to check if a file is modified in git (for backward compatibility)
  const isFileModifiedInGit = (filePath: string): boolean => {
    const status = getFileGitStatus(filePath)
    return status === 'added' || status === 'modified' || status === 'deleted'
  }

  // Helper to normalize and compare file paths
  const normalizeFilePath = (filePath: string): string => {
    if (!selectedRepo) return filePath
    
    // Normalize to forward slashes
    let normalized = filePath.replace(/\\/g, '/')
    
    // Remove owner/repo prefix if present
    const [owner, repo] = selectedRepo.full_name.split('/')
    if (normalized.startsWith(`${owner}/${repo}/`)) {
      normalized = normalized.substring(`${owner}/${repo}/`.length)
    }
    
    return normalized
  }

  // Check if a file is the active file
  const isFileActive = (filePath: string): boolean => {
    if (!activeFilePath) return false
    
    const normalizedActive = normalizeFilePath(activeFilePath)
    const normalizedFile = normalizeFilePath(filePath)
    
    return normalizedActive === normalizedFile
  }

  const renderFileTree = (nodes: FileNode[], depth = 0) => {
    // Sort: folders first, then files, both alphabetically
    const sortedNodes = [...nodes].sort((a, b) => {
      // Folders come before files
      if (a.type === 'folder' && b.type === 'file') return -1
      if (a.type === 'file' && b.type === 'folder') return 1
      // Within same type, sort alphabetically
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    
    return sortedNodes.map((node) => {
      const isExpanded = expandedFolders.has(node.path)
      const isDragged = draggedNode?.path === node.path
      const isDragOver = dragOverNode === node.path
      const isDragOverInside = isDragOver && dragOverPosition === 'inside'
      const isDragOverAbove = isDragOver && dragOverPosition === 'above'
      const isDragOverBelow = isDragOver && dragOverPosition === 'below'

      if (node.type === 'folder') {
        return (
          <div key={node.path}>
            {/* Drop indicator above */}
            {isDragOverAbove && (
              <div className="h-0.5 mx-1" style={{ marginLeft: `${depth * 16 + 12}px`, backgroundColor: '#232323' }} />
            )}
            <div
              draggable={true}
              onDragStart={(e) => handleDragStart(e, node)}
              onDragOver={(e) => handleDragOver(e, node)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, node)}
              onDragEnd={handleDragEnd}
              onContextMenu={(e) => handleContextMenu(e, node)}
              className={`relative flex items-center h-[22px] px-1 hover:bg-[#2a2d2e] cursor-pointer text-[14px] text-[#868686] font-medium ${
                isDragged ? 'opacity-50' : ''
              } ${
                isDragOverInside ? 'border' : ''
              }`}
              style={isDragOverInside ? { backgroundColor: '#232323', borderColor: '#232323', paddingLeft: `${depth * 16 + 12}px` } : { paddingLeft: `${depth * 16 + 12}px` }}
              onClick={() => toggleFolder(node.path, node)}
            >
              {/* Indent guide lines */}
              {depth > 0 && Array.from({ length: depth }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 w-px bg-[#2a2a2a]"
                  style={{ left: `${i * 16 + 8}px` }}
                />
              ))}
              {isExpanded ? (
                <i className="codicon codicon-chevron-down text-[#858585] flex-shrink-0 mr-1" style={{ fontSize: 10 }} />
              ) : (
                <i className="codicon codicon-chevron-right text-[#858585] flex-shrink-0 mr-1" style={{ fontSize: 10 }} />
              )}
              <span className="truncate">{node.name}</span>
            </div>
            {/* Drop indicator below */}
            {isDragOverBelow && (
              <div className="h-0.5 mx-1" style={{ marginLeft: `${depth * 16 + 12}px`, backgroundColor: '#232323' }} />
            )}
            {isExpanded && node.children && (
              <div>
                {renderFileTree(node.children, depth + 1)}
                {/* Show input field if creating in this folder */}
                {creatingItem && creatingItem.parentNode.path === node.path && creatingItem.type === 'folder' && (
                  <div 
                    className="flex items-center h-[22px] px-1 text-[14px] text-[#868686] font-medium create-input-container"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 12}px` }}
                  >
                    <FileIcon fileName="" isFolder={true} size={15} />
                    <input
                      type="text"
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          confirmCreate()
                        } else if (e.key === 'Escape') {
                          cancelCreate()
                        }
                      }}
                      // Don't cancel on blur - let user press Escape to cancel or Enter to confirm
                      autoFocus
                      className="ml-1 flex-1 bg-[#1e1e1e] border text-[#EDEDED] px-1 py-0.5 text-[14px] rounded outline-none"
                      style={{ borderColor: '#232323' }}
                      placeholder="Folder name"
                    />
                  </div>
                )}
                {creatingItem && creatingItem.parentNode.path === node.path && creatingItem.type === 'file' && (
                  <div 
                    className="flex items-center h-[22px] px-1 text-[14px] text-[#868686] font-medium create-input-container"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 12}px` }}
                  >
                    <FileIcon fileName={newItemName || 'file'} isFolder={false} size={15} />
                    <input
                      type="text"
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          confirmCreate()
                        } else if (e.key === 'Escape') {
                          cancelCreate()
                        }
                      }}
                      // Don't cancel on blur - let user press Escape to cancel or Enter to confirm
                    autoFocus
                    className="ml-1 flex-1 bg-[#1e1e1e] border border-gray-500 text-[#EDEDED] px-1 py-0.5 text-[14px] rounded outline-none"
                    placeholder="File name"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )
      }

      const isActive = node.type === 'file' && isFileActive(node.path)

      return (
        <div key={node.path}>
          {/* Drop indicator above */}
          {isDragOverAbove && (
            <div className="h-0.5 mx-1" style={{ marginLeft: `${depth * 16 + 12}px`, backgroundColor: '#232323' }} />
          )}
          <div
            draggable={true}
            onDragStart={(e) => handleDragStart(e, node)}
            onDragOver={(e) => handleDragOver(e, node)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, node)}
            onDragEnd={handleDragEnd}
            onContextMenu={(e) => handleContextMenu(e, node)}
            className={`relative flex items-center h-[22px] px-1 hover:bg-[#2a2d2e] cursor-pointer text-[13px] font-medium ${
              isDragged ? 'opacity-50' : ''
            } ${
              isActive 
                ? 'bg-[#232323]' 
                : 'text-[#868686]'
            }`}
            style={{ paddingLeft: `${depth * 16 + 12}px` }}
            onClick={() => {
              if (selectedRepo) {
                const [owner, repoName] = selectedRepo.full_name.split('/')
                onFileClick?.({ ...node, owner, repo: repoName })
              }
            }}
          >
            {/* Indent guide lines */}
            {depth > 0 && Array.from({ length: depth }).map((_, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 w-px bg-[#2a2a2a]"
                style={{ left: `${i * 16 + 8}px` }}
              />
            ))}
            <FileIcon fileName={node.name} size={15} />
            {(() => {
              const gitStatus = getFileGitStatus(node.path)
              const fileKey = selectedRepo ? `${selectedRepo.full_name}:${node.path}` : ''
              const lock = fileKey ? fileLocks[fileKey] : null
              const isMyLock = lock?.user_id === currentUserId
              const isOtherLock = lock && !isMyLock
              
              return (
                <>
                  <span className={`ml-1 truncate ${
                    gitStatus === 'added' ? 'text-green-400' : 
                    gitStatus === 'modified' ? 'text-yellow-400' : 
                    gitStatus === 'deleted' ? 'text-red-400' : 
                    isActive ? 'text-white' : ''
                  }`}>
                    {node.name}
                  </span>
                  {gitStatus === 'added' && (
                    <span className="text-[10px] text-green-400 font-medium ml-1">A</span>
                  )}
                  {gitStatus === 'modified' && (
                    <span className="text-[10px] text-yellow-400 font-medium ml-1">M</span>
                  )}
                  {gitStatus === 'deleted' && (
                    <span className="text-[10px] text-red-400 font-medium ml-1">D</span>
                  )}
                  {/* Lock indicator */}
                  {lock && (
                    <span 
                      className={`ml-auto flex-shrink-0 ${isMyLock ? 'text-green-400' : 'text-red-400'}`}
                      title={isMyLock ? 'Locked by you (click to release)' : `Locked by ${lock.user_name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isMyLock && onReleaseLock) {
                          onReleaseLock(node.path)
                        }
                      }}
                    >
                      <Lock size={10} />
                    </span>
                  )}
                </>
              )
            })()}
          </div>
          {/* Drop indicator below */}
          {isDragOverBelow && (
            <div className="h-0.5 mx-1" style={{ marginLeft: `${depth * 16 + 12}px`, backgroundColor: '#232323' }} />
          )}
        </div>
      )
    })
  }

  return (
    <div className="flex h-full">
      {/* Sidebar Content - Resizable */}
      <div 
        className="bg-[#141414] flex flex-col border-r border-[#1a1a1a] relative group"
        style={{ 
          width: `${width}px`,
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          cursor: 'default'
        }}
      >
        {/* Resize handle - only shows resize cursor on the handle itself */}
        <div
          className="absolute top-0 right-0 w-1 h-full z-50"
          style={{ cursor: 'ew-resize' }}
          onMouseDown={() => setIsResizing(true)}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#4a4a4a'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          title="Drag to resize sidebar"
        />
        
        <div className="h-[35px] px-2 flex items-center gap-2">
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <span className="text-[11px] uppercase font-semibold text-[#6e7681] tracking-wider truncate">
              {selectedRepo ? selectedRepo.name : 'Explorer'}
            </span>
          </div>
          {selectedRepo && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              {/* New File */}
              <i
                onClick={() => {
                  setCreatingItem({ 
                    type: 'file', 
                    parentPath: '',
                    parentNode: { name: '', path: '', type: 'folder', owner: '', repo: '' }
                  })
                  setIsRepoExpanded(true)
                }}
                className="codicon codicon-new-file text-[#858585] hover:text-[#EDEDED] cursor-pointer transition-colors p-1"
                style={{ fontSize: 14 }}
                title="New File"
              />
              
              {/* New Folder */}
              <i
                onClick={() => {
                  setCreatingItem({ 
                    type: 'folder', 
                    parentPath: '',
                    parentNode: { name: '', path: '', type: 'folder', owner: '', repo: '' }
                  })
                  setIsRepoExpanded(true)
                }}
                className="codicon codicon-new-folder text-[#858585] hover:text-[#EDEDED] cursor-pointer transition-colors p-1"
                style={{ fontSize: 14 }}
                title="New Folder"
              />
              
              {/* Refresh */}
              <i
                onClick={() => {
                  if (selectedRepo) {
                    fetchRepoFiles(selectedRepo)
                  }
                }}
                className="codicon codicon-refresh text-[#858585] hover:text-[#EDEDED] cursor-pointer transition-colors p-1"
                style={{ fontSize: 14 }}
                title="Refresh"
              />
              
              {/* Collapse All */}
              <i
                onClick={() => {
                  setExpandedFolders(new Set())
                  setIsRepoExpanded(false)
                }}
                className="codicon codicon-collapse-all text-[#858585] hover:text-[#EDEDED] cursor-pointer transition-colors p-1"
                style={{ fontSize: 14 }}
                title="Collapse All"
              />
            </div>
          )}
        </div>
        <div 
          className="flex-1 overflow-y-auto bg-[#141414] pl-3"
          onContextMenu={(e) => {
            if (selectedRepo && fileTree.length > 0) {
              e.preventDefault()
              // Right-click on empty space - create at root
              const x = e.clientX
              const y = e.clientY
              const menuWidth = 180
              const estimatedMenuHeight = 150
              const spaceRight = window.innerWidth - x
              const spaceLeft = x
              const wouldOverflowRight = spaceRight < menuWidth
              
              // Position menu at cursor tip - menu will expand upward
              let finalX = x
              let finalY = y - 20  // Small offset so cursor points at first menu item
              
              if (wouldOverflowRight && spaceLeft > spaceRight) {
                finalX = x - menuWidth
              }
              // If menu would go off-screen at top, position below cursor instead
              if (finalY < 0) {
                finalY = y  // Position menu top at cursor if not enough space above
              }
              
              setContextMenuStyle({
                left: finalX,
                top: finalY,
                maxHeight: `${window.innerHeight * 0.8}px`
              })
              setContextMenu({
                visible: true,
                x: finalX,
                y: finalY,
                node: { name: '', path: '', type: 'folder' } as FileNode
              })
            }
          }}
        >
          {isLoadingFiles || isMoving || isDeleting || isCreating ? (
            <div className="flex items-center justify-center h-32 text-[13px] text-[#858585]">
              {isMoving ? 'Moving file...' : isDeleting ? 'Deleting...' : isCreating ? 'Creating...' : 'Loading files...'}
            </div>
          ) : fileTree.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-[13px] text-[#858585] px-4 text-center">
              {fileTreeError ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="text-red-400 font-medium">{fileTreeError}</div>
                  <button
                    onClick={() => selectedRepo && fetchRepoFiles(selectedRepo)}
                    className="text-[#EDEDED] hover:text-white underline text-xs"
                  >
                    Retry
                  </button>
                </div>
              ) : selectedRepo ? (
                'No files found'
              ) : (
                'Select a repository from the top bar'
              )}
            </div>
          ) : isRepoExpanded ? (
            <div className="py-2 pb-16">
              {fileTreeError && (
                <div className="mx-2 mb-2 p-2 bg-red-900/20 border border-red-500/50 rounded text-[12px] text-red-400">
                  {fileTreeError}
                  <button
                    onClick={() => {
                      setFileTreeError(null)
                      if (selectedRepo) fetchRepoFiles(selectedRepo)
                    }}
                    className="ml-2 text-red-300 hover:text-red-200"
                  >
                    Retry
                  </button>
                </div>
              )}
              {moveError && (
                <div className="mx-2 mb-2 p-2 bg-red-900/20 border border-red-500/50 rounded text-[12px] text-red-400">
                  {moveError}
                  <button
                    onClick={() => setMoveError(null)}
                    className="ml-2 text-red-300 hover:text-red-200"
                  >
                    ×
                  </button>
                </div>
              )}
              {deleteError && (
                <div className="mx-2 mb-2 p-2 bg-red-900/20 border border-red-500/50 rounded text-[12px] text-red-400">
                  {deleteError}
                  <button
                    onClick={() => setDeleteError(null)}
                    className="ml-2 text-red-300 hover:text-red-200"
                  >
                    ×
                  </button>
                </div>
              )}
              {createError && (
                <div className="mx-2 mb-2 p-2 bg-red-900/20 border border-red-500/50 rounded text-[12px] text-red-400">
                  {createError}
                  <button
                    onClick={() => setCreateError(null)}
                    className="ml-2 text-red-300 hover:text-red-200"
                  >
                    ×
                  </button>
                </div>
              )}
              {renderFileTree(fileTree)}
              {/* Show input field if creating at root level */}
              {creatingItem && creatingItem.parentPath === '' && (
                <div 
                  className="flex items-center h-[22px] px-2 text-[14px] create-input-container"
                  style={{ paddingLeft: '8px' }}
                >
                  <FileIcon fileName={creatingItem.type === 'folder' ? '' : (newItemName || 'file')} isFolder={creatingItem.type === 'folder'} size={16} />
                  <input
                    type="text"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        confirmCreate()
                      } else if (e.key === 'Escape') {
                        cancelCreate()
                      }
                    }}
                    onBlur={cancelCreate}
                    autoFocus
                    className="ml-[6px] flex-1 bg-[#1e1e1e] border border-gray-500 text-[#EDEDED] px-1 py-0.5 text-[14px] rounded outline-none"
                    placeholder={creatingItem.type === 'folder' ? 'Folder name' : 'File name'}
                  />
                </div>
              )}
            </div>
          ) : null}
        </div>
        
        {/* Context Menu */}
        {contextMenu.visible && contextMenu.node && (
          <div
            className="fixed bg-[#252526] border border-[#3e3e42] rounded shadow-lg z-[9999] min-w-[180px] overflow-y-auto"
            style={{
              left: `${contextMenuStyle.left}px`,
              top: `${contextMenuStyle.top}px`,
              maxHeight: contextMenuStyle.maxHeight || '80vh',
              scrollbarWidth: 'thin',
              scrollbarColor: '#3e3e42 #252526'
            }}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              e.stopPropagation()
              // Allow natural scrolling
            }}
          >
            <button
              onClick={handleCreateFile}
              className="w-full px-3   text-left text-[13px] text-[#cccccc] hover:bg-[#2a2d2e] flex items-center gap-2"
            >
              <i className="codicon codicon-new-file text-[#858585]" style={{ fontSize: 14 }} />
              New File
            </button>
            <button
              onClick={handleCreateFolder}
              className="w-full px-3 text-left text-[13px] text-[#cccccc] hover:bg-[#2a2d2e] flex items-center gap-2"
            >
              <i className="codicon codicon-new-folder text-[#858585]" style={{ fontSize: 14 }} />
              New Folder
            </button>
            {contextMenu.node && contextMenu.node.path !== '' && (
              <>
                <div className="h-px bg-[#3e3e42] my-1" />
                 <button
                   onClick={handleDelete}
                   className="w-full px-3  text-left text-[13px] text-[#cccccc] hover:bg-[#2a2d2e] flex items-center gap-2 text-red-400 hover:text-red-300 last:pb-1"
                 >
                  <i className="codicon codicon-trash" style={{ fontSize: 14 }} />
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmation.node && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50"
          onClick={cancelDelete}
        >
          <div 
            className="bg-[#252526] border border-[#3e3e42] rounded-lg p-4 max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[14px] font-semibold text-white mb-2">
              Delete {deleteConfirmation.node.type === 'folder' ? 'Folder' : 'File'}?
            </h3>
            <p className="text-[13px] text-[#cccccc] mb-4 whitespace-pre-line">
              Are you sure you want to delete "{deleteConfirmation.node.name}"?
              {deleteConfirmation.node.type === 'folder' ? '\n\nThis will delete the folder and all its contents.' : ''}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={cancelDelete}
                className="px-3 py-1.5 text-[13px] bg-[#3e3e42] hover:bg-[#4a4a4a] text-white rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={isDeleting}
                className="px-3 py-1.5 text-[13px] bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

