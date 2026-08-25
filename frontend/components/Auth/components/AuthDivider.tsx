export default function AuthDivider() {
  return (
    <div className="flex items-center gap-4">
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--cursor-border)] to-transparent" />
      <span className="text-[12px] text-[var(--cursor-text-dim)] font-medium">OR</span>
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--cursor-border)] to-transparent" />
    </div>
  )
}

