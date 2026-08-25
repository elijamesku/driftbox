/**
 * Automated daily welcome messages for the chat interface
 * Rotates every 24 hours based on the day of the year
 */

export const WELCOME_MESSAGES = [
  "Hi! I'm your virtual infrastructure engineer. I can help you generate Terraform code, explain infrastructure concepts, and manage your cloud resources. What would you like to build today?",
  
  "Ready to build something amazing? I'm here to help you architect, deploy, and manage cloud infrastructure. Let's get started!",
  
  "Welcome! Terraform is my first language, and I'm here to help you build infrastructure with it.",
  
  "Let's code some infrastructure! Whether you're prototyping or deploying to production, I'll help you get it done right.",
      
  "Let's turn your infrastructure ideas into reality! I can generate Terraform, explain cloud concepts, and help you deploy with confidence.",
  
  "Infrastructure as code made easy! Tell me what you need - whether it's a single resource or a complete multi-cloud architecture.",
  
  "Your cloud infrastructure assistant is ready! From VPCs to serverless functions, I'll help you build it right the first time.",
  
  "Hello! Think of me as your DevOps teammate. I speak Terraform fluently and love solving infrastructure puzzles. What's your challenge?",
  
  "Ready to deploy? I can help you with everything from basic cloud resources to complex multi-region architectures. Let's build!",
  
  "I'm here to make infrastructure engineering effortless. Security groups, load balancers, databases - you name it, let's create it.",
  
  "Welcome! Whether you're learning cloud infrastructure or building production systems, I'm here to guide you every step of the way.",
  
  "Let's architect something brilliant! I can help you design, code, and deploy infrastructure that scales. What's on your mind?",
  
  "Infrastructure engineer at your service! From explaining concepts to generating production-ready Terraform, I've got your back.",
  
  "Ready to scale? Let's build infrastructure that's secure, scalable, and maintainable. What do you need?",
  
  "Hey there! I'm your infrastructure automation specialist. Terraform configs, best practices, cloud architecture - let's make it happen!",
  
  "Welcome! From simple storage buckets to complex microservices architectures, I'm here to help you build cloud infrastructure like a pro.",
  
  "Let's code some infrastructure! Whether you're prototyping or deploying to production, I'll help you get it done right.",
  
  "Your cloud infrastructure journey starts here! I can explain concepts, generate code, and help you avoid common pitfalls. Ready?",
  
  "Hello! I'm your infrastructure engineering partner. Let's transform your requirements into clean, maintainable infrastructure code.",
  
  "Ready to build? I specialize in turning infrastructure challenges into elegant Terraform solutions. What can I help you create today?",
  
  "Welcome!From networking to compute to storage, I'm here to help you build rock-solid cloud infrastructure. Let's get started!",
  
  "Welcome to infrastructure automation! Whether you need a quick resource or a full environment, I'll help you build it efficiently.",
  
  "Let's make infrastructure engineering fun! I can guide you through cloud concepts and generate the Terraform code you need. What's first?",
  
  "Ready for some infrastructure magic? I'll help you design, code, and deploy cloud resources with confidence. What's the plan?",
  
  "Hey there! I'm here to make your infrastructure dreams a reality. From concept to deployment, let's build something awesome!",
  
  "Welcome! Whether you're migrating to the cloud or optimizing existing infrastructure, I'm here to help. What can I do for you?",
  
  "Let's build the future! I can help you create modern, scalable infrastructure with best practices baked in. Ready to start?",
  
  "Infrastructure engineering made simple! Tell me what you need, and I'll help you build it with clean, maintainable code.",
  
  "Hello! From single resources to mult-cloud architectures, I'm your go-to for all things infrastructure. What should we build?",
  
  "Ready to deploy? I'm here to help you navigate the cloud landscape and build infrastructure that just works."
]

/**
 * Get the daily welcome message based on current date
 * Changes automatically every 24 hours
 */
export function getDailyWelcomeMessage(): string {
  const now = new Date()
  // Get day of year (0-365)
  const start = new Date(now.getFullYear(), 0, 0)
  const diff = now.getTime() - start.getTime()
  const oneDay = 1000 * 60 * 60 * 24
  const dayOfYear = Math.floor(diff / oneDay)
  
  // Rotate through messages based on day of year
  const messageIndex = dayOfYear % WELCOME_MESSAGES.length
  
  return WELCOME_MESSAGES[messageIndex]
}

/**
 * Get a specific message by index (for testing or manual selection)
 */
export function getWelcomeMessageByIndex(index: number): string {
  return WELCOME_MESSAGES[index % WELCOME_MESSAGES.length]
}

/**
 * Get total number of available messages
 */
export function getWelcomeMessageCount(): number {
  return WELCOME_MESSAGES.length
}

