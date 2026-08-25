'use client'

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import Image from 'next/image'
import { useAuth } from '@/contexts'
import { getDailyWelcomeMessage } from '@/utils/dailyMessages'
import { useIndexCodebase } from '@/hooks/useInfrastructureData'
import FileProposal, { FileProposalData } from './FileProposal'
import CompactDiffPreview from './CompactDiffPreview'
import { isDesktop, applyFileProposal, createPullRequest, getWorkspacePath, cloneRepository } from '@/utils/desktopBridge'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import TeamChat from './TeamChat'
import MiniGame from '../swag/MiniGame'
import type { ChatMessage } from '@/hooks/useTeamCollaboration'

interface ModeSuggestion {
  suggested_mode: 'ask' | 'agent'
  reason: string
  confidence: number
  message: string
  action_text: string
}

interface StreamingCodeBlock {
  path: string
  content: string
  complete: boolean
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  mode?: 'ask' | 'agent' | 'team'
  streaming?: boolean
  streamingCode?: StreamingCodeBlock[]  // NEW: Streaming code blocks
  fileProposal?: FileProposalData
  proposalAccepted?: boolean
  appliedFilePath?: string
  modeSuggestion?: ModeSuggestion
  prSuccessData?: {
    owner: string
    repo: string
    branchName: string
    prUrl: string | null
    steps: string[]
    completedSteps?: number[]
  }
}

interface ChatPanelProps {
  isOpen: boolean
  onClose: () => void
  selectedRepo?: any // GitHub repo info for PR creation
  onFileProposal?: (proposal: FileProposalData, onAccept?: () => void) => void // Callback to open file in diff mode
  fileProposals?: any[]
  proposalStates?: Record<string, 'pending' | 'accepted' | 'rejected'>
  onSetAgentModeRef?: React.MutableRefObject<(() => void) | null>
  onAddMessageRef?: React.MutableRefObject<((message: Message) => void) | null>
  onRefreshGitStatusRef?: React.MutableRefObject<(() => void) | null>  // Callback to refresh git status after file operations
  onRefreshRepoListRef?: React.MutableRefObject<(() => Promise<any[] | undefined>) | null>  // Callback to refresh repo list after PR creation
  onClearAcceptedProposalsRef?: React.MutableRefObject<(() => void) | null>  // Callback to clear accepted proposals after PR
  onRefreshFileTreeRef?: React.MutableRefObject<(() => void) | null>  // Callback to refresh file tree after PR creation
  onShowTemplatesRef?: React.MutableRefObject<(() => void) | null>  // Callback to show quick start templates
  onHasSuggestionsChange?: (hasSuggestions: boolean) => void  // Callback when suggestions availability changes
  onCloseFilesRef?: React.MutableRefObject<((filePaths: string[]) => void) | null>  // Callback to close specific files
  onApproveAllRef?: React.MutableRefObject<(() => void) | null>  // Callback to approve all pending file proposals
  // Team chat props
  teamChatMessages?: ChatMessage[]
  teamTypingUsers?: { user_id: string; user_name: string }[]
  currentUserId?: string
  onSendTeamMessage?: (message: string, codeRef?: { file: string; startLine: number; endLine: number; code: string; repo?: string }) => void
  onTeamTyping?: (isTyping: boolean) => void
  isTeamConnected?: boolean
  currentTeamId?: string | null
  teamOnlineUsers?: { user_id: string; user_name: string }[]
  onNavigateToFile?: (file: string, line: number, repo?: string) => void
  onNotificationPopupChange?: (isOpen: boolean) => void
  onActivityStatusChange?: (status: 'idle' | 'editing' | 'generating' | 'creating_pr') => void
  onModeDropdownChange?: (isOpen: boolean) => void
  width?: number // Resizable width from parent
  onClearStaging?: () => Promise<{ success: boolean; cleared_count?: number }> // Clear staging before new generation
}

export default function ChatPanel({ isOpen, onClose, selectedRepo, onFileProposal, fileProposals = [], proposalStates = {}, onSetAgentModeRef, onAddMessageRef, onRefreshGitStatusRef, onRefreshRepoListRef, onClearAcceptedProposalsRef, onRefreshFileTreeRef, onCloseFilesRef, onApproveAllRef, onShowTemplatesRef, onHasSuggestionsChange, teamChatMessages = [], teamTypingUsers = [], currentUserId = '', onSendTeamMessage, onTeamTyping, isTeamConnected = false, currentTeamId, teamOnlineUsers = [], onNavigateToFile, onNotificationPopupChange, onActivityStatusChange, onModeDropdownChange, width, onClearStaging }: ChatPanelProps) {
  const { token, user } = useAuth()
  const indexCodebaseMutation = useIndexCodebase()
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: getDailyWelcomeMessage(),
      mode: 'ask'
    }
  ])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'ask' | 'agent' | 'team'>('ask')
  const [provider, setProvider] = useState<'claude' | 'openai'>('claude') // AI provider selector
  const [cloudProvider, setCloudProvider] = useState<'aws' | 'digitalocean'>('aws') // Cloud provider for Terraform
  const [isMaximized, setIsMaximized] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingMessage, setStreamingMessage] = useState('Thinking')
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false)
  const [dropdownFocusedIndex, setDropdownFocusedIndex] = useState<number | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [fontSize, setFontSize] = useState(13) // Base font size for chat
  const [panelWidth, setPanelWidth] = useState(360) // Default width
  const [showMiniGame, setShowMiniGame] = useState(false) // Mini game while waiting
  const [hasAutoShownGame, setHasAutoShownGame] = useState(false) // Track if we've auto-shown game for current generation
  const [isImportQuery, setIsImportQuery] = useState(false) // Track if current query is from import
  const [generationProgress, setGenerationProgress] = useState(0) // Progress percentage for import queries
  const [isResizing, setIsResizing] = useState(false)
  const [isSending, setIsSending] = useState(false) // Animation state for send
  const [isUserScrolling, setIsUserScrolling] = useState(false)
  const [isScrolledUp, setIsScrolledUp] = useState(false) // Track if user scrolled up
  const [prCreated, setPrCreated] = useState(false) // Track if PR has been created
  const [expandedCodeBlocks, setExpandedCodeBlocks] = useState<Record<string, boolean>>({}) // Track which code blocks are expanded
  const [expandedUserMessages, setExpandedUserMessages] = useState<Record<number, boolean>>({}) // Track which user messages are expanded
  const [filesOpenedFromDiff, setFilesOpenedFromDiff] = useState<Set<string>>(new Set()) // Track files opened from diffs for cleanup
  const [currentDiffIndex, setCurrentDiffIndex] = useState<number>(0) // Track which diff we're viewing in multi-file proposals
  const [unreadTeamMessages, setUnreadTeamMessages] = useState<number>(0) // Track unread team messages
  const [showTeamNotificationPopup, setShowTeamNotificationPopup] = useState(false) // Show notification popup
  const [lastReadTeamMessageCount, setLastReadTeamMessageCount] = useState(0) // Track last read count
  const [quickStartDismissed, setQuickStartDismissed] = useState(false) // Track if quick start templates dismissed
  const [securitySuggestions, setSecuritySuggestions] = useState<Array<{
    type: 'security' | 'tags' | 'cost'
    resource: string
    issue: string
    fix: string
    severity: 'critical' | 'high' | 'medium' | 'low'
    file?: string
    prompt: string
  }>>([]) // Security suggestions from code analysis
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    explanation: string
    title: string
  } | null>(null) // Context menu for template explanations
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const chatMessagesRef = useRef<HTMLDivElement>(null)
  const dropdownFocusedIndexRef = useRef<number | null>(null)

  // Expose agent mode setter through ref
  useEffect(() => {
    if (onSetAgentModeRef) {
      onSetAgentModeRef.current = () => {
        setMode('agent')
        // Focus on the input after a short delay
        setTimeout(() => {
          inputRef.current?.focus()
        }, 100)
      }
    }
  }, [onSetAgentModeRef])
  
  // Auto-switch from 'team' to 'ask' when leaving a team workspace
  useEffect(() => {
    if (!currentTeamId && mode === 'team') {
      console.log('📤 [ChatPanel] Left team workspace, switching from team chat to ask mode')
      setMode('ask')
    }
  }, [currentTeamId, mode])
  
  // Track unread team messages when in ask/agent mode
  useEffect(() => {
    if (mode === 'team') {
      // When viewing team chat, mark all as read
      setLastReadTeamMessageCount(teamChatMessages.length)
      setUnreadTeamMessages(0)
      setShowTeamNotificationPopup(false)
    } else if (currentTeamId && teamChatMessages.length > lastReadTeamMessageCount) {
      // New messages came in while in ask/agent mode
      setUnreadTeamMessages(teamChatMessages.length - lastReadTeamMessageCount)
    }
  }, [mode, teamChatMessages.length, lastReadTeamMessageCount, currentTeamId])
  
  // Notify parent when notification popup opens/closes
  useEffect(() => {
    onNotificationPopupChange?.(showTeamNotificationPopup)
  }, [showTeamNotificationPopup, onNotificationPopupChange])
  
  // Notify parent when mode dropdown opens/closes
  useEffect(() => {
    onModeDropdownChange?.(isModeDropdownOpen)
  }, [isModeDropdownOpen, onModeDropdownChange])
  
  // Reset dropdown state when mode changes (fixes stuck state when switching modes)
  useEffect(() => {
    onModeDropdownChange?.(false)
  }, [mode, onModeDropdownChange])
  
  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isModeDropdownOpen) return
    
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      // Check if click is outside the dropdown container (which includes both button and menu)
      if (!target.closest('.mode-dropdown-container')) {
        setIsModeDropdownOpen(false)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isModeDropdownOpen])
  
  // Keyboard navigation for dropdown
  useEffect(() => {
    if (!isModeDropdownOpen) {
      setDropdownFocusedIndex(null)
      dropdownFocusedIndexRef.current = null
      return
    }
    
    // Build list of available options (Agent, Ask, Team if in team)
    const options: Array<'agent' | 'ask' | 'team'> = ['agent', 'ask']
    if (currentTeamId) {
      options.push('team')
    }
    
    // Initialize focused index to current mode
    const currentIndex = options.indexOf(mode)
    const initialIndex = currentIndex >= 0 ? currentIndex : 0
    setDropdownFocusedIndex(initialIndex)
    dropdownFocusedIndexRef.current = initialIndex
    
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isModeDropdownOpen) return
      
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          event.stopPropagation()
          setDropdownFocusedIndex(prev => {
            const newIndex = prev === null ? 0 : Math.min(prev + 1, options.length - 1)
            dropdownFocusedIndexRef.current = newIndex
            return newIndex
          })
          break
        case 'ArrowUp':
          event.preventDefault()
          event.stopPropagation()
          setDropdownFocusedIndex(prev => {
            const newIndex = prev === null ? options.length - 1 : Math.max(prev - 1, 0)
            dropdownFocusedIndexRef.current = newIndex
            return newIndex
          })
          break
        case 'Enter':
          event.preventDefault()
          event.stopPropagation()
          const currentFocusedIndex = dropdownFocusedIndexRef.current
          if (currentFocusedIndex !== null && options[currentFocusedIndex]) {
            const selectedMode = options[currentFocusedIndex]
            setMode(selectedMode)
            setIsModeDropdownOpen(false)
            setDropdownFocusedIndex(null)
            dropdownFocusedIndexRef.current = null
          }
          break
        case 'Escape':
          event.preventDefault()
          event.stopPropagation()
          setIsModeDropdownOpen(false)
          setDropdownFocusedIndex(null)
          dropdownFocusedIndexRef.current = null
          break
      }
    }
    
    document.addEventListener('keydown', handleKeyDown, true) // Use capture phase
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [isModeDropdownOpen, mode, currentTeamId])
  
  // Reset PR created flag when new proposals come in (after a successful PR)
  useEffect(() => {
    if (fileProposals.length > 0 && prCreated) {
      // Check if there are any new pending proposals (new batch after PR)
      const hasPendingProposals = fileProposals.some(p => proposalStates[p.path] === 'pending')
      if (hasPendingProposals) {
        console.log('🔄 [ChatPanel] New proposals detected after PR - resetting prCreated flag')
        setPrCreated(false)
      }
    }
  }, [fileProposals, proposalStates, prCreated])

  // Expose showTemplates function through ref
  useEffect(() => {
    if (onShowTemplatesRef) {
      onShowTemplatesRef.current = () => {
        setQuickStartDismissed(false)
        setMode('agent') // Switch to agent mode to show templates
      }
    }
  }, [onShowTemplatesRef])

  // Template explanations for context menu
  const templateExplanations: Record<string, { title: string; explanation: string }> = {
    'shared-vpc': {
      title: 'Shared VPC Infrastructure',
      explanation: `A Virtual Private Cloud (VPC) is your isolated network environment in AWS. This template creates a complete networking foundation for your team to share.

**What it includes:**
• VPC with custom IP address range
• Public subnets (for resources that need internet access)
• Private subnets (for secure resources like databases)
• Internet Gateway (for public subnet internet access)
• NAT Gateway (for private subnet outbound internet)
• Route tables (to control network traffic flow)
• Security groups (firewall rules)

**Why use it:**
This is the foundation of any AWS infrastructure. All your servers, databases, and services will live inside this VPC. It's like building the roads and neighborhoods before you build houses.

**Best for:**
Teams starting a new project, setting up production infrastructure, or creating a shared development environment.`
    },
    'k8s-cluster': {
      title: 'Kubernetes Cluster with Monitoring',
      explanation: `Kubernetes (K8s) is a container orchestration platform that manages your containerized applications. This template sets up a production-ready Kubernetes cluster on AWS EKS.

**What it includes:**
• EKS (Elastic Kubernetes Service) cluster
• Managed node groups (worker nodes that run your containers)
• IAM roles for cluster and nodes
• VPC networking configuration
• Monitoring with CloudWatch
• Auto-scaling capabilities

**Why use it:**
Kubernetes lets you deploy, scale, and manage containerized applications easily. Instead of manually managing servers, K8s handles scheduling, load balancing, and health checks automatically.

**Best for:**
Microservices architectures, applications that need to scale up/down, teams using Docker containers, or when you need high availability.`
    },
    'production-vpc': {
      title: 'Production-Ready VPC',
      explanation: `A production VPC is a secure, scalable network setup designed for real-world applications serving actual users.

**What it includes:**
• VPC with CIDR block (your network's IP range)
• Multiple Availability Zones (for redundancy)
• Public subnets (web servers, load balancers)
• Private subnets (databases, application servers)
• NAT Gateway (secure outbound internet for private resources)
• Internet Gateway (inbound/outbound internet for public resources)
• Route tables (traffic routing rules)
• Security groups (firewall rules)

**Why use it:**
Production VPCs separate public-facing resources from private ones. Your database stays in a private subnet (no direct internet access) while your web servers are in public subnets. This is a security best practice.

**Best for:**
Production applications, applications handling sensitive data, or when you need high availability across multiple data centers.`
    },
    'secure-s3': {
      title: 'Secure S3 Bucket',
      explanation: `S3 (Simple Storage Service) is AWS's object storage - think of it as a massive hard drive in the cloud. This template creates a secure, production-ready storage bucket.

**What it includes:**
• S3 bucket with versioning (keeps history of file changes)
• Server-side encryption (files encrypted at rest)
• Access policies (who can read/write)
• Lifecycle policies (automatically move old files to cheaper storage)
• Public access blocking (security best practice)

**Why use it:**
S3 is perfect for storing files, backups, logs, images, or any data. Versioning means you can recover deleted files. Encryption protects your data even if someone gains access.

**Best for:**
Storing application files, backups, logs, user uploads, static website hosting, or any data that needs to be stored long-term.`
    },
    '3-tier-app': {
      title: '3-Tier Web Application',
      explanation: `A 3-tier architecture separates your application into three layers: presentation (web), application (logic), and data (database). This is the standard pattern for web applications.

**What it includes:**
• VPC with public/private subnets
• Application Load Balancer (distributes traffic to multiple servers)
• ECS Fargate (runs your application containers without managing servers)
• RDS PostgreSQL (managed database)
• Security groups (firewall rules for each layer)
• Auto-scaling (adds/removes servers based on traffic)

**Why use it:**
This architecture is scalable, secure, and maintainable. The load balancer handles traffic spikes, containers make deployment easy, and the managed database handles backups and updates automatically.

**Best for:**
Web applications, APIs, SaaS products, or any application that needs to handle multiple users and scale with demand.`
    },
    'serverless-api': {
      title: 'Serverless REST API',
      explanation: `Serverless means you don't manage servers - AWS runs your code automatically when requests come in. You only pay for what you use.

**What it includes:**
• API Gateway (handles HTTP requests)
• Lambda functions (your code that runs on-demand)
• DynamoDB (NoSQL database that scales automatically)
• IAM roles (permissions for services to talk to each other)
• CloudWatch logging (monitoring and debugging)

**Why use it:**
Serverless is perfect for APIs that have variable traffic. If no one uses your API, you pay nothing. If you get a million requests, it scales automatically. No servers to manage, patch, or monitor.

**Best for:**
APIs, microservices, event-driven applications, or when you want to minimize operational overhead. Great for startups or applications with unpredictable traffic.`
    },
    'kubernetes-cluster': {
      title: 'EKS Kubernetes Cluster',
      explanation: `EKS (Elastic Kubernetes Service) is AWS's managed Kubernetes service. Kubernetes orchestrates containers - it's like having a smart system that manages where your applications run.

**What it includes:**
• EKS control plane (managed by AWS)
• Managed node groups (worker nodes that run containers)
• IAM roles and policies (security permissions)
• VPC networking (isolated network)
• Auto-scaling (adds nodes when needed)
• Load balancing

**Why use it:**
Kubernetes is the industry standard for container orchestration. It handles deployment, scaling, health checks, and rolling updates automatically. EKS means AWS manages the complex control plane for you.

**Best for:**
Microservices, containerized applications, teams using Docker, or when you need advanced deployment strategies like blue-green or canary deployments.`
    },
    'static-website': {
      title: 'Static Website Hosting',
      explanation: `A static website is HTML, CSS, and JavaScript files (no server-side code). This template sets up a fast, global CDN-hosted website.

**What it includes:**
• S3 bucket (stores your website files)
• CloudFront CDN (distributes files globally for fast loading)
• Route53 DNS (custom domain name)
• SSL certificate (HTTPS encryption)
• Error pages (404 handling)

**Why use it:**
Static sites are fast, cheap, and secure. CloudFront caches your files at edge locations worldwide, so users load your site from the nearest location. Perfect for blogs, portfolios, or marketing sites.

**Best for:**
Marketing websites, blogs, documentation sites, single-page applications (React, Vue, etc.), or any site that doesn't need server-side processing.`
    },
    'cicd-pipeline': {
      title: 'CI/CD Pipeline',
      explanation: `CI/CD (Continuous Integration/Continuous Deployment) automates your software delivery process. When you push code, it automatically builds, tests, and deploys.

**What it includes:**
• CodePipeline (orchestrates the workflow)
• CodeBuild (builds and tests your code)
• ECR (Elastic Container Registry - stores Docker images)
• IAM roles (permissions for services)
• CloudWatch (monitoring and logs)

**Why use it:**
CI/CD means you can deploy code changes in minutes instead of hours. Every code push triggers automated tests, and if they pass, your code deploys automatically. This reduces errors and speeds up development.

**Best for:**
Teams with frequent deployments, applications using containers, or when you want to automate testing and deployment. Essential for modern software development.`
    }
  }

  // Close context menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenu) {
        setContextMenu(null)
      }
    }
    if (contextMenu) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [contextMenu])

  // Fetch security suggestions when repo changes
  useEffect(() => {
    if (!selectedRepo || !token) {
      setSecuritySuggestions([])
      onHasSuggestionsChange?.(false)
      return
    }

    const fetchSuggestions = async () => {
      try {
        const [owner, repo] = selectedRepo.full_name.split('/')
        console.log('🔍 [ChatPanel] Fetching suggestions for:', owner, repo)
        
        const response = await fetch(
          getApiEndpoint('/github/parse-github-repo'),
          { 
            method: 'POST',
            headers: { 
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ owner, repo, branch: 'main' })
          }
        )
        
        if (!response.ok) {
          console.log('❌ [ChatPanel] Suggestions fetch failed:', response.status)
          return
        }
        
        const data = await response.json()
        const resources = data.resources || []
        console.log('📦 [ChatPanel] Parsed', resources.length, 'resources')
        
        if (resources.length === 0) {
          console.log('ℹ️ [ChatPanel] No resources found, showing templates')
          setSecuritySuggestions([])
          onHasSuggestionsChange?.(false)
          return
        }

        // Generate suggestions from resources
        const suggestions: typeof securitySuggestions = []
        
        resources.forEach((resource: any) => {
          // S3 bucket security
          if (resource.type === 'aws_s3_bucket') {
            suggestions.push({
              type: 'security',
              resource: resource.name,
              issue: 'Verify S3 bucket access controls',
              fix: 'Review bucket policy',
              severity: 'critical',
              file: resource.file,
              prompt: `Review and fix the security configuration for S3 bucket "${resource.name}" in ${resource.file}. Ensure public access is blocked and encryption is enabled.`
            })
          }
          
          // Security groups
          if (resource.type === 'aws_security_group') {
            suggestions.push({
              type: 'security',
              resource: resource.name,
              issue: 'Review security group rules',
              fix: 'Check for open ports',
              severity: 'high',
              file: resource.file,
              prompt: `Audit the security group "${resource.name}" in ${resource.file}. Check for overly permissive ingress rules (0.0.0.0/0) on sensitive ports.`
            })
          }
          
          // IAM policies
          if (resource.type.includes('iam_policy') || resource.type.includes('iam_role')) {
            suggestions.push({
              type: 'security',
              resource: resource.name,
              issue: 'Review IAM permissions',
              fix: 'Verify least privilege',
              severity: 'medium',
              file: resource.file,
              prompt: `Review the IAM permissions for "${resource.name}" in ${resource.file}. Ensure it follows the principle of least privilege.`
            })
          }

          // Missing tags
          if (resource.type.includes('ec2') || resource.type.includes('rds') || resource.type.includes('s3')) {
            if (!resource.attrs?.tags) {
              suggestions.push({
                type: 'tags',
                resource: resource.name,
                issue: 'Missing required tags',
                fix: 'Add environment, owner tags',
                severity: 'low',
                file: resource.file,
                prompt: `Add required tags (environment, owner, cost-center, project) to "${resource.name}" in ${resource.file}.`
              })
            }
          }
        })
        
        // Sort by severity: critical > high > medium > low
        const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
        const sortedSuggestions = suggestions.sort((a, b) => 
          (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4)
        )
        const limitedSuggestions = sortedSuggestions.slice(0, 10) // Show up to 10 suggestions
        console.log('✅ [ChatPanel] Found', limitedSuggestions.length, 'suggestions:', limitedSuggestions)
        setSecuritySuggestions(limitedSuggestions)
        onHasSuggestionsChange?.(limitedSuggestions.length > 0)
      } catch (error) {
        console.error('Failed to fetch suggestions:', error)
        setSecuritySuggestions([])
        onHasSuggestionsChange?.(false)
      }
    }

    fetchSuggestions()
  }, [selectedRepo, token, onHasSuggestionsChange])

  // Expose addMessage function through ref
  useEffect(() => {
    if (onAddMessageRef) {
      onAddMessageRef.current = (message: Message) => {
        setMessages(prev => [...prev, message])
        // Auto-scroll to bottom
        setTimeout(() => {
          if (chatMessagesRef.current) {
            chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight
          }
        }, 100)
      }
    }
  }, [onAddMessageRef])

  // Auto-resize textarea based on content
  const adjustTextareaHeight = () => {
    const textarea = inputRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }

  useEffect(() => {
    adjustTextareaHeight()
  }, [input])

  useEffect(() => {
    // Only auto-scroll if user hasn't scrolled up
    if (!isScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isScrolledUp])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Focus input without scrolling
      inputRef.current.focus({ preventScroll: true })
    }
  }, [isOpen])

  // Handle scroll detection for showing scrollbar only on manual scroll
  useEffect(() => {
    const chatMessages = chatMessagesRef.current
    if (!chatMessages) return

    const handleScroll = (e: Event) => {
      // Only show scrollbar on manual user scroll (not programmatic)
      setIsUserScrolling(true)
      
      // Check if user has scrolled up (not at bottom)
      const threshold = 50 // pixels from bottom (small threshold for easy control)
      const isAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < threshold
      setIsScrolledUp(!isAtBottom)
      
      // Hide scrollbar after user stops scrolling
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      scrollTimeoutRef.current = setTimeout(() => {
        setIsUserScrolling(false)
      }, 1000) // Hide after 1 second of no scrolling
    }

    chatMessages.addEventListener('wheel', handleScroll, { passive: true })
    chatMessages.addEventListener('touchmove', handleScroll, { passive: true })
    chatMessages.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      chatMessages.removeEventListener('wheel', handleScroll)
      chatMessages.removeEventListener('touchmove', handleScroll)
      chatMessages.removeEventListener('scroll', handleScroll)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  // Handle resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || isMaximized) return
      // Calculate new width from right edge of screen
      const newWidth = window.innerWidth - e.clientX
      // Min width 300px, max width 1000px (same as left sidebar)
      setPanelWidth(Math.min(Math.max(300, newWidth), 1000))
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
  }, [isResizing, isMaximized])

  // Check if current query is from import
  useEffect(() => {
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()
    if (lastUserMessage && lastUserMessage.content.includes('Generate Terraform code for these imported AWS resources')) {
      setIsImportQuery(true)
      setGenerationProgress(0)
    } else {
      setIsImportQuery(false)
    }
  }, [messages, isStreaming])
  
  // Dynamic streaming messages that rotate (for both Ask and Agent modes, until content starts)
  useEffect(() => {
    if (!isStreaming || isImportQuery) {
      if (!isStreaming) {
        setIsImportQuery(false)
        setGenerationProgress(0)
      }
      return
    }
    
    // Check if content has started - if so, stop rotating messages
    const lastMessage = messages[messages.length - 1]
    const hasContent = lastMessage?.role === 'assistant' && lastMessage?.content && lastMessage.content.trim().length > 0
    if (hasContent) {
      setStreamingMessage('')
      return
    }
    
    const messageList = mode === 'agent' ? [
      'Analyzing your request',
      'Scanning repository structure',
      'Identifying dependencies',
      'Planning infrastructure',
      'Consulting cloud best practices',
      'Optimizing resource layout',
      'Generating Terraform code',
      'Configuring security groups',
      'Setting up networking',
      'Preparing documentation',
      'Almost there',
    ] : [
      'Thinking...',
      'Analyzing your question...',
      'Consulting documentation...',
      'Preparing answer...',
    ]
    
    let index = 0
    const interval = setInterval(() => {
      // Re-check if content has started
      const currentLastMessage = messages[messages.length - 1]
      const currentHasContent = currentLastMessage?.role === 'assistant' && currentLastMessage?.content && currentLastMessage.content.trim().length > 0
      if (currentHasContent) {
        setStreamingMessage('')
        clearInterval(interval)
        return
      }
      
      index = (index + 1) % messageList.length
      setStreamingMessage(messageList[index])
    }, 2500) // Change message every 2.5 seconds
    
    return () => clearInterval(interval)
  }, [isStreaming, isImportQuery, mode, messages])
  
  // Progress bar animation for import queries
  useEffect(() => {
    if (!isStreaming || !isImportQuery) return
    
    // Simulate progress (slowly increases, will complete when streaming finishes)
    const progressInterval = setInterval(() => {
      setGenerationProgress(prev => {
        // Don't update if already at 100% (completed)
        if (prev >= 100) return 100
        // Slowly increase progress, but cap at 85% until streaming completes
        // Lower cap so it's clearer when actual progress happens
        if (prev < 85) {
          return Math.min(prev + Math.random() * 1.5, 85)
        }
        return prev
      })
    }, 400)
    
    return () => clearInterval(progressInterval)
  }, [isStreaming, isImportQuery])
  
  // Track unique file proposals to avoid double-counting
  const seenFileProposalsRef = useRef<Set<string>>(new Set())
  // Track total files expected from status messages
  const totalFilesRef = useRef<number | null>(null)
  
  // Parse status messages to extract total file count
  useEffect(() => {
    if (!isImportQuery || !isStreaming) return
    
    // Look through all messages for status messages that contain file counts
    messages.forEach(msg => {
      if (msg.content) {
        // Look for patterns like "5 resources • 6 files" or "X files"
        const fileCountMatch = msg.content.match(/(\d+)\s+files?/i)
        if (fileCountMatch) {
          const totalFiles = parseInt(fileCountMatch[1], 10)
          if (totalFiles > 0 && (!totalFilesRef.current || totalFiles > totalFilesRef.current)) {
            totalFilesRef.current = totalFiles
            console.log(`📊 [ChatPanel] Detected total files from status: ${totalFiles}`)
          }
        }
      }
    })
  }, [messages, isImportQuery, isStreaming])
  
  // Update progress based on actual streaming content and file proposals
  useEffect(() => {
    if (!isImportQuery || !isStreaming) {
      // Reset seen files when not streaming
      seenFileProposalsRef.current = new Set()
      totalFilesRef.current = null
      return
    }
    
    const lastMessage = messages[messages.length - 1]
    if (lastMessage) {
      // Collect all unique file proposals from all messages
      const allFilePaths = new Set<string>()
      messages.forEach(msg => {
        if (msg.fileProposal?.path) {
          allFilePaths.add(msg.fileProposal.path)
        }
        // Also check streamingCode for file paths
        if (msg.streamingCode) {
          msg.streamingCode.forEach(block => {
            if (block.path) {
              allFilePaths.add(block.path)
            }
          })
        }
      })
      
      // Update seen files ref
      allFilePaths.forEach(path => {
        seenFileProposalsRef.current.add(path)
      })
      
      const filesGenerated = allFilePaths.size
      const totalFiles = totalFilesRef.current
      
      setGenerationProgress(prev => {
        // Don't update if already at 100% (completed)
        if (prev >= 100) return 100
        
        let newProgress = prev
        
        // If we know the total files, calculate accurate progress
        if (totalFiles && totalFiles > 0) {
          // Calculate progress: (filesGenerated / totalFiles) * 100%
          const fileProgress = Math.min((filesGenerated / totalFiles) * 100, 100)
          newProgress = Math.max(newProgress, fileProgress)
          console.log(`📊 [ChatPanel] Progress: ${filesGenerated}/${totalFiles} files = ${fileProgress.toFixed(1)}%`)
        } else {
          // Fallback: if we don't know total yet, use a conservative estimate
          // Assume at least the files we've seen so far, with some buffer
          const estimatedTotal = Math.max(filesGenerated, 6) // Default to 6 if unknown
          const fileProgress = Math.min((filesGenerated / estimatedTotal) * 100, 100)
          newProgress = Math.max(newProgress, fileProgress)
        }
        
        // Small boost for content length (only if we don't have file count yet)
        if (!totalFiles && lastMessage.content) {
          const contentLength = lastMessage.content.length
          const contentProgress = Math.min((contentLength / 10000) * 10, 10)
          newProgress = Math.max(newProgress, contentProgress)
        }
        
        // Ensure progress only increases and cap at 100%
        return Math.min(Math.max(newProgress, prev), 100)
      })
    }
  }, [messages, isImportQuery, isStreaming])
  
  // Reset progress when streaming completes
  useEffect(() => {
    if (!isStreaming && isImportQuery) {
      setGenerationProgress(100)
      setTimeout(() => {
        setIsImportQuery(false)
        setGenerationProgress(0)
      }, 1500)
    }
  }, [isStreaming, isImportQuery])

  // Auto-send message when triggered from import modal
  useEffect(() => {
    if (isOpen && selectedRepo && !isStreaming) {
      const autoSend = sessionStorage.getItem('auto_send_chat_message')
      const importPrompt = sessionStorage.getItem('import_generation_prompt')
      
      if (autoSend === 'true' && importPrompt) {
        sessionStorage.removeItem('auto_send_chat_message')
        sessionStorage.removeItem('import_generation_prompt')
        
        // Set the input and mode, then trigger send
        setInput(importPrompt)
        const importMode = sessionStorage.getItem('import_generation_mode') || 'agent'
        if (importMode !== mode) {
          setMode(importMode as 'ask' | 'agent' | 'team')
        }
        
        // Auto-send after a brief delay to ensure state is set
        setTimeout(() => {
          if (importPrompt.trim() && !isStreaming) {
            handleSendProgrammatically(importPrompt, importMode as 'ask' | 'agent' | 'team')
          }
        }, 200)
      }
    }
  }, [isOpen, selectedRepo, isStreaming, mode])

  const handleSendProgrammatically = async (promptText: string, promptMode: 'ask' | 'agent' | 'team') => {
    if (!promptText.trim() || isStreaming) return

    // Validate that a repo is selected for Agent mode
    if (promptMode === 'agent' && !selectedRepo) {
      console.warn('⚠️ [ChatPanel] Agent mode requires a repository to be selected')
      return
    }

    // Clear stale staging files before starting a new agent generation
    if (promptMode === 'agent' && onClearStaging) {
      console.log('🧹 [ChatPanel] Clearing stale staging files before new generation...')
      await onClearStaging()
    }

    // Check if this is an import query (from import modal)
    const isImportQueryCheck = promptText.includes('Generate Terraform code for these imported AWS resources') ||
                               promptText.includes('Generate Terraform code for these imported') ||
                               sessionStorage.getItem('import_generation_prompt') !== null
    
    if (isImportQueryCheck) {
      setIsImportQuery(true)
      setGenerationProgress(0)
      seenFileProposalsRef.current = new Set() // Reset seen files for new import query
      totalFilesRef.current = null // Reset total files count
      console.log('📦 [ChatPanel] Detected import query - enabling progress bar')
    }

    console.log('📤 [ChatPanel] Auto-sending prompt:', {
      prompt: promptText.trim(),
      mode: promptMode,
      selectedRepo: selectedRepo?.full_name,
      isImportQuery: isImportQueryCheck
    })

    const userMessage: Message = {
      role: 'user',
      content: promptText,
      mode: promptMode
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsStreaming(true)
    setIsSending(true)
    setHasAutoShownGame(false) // Reset auto-show flag for new generation
    
    // Auto-show mini-game in agent mode after a short delay
    if (promptMode === 'agent' && !showMiniGame) {
      setTimeout(() => {
        if (isStreaming && !hasAutoShownGame) {
          setShowMiniGame(true)
          setHasAutoShownGame(true)
        }
      }, 2000) // Show game after 2 seconds of generation
    }
    
    // Broadcast that we're generating (only in agent mode in a team)
    if (promptMode === 'agent' && currentTeamId && onActivityStatusChange) {
      onActivityStatusChange('generating')
    }
    
    // Reset animation after a short delay
    setTimeout(() => setIsSending(false), 600)

    try {
      // Add placeholder message for streaming
      const placeholderMessage: Message = {
        role: 'assistant',
        content: '',
        mode: promptMode,
        streaming: true
      }
      setMessages(prev => [...prev, placeholderMessage])

      // Get workspace path for agent mode
      let workspacePath: string | undefined = undefined
      if (promptMode === 'agent' && selectedRepo) {
        const [owner, repo] = selectedRepo.full_name.split('/')
        console.log('🖥️ [ChatPanel] handleSendProgrammatically - Getting workspace path for:', owner, repo)
        workspacePath = (await getWorkspacePath(owner, repo)) ?? undefined
        console.log('🖥️ [ChatPanel] handleSendProgrammatically - Workspace path:', workspacePath)
      }

      // Get existing files for context (only in agent mode)
      // This will be handled by the backend, so we don't need to fetch here
      let existingFiles: string[] = []
      
      // Call backend stream via proxy
      const chatEndpoint = getApiEndpoint('/chat/stream')
      console.log('📤 [ChatPanel] handleSendProgrammatically - Making request to:', chatEndpoint, {
        hasToken: !!token,
        mode: promptMode,
        promptLength: promptText.length,
        isImportQuery,
        workspacePath
      })
      
      console.log('⏳ [ChatPanel] handleSendProgrammatically - Starting fetch request...')
      const fetchStartTime = Date.now()
      
      let response: Response
      try {
        response = await fetch(chatEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            prompt: promptText,
            mode: promptMode,
            ...(provider && { provider }),
            ...((promptMode === 'ask' || promptMode === 'agent') && { cloud_provider: cloudProvider }),
            workspace_path: workspacePath || undefined,
            existing_files: existingFiles,
            context: selectedRepo ? {
              owner: selectedRepo.full_name.split('/')[0],
              repo: selectedRepo.full_name.split('/')[1]
            } : undefined,
            history: promptMode === 'ask' ? messages.slice(-10).map(msg => ({
              role: msg.role,
              content: msg.content
            })) : []
          })
        })
        
        const fetchDuration = Date.now() - fetchStartTime
        console.log(`✅ [ChatPanel] handleSendProgrammatically - Fetch completed in ${fetchDuration}ms, status: ${response.status}`)
      } catch (fetchError: any) {
        console.error('❌ [ChatPanel] handleSendProgrammatically - Fetch failed:', fetchError)
        throw new Error(`Failed to connect to server: ${fetchError.message || 'Network error'}`)
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ [ChatPanel] handleSendProgrammatically - Response not OK:', response.status, response.statusText, errorText)
        throw new Error(`Failed to get response: ${response.status} ${response.statusText}`)
      }

      console.log('✅ [ChatPanel] handleSendProgrammatically - Response OK, starting SSE stream read...')

      // Read SSE stream
      const reader = response.body?.getReader()
      if (!reader) {
        console.error('❌ [ChatPanel] handleSendProgrammatically - No reader available - response.body is null')
        throw new Error('No response body reader available')
      }
      
      console.log('✅ [ChatPanel] handleSendProgrammatically - Reader obtained, starting to read chunks...')
      const decoder = new TextDecoder()
      let accumulatedContent = ''
      let currentStatus = ''
      let chunkCount = 0
      let buffer = ''
      // Capture import query flag for use in SSE handlers
      const isImportQueryFlag = isImportQueryCheck

      if (reader) {
        let hasReceivedContent = false
        let streamComplete = false
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            console.log('✅ [ChatPanel] handleSendProgrammatically - Stream complete (done=true)')
            break
          }

          chunkCount++
          const chunk = decoder.decode(value, { stream: true })
          buffer += chunk
          
          // Split by newlines, but keep the last incomplete line in buffer
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          
          console.log(`📥 [ChatPanel] handleSendProgrammatically - SSE chunk #${chunkCount} received: ${lines.length} complete lines, buffer length: ${buffer.length}`)
          
          if (lines.length === 0 && chunkCount === 1) {
            console.log('⚠️ [ChatPanel] handleSendProgrammatically - First chunk has no complete lines, raw chunk preview:', chunk.substring(0, 100))
          }

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                console.log('📨 [ChatPanel] handleSendProgrammatically - Parsed SSE data:', data.type, data)
                
                // Special logging for import queries
                if (isImportQuery) {
                  console.log('📊 [ImportQuery] handleSendProgrammatically - SSE event received:', data.type)
                }
                
                if (data.type === 'status') {
                  // Update current status message
                  console.log('Status:', data.message)
                  currentStatus = data.message
                  
                  // Extract total file count from status message (e.g., "5 resources • 6 files")
                  if (isImportQueryFlag && data.message) {
                    const fileCountMatch = data.message.match(/(\d+)\s+files?/i)
                    if (fileCountMatch) {
                      const totalFiles = parseInt(fileCountMatch[1], 10)
                      if (totalFiles > 0 && (!totalFilesRef.current || totalFiles > totalFilesRef.current)) {
                        totalFilesRef.current = totalFiles
                        console.log(`📊 [ChatPanel] handleSendProgrammatically - Detected total files from status: ${totalFiles}`)
                      }
                    }
                  }
                  
                  // Display status above the content
                  setMessages(prev => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      content: `_${currentStatus}_\n\n${accumulatedContent}`,
                      streaming: true
                    }
                    return updated
                  })
                } else if (data.type === 'file_proposal') {
                  // File proposal received - open diff editor IMMEDIATELY!
                  console.log('📦 [ChatPanel] handleSendProgrammatically - File proposal received:', {
                    path: data.file_proposal.path,
                    action: data.file_proposal.action,
                    hasOldContent: !!data.file_proposal.oldContent,
                    oldContentLength: data.file_proposal.oldContent?.length || 0,
                    newContentLength: data.file_proposal.newContent?.length || 0,
                    newContentPreview: data.file_proposal.newContent?.substring(0, 100) || '(empty)'
                  })
                  
                  // FIRST: Attach file proposal to message so it shows in chat immediately
                  setMessages(prev => {
                    const updated = [...prev]
                    const lastMsg = updated[updated.length - 1]
                    const isDifferentFile = !lastMsg.fileProposal || lastMsg.fileProposal.path !== data.file_proposal.path
                    const shouldUpdate = !lastMsg.fileProposal || 
                                       !lastMsg.proposalAccepted || 
                                       isDifferentFile
                    
                    if (shouldUpdate) {
                      updated[updated.length - 1] = {
                        ...lastMsg,
                        fileProposal: data.file_proposal,
                        proposalAccepted: false // Reset acceptance status for new proposal
                      }
                      console.log('📦 [ChatPanel] handleSendProgrammatically - Updated message fileProposal:', data.file_proposal.path)
                    } else {
                      console.log('📦 [ChatPanel] handleSendProgrammatically - Skipping fileProposal update - last message already has accepted proposal for same file:', data.file_proposal.path)
                    }
                    return updated
                  })
                  
                  // THEN: Open in editor if callback exists
                  if (onFileProposal) {
                    console.log('📦 [ChatPanel] handleSendProgrammatically - Calling onFileProposal callback')
                    // Pass a callback to mark this proposal as accepted when Keep is clicked
                    await onFileProposal(data.file_proposal, () => {
                      console.log('📦 [ChatPanel] handleSendProgrammatically - Proposal accepted callback fired')
                      setMessages(prev => {
                        const updated = [...prev]
                        const lastIndex = updated.length - 1
                        updated[lastIndex] = {
                          ...updated[lastIndex],
                          proposalAccepted: true,
                          appliedFilePath: data.file_proposal.path
                        }
                        return updated
                      })
                    })
                  } else {
                    console.warn('📦 [ChatPanel] handleSendProgrammatically - onFileProposal callback is null!')
                  }
                  
                  // Track this file for potential cleanup on validation failure
                  if (data.file_proposal?.path) {
                    setFilesOpenedFromDiff(prev => new Set(prev).add(data.file_proposal.path))
                    console.log(`📋 [ChatPanel] handleSendProgrammatically - Tracking file for cleanup: ${data.file_proposal.path}`)
                  }
                } else if (data.type === 'streaming_code') {
                  // NEW: Handle streaming code blocks
                  console.log('📝 [ChatPanel] handleSendProgrammatically - Streaming code block received:', data.file_path, 'complete:', data.complete)
                  setMessages(prev => {
                    const updated = [...prev]
                    const lastMsg = updated[updated.length - 1]
                    const existingCode = lastMsg.streamingCode || []
                    
                    // Find or create the code block for this file
                    const fileIndex = existingCode.findIndex(block => block.path === data.file_path)
                    const newCodeBlocks = [...existingCode]
                    
                    if (fileIndex >= 0) {
                      // Update existing block
                      newCodeBlocks[fileIndex] = {
                        path: data.file_path,
                        content: data.content,
                        complete: data.complete || false
                      }
                    } else {
                      // Add new block
                      newCodeBlocks.push({
                        path: data.file_path,
                        content: data.content,
                        complete: data.complete || false
                      })
                    }
                    
                    updated[updated.length - 1] = {
                      ...lastMsg,
                      streamingCode: newCodeBlocks
                    }
                    return updated
                  })
                } else if (data.type === 'token') {
                  // Append token to message
                  accumulatedContent += data.content
                  
                  // Hide "Thinking..." once first token arrives
                  if (!hasReceivedContent && accumulatedContent.trim()) {
                    hasReceivedContent = true
                    // Keep streaming true so we can see streaming content and file proposals
                    // Don't set to false here - let it complete naturally
                    // Clear the status once content starts appearing
                    currentStatus = ''
                  }
                  
                  setMessages(prev => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      content: currentStatus ? `_${currentStatus}_\n\n${accumulatedContent}` : accumulatedContent,
                      streaming: true // Mark as still streaming
                    }
                    return updated
                  })
                } else if (data.type === 'complete') {
                  streamComplete = true
                  
                  // Complete progress bar immediately for import queries
                  if (isImportQuery) {
                    console.log('✅ [ChatPanel] handleSend - Complete event received - setting progress to 100%')
                    setGenerationProgress(100)
                  }
                  
                  // Keep accumulated content and append completion message
                  setMessages(prev => {
                    const updated = [...prev]
                    const currentMessage = updated[updated.length - 1]
                    const currentContent = currentMessage.content
                    updated[updated.length - 1] = {
                      ...currentMessage,
                      content: currentContent + (data.message ? `\n\n${data.message}` : ''),
                      streaming: false, // Mark as complete
                      // CRITICAL: Only update fileProposal if present in complete event, otherwise preserve existing
                      fileProposal: data.file_proposal || currentMessage.fileProposal,
                      modeSuggestion: data.mode_suggestion || currentMessage.modeSuggestion
                    }
                    return updated
                  })
                  
                  break
                } else if (data.type === 'error') {
                  // Show error in chat
                  console.error('Error from backend:', data.message)
                  setMessages(prev => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      content: `⚠️ Error: ${data.message}`,
                      streaming: false
                    }
                    return updated
                  })
                  break
                }
              } catch (e) {
                // Ignore JSON parse errors
              }
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Chat error:', error)
      setMessages(prev => {
        const updated = [...prev]
        const lastMsg = updated[updated.length - 1]
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.streaming = false
          lastMsg.content = `Error: ${error.message || 'Failed to get response'}`
        }
        return updated
      })
      setIsStreaming(false)
      setStreamingMessage('')
      
      if (promptMode === 'agent' && currentTeamId && onActivityStatusChange) {
        onActivityStatusChange('idle')
      }
    }
  }

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return

    // Validate that a repo is selected for Agent mode
    if (mode === 'agent' && !selectedRepo) {
      console.warn('⚠️ [ChatPanel] Agent mode requires a repository to be selected')
      
      // Show error message in chat
      const errorMessage: Message = {
        role: 'assistant',
        content: '⚠️ **Please select a repository first**\n\nAgent mode requires an active repository to create infrastructure files. Use the repository selector in the top-left to choose a repo.',
        mode: 'ask'
      }
      setMessages(prev => [...prev, errorMessage])
      return
    }

    // Clear stale staging files before starting a new agent generation
    if (mode === 'agent' && onClearStaging) {
      console.log('🧹 [ChatPanel] Clearing stale staging files before new generation...')
      await onClearStaging()
    }

    console.log('📤 [ChatPanel] Starting prompt request:', {
      input: input.trim(),
      mode,
      selectedRepo: selectedRepo?.full_name,
      isDesktop
    })

    const userMessage: Message = {
      role: 'user',
      content: input,
      mode
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsStreaming(true)
    setIsSending(true) // Trigger animation
    setHasAutoShownGame(false) // Reset auto-show flag for new generation
    
    // Auto-show mini-game in agent mode after a short delay
    if (mode === 'agent' && !showMiniGame) {
      setTimeout(() => {
        if (isStreaming && !hasAutoShownGame) {
          setShowMiniGame(true)
          setHasAutoShownGame(true)
        }
      }, 2000) // Show game after 2 seconds of generation
    }
    
    // Broadcast that we're generating (only in agent mode in a team)
    if (mode === 'agent' && currentTeamId && onActivityStatusChange) {
      onActivityStatusChange('generating')
    }
    
    // Reset animation after a short delay
    setTimeout(() => setIsSending(false), 600)

    try {
      // Add placeholder message for streaming
      const placeholderMessage: Message = {
        role: 'assistant',
        content: '',
        mode
      }
      setMessages(prev => [...prev, placeholderMessage])
      
      // Get list of existing .tf files in workspace
      let existingFiles: string[] = []
      let workspacePath: string | null = null
      
      if (selectedRepo && mode === 'agent') {
        try {
          const [owner, repo] = selectedRepo.full_name.split('/')
          
          // DESKTOP: Get local workspace path
          if (isDesktop) {
            workspacePath = await getWorkspacePath(owner, repo)
            console.log('🖥️  Desktop workspace path:', workspacePath)
          }
          
          // Get existing .tf files (Desktop: via Electron IPC)
          if (isDesktop) {
            const { getFileTree } = await import('@/utils/desktopBridge')
            const treeResult = await getFileTree(owner, repo, '')
            
            if (treeResult.success && treeResult.items) {
              existingFiles = treeResult.items
                .filter((item: any) => item.type === 'file' && item.name.endsWith('.tf'))
                .map((item: any) => item.name)
            }
          }
        } catch (e) {
          console.warn('Failed to get existing files:', e)
        }
      }
      
      // Check if initial indexing is needed (first time repo selection only)
      // Note: Updates now happen when files are accepted, not on every chat message
      if (selectedRepo && isDesktop) {
        try {
          const [owner, repo] = selectedRepo.full_name.split('/')
          
          // Only check for initial indexing (first time)
          const lastHashesKey = `codebase_hashes_${owner}_${repo}`
          const lastHashes = JSON.parse(localStorage.getItem(lastHashesKey) || '{}')
          
          if (Object.keys(lastHashes).length === 0) {
            // First time - check if there are any .tf files before indexing
            const indexStatusKey = `codebase_indexed_${owner}_${repo}`
            const alreadyIndexed = localStorage.getItem(indexStatusKey)
            
            if (!alreadyIndexed && !indexCodebaseMutation.isPending) {
              // Quick check: count .tf files before attempting index
              if (existingFiles.length === 0) {
                console.log('⏭️  [ChatPanel] No .tf files found, skipping initial codebase indexing')
                // Mark as "indexed" (empty) so we don't keep checking
                localStorage.setItem(indexStatusKey, 'empty')
                localStorage.setItem(lastHashesKey, JSON.stringify({}))
              } else {
                // Has .tf files - proceed with indexing
                indexCodebaseMutation.mutate(
                  { owner, repo },
                  {
                    onSuccess: () => {
                      // Store initial hashes (simplified - would need to read all files)
                      localStorage.setItem(lastHashesKey, JSON.stringify({}))
                      localStorage.setItem(indexStatusKey, 'indexed')
                      console.log('✅ [ChatPanel] Codebase indexed successfully')
                    },
                    onError: (error: Error) => {
                      console.error('❌ [ChatPanel] Codebase indexing failed:', error.message)
                      // Don't block chat if indexing fails
                    }
                  }
                )
              }
            }
          }
        } catch (error) {
          console.error('Error indexing codebase:', error)
          // Don't block chat if indexing fails
        }
      }
      
      // Call backend stream via proxy
      const chatEndpoint = getApiEndpoint('/chat/stream')
      console.log('📤 [ChatPanel] Making request to:', chatEndpoint, {
        hasToken: !!token,
        tokenLength: token?.length || 0,
        tokenPreview: token ? `${token.substring(0, 10)}...` : 'none',
        mode,
        provider,
        promptLength: input.length,
        isImportQuery
      })
      
      console.log('⏳ [ChatPanel] Starting fetch request...')
      const fetchStartTime = Date.now()
      
      let response: Response
      try {
        response = await fetch(chatEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          prompt: input,
          mode: mode,
          ...(provider && { provider }), // Only include provider if it's set
          ...((mode === 'ask' || mode === 'agent') && { cloud_provider: cloudProvider }), // Cloud provider for both ask and agent modes
          workspace_path: workspacePath || undefined, // Use desktop path if available
          existing_files: existingFiles, // Tell backend which files exist
          context: selectedRepo ? {
            owner: selectedRepo.full_name.split('/')[0],
            repo: selectedRepo.full_name.split('/')[1]
          } : undefined,
          history: mode === 'ask' ? messages.slice(-10).map(msg => ({
            role: msg.role,
            content: msg.content
          })) : [] // AGENT mode: NO history (each query is isolated)
        })
      })

      const fetchDuration = Date.now() - fetchStartTime
      console.log(`✅ [ChatPanel] Fetch completed in ${fetchDuration}ms, status: ${response.status}`)
    } catch (fetchError: any) {
        console.error('❌ [ChatPanel] Fetch failed:', fetchError)
        throw new Error(`Failed to connect to server: ${fetchError.message || 'Network error'}`)
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ [ChatPanel] Response not OK:', response.status, response.statusText, errorText)
        throw new Error(`Failed to get response: ${response.status} ${response.statusText}`)
      }

      console.log('✅ [ChatPanel] Response OK, starting SSE stream read...')

      // Read SSE stream
      const reader = response.body?.getReader()
      if (!reader) {
        console.error('❌ [ChatPanel] No reader available - response.body is null')
        throw new Error('No response body reader available')
      }
      
      console.log('✅ [ChatPanel] Reader obtained, starting to read chunks...')
      const decoder = new TextDecoder()
      let accumulatedContent = ''
      let currentStatus = ''
      let chunkCount = 0

      if (reader) {
        let hasReceivedContent = false
        let streamComplete = false
        let buffer = '' // Buffer for incomplete lines
        
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            console.log('✅ [ChatPanel] Stream complete (done=true)')
            streamComplete = true
            break
          }

          chunkCount++
          const chunk = decoder.decode(value, { stream: true })
          buffer += chunk
          
          // Split by newlines, but keep the last incomplete line in buffer
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // Keep incomplete line for next chunk
          
          console.log(`📥 [ChatPanel] SSE chunk #${chunkCount} received: ${lines.length} complete lines, buffer length: ${buffer.length}`)
          
          if (lines.length === 0 && chunkCount === 1) {
            console.log('⚠️ [ChatPanel] First chunk has no complete lines, raw chunk preview:', chunk.substring(0, 100))
          }

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                console.log('📨 [ChatPanel] Parsed SSE data:', data.type, data)
                
                // Special logging for import queries
                if (isImportQuery) {
                  console.log('📊 [ImportQuery] SSE event received:', data.type)
                }
                
                if (data.type === 'status') {
                  // Update current status message
                  console.log('Status:', data.message)
                  currentStatus = data.message
                  
                  // Extract total file count from status message (e.g., "5 resources • 6 files")
                  if (isImportQuery && data.message) {
                    const fileCountMatch = data.message.match(/(\d+)\s+files?/i)
                    if (fileCountMatch) {
                      const totalFiles = parseInt(fileCountMatch[1], 10)
                      if (totalFiles > 0 && (!totalFilesRef.current || totalFiles > totalFilesRef.current)) {
                        totalFilesRef.current = totalFiles
                        console.log(`📊 [ChatPanel] handleSend - Detected total files from status: ${totalFiles}`)
                      }
                    }
                  }
                  
                  // Display status above the content
                  setMessages(prev => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      content: `_${currentStatus}_\n\n${accumulatedContent}`,
                      streaming: true
                    }
                    return updated
                  })
                } else if (data.type === 'file_proposal') {
                  // File proposal received - open diff editor IMMEDIATELY!
                  console.log('📦 [ChatPanel] File proposal received:', {
                    path: data.file_proposal.path,
                    action: data.file_proposal.action,
                    hasOldContent: !!data.file_proposal.oldContent,
                    oldContentLength: data.file_proposal.oldContent?.length || 0,
                    newContentLength: data.file_proposal.newContent?.length || 0,
                    newContentPreview: data.file_proposal.newContent?.substring(0, 100) || '(empty)'
                  })
                  
                  if (onFileProposal) {
                    console.log('📦 [ChatPanel] Calling onFileProposal callback')
                    // Pass a callback to mark this proposal as accepted when Keep is clicked
                    await onFileProposal(data.file_proposal, () => {
                      console.log('📦 [ChatPanel] Proposal accepted callback fired')
                      setMessages(prev => {
                        const updated = [...prev]
                        const lastIndex = updated.length - 1
                        updated[lastIndex] = {
                          ...updated[lastIndex],
                          proposalAccepted: true,
                          appliedFilePath: data.file_proposal.path
                        }
                        return updated
                      })
                    })
                  } else {
                    console.warn('📦 [ChatPanel] onFileProposal callback is null!')
                  }
                  // Also store it in the message for the Keep/Undo buttons
                  // BUT: Only update if the last message doesn't already have an accepted proposal for THIS file
                  // This prevents new proposals from overwriting accepted ones in the chat diff view
                  setMessages(prev => {
                    const updated = [...prev]
                    const lastMsg = updated[updated.length - 1]
                    
                    // Only update fileProposal if:
                    // 1. Last message doesn't have a fileProposal yet, OR
                    // 2. Last message's fileProposal hasn't been accepted yet, OR
                    // 3. This is a different file path (new proposal for different file)
                    const isDifferentFile = lastMsg.fileProposal && lastMsg.fileProposal.path !== data.file_proposal.path
                    const shouldUpdate = !lastMsg.fileProposal || 
                                       !lastMsg.proposalAccepted || 
                                       isDifferentFile
                    
                    if (shouldUpdate) {
                      updated[updated.length - 1] = {
                        ...lastMsg,
                        fileProposal: data.file_proposal,
                        proposalAccepted: false // Reset acceptance status for new proposal
                      }
                      console.log('📦 [ChatPanel] Updated message fileProposal:', data.file_proposal.path)
                    } else {
                      console.log('📦 [ChatPanel] Skipping fileProposal update - last message already has accepted proposal for same file:', data.file_proposal.path)
                    }
                    return updated
                  })
                  
                  // Track this file for potential cleanup on validation failure
                  if (data.file_proposal?.path) {
                    setFilesOpenedFromDiff(prev => new Set(prev).add(data.file_proposal.path))
                    console.log(`📋 [ChatPanel] Tracking file for cleanup: ${data.file_proposal.path}`)
                  }
                } else if (data.type === 'streaming_code') {
                  // NEW: Handle streaming code blocks
                  console.log('📝 [ChatPanel] Streaming code block received:', data.file_path, 'complete:', data.complete)
                  setMessages(prev => {
                    const updated = [...prev]
                    const lastMsg = updated[updated.length - 1]
                    const existingCode = lastMsg.streamingCode || []
                    
                    // Find or create the code block for this file
                    const fileIndex = existingCode.findIndex(block => block.path === data.file_path)
                    const newCodeBlocks = [...existingCode]
                    
                    if (fileIndex >= 0) {
                      // Update existing block
                      newCodeBlocks[fileIndex] = {
                        path: data.file_path,
                        content: data.content,
                        complete: data.complete || false
                      }
                    } else {
                      // Add new block
                      newCodeBlocks.push({
                        path: data.file_path,
                        content: data.content,
                        complete: data.complete || false
                      })
                    }
                    
                    updated[updated.length - 1] = {
                      ...lastMsg,
                      streamingCode: newCodeBlocks
                    }
                    return updated
                  })
                } else if (data.type === 'token') {
                  // Append token to message
                  accumulatedContent += data.content
                  
                  // Hide "Thinking..." once first token arrives
                  if (!hasReceivedContent && accumulatedContent.trim()) {
                    hasReceivedContent = true
                    // Keep isStreaming true so we can see streaming content and file proposals
                    // Don't set to false here - let it complete naturally
                    // Clear the status once content starts appearing
                    currentStatus = ''
                  }
                  
                  setMessages(prev => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      content: currentStatus ? `_${currentStatus}_\n\n${accumulatedContent}` : accumulatedContent,
                      streaming: true // Mark as still streaming
                    }
                    return updated
                  })
                } else if (data.type === 'complete') {
                  streamComplete = true
                  
                  // Complete progress bar immediately for import queries
                  if (isImportQuery) {
                    console.log('✅ [ChatPanel] handleSend - Complete event received - setting progress to 100%')
                    setGenerationProgress(100)
                  }
                  
                  // 🔥 REMOVED: Duplicate onFileProposal call (already handled by 'file_proposal' event)
                  // File proposals now come as separate streaming events, not in the complete event
                  
                  // Keep accumulated content and append completion message
                  setMessages(prev => {
                    const updated = [...prev]
                    const currentMessage = updated[updated.length - 1]
                    const currentContent = currentMessage.content
                    updated[updated.length - 1] = {
                      ...currentMessage,
                      content: currentContent + (data.message ? `\n\n${data.message}` : ''),
                      streaming: false, // Mark as complete
                      // CRITICAL: Only update fileProposal if present in complete event, otherwise preserve existing
                      fileProposal: data.file_proposal || currentMessage.fileProposal,
                      modeSuggestion: data.mode_suggestion || currentMessage.modeSuggestion
                    }
                    return updated
                  })
                  
                  break
                } else if (data.type === 'error') {
                  // Show error in chat
                  console.error('Error from backend:', data.message)
                  setMessages(prev => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      content: `⚠️ Error: ${data.message}`,
                      streaming: false
                    }
                    return updated
                  })
                  break
                }
              } catch (e) {
                // Skip invalid JSON lines
                console.warn('Failed to parse SSE line:', line)
              }
            }
          }
        }
        
        // Mark final message as complete
        if (streamComplete) {
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              streaming: false
            }
            return updated
          })
        }
      }
    } catch (error) {
      console.error('Chat error:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        mode
      }])
    } finally {
      setIsStreaming(false)
      // Complete progress bar for import queries
      if (isImportQuery) {
        setGenerationProgress(100)
      }
      // Return to idle status when generation is done
      if (currentTeamId && onActivityStatusChange) {
        onActivityStatusChange('idle')
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Don't handle Enter/Arrow keys if dropdown is open (let dropdown handle it)
    if (isModeDropdownOpen && (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape')) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleCopy = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    // Prevent default paste behavior that might cause scrolling
    e.preventDefault()
    
    try {
      const text = await navigator.clipboard.readText()
      const textarea = inputRef.current
      if (textarea) {
        // Insert text at cursor position
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const currentValue = input
        const newValue = currentValue.substring(0, start) + text + currentValue.substring(end)
        
        setInput(newValue)
        
        // Restore cursor position after paste
        setTimeout(() => {
          if (textarea) {
            textarea.selectionStart = textarea.selectionEnd = start + text.length
            textarea.focus({ preventScroll: true })
          }
        }, 0)
      }
    } catch (error) {
      console.error('Failed to paste:', error)
    }
  }

  if (!isOpen) return null

  // Custom markdown components with dynamic sizing
  const markdownComponents: Components = {
    h1: ({ children }) => <h1 style={{ fontSize: `${fontSize + 3}px` }} className="font-semibold mb-2 mt-3">{children}</h1>,
    h2: ({ children }) => <h2 style={{ fontSize: `${fontSize + 2}px` }} className="font-semibold mb-2 mt-3">{children}</h2>,
    h3: ({ children }) => <h3 style={{ fontSize: `${fontSize + 1}px` }} className="font-semibold mb-1 mt-2">{children}</h3>,
    h4: ({ children }) => <h4 style={{ fontSize: `${fontSize}px` }} className="font-semibold mb-1 mt-2">{children}</h4>,
  }

  const increaseFontSize = () => {
    if (fontSize < 20) setFontSize(prev => prev + 1)
  }

  const decreaseFontSize = () => {
    if (fontSize > 10) setFontSize(prev => prev - 1)
  }

  return (
    <div 
      ref={panelRef}
      className={`${
        isMaximized 
          ? 'fixed inset-0 z-[100]' 
          : 'h-full border-l border-[#1a1a1a] relative z-40'
      } bg-[#141414] flex flex-col`}
      style={!isMaximized ? { width: `${panelWidth}px` } : undefined}
    >
      {/* Resize handle - Left edge */}
      {!isMaximized && (
        <div
          className="absolute left-0 top-0 bottom-0 w-[2px] bg-transparent hover:bg-[#4a4a4a] cursor-ew-resize transition-all z-[150]"
          onMouseDown={() => setIsResizing(true)}
        />
      )}
      
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between bg-[#141414]">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[14px]">Chat</span>
          
          {/* AI Provider Toggle - Modern Segmented Control */}
          <div className="relative flex items-center ml-2 bg-gradient-to-b from-[#252525] to-[#1a1a1a] rounded-lg p-0.5 border border-[#3e3e42] shadow-lg">
            {/* Animated sliding background with glow */}
            <div 
              className={`absolute top-0.5 bottom-0.5 rounded-md transition-all duration-500 ease-out ${
                provider === 'claude' 
                  ? 'left-0.5 right-[50%]' 
                  : 'left-[50%] right-0.5'
              }`}
              style={{
                background: provider === 'claude'
                  ? 'linear-gradient(135deg, #007acc 0%, #0098ff 50%, #00d9ff 100%)'
                  : 'linear-gradient(135deg, #a855f7 0%, #d946ef 50%, #ec4899 100%)',
                boxShadow: provider === 'claude' 
                  ? '0 2px 8px rgba(0, 122, 204, 0.4), 0 0 16px rgba(0, 152, 255, 0.2)' 
                  : '0 2px 8px rgba(168, 85, 247, 0.4), 0 0 16px rgba(236, 72, 153, 0.2)',
                transition: 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)'
              }}
            />
            
            {/* Claude Button */}
            <button
              onClick={() => setProvider('claude')}
              className={`relative z-10 px-3 py-1 rounded-md text-[10px] font-semibold transition-all duration-300 flex items-center gap-1 ${
                provider === 'claude' 
                  ? 'text-white scale-[1.02]' 
                  : 'text-gray-500 hover:text-gray-300 scale-100'
              }`}
              title="Claude Opus 4.5"
            >
              <span className={`transition-transform duration-300 text-[12px] ${provider === 'claude' ? 'scale-110' : 'scale-100'}`}>🤖</span>
              <span className="tracking-wide">Claude</span>
            </button>
            
            {/* GPT-5 Button */}
            <button
              onClick={() => setProvider('openai')}
              className={`relative z-10 px-3 py-1 rounded-md text-[10px] font-semibold transition-all duration-300 flex items-center gap-1 ${
                provider === 'openai' 
                  ? 'text-white scale-[1.02]' 
                  : 'text-gray-500 hover:text-gray-300 scale-100'
              }`}
              title="OpenAI GPT-5"
            >
              <span className={`transition-transform duration-300 text-[12px] ${provider === 'openai' ? 'scale-110' : 'scale-100'}`}>✨</span>
              <span className="tracking-wide">GPT-5</span>
            </button>
          </div>
          
          {/* Font Size Controls - left side only in workspace Ask/Agent mode (not team chat) */}
          {currentTeamId && mode !== 'team' && (
            <div className="flex items-center gap-0.5 ml-2">
              <button
                onClick={decreaseFontSize}
                className="p-1 text-[var(--cursor-text-dim)] hover:text-[var(--cursor-text)] transition-colors duration-150"
                title="Decrease text size"
                style={{ border: 'none', outline: 'none', boxShadow: 'none', background: 'transparent', padding: '4px', margin: 0 }}
              >
                <i className="codicon codicon-remove" style={{ fontSize: 13, border: 'none', outline: 'none' }} />
              </button>
              <span className="text-[10px] text-[var(--cursor-text-dim)] min-w-[20px] text-center">{fontSize}</span>
              <button
                onClick={increaseFontSize}
                className="p-1 text-[var(--cursor-text-dim)] hover:text-[var(--cursor-text)] transition-colors duration-150"
                title="Increase text size"
                style={{ border: 'none', outline: 'none', boxShadow: 'none', background: 'transparent', padding: '4px', margin: 0 }}
              >
                <i className="codicon codicon-add" style={{ fontSize: 13, border: 'none', outline: 'none' }} />
              </button>
            </div>
          )}
        </div>
        
        {/* Right side controls */}
        <div className="flex items-center gap-2">
          {/* Font Size Controls - right side when NOT in workspace OR when in team chat */}
          {(!currentTeamId || mode === 'team') && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={decreaseFontSize}
                className="p-1 text-[var(--cursor-text-dim)] hover:text-[var(--cursor-text)] transition-colors duration-150"
                title="Decrease text size"
                style={{ border: 'none', outline: 'none', boxShadow: 'none', background: 'transparent', padding: '4px', margin: 0 }}
              >
                <i className="codicon codicon-remove" style={{ fontSize: 13, border: 'none', outline: 'none' }} />
              </button>
              <span className="text-[10px] text-[var(--cursor-text-dim)] min-w-[20px] text-center">{fontSize}</span>
              <button
                onClick={increaseFontSize}
                className="p-1 text-[var(--cursor-text-dim)] hover:text-[var(--cursor-text)] transition-colors duration-150"
                title="Increase text size"
                style={{ border: 'none', outline: 'none', boxShadow: 'none', background: 'transparent', padding: '4px', margin: 0 }}
              >
                <i className="codicon codicon-add" style={{ fontSize: 13, border: 'none', outline: 'none' }} />
              </button>
            </div>
          )}
          
          {/* Team Message Notification - far right (only in workspace mode when not in team chat) */}
          {currentTeamId && mode !== 'team' && (
          <div className="relative flex items-center">
            <button
              onClick={() => setShowTeamNotificationPopup(!showTeamNotificationPopup)}
              className="relative p-1.5 text-gray-500 hover:text-white transition-colors mt-1"
              title={unreadTeamMessages > 0 ? `${unreadTeamMessages} new team messages` : 'Team messages'}
            >
              <i className="codicon codicon-comment-discussion" style={{ fontSize: 16 }} />
              {unreadTeamMessages > 0 && (
                <span className="absolute top-0 -right-0.5 min-w-[14px] h-[14px] bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5">
                  {unreadTeamMessages > 9 ? '9+' : unreadTeamMessages}
                </span>
              )}
            </button>
            
            {/* Notification Popup */}
            {showTeamNotificationPopup && (
              <div className="absolute top-full right-0 mt-2 w-72 bg-[#1a1a1a] border border-[#333] rounded-lg shadow-xl z-50 overflow-hidden">
                <div className="px-3 py-2 border-b border-[#333] flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">Team Messages</span>
                  <button
                    onClick={() => {
                      setMode('team')
                      setShowTeamNotificationPopup(false)
                    }}
                    className="text-[10px] text-purple-400 hover:text-purple-300"
                  >
                    Open Chat →
                  </button>
                </div>
                <div className="max-h-[156px] overflow-y-auto">
                  {teamChatMessages.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-gray-500 text-center">
                      No messages yet
                    </div>
                  ) : (
                    teamChatMessages.slice(-10).map((msg, idx) => (
                      <div 
                        key={msg.id || idx} 
                        className={`px-3 py-2 border-b border-[#2a2a2a] last:border-0 ${
                          idx >= teamChatMessages.slice(-10).length - unreadTeamMessages ? 'bg-purple-500/10' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-semibold text-purple-400">
                            {msg.user_name || 'Unknown'}
                          </span>
                          <span className="text-[9px] text-gray-600">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-xs text-gray-300 truncate">{msg.message}</p>
                      </div>
                    ))
                  )}
                </div>
                {teamChatMessages.length > 10 && (
                  <div className="px-3 py-2 border-t border-[#333] text-center">
                    <button
                      onClick={() => {
                        setMode('team')
                        setShowTeamNotificationPopup(false)
                      }}
                      className="text-[10px] text-gray-400 hover:text-white"
                    >
                      View all {teamChatMessages.length} messages
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Team Chat Mode */}
      {mode === 'team' ? (
        <div className="flex-1 overflow-hidden">
          <TeamChat
            messages={teamChatMessages}
            typingUsers={teamTypingUsers}
            currentUserId={currentUserId}
            onSendMessage={onSendTeamMessage || (() => {})}
            onTyping={onTeamTyping || (() => {})}
            isConnected={isTeamConnected}
            onSwitchMode={(newMode) => setMode(newMode)}
            fontSize={fontSize}
            onlineUsers={teamOnlineUsers}
            onNavigateToFile={onNavigateToFile}
            onModeDropdownChange={onModeDropdownChange}
          />
        </div>
      ) : (
      /* Messages */
      <div 
        ref={chatMessagesRef}
        className={`flex-1 overflow-y-auto px-4 pb-4 scroll-smooth chat-messages ${isUserScrolling ? 'user-scrolling' : ''} relative`}
        style={{ fontFamily: 'var(--font-sans)', scrollBehavior: 'smooth' }}
      >
        {/* Pulsating Logo Background - Only show until first user message */}
        {!messages.some(m => m.role === 'user') && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <div className="breathing-logo">
              <Image 
                src="/logo-svgs/driftbox_logo_mark_knockout_v1.svg" 
                alt="Logo" 
                width={180} 
                height={180}
                className="opacity-10"
                unoptimized
              />
            </div>
          </div>
        )}

        {/* Quick Start Templates / Suggestions - Show in Agent mode with repo selected */}
        {mode === 'agent' && selectedRepo && !messages.some(m => m.role === 'user') && !isModeDropdownOpen && !quickStartDismissed && (
          <div className="absolute bottom-4 left-4 right-4 z-[5]">
            {/* Modern Frosted Glass Container */}
            <div className="bg-black/60 backdrop-blur-xl border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl">
              {/* Header */}
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                <div className="text-[11px] text-white/50 uppercase tracking-widest font-semibold">
                  {securitySuggestions.length > 0 ? 'Suggestions' : (currentTeamId ? 'Team Templates' : 'Quick Start')}
                </div>
                <button
                  onClick={() => setQuickStartDismissed(true)}
                  className="text-white/30 hover:text-white/70 transition-colors p-1.5 hover:bg-white/10 rounded-lg"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {/* Scrollable content - shows 2 items at a time */}
              <div className="p-2.5 max-h-[156px] overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
              {securitySuggestions.length > 0 ? (
                <>
                  {/* Dynamic suggestions from code analysis */}
                  {securitySuggestions.map((suggestion, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setInput(suggestion.prompt)
                        setTimeout(() => {
                          const textarea = document.querySelector('textarea')
                          textarea?.focus()
                        }, 100)
                      }}
                      className="w-full flex items-center gap-3 px-3.5 py-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all duration-200 group text-left"
                    >
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${
                        suggestion.severity === 'critical' ? 'bg-gradient-to-br from-red-500/25 to-red-600/15' :
                        suggestion.severity === 'high' ? 'bg-gradient-to-br from-orange-500/25 to-orange-600/15' :
                        suggestion.severity === 'medium' ? 'bg-gradient-to-br from-amber-500/25 to-amber-600/15' :
                        'bg-gradient-to-br from-blue-500/25 to-blue-600/15'
                      }`}>
                        <svg className={`w-4.5 h-4.5 ${
                          suggestion.severity === 'critical' ? 'text-red-400' :
                          suggestion.severity === 'high' ? 'text-orange-400' :
                          suggestion.severity === 'medium' ? 'text-amber-400' :
                          'text-blue-400'
                        }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[13px] font-medium text-white/90 group-hover:text-white transition-colors truncate">
                            {suggestion.resource}
                          </span>
                          <span className={`text-[9px] px-2 py-0.5 rounded-md uppercase font-bold tracking-wide ${
                            suggestion.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                            suggestion.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                            suggestion.severity === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {suggestion.severity}
                          </span>
                        </div>
                        <div className="text-[11px] text-white/40 truncate">{suggestion.issue}</div>
                      </div>
                    </button>
                  ))}
                </>
              ) : currentTeamId ? (
                <>
                  {/* Workspace-specific templates - Modern Style */}
                  <button
                    onClick={() => {
                      setInput('Create a shared VPC infrastructure for the team')
                      setTimeout(() => {
                        const textarea = document.querySelector('textarea')
                        textarea?.focus()
                      }, 100)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        title: templateExplanations['shared-vpc'].title,
                        explanation: templateExplanations['shared-vpc'].explanation
                      })
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all duration-200 group text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500/25 to-purple-600/15 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4.5 h-4.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-white/90 group-hover:text-white transition-colors">Shared VPC</div>
                      <div className="text-[11px] text-white/40">Team networking infrastructure</div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setInput('Set up a Kubernetes cluster with monitoring')
                      setTimeout(() => {
                        const textarea = document.querySelector('textarea')
                        textarea?.focus()
                      }, 100)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        title: templateExplanations['k8s-cluster'].title,
                        explanation: templateExplanations['k8s-cluster'].explanation
                      })
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all duration-200 group text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/25 to-cyan-600/15 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4.5 h-4.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-white/90 group-hover:text-white transition-colors">K8s Cluster</div>
                      <div className="text-[11px] text-white/40">Container orchestration + monitoring</div>
                    </div>
                  </button>
                </>
              ) : (
                <div className="max-h-[140px] overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {/* Production VPC */}
                  <button
                    onClick={() => {
                      setInput('Create a production-ready VPC with public and private subnets')
                      setTimeout(() => {
                        const textarea = document.querySelector('textarea')
                        textarea?.focus()
                      }, 100)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        title: templateExplanations['production-vpc'].title,
                        explanation: templateExplanations['production-vpc'].explanation
                      })
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all duration-200 group text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500/25 to-purple-600/15 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4.5 h-4.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-white/90 group-hover:text-white transition-colors">Production VPC</div>
                      <div className="text-[11px] text-white/40">Public & private subnets, NAT gateway</div>
                    </div>
                  </button>
                  
                  {/* Secure S3 Bucket */}
                  <button
                    onClick={() => {
                      setInput('Create an S3 bucket with versioning and encryption enabled')
                      setTimeout(() => {
                        const textarea = document.querySelector('textarea')
                        textarea?.focus()
                      }, 100)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        title: templateExplanations['secure-s3'].title,
                        explanation: templateExplanations['secure-s3'].explanation
                      })
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all duration-200 group text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/25 to-blue-600/15 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4.5 h-4.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-white/90 group-hover:text-white transition-colors">Secure S3 Bucket</div>
                      <div className="text-[11px] text-white/40">Versioning, encryption, access policies</div>
                    </div>
                  </button>
                  
                  {/* 3-Tier Web App */}
                  <button
                    onClick={() => {
                      setInput('Create a 3-tier web application with VPC, Application Load Balancer, ECS Fargate service, and RDS PostgreSQL database')
                      setTimeout(() => {
                        const textarea = document.querySelector('textarea')
                        textarea?.focus()
                      }, 100)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        title: templateExplanations['3-tier-app'].title,
                        explanation: templateExplanations['3-tier-app'].explanation
                      })
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all duration-200 group text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-green-500/25 to-green-600/15 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4.5 h-4.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-white/90 group-hover:text-white transition-colors">3-Tier Web App</div>
                      <div className="text-[11px] text-white/40">VPC, ALB, ECS Fargate, RDS PostgreSQL</div>
                    </div>
                  </button>
                  
                  {/* Serverless API */}
                  <button
                    onClick={() => {
                      setInput('Create a serverless REST API with API Gateway, Lambda functions, and DynamoDB table')
                      setTimeout(() => {
                        const textarea = document.querySelector('textarea')
                        textarea?.focus()
                      }, 100)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        title: templateExplanations['serverless-api'].title,
                        explanation: templateExplanations['serverless-api'].explanation
                      })
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all duration-200 group text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-yellow-500/25 to-yellow-600/15 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4.5 h-4.5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-white/90 group-hover:text-white transition-colors">Serverless API</div>
                      <div className="text-[11px] text-white/40">API Gateway, Lambda, DynamoDB</div>
                    </div>
                  </button>
                  
                  {/* Kubernetes Cluster */}
                  <button
                    onClick={() => {
                      setInput('Create an EKS Kubernetes cluster with managed node groups, IAM roles, and VPC networking')
                      setTimeout(() => {
                        const textarea = document.querySelector('textarea')
                        textarea?.focus()
                      }, 100)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        title: templateExplanations['kubernetes-cluster'].title,
                        explanation: templateExplanations['kubernetes-cluster'].explanation
                      })
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all duration-200 group text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/25 to-cyan-600/15 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4.5 h-4.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-white/90 group-hover:text-white transition-colors">Kubernetes Cluster</div>
                      <div className="text-[11px] text-white/40">EKS, node groups, IAM roles</div>
                    </div>
                  </button>
                  
                  {/* Static Website */}
                  <button
                    onClick={() => {
                      setInput('Create a static website hosting with S3, CloudFront CDN, and Route53 DNS')
                      setTimeout(() => {
                        const textarea = document.querySelector('textarea')
                        textarea?.focus()
                      }, 100)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        title: templateExplanations['static-website'].title,
                        explanation: templateExplanations['static-website'].explanation
                      })
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all duration-200 group text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-500/25 to-pink-600/15 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4.5 h-4.5 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-white/90 group-hover:text-white transition-colors">Static Website</div>
                      <div className="text-[11px] text-white/40">S3, CloudFront CDN, Route53</div>
                    </div>
                  </button>
                  
                  {/* CI/CD Pipeline */}
                  <button
                    onClick={() => {
                      setInput('Create a CI/CD pipeline with CodePipeline, CodeBuild, and ECR for container deployments')
                      setTimeout(() => {
                        const textarea = document.querySelector('textarea')
                        textarea?.focus()
                      }, 100)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        title: templateExplanations['cicd-pipeline'].title,
                        explanation: templateExplanations['cicd-pipeline'].explanation
                      })
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all duration-200 group text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500/25 to-orange-600/15 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4.5 h-4.5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-white/90 group-hover:text-white transition-colors">CI/CD Pipeline</div>
                      <div className="text-[11px] text-white/40">CodePipeline, CodeBuild, ECR</div>
                    </div>
                  </button>
                  
                  {/* Monitoring Stack */}
                  <button
                    onClick={() => {
                      setInput('Create a monitoring stack with CloudWatch dashboards, alarms, SNS notifications, and log groups')
                      setTimeout(() => {
                        const textarea = document.querySelector('textarea')
                        textarea?.focus()
                      }, 100)
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all duration-200 group text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500/25 to-red-600/15 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4.5 h-4.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-white/90 group-hover:text-white transition-colors">Monitoring Stack</div>
                      <div className="text-[11px] text-white/40">CloudWatch, alarms, SNS alerts</div>
                    </div>
                  </button>
                </div>
              )}
              </div>
            </div>
          </div>
        )}
        
        {messages.map((message, index) => {
          // Find the corresponding user message for this assistant response
          const userMessage = message.role === 'assistant' && index > 0 && messages[index - 1].role === 'user' 
            ? messages[index - 1].content 
            : null

          // Skip rendering user messages (they'll be shown above assistant responses)
          if (message.role === 'user') return null

          return (
            <div key={index} className="relative group mt-6 z-10">
              {/* User question above - Sticky */}
              {userMessage && (() => {
                const charCount = userMessage.length
                const lines = userMessage.split('\n')
                const lineCount = lines.length
                
                // Collapse if more than 500 characters OR more than 10 lines
                const shouldCollapse = charCount > 500 || lineCount > 10
                const isExpanded = expandedUserMessages[index] || false
                
                // For long single paragraphs, show first 200 chars; for multi-line, show first 3 lines
                let displayMessage = userMessage
                let hiddenInfo = ''
                
                if (shouldCollapse && !isExpanded) {
                  if (lineCount > 10) {
                    // Multi-line: show first 3 lines
                    displayMessage = lines.slice(0, 3).join('\n') + '...'
                    hiddenInfo = `${lineCount - 3} more lines`
                  } else {
                    // Single long paragraph: show first 200 chars
                    displayMessage = userMessage.substring(0, 200) + '...'
                    hiddenInfo = `${charCount - 200} more characters`
                  }
                }
                
                return (
                  <div className="sticky top-0 z-20 mb-2">
                    <div className="rainbow-border-wrapper p-[2px]">
                      <div className="bg-[#252526] rounded-[8px] px-3 py-2">
                        <div className="text-[13px] text-[var(--cursor-text-dim)] font-medium whitespace-pre-wrap">
                          {displayMessage}
                        </div>
                        {shouldCollapse && (
                          <button
                            onClick={() => setExpandedUserMessages(prev => ({ ...prev, [index]: !isExpanded }))}
                            className="mt-2 text-[11px] text-gray-400 hover:text-white transition-colors flex items-center gap-1"
                          >
                            {isExpanded ? (
                              <>
                                <i className="codicon codicon-chevron-up" style={{ fontSize: 10 }} />
                                <span>Show less</span>
                              </>
                            ) : (
                              <>
                                <i className="codicon codicon-chevron-down" style={{ fontSize: 10 }} />
                                <span>Show {hiddenInfo}</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })()}
              
              {/* Assistant response */}
              <div className="relative group/response">
                {/* Special styling for welcome message (first message, no user message) - Hide after first real chat */}
                {index === 0 && !userMessage && messages.length === 1 ? (
                  <div className="rainbow-border-wrapper p-[2px]">
                    <div className="bg-[#1e1e1e] rounded-[8px] px-4 py-3">
                      <div style={{ fontSize: `${fontSize}px` }} className="prose prose-invert prose-sm max-w-none text-[var(--cursor-text)]">
                        <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ) : index === 0 && messages.length === 1 ? null : (message as any).prSuccessData ? (
                  /* Custom PR Progress/Success Card */
                  <div className="border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-green-950/40 rounded-lg p-4 shadow-lg max-w-md">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/40">
                        <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white">Applied successfully</h3>
                        <p className="text-emerald-400 text-xs">File: <span className="bg-emerald-900/50 px-1.5 py-0.5 rounded text-emerald-300 font-mono text-[10px]">{(message as any).prSuccessData.owner}/{(message as any).prSuccessData.repo}</span></p>
                      </div>
                    </div>
                    
                    <div className="space-y-1.5 mb-3">
                      {(message as any).prSuccessData.steps.map((step: string, idx: number) => {
                        const completedSteps = (message as any).prSuccessData.completedSteps || []
                        const isCompleted = completedSteps.includes(idx)
                        const isInProgress = !isCompleted && (idx === 0 || completedSteps.includes(idx - 1))
                        
                        return (
                          <div key={idx} className="flex items-center gap-2 text-xs">
                            <div className={`w-4 h-4 rounded-full flex items-center justify-center border flex-shrink-0 ${
                              isCompleted 
                                ? 'bg-emerald-500/20 border-emerald-500/40' 
                                : isInProgress
                                ? 'bg-blue-500/20 border-blue-500/40'
                                : 'bg-gray-500/10 border-gray-500/30'
                            }`}>
                              {isCompleted ? (
                                <svg className="w-2.5 h-2.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                              ) : isInProgress ? (
                                <svg className="animate-spin w-2.5 h-2.5 text-blue-400" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                              ) : (
                                <div className="w-1.5 h-1.5 rounded-full bg-gray-500/40" />
                              )}
                            </div>
                            <span className={
                              isCompleted ? 'text-gray-300' : 
                              isInProgress ? 'text-blue-400 font-medium' : 
                              'text-gray-500'
                            }>Step {idx}: {step}</span>
                          </div>
                        )
                      })}
                    </div>
                    
                    {(message as any).prSuccessData.prUrl && (
                      <a
                        href={(message as any).prSuccessData.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 text-xs font-medium transition-colors"
                      >
                        <span>View Pull Request</span>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: `${fontSize}px` }} className="prose prose-invert prose-sm max-w-none text-[var(--cursor-text)]">
                    <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
                  </div>
                )}
                
                {/* Mode Switch Suggestion Banner */}
                {message.modeSuggestion && (
                  <div className="mt-4 p-3 bg-[#2d2d30] border border-[#007acc]/30 rounded-lg">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-0.5">
                        {message.modeSuggestion.suggested_mode === 'agent' ? (
                          <i className="codicon codicon-terminal w-5 h-5 text-[#007acc]" style={{ fontSize: 20 }} />
                        ) : (
                          <i className="codicon codicon-sparkle w-5 h-5 text-[#007acc]" style={{ fontSize: 20 }} />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm text-[var(--cursor-text)] font-medium mb-1">
                          {message.modeSuggestion.message}
                        </div>
                        <div className="text-xs text-[var(--cursor-text-dim)] mb-2">
                          {message.modeSuggestion.reason}
                        </div>
                      <button
                          onClick={() => {
                            setMode(message.modeSuggestion!.suggested_mode)
                            setIsModeDropdownOpen(false)
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-[#007acc] hover:bg-[#005a9e] rounded transition-colors"
                        >
                          {message.modeSuggestion.action_text}
                      </button>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Compact diff preview in chat (clickable to open full diff) */}
                {message.fileProposal && !message.proposalAccepted && (
                  <CompactDiffPreview
                    filePath={message.fileProposal.path}
                    oldContent={message.fileProposal.oldContent}
                    newContent={message.fileProposal.newContent}
                    onClick={() => {
                      if (onFileProposal) {
                        // Track that this file was opened from a diff
                        setFilesOpenedFromDiff(prev => new Set(prev).add(message.fileProposal!.path))
                        onFileProposal(message.fileProposal!)
                      }
                    }}
                  />
                )}
                
                {/* OLD: Full FileProposal component (moved to editor pane) */}
                {false && message.fileProposal && !message.proposalAccepted && message.fileProposal && (
                  <FileProposal
                    proposal={message.fileProposal!}
                    onAccept={async () => {
                      try {
                        // Get workspace path from selected repo
                        const [owner, repo] = selectedRepo.full_name.split('/')
                        
                        // Ensure repo is cloned and get workspace path (uses IPC on desktop, API on web)
                        if (!user?.github_access_token) {
                          throw new Error('GitHub token not available. Please authenticate with GitHub.')
                        }
                        
                        const cloneResult = await cloneRepository(owner, repo, user.github_access_token)
                        
                        if (!cloneResult.success) {
                          throw new Error(cloneResult.error || 'Failed to clone repository')
                        }
                        
                        const workspacePath = cloneResult.path || await getWorkspacePath(owner, repo)
                        
                        if (!workspacePath) {
                          throw new Error('Could not determine workspace path')
                        }
                        
                        const response = await fetch(getApiEndpoint('/files/proposals/apply'), {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                          },
                          body: JSON.stringify({
                            proposal: message.fileProposal,
                            workspace_path: workspacePath
                          })
                        })
                        if (response.ok) {
                          const result = await response.json()
                          // Mark this message's proposal as accepted
                          setMessages(prev => prev.map((msg, i) => 
                            i === index ? { 
                              ...msg, 
                              proposalAccepted: true,
                              appliedFilePath: result.file_path
                            } : msg
                          ))
                        }
                      } catch (error) {
                        console.error('Failed to apply proposal:', error)
                      }
                    }}
                    onReject={async () => {
                      try {
                        await fetch(getApiEndpoint('/files/proposals/reject'), {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                          },
                          body: JSON.stringify({
                            proposal: message.fileProposal,
                            reason: 'User rejected'
                          })
                        })
                        // Mark as rejected (remove proposal from view)
                        setMessages(prev => prev.map((msg, i) => 
                          i === index ? { 
                            ...msg, 
                            fileProposal: undefined
                          } : msg
                        ))
                      } catch (error) {
                        console.error('Failed to reject proposal:', error)
                      }
                    }}
                  />
                )}
                
                {/* Show accepted proposal status with green indicator - Cursor style */}
                {message.proposalAccepted && message.appliedFilePath && message.fileProposal && (() => {
                  const blockKey = `applied-${index}`
                  const isExpanded = expandedCodeBlocks[blockKey] || false
                  const lines = message.fileProposal.newContent.split('\n')
                  const totalLines = lines.length
                  const previewLines = 15
                  const hasMore = totalLines > previewLines
                  const displayContent = isExpanded ? message.fileProposal.newContent : lines.slice(0, previewLines).join('\n')
                  
                  return (
                    <div className="mt-3 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                      <div className="flex items-center gap-2 text-green-400 text-sm mb-2">
                        <i className="codicon codicon-check" style={{ fontSize: 16 }} />
                        <span className="font-semibold">Applied successfully</span>
                      </div>
                      <div className="text-xs text-green-300 mb-2">
                        File: <code className="bg-green-500/20 px-2 py-0.5 rounded">{message.appliedFilePath}</code>
                      </div>
                      {/* Show the code that was applied in green */}
                      <div className="bg-[#141414] border border-[#2a2a2a] rounded overflow-hidden">
                        <pre className="p-3 text-xs text-[#EDEDED] font-mono overflow-x-auto max-h-96 overflow-y-auto">
                          <code>{displayContent}</code>
                        </pre>
                      </div>
                      {/* Expand/Collapse button at bottom */}
                      {hasMore && (
                        <div className="mt-2 flex justify-center">
                          <button
                            onClick={() => setExpandedCodeBlocks(prev => ({ ...prev, [blockKey]: !isExpanded }))}
                            className="px-3 py-1 text-[10px] text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 rounded transition-colors"
                          >
                            {isExpanded ? (
                              <>
                                <i className="codicon codicon-chevron-up mr-1" style={{ fontSize: 10 }} />
                                Collapse
                              </>
                            ) : (
                              <>
                                <i className="codicon codicon-chevron-down mr-1" style={{ fontSize: 10 }} />
                                Expand {totalLines - previewLines} more lines
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })()}
                
                {/* Copy button - only show after response is FULLY complete (not streaming) */}
                {message.streaming === false && message.content && message.role === 'assistant' && (
                  <div className="flex justify-end mt-1 pr-16">
                    <button
                      onClick={() => handleCopy(message.content, index)}
                      className="opacity-0 group-hover/response:opacity-100 transition-opacity duration-150 p-0 bg-transparent border-0"
                      title="Copy response"
                    >
                      {copiedIndex === index ? (
                        <i className="codicon codicon-check text-green-500" style={{ fontSize: 13 }} />
                      ) : (
                        <i className="codicon codicon-copy text-[var(--cursor-text-dim)] hover:text-[var(--cursor-text)] transition-colors" style={{ fontSize: 13 }} />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {isStreaming && (() => {
          // Check if last message has content (meaning generation has started)
          const lastMessage = messages[messages.length - 1]
          const hasContent = lastMessage?.role === 'assistant' && lastMessage?.content && lastMessage.content.trim().length > 0
          
          // Hide status cycle once content starts streaming
          if (hasContent) return null
          
          return (
            <div className="relative mt-6">
              {isImportQuery ? (
                // Progress bar for import queries (shown alongside messages, not instead of)
                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[var(--cursor-text-dim)]">Generating Terraform...</span>
                    <span className="text-[12px] text-[var(--cursor-text-dim)]">{Math.round(generationProgress)}%</span>
                  </div>
                  <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${generationProgress}%` }}
                    />
                  </div>
                  {mode === 'agent' && (
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={() => setShowMiniGame(!showMiniGame)}
                        className="text-[11px] px-2 py-1 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 text-purple-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                      >
                        <span>🎮</span>
                        <span>{showMiniGame ? 'Close game' : 'Play while waiting'}</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                // Rotating messages for regular queries (both Ask and Agent modes)
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-[13px] text-[var(--cursor-text-dim)]">
                    <span className="transition-opacity duration-300">{streamingMessage}</span>
                    <span className="flex gap-0.5">
                      <span className="animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1s' }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1s' }}>.</span>
                    </span>
                  </div>
                  {mode === 'agent' && (
                    <button
                      onClick={() => setShowMiniGame(!showMiniGame)}
                      className="text-[11px] px-2 py-1 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 text-purple-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                    >
                      <span>🎮</span>
                      <span>{showMiniGame ? 'Close game' : 'Play while waiting'}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })()}
        
        {/* Mini Game - stays open until manually closed (agent mode only) */}
        {showMiniGame && mode === 'agent' && (
          <div className="mt-4">
            <MiniGame onClose={() => setShowMiniGame(false)} />
          </div>
        )}
        <div ref={messagesEndRef} />
        
        {/* Create PR Button - Show when streaming is complete AND ALL diffs are kept/accepted */}
        {/* HIDDEN in team workspaces - use Open Staging instead */}
        {(() => {
          // Only show PR button if there are proposals and ALL are ACCEPTED (kept) AND PR hasn't been created yet
          // HIDE in team workspaces - PRs are created from staging panel
          if (!selectedRepo || fileProposals.length === 0 || prCreated || currentTeamId) {
            return false
          }
          
          // Check if streaming state is false (main streaming indicator)
          const streamingStateComplete = !isStreaming
          
          // Check if completion message pattern is present (e.g., "85 resources • 32 files")
          // This indicates the backend has finished generating all files
          // Look for the pattern "X resources • Y files" in any message
          const hasCompletionPattern = messages.some(msg => {
            if (!msg.content) return false
            // Match pattern like "85 resources • 32 files" or similar
            const resourcesFilesPattern = /\d+\s+resources\s+•\s+\d+\s+files/i
            return resourcesFilesPattern.test(msg.content)
          })
          
          // Check if there are any messages that indicate streaming occurred
          // (for repo creation, there might be no streaming messages)
          const hasStreamingMessages = messages.some(msg => msg.streaming === true || hasCompletionPattern)
          
          // All proposals must be accepted (kept) - no pending or rejected
          const allAccepted = fileProposals.every(p => proposalStates[p.path] === 'accepted')
          
          // Show PR button if:
          // 1. All proposals are accepted
          // 2. AND either:
          //    a. Streaming is complete (has completion pattern) - for model generation scenarios
          //    b. OR no streaming occurred (no streaming messages) - for repo creation scenarios
          const shouldShow = allAccepted && (
            (streamingStateComplete && hasCompletionPattern) || // Model generation: streaming done with completion pattern
            (!hasStreamingMessages && streamingStateComplete)   // Repo creation: no streaming, just proposals
          )
          
          // Debug logging
          if (fileProposals.length > 0 && !shouldShow) {
            const lastMessage = messages[messages.length - 1]
            console.log('🔍 [PR-Button] Not showing:', {
              isStreaming,
              streamingStateComplete,
              hasCompletionPattern,
              hasStreamingMessages,
              messagesWithStreaming: messages.filter(msg => msg.streaming === true).length,
              lastMessagePreview: lastMessage?.content?.substring(0, 100),
              allAccepted,
              proposalCount: fileProposals.length,
              acceptedCount: fileProposals.filter(p => proposalStates[p.path] === 'accepted').length,
              proposalStates: fileProposals.map(p => ({ path: p.path, state: proposalStates[p.path] }))
            })
          }
          
          return shouldShow
        })() && (
          <div className="px-4 pb-2">
            <button
              onClick={async () => {
                try {
                  // Disable button immediately to prevent double-clicks
                  setPrCreated(true)
                  
                  const [owner, repo] = selectedRepo.full_name.split('/')
                  
                  // Show status message
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: '🔄 Preparing repository...',
                    mode: 'agent',
                    streaming: true
                  }])

                  // Step 1: Ensure repo is cloned and get workspace path (uses IPC on desktop, API on web)
                  if (!user?.github_access_token) {
                    throw new Error('GitHub token not available. Please authenticate with GitHub.')
                  }
                  
                  const cloneResult = await cloneRepository(owner, repo, user.github_access_token)
                  
                  if (!cloneResult.success) {
                    throw new Error(cloneResult.error || 'Failed to clone repository')
                  }
                  
                  const workspacePath = cloneResult.path || await getWorkspacePath(owner, repo)
                  
                  console.log('📁 [PR-Button] Workspace path:', workspacePath)
                  console.log('📁 [PR-Button] Clone result:', cloneResult)
                  
                  if (!workspacePath) {
                    throw new Error('Could not determine workspace path')
                  }
                  
                  // Clear the "Preparing repository..." loading state
                  setMessages(prev => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      streaming: false
                    }
                    return updated
                  })

                  // Step 1.5: Check if files already exist (retry scenario)
                  const acceptedProposals = fileProposals.filter(p => proposalStates[p.path] === 'accepted')
                  
                  // Check if this is a retry by checking if files already exist on disk
                  let isRetry = false
                  if (isDesktop && acceptedProposals.length > 0) {
                    const { readFile } = await import('@/utils/desktopBridge')
                    // Try to read the first file - if it exists, this is a retry
                    const fileCheckResult = await readFile(owner, repo, acceptedProposals[0].path)
                    isRetry = fileCheckResult.success
                    console.log(`🔄 [PR-Button] Retry detection: ${isRetry ? 'YES - Files exist, skipping write' : 'NO - Fresh attempt'}`)
                  }
                  
                  // Only clean and write files if this is NOT a retry
                  if (!isRetry) {
                    console.log('🧹 [PR-Button] Cleaning workspace:', workspacePath)
                    const cleanResponse = await fetch(getApiEndpoint('/files/clean-workspace'), {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                      },
                      body: JSON.stringify({ workspace_path: workspacePath })
                    })
                    
                    if (!cleanResponse.ok) {
                      console.warn('Failed to clean workspace')
                    }
                  } else {
                    console.log('🔄 [PR-Button] Retry detected - using existing files on disk (with your edits)')
                  }
                  
                  console.log(`📝 [PR-Button] Applying ${acceptedProposals.length} file proposals...`)
                  console.log('📝 [PR-Button] Accepted proposals:', acceptedProposals.map(p => ({ path: p.path, action: p.action })))
                  
                  // CRITICAL FIX: For Desktop, get the LOCAL workspace path
                  let actualWorkspacePath = workspacePath  // Default to backend path
                  if (isDesktop) {
                    const { getWorkspacePath } = await import('@/utils/desktopBridge')
                    const localPath = await getWorkspacePath(owner, repo)
                    if (localPath) {
                      actualWorkspacePath = localPath
                      console.log(`🖥️  [PR-Button] Desktop mode: Using LOCAL workspace path: ${actualWorkspacePath}`)
                      console.log(`     (Backend path was: ${workspacePath})`)
                    }
                  }
                  
                  // Only write files if this is NOT a retry (skip file write on retry to preserve user edits)
                  if (!isRetry) {
                  for (const proposal of acceptedProposals) {
                    if (isDesktop) {
                      // DESKTOP: Use Electron IPC for direct file write
                      console.log('🖥️  Desktop: Writing file via Electron:', proposal.path)
                      // Determine action from proposal or by checking if oldContent exists
                      const action = (proposal.action === 'create' || !proposal.oldContent || proposal.oldContent === '') ? 'create' : 'edit'
                      const result = await applyFileProposal(
                        owner,
                        repo,
                        proposal.path,
                        proposal.newContent,
                        token!,
                        action
                      )
                      
                      if (!result.success) {
                        console.warn(`Failed to write ${proposal.path}:`, result.error)
                      } else {
                        console.log(`✅ Desktop: File written:`, proposal.path)
                        // Refresh git status after successful file operation
                        if (onRefreshGitStatusRef?.current) {
                          onRefreshGitStatusRef.current()
                        }
                      }
                    } else {
                      // WEB: Use API
                      console.log('🌐 [PR-Button] Web: Writing file via API:', proposal.path, 'to workspace:', workspacePath)
                      const applyResponse = await fetch(getApiEndpoint('/files/proposals/apply'), {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({
                          proposal: {
                            action: proposal.action,
                            path: proposal.path,
                            old_content: proposal.oldContent,
                            new_content: proposal.newContent
                          },
                          workspace_path: workspacePath
                        })
                      })
                      
                      if (!applyResponse.ok) {
                        const errorText = await applyResponse.text()
                        console.error(`❌ [PR-Button] Failed to write ${proposal.path}:`, errorText)
                      } else {
                        console.log(`✅ [PR-Button] Successfully wrote ${proposal.path}`)
                        // Refresh git status after successful file operation
                        if (onRefreshGitStatusRef?.current) {
                          onRefreshGitStatusRef.current()
                        }
                      }
                    }
                  }
                  } // End if (!isRetry)
                  
                  console.log('✅ [PR-Button] All files written, now creating PR...')
                  
                  // Step 2: Create PR - Desktop uses local git, Web uses backend API
                  if (isDesktop) {
                    // DESKTOP MODE: Use Electron for local git operations
                    console.log('🖥️  [PR-Button] Desktop mode: Using Electron for PR creation')
                    
                    const branchName = `driftbox/terraform-${Date.now().toString(36)}`
                    const commitMessage = `Add infrastructure changes`
                    
                    // Show progress card immediately with pending steps
                    setMessages(prev => {
                      const updated = [...prev]
                      updated[updated.length - 1] = {
                        role: 'assistant',
                        content: '',
                        mode: 'agent',
                        streaming: true,
                        prSuccessData: {
                          owner,
                          repo,
                          branchName,
                          prUrl: null,
                          steps: [
                            'GitHub token retrieved',
                            'Branch created',
                            'Changes committed',
                            'Terraform fmt completed',
                            'Terraform validation passed',
                            'Pushed to GitHub',
                            'PR URL generated'
                          ],
                          completedSteps: [] // Start with no completed steps
                        }
                      }
                      return updated
                    })
                    
                    // Execute PR creation with step-by-step updates
                    try {
                      const { createPullRequest } = await import('@/utils/desktopBridge')
                      
                      // Track if we're in auto-heal mode
                      let autoHealActive = false
                      const baseSteps = [
                        'GitHub token retrieved',
                        'Branch created',
                        'Changes committed',
                        'Terraform fmt completed',
                        'Terraform validation passed',
                        'Pushed to GitHub',
                        'PR URL generated'
                      ]
                      
                      // Update steps as we go
                      const updateStep = (stepIndex: number) => {
                        setMessages(prev => {
                          const updated = [...prev]
                          const lastMsg = { ...updated[updated.length - 1] }
                          if ((lastMsg as any).prSuccessData) {
                            (lastMsg as any).prSuccessData = {
                              ...(lastMsg as any).prSuccessData,
                              completedSteps: Array.from({ length: stepIndex + 1 }, (_, i) => i)
                            }
                            updated[updated.length - 1] = lastMsg
                          }
                          return updated
                        })
                      }
                      
                      // Insert auto-heal steps dynamically
                      const insertAutoHealSteps = () => {
                        if (autoHealActive) return // Already inserted
                        autoHealActive = true
                        
                        setMessages(prev => {
                          const updated = [...prev]
                          const lastMsg = { ...updated[updated.length - 1] }
                          if ((lastMsg as any).prSuccessData) {
                            const newSteps = [
                              ...baseSteps.slice(0, 4), // Keep first 4 steps
                              'AI analyzing validation errors...',
                              'AI generating fixes...',
                              'Applying fixes to workspace...',
                              'Retrying validation...',
                              ...baseSteps.slice(4) // Add remaining steps
                            ]
                            ;(lastMsg as any).prSuccessData = {
                              ...(lastMsg as any).prSuccessData,
                              steps: newSteps,
                              completedSteps: [0, 1, 2, 3] // Mark first 4 as done
                            }
                            updated[updated.length - 1] = lastMsg
                          }
                          return updated
                        })
                      }
                      
                      // Update auto-heal step
                      const updateAutoHealStep = (status: 'analyzing' | 'generating' | 'applying' | 'retrying' | 'success' | 'failed') => {
                        const stepMap = {
                          'analyzing': 4,
                          'generating': 5,
                          'applying': 6,
                          'retrying': 7,
                          'success': 8, // Validation passed (after auto-heal)
                          'failed': 4 // Stay at analyzing
                        }
                        
                        const stepIndex = stepMap[status]
                        setMessages(prev => {
                          const updated = [...prev]
                          const lastMsg = { ...updated[updated.length - 1] }
                          if ((lastMsg as any).prSuccessData) {
                            (lastMsg as any).prSuccessData = {
                              ...(lastMsg as any).prSuccessData,
                              completedSteps: Array.from({ length: stepIndex + 1 }, (_, i) => i)
                            }
                            updated[updated.length - 1] = lastMsg
                          }
                          return updated
                        })
                      }
                      
                      // Step 0: Get token (instant)
                      updateStep(0)
                      await new Promise(resolve => setTimeout(resolve, 100))
                      
                      // Execute PR creation with auto-heal progress
                      const result = await createPullRequest(
                        owner, 
                        repo, 
                        branchName, 
                        commitMessage, 
                        token!,
                        (status) => {
                          // First auto-heal callback: insert steps
                          if (status === 'analyzing' && !autoHealActive) {
                            insertAutoHealSteps()
                          }
                          updateAutoHealStep(status)
                        }
                      )
                      
                      if (!result.success) {
                        throw new Error(result.error || 'Failed to create PR via Electron')
                      }
                      
                      if (!result.pr_url) {
                        throw new Error('PR created but no URL returned')
                      }
                      
                      // Mark all steps as complete and add PR URL
                      setMessages(prev => {
                        const updated = [...prev]
                        const lastMsg = { ...updated[updated.length - 1] }
                        if ((lastMsg as any).prSuccessData) {
                          const stepsLength = (lastMsg as any).prSuccessData.steps.length
                          ;(lastMsg as any).prSuccessData = {
                            ...(lastMsg as any).prSuccessData,
                            completedSteps: Array.from({ length: stepsLength }, (_, i) => i),
                            prUrl: result.pr_url
                          }
                          lastMsg.streaming = false
                          updated[updated.length - 1] = lastMsg
                        }
                        return updated
                      })
                      
                      // Open PR in browser
                      window.open(result.pr_url, '_blank')
                      
                      // Refresh git status to clear yellow indicators (files are now committed)
                      if (onRefreshGitStatusRef?.current) {
                        console.log('🔄 [ChatPanel] Refreshing git status after desktop PR creation')
                        onRefreshGitStatusRef.current()
                      }
                      
                      // Refresh file tree to show new files
                      if (onRefreshFileTreeRef?.current) {
                        console.log('🔄 [ChatPanel] Refreshing file tree after PR creation')
                        onRefreshFileTreeRef.current()
                      }
                      
                      // Auto-sync after PR merge: pull changes at 3s and 10s intervals
                      // This handles the case where user merges PR on GitHub shortly after
                      if (window.electronAPI?.gitPull) {
                        // Get GitHub token for authenticated pull
                        const tokenResult = await window.electronAPI?.getGitHubToken?.()
                        const githubToken = tokenResult?.token
                        
                        setTimeout(async () => {
                          console.log('🔄 [ChatPanel] Running auto-sync (3s post-PR)')
                          try {
                            const pullResult = await window.electronAPI!.gitPull(owner, repo, 'main', githubToken)
                            if (pullResult.success) {
                              console.log('✅ [ChatPanel] Post-PR sync successful (3s)')
                              onRefreshGitStatusRef?.current?.()
                              onRefreshFileTreeRef?.current?.()
                            }
                          } catch (e) {
                            console.log('⚠️ [ChatPanel] Post-PR sync skipped (3s):', e)
                          }
                        }, 3000)
                        
                        setTimeout(async () => {
                          console.log('🔄 [ChatPanel] Running auto-sync (10s post-PR)')
                          try {
                            const pullResult = await window.electronAPI!.gitPull(owner, repo, 'main', githubToken)
                            if (pullResult.success) {
                              console.log('✅ [ChatPanel] Post-PR sync successful (10s)')
                              onRefreshGitStatusRef?.current?.()
                              onRefreshFileTreeRef?.current?.()
                            }
                          } catch (e) {
                            console.log('⚠️ [ChatPanel] Post-PR sync skipped (10s):', e)
                          }
                        }, 10000)
                      }
                      
                      // Poll repo list every 10s until new repo appears (with fallback direct check)
                      if (onRefreshRepoListRef?.current && selectedRepo) {
                        const targetRepo = selectedRepo.full_name
                        const [owner, repo] = targetRepo.split('/')
                        let pollCount = 0
                        const maxPolls = 15 // Stop after 150 seconds (15 * 10s)
                        
                        console.log('🔄 [ChatPanel] Starting repo polling for:', targetRepo)
                        
                        const pollInterval = setInterval(async () => {
                          pollCount++
                          console.log(`🔄 [ChatPanel] Repo poll #${pollCount}/${maxPolls} (checking if ${targetRepo} exists)`)
                          
                          // Method 1: Check in repo list
                          if (onRefreshRepoListRef?.current) {
                            const repos = await onRefreshRepoListRef.current()
                            
                            if (repos && Array.isArray(repos)) {
                              const found = repos.find((r: any) => r.full_name === targetRepo)
                              if (found) {
                                clearInterval(pollInterval)
                                console.log(`✅ [ChatPanel] Repo found in list at position ${repos.indexOf(found)}/${repos.length}! Stopped polling.`)
                                return
                              }
                              console.log(`   📊 Checked ${repos.length} repos - ${targetRepo} not found yet`)
                            }
                          }
                          
                          // Method 2: Direct GitHub API check (fallback) - try after 5 attempts
                          if (pollCount >= 5 && user?.github_access_token) {
                            try {
                              const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
                                headers: {
                                  'Authorization': `Bearer ${user.github_access_token}`,
                                  'Accept': 'application/vnd.github.v3+json'
                                }
                              })
                              
                              if (response.ok) {
                                clearInterval(pollInterval)
                                console.log(`✅ [ChatPanel] Repo exists (verified via direct GitHub API)! Stopped polling.`)
                                console.log(`   💡 The repo exists but GitHub's list API is slow. Triggering one final refresh...`)
                                // One final refresh to get it in the list
                                if (onRefreshRepoListRef?.current) {
                                  await onRefreshRepoListRef.current()
                                }
                                return
                              }
                            } catch (err) {
                              console.log(`   🔍 Direct check failed:`, err)
                            }
                          }
                          
                          // Stop polling after max attempts
                          if (pollCount >= maxPolls) {
                            clearInterval(pollInterval)
                            console.log('⏱️  [ChatPanel] Stopped polling after', pollCount, 'attempts')
                            console.log('   💡 Try refreshing the page or manually selecting the repo from the dropdown')
                          }
                        }, 10000) // Poll every 10 seconds (faster than before)
                      }
                      
                      // Log PR to tracking database
                      try {
                        await fetch(getApiEndpoint('/prs/log'), {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                          },
                          body: JSON.stringify({
                            repo_owner: owner,
                            repo_name: repo,
                            branch_name: branchName,
                            commit_message: commitMessage,
                            pr_url: result.pr_url,
                            files_changed: acceptedProposals.map(p => p.path),
                            files_added: acceptedProposals.filter(p => p.action === 'create').map(p => p.path),
                            files_modified: acceptedProposals.filter(p => p.action === 'edit').map(p => p.path),
                            terraform_valid: true,
                            created_via: 'desktop'
                          })
                        })
                        console.log('✅ [PR Tracking] PR logged to database')
                      } catch (logError) {
                        console.warn('⚠️  [PR Tracking] Failed to log PR:', logError)
                        // Don't fail the entire flow if logging fails
                      }
                      
                      // Mark PR as created to hide the button
                      setPrCreated(true)
                      
                      // Clear accepted proposals so new proposals can trigger a new PR
                      if (onClearAcceptedProposalsRef?.current) {
                        console.log('🧹 [ChatPanel] Clearing accepted proposals after PR')
                        onClearAcceptedProposalsRef.current()
                      }
                      
                    } catch (error: any) {
                      // Check if this is a validation/fmt error - if so, clear all code and hide PR button
                      const isValidationError = error.message.toLowerCase().includes('validation') || 
                                                error.message.toLowerCase().includes('terraform fmt') ||
                                                error.message.toLowerCase().includes('invalid') ||
                                                error.message.toLowerCase().includes('unterminated') ||
                                                error.message.toLowerCase().includes('multi-line string')
                      
                      if (isValidationError) {
                        // VALIDATION ERROR: Delete files, unstage everything, full clean slate
                        console.error('❌ [Validation Error - Desktop] Full cleanup - deleting files, unstaging git, removing from tree')
                        console.error('[Validation Error Details]', error.message)
                        
                        // Get repo info
                        const [owner, repo] = selectedRepo.full_name.split('/')
                        
                        try {
                          // 1. Delete generated files from disk (Desktop mode)
                          const filesToDelete = Array.from(filesOpenedFromDiff)
                          console.log('🗑️  [Validation Error - Desktop] Deleting files:', filesToDelete)
                          
                          if (filesToDelete.length > 0) {
                            for (const filePath of filesToDelete) {
                              try {
                                if (window.electronAPI?.deleteFile) {
                                  const deleteResult = await window.electronAPI.deleteFile(owner, repo, filePath)
                                  if (deleteResult.success) {
                                    console.log(`✅ Deleted ${filePath}`)
                                  } else {
                                    console.warn(`⚠️  Failed to delete ${filePath}:`, deleteResult.error)
                                  }
                                }
                              } catch (deleteError) {
                                console.warn(`⚠️  Error deleting ${filePath}:`, deleteError)
                              }
                            }
                          }
                          
                          // 2. Unstage everything (git reset) - Desktop mode
                          console.log('🧹 [Validation Error - Desktop] Unstaging all changes')
                          try {
                            if (window.electronAPI?.gitReset) {
                              const resetResult = await window.electronAPI.gitReset(selectedRepo.full_name)
                              if (resetResult.success) {
                                console.log('✅ Git staging area cleared')
                              } else {
                                console.warn('⚠️  Git reset failed:', resetResult.error)
                              }
                            }
                          } catch (resetError) {
                            console.warn('⚠️  Error resetting git:', resetError)
                          }
                          
                          // 3. Close files in editor
                          if (filesToDelete.length > 0 && onCloseFilesRef?.current) {
                            console.log('📄 [Validation Error - Desktop] Closing files in editor')
                            onCloseFilesRef.current(filesToDelete)
                          }
                          
                          // 4. Refresh file tree to remove deleted files
                          if (onRefreshFileTreeRef?.current) {
                            console.log('🌳 [Validation Error - Desktop] Refreshing file tree')
                            onRefreshFileTreeRef.current()
                          }
                          
                          // 5. Refresh git status
                          if (onRefreshGitStatusRef?.current) {
                            console.log('🔄 [Validation Error - Desktop] Refreshing git status')
                            onRefreshGitStatusRef.current()
                          }
                          
                          setFilesOpenedFromDiff(new Set()) // Clear tracking
                        } catch (cleanupError) {
                          console.error('❌ [Validation Error - Desktop] Cleanup failed:', cleanupError)
                        }
                        
                        // Extract first few lines of error for summary
                        const errorLines = error.message.split('\n').slice(0, 3)
                        const errorSummary = errorLines.join('\n')
                        
                        // Clear file proposals and hide PR button
                        setMessages(prev => {
                          const updated = [...prev]
                          // Remove file proposals from the last message
                          updated[updated.length - 1] = {
                            role: 'assistant',
                            content: `## ❌ Terraform Validation Failed\n\n` +
                                     `The generated infrastructure code has validation errors:\n\n` +
                                     `\`\`\`\n${errorSummary}${errorLines.length < error.message.split('\n').length ? '\n...(more errors)' : ''}\n\`\`\`\n\n` +
                                     `---\n\n` +
                                     `### 🔄 Please Try Again\n\n` +
                                     `The generated code has been cleared. Please:\n\n` +
                                     `1. **Refine your prompt** to be more specific\n` +
                                     `2. **Try a simpler request** first, then add complexity\n` +
                                     `3. **Send a new message** to generate fresh infrastructure\n\n` +
                                     `💡 Tip: Breaking complex infrastructure into smaller chunks often works better!`,
                            mode: 'agent',
                            streaming: false
                            // fileProposals: undefined - don't include file proposals
                          }
                          return updated
                        })
                        
                        // Hide PR button by marking as created
                        setPrCreated(true)
                        return // Exit early
                      }
                      
                      // NON-VALIDATION ERROR: Keep code and button for manual fixes
                      let errorSummary = 'Unknown error occurred'
                      let errorDetails = ''
                      
                      if (error.message.includes('Duplicate resource')) {
                        const duplicateMatch = error.message.match(/Duplicate resource "([^"]+)" "([^"]+)"/i)
                        if (duplicateMatch) {
                          errorSummary = `Duplicate Terraform resource found`
                          errorDetails = `You have multiple \`${duplicateMatch[1]}\` resources named \`"${duplicateMatch[2]}"\`.\n\n` +
                                        `Each resource must have a unique name within your Terraform configuration.\n\n` +
                                        `**Fix:** Rename the duplicate resources or remove them.`
                        }
                      } else if (error.message.includes('Failed to push')) {
                        errorSummary = 'Git push failed'
                        errorDetails = 'Unable to push changes to GitHub.\n\n' +
                                      'This could be due to authentication or network issues.'
                      } else if (error.message.includes('Failed to commit')) {
                        errorSummary = 'Git commit failed'
                        errorDetails = 'Unable to commit changes locally.\n\n' +
                                      'Check if there are any file permission issues.'
                      } else if (error.message.includes('GitHub token not found')) {
                        errorSummary = 'GitHub authentication required'
                        errorDetails = 'Please sign in to GitHub to create pull requests.'
                      } else {
                        errorSummary = 'PR creation failed'
                        errorDetails = error.message.substring(0, 200)
                      }
                      
                      // Show error with retry instructions
                      setMessages(prev => {
                        const updated = [...prev]
                        updated[updated.length - 1] = {
                          role: 'assistant',
                          content: `## ❌ ${errorSummary}\n\n` +
                                   `${errorDetails}\n\n` +
                                   `---\n\n` +
                                   `### 🔄 How to Fix & Retry\n\n` +
                                   `1. **Open the file(s)** in the editor (click them in the file tree)\n` +
                                   `2. **Fix the errors** shown above\n` +
                                   `3. **Save your changes** (Cmd/Ctrl + S)\n` +
                                   `4. **Click the PR button again** to retry\n\n` +
                                   `The button will use your updated file contents automatically! ✨`,
                          mode: 'agent',
                          streaming: false,
                          fileProposal: messages[messages.length - 1]?.fileProposal // Keep file proposals for manual fixing
                        }
                        return updated
                      })
                      console.error('[PR Creation Error]', error.message)
                      console.log('💡 [PR] Button remains visible for retry - files can be edited and retried')
                      // Re-enable button for retry
                      setPrCreated(false)
                    }
                    
                    return // Exit early for desktop mode
                  }
                  
                  // WEB MODE: Use backend API for terraform validation and PR creation
                  console.log('🌐 [PR-Button] Web mode: Using backend API')
                  console.log(`📍 [PR-Button] Using workspace path for backend: ${actualWorkspacePath}`)
                  console.log('🔄 Running terraform validation...')
                  const response = await fetch(getApiEndpoint('/approve/stream'), {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                      workspace_path: actualWorkspacePath,  // Use local path for Desktop, backend path for Web
                      repo_owner: owner,
                      repo_name: repo,
                      base_branch: 'main'
                    })
                  })

                  if (!response.ok) {
                    const error = await response.json()
                    throw new Error(error.detail || error.error || 'Failed to create PR')
                  }

                  // Read the SSE stream to show live progress
                  const reader = response.body?.getReader()
                  const decoder = new TextDecoder()
                  let statusSteps: string[] = []
                  let finalData: any = null
                  const startTime = Date.now()

                  // Initialize with professional header
                  setMessages(prev => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      role: 'assistant',
                      content: `## 🚀 Deployment Pipeline\n\n` +
                               `**Repository:** ${owner}/${repo}\n\n` +
                               `**Status:** Running validation checks...\n\n` +
                               `---\n\n`,
                      mode: 'agent',
                      streaming: true
                    }
                    return updated
                  })

                  if (reader) {
                    while (true) {
                      const { done, value } = await reader.read()
                      if (done) break

                      const chunk = decoder.decode(value)
                      const lines = chunk.split('\n')

                      for (const line of lines) {
                        if (line.startsWith('data: ')) {
                          try {
                            const data = JSON.parse(line.slice(6))
                            
                            if (data.type === 'status') {
                              // Add status message to the list
                              statusSteps.push(data.message)
                              
                              // Categorize steps for better display
                              const detectionSteps = statusSteps.filter(s => s.includes('Detecting') || s.includes('Detected repo'))
                              const terraformSteps = statusSteps.filter(s => s.includes('terraform') || s.includes('Running') || s.includes('fmt') || s.includes('validate'))
                              const gitSteps = statusSteps.filter(s => s.includes('branch') || s.includes('Commit') || s.includes('GitHub') || s.includes('Push') || s.includes('Authenticat'))
                              const finalSteps = statusSteps.filter(s => s.includes('Generating') || s.includes('Ready') || s.includes('Complete'))
                              
                              // Build professional output
                              let content = `## 🚀 Deployment Pipeline\n\n`
                              content += `**Repository:** ${owner}/${repo}\n\n`
                              content += `**Status:** In Progress\n\n`
                              content += `---\n\n`
                              
                              // Repository Detection
                              if (detectionSteps.length > 0) {
                                content += `### 📦 Repository\n\n`
                                detectionSteps.forEach(step => {
                                  content += `${step}\n\n`
                                })
                                content += `---\n\n`
                              }
                              
                              // Terraform Validation
                              if (terraformSteps.length > 0) {
                                content += `### ⚙️ Terraform Validation\n\n`
                                terraformSteps.forEach(step => {
                                  content += `${step}\n\n`
                                })
                                content += `---\n\n`
                              }
                              
                              // Git Operations
                              if (gitSteps.length > 0) {
                                content += `### 🌿 Git Operations\n\n`
                                gitSteps.forEach(step => {
                                  content += `${step}\n\n`
                                })
                                content += `---\n\n`
                              }
                              
                              // Final Steps
                              if (finalSteps.length > 0) {
                                content += `### 🎯 Finalization\n\n`
                                finalSteps.forEach(step => {
                                  content += `${step}\n\n`
                                })
                              }
                              
                              // Update the message
                              setMessages(prev => {
                                const updated = [...prev]
                                updated[updated.length - 1] = {
                  role: 'assistant',
                                  content: content,
                  mode: 'agent',
                                  streaming: true
                                }
                                return updated
                              })
                            } else if (data.type === 'complete') {
                              finalData = data
                              break
                            } else if (data.type === 'error') {
                              throw new Error(data.message || 'Stream error')
                            }
                          } catch (e) {
                            console.warn('Failed to parse SSE line:', line)
                          }
                        }
                      }
                    }
                  }

                  if (!finalData || !finalData.success) {
                    throw new Error(finalData?.message || 'PR creation failed')
                  }
                  
                  if (!finalData.pr_url) {
                    throw new Error('PR creation completed but no PR URL returned')
                  }
                  
                  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
                  
                  // Open GitHub PR creation page in new tab
                  window.open(finalData.pr_url, '_blank')
                  
                  // Log PR to tracking database
                  try {
                    await fetch(getApiEndpoint('/prs/log'), {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                      },
                      body: JSON.stringify({
                        repo_owner: owner,
                        repo_name: repo,
                        branch_name: finalData.branch_name || 'unknown',
                        commit_message: 'Infrastructure changes via Infrara',
                        pr_url: finalData.pr_url,
                        files_changed: acceptedProposals.map(p => p.path),
                        files_added: acceptedProposals.filter(p => p.action === 'create').map(p => p.path),
                        files_modified: acceptedProposals.filter(p => p.action === 'edit').map(p => p.path),
                        terraform_valid: finalData.terraform_valid !== false,
                        created_via: 'web'
                      })
                    })
                    console.log('✅ [PR Tracking] PR logged to database')
                  } catch (logError) {
                    console.warn('⚠️  [PR Tracking] Failed to log PR:', logError)
                    // Don't fail the entire flow if logging fails
                  }
                  
                  // Categorize final steps for display
                  const detectionSteps = statusSteps.filter(s => s.includes('Detecting') || s.includes('Detected repo'))
                  const terraformSteps = statusSteps.filter(s => s.includes('terraform') || s.includes('Running') || s.includes('fmt') || s.includes('validate'))
                  const gitSteps = statusSteps.filter(s => s.includes('branch') || s.includes('Commit') || s.includes('GitHub') || s.includes('Push') || s.includes('Authenticat'))
                  const finalSteps = statusSteps.filter(s => s.includes('Generating') || s.includes('Ready'))
                  
                  // Update with final success message
                  let finalContent = `## ✅ Deployment Successful\n\n`
                  finalContent += `**Repository:** ${owner}/${repo}\n\n`
                  finalContent += `**Branch:** \`${finalData.branch_name}\`\n\n`
                  finalContent += `**Duration:** ${duration}s\n\n`
                  finalContent += `---\n\n`
                  
                  // Repository Detection
                  if (detectionSteps.length > 0) {
                    finalContent += `### 📦 Repository\n\n`
                    detectionSteps.forEach(step => {
                      finalContent += `${step}\n\n`
                    })
                  }
                  
                  // Terraform Validation
                  if (terraformSteps.length > 0) {
                    finalContent += `### ⚙️ Terraform Validation\n\n`
                    terraformSteps.forEach(step => {
                      finalContent += `${step}\n\n`
                    })
                  }
                  
                  // Git Operations
                  if (gitSteps.length > 0) {
                    finalContent += `### 🌿 Git Operations\n\n`
                    gitSteps.forEach(step => {
                      finalContent += `${step}\n\n`
                    })
                  }
                  
                  // Final Steps
                  if (finalSteps.length > 0) {
                    finalContent += `### 🎯 Finalization\n\n`
                    finalSteps.forEach(step => {
                      finalContent += `${step}\n\n`
                    })
                  }
                  
                  finalContent += `---\n\n`
                  finalContent += `### 🚀 Next Steps\n\n`
                  finalContent += `Your changes have been pushed to GitHub. A new browser tab should open to create your pull request.\n\n`
                  finalContent += `[**→ Create Pull Request on GitHub**](${finalData.pr_url})\n\n`
                  
                  setMessages(prev => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                    role: 'assistant',
                      content: finalContent,
                    mode: 'agent',
                    streaming: false
                    }
                    return updated
                  })
                  
                  // Mark PR as created to hide the button
                  setPrCreated(true)
                  
                  // Clear accepted proposals so new proposals can trigger a new PR
                  if (onClearAcceptedProposalsRef?.current) {
                    console.log('🧹 [ChatPanel] Clearing accepted proposals after PR')
                    onClearAcceptedProposalsRef.current()
                  }
                  
                  // Refresh git status to clear yellow indicators (files are now committed)
                  if (onRefreshGitStatusRef?.current) {
                    console.log('🔄 [ChatPanel] Refreshing git status after PR creation')
                    onRefreshGitStatusRef.current()
                  }
                  
                  // Refresh file tree to show new files
                  if (onRefreshFileTreeRef?.current) {
                    console.log('🔄 [ChatPanel] Refreshing file tree after PR creation')
                    onRefreshFileTreeRef.current()
                  }
                  
                  // Poll repo list every 10s until new repo appears (with fallback direct check)
                  if (onRefreshRepoListRef?.current && selectedRepo) {
                    const targetRepo = selectedRepo.full_name
                    const [owner, repo] = targetRepo.split('/')
                    let pollCount = 0
                    const maxPolls = 15 // Stop after 150 seconds (15 * 10s)
                    
                    console.log('🔄 [ChatPanel] Starting repo polling for:', targetRepo)
                    
                    const pollInterval = setInterval(async () => {
                      pollCount++
                      console.log(`🔄 [ChatPanel] Repo poll #${pollCount}/${maxPolls} (checking if ${targetRepo} exists)`)
                      
                      // Method 1: Check in repo list
                      if (onRefreshRepoListRef?.current) {
                        const repos = await onRefreshRepoListRef.current()
                        
                        if (repos && Array.isArray(repos)) {
                          const found = repos.find((r: any) => r.full_name === targetRepo)
                          if (found) {
                            clearInterval(pollInterval)
                            console.log(`✅ [ChatPanel] Repo found in list at position ${repos.indexOf(found)}/${repos.length}! Stopped polling.`)
                            return
                          }
                          console.log(`   📊 Checked ${repos.length} repos - ${targetRepo} not found yet`)
                        }
                      }
                      
                      // Method 2: Direct GitHub API check (fallback) - try after 5 attempts
                      if (pollCount >= 5 && user?.github_access_token) {
                        try {
                          const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
                            headers: {
                              'Authorization': `Bearer ${user.github_access_token}`,
                              'Accept': 'application/vnd.github.v3+json'
                            }
                          })
                          
                          if (response.ok) {
                            clearInterval(pollInterval)
                            console.log(`✅ [ChatPanel] Repo exists (verified via direct GitHub API)! Stopped polling.`)
                            console.log(`   💡 The repo exists but GitHub's list API is slow. Triggering one final refresh...`)
                            // One final refresh to get it in the list
                            if (onRefreshRepoListRef?.current) {
                              await onRefreshRepoListRef.current()
                            }
                            return
                          }
                        } catch (err) {
                          console.log(`   🔍 Direct check failed:`, err)
                        }
                      }
                      
                      // Stop polling after max attempts
                      if (pollCount >= maxPolls) {
                        clearInterval(pollInterval)
                        console.log('⏱️  [ChatPanel] Stopped polling after', pollCount, 'attempts')
                        console.log('   💡 Try refreshing the page or manually selecting the repo from the dropdown')
                      }
                    }, 10000) // Poll every 10 seconds (faster than before)
                  }
                } catch (error: any) {
                  console.error('Failed to create PR:', error)
                  
                  // Check if this is a validation/fmt error - if so, clear all code and hide PR button
                  const isValidationError = error.message.toLowerCase().includes('validation') || 
                                            error.message.toLowerCase().includes('terraform fmt') ||
                                            error.message.toLowerCase().includes('invalid') ||
                                            error.message.toLowerCase().includes('unterminated') ||
                                            error.message.toLowerCase().includes('multi-line string')
                  
                  if (isValidationError) {
                    // VALIDATION ERROR: Delete files, unstage everything, full clean slate
                    console.error('❌ [Validation Error - Web] Full cleanup - deleting files, unstaging git, removing from tree')
                    console.error('[Validation Error Details]', error.message)
                    
                    // Get workspace path
                    const [owner, repo] = selectedRepo.full_name.split('/')
                    
                    try {
                      // 1. Delete generated files from disk
                      const filesToDelete = Array.from(filesOpenedFromDiff)
                      console.log('🗑️  [Validation Error - Web] Deleting files:', filesToDelete)
                      
                      for (const filePath of filesToDelete) {
                        try {
                          const deleteResponse = await fetch(getApiEndpoint('/local/delete-file'), {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({
                              repo_owner: owner,
                              repo_name: repo,
                              file_path: filePath
                            })
                          })
                          
                          if (!deleteResponse.ok) {
                            console.warn(`⚠️  Failed to delete ${filePath}`)
                          } else {
                            console.log(`✅ Deleted ${filePath}`)
                          }
                        } catch (deleteError) {
                          console.warn(`⚠️  Error deleting ${filePath}:`, deleteError)
                        }
                      }
                      
                      // 2. Unstage everything (git reset)
                      console.log('🧹 [Validation Error - Web] Unstaging all changes')
                      try {
                        const unstageResponse = await fetch(getApiEndpoint('/local/git-reset'), {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                          },
                          body: JSON.stringify({
                            repo_owner: owner,
                            repo_name: repo
                          })
                        })
                        
                        if (unstageResponse.ok) {
                          console.log('✅ Git staging area cleared')
                        }
                      } catch (resetError) {
                        console.warn('⚠️  Error resetting git:', resetError)
                      }
                      
                      // 3. Close files in editor
                      if (filesToDelete.length > 0 && onCloseFilesRef?.current) {
                        console.log('📄 [Validation Error - Web] Closing files in editor')
                        onCloseFilesRef.current(filesToDelete)
                      }
                      
                      // 4. Refresh file tree to remove deleted files
                      if (onRefreshFileTreeRef?.current) {
                        console.log('🌳 [Validation Error - Web] Refreshing file tree')
                        onRefreshFileTreeRef.current()
                      }
                      
                      // 5. Refresh git status
                      if (onRefreshGitStatusRef?.current) {
                        console.log('🔄 [Validation Error - Web] Refreshing git status')
                        onRefreshGitStatusRef.current()
                      }
                      
                      setFilesOpenedFromDiff(new Set()) // Clear tracking
                    } catch (cleanupError) {
                      console.error('❌ [Validation Error - Web] Cleanup failed:', cleanupError)
                    }
                    
                    // Extract first few lines of error for summary
                    const errorLines = error.message.split('\n').slice(0, 3)
                    const errorSummary = errorLines.join('\n')
                    
                    // Clear file proposals and hide PR button
                    setMessages(prev => {
                      const updated = [...prev]
                      updated[updated.length - 1] = {
                        role: 'assistant',
                        content: `## ❌ Terraform Validation Failed\n\n` +
                                 `The generated infrastructure code has validation errors:\n\n` +
                                 `\`\`\`\n${errorSummary}${errorLines.length < error.message.split('\n').length ? '\n...(more errors)' : ''}\n\`\`\`\n\n` +
                                 `---\n\n` +
                                 `### 🔄 Please Try Again\n\n` +
                                 `The generated code has been cleared. Please:\n\n` +
                                 `1. **Refine your prompt** to be more specific\n` +
                                 `2. **Try a simpler request** first, then add complexity\n` +
                                 `3. **Send a new message** to generate fresh infrastructure\n\n` +
                                 `💡 Tip: Breaking complex infrastructure into smaller chunks often works better!`,
                        mode: 'agent',
                        streaming: false
                        // fileProposals: undefined - don't include file proposals
                      }
                      return updated
                    })
                    
                    // Hide PR button by marking as created
                    setPrCreated(true)
                    return // Exit early
                  }
                  
                  // NON-VALIDATION ERROR: Keep code and button for retry
                  console.log('💡 [PR] Button remains visible for retry - files can be edited and retried')
                  setPrCreated(false)
                  setMessages(prev => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                    role: 'assistant',
                      content: `## ❌ Failed to create pull request\n\n` +
                               `Error: ${error.message}\n\n` +
                               `---\n\n` +
                               `### 🔄 How to Fix & Retry\n\n` +
                               `1. **Open the file(s)** in the editor (click them in the file tree)\n` +
                               `2. **Fix the errors** shown above\n` +
                               `3. **Save your changes** (Cmd/Ctrl + S)\n` +
                               `4. **Click the PR button again** to retry\n\n` +
                               `The button will use your updated file contents automatically! ✨`,
                    mode: 'agent',
                    streaming: false,
                    fileProposal: messages[messages.length - 1]?.fileProposal // Keep file proposals for manual fixing
                    }
                    return updated
                  })
                }
              }}
              className="w-full relative overflow-hidden rounded-lg shadow-md shadow-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/30 transition-all group"
            >
              {/* Animated gradient background */}
              <div 
                className="absolute inset-0 rounded-lg bg-gradient-to-r from-emerald-600 via-green-600 to-emerald-600 transition-all duration-300 group-hover:scale-105"
                style={{
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 3s ease-in-out infinite',
                  boxShadow: '0 0 20px rgba(16, 185, 129, 0.2)'
                }}
              />
              
              {/* Glow effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-400/0 via-emerald-400/30 to-emerald-400/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl" />
              
              {/* Content */}
              <div className="relative flex items-center justify-center gap-1.5 px-3 py-2 text-white text-sm font-semibold tracking-wide">
                <div className="relative">
                  <div className="absolute inset-0 bg-white blur-sm opacity-0 group-hover:opacity-50 transition-opacity" />
                  <i className="codicon codicon-check relative" style={{ fontSize: 14 }} />
                </div>
                <span className="relative">Push & Create Pull Request</span>
                <svg className="w-3 h-3 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </div>
              
              {/* Border shine effect */}
              <div className="absolute inset-0 rounded-lg border border-white/20 group-hover:border-white/30 transition-colors" />
              
              <style jsx>{`
                @keyframes shimmer {
                  0%, 100% {
                    background-position: 0% 50%;
                  }
                  50% {
                    background-position: 100% 50%;
                  }
                }
              `}</style>
            </button>
          </div>
        )}
      </div>
      )}

      {/* Input - Hide when in team chat mode since TeamChat has its own input */}
      {mode !== 'team' && (
      <div className="p-4">
        <div className={`rainbow-border-wrapper ${messages.some(m => m.role === 'user') ? 'outline-only' : ''} p-[2px]`}>
          <div className={`relative bg-gradient-to-b from-[#1a1a1a]/80 to-[#1a1a1a]/90 backdrop-blur-sm rounded-[8px] px-3 py-2 transition-all duration-500 border border-[#2a2a2a] ${
            isSending ? 'scale-[0.98] opacity-80' : 'scale-100 opacity-100'
          }`}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              adjustTextareaHeight()
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={mode === 'agent' && !selectedRepo ? "⚠️ Select a repository first..." : "Ask anything..."}
            rows={1}
            className="w-full bg-transparent border-none text-[13px] text-text-primary resize-none focus:outline-none focus:ring-0 pb-6 placeholder:text-gray-500"
            disabled={isStreaming}
            style={{ 
              background: 'transparent',
              boxShadow: 'none',
              outline: 'none',
              border: 'none',
              maxHeight: '200px',
              overflowY: 'auto'
            }}
          />
          
          {/* Mode Dropdown - Bottom Left Inside Input */}
          <div className="absolute bottom-2 left-3 z-[101] mode-dropdown-container">
            <div className="relative">
              <button
                onClick={() => setIsModeDropdownOpen(!isModeDropdownOpen)}
                aria-label="Mode selector"
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] bg-[var(--cursor-accent)]/20 text-gray-400 hover:text-gray-300 transition-colors border border-gray-700 pointer-events-auto"
              >
                {mode === 'ask' ? <i className="codicon codicon-comment" style={{ fontSize: 11 }} /> : 
                 mode === 'agent' ? <i className="codicon codicon-symbol-namespace" style={{ fontSize: 11 }} /> :
                 <i className="codicon codicon-organization" style={{ fontSize: 11 }} />}
                {mode === 'ask' ? 'Ask' : mode === 'agent' ? 'Agent' : 'Team'}
                <i className="codicon codicon-chevron-down" style={{ fontSize: 11 }} />
              </button>
              
              {/* Dropdown Menu - Cursor Style */}
              {isModeDropdownOpen && (
                <div className="absolute bottom-full left-0 mb-2 bg-[#1e1e1e] border border-[#3e3e42] rounded-lg shadow-2xl overflow-hidden w-[160px] z-[100] pointer-events-auto mode-dropdown-container">
                  <div className="p-1">
                    {/* Agent Option */}
                    <button
                      onClick={() => {
                        setMode('agent')
                        setIsModeDropdownOpen(false)
                        setDropdownFocusedIndex(null)
                      }}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-all ${
                        mode === 'agent' 
                          ? 'bg-[#2a2a2a] text-white' 
                          : dropdownFocusedIndex === 0
                          ? 'bg-[#252525] text-gray-200'
                          : 'text-gray-400 hover:bg-[#252525] hover:text-gray-200'
                      }`}
                    >
                      <i className="codicon codicon-symbol-namespace" style={{ fontSize: 13 }} />
                      <div className="flex-1 text-left text-[11px] font-medium">Agent</div>
                      {mode === 'agent' && (
                        <i className="codicon codicon-check text-gray-400" style={{ fontSize: 11 }} />
                      )}
                    </button>
                    
                    {/* Ask Option */}
                    <button
                      onClick={() => {
                        setMode('ask')
                        setIsModeDropdownOpen(false)
                        setDropdownFocusedIndex(null)
                      }}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-all mt-0.5 ${
                        mode === 'ask' 
                          ? 'bg-[#2a2a2a] text-white' 
                          : dropdownFocusedIndex === 1
                          ? 'bg-[#252525] text-gray-200'
                          : 'text-gray-400 hover:bg-[#252525] hover:text-gray-200'
                      }`}
                    >
                      <i className="codicon codicon-comment" style={{ fontSize: 13 }} />
                      <div className="flex-1 text-left text-[11px] font-medium">Ask</div>
                      {mode === 'ask' && (
                        <i className="codicon codicon-check text-gray-400" style={{ fontSize: 11 }} />
                      )}
                    </button>
                    
                    {/* Team Chat Option - Only show when in a team workspace */}
                    {currentTeamId && (
                      <button
                        onClick={() => {
                          setMode('team')
                          setIsModeDropdownOpen(false)
                          setDropdownFocusedIndex(null)
                        }}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-all mt-0.5 ${
                          (mode as 'ask' | 'agent' | 'team') === 'team' 
                            ? 'bg-[#2a2a2a] text-white' 
                            : dropdownFocusedIndex === 2
                            ? 'bg-[#252525] text-gray-200'
                            : 'text-gray-400 hover:bg-[#252525] hover:text-gray-200'
                        }`}
                      >
                        <i className="codicon codicon-organization" style={{ fontSize: 13 }} />
                        <div className="flex-1 text-left text-[11px] font-medium">Team</div>
                        {teamChatMessages.length > 0 && (mode as 'ask' | 'agent' | 'team') !== 'team' && (
                          <span className="bg-purple-500 text-white text-[9px] px-1 rounded-full">
                            {teamChatMessages.length > 99 ? '99+' : teamChatMessages.length}
                          </span>
                        )}
                        {(mode as 'ask' | 'agent' | 'team') === 'team' && (
                          <i className="codicon codicon-check text-gray-400" style={{ fontSize: 11 }} />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Cloud Provider Toggle - Show in both Ask and Agent modes */}
          <div 
            className="absolute bottom-2"
            style={{ display: (mode === 'ask' || mode === 'agent') ? 'block' : 'none', left: '105px' }}
          >
            <button
              onClick={() => setCloudProvider(cloudProvider === 'aws' ? 'digitalocean' : 'aws')}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-[#252525] text-gray-400 hover:text-gray-300 transition-colors border border-gray-600"
              title={`Switch to ${cloudProvider === 'aws' ? 'DigitalOcean' : 'AWS'}`}
            >
              <span className={cloudProvider === 'aws' ? 'text-[#FF9900]' : 'text-[#0080FF]'}>
                {cloudProvider === 'aws' ? '☁️' : '💧'}
              </span>
              <span>{cloudProvider === 'aws' ? 'AWS' : 'DO'}</span>
            </button>
          </div>

          {/* Terraform Icon - Next to Send Button */}
          <span
            className="iconify absolute bottom-3 right-14"
            data-icon="vscode-icons:file-type-terraform"
            data-inline="false"
            style={{
              fontSize: 20,
              width: 20,
              height: 20,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          />

          {/* Send Button - Bottom Right (Round Arrow with ring) */}
          <div className="absolute bottom-2 right-3">
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming || (mode === 'agent' && !selectedRepo)}
              className={`relative w-8 h-8 flex items-center justify-center bg-gradient-to-r from-[#8844cc] to-[#ec4899] text-white rounded-full disabled:opacity-30 disabled:cursor-not-allowed hover:scale-110 transition-all duration-300 ${
                isSending ? 'scale-110 -rotate-[20deg]' : 'scale-100 rotate-0'
              }`}
              title={mode === 'agent' && !selectedRepo ? 'Please select a repository first' : 'Send message'}
            >
              {/* Outer ring */}
              <div className="absolute inset-0 rounded-full border-2 border-[#8844cc]/30 animate-pulse" style={{ width: '40px', height: '40px', left: '-4px', top: '-4px' }} />
              
              <i className="codicon codicon-send relative z-10" style={{ fontSize: 14 }} />
            </button>
          </div>
          </div>
        </div>
      </div>
      )}

      {/* Context Menu for Template Explanations */}
      {contextMenu && contextMenu.visible && (
        <div
          className="fixed z-[10000] bg-[#1a1a1a] border border-white/20 rounded-lg shadow-2xl max-w-md overflow-hidden"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-4 py-3 bg-[#252526] border-b border-white/10 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">{contextMenu.title}</h3>
            <button
              onClick={() => setContextMenu(null)}
              className="text-white/50 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Content */}
          <div className="px-4 py-4 max-h-[500px] overflow-y-auto">
            <div className="text-sm text-white/80 leading-relaxed whitespace-pre-line">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
                  ul: ({ children }) => <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>,
                  li: ({ children }) => <li className="text-white/70">{children}</li>,
                  h3: ({ children }) => <h3 className="text-white font-semibold mt-4 mb-2 first:mt-0">{children}</h3>
                }}
              >
                {contextMenu.explanation}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

