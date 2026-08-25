'use client'

import { motion } from 'framer-motion'
import { 
  Sparkles, 
  Cloud, 
  Shield, 
  GitBranch 
} from 'lucide-react'

const features = [
  {
    icon: Sparkles,
    title: 'Natural Language Terraform',
    description: 'Describe your infrastructure in plain English. We generate production-ready Terraform code instantly.',
  },
  {
    icon: Cloud,
    title: 'AI-Powered Conversations',
    description: 'Chat with your infrastructure. Ask questions, get recommendations, and iterate on designs.',
  },
  {
    icon: Shield,
    title: 'Cost & Policy Compliance',
    description: 'Automated cost estimation and policy checks ensure your infrastructure stays compliant.',
  },
  {
    icon: GitBranch,
    title: 'Git Integration',
    description: 'Seamless integration with your workflow. Preview changes before deployment.',
  },
]

export default function Features() {
  return (
    <section className="relative py-24 px-6 sm:px-8 lg:px-12">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <motion.h2 
            className="text-3xl sm:text-4xl font-bold mb-3 text-white tracking-tight"
            animate={{ 
              backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
            }}
            transition={{ 
              duration: 8, 
              repeat: Infinity,
              ease: "linear"
            }}
            style={{
              backgroundImage: 'linear-gradient(90deg, #fff 0%, #a855f7 50%, #fff 100%)',
              backgroundSize: '200% auto',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}
          >
            Everything you need
          </motion.h2>
          <p className="text-lg text-gray-500">
            Ship infrastructure faster and safer
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              whileHover={{ 
                backgroundColor: 'rgba(139, 92, 246, 0.05)',
                scale: 1.02,
                y: -4,
                borderColor: 'rgba(139, 92, 246, 0.5)',
                boxShadow: '0 20px 50px rgba(139, 92, 246, 0.15)'
              }}
              className="rounded-lg p-6 border border-[#30363d] bg-[#161b22]/50 group transition-all relative overflow-hidden"
            >
              {/* Animated glow effect */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-purple-500/0 via-purple-500/10 to-purple-500/0 opacity-0"
                whileHover={{ opacity: 1, x: ['-100%', '200%'] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              />
              <div className="flex items-start gap-4 relative z-10">
                <motion.div 
                  className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/20 group-hover:border-purple-500/40 transition-colors"
                  whileHover={{ 
                    rotate: [0, -10, 10, -10, 0],
                    scale: 1.1
                  }}
                  transition={{ duration: 0.5 }}
                >
                  <feature.icon className="w-5 h-5 text-purple-400" />
                </motion.div>
                <div className="flex-1">
                  <motion.h3 
                    className="text-base font-semibold mb-1.5 text-white"
                    whileHover={{ x: 4 }}
                  >
                    {feature.title}
                  </motion.h3>
                  <motion.p 
                    className="text-sm text-[#8b949e] leading-relaxed"
                    initial={{ opacity: 0.7 }}
                    whileHover={{ opacity: 1 }}
                  >
                    {feature.description}
                  </motion.p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

