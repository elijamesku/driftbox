import { Github } from 'lucide-react'

interface GitHubButtonProps {
  onClick: () => void
  text?: string
}

export default function GitHubButton({ onClick, text = 'Continue with GitHub' }: GitHubButtonProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[var(--cursor-bg-lighter)] hover:bg-[var(--cursor-hover)] border border-[var(--cursor-border)] rounded-lg text-[14px] font-medium transition-all hover:scale-[1.02] active:scale-[0.98]"
    >
      <Github size={18} />
      {text}
    </button>
  )
}

