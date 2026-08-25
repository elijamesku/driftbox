'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Plus, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'

interface TerminalSession {
  id: string
  name: string
  output: string
  connected: boolean
  prompt: string
}

interface TerminalProps {
  isOpen: boolean
  onClose: () => void
  selectedRepo?: {
    id: number
    name: string
    full_name: string
  } | null
  onRefreshGitStatus?: () => void  // Callback to refresh git status after git commands
}

export default function Terminal({ isOpen, onClose, selectedRepo, onRefreshGitStatus }: TerminalProps) {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [height, setHeight] = useState(200) // Default height
  const [isResizing, setIsResizing] = useState(false)
  const [currentCwd, setCurrentCwd] = useState<string | null>(null)
  const [homeDir, setHomeDir] = useState<string | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const lastSelectedRepoRef = useRef<string | null>(null) // Track last repo to detect actual changes

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [sessions])


  // Get home directory on mount
  useEffect(() => {
    if ((window as any).electronAPI) {
      ;(window as any).electronAPI.getHomeDir().then((home: string) => {
        setHomeDir(home)
      }).catch(() => {
        // Fallback - try to infer from common paths
        const platform = (window as any).electronAPI?.platform
        if (platform === 'win32') {
          setHomeDir('C:\\Users')
        } else {
          setHomeDir('/home')
        }
      })
    }
  }, [])

  const getPromptForCwd = useCallback((cwd: string | null): string => {
    if (!cwd) return '$ '
    try {
      const home = homeDir
      
      // Convert to forward slashes for consistency (works on both Windows and Unix)
      const normalizedCwd = cwd.replace(/\\/g, '/')
      
      if (home) {
        const normalizedHome = home.replace(/\\/g, '/')
        
        // If in home directory, show ~
        if (normalizedCwd === normalizedHome || normalizedCwd === normalizedHome + '/') {
          return '~$ '
        }
        
        // If inside home directory, show ~/relative (ALWAYS show full relative path)
        if (normalizedCwd.startsWith(normalizedHome + '/')) {
          const relative = normalizedCwd.substring(normalizedHome.length + 1)
          const cleanRelative = relative.replace(/\/$/, '')
          return `~/${cleanRelative}$ `
        }
      }
      
      // For paths outside home, ALWAYS show the FULL path - make it obvious!
      // Remove trailing slash
      const cleanCwd = normalizedCwd.replace(/\/$/, '')
      return `${cleanCwd}$ `
    } catch {
      return '$ '
    }
  }, [homeDir])

  // Update working directory when selectedRepo changes (but not when currentCwd changes from cd)
  useEffect(() => {
    if (!selectedRepo) {
      lastSelectedRepoRef.current = null
      return
    }
    
    if ((window as any).electronAPI && activeSession) {
      const repoKey = selectedRepo.full_name
      
      // Only update if the repo actually changed (not just currentCwd)
      if (lastSelectedRepoRef.current === repoKey) {
        return // Same repo, don't reset directory - user may have used cd
      }
      
      lastSelectedRepoRef.current = repoKey
      const [owner, repo] = selectedRepo.full_name.split('/')
      ;(window as any).electronAPI.getRepoPath(owner, repo).then((result: any) => {
        if (result.success && result.path) {
          const newPath = result.path
          // Use functional update to get current value
          setCurrentCwd(prevCwd => {
            // Only update if it's actually different
            if (newPath !== prevCwd) {
              // Update prompt and show notification for active session
              setSessions(prev => prev.map(s => {
                if (s.id === activeSession) {
                  const notification = prevCwd 
                    ? `\n[Switched to repo: ${selectedRepo.full_name}]\n`
                    : `\n[Opened repo: ${selectedRepo.full_name}]\n`
                  return {
                    ...s,
                    output: s.output + notification,
                    prompt: getPromptForCwd(newPath)
                  }
                }
                return s
              }))
              return newPath
            }
            return prevCwd
          })
        }
      }).catch((err: any) => {
        console.warn('Failed to get repo path:', err)
      })
    }
  }, [selectedRepo, activeSession, getPromptForCwd]) // Removed currentCwd from dependencies

  // Initialize default session when terminal opens
  useEffect(() => {
    if (isOpen && sessions.length === 0) {
      const newId = Date.now().toString()
      const platformName = (window as any).electronAPI?.platform === 'win32' ? 'powershell' : 'bash'
      
      const newSession: TerminalSession = {
        id: newId,
        name: platformName,
        output: 'Terminal ready\n',
        connected: false,
        prompt: '$ '
      }
      setSessions([newSession])
      setActiveSession(newId)
      
      // If we have a selected repo, set the working directory
      if (selectedRepo && (window as any).electronAPI) {
        // Mark this repo as the last selected to prevent duplicate notifications
        lastSelectedRepoRef.current = selectedRepo.full_name
        
        const [owner, repo] = selectedRepo.full_name.split('/')
        ;(window as any).electronAPI.getRepoPath(owner, repo).then((result: any) => {
          if (result.success && result.path) {
            setCurrentCwd(result.path)
            setSessions(prev => prev.map(s => {
              if (s.id === newId) {
                return {
                  ...s,
                  connected: true,
                  prompt: getPromptForCwd(result.path)
                }
              }
              return s
            }))
          } else {
            // Repo not cloned yet, but still mark as connected
            setSessions(prev => prev.map(s => 
              s.id === newId 
                ? { ...s, connected: true }
                : s
            ))
          }
        }).catch(() => {
          // Mark as connected even if path fetch fails
          setSessions(prev => prev.map(s => 
            s.id === newId 
              ? { ...s, connected: true }
              : s
          ))
        })
      } else {
        // Get initial working directory
        if ((window as any).electronAPI) {
          // Use pwd (Unix) or cd (Windows) to get current directory
          const platform = (window as any).electronAPI.platform
          const getCwdCommand = platform === 'win32' ? 'cd' : 'pwd'
          
          ;(window as any).electronAPI.executeCommand(getCwdCommand, null).then((result: any) => {
            // Always try to get and show the directory
            // The backend should always return cwd, but also check output for pwd/cd commands
            let cwd = result.cwd
            if (!cwd && result.success && result.output) {
              // For pwd/cd commands, the output contains the directory
              cwd = result.output.trim()
            }
            
            if (cwd) {
              setCurrentCwd(cwd)
              setSessions(prev => prev.map(s => {
                if (s.id === newId) {
                  return {
                    ...s,
                    connected: true,
                    prompt: getPromptForCwd(cwd)
                  }
                }
                return s
              }))
            } else {
              // Last resort: use home directory or a default
              if (homeDir) {
                setCurrentCwd(homeDir)
                setSessions(prev => prev.map(s => 
                  s.id === newId 
                    ? { ...s, connected: true, prompt: getPromptForCwd(homeDir) }
                    : s
                ))
              } else {
                // Wait for homeDir to be loaded, then update
                setTimeout(() => {
                  if (homeDir) {
                    setCurrentCwd(homeDir)
                    setSessions(prev => prev.map(s => 
                      s.id === newId 
                        ? { ...s, prompt: getPromptForCwd(homeDir) }
                        : s
                    ))
                  }
                }, 100)
                setSessions(prev => prev.map(s => 
                  s.id === newId 
                    ? { ...s, connected: true, prompt: '~$ ' }
                    : s
                ))
              }
            }
          }).catch(() => {
          // Even on error, try to show a directory (use home or ~)
          if (homeDir) {
            setCurrentCwd(homeDir)
            setSessions(prev => prev.map(s => 
              s.id === newId 
                ? { ...s, connected: true, prompt: getPromptForCwd(homeDir) }
                : s
            ))
          } else {
            setSessions(prev => prev.map(s => 
              s.id === newId 
                ? { ...s, connected: true, prompt: '~$ ' }
                : s
            ))
          }
        })
        }
      }
    }
  }, [isOpen, sessions.length, selectedRepo, getPromptForCwd, homeDir])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing) {
        const newHeight = window.innerHeight - e.clientY
        setHeight(Math.max(100, Math.min(newHeight, window.innerHeight - 200)))
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  const handleCommand = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const command = input.trim()
      if (!command || !activeSession) return

      const currentSession = sessions.find(s => s.id === activeSession)
      if (!currentSession) return

      // Echo the command (prompt is already visible in input, so we show it in output too for consistency)
      const prompt = currentSession.prompt || '$ '
      setSessions(prev => prev.map(s => 
        s.id === activeSession 
          ? { ...s, output: s.output + prompt + command + '\n' }
          : s
      ))

      if ((window as any).electronAPI) {
        // Execute locally via Electron IPC
        try {
          const result = await (window as any).electronAPI.executeCommand(command, currentCwd)
          
          if (result.success) {
            // Always update cwd from result (even if it's the same, ensures we have it)
            const updatedCwd = result.cwd || currentCwd
            if (result.cwd) {
              setCurrentCwd(result.cwd)
            } else if (!currentCwd && updatedCwd) {
              // If we don't have a cwd yet but got one from result, set it
              setCurrentCwd(updatedCwd)
            }
            
            // Detect git commands that change repo state
            const isGitStateChangeCommand = /^git\s+(commit|push|merge|rebase|reset|checkout|branch|tag|stash)/i.test(command)
            
            // Always update prompt to reflect current directory (even if no repo selected)
            setSessions(prev => prev.map(s => {
              if (s.id === activeSession) {
                // Ensure output ends with newline if it has content
                const output = result.output || ''
                const formattedOutput = output && !output.endsWith('\n') ? output + '\n' : output
                return {
                  ...s,
                  output: s.output + formattedOutput,
                  prompt: getPromptForCwd(updatedCwd)
                }
              }
              return s
            }))
            
            // Refresh git status after git state-changing commands
            if (isGitStateChangeCommand && onRefreshGitStatus) {
              // Wait a bit for git to finish, then refresh
              setTimeout(() => {
                console.log('🔄 [Terminal] Git command detected, refreshing git status')
                onRefreshGitStatus()
              }, 500)
            }
          } else {
            setSessions(prev => prev.map(s => {
              if (s.id === activeSession) {
                return {
                  ...s,
                  output: s.output + (result.error || result.output || 'Command failed\n')
                }
              }
              return s
            }))
          }
        } catch (error: any) {
          setSessions(prev => prev.map(s => {
            if (s.id === activeSession) {
              return {
                ...s,
                output: s.output + `Error: ${error.message || 'Failed to execute command'}\n`
              }
            }
            return s
          }))
        }
        setInput('')
      }
    }
  }


  const addSession = () => {
    const newId = Date.now().toString()
    const platformName = (window as any).electronAPI?.platform === 'win32' ? 'powershell' : 'bash'
    const newSession: TerminalSession = {
      id: newId,
      name: platformName,
      output: '',
      connected: false,
      prompt: '$ '
    }
    setSessions(prev => [...prev, newSession])
    setActiveSession(newId)
    
    // Get initial directory
    if ((window as any).electronAPI) {
      const platform = (window as any).electronAPI.platform
      const getCwdCommand = platform === 'win32' ? 'cd' : 'pwd'
      setTimeout(() => {
        ;(window as any).electronAPI.executeCommand(getCwdCommand, null).then((result: any) => {
          const cwd = result.cwd || (result.output?.trim())
          if (cwd) {
            setCurrentCwd(cwd)
            setSessions(prev => prev.map(s => {
              if (s.id === newId) {
                return {
                  ...s,
                  connected: true,
                  prompt: getPromptForCwd(cwd)
                }
              }
              return s
            }))
          } else {
            setSessions(prev => prev.map(s => 
              s.id === newId 
                ? { ...s, connected: true }
                : s
            ))
          }
        })
      }, 100)
    }
  }

  const closeSession = (id: string) => {
    setSessions(prev => {
      if (prev.length === 1) return prev
      
      const remaining = prev.filter(s => s.id !== id)
      if (activeSession === id) {
        setActiveSession(remaining.length > 0 ? remaining[0].id : null)
      }
      
      return remaining
    })
  }

  const currentSession = sessions.find(s => s.id === activeSession)

  // Function to colorize prompts in terminal output
  const colorizeOutput = (text: string) => {
    if (!text) return null
    
    // Split by lines and colorize prompts
    const lines = text.split('\n')
    return lines.map((line, i) => {
      // Match common prompt patterns: path$ or ~$ or >
      const promptMatch = line.match(/^(.*?\$)\s*(.*)$/)
      if (promptMatch) {
        return (
          <div key={i}>
            <span style={{ color: '#c084fc', fontWeight: '600' }}>{promptMatch[1]}</span>
            {promptMatch[2] && <span> {promptMatch[2]}</span>}
          </div>
        )
      }
      return <div key={i}>{line || '\u00A0'}</div>
    })
  }

  // Update CSS variable when height changes so editor/chat can adjust
  // Must be before early return (React hooks rule)
  useEffect(() => {
    if (isOpen && terminalRef.current) {
      document.documentElement.style.setProperty('--terminal-height', `${height}px`)
    } else {
      document.documentElement.style.setProperty('--terminal-height', '0px')
    }
  }, [height, isOpen])

  if (!isOpen) return null

  return (
    <div 
      ref={terminalRef}
      className="absolute bottom-0 left-0 right-0 bg-[#141414] flex flex-col z-50 border-t border-[#1a1a1a]"
      style={{ height: `${height}px` }}
    >
      {/* Resize handle - drag to resize (like chat panel) */}
      <div
        className="h-1 w-full cursor-ns-resize hover:bg-[#007acc] transition-colors bg-[#1a1a1a]"
        onMouseDown={() => setIsResizing(true)}
        title="Drag to resize terminal"
      />

      {/* Terminal header */}
      <div className="h-[35px] bg-[#141414] border-b border-[#1a1a1a] flex items-center justify-between px-2">
        <div className="flex items-center gap-1">
          <span className="text-[11px] uppercase font-semibold text-[#6e7681] tracking-wider px-2">
            Terminal
          </span>
          {sessions.map((session, index) => (
            <div
              key={session.id}
              className={`h-[35px] px-3 flex items-center gap-2 cursor-pointer group relative ${
                index < sessions.length - 1 ? 'border-r border-[#1a1a1a]' : ''
              } ${
                activeSession === session.id
                  ? 'bg-[#141414] text-white'
                  : 'bg-[#141414] text-[#969696] hover:bg-[#2a2a2a]'
              }`}
              onClick={() => setActiveSession(session.id)}
            >
              {activeSession === session.id && (
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-[#0078d4]" />
              )}
              <span className="text-[13px]">{session.name}</span>
              {sessions.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    closeSession(session.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:bg-[#2a2a2a] p-1 rounded"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addSession}
            className="h-[35px] px-2 flex items-center text-[#969696] hover:text-white hover:bg-[#2a2a2a]"
            title="New Terminal"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (currentSession) {
                setSessions(prev => prev.map(s => 
                  s.id === activeSession 
                    ? { ...s, output: '' }
                    : s
                ))
              }
            }}
            className="p-1 text-[#969696] hover:text-white hover:bg-[#2a2a2a] rounded"
            title="Clear"
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={onClose}
            className="p-1 text-[#969696] hover:text-white hover:bg-[#2a2a2a] rounded"
            title="Close Terminal"
          >
            <ChevronDown size={16} />
          </button>
        </div>
      </div>

      {/* Terminal output with inline input */}
      <div 
        ref={outputRef}
        className="flex-1 overflow-y-auto p-3 text-[14px] text-white bg-[#141414]"
        style={{ fontFamily: '"Input Mono", "Cascadia Code", Consolas, "Courier New", monospace' }}
        onClick={() => {
          // Focus input when clicking anywhere in terminal
          const inputEl = document.querySelector('.terminal-inline-input') as HTMLInputElement
          if (inputEl) inputEl.focus()
        }}
      >
        <div>
          {colorizeOutput(currentSession?.output || '')}
          {!currentSession?.connected && (
            <span className="text-yellow-500">Connecting...</span>
          )}
        </div>
        
        {/* Current input line */}
        {currentSession?.connected && (
          <div className="flex items-start">
            <span 
              className="select-none font-semibold"
              style={{ 
                color: '#c084fc',
                textShadow: 'none'
              }}
            >
              {currentSession?.prompt || '$ '}
            </span>
            <div className="flex-1 relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleCommand}
                className="terminal-inline-input w-full bg-transparent outline-none border-none text-[14px] text-white caret-transparent focus:outline-none focus:ring-0"
                style={{ 
                  fontFamily: '"Input Mono", "Cascadia Code", Consolas, "Courier New", monospace',
                  padding: 0,
                  margin: 0,
                  boxShadow: 'none',
                  border: 'none',
                  background: 'transparent'
                }}
                autoFocus
              />
              {/* Custom blinking cursor */}
              <span 
                className="terminal-cursor"
                style={{
                  position: 'absolute',
                  left: `${input.length * 8.4}px`,
                  top: '0',
                  width: '8px',
                  height: '16px',
                  backgroundColor: 'white',
                  animation: 'blink 1s step-end infinite'
                }}
              />
            </div>
          </div>
        )}
        
        <style>{`
          @keyframes blink {
            0%, 50% {
              opacity: 1;
            }
            51%, 100% {
              opacity: 0;
            }
          }
          
          .terminal-cursor {
            pointer-events: none;
          }
        `}</style>
      </div>
    </div>
  )
}

