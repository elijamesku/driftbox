/**
 * Real-time team collaboration hook
 * Enables Figma-style live collaboration for infrastructure editing
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { getApiEndpoint } from '@/utils/apiEndpoint'

export type UserActivityStatus = 'idle' | 'editing' | 'generating' | 'creating_pr'

// Intent signaling - what the user is working on
export type UserIntent = 'exploring' | 'refactoring' | 'debugging' | 'implementing' | 'reviewing' | 'ready-for-pr'

export interface OnlineUser {
  user_id: string
  name: string
  email: string
  status: 'online' | 'offline'
  pr_intent?: 'work-in-progress' | 'ready-for-pr'
  intent?: UserIntent
  activity_status?: UserActivityStatus
  connected_at: string
  last_seen: string
}

export interface LockedFile {
  file_path: string
  locked_by: string
  locked_by_name: string
  reason: 'generating' | 'creating_pr'
  locked_at: string
}

export interface FileActivity {
  user_id: string
  user_name: string
  repo: string
  file_path: string
  started_at: string
  last_activity: string
}

export interface CursorPosition {
  user_id: string
  user_name: string
  file_path: string
  line: number
  column: number
  repo?: string
}

export interface RecentChange {
  user_id: string
  user_name: string
  repo: string
  file_path: string
  action: string
  timestamp: string
}

export interface CodeRef {
  file: string
  startLine: number
  endLine: number
  code: string
  repo?: string
}

export interface ChatMessage {
  id: string
  user_id: string
  user_name: string
  message: string
  repo?: string
  timestamp: string
  code_ref?: CodeRef
}

// ========== File Locks ==========
export interface FileLock {
  user_id: string
  user_name: string
  repo: string
  file_path: string
  locked_at: string
  lock_type: 'exclusive' | 'soft'
}

export interface LockRequest {
  user_id: string
  user_name: string
  requested_at: string
}

// ========== Dependencies ==========
export interface DependencyNode {
  id: string
  label: string
  type: string
  file: string
}

export interface DependencyEdge {
  from: string
  to: string
  label: string
}

export interface DependencyGraph {
  nodes: DependencyNode[]
  edges: DependencyEdge[]
  resource_count: number
  dependency_count: number
}

export interface DependencyNotification {
  changed_resource: string
  change_type: 'modified' | 'deleted' | 'created'
  changed_by: string
  affected_resources: { resource: string; file: string }[]
  affected_files: string[]
  message: string
  timestamp: string
}

export function useTeamCollaboration(teamId: string | null, userId: string | null, userName?: string | null) {
  const [isConnected, setIsConnected] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [fileActivity, setFileActivity] = useState<Record<string, FileActivity>>({})
  const [recentChanges, setRecentChanges] = useState<RecentChange[]>([])
  const [cursorPositions, setCursorPositions] = useState<Record<string, CursorPosition>>({})
  const [conflictWarning, setConflictWarning] = useState<string | null>(null)
  const [lockedFiles, setLockedFiles] = useState<LockedFile[]>([])
  const [myActivityStatus, setMyActivityStatus] = useState<UserActivityStatus>('idle')
  
  // ========== Intent Signaling State ==========
  const [myIntent, setMyIntent] = useState<UserIntent>('exploring')
  const [userIntents, setUserIntents] = useState<Record<string, UserIntent>>({})
  
  // Initialize chat from localStorage cache if available
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    if (typeof window !== 'undefined' && teamId) {
      const cached = localStorage.getItem(`driftbox-chat-${teamId}`)
      if (cached) {
        try {
          return JSON.parse(cached)
        } catch { return [] }
      }
    }
    return []
  })
  const [typingUsers, setTypingUsers] = useState<{user_id: string, user_name: string}[]>([])
  
  // ========== File Locks State ==========
  const [fileLocks, setFileLocks] = useState<Record<string, FileLock>>({})
  const [lockRequests, setLockRequests] = useState<{ file: string; requester: string; message: string }[]>([])
  const [lockNotifications, setLockNotifications] = useState<{ type: string; message: string; timestamp: string }[]>([])
  
  // ========== Dependency State ==========
  const [dependencyGraph, setDependencyGraph] = useState<DependencyGraph | null>(null)
  const [dependencyNotifications, setDependencyNotifications] = useState<DependencyNotification[]>([])
  
  // ========== Live Editing State ==========
  const [remoteTextChanges, setRemoteTextChanges] = useState<{
    userId: string
    userName: string
    repo: string
    filePath: string
    fullContent: string
  } | null>(null)
  
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const onFilesUpdatedRef = useRef<(() => void) | null>(null)
  const onStagingClearedRef = useRef<(() => void) | null>(null)

  // Connect to team collaboration WebSocket
  const connect = useCallback(() => {
    if (!teamId || !userId) return

    try {
      const token = localStorage.getItem('token')
      if (!token) return

      // Build WebSocket URL with user name
      const encodedName = encodeURIComponent(userName || userId || 'Unknown')
      const endpoint = getApiEndpoint(`/teams/${teamId}/collaborate?user_id=${userId}&token=${token}&user_name=${encodedName}`)
      const wsUrl = endpoint.replace(/^http/, 'ws')
      
      console.log(`🔌 Connecting to team collaboration: ${teamId}`)
      
      const ws = new WebSocket(wsUrl)
      
      ws.onopen = () => {
        console.log('✅ Team collaboration connected')
        setIsConnected(true)
        
        // Start heartbeat
        heartbeatIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }))
          }
        }, 30000) // Every 30 seconds
      }
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          handleMessage(message)
        } catch (e) {
          console.error('Failed to parse collaboration message:', e)
        }
      }
      
      ws.onerror = (error) => {
        console.error('Team collaboration WebSocket error:', error)
      }
      
      ws.onclose = () => {
        console.log('🔌 Team collaboration disconnected')
        setIsConnected(false)
        
        // Clear heartbeat
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current)
        }
        
        // Attempt reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('🔄 Reconnecting to team collaboration...')
          connect()
        }, 3000)
      }
      
      wsRef.current = ws
    } catch (error) {
      console.error('Failed to connect to team collaboration:', error)
    }
  }, [teamId, userId, userName])

  // Handle incoming messages
  const handleMessage = useCallback((message: any) => {
    console.log('📨 Team collaboration message:', message.type)
    
    switch (message.type) {
      case 'initial_state':
        setOnlineUsers(message.online_users || [])
        setFileActivity(message.file_activity || {})
        setRecentChanges(message.recent_changes || [])
        // Load chat history from server
        if (message.chat_messages && message.chat_messages.length > 0) {
          setChatMessages(message.chat_messages)
          console.log(`💬 Loaded ${message.chat_messages.length} chat messages from server`)
        }
        if (message.typing_users) {
          setTypingUsers(message.typing_users)
        }
        setCursorPositions(message.cursor_positions || {})
        break
      
      case 'user_joined':
        setOnlineUsers(prev => [...prev.filter(u => u.user_id !== message.user_id), message.user])
        // Show notification
        showNotification(`${message.user.name} joined the team`, 'info')
        break
      
      case 'user_left':
        setOnlineUsers(prev => prev.filter(u => u.user_id !== message.user_id))
        setCursorPositions(prev => {
          const updated = { ...prev }
          delete updated[message.user_id]
          return updated
        })
        break
      
      case 'file_editing_started':
        const fileKey = `${message.repo}:${message.file_path}`
        setFileActivity(prev => ({
          ...prev,
          [fileKey]: {
            user_id: message.user_id,
            user_name: message.user_name,
            repo: message.repo,
            file_path: message.file_path,
            started_at: message.timestamp,
            last_activity: message.timestamp
          }
        }))
        // Show notification
        showNotification(`${message.user_name} is editing ${message.file_path}`, 'info')
        break
      
      case 'file_editing_stopped':
        const stoppedFileKey = `${message.repo}:${message.file_path}`
        setFileActivity(prev => {
          const updated = { ...prev }
          delete updated[stoppedFileKey]
          return updated
        })
        break
      
      case 'file_changed':
        setRecentChanges(prev => [
          ...prev,
          {
            user_id: message.user_id,
            user_name: message.user_name,
            repo: message.repo,
            file_path: message.file_path,
            action: message.change?.action || 'modified',
            timestamp: message.timestamp
          }
        ].slice(-20)) // Keep last 20
        
        // Show notification if editing same file
        showNotification(
          `${message.user_name} modified ${message.file_path}`,
          'warning'
        )
        break
      
      case 'files_updated':
        // Files were created/updated by another user (e.g., AI agent)
        // Now includes file content so we can write them locally
        const receivedFiles = message.files || []
        const newFileCount = receivedFiles.length
        console.log('📥 [files_updated] Received files from teammate:', receivedFiles.map((f: any) => ({ path: f.path, action: f.action, contentLength: f.content?.length })))
        
        if (newFileCount > 0) {
          const hasNewFiles = receivedFiles.some((f: any) => f.action === 'created')
          showNotification(
            `${message.user_name} ${hasNewFiles ? 'created' : 'updated'} ${newFileCount} file${newFileCount > 1 ? 's' : ''} via AI`,
            'info'
          )
          
          // Write files to local disk (desktop only) - use async IIFE to properly await all writes
          if (typeof window !== 'undefined' && (window as any).electronAPI) {
            const [owner, repo] = (message.repo || '').split('/')
            if (owner && repo) {
              (async () => {
                // Write all files and wait for completion
                const writePromises = receivedFiles.map(async (file: { path: string; content: string; action: string }) => {
                  try {
                    console.log(`📝 [files_updated] Writing file locally: ${file.path} (action: ${file.action})`)
                    const result = await (window as any).electronAPI.writeFile(owner, repo, file.path, file.content)
                    if (result.success) {
                      console.log(`✅ [files_updated] File written: ${file.path}`)
                    } else {
                      console.error(`❌ [files_updated] Failed to write file: ${file.path}`, result.error)
                    }
                  } catch (err) {
                    console.error(`❌ [files_updated] Error writing file: ${file.path}`, err)
                  }
                })
                
                // Wait for ALL writes to complete
                await Promise.all(writePromises)
                console.log('✅ [files_updated] All files written to disk')
                
                // NOW refresh file tree and git status
                if (onFilesUpdatedRef.current) {
                  console.log('🔄 [files_updated] Triggering file tree + git status refresh')
                  onFilesUpdatedRef.current()
                }
              })()
            }
          } else {
            // Non-desktop: just refresh file tree
            if (onFilesUpdatedRef.current) {
              onFilesUpdatedRef.current()
            }
          }
        }
        break
      
      case 'files_discarded':
        // Files were discarded by another user - delete new files, revert existing
        const discardedFiles = message.files || []
        console.log('🗑️ [files_discarded] Teammate discarded files:', discardedFiles)
        
        if (discardedFiles.length > 0) {
          showNotification(
            `${message.user_name} discarded ${discardedFiles.length} file${discardedFiles.length > 1 ? 's' : ''}`,
            'warning'
          )
          
          // Delete newly created files from disk (desktop only)
          if (typeof window !== 'undefined' && (window as any).electronAPI) {
            const [owner, repo] = (message.repo || '').split('/')
            if (owner && repo) {
              discardedFiles.forEach(async (file: { path: string; action: string }) => {
                if (file.action === 'created') {
                  // Delete the file
                  try {
                    console.log(`🗑️ [files_discarded] Deleting file: ${file.path}`)
                    const result = await (window as any).electronAPI.deleteFile(owner, repo, file.path)
                    if (result.success) {
                      console.log(`✅ [files_discarded] File deleted: ${file.path}`)
                    } else {
                      console.error(`❌ [files_discarded] Failed to delete: ${file.path}`, result.error)
                    }
                  } catch (err) {
                    console.error(`❌ [files_discarded] Error deleting file: ${file.path}`, err)
                  }
                }
                // For 'updated' files, the revert should happen via text_changed if they have the file open
              })
            }
          }
        }
        
        // Refresh file tree to remove deleted files
        setTimeout(() => {
          if (onFilesUpdatedRef.current) {
            console.log('🔄 [files_discarded] Triggering file tree refresh')
            onFilesUpdatedRef.current()
          }
        }, 300)
        break
      
      case 'cursor_moved':
        setCursorPositions(prev => ({
          ...prev,
          [message.user_id]: {
            user_id: message.user_id,
            user_name: message.user_name,
            file_path: message.file_path,
            line: message.line,
            column: message.column,
            repo: message.repo
          }
        }))
        break
      
      case 'text_changed':
        // Received full file content from another user
        if (message.user_id !== userId) {
          setRemoteTextChanges({
            userId: message.user_id,
            userName: message.user_name,
            repo: message.repo,
            filePath: message.file_path,
            fullContent: message.full_content
          })
          // Clear after a tick so new changes can be detected
          setTimeout(() => setRemoteTextChanges(null), 50)
        }
        break
      
      case 'pr_intent_changed':
        setOnlineUsers(prev => prev.map(u => 
          u.user_id === message.user_id 
            ? { ...u, pr_intent: message.pr_intent }
            : u
        ))
        // Show notification
        const intentLabel = message.pr_intent === 'ready-for-pr' ? 'ready for PR' : 'working'
        showNotification(`${message.user_name} marked their work as ${intentLabel}`, 'info')
        break
      
      case 'intent_changed':
        // Update user's intent (what they're doing)
        setUserIntents(prev => ({
          ...prev,
          [message.user_id]: message.intent
        }))
        break
      
      case 'team_pr_created':
        // Someone created a PR - staging area was cleared, reload it
        console.log(`📦 [Team PR] ${message.creator_name} created PR: ${message.title}`)
        showNotification(`${message.creator_name} created PR: ${message.title}`, 'info')
        // Trigger staging reload via callback if provided
        if (onStagingClearedRef.current) {
          console.log('🔄 [Team PR] Triggering staging reload')
          onStagingClearedRef.current()
        }
        // Also reset local git working directory to match remote (PR was created, changes are on GitHub)
        // This prevents "local changes conflict" errors when syncing
        if (typeof window !== 'undefined' && (window as any).electronAPI?.gitReset) {
          // Get repo from message if available, or we'll need to get it from context
          // For now, just log - we'll need repo context to reset
          console.log('🔄 [Team PR] PR created - local files may need reset to sync with remote')
        }
        break
      
      case 'warning':
        setConflictWarning(message.message)
        setTimeout(() => setConflictWarning(null), 5000)
        break
      
      case 'chat_message':
        setChatMessages(prev => [...prev, message.message].slice(-100))
        break
      
      case 'typing_indicator':
        if (message.is_typing) {
          setTypingUsers(prev => {
            if (prev.some(u => u.user_id === message.user_id)) return prev
            return [...prev, { user_id: message.user_id, user_name: message.user_name }]
          })
        } else {
          setTypingUsers(prev => prev.filter(u => u.user_id !== message.user_id))
        }
        break
      
      // ========== Activity Status ==========
      case 'activity_status_changed':
        // Update user's activity status
        setOnlineUsers(prev => prev.map(u => 
          u.user_id === message.user_id 
            ? { ...u, activity_status: message.activity_status }
            : u
        ))
        // Show notification for important status changes
        if (message.activity_status === 'generating') {
          showNotification(`🤖 ${message.user_name} is generating with AI`, 'info')
        } else if (message.activity_status === 'creating_pr') {
          showNotification(`📤 ${message.user_name} is creating a PR`, 'info')
        }
        break
      
      case 'files_locked_for_pr':
        // Lock files that are part of a PR being created
        console.log(`🔒 [Lock] Received lock for files:`, message.files)
        const newLocks: LockedFile[] = message.files.map((f: string) => ({
          file_path: f,
          locked_by: message.user_id,
          locked_by_name: message.user_name,
          reason: 'creating_pr' as const,
          locked_at: new Date().toISOString()
        }))
        console.log(`🔒 [Lock] Created lock objects:`, newLocks)
        setLockedFiles(prev => {
          const updated = [...prev.filter(l => l.locked_by !== message.user_id), ...newLocks]
          console.log(`🔒 [Lock] Updated lockedFiles state:`, updated)
          return updated
        })
        if (message.user_id !== userId) {
          showNotification(`🔒 ${message.user_name} locked ${message.files.length} files for PR`, 'warning')
        }
        break
      
      case 'files_unlocked_from_pr':
        // Unlock files after PR is done
        setLockedFiles(prev => prev.filter(l => l.locked_by !== message.user_id))
        if (message.user_id !== userId) {
          showNotification(`🔓 ${message.user_name}'s PR files are now unlocked`, 'info')
        }
        break
      
      // ========== File Locks ==========
      case 'file_locked':
        setFileLocks(prev => ({
          ...prev,
          [message.file_key]: {
            user_id: message.user_id,
            user_name: message.user_name,
            repo: message.repo,
            file_path: message.file_path,
            locked_at: message.timestamp,
            lock_type: message.lock_type
          }
        }))
        showNotification(`🔒 ${message.user_name} locked ${message.file_path}`, 'info')
        break
      
      case 'file_unlocked':
        setFileLocks(prev => {
          const updated = { ...prev }
          delete updated[message.file_key]
          return updated
        })
        showNotification(`🔓 ${message.file_path} is now available`, 'info')
        break
      
      case 'lock_requested':
        // Someone is waiting for your lock
        setLockRequests(prev => [...prev, {
          file: message.file_path,
          requester: message.requester_name,
          message: message.message
        }])
        showNotification(`⏳ ${message.requester_name} is waiting to edit ${message.file_path}`, 'warning')
        break
      
      case 'lock_available':
        // Lock you were waiting for is available
        showNotification(`🔓 ${message.file_path} is now available!`, 'info')
        setLockNotifications(prev => [...prev, {
          type: 'available',
          message: message.message,
          timestamp: new Date().toISOString()
        }])
        break
      
      // ========== Dependencies ==========
      case 'dependency_changed':
        // Someone changed a resource that affects your work
        setDependencyNotifications(prev => [...prev, {
          changed_resource: message.changed_resource,
          change_type: message.change_type,
          changed_by: message.changed_by,
          affected_resources: message.affected_resources,
          affected_files: message.affected_files,
          message: message.message,
          timestamp: message.timestamp
        }])
        showNotification(message.message, 'warning')
        break
      
      case 'dependency_graph':
        setDependencyGraph({
          nodes: message.nodes,
          edges: message.edges,
          resource_count: message.resource_count,
          dependency_count: message.dependency_count
        })
        break
    }
  }, [])

  // Persist chat messages to localStorage when they change
  useEffect(() => {
    if (teamId && chatMessages.length > 0) {
      localStorage.setItem(`driftbox-chat-${teamId}`, JSON.stringify(chatMessages.slice(-100)))
    }
  }, [teamId, chatMessages])

  // Send messages
  const sendMessage = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  // Public API
  const notifyFileOpen = useCallback((repo: string, filePath: string) => {
    sendMessage({ type: 'file_open', repo, file_path: filePath })
  }, [sendMessage])

  const notifyFileClose = useCallback((repo: string, filePath: string) => {
    sendMessage({ type: 'file_close', repo, file_path: filePath })
  }, [sendMessage])

  const notifyFileChange = useCallback((repo: string, filePath: string, change: any) => {
    sendMessage({ type: 'file_change', repo, file_path: filePath, change })
  }, [sendMessage])

  // Notify team that files were created/updated (triggers file tree refresh)
  // Now includes file content for new files so teammates can write them locally
  const notifyFilesUpdated = useCallback((
    repo: string, 
    files: Array<{ path: string; content: string; action: 'created' | 'updated' }>
  ) => {
    console.log('📤 [notifyFilesUpdated] Sending files to team:', files.map(f => ({ path: f.path, action: f.action, contentLength: f.content.length })))
    sendMessage({ 
      type: 'files_updated', 
      repo, 
      files // Array of { path, content, action }
    })
  }, [sendMessage])

  // Notify team that files were DISCARDED - delete new files, revert existing files
  const notifyFilesDiscarded = useCallback((
    repo: string,
    files: Array<{ path: string; action: 'created' | 'updated' }>
  ) => {
    console.log('📤 [notifyFilesDiscarded] Telling team to discard:', files)
    sendMessage({
      type: 'files_discarded',
      repo,
      files // Array of { path, action }
    })
  }, [sendMessage])

  // Debounce ref for text changes
  const textChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Broadcast full file content to other users (debounced to avoid spam)
  const notifyTextChange = useCallback((repo: string, filePath: string, fullContent: string) => {
    // Debounce: wait 150ms after typing stops before sending
    if (textChangeTimeoutRef.current) {
      clearTimeout(textChangeTimeoutRef.current)
    }
    textChangeTimeoutRef.current = setTimeout(() => {
      sendMessage({ type: 'text_change', repo, file_path: filePath, full_content: fullContent })
    }, 150)
  }, [sendMessage])

  const notifyCursorMove = useCallback((filePath: string, line: number, column: number, repo?: string) => {
    sendMessage({ type: 'cursor_move', file_path: filePath, line, column, repo })
  }, [sendMessage])

  const notifyPRIntentChange = useCallback((prIntent: 'work-in-progress' | 'ready-for-pr') => {
    sendMessage({ type: 'pr_intent_change', pr_intent: prIntent })
  }, [sendMessage])

  // Update user intent (what are you doing?)
  const notifyIntentChange = useCallback((intent: UserIntent) => {
    setMyIntent(intent)
    sendMessage({ type: 'intent_change', intent })
  }, [sendMessage])

  // Update activity status (idle, editing, generating, creating_pr)
  const setActivityStatus = useCallback((status: UserActivityStatus) => {
    setMyActivityStatus(status)
    sendMessage({ type: 'activity_status_change', activity_status: status })
  }, [sendMessage])

  // Lock files when creating a PR (prevents others from editing)
  const lockFilesForPR = useCallback((filePaths: string[]) => {
    setMyActivityStatus('creating_pr')
    sendMessage({ 
      type: 'lock_files_for_pr', 
      files: filePaths,
      activity_status: 'creating_pr'
    })
  }, [sendMessage])

  // Unlock files after PR is done (success or failure)
  const unlockFilesFromPR = useCallback(() => {
    setMyActivityStatus('idle')
    sendMessage({ type: 'unlock_files_from_pr' })
  }, [sendMessage])

  // Check if a file is locked (by someone else)
  const isFileLocked = useCallback((filePath: string): LockedFile | null => {
    const lock = lockedFiles.find(l => l.file_path === filePath && l.locked_by !== userId)
    return lock || null
  }, [lockedFiles, userId])

  const createTeamPR = useCallback((contributors: string[], title: string, description: string) => {
    sendMessage({ 
      type: 'create_team_pr', 
      contributors, 
      title, 
      description 
    })
  }, [sendMessage])

  // Send a chat message
  const sendChatMessage = useCallback((message: string, codeRef?: CodeRef) => {
    sendMessage({
      type: 'chat_message',
      message,
      code_ref: codeRef
    })
  }, [sendMessage])

  // Set typing indicator
  const setTyping = useCallback((isTyping: boolean) => {
    sendMessage({
      type: 'typing',
      is_typing: isTyping
    })
  }, [sendMessage])

  // ========== File Lock API ==========
  
  const acquireLock = useCallback((repo: string, filePath: string, lockType: 'exclusive' | 'soft' = 'exclusive') => {
    sendMessage({
      type: 'acquire_lock',
      repo,
      file_path: filePath,
      lock_type: lockType
    })
  }, [sendMessage])

  const releaseLock = useCallback((repo: string, filePath: string) => {
    sendMessage({
      type: 'release_lock',
      repo,
      file_path: filePath
    })
  }, [sendMessage])

  const requestLock = useCallback((repo: string, filePath: string) => {
    sendMessage({
      type: 'request_lock',
      repo,
      file_path: filePath
    })
  }, [sendMessage])

  const getLockStatus = useCallback((repo: string, filePath: string) => {
    sendMessage({
      type: 'get_lock_status',
      repo,
      file_path: filePath
    })
  }, [sendMessage])

  // Check if current user has lock on a file
  const hasLock = useCallback((repo: string, filePath: string): boolean => {
    const fileKey = `${repo}:${filePath}`
    const lock = fileLocks[fileKey]
    return lock?.user_id === userId
  }, [fileLocks, userId])

  // Check if file is locked by someone else
  const isLockedByOther = useCallback((repo: string, filePath: string): FileLock | null => {
    const fileKey = `${repo}:${filePath}`
    const lock = fileLocks[fileKey]
    if (lock && lock.user_id !== userId) {
      return lock
    }
    return null
  }, [fileLocks, userId])

  // ========== Dependency API ==========

  const updateDependencies = useCallback((repo: string, resources: any[]) => {
    sendMessage({
      type: 'update_dependencies',
      repo,
      resources
    })
  }, [sendMessage])

  const notifyResourceChanged = useCallback((repo: string, resource: string, changeType: 'modified' | 'deleted' | 'created' = 'modified') => {
    sendMessage({
      type: 'resource_changed',
      repo,
      resource,
      change_type: changeType
    })
  }, [sendMessage])

  const getDependents = useCallback((repo: string, resource: string) => {
    sendMessage({
      type: 'get_dependents',
      repo,
      resource
    })
  }, [sendMessage])

  const fetchDependencyGraph = useCallback((repo: string) => {
    sendMessage({
      type: 'get_dependency_graph',
      repo
    })
  }, [sendMessage])

  const clearDependencyNotification = useCallback((index: number) => {
    setDependencyNotifications(prev => prev.filter((_, i) => i !== index))
  }, [])

  const clearLockRequest = useCallback((index: number) => {
    setLockRequests(prev => prev.filter((_, i) => i !== index))
  }, [])

  // Helper to show notifications (you can enhance with a toast library)
  const showNotification = (message: string, type: 'info' | 'warning' | 'error') => {
    console.log(`[${type.toUpperCase()}] ${message}`)
    // TODO: Integrate with your notification system
  }

  // Connect/disconnect based on teamId
  useEffect(() => {
    // Cleanup function that disconnects and clears state
    const cleanup = () => {
      if (wsRef.current) {
        // Send explicit leave message before closing
        if (wsRef.current.readyState === WebSocket.OPEN) {
          console.log('👋 [Team] Sending leave message before disconnect')
          wsRef.current.send(JSON.stringify({ type: 'leave' }))
        }
        wsRef.current.close()
        wsRef.current = null
        console.log('🔌 [Team] WebSocket closed - left workspace')
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current)
        heartbeatIntervalRef.current = null
      }
      // Clear connection-related state when disconnecting
      // Note: We DON'T clear chatMessages - they're persisted in localStorage
      setIsConnected(false)
      setOnlineUsers([])
      setFileActivity({})
      setRecentChanges([])
      setCursorPositions({})
      setConflictWarning(null)
      // setChatMessages([]) - Keep chat history! Will reload from localStorage/server
      setTypingUsers([])
    }

    if (teamId && userId) {
      connect()
    } else {
      // Not in a team workspace - clean up everything
      cleanup()
    }

    return cleanup
  }, [teamId, userId, connect])

  return {
    // Connection
    isConnected,
    
    // Presence & Activity
    onlineUsers,
    fileActivity,
    recentChanges,
    cursorPositions,
    conflictWarning,
    
    // Chat
    chatMessages,
    typingUsers,
    sendChatMessage,
    setTyping,
    
    // File Operations
    notifyFileOpen,
    notifyFileClose,
    notifyFileChange,
    notifyFilesUpdated,
    notifyFilesDiscarded,
    notifyTextChange,
    notifyCursorMove,
    notifyPRIntentChange,
    createTeamPR,
    setOnFilesUpdated: (callback: (() => void) | null) => { onFilesUpdatedRef.current = callback },
    setOnStagingCleared: (callback: (() => void) | null) => { onStagingClearedRef.current = callback },
    
    // Intent signaling
    myIntent,
    userIntents,
    notifyIntentChange,
    
    // Live editing
    remoteTextChanges,
    
    // ========== Activity Status ==========
    myActivityStatus,
    setActivityStatus,
    lockedFiles,
    lockFilesForPR,
    unlockFilesFromPR,
    isFileLocked,
    
    // ========== File Locks ==========
    fileLocks,
    lockRequests,
    lockNotifications,
    acquireLock,
    releaseLock,
    requestLock,
    getLockStatus,
    hasLock,
    isLockedByOther,
    clearLockRequest,
    
    // ========== Dependencies ==========
    dependencyGraph,
    dependencyNotifications,
    updateDependencies,
    notifyResourceChanged,
    getDependents,
    fetchDependencyGraph,
    clearDependencyNotification
  }
}

