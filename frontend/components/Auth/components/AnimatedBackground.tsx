export default function AnimatedBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Gradient Orbs */}
      <div 
        className="absolute top-[-10%] right-[-5%] w-[600px] h-[600px] bg-[var(--cursor-accent)] opacity-[0.08] rounded-full blur-[120px] animate-pulse" 
        style={{ animationDuration: '8s' }} 
      />
      <div 
        className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] bg-[var(--cursor-blue)] opacity-[0.06] rounded-full blur-[100px] animate-pulse" 
        style={{ animationDuration: '10s', animationDelay: '2s' }} 
      />
      
      {/* Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(var(--cursor-border)_1px,transparent_1px),linear-gradient(90deg,var(--cursor-border)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,black,transparent)] opacity-20" />
    </div>
  )
}

