'use client'

/**
 * Team Chat - Real-time chat for team collaboration
 * Features: Code references, @mentions, reactions, pinned messages
 */

import { useState, useRef, useEffect } from 'react'
import { Users, FileCode, ExternalLink, Pin, Smile } from 'lucide-react'
import type { ChatMessage, CodeRef } from '@/hooks/useTeamCollaboration'

interface TeamChatProps {
  messages: ChatMessage[]
  typingUsers: { user_id: string; user_name: string }[]
  currentUserId: string
  onSendMessage: (message: string, codeRef?: CodeRef) => void
  onTyping: (isTyping: boolean) => void
  isConnected: boolean
  onSwitchMode?: (mode: 'ask' | 'agent') => void
  fontSize?: number
  onlineUsers?: { user_id: string; user_name: string }[]
  onNavigateToFile?: (file: string, line: number, repo?: string) => void
  onModeDropdownChange?: (isOpen: boolean) => void
}

// Reaction emojis
const REACTIONS = ['👍', '❤️', '🎉', '😂', '🤔', '👀']

export default function TeamChat({
  messages,
  typingUsers,
  currentUserId,
  onSendMessage,
  onTyping,
  isConnected,
  onSwitchMode,
  fontSize = 13,
  onlineUsers = [],
  onNavigateToFile,
  onModeDropdownChange
}: TeamChatProps) {
  const [input, setInput] = useState('')
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false)
  const [showTimeForMessage, setShowTimeForMessage] = useState<string | null>(null)
  const [pendingCodeRef, setPendingCodeRef] = useState<CodeRef | null>(null)
  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>({}) // messageId -> emoji -> userIds
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null)
  const [pinnedMessages, setPinnedMessages] = useState<Set<string>>(new Set())
  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Notify parent when mode dropdown opens/closes
  useEffect(() => {
    onModeDropdownChange?.(modeDropdownOpen)
  }, [modeDropdownOpen, onModeDropdownChange])

  // Handle paste for code references
  const handlePaste = async (e: React.ClipboardEvent) => {
    console.log('📋 [Paste] Paste event in TeamChat')
    try {
      const clipboardData = e.clipboardData
      const text = clipboardData.getData('text/plain')
      console.log('📋 [Paste] Pasted text length:', text.length)
      
      // Check for Driftbox code reference in sessionStorage (set by editor copy)
      const storedRef = sessionStorage.getItem('driftbox-code-ref')
      console.log('📋 [Paste] Stored ref:', storedRef ? 'found' : 'not found')
      if (storedRef) {
        const codeRef = JSON.parse(storedRef) as CodeRef & { timestamp: number }
        console.log('📋 [Paste] Code ref:', codeRef.file, ':', codeRef.startLine, '-', codeRef.endLine)
        
        // Only use if copied within last 30 seconds and text matches
        const isRecent = Date.now() - codeRef.timestamp < 30000
        // Normalize line endings for Windows compatibility (\r\n → \n)
        const normalizedPasted = text.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        const normalizedStored = codeRef.code.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        const textMatches = normalizedPasted === normalizedStored
        console.log('📋 [Paste] isRecent:', isRecent, 'textMatches:', textMatches, 'lengths:', normalizedPasted.length, normalizedStored.length)
        
        if (isRecent && textMatches) {
          e.preventDefault()
          setPendingCodeRef({
            file: codeRef.file,
            code: codeRef.code,
            startLine: codeRef.startLine,
            endLine: codeRef.endLine,
            repo: codeRef.repo
          })
          // Clear the stored ref so it's not reused
          sessionStorage.removeItem('driftbox-code-ref')
          return
        }
      }
      
      // Check for Driftbox code reference format (JSON with file/line info)
      // This would be set by the editor when copying with context
      const driftboxData = clipboardData.getData('application/x-driftbox-code')
      if (driftboxData) {
        e.preventDefault()
        const codeRef = JSON.parse(driftboxData) as CodeRef
        setPendingCodeRef(codeRef)
        return
      }
      
      // Check if pasting code (multi-line or looks like code)
      if (text.includes('\n') && (text.includes('{') || text.includes('=') || text.includes('resource'))) {
        // Don't prevent default, let them paste, but we could show a hint
      }
    } catch (err) {
      // Ignore parse errors
    }
  }

  // Add reaction to message
  const addReaction = (messageId: string, emoji: string) => {
    setReactions(prev => {
      const msgReactions = prev[messageId] || {}
      const emojiReactions = msgReactions[emoji] || []
      
      // Toggle reaction
      if (emojiReactions.includes(currentUserId)) {
        return {
          ...prev,
          [messageId]: {
            ...msgReactions,
            [emoji]: emojiReactions.filter(id => id !== currentUserId)
          }
        }
      } else {
        return {
          ...prev,
          [messageId]: {
            ...msgReactions,
            [emoji]: [...emojiReactions, currentUserId]
          }
        }
      }
    })
    setShowReactionPicker(null)
  }

  // Toggle pin
  const togglePin = (messageId: string) => {
    setPinnedMessages(prev => {
      const newPinned = new Set(prev)
      if (newPinned.has(messageId)) {
        newPinned.delete(messageId)
      } else {
        newPinned.add(messageId)
      }
      return newPinned
    })
  }

  // Handle @mention input
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)
    
    // Auto-resize textarea
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px'
    
    // Check for @mention trigger
    const lastAtIndex = value.lastIndexOf('@')
    if (lastAtIndex !== -1 && lastAtIndex === value.length - 1) {
      setShowMentions(true)
      setMentionFilter('')
    } else if (lastAtIndex !== -1) {
      const afterAt = value.slice(lastAtIndex + 1)
      if (!afterAt.includes(' ')) {
        setShowMentions(true)
        setMentionFilter(afterAt.toLowerCase())
      } else {
        setShowMentions(false)
      }
    } else {
      setShowMentions(false)
    }
    
    // Typing indicator logic
    onTyping(true)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => onTyping(false), 2000)
  }

  // Insert @mention
  const insertMention = (userName: string) => {
    const lastAtIndex = input.lastIndexOf('@')
    const newInput = input.slice(0, lastAtIndex) + `@${userName} `
    setInput(newInput)
    setShowMentions(false)
    inputRef.current?.focus()
  }

  // Render message with @mentions highlighted
  const renderMessageText = (text: string) => {
    // Split by @mentions
    const parts = text.split(/(@\w+)/g)
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        const userName = part.slice(1)
        const isCurrentUser = onlineUsers.some(u => 
          u.user_name && u.user_name.toLowerCase() === userName.toLowerCase() && u.user_id === currentUserId
        )
        return (
          <span 
            key={i} 
            className={`px-1 rounded ${isCurrentUser ? 'bg-purple-500/40 text-purple-200' : 'bg-blue-500/30 text-blue-300'}`}
          >
            {part}
          </span>
        )
      }
      return part
    })
  }

  // Filter online users for mention suggestions
  const filteredUsers = onlineUsers.filter(u => 
    u.user_name && u.user_name.toLowerCase().includes(mentionFilter) && u.user_id !== currentUserId
  )

  const handleSend = () => {
    if (!input.trim() && !pendingCodeRef) return
    if (!isConnected) return
    
    onSendMessage(input.trim(), pendingCodeRef || undefined)
    setInput('')
    setPendingCodeRef(null)
    onTyping(false)
    
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = null
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const getUserColor = (userId: string) => {
    const colors = [
      'text-purple-400',
      'text-blue-400',
      'text-green-400',
      'text-yellow-400',
      'text-pink-400',
      'text-cyan-400'
    ]
    const index = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return colors[index % colors.length]
  }

  const getBubbleColor = (userId: string) => {
    const colors = [
      '#4a3a5c', // purple
      '#3a4a5c', // blue
      '#3a5c4a', // green
      '#5c5a3a', // yellow/olive
      '#5c3a4a', // pink
      '#3a5c5c'  // cyan
    ]
    const index = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return colors[index % colors.length]
  }

  return (
    <div className="flex flex-col h-full">
      {/* Minimal header - just connection status */}
      {!isConnected && (
        <div className="px-4 py-2 border-b border-[#3a3a3a] flex items-center gap-2 bg-yellow-500/10">
          <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
          <span className="text-xs text-yellow-400">Connecting to team...</span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 relative z-0 flex flex-col">
        {/* Pinned messages at top */}
        {messages.filter(m => pinnedMessages.has(m.id || '')).length > 0 && (
          <div className="mb-3 pb-3 border-b border-[#333]">
            <div className="text-[10px] text-yellow-500 flex items-center gap-1 mb-2">
              <Pin size={10} /> Pinned
            </div>
            {messages.filter(m => pinnedMessages.has(m.id || '')).map(msg => (
              <div key={`pinned-${msg.id}`} className="text-xs text-gray-400 bg-yellow-500/10 rounded px-2 py-1 mb-1">
                <span className="font-medium">{msg.user_name}:</span> {msg.message.slice(0, 50)}{msg.message.length > 50 ? '...' : ''}
              </div>
            ))}
          </div>
        )}

        {messages.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No messages yet</p>
            <p className="text-xs mt-1">Start chatting with your team!</p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isMe = msg.user_id === currentUserId
            const messageId = msg.id || `msg-${idx}`
            const showTime = showTimeForMessage === messageId
            const msgReactions = reactions[messageId] || {}
            const isPinned = pinnedMessages.has(messageId)
            const codeRef = (msg as any).code_ref as CodeRef | undefined
            
            // Check if this is a consecutive message from same sender (for grouping)
            const prevMsg = idx > 0 ? messages[idx - 1] : null
            const isConsecutive = prevMsg && prevMsg.user_id === msg.user_id
            const showName = !isMe && !isConsecutive
            
            return (
              <div
                key={messageId}
                className={`group flex items-start gap-1 ${isMe ? 'justify-end' : 'justify-start'}`}
                style={{ marginTop: idx === 0 ? '0' : '8px' }}
              >
                {/* Timestamp - shows on left for my messages when clicked */}
                {isMe && (
                  <div className={`text-[10px] text-gray-500 transition-all duration-200 mt-2 ${showTime ? 'opacity-100' : 'opacity-0 w-0'}`}>
                    {formatTime(msg.timestamp)}
                  </div>
                )}
                
                <div className={`relative max-w-[75%]`}>
                  {/* Sender name above bubble - only show for first message in a group */}
                  {showName && (
                    <div className={`text-[10px] font-medium mb-0.5 px-2 flex items-center gap-1 ${getUserColor(msg.user_id)}`}>
                      {isPinned && <Pin size={8} className="text-yellow-500" />}
                      {msg.user_name}
                    </div>
                  )}
                  {/* Pin indicator for own messages */}
                  {isMe && isPinned && !isConsecutive && (
                    <div className="text-[10px] font-medium mb-0.5 px-2 flex items-center gap-1 justify-end text-yellow-500">
                      <Pin size={8} />
                    </div>
                  )}
                  
                  {/* Message bubble */}
                  <div 
                    className="relative cursor-pointer active:scale-[0.98] transition-transform"
                    onClick={() => setShowTimeForMessage(showTime ? null : messageId)}
                  >
                    {/* Clean rectangular bubble */}
                    <div
                      className="relative px-4 py-2.5 rounded-lg"
                      style={{ backgroundColor: isMe ? '#303030' : getBubbleColor(msg.user_id) }}
                    >
                      {/* Message text with @mention highlighting */}
                      <div 
                        className="whitespace-pre-wrap break-words text-white" 
                        style={{ fontSize: `${fontSize}px`, lineHeight: '1.5' }}
                      >
                        {renderMessageText(msg.message)}
                      </div>
                      
                      {/* Code reference if present */}
                      {codeRef && (
                        <div 
                          onClick={(e) => {
                            e.stopPropagation()
                            onNavigateToFile?.(codeRef.file, codeRef.startLine, codeRef.repo)
                          }}
                          className="mt-2 rounded-xl overflow-hidden cursor-pointer transition-colors bg-[#1a1a1a] border border-[#444] hover:border-purple-500/50"
                        >
                          <div className="flex items-center justify-between px-3 py-1.5 border-b bg-[#252525] border-[#444]">
                            <span className="text-[10px] flex items-center gap-1 text-gray-400">
                              <FileCode size={10} />
                              {codeRef.file}:{codeRef.startLine}-{codeRef.endLine}
                            </span>
                            <ExternalLink size={10} className="text-gray-500" />
                          </div>
                          <pre className="px-3 py-2 text-[11px] overflow-x-auto max-h-[100px] text-gray-300">
                            <code>{codeRef.code}</code>
                          </pre>
                        </div>
                      )}
                    </div>
                    
                    {/* No tail - Gemini style is clean without tails */}
                    <div
                      className="hidden"
                      style={{
                        background: isMe ? '#1f1f1f' : '#252525',
                        clipPath: isMe 
                          ? 'polygon(0 0, 100% 100%, 0 100%)' 
                          : 'polygon(100% 0, 100% 100%, 0 100%)'
                      }}
                    />
                  </div>
                  
                  {/* Reactions display - inline after bubble */}
                  {Object.keys(msgReactions).length > 0 && (
                    <div className={`flex gap-0.5 mt-0.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
                      {Object.entries(msgReactions).map(([emoji, users]) => users.length > 0 && (
                        <button
                          key={emoji}
                          onClick={() => addReaction(messageId, emoji)}
                          className={`text-[10px] px-1 py-0 rounded-full bg-[#2a2a2a] border ${
                            users.includes(currentUserId) ? 'border-purple-500/50' : 'border-[#333]'
                          } hover:bg-[#333] transition-colors`}
                        >
                          {emoji}{users.length > 1 && <span className="text-gray-500 ml-0.5">{users.length}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {/* Action buttons on hover - positioned absolute so no layout impact */}
                  <div className={`absolute ${isMe ? 'left-0 -translate-x-full pr-1' : 'right-0 translate-x-full pl-1'} top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10`}>
                    <div className="flex gap-0.5 bg-[#1a1a1a] rounded-full border border-[#333] overflow-hidden">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowReactionPicker(showReactionPicker === messageId ? null : messageId)
                        }}
                        className="p-1 hover:bg-[#333] transition-colors"
                        title="Add reaction"
                      >
                        <Smile size={10} className="text-gray-400" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          togglePin(messageId)
                        }}
                        className={`p-1 hover:bg-[#333] transition-colors ${isPinned ? 'text-yellow-500' : 'text-gray-400'}`}
                        title={isPinned ? 'Unpin' : 'Pin message'}
                      >
                        <Pin size={10} />
                      </button>
                    </div>
                  </div>
                  
                  {/* Reaction picker - absolute positioned */}
                  {showReactionPicker === messageId && (
                    <div className={`absolute ${isMe ? 'right-0' : 'left-0'} -bottom-8 z-20`}>
                      <div className="bg-[#1a1a1a] rounded-full border border-[#333] p-0.5 flex gap-0.5 shadow-lg">
                        {REACTIONS.map(emoji => (
                          <button
                            key={emoji}
                            onClick={(e) => {
                              e.stopPropagation()
                              addReaction(messageId, emoji)
                            }}
                            className="p-1 hover:bg-[#333] rounded-full transition-colors text-xs"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Timestamp - shows on right for others' messages when clicked */}
                {!isMe && (
                  <div className={`text-[10px] text-gray-500 transition-all duration-200 mt-6 ${showTime ? 'opacity-100' : 'opacity-0 w-0'}`}>
                    {formatTime(msg.timestamp)}
                  </div>
                )}
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div className="px-4 py-1 text-xs text-gray-400">
          {typingUsers.length === 1
            ? `${typingUsers[0].user_name} is typing...`
            : `${typingUsers.map(u => u.user_name).join(', ')} are typing...`}
        </div>
      )}

      {/* Input - Matching the main ChatPanel style */}
      <div className="p-4 relative z-10">
        {/* Pending code reference preview */}
        {pendingCodeRef && (
          <div className="mb-2 rounded-lg bg-[#1a1a1a] border border-[#333] overflow-hidden">
            <div className="flex items-center justify-between px-2 py-1 bg-[#252525] border-b border-[#333]">
              <span className="text-[10px] text-gray-400 flex items-center gap-1">
                <FileCode size={10} />
                {pendingCodeRef.file}:{pendingCodeRef.startLine}-{pendingCodeRef.endLine}
              </span>
              <button 
                onClick={() => setPendingCodeRef(null)}
                className="text-gray-500 hover:text-gray-300"
              >
                ×
              </button>
            </div>
            <pre className="p-2 text-[10px] overflow-x-auto text-gray-300 max-h-[60px]">
              <code>{pendingCodeRef.code}</code>
            </pre>
          </div>
        )}

        <div className="rainbow-border-wrapper outline-only p-[2px]">
          <div className="relative bg-[#1a1a1a] rounded-[8px] px-3 py-2 transition-all duration-500 border border-[#2a2a2a]">
            {/* @Mentions dropdown */}
            {showMentions && filteredUsers.length > 0 && (
              <div className="absolute bottom-full left-0 mb-2 bg-[#1e1e1e] border border-[#333] rounded-lg shadow-xl overflow-hidden w-[200px] z-50">
                <div className="p-1">
                  {filteredUsers.slice(0, 5).map(user => (
                    <button
                      key={user.user_id}
                      onClick={() => insertMention(user.user_name)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#333] transition-colors text-left"
                    >
                      <div className={`w-6 h-6 rounded-full ${getUserColor(user.user_id)} flex items-center justify-center text-white text-xs`}>
                        {user.user_name[0]?.toUpperCase()}
                      </div>
                      <span className="text-sm text-white">{user.user_name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={isConnected ? "Message your team... (@ to mention)" : "Connecting..."}
              disabled={!isConnected}
              rows={1}
              className="w-full bg-transparent text-white text-[13px] placeholder-gray-500 focus:outline-none resize-none pb-6 disabled:opacity-50 -translate-y-1 max-h-[100px] overflow-y-auto"
              style={{ minHeight: '24px' }}
            />
            
            {/* Mode dropdown - Bottom Left */}
            <div className="absolute bottom-2 left-3">
              <div className="relative">
                <button
                  onClick={() => setModeDropdownOpen(!modeDropdownOpen)}
                  className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] bg-[var(--cursor-accent)]/20 text-gray-400 hover:text-gray-300 transition-colors border border-gray-700"
                >
                  <Users className="w-3 h-3" />
                  Team
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {/* Dropdown Menu */}
                {modeDropdownOpen && onSwitchMode && (
                  <div className="absolute bottom-full left-0 mb-2 bg-[#1e1e1e] border border-[#3e3e42] rounded-lg shadow-2xl overflow-hidden w-[140px] z-50" style={{ backgroundColor: '#1e1e1e' }}>
                    <div className="p-1 bg-[#1e1e1e]">
                      <button
                        onClick={() => { onSwitchMode('ask'); setModeDropdownOpen(false); }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-gray-400 hover:bg-[#252525] hover:text-gray-200 transition-all"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        <span className="text-[11px] font-medium">Ask</span>
                      </button>
                      <button
                        onClick={() => { onSwitchMode('agent'); setModeDropdownOpen(false); }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-gray-400 hover:bg-[#252525] hover:text-gray-200 transition-all mt-0.5"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        <span className="text-[11px] font-medium">Agent</span>
                      </button>
                      <button
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#2a2a2a] text-white mt-0.5"
                      >
                        <Users className="w-3.5 h-3.5" />
                        <span className="text-[11px] font-medium">Team</span>
                        <svg className="w-3 h-3 ml-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Send button - Bottom Right (matching main chat style) */}
            <div className="absolute bottom-2 right-3">
              <button
                onClick={handleSend}
                disabled={(!input.trim() && !pendingCodeRef) || !isConnected}
                className="relative w-8 h-8 flex items-center justify-center bg-gradient-to-r from-[#8844cc] to-[#ec4899] text-white rounded-full disabled:opacity-30 disabled:cursor-not-allowed hover:scale-110 transition-all duration-300"
                title="Send message"
              >
                {/* Outer ring */}
                <div className="absolute inset-0 rounded-full border-2 border-[#8844cc]/30 animate-pulse" style={{ width: '40px', height: '40px', left: '-4px', top: '-4px' }} />
                
                <i className="codicon codicon-send relative z-10" style={{ fontSize: 14 }} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

