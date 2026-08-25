interface ErrorMessageProps {
  message: string
}

export default function ErrorMessage({ message }: ErrorMessageProps) {
  if (!message) return null
  
  return (
    <div className="p-3 bg-[var(--cursor-red)] bg-opacity-10 border border-[var(--cursor-red)] rounded-lg text-[var(--cursor-red)] text-[13px] animate-in slide-in-from-top">
      {message}
    </div>
  )
}

