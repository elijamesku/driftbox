'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Repository } from '../swag/TopBar'
import RepositoryList from '../github/RepositoryList'

interface SearchModalProps {
  isOpen: boolean
  onClose: () => void
  repositories: Repository[]
  isLoading: boolean
  selectedRepo: Repository | null
  onRepoSelect: (repo: Repository) => void
  onRepoCreated?: (repoName: string, repoFullName: string) => void
  anchorElement?: HTMLElement | null
  searchQuery?: string
}

export default function SearchModal({
  isOpen,
  onClose,
  repositories,
  isLoading,
  selectedRepo,
  onRepoSelect,
  onRepoCreated,
  anchorElement,
  searchQuery: externalSearchQuery = ''
}: SearchModalProps) {
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 })
  
  const modalRef = useRef<HTMLDivElement>(null)

  // Calculate position relative to anchor element and update on resize/scroll
  const updatePosition = useCallback(() => {
    if (anchorElement) {
      const rect = anchorElement.getBoundingClientRect()
      setPosition({
        top: rect.bottom, // No gap - directly connected
        left: rect.left,
        width: Math.max(rect.width, 500) // Ensure minimum width
      })
    }
  }, [anchorElement])

  useEffect(() => {
    if (isOpen && anchorElement) {
      // Update immediately
      updatePosition()
      
      // Update position on window resize
      const handleResize = () => {
        updatePosition()
      }
      
      // Update position on scroll (in case parent scrolls)
      const handleScroll = () => {
        updatePosition()
      }
      
      window.addEventListener('resize', handleResize)
      window.addEventListener('scroll', handleScroll, true) // Use capture to catch all scrolls
      
      // Use a more frequent update for smooth tracking
      const intervalId = setInterval(() => {
        if (anchorElement) {
          updatePosition()
        }
      }, 50) // Update every 50ms for smooth tracking
      
      return () => {
        clearInterval(intervalId)
        window.removeEventListener('resize', handleResize)
        window.removeEventListener('scroll', handleScroll, true)
      }
    } else if (!isOpen) {
      // Reset position when closed
      setPosition({ top: 0, left: 0, width: 0 })
    }
  }, [isOpen, anchorElement, updatePosition])

  // Reset highlight when search query changes
  useEffect(() => {
    setHighlightedIndex(0)
  }, [externalSearchQuery])

  // Close modal when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  // Fuzzy search filter
  const filteredRepos = repositories.filter(repo => {
    if (!externalSearchQuery) return true
    const query = externalSearchQuery.toLowerCase()
    return (
      repo.name.toLowerCase().includes(query) ||
      repo.full_name.toLowerCase().includes(query) ||
      (repo.description && repo.description.toLowerCase().includes(query))
    )
  })

  // Handle keyboard navigation from search bar
  useEffect(() => {
    if (!isOpen) return
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightedIndex((prev) => 
          prev < filteredRepos.length - 1 ? prev + 1 : prev
        )
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredRepos[highlightedIndex]) {
          onRepoSelect(filteredRepos[highlightedIndex])
        }
      } else if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filteredRepos, highlightedIndex, onRepoSelect, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100]" style={{ pointerEvents: 'none' }}>
      <div
        ref={modalRef}
        className="fixed bg-[#141414] border border-[#2a2a2a] rounded-md shadow-2xl overflow-hidden"
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
          width: `${Math.max(position.width || 500, 500)}px`,
          maxWidth: '550px',
          pointerEvents: 'auto'
        }}
      >
        {/* Repository list - no search input, uses external search bar */}
        <RepositoryList
          repositories={filteredRepos}
          isLoading={isLoading}
          highlightedIndex={highlightedIndex}
          selectedRepo={selectedRepo}
          searchQuery={externalSearchQuery}
          onRepoSelect={onRepoSelect}
          onHighlight={setHighlightedIndex}
          onRepoCreated={onRepoCreated}
        />
      </div>
    </div>
  )
}

