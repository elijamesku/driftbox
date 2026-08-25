'use client'

/**
 * TeamWiki - AI-powered documentation for team repositories
 * Makes infrastructure understandable for anyone - technical or not
 */

import { useState, useEffect, useMemo } from 'react'
import { 
  Book, Search, ChevronRight, ChevronDown,
  Zap, Brain, ToggleLeft, ToggleRight,
  RefreshCw, Clock, Users, Shield, DollarSign, AlertTriangle,
  CheckCircle, ExternalLink, Copy, Sparkles, BookOpen,
  Code, FileText, Database, Cloud, Server, Lock, Unlock,
  Download, FileDown, X, Plus, GitBranch, Settings, Check
} from 'lucide-react'
import { getApiEndpoint } from '@/utils/apiEndpoint'
import { FileIcon } from './swag/FileIcon'

// GitHub Actions templates
const GITHUB_ACTIONS_TEMPLATES = {
  'terraform-plan': {
    name: 'Terraform Plan',
    description: 'Run terraform plan on pull requests',
    category: 'terraform',
    template: `name: Terraform Plan

on:
  pull_request:
    branches: [main, master]
    paths:
      - '**.tf'
      - '**.tfvars'

permissions:
  contents: read
  pull-requests: write

jobs:
  terraform-plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.6.0
      
      - name: Terraform Init
        run: terraform init
      
      - name: Terraform Plan
        run: terraform plan -no-color
        continue-on-error: true
`
  },
  'terraform-apply': {
    name: 'Terraform Apply',
    description: 'Apply terraform changes on merge to main',
    category: 'terraform',
    template: `name: Terraform Apply

on:
  push:
    branches: [main, master]
    paths:
      - '**.tf'
      - '**.tfvars'

permissions:
  contents: read

jobs:
  terraform-apply:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.6.0
      
      - name: Terraform Init
        run: terraform init
      
      - name: Terraform Apply
        run: terraform apply -auto-approve
`
  },
  'terraform-oidc-aws': {
    name: 'Terraform with AWS OIDC',
    description: 'Secure AWS authentication using OIDC (no secrets needed)',
    category: 'terraform',
    template: `name: Terraform with AWS OIDC

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

# IMPORTANT: Configure these in your GitHub repository settings
# Go to: Settings > Secrets and variables > Actions > Variables
# Required variables:
#   AWS_ROLE_ARN: arn:aws:iam::YOUR_ACCOUNT_ID:role/YOUR_ROLE_NAME
#   AWS_REGION: us-east-1 (or your preferred region)

permissions:
  id-token: write   # Required for OIDC
  contents: read
  pull-requests: write

env:
  # PLACEHOLDER: Replace with your values or use GitHub Variables
  AWS_ROLE_ARN: \${{ vars.AWS_ROLE_ARN || 'arn:aws:iam::ACCOUNT_ID:role/ROLE_NAME' }}
  AWS_REGION: \${{ vars.AWS_REGION || 'us-east-1' }}

jobs:
  terraform:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Configure AWS Credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ env.AWS_ROLE_ARN }}
          aws-region: \${{ env.AWS_REGION }}
      
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.6.0
      
      - name: Terraform Init
        run: terraform init
      
      - name: Terraform Plan
        if: github.event_name == 'pull_request'
        run: terraform plan -no-color
      
      - name: Terraform Apply
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        run: terraform apply -auto-approve
`
  },
  'terraform-oidc-gcp': {
    name: 'Terraform with GCP OIDC',
    description: 'Secure GCP authentication using Workload Identity Federation',
    category: 'terraform',
    template: `name: Terraform with GCP OIDC

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

# IMPORTANT: Configure these in your GitHub repository settings
# Go to: Settings > Secrets and variables > Actions > Variables
# Required variables:
#   GCP_WORKLOAD_IDENTITY_PROVIDER: projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID
#   GCP_SERVICE_ACCOUNT: SERVICE_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com
#   GCP_PROJECT_ID: your-project-id

permissions:
  id-token: write   # Required for OIDC
  contents: read
  pull-requests: write

env:
  # PLACEHOLDER: Replace with your values or use GitHub Variables
  WORKLOAD_IDENTITY_PROVIDER: \${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER || 'projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID' }}
  SERVICE_ACCOUNT: \${{ vars.GCP_SERVICE_ACCOUNT || 'SERVICE_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com' }}
  PROJECT_ID: \${{ vars.GCP_PROJECT_ID || 'your-project-id' }}

jobs:
  terraform:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Authenticate to Google Cloud (OIDC)
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: \${{ env.WORKLOAD_IDENTITY_PROVIDER }}
          service_account: \${{ env.SERVICE_ACCOUNT }}
      
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.6.0
      
      - name: Terraform Init
        run: terraform init
      
      - name: Terraform Plan
        if: github.event_name == 'pull_request'
        run: terraform plan -no-color
      
      - name: Terraform Apply
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        run: terraform apply -auto-approve
`
  },
  'terraform-oidc-azure': {
    name: 'Terraform with Azure OIDC',
    description: 'Secure Azure authentication using Federated Credentials',
    category: 'terraform',
    template: `name: Terraform with Azure OIDC

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

# IMPORTANT: Configure these in your GitHub repository settings
# Go to: Settings > Secrets and variables > Actions > Variables
# Required variables:
#   AZURE_CLIENT_ID: Your Azure AD App Registration Client ID
#   AZURE_TENANT_ID: Your Azure AD Tenant ID
#   AZURE_SUBSCRIPTION_ID: Your Azure Subscription ID

permissions:
  id-token: write   # Required for OIDC
  contents: read
  pull-requests: write

env:
  # PLACEHOLDER: Replace with your values or use GitHub Variables
  ARM_CLIENT_ID: \${{ vars.AZURE_CLIENT_ID || 'YOUR_CLIENT_ID' }}
  ARM_TENANT_ID: \${{ vars.AZURE_TENANT_ID || 'YOUR_TENANT_ID' }}
  ARM_SUBSCRIPTION_ID: \${{ vars.AZURE_SUBSCRIPTION_ID || 'YOUR_SUBSCRIPTION_ID' }}
  ARM_USE_OIDC: true

jobs:
  terraform:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: \${{ env.ARM_CLIENT_ID }}
          tenant-id: \${{ env.ARM_TENANT_ID }}
          subscription-id: \${{ env.ARM_SUBSCRIPTION_ID }}
      
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.6.0
      
      - name: Terraform Init
        run: terraform init
      
      - name: Terraform Plan
        if: github.event_name == 'pull_request'
        run: terraform plan -no-color
      
      - name: Terraform Apply
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        run: terraform apply -auto-approve
`
  },
  'terraform-security': {
    name: 'Terraform Security Scan',
    description: 'Run security checks with tfsec and checkov',
    category: 'security',
    template: `name: Terraform Security Scan

on:
  pull_request:
    branches: [main, master]
    paths:
      - '**.tf'

jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run tfsec
        uses: aquasecurity/tfsec-action@v1.0.0
        with:
          soft_fail: true
      
      - name: Run Checkov
        uses: bridgecrewio/checkov-action@v12
        with:
          directory: .
          framework: terraform
          soft_fail: true
`
  },
  'terraform-docs': {
    name: 'Terraform Docs',
    description: 'Auto-generate documentation from Terraform',
    category: 'docs',
    template: `name: Terraform Docs

on:
  pull_request:
    branches: [main, master]
    paths:
      - '**.tf'

permissions:
  contents: write
  pull-requests: write

jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.ref }}
      
      - name: Render terraform docs
        uses: terraform-docs/gh-actions@v1.0.0
        with:
          working-dir: .
          output-file: README.md
          output-method: inject
          git-push: "true"
`
  },
  'infracost': {
    name: 'Infracost',
    description: 'Show cloud cost estimates in pull requests',
    category: 'cost',
    template: `name: Infracost

on:
  pull_request:
    branches: [main, master]
    paths:
      - '**.tf'
      - '**.tfvars'

# IMPORTANT: Add INFRACOST_API_KEY to your repository secrets
# Get your free API key at: https://www.infracost.io/

permissions:
  contents: read
  pull-requests: write

jobs:
  infracost:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Infracost
        uses: infracost/actions/setup@v3
        with:
          api-key: \${{ secrets.INFRACOST_API_KEY }}
      
      - name: Generate Infracost JSON
        run: infracost breakdown --path=. --format=json --out-file=/tmp/infracost.json
      
      - name: Post Infracost comment
        run: |
          infracost comment github --path=/tmp/infracost.json \\
            --repo=\${{ github.repository }} \\
            --github-token=\${{ github.token }} \\
            --pull-request=\${{ github.event.pull_request.number }} \\
            --behavior=update
`
  }
}

type ActionTemplateKey = keyof typeof GITHUB_ACTIONS_TEMPLATES

interface WikiVariable {
  name: string
  type: string
  default?: string
  description?: string
}

interface WikiOutput {
  name: string
  value?: string
  description?: string
}

interface WikiSection {
  title: string
  content: string
  items?: string[]
}

interface WikiFile {
  path: string
  name: string
  type: 'file' | 'folder'
  extension?: string
  children?: WikiFile[]
  explanation?: {
    technical: string
    simple: string
  }
  resources?: Array<{
    type: string
    name: string
    explanation: {
      technical: string
      simple: string
    }
    attributes?: Record<string, string>
    dependencies?: string[]
  }>
  variables?: WikiVariable[]
  outputs?: WikiOutput[]
  sections?: WikiSection[]
  providers?: string[]
  modules?: Array<{ name: string; source?: string }>
  dependencies?: string[]
  line_count?: number
  security?: {
    score: number
    issues: string[]
  }
  cost?: {
    estimate: string
    breakdown: string
  }
}

interface WikiRepo {
  id: string
  repo_full_name: string
  repo_owner: string
  repo_name: string
  lastGenerated?: string
  files?: WikiFile[]
  summary?: {
    technical: string
    simple: string
  }
  stats?: {
    totalFiles: number
    resources: number
    estimatedCost: string
    securityScore: number
  }
}

interface TeamWikiProps {
  teamId?: string
  repositories: Array<{
    id: string
    repo_full_name: string
    repo_owner: string
    repo_name: string
  }>
  // For panel mode (split screen in IDE)
  panelMode?: boolean
  selectedRepoFullName?: string
  onClose?: () => void
}

export default function TeamWiki({ teamId, repositories, panelMode = false, selectedRepoFullName, onClose }: TeamWikiProps) {
  const [selectedRepo, setSelectedRepo] = useState<string | null>(selectedRepoFullName || null)
  const [isRepoDropdownOpen, setIsRepoDropdownOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(288) // 288px = w-72
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false)
  const [wikiData, setWikiData] = useState<Record<string, WikiRepo>>({})
  const [isSimpleMode, setIsSimpleMode] = useState(true) // Default to simple for non-technical users
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<WikiFile | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatingRepo, setGeneratingRepo] = useState<string | null>(null)
  
  // GitHub Actions state (for Wiki internal use)
  const [showActionsModal, setShowActionsModal] = useState(false)
  const [selectedActions, setSelectedActions] = useState<Set<ActionTemplateKey>>(new Set())
  const [generatedYaml, setGeneratedYaml] = useState<string | null>(null)

  // Auto-select first repo
  useEffect(() => {
    if (repositories.length > 0 && !selectedRepo) {
      setSelectedRepo(repositories[0].repo_full_name)
    }
  }, [repositories, selectedRepo])

  // Generate wiki for a repo
  const generateWiki = async (repoFullName: string) => {
    setIsGenerating(true)
    setGeneratingRepo(repoFullName)
    
    try {
      const token = localStorage.getItem('token')
      const [owner, repo] = repoFullName.split('/')
      
      // Try to get files from Electron/desktop mode
      let fileContents: Array<{ path: string; content: string }> = []
      
      // Check if we're in Electron/desktop mode
      const electronAPI = (window as any).electronAPI
      if (electronAPI?.getFileTree && electronAPI?.readFile) {
        console.log('📚 Wiki: Using Electron to read files...')
        try {
          // Get the repo path - try multiple methods
          let repoPath: string | null = null
          
          // Method 1: getRepoPath
          if (electronAPI.getRepoPath) {
            const result = await electronAPI.getRepoPath(owner, repo)
            // Handle both string and object return types
            if (typeof result === 'string') {
              repoPath = result
            } else if (result?.success && result?.path) {
              repoPath = result.path
            }
          }
          
          // Method 2: Check standard locations
          if (!repoPath && electronAPI.fileExists) {
            const possiblePaths = [
              `${process.env.HOME || '~'}/.driftbox/repos/${owner}/${repo}`,
              `${process.env.HOME || '~'}/.infrara/repos/${owner}/${repo}`,
            ]
            for (const p of possiblePaths) {
              if (await electronAPI.fileExists(p)) {
                repoPath = p
                break
              }
            }
          }
          
          console.log('📚 Wiki: Repo path:', repoPath)
          
          if (repoPath && typeof repoPath === 'string') {
            // Get file tree - pass owner, repo, empty dirPath (Electron builds path internally)
            const treeResult = await electronAPI.getFileTree(owner, repo, '')
            console.log('📚 Wiki: File tree result:', treeResult)
            
            if (treeResult?.success && treeResult?.items) {
              // Recursively collect ALL code files (not just .tf)
              const collectFiles = async (items: any[], basePath: string = ''): Promise<void> => {
                for (const item of items) {
                  const itemPath = basePath ? `${basePath}/${item.name}` : item.name
                  
                  // Include .tf, .json, .yaml, .yml, .md files
                  const codeExtensions = ['.tf', '.json', '.yaml', '.yml', '.md', '.hcl', '.tfvars']
                  const isCodeFile = codeExtensions.some(ext => item.name.endsWith(ext))
                  
                  if (item.type === 'file' && isCodeFile) {
                    try {
                      // readFile expects (owner, repo, filePath), returns { success, content }
                      const result = await electronAPI.readFile(owner, repo, itemPath)
                      if (result?.success && result?.content) {
                        fileContents.push({ path: itemPath, content: result.content })
                        console.log(`📚 Wiki: Read file ${itemPath} (${result.content.length} chars)`)
                      }
                    } catch (e) {
                      console.warn(`Failed to read file ${itemPath}:`, e)
                    }
                  } else if (item.type === 'folder') {
                    // Need to fetch children for folders - getFileTree only returns top level
                    const subTreeResult = await electronAPI.getFileTree(owner, repo, itemPath)
                    if (subTreeResult?.success && subTreeResult?.items) {
                      await collectFiles(subTreeResult.items, itemPath)
                    }
                  }
                }
              }
              await collectFiles(treeResult.items)
            }
          }
        } catch (e) {
          console.warn('Failed to read files from desktop:', e)
        }
      }
      
      // If no files from Electron, try GitHub API
      if (fileContents.length === 0) {
        console.log('📚 Wiki: Falling back to GitHub API...')
        try {
          const ghToken = localStorage.getItem('github_token')
          if (ghToken) {
            // Try main branch first, then master
            let treeData = null
            for (const branch of ['main', 'master']) {
              try {
                const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, {
                  headers: { Authorization: `token ${ghToken}` }
                })
                if (treeRes.ok) {
                  treeData = await treeRes.json()
                  console.log(`📚 Wiki: Got tree from ${branch} branch`)
                  break
                }
              } catch (e) {
                continue
              }
            }
            
            if (treeData?.tree) {
              // Get all code files
              const codeExtensions = ['.tf', '.json', '.yaml', '.yml', '.md', '.hcl', '.tfvars']
              const codeFiles = treeData.tree.filter((f: any) => 
                f.type === 'blob' && codeExtensions.some(ext => f.path.endsWith(ext))
              ) || []
              
              console.log(`📚 Wiki: Found ${codeFiles.length} code files in GitHub`)
              
              for (const file of codeFiles.slice(0, 50)) { // Limit to 50 files
                try {
                  const contentRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`, {
                    headers: { Authorization: `token ${ghToken}` }
                  })
                  if (contentRes.ok) {
                    const contentData = await contentRes.json()
                    if (contentData.content) {
                      const content = atob(contentData.content)
                      fileContents.push({ path: file.path, content })
                      console.log(`📚 Wiki: Fetched ${file.path} from GitHub`)
                    }
                  }
                } catch (e) {
                  console.warn(`Failed to fetch ${file.path} from GitHub:`, e)
                }
              }
            }
          }
        } catch (e) {
          console.warn('Failed to fetch files from GitHub:', e)
        }
      }
      
      console.log(`📚 Wiki: Sending ${fileContents.length} files to backend`)
      
      // If we have files, send to backend
      if (fileContents.length > 0) {
        const response = await fetch(getApiEndpoint(`/wiki/generate/${owner}/${repo}`), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            team_id: teamId,
            simple_mode: isSimpleMode,
            files: fileContents
          })
        })
        
        if (response.ok) {
          const data = await response.json()
          console.log('📚 Wiki: Got response:', data)
          setWikiData(prev => ({
            ...prev,
            [repoFullName]: {
              ...repositories.find(r => r.repo_full_name === repoFullName)!,
              ...data,
              lastGenerated: new Date().toISOString()
            }
          }))
          return
        }
      }
      
      // Fallback: generate locally from file contents if we have them
      if (fileContents.length > 0) {
        console.log('📚 Wiki: Generating wiki locally from files...')
        const localWikiFiles: WikiFile[] = fileContents.map(f => {
          const filename = f.path.split('/').pop() || f.path
          const ext = filename.split('.').pop() || ''
          
          // Parse resources from .tf files
          const resources: WikiFile['resources'] = []
          if (ext === 'tf') {
            const resourceMatches = f.content.matchAll(/resource\s+"([^"]+)"\s+"([^"]+)"/g)
            for (const match of resourceMatches) {
              resources.push({
                type: match[1],
                name: match[2],
                explanation: {
                  technical: `Terraform resource ${match[1]} named "${match[2]}"`,
                  simple: `A cloud resource called ${match[2]}`
                }
              })
            }
          }
          
          return {
            path: f.path,
            name: filename,
            type: 'file' as const,
            extension: ext,
            explanation: {
              technical: `Configuration file: ${filename}`,
              simple: getSimpleFileExplanation(filename, ext)
            },
            resources,
            security: { score: 100, issues: [] },
            cost: { estimate: '$0', breakdown: 'Calculated on demand' }
          }
        })
        
        setWikiData(prev => ({
          ...prev,
          [repoFullName]: {
            id: repoFullName,
            repo_full_name: repoFullName,
            repo_owner: owner,
            repo_name: repo,
            files: localWikiFiles,
            summary: {
              technical: `Repository with ${localWikiFiles.length} configuration files`,
              simple: `This repository has ${localWikiFiles.length} files that define your infrastructure`
            },
            stats: {
              totalFiles: localWikiFiles.length,
              resources: localWikiFiles.reduce((sum, f) => sum + (f.resources?.length || 0), 0),
              estimatedCost: '$0/month',
              securityScore: 100
            },
            lastGenerated: new Date().toISOString()
          }
        }))
        return
      }
      
      // Final fallback: demo data
      console.log('Wiki: No files found, using demo data')
      generateDemoWiki(repoFullName)
      
    } catch (error) {
      console.error('Failed to generate wiki:', error)
      generateDemoWiki(repoFullName)
    } finally {
      setIsGenerating(false)
      setGeneratingRepo(null)
    }
  }
  
  // Helper to get simple explanation for common file types
  const getSimpleFileExplanation = (filename: string, ext: string): string => {
    const explanations: Record<string, string> = {
      'main.tf': 'The main setup file - this is where the most important infrastructure is defined.',
      'variables.tf': 'A list of settings you can change - like a configuration menu for your infrastructure.',
      'outputs.tf': 'Shows important information after your infrastructure is created - like addresses and IDs.',
      'providers.tf': 'Tells Terraform which cloud providers to connect to (AWS, Google, DigitalOcean, etc).',
      'terraform.tfvars': 'Your actual settings values - like filling in the blanks in a form.',
      'backend.tf': 'Configures where Terraform saves its memory of what it created.',
      'versions.tf': 'Specifies which versions of tools to use - ensures consistency.',
      'driftbox.md': 'Documentation generated by Driftbox AI explaining this repository.',
      'README.md': 'The main documentation file explaining what this project does.',
    }
    
    if (explanations[filename]) return explanations[filename]
    
    switch (ext) {
      case 'tf': return 'A Terraform configuration file that defines cloud resources.'
      case 'tfvars': return 'Contains variable values for your Terraform configuration.'
      case 'json': return 'A JSON configuration or data file.'
      case 'yaml':
      case 'yml': return 'A YAML configuration file, often used for Kubernetes or CI/CD.'
      case 'md': return 'A documentation file written in Markdown format.'
      case 'hcl': return 'A HashiCorp Configuration Language file.'
      default: return 'A configuration file for your infrastructure.'
    }
  }
  
  // Check if repo has GitHub Actions workflow files
  const hasWorkflowFiles = useMemo(() => {
    const currentWiki = selectedRepo ? wikiData[selectedRepo] : null
    if (!currentWiki?.files) return false
    
    // Check for .github/workflows directory or any .yml files in common locations
    const checkForYml = (files: WikiFile[]): boolean => {
      for (const file of files) {
        if (file.type === 'folder') {
          if (file.name === '.github' || file.name === 'workflows') {
            // Check if this folder contains yml files
            if (file.children && checkForYml(file.children)) return true
          }
          if (file.children && checkForYml(file.children)) return true
        }
        if (file.extension === 'yml' || file.extension === 'yaml') {
          // Check if it's in a workflow path
          if (file.path.includes('.github/workflows') || file.path.includes('workflows/')) {
            return true
          }
        }
      }
      return false
    }
    
    return checkForYml(currentWiki.files)
  }, [selectedRepo, wikiData])
  
  // Toggle action selection
  const toggleAction = (actionKey: ActionTemplateKey) => {
    setSelectedActions(prev => {
      const newSet = new Set(prev)
      if (newSet.has(actionKey)) {
        newSet.delete(actionKey)
      } else {
        newSet.add(actionKey)
      }
      return newSet
    })
    setGeneratedYaml(null) // Reset generated YAML when selection changes
  }
  
  // Generate combined YAML from selected actions
  const generateCombinedYaml = () => {
    if (selectedActions.size === 0) return
    
    // If only one action selected, use it directly
    if (selectedActions.size === 1) {
      const actionKey = Array.from(selectedActions)[0]
      const template = GITHUB_ACTIONS_TEMPLATES[actionKey]
      setGeneratedYaml(template.template)
      return
    }
    
    // For multiple actions, generate separate files note
    let combined = `# ================================================
# IMPORTANT: Create separate workflow files
# ================================================
# GitHub Actions requires each workflow to be in its own file.
# Copy each section below into separate .yml files in:
#   .github/workflows/
#
# Example file names:
${Array.from(selectedActions).map(key => `#   - ${key}.yml`).join('\n')}
# ================================================

`
    
    for (const actionKey of Array.from(selectedActions)) {
      const template = GITHUB_ACTIONS_TEMPLATES[actionKey]
      combined += `# ================================================
# File: .github/workflows/${actionKey}.yml
# ================================================
${template.template}

`
    }
    
    setGeneratedYaml(combined)
  }
  
  // Write workflow file to repo (via Electron)
  const writeWorkflowFile = async () => {
    if (!generatedYaml || !selectedRepo) return
    
    const electronAPI = (window as any).electronAPI
    if (!electronAPI?.writeFile) {
      alert('This feature is only available in the desktop app')
      return
    }
    
    try {
      const [owner, repo] = selectedRepo.split('/')
      
      // Get repo path
      let repoPath: string | null = null
      if (electronAPI.getRepoPath) {
        const result = await electronAPI.getRepoPath(owner, repo)
        if (typeof result === 'string') {
          repoPath = result
        } else if (result?.success && result?.path) {
          repoPath = result.path
        }
      }
      
      if (!repoPath) {
        alert('Could not find repository path')
        return
      }
      
      // Determine filename
      let filename: string
      if (selectedActions.size === 1) {
        const actionKey = Array.from(selectedActions)[0]
        filename = `${actionKey}.yml`
      } else {
        filename = 'combined-workflows.yml'
      }
      
      const workflowPath = `${repoPath}/.github/workflows/${filename}`
      
      // Ensure directory exists
      if (electronAPI.ensureDir) {
        await electronAPI.ensureDir(`${repoPath}/.github/workflows`)
      }
      
      // Write the file
      await electronAPI.writeFile(workflowPath, generatedYaml)
      
      alert(`✅ Workflow file created!\n\nFile: .github/workflows/${filename}\n\nDon't forget to:\n1. Commit and push the file\n2. Configure any required secrets/variables in GitHub`)
      
      setShowActionsModal(false)
      setSelectedActions(new Set())
      setGeneratedYaml(null)
      
      // Regenerate wiki to show new file
      if (selectedRepo) {
        generateWiki(selectedRepo)
      }
    } catch (error) {
      console.error('Failed to write workflow file:', error)
      alert('Failed to create workflow file. Try copying the YAML manually.')
    }
  }

  // Demo wiki data generator
  const generateDemoWiki = (repoFullName: string) => {
    const demoFiles: WikiFile[] = [
      {
        path: 'main.tf',
        name: 'main.tf',
        type: 'file',
        extension: 'tf',
        explanation: {
          technical: 'Root Terraform configuration defining the primary infrastructure resources including VPC, subnets, and core networking components. Uses terraform-aws-modules for standardized resource provisioning.',
          simple: 'This is the main setup file for your cloud infrastructure. Think of it like a blueprint that tells the cloud exactly what servers and networks to create.'
        },
        resources: [
          {
            type: 'aws_vpc',
            name: 'main',
            explanation: {
              technical: 'Creates a Virtual Private Cloud (VPC) with CIDR block 10.0.0.0/16, enabling DNS hostnames and DNS support for internal resource resolution.',
              simple: 'Creates your own private section of the cloud - like having your own private neighborhood where only your servers can talk to each other.'
            }
          },
          {
            type: 'aws_subnet',
            name: 'public',
            explanation: {
              technical: 'Public subnet in availability zone us-east-1a with CIDR 10.0.1.0/24, auto-assigns public IPs for internet-facing resources.',
              simple: 'A section of your cloud neighborhood that can be accessed from the internet - good for websites and APIs that users need to reach.'
            }
          }
        ],
        security: {
          score: 85,
          issues: ['Consider adding VPC flow logs for network monitoring']
        },
        cost: {
          estimate: '$0/month',
          breakdown: 'VPC itself is free, costs come from resources inside it'
        }
      },
      {
        path: 'variables.tf',
        name: 'variables.tf',
        type: 'file',
        extension: 'tf',
        explanation: {
          technical: 'Declares input variables for the Terraform module including environment, region, instance types, and configurable parameters with type constraints and validation.',
          simple: 'This file lists all the settings you can change - like choosing the size of your servers or which region they run in. It\'s like a settings menu for your infrastructure.'
        },
        resources: []
      },
      {
        path: 'outputs.tf',
        name: 'outputs.tf',
        type: 'file',
        extension: 'tf',
        explanation: {
          technical: 'Defines output values exported from this Terraform module, including VPC ID, subnet IDs, and security group references for consumption by other modules.',
          simple: 'After your infrastructure is created, this file shows you the important information you\'ll need - like the addresses of your servers or the IDs of your networks.'
        },
        resources: []
      },
      {
        path: 'modules',
        name: 'modules',
        type: 'folder',
        children: [
          {
            path: 'modules/ec2',
            name: 'ec2',
            type: 'folder',
            children: [
              {
                path: 'modules/ec2/main.tf',
                name: 'main.tf',
                type: 'file',
                extension: 'tf',
                explanation: {
                  technical: 'EC2 module defining launch templates, autoscaling groups, and instance configurations with IMDSv2 enforcement and encrypted EBS volumes.',
                  simple: 'This creates your actual servers (called EC2 instances). It sets up how many servers to run and automatically adds more when you\'re busy.'
                },
                resources: [
                  {
                    type: 'aws_instance',
                    name: 'web',
                    explanation: {
                      technical: 'T3.medium EC2 instance with Amazon Linux 2023 AMI, attached to public subnet with IAM instance profile for SSM access.',
                      simple: 'A medium-sized server running Linux - powerful enough for most websites but not too expensive. It costs about $30/month to run.'
                    }
                  },
                  {
                    type: 'aws_autoscaling_group',
                    name: 'web',
                    explanation: {
                      technical: 'ASG with min 2, max 10 instances, target tracking scaling policy based on CPU utilization at 70% threshold.',
                      simple: 'This automatically adds more servers when your website gets busy, and removes them when it\'s quiet - saving you money!'
                    }
                  }
                ],
                security: {
                  score: 90,
                  issues: []
                },
                cost: {
                  estimate: '$60-300/month',
                  breakdown: '2-10 t3.medium instances at $30/month each'
                }
              }
            ]
          },
          {
            path: 'modules/rds',
            name: 'rds',
            type: 'folder',
            children: [
              {
                path: 'modules/rds/main.tf',
                name: 'main.tf',
                type: 'file',
                extension: 'tf',
                explanation: {
                  technical: 'RDS PostgreSQL module with Multi-AZ deployment, automated backups, and encryption at rest using KMS CMK.',
                  simple: 'This sets up your database - where all your app\'s data is stored. It\'s set up with a backup copy in case something goes wrong.'
                },
                resources: [
                  {
                    type: 'aws_db_instance',
                    name: 'main',
                    explanation: {
                      technical: 'db.t3.medium PostgreSQL 15 instance with 100GB gp3 storage, 7-day backup retention, and performance insights enabled.',
                      simple: 'Your database server that stores all your data. It automatically backs up every day and keeps backups for a week.'
                    }
                  }
                ],
                security: {
                  score: 95,
                  issues: []
                },
                cost: {
                  estimate: '$50-100/month',
                  breakdown: 'db.t3.medium: $25/month + storage: $10/month + backups: $5/month'
                }
              }
            ]
          }
        ]
      }
    ]

    setWikiData(prev => ({
      ...prev,
      [repoFullName]: {
        id: repoFullName,
        repo_full_name: repoFullName,
        repo_owner: repoFullName.split('/')[0],
        repo_name: repoFullName.split('/')[1],
        lastGenerated: new Date().toISOString(),
        files: demoFiles,
        summary: {
          technical: 'This repository contains a production-ready AWS infrastructure setup using Terraform. It implements a three-tier architecture with VPC, EC2 autoscaling groups, and RDS PostgreSQL. The infrastructure follows AWS Well-Architected Framework principles with emphasis on security and cost optimization.',
          simple: 'This is the blueprint for your cloud setup on Amazon Web Services (AWS). It creates servers to run your website, a database to store your data, and a secure private network to keep everything safe. The setup automatically handles traffic spikes and includes backups.'
        },
        stats: {
          totalFiles: 8,
          resources: 6,
          estimatedCost: '$110-400/month',
          securityScore: 90
        }
      }
    }))
  }

  // Load wiki when repo is selected
  useEffect(() => {
    if (selectedRepo && !wikiData[selectedRepo]) {
      generateWiki(selectedRepo)
    }
  }, [selectedRepo])

  const currentWiki = selectedRepo ? wikiData[selectedRepo] : null

  // Toggle folder expansion
  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  // Get file icon - uses the same FileIcon component as the main IDE
  const getFileIcon = (file: WikiFile) => {
    const isFolder = file.type === 'folder'
    const isOpen = isFolder && expandedPaths.has(file.path)
    return <FileIcon fileName={file.name} isFolder={isFolder} isOpen={isOpen} size={16} />
  }

  // Check if a file or folder contains .tf files
  const hasTerraformFiles = (file: WikiFile): boolean => {
    if (file.type === 'file') {
      return file.extension === 'tf' || file.extension === 'tfvars'
    }
    if (file.type === 'folder' && file.children) {
      return file.children.some(child => hasTerraformFiles(child))
    }
    return false
  }

  // Render file tree - Only show .tf files
  const renderFileTree = (files: WikiFile[], depth = 0) => {
    // Filter to only terraform files and folders containing them
    const terraformFiles = files.filter(file => hasTerraformFiles(file))
    
    return terraformFiles.map(file => {
      const isExpanded = expandedPaths.has(file.path)
      const isSelected = selectedFile?.path === file.path
      
      // Filter by search
      if (searchQuery) {
        const matchesSearch = file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          file.explanation?.simple.toLowerCase().includes(searchQuery.toLowerCase()) ||
          file.explanation?.technical.toLowerCase().includes(searchQuery.toLowerCase())
        
        if (!matchesSearch && file.type !== 'folder') return null
        if (file.type === 'folder' && !file.children?.some(c => 
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) && hasTerraformFiles(c)
        )) return null
      }
      
      return (
        <div key={file.path}>
          <button
            onClick={() => {
              if (file.type === 'folder') {
                toggleExpand(file.path)
              } else {
                setSelectedFile(file)
              }
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
              isSelected 
                ? 'bg-[#14b8a6]/20 text-white border-l-2 border-[#14b8a6]' 
                : 'text-[#a1a1a1] hover:bg-[#0f0f0f] hover:text-white'
            }`}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
          >
            {file.type === 'folder' && (
              isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
            )}
            {getFileIcon(file)}
            <span className="truncate">{file.name}</span>
            {file.resources && file.resources.length > 0 && (
              <span className="ml-auto px-1.5 py-0.5 text-xs bg-[#14b8a6]/20 text-[#14b8a6] rounded">
                {file.resources.length}
              </span>
            )}
          </button>
          {file.type === 'folder' && isExpanded && file.children && (
            <div>{renderFileTree(file.children, depth + 1)}</div>
          )}
        </div>
      )
    })
  }

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  // Export wiki as Markdown
  const exportAsMarkdown = () => {
    if (!currentWiki) return
    
    let markdown = `# ${currentWiki.repo_full_name} - Infrastructure Wiki\n\n`
    markdown += `*Generated by Driftbox AI*\n\n`
    markdown += `---\n\n`
    
    // Summary
    markdown += `## Overview\n\n`
    markdown += isSimpleMode ? currentWiki.summary?.simple : currentWiki.summary?.technical
    markdown += `\n\n`
    
    // Stats
    if (currentWiki.stats) {
      markdown += `### Quick Stats\n\n`
      markdown += `| Metric | Value |\n|--------|-------|\n`
      markdown += `| Config Files | ${currentWiki.stats.totalFiles} |\n`
      markdown += `| Resources | ${currentWiki.stats.resources} |\n`
      markdown += `| Est. Monthly Cost | ${currentWiki.stats.estimatedCost} |\n`
      markdown += `| Security Score | ${currentWiki.stats.securityScore}/100 |\n\n`
    }
    
    // Files
    markdown += `---\n\n## Files\n\n`
    
    const renderFileMarkdown = (files: WikiFile[], depth = 0) => {
      let md = ''
      for (const file of files) {
        const indent = '  '.repeat(depth)
        if (file.type === 'folder') {
          md += `${indent}### 📁 ${file.name}/\n\n`
          if (file.children) {
            md += renderFileMarkdown(file.children, depth + 1)
          }
        } else {
          md += `${indent}### 📄 ${file.path}\n\n`
          if (file.explanation) {
            md += `${indent}${isSimpleMode ? file.explanation.simple : file.explanation.technical}\n\n`
          }
          if (file.resources && file.resources.length > 0) {
            md += `${indent}**Resources:**\n\n`
            for (const r of file.resources) {
              md += `${indent}- \`${r.type}.${r.name}\`: ${isSimpleMode ? r.explanation.simple : r.explanation.technical}\n`
            }
            md += `\n`
          }
          if (file.security) {
            md += `${indent}**Security Score:** ${file.security.score}/100\n`
            if (file.security.issues.length > 0) {
              md += `${indent}**Issues:** ${file.security.issues.join(', ')}\n`
            }
            md += `\n`
          }
          if (file.cost) {
            md += `${indent}**Est. Cost:** ${file.cost.estimate}\n\n`
          }
        }
      }
      return md
    }
    
    if (currentWiki.files) {
      markdown += renderFileMarkdown(currentWiki.files)
    }
    
    markdown += `---\n\n*Documentation exported from Driftbox - The AI Infrastructure Engineer*\n`
    
    // Download
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentWiki.repo_name || 'wiki'}-docs.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Panel mode height vs full page height
  const containerHeight = panelMode ? 'h-full' : 'h-[calc(100vh-280px)]'

  return (
    <div className={`flex ${containerHeight} bg-[#0a0a0a] ${panelMode ? '' : 'rounded-lg border border-[#1f1f1f]'} overflow-hidden`}>
      {/* Left Sidebar - Repo & File List */}
      <div 
        className="border-r border-[#1f1f1f] flex flex-col flex-shrink-0"
        style={{ width: sidebarWidth }}
      >
        {/* Repo Selector - Hidden in panel mode */}
        {!panelMode && (
          <div className="p-3 border-b border-[#1f1f1f] relative">
            <button
              onClick={() => setIsRepoDropdownOpen(!isRepoDropdownOpen)}
              className="w-full px-3 py-2 bg-[#0f0f0f] border border-[#1f1f1f] rounded-lg text-sm text-white flex items-center justify-between hover:border-[#14b8a6]/50 transition-colors"
            >
              <span className="truncate">{selectedRepo || 'Select repository'}</span>
              <ChevronDown className={`w-4 h-4 text-[#666] transition-transform ${isRepoDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {isRepoDropdownOpen && (
              <div className="absolute top-full left-3 right-3 mt-1 bg-[#1e1e1e] border border-[#1f1f1f] rounded-lg shadow-xl z-50 max-h-[300px] overflow-y-auto">
                {repositories.map(repo => (
                  <button
                    key={repo.id}
                    onClick={() => {
                      setSelectedRepo(repo.repo_full_name)
                      setIsRepoDropdownOpen(false)
                    }}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                      selectedRepo === repo.repo_full_name
                        ? 'bg-[#37373d] text-white'
                        : 'text-[#ccc] hover:bg-[#2d2d30]'
                    }`}
                  >
                    {repo.repo_full_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* Repo Name Header - Panel mode only */}
        {panelMode && selectedRepo && (
          <div className="p-3 border-b border-[#1f1f1f]">
            <div className="flex items-center gap-2 text-sm text-[#fafafa] font-medium">
              <Book className="w-4 h-4 text-[#14b8a6]" />
              {selectedRepo}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="p-3 border-b border-[#1f1f1f]">
          <div className="flex items-center gap-2 px-3 py-2 bg-[#0a0a0a] border border-[#1f1f1f] rounded-lg">
            <Search className="w-4 h-4 text-[#666666]" />
            <input
              type="text"
              placeholder="Search wiki..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-[#fafafa] placeholder-[#666666] focus:outline-none"
            />
          </div>
        </div>

        {/* File Tree */}
        <div className="flex-1 overflow-y-auto">
          {isGenerating && generatingRepo === selectedRepo ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
              <div className="relative">
                <Brain className="w-8 h-8 text-[#14b8a6] animate-pulse" />
                <Sparkles className="w-4 h-4 text-[#eab308] absolute -top-1 -right-1 animate-bounce" />
              </div>
              <p className="text-sm text-[#a1a1a1] text-center">
                AI is analyzing your code...
              </p>
              <p className="text-xs text-[#666666] text-center">
                Generating explanations
              </p>
            </div>
          ) : currentWiki?.files ? (
            renderFileTree(currentWiki.files)
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
              <Book className="w-8 h-8 text-[#333333]" />
              <p className="text-sm text-[#666666] text-center">
                Select a repository to view its wiki
              </p>
            </div>
          )}
        </div>

        {/* Regenerate Button */}
        {currentWiki && (
          <div className="p-3 border-t border-[#1f1f1f]">
            <button
              onClick={() => selectedRepo && generateWiki(selectedRepo)}
              disabled={isGenerating}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-[#141414] hover:bg-[#1a1a1a] border border-[#1f1f1f] rounded-lg text-sm text-[#a1a1a1] hover:text-[#fafafa] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
              {isGenerating ? 'Generating...' : 'Regenerate Wiki'}
            </button>
            {currentWiki.lastGenerated && (
              <p className="text-xs text-[#666666] text-center mt-2">
                <Clock className="w-3 h-3 inline mr-1" />
                Updated {new Date(currentWiki.lastGenerated).toLocaleTimeString()}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Draggable Divider */}
      <div
        className={`w-px cursor-col-resize flex-shrink-0 transition-colors hover:bg-[#14b8a6] ${
          isDraggingSidebar ? 'bg-[#14b8a6]' : 'bg-[#1f1f1f]'
        }`}
        onMouseDown={(e) => {
          e.preventDefault()
          setIsDraggingSidebar(true)
          const startX = e.clientX
          const startWidth = sidebarWidth
          
          const handleMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX
            setSidebarWidth(Math.max(200, Math.min(500, startWidth + delta)))
          }
          
          const handleMouseUp = () => {
            setIsDraggingSidebar(false)
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
          }
          
          document.addEventListener('mousemove', handleMouseMove)
          document.addEventListener('mouseup', handleMouseUp)
        }}
        title="Drag to resize sidebar"
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header with Jargon Toggle */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#1f1f1f] bg-[#0a0a0a]">
          <div className="flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-[#14b8a6]" />
            <h2 className="font-semibold text-[#fafafa]">
              {selectedFile ? selectedFile.name : 'Repository Overview'}
            </h2>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Export Button */}
            {currentWiki && (
              <button
                onClick={exportAsMarkdown}
                className="flex items-center gap-2 px-3 py-1.5 bg-[#141414] hover:bg-[#1a1a1a] border border-[#1f1f1f] rounded-lg text-sm text-[#a1a1a1] hover:text-[#fafafa] transition-colors"
                title="Export as Markdown"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Export</span>
              </button>
            )}
            
            {/* Simple/Technical Toggle - Scanner.dev style */}
            <button
              onClick={() => setIsSimpleMode(!isSimpleMode)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                isSimpleMode 
                  ? 'bg-[#14b8a6] text-white' 
                  : 'bg-[#141414] border border-[#1f1f1f] text-[#a1a1a1] hover:text-white'
              }`}
            >
              {isSimpleMode ? (
                <>
                  <ToggleRight className="w-4 h-4" />
                  <span className="text-sm font-medium">Simple</span>
                </>
              ) : (
                <>
                  <ToggleLeft className="w-4 h-4" />
                  <span className="text-sm font-medium">Technical</span>
                </>
              )}
            </button>
            
            {/* Close Button (Panel Mode) */}
            {panelMode && onClose && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-[#141414] rounded-lg text-[#666666] hover:text-[#fafafa] transition-colors"
                title="Close Wiki"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8">
          {selectedFile ? (
            // File Detail View - Clean Document Style
            <div className="max-w-3xl mx-auto">
              {/* Document Header */}
              <header className="mb-8 pb-6 border-b border-[#1f1f1f]">
                <div className="flex items-center gap-2 text-sm text-[#666666] mb-3">
                  <button 
                    onClick={() => setSelectedFile(null)}
                    className="hover:text-[#14b8a6] transition-colors"
                  >
                    ← Back to overview
                  </button>
                </div>
                <h1 className="text-2xl font-semibold text-[#fafafa] mb-2">
                  {selectedFile.name}
                </h1>
                <p className="text-sm text-[#666666]">
                  {selectedFile.path} • {selectedFile.line_count || 0} lines
                  {selectedFile.providers?.length ? ` • ${selectedFile.providers.join(', ')}` : ''}
                </p>
              </header>

              {/* What is this file? - Beginner explainer */}
              <section className="mb-10 p-5 bg-[#0f0f0f] border-l-4 border-[#14b8a6] rounded-r-lg">
                <h2 className="text-sm font-medium text-[#14b8a6] uppercase tracking-wider mb-2">What is this file?</h2>
                <p className="text-[#b0b0b0] leading-relaxed">
                  {selectedFile.extension === 'tf' && (
                    <>This is a <strong className="text-white">Terraform configuration file</strong>. Terraform files define your cloud infrastructure as code — instead of clicking around in AWS/DigitalOcean dashboards, you write what you want and Terraform creates it for you. </>
                  )}
                  {selectedFile.extension === 'tfvars' && (
                    <>This is a <strong className="text-white">Terraform variables file</strong>. It contains the actual values for variables defined elsewhere — think of it like filling in a form with your specific settings (region, size, names, etc). </>
                  )}
                  {selectedFile.extension === 'json' && (
                    <>This is a <strong className="text-white">JSON configuration file</strong>. It stores structured data that other tools or services can read and use. </>
                  )}
                  {selectedFile.extension === 'md' && (
                    <>This is a <strong className="text-white">Markdown documentation file</strong>. It contains human-readable documentation about this project. </>
                  )}
                  {selectedFile.extension === 'hcl' && (
                    <>This is an <strong className="text-white">HCL (HashiCorp Configuration Language) file</strong>. HCL is the language Terraform uses — it's designed to be readable by both humans and machines. </>
                  )}
                  {!['tf', 'tfvars', 'json', 'md', 'hcl'].includes(selectedFile.extension || '') && (
                    <>This file is part of your infrastructure configuration. </>
                  )}
                </p>
              </section>

              {/* Overview */}
              <section className="mb-10">
                <h2 className="text-lg font-medium text-white mb-3">Overview</h2>
                <p className="text-[#a0a0a0] leading-relaxed text-base">
                  {isSimpleMode 
                    ? selectedFile.explanation?.simple 
                    : selectedFile.explanation?.technical}
                </p>
              </section>

              {/* Rich Sections (exclude ones shown separately below) */}
              {selectedFile.sections && selectedFile.sections.length > 0 && (
                <div className="space-y-8 mb-10">
                  {selectedFile.sections
                    .filter(section => 
                      section.title !== 'Resources Defined' && 
                      section.title !== 'Cloud Providers' && 
                      section.title !== 'Dependencies'
                    )
                    .map((section, idx) => (
                    <section key={idx}>
                      <h2 className="text-lg font-medium text-white mb-3">{section.title}</h2>
                      <p className="text-[#a1a1a1] mb-3">{section.content}</p>
                      {section.items && section.items.length > 0 && (
                        <div className="space-y-4">
                          {section.items.map((item, itemIdx) => {
                            // Split item into name/type and description if it contains a colon or pipe
                            const parts = item.split(/:\s*|\|\s*/);
                            const hasMultipleParts = parts.length > 1;
                            
                            return (
                              <div key={itemIdx} className="border-l-2 border-[#1f1f1f] pl-4">
                                <div 
                                  className="text-[#e0e0e0]"
                                  dangerouslySetInnerHTML={{ 
                                    __html: hasMultipleParts 
                                      ? `<strong class="text-white">${parts[0]}</strong>`
                                      : item.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white">$1</strong>') 
                                  }} 
                                />
                                {hasMultipleParts && parts.slice(1).map((part, partIdx) => (
                                  <div key={partIdx} className="text-[#a1a1a1] text-sm mt-1 ml-4">
                                    {part.trim()}
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              )}

              {/* Variables */}
              {selectedFile.variables && selectedFile.variables.length > 0 && (
                <section className="mb-10">
                  <h2 className="text-lg font-medium text-white mb-2">Input Variables</h2>
                  <p className="text-sm text-[#666] mb-4">
                    Variables are like settings you can customize. When marked "required", you must provide a value. Otherwise, the default will be used.
                    <a href="https://developer.hashicorp.com/terraform/language/values/variables" target="_blank" rel="noopener noreferrer" className="text-[#14b8a6] hover:underline ml-1">Learn more →</a>
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[#666] border-b border-[#1f1f1f]">
                        <th className="pb-3 pr-4 font-medium">Name</th>
                        <th className="pb-3 pr-4 font-medium">Type</th>
                        <th className="pb-3 pr-4 font-medium">Default</th>
                        <th className="pb-3 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedFile.variables.map((v, idx) => (
                        <tr key={idx} className="border-b border-[#1a1a1a]">
                          <td className="py-3 pr-4">
                            <code className="text-[#14b8a6] text-xs">{v.name}</code>
                          </td>
                          <td className="py-3 pr-4 text-[#a1a1a1]">{v.type}</td>
                          <td className="py-3 pr-4 text-[#a1a1a1]">
                            {v.default ? <code className="text-[#22c55e] text-xs">{v.default}</code> : <span className="text-yellow-500 text-xs">required</span>}
                          </td>
                          <td className="py-3 text-[#a0a0a0]">{v.description || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* Outputs */}
              {selectedFile.outputs && selectedFile.outputs.length > 0 && (
                <section className="mb-10">
                  <h2 className="text-lg font-medium text-white mb-2">Outputs</h2>
                  <p className="text-sm text-[#666] mb-4">
                    Outputs are values that Terraform returns after creating your infrastructure — like the IP address of a new server or the URL of a new database.
                    <a href="https://developer.hashicorp.com/terraform/language/values/outputs" target="_blank" rel="noopener noreferrer" className="text-[#14b8a6] hover:underline ml-1">Learn more →</a>
                  </p>
                  <ul className="space-y-3">
                    {selectedFile.outputs.map((o, idx) => (
                      <li key={idx} className="flex items-baseline gap-3">
                        <code className="text-yellow-400 text-sm">{o.name}</code>
                        <span className="text-[#555]">—</span>
                        <span className="text-[#a0a0a0]">{o.description || o.value || 'Output value'}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Modules */}
              {selectedFile.modules && selectedFile.modules.length > 0 && (
                <section className="mb-10">
                  <h2 className="text-lg font-medium text-white mb-2">Module References</h2>
                  <p className="text-sm text-[#666] mb-4">
                    Modules are reusable packages of Terraform code. Instead of writing everything from scratch, you can use pre-built modules that handle common patterns.
                    <a href="https://developer.hashicorp.com/terraform/language/modules" target="_blank" rel="noopener noreferrer" className="text-[#14b8a6] hover:underline ml-1">Learn more →</a>
                  </p>
                  <ul className="space-y-2">
                    {selectedFile.modules.map((m, idx) => (
                      <li key={idx} className="text-[#a0a0a0]">
                        <code className="text-orange-400 text-sm">{m.name}</code>
                        {m.source && (
                          <span className="text-[#666]"> — from <code className="text-[#a1a1a1] text-xs">{m.source}</code></span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Resources */}
              {selectedFile.resources && selectedFile.resources.length > 0 && (
                <section className="mb-10">
                  <h2 className="text-lg font-medium text-white mb-2">Resources Defined</h2>
                  <p className="text-sm text-[#666] mb-4">
                    Resources are the actual cloud components Terraform will create — servers, databases, networks, etc. Each resource has a type (what it is) and a name (what you call it).
                    <a href="https://developer.hashicorp.com/terraform/language/resources" target="_blank" rel="noopener noreferrer" className="text-[#14b8a6] hover:underline ml-1">Learn more →</a>
                  </p>
                  <div className="space-y-6">
                    {selectedFile.resources.map((resource, idx) => {
                      // Generate documentation link based on resource type
                      const provider = resource.type.split('_')[0];
                      let docLink = '';
                      if (provider === 'aws') {
                        docLink = `https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/${resource.type.replace('aws_', '')}`;
                      } else if (provider === 'digitalocean') {
                        docLink = `https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/${resource.type.replace('digitalocean_', '')}`;
                      } else if (provider === 'google') {
                        docLink = `https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/${resource.type.replace('google_', '')}`;
                      } else if (provider === 'azurerm') {
                        docLink = `https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/${resource.type.replace('azurerm_', '')}`;
                      }
                      
                      // Split explanation from attributes if it contains a pipe
                      const explanation = isSimpleMode ? resource.explanation.simple : resource.explanation.technical;
                      const [mainExplanation, ...attributeParts] = explanation.split(' | ');
                      const attributes = attributeParts.join(' | ');
                      
                      return (
                        <div key={idx} className="border-l-2 border-[#14b8a6]/30 pl-4 pb-4">
                          {/* Resource header */}
                          <div className="flex items-center gap-2 mb-2">
                            <code className="text-[#14b8a6] text-sm font-mono font-semibold">
                              {resource.name}
                            </code>
                            <span className="text-[#555]">—</span>
                            <code className="text-[#a1a1a1] text-xs">
                              {resource.type}
                            </code>
                            {docLink && (
                              <a 
                                href={docLink} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs text-[#14b8a6]/70 hover:text-[#14b8a6] transition-colors"
                              >
                                docs →
                              </a>
                            )}
                          </div>
                          
                          {/* Main explanation */}
                          <p className="text-[#a0a0a0] leading-relaxed mb-2">
                            {mainExplanation}
                          </p>
                          
                          {/* Attributes on indented lines */}
                          {attributes && (
                            <div className="ml-4 mt-2 space-y-1">
                              {attributes.split(', ').map((attr, attrIdx) => {
                                const [key, value] = attr.split(': ');
                                return (
                                  <div key={attrIdx} className="text-sm">
                                    <span className="text-[#666]">{key}:</span>
                                    <span className="text-[#a1a1a1] ml-2">{value}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Dependencies */}
              {selectedFile.dependencies && selectedFile.dependencies.length > 0 && (
                <section className="mb-10">
                  <h2 className="text-lg font-medium text-[#22c55e] mb-2">Dependencies</h2>
                  <p className="text-sm text-[#666] mb-4">
                    This file depends on or references these other resources:
                  </p>
                  <div className="space-y-3">
                    {selectedFile.dependencies.map((dep, idx) => (
                      <div key={idx} className="border-l-2 border-green-500 pl-4 py-2">
                        <code className="text-[#22c55e] text-sm font-mono">
                          {dep}
                        </code>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Cloud Providers - Only show recognized providers (AWS, DigitalOcean, etc.) */}
              {selectedFile.providers && selectedFile.providers.filter(p => {
                const pl = p.toLowerCase();
                return pl.includes('aws') || pl.includes('digitalocean') || pl.includes('google') || pl.includes('gcp') || pl.includes('azure') || pl.includes('azurerm');
              }).length > 0 && (
                <section className="mb-10">
                  <h2 className="text-lg font-medium text-white mb-2">Cloud Providers</h2>
                  <p className="text-sm text-[#666] mb-4">
                    The cloud platforms this file interacts with.
                  </p>
                  <div className="space-y-3">
                    {selectedFile.providers
                      .filter(provider => {
                        const pl = provider.toLowerCase();
                        return pl.includes('aws') || pl.includes('digitalocean') || pl.includes('google') || pl.includes('gcp') || pl.includes('azure') || pl.includes('azurerm');
                      })
                      .map((provider, idx) => {
                      const providerLower = provider.toLowerCase();
                      const isAws = providerLower.includes('aws');
                      const isDigitalOcean = providerLower.includes('digitalocean');
                      const isGoogle = providerLower.includes('google') || providerLower.includes('gcp');
                      const isAzure = providerLower.includes('azure') || providerLower.includes('azurerm');
                      
                      const borderColor = isAws ? 'border-orange-500' : 
                                         isDigitalOcean ? 'border-blue-500' : 
                                         isGoogle ? 'border-red-500' : 
                                         'border-cyan-500';
                      const textColor = isAws ? 'text-orange-400' : 
                                       isDigitalOcean ? 'text-blue-400' : 
                                       isGoogle ? 'text-red-400' : 
                                       'text-cyan-400';
                      
                      let docLink = '';
                      let providerName = provider;
                      if (isAws) {
                        docLink = 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs';
                        providerName = 'Amazon Web Services (AWS)';
                      } else if (isDigitalOcean) {
                        docLink = 'https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs';
                        providerName = 'DigitalOcean';
                      } else if (isGoogle) {
                        docLink = 'https://registry.terraform.io/providers/hashicorp/google/latest/docs';
                        providerName = 'Google Cloud Platform';
                      } else if (isAzure) {
                        docLink = 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs';
                        providerName = 'Microsoft Azure';
                      }
                      
                      return (
                        <div key={idx} className={`border-l-2 ${borderColor} pl-4 py-2 flex items-center gap-3`}>
                          <code className={`${textColor} text-sm font-mono font-semibold`}>
                            {providerName}
                          </code>
                          {docLink && (
                            <a 
                              href={docLink} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className={`text-xs ${textColor} opacity-70 hover:opacity-100 transition-opacity`}
                            >
                              docs →
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Learn More Resources */}
              <section className="mb-10 pt-6 border-t border-[#1f1f1f]">
                <h2 className="text-lg font-medium text-white mb-4">Learn More</h2>
                <div className="space-y-2">
                  {selectedFile.extension === 'tf' && (
                    <>
                      <a href="https://developer.hashicorp.com/terraform/tutorials/aws-get-started" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[#a0a0a0] hover:text-[#14b8a6] transition-colors">
                        <ExternalLink className="w-4 h-4" />
                        Terraform Getting Started Tutorial
                      </a>
                      <a href="https://developer.hashicorp.com/terraform/language/syntax/configuration" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[#a0a0a0] hover:text-[#14b8a6] transition-colors">
                        <ExternalLink className="w-4 h-4" />
                        Understanding Terraform Syntax
                      </a>
                    </>
                  )}
                  {selectedFile.providers?.includes('aws') && (
                    <a href="https://registry.terraform.io/providers/hashicorp/aws/latest/docs" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[#a0a0a0] hover:text-[#14b8a6] transition-colors">
                      <ExternalLink className="w-4 h-4" />
                      AWS Provider Documentation
                    </a>
                  )}
                  {selectedFile.providers?.includes('digitalocean') && (
                    <a href="https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[#a0a0a0] hover:text-[#14b8a6] transition-colors">
                      <ExternalLink className="w-4 h-4" />
                      DigitalOcean Provider Documentation
                    </a>
                  )}
                  <a href="https://developer.hashicorp.com/terraform/language" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[#a0a0a0] hover:text-[#14b8a6] transition-colors">
                    <ExternalLink className="w-4 h-4" />
                    Terraform Language Reference
                  </a>
                </div>
              </section>

              {/* Security & Cost */}
              {(selectedFile.security || selectedFile.cost) && (
                <section className="mb-10 pt-6 border-t border-[#1f1f1f]">
                  <div className="grid grid-cols-2 gap-8">
                    {selectedFile.security && (
                      <div>
                        <h3 className="text-sm font-medium text-[#666] uppercase tracking-wider mb-2">Security</h3>
                        <div className={`text-2xl font-semibold ${
                          selectedFile.security.score >= 80 ? 'text-[#22c55e]' :
                          selectedFile.security.score >= 50 ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {selectedFile.security.score}/100
                        </div>
                        {selectedFile.security.issues.length > 0 ? (
                          <ul className="mt-2 space-y-1">
                            {selectedFile.security.issues.map((issue, idx) => (
                              <li key={idx} className="text-sm text-[#a1a1a1]">• {issue}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-[#22c55e] mt-1">No issues found</p>
                        )}
                      </div>
                    )}
                    {selectedFile.cost && (
                      <div>
                        <h3 className="text-sm font-medium text-[#666] uppercase tracking-wider mb-2">Estimated Cost</h3>
                        <div className="text-2xl font-semibold text-[#22c55e]">
                          {selectedFile.cost.estimate}
                        </div>
                        <p className="text-sm text-[#a1a1a1] mt-1">{selectedFile.cost.breakdown}</p>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Footer */}
              <footer className="pt-6 border-t border-[#1f1f1f] text-center">
                <p className="text-xs text-[#555]">Generated by Driftbox AI</p>
              </footer>
            </div>
          ) : currentWiki ? (
            // Repository Overview - Document Style
            <div className="max-w-3xl mx-auto prose prose-invert">
              {/* Document Title */}
              <div className="mb-8 pb-6 border-b border-[#1f1f1f]">
                <h1 className="text-3xl font-semibold text-white mb-2 tracking-tight">
                  {currentWiki.repo_name || selectedRepo?.split('/')[1]}
                </h1>
                <p className="text-sm text-[#666]">
                  Infrastructure Documentation • {currentWiki.stats?.totalFiles} files • {currentWiki.stats?.resources} resources
                </p>
              </div>

              {/* Overview Section */}
              <section className="mb-10">
                <h2 className="text-xl font-medium text-white mb-4">Overview</h2>
                <p className="text-[#a0a0a0] leading-relaxed text-base">
                  {isSimpleMode 
                    ? currentWiki.summary?.simple 
                    : currentWiki.summary?.technical}
                </p>
              </section>

              {/* Stats Ticker - Scrolling Stock Ticker Style */}
              <section className="mb-10 overflow-hidden group/ticker">
                <div className="relative bg-[#0a0a0a] border-y border-[#222] py-3">
                  <div 
                    className="flex whitespace-nowrap"
                    style={{
                      animation: 'ticker 7s linear infinite',
                      willChange: 'transform',
                    }}
                  >
                    {/* Render 4 copies for truly seamless looping */}
                    {[0, 1, 2, 3].map((copy) => (
                      <div key={copy} className="flex items-center gap-8 px-6 shrink-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[#666] text-sm">FILES</span>
                          <span className="text-white font-mono font-bold">{currentWiki.stats?.totalFiles}</span>
                          <span className="text-[#22c55e] text-xs">●</span>
                        </div>
                        <div className="text-[#333]">|</div>
                        <div className="flex items-center gap-2">
                          <span className="text-[#666] text-sm">RESOURCES</span>
                          <span className="text-blue-400 font-mono font-bold">{currentWiki.stats?.resources}</span>
                          <span className="text-blue-400 text-xs">▲</span>
                        </div>
                        <div className="text-[#333]">|</div>
                        <div className="flex items-center gap-2">
                          <span className="text-[#666] text-sm">COST/MO</span>
                          <span className="text-[#22c55e] font-mono font-bold">{currentWiki.stats?.estimatedCost}</span>
                          <span className="text-[#22c55e] text-xs">$</span>
                        </div>
                        <div className="text-[#333]">|</div>
                        <div className="flex items-center gap-2">
                          <span className="text-[#666] text-sm">SECURITY</span>
                          <span className={`font-mono font-bold ${(currentWiki.stats?.securityScore || 0) >= 80 ? 'text-[#22c55e]' : (currentWiki.stats?.securityScore || 0) >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                            {currentWiki.stats?.securityScore}%
                          </span>
                          <span className={`text-xs ${(currentWiki.stats?.securityScore || 0) >= 80 ? 'text-[#22c55e]' : 'text-yellow-400'}`}>
                            {(currentWiki.stats?.securityScore || 0) >= 80 ? '▲' : '▼'}
                          </span>
                        </div>
                        <div className="text-[#333]">|</div>
                        <div className="flex items-center gap-2">
                          <span className="text-[#666] text-sm">PROVIDER</span>
                          <span className={`font-mono font-bold ${
                            currentWiki.files?.some(f => f.providers?.some(p => p.toLowerCase().includes('aws'))) ? 'text-orange-400' : 
                            currentWiki.files?.some(f => f.providers?.some(p => p.toLowerCase().includes('digitalocean'))) ? 'text-blue-400' : 'text-[#14b8a6]'
                          }`}>
                            {currentWiki.files?.some(f => f.providers?.some(p => p.toLowerCase().includes('aws'))) ? 'AWS' : 
                             currentWiki.files?.some(f => f.providers?.some(p => p.toLowerCase().includes('digitalocean'))) ? 'DO' : 'MULTI'}
                          </span>
                          <Cloud className="w-3 h-3 text-[#666]" />
                        </div>
                        <div className="text-[#333]">|</div>
                      </div>
                    ))}
                  </div>
                </div>
                <style>{`
                  @keyframes ticker {
                    from { transform: translateX(0); }
                    to { transform: translateX(-25%); }
                  }
                  .group\\/ticker:hover > div > div {
                    animation-play-state: paused !important;
                  }
                `}</style>
              </section>

              {/* Helpful Resources */}
              <section className="mb-10">
                <h2 className="text-xl font-medium text-white mb-4">Resources</h2>
                <div className="space-y-3">
                  {/* Dynamic links based on providers in repo */}
                  {currentWiki.files?.some(f => f.providers?.includes('aws') || f.providers?.includes('AWS')) && (
                    <a 
                      href="https://registry.terraform.io/providers/hashicorp/aws/latest/docs" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 text-[#a0a0a0] hover:text-[#14b8a6] transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      AWS Provider Documentation
                    </a>
                  )}
                  {currentWiki.files?.some(f => f.providers?.includes('digitalocean') || f.providers?.includes('DigitalOcean')) && (
                    <a 
                      href="https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 text-[#a0a0a0] hover:text-[#14b8a6] transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      DigitalOcean Provider Documentation
                    </a>
                  )}
                  {currentWiki.files?.some(f => f.providers?.includes('google') || f.providers?.includes('GCP')) && (
                    <a 
                      href="https://registry.terraform.io/providers/hashicorp/google/latest/docs" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 text-[#a0a0a0] hover:text-[#14b8a6] transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Google Cloud Provider Documentation
                    </a>
                  )}
                  {currentWiki.files?.some(f => f.providers?.includes('azurerm') || f.providers?.includes('Azure')) && (
                    <a 
                      href="https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 text-[#a0a0a0] hover:text-[#14b8a6] transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Azure Provider Documentation
                    </a>
                  )}
                  <a 
                    href="https://developer.hashicorp.com/terraform/language" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 text-[#a0a0a0] hover:text-[#14b8a6] transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Terraform Language Documentation
                  </a>
                  <a 
                    href="https://developer.hashicorp.com/terraform/language/resources" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 text-[#a0a0a0] hover:text-[#14b8a6] transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Resource Blocks Reference
                  </a>
                </div>
              </section>

              {/* Footer */}
              <footer className="pt-6 border-t border-[#222] text-center">
                <p className="text-sm text-[#555]">
                  Generated by Driftbox AI • Select a file from the sidebar for details
                </p>
              </footer>
            </div>
          ) : (
            // Empty State
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="p-4 bg-[#0f0f0f] rounded-full">
                <Book className="w-12 h-12 text-[#444]" />
              </div>
              <h3 className="text-lg font-medium text-white">Team Wiki</h3>
              <p className="text-sm text-[#666] text-center max-w-md">
                Select a repository to generate AI-powered documentation that anyone on your team can understand.
              </p>
            </div>
          )}
        </div>
      </div>
      
      {/* GitHub Actions Modal */}
      {showActionsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] border border-[#1f1f1f] rounded-xl max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-4 border-b border-[#1f1f1f] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#14b8a6]/20 rounded-lg">
                  <GitBranch className="w-5 h-5 text-[#14b8a6]" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Add GitHub Actions</h2>
                  <p className="text-xs text-[#666]">Select workflows to add to your repository</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setShowActionsModal(false)
                  setSelectedActions(new Set())
                  setGeneratedYaml(null)
                }}
                className="p-2 hover:bg-[#333] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[#666]" />
              </button>
            </div>
            
            {/* Modal Body */}
            <div className="flex-1 overflow-hidden flex">
              {/* Left side - Action Templates */}
              <div className="w-1/2 border-r border-[#1f1f1f] overflow-y-auto p-4">
                <div className="space-y-4">
                  {/* Terraform Actions */}
                  <div>
                    <h3 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
                      <Code className="w-4 h-4 text-[#14b8a6]" />
                      Terraform Workflows
                    </h3>
                    <div className="space-y-2">
                      {Object.entries(GITHUB_ACTIONS_TEMPLATES)
                        .filter(([_, t]) => t.category === 'terraform')
                        .map(([key, template]) => (
                          <button
                            key={key}
                            onClick={() => toggleAction(key as ActionTemplateKey)}
                            className={`w-full p-3 rounded-lg border text-left transition-all ${
                              selectedActions.has(key as ActionTemplateKey)
                                ? 'bg-[#14b8a6]/20 border-[#14b8a6]/50'
                                : 'bg-[#0f0f0f] border-[#1f1f1f] hover:border-[#444]'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-white">{template.name}</span>
                              {selectedActions.has(key as ActionTemplateKey) && (
                                <Check className="w-4 h-4 text-[#14b8a6]" />
                              )}
                            </div>
                            <p className="text-xs text-[#666] mt-1">{template.description}</p>
                            {key.includes('oidc') && (
                              <span className="inline-block mt-2 px-2 py-0.5 bg-green-500/20 text-[#22c55e] text-[10px] rounded">
                                OIDC - No secrets needed
                              </span>
                            )}
                          </button>
                        ))}
                    </div>
                  </div>
                  
                  {/* Security Actions */}
                  <div>
                    <h3 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
                      <Shield className="w-4 h-4 text-[#22c55e]" />
                      Security & Quality
                    </h3>
                    <div className="space-y-2">
                      {Object.entries(GITHUB_ACTIONS_TEMPLATES)
                        .filter(([_, t]) => t.category === 'security' || t.category === 'docs')
                        .map(([key, template]) => (
                          <button
                            key={key}
                            onClick={() => toggleAction(key as ActionTemplateKey)}
                            className={`w-full p-3 rounded-lg border text-left transition-all ${
                              selectedActions.has(key as ActionTemplateKey)
                                ? 'bg-green-500/20 border-green-500/50'
                                : 'bg-[#0f0f0f] border-[#1f1f1f] hover:border-[#444]'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-white">{template.name}</span>
                              {selectedActions.has(key as ActionTemplateKey) && (
                                <Check className="w-4 h-4 text-[#22c55e]" />
                              )}
                            </div>
                            <p className="text-xs text-[#666] mt-1">{template.description}</p>
                          </button>
                        ))}
                    </div>
                  </div>
                  
                  {/* Cost Actions */}
                  <div>
                    <h3 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-yellow-400" />
                      Cost Management
                    </h3>
                    <div className="space-y-2">
                      {Object.entries(GITHUB_ACTIONS_TEMPLATES)
                        .filter(([_, t]) => t.category === 'cost')
                        .map(([key, template]) => (
                          <button
                            key={key}
                            onClick={() => toggleAction(key as ActionTemplateKey)}
                            className={`w-full p-3 rounded-lg border text-left transition-all ${
                              selectedActions.has(key as ActionTemplateKey)
                                ? 'bg-yellow-500/20 border-yellow-500/50'
                                : 'bg-[#0f0f0f] border-[#1f1f1f] hover:border-[#444]'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-white">{template.name}</span>
                              {selectedActions.has(key as ActionTemplateKey) && (
                                <Check className="w-4 h-4 text-yellow-400" />
                              )}
                            </div>
                            <p className="text-xs text-[#666] mt-1">{template.description}</p>
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Right side - Preview */}
              <div className="w-1/2 flex flex-col">
                <div className="p-3 border-b border-[#1f1f1f] flex items-center justify-between">
                  <span className="text-sm text-[#666]">
                    {selectedActions.size} workflow{selectedActions.size !== 1 ? 's' : ''} selected
                  </span>
                  <button
                    onClick={generateCombinedYaml}
                    disabled={selectedActions.size === 0}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      selectedActions.size > 0
                        ? 'bg-[#14b8a6] hover:bg-purple-600 text-white'
                        : 'bg-[#333] text-[#666] cursor-not-allowed'
                    }`}
                  >
                    Generate YAML
                  </button>
                </div>
                
                {/* YAML Preview */}
                <div className="flex-1 overflow-auto p-4">
                  {generatedYaml ? (
                    <div className="relative">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(generatedYaml)
                          alert('Copied to clipboard!')
                        }}
                        className="absolute top-2 right-2 p-2 bg-[#333] hover:bg-[#444] rounded-lg transition-colors"
                        title="Copy to clipboard"
                      >
                        <Copy className="w-4 h-4 text-[#a1a1a1]" />
                      </button>
                      <pre className="text-xs text-[#a0a0a0] font-mono whitespace-pre-wrap bg-[#0f0f0f] p-4 rounded-lg border border-[#1f1f1f] overflow-x-auto">
                        {generatedYaml}
                      </pre>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                      <Settings className="w-12 h-12 text-[#333] mb-3" />
                      <p className="text-sm text-[#666]">
                        Select workflows and click "Generate YAML"
                      </p>
                      <p className="text-xs text-[#555] mt-1">
                        The generated file will be saved to .github/workflows/
                      </p>
                    </div>
                  )}
                </div>
                
                {/* Action Buttons */}
                {generatedYaml && (
                  <div className="p-3 border-t border-[#1f1f1f] flex gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedYaml)
                        alert('Copied to clipboard!')
                      }}
                      className="flex-1 px-3 py-2 bg-[#333] hover:bg-[#444] rounded-lg text-sm text-white transition-colors flex items-center justify-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      Copy YAML
                    </button>
                    <button
                      onClick={writeWorkflowFile}
                      className="flex-1 px-3 py-2 bg-[#14b8a6] hover:bg-purple-600 rounded-lg text-sm text-white font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Save to Repo
                    </button>
                  </div>
                )}
              </div>
            </div>
            
            {/* OIDC Info Banner */}
            {Array.from(selectedActions).some(key => key.includes('oidc')) && (
              <div className="p-3 bg-blue-500/10 border-t border-blue-500/20">
                <div className="flex items-start gap-2">
                  <Lock className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-blue-300">
                    <strong>OIDC Setup Required:</strong> After adding the workflow, you'll need to configure your cloud provider for OIDC authentication. 
                    The YAML includes placeholder values—check the comments for the required GitHub Variables to set.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

