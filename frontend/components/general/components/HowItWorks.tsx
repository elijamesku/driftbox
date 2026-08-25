'use client'

import { motion } from 'framer-motion'
import { CheckCircle2, Shield, Zap, Database } from 'lucide-react'

const steps = [
  {
    number: '1',
    title: 'Describe',
    subtitle: 'Tell Infrara what you need',
    description: 'Simply describe your infrastructure requirements in plain English. No YAML, no HCL, just conversation.',
    features: [
      'Natural language processing',
      'Context-aware understanding',
      'Multi-resource requests'
    ],
    icon: Database,
  },
  {
    number: '2',
    title: 'Generate',
    subtitle: 'AI-powered generation with RAG & MCP',
    description: 'Infrara uses Retrieval-Augmented Generation to pull from Terraform registry knowledge, and MCP validation to ensure production-readiness.',
    features: [
      'RAG pulls from AWS/GCP/Azure registry',
      'MCP validates security & compliance',
      'Auto-optimized for cost & performance'
    ],
    icon: Zap,
  },
  {
    number: '3',
    title: 'Deploy',
    subtitle: 'Review, validate & deploy',
    description: 'Get a detailed diff, cost estimate, and policy checks. Approve and deploy with full transparency.',
    features: [
      'Real-time cost estimation',
      'Policy compliance checks',
      'Git-ready diffs'
    ],
    icon: Shield,
  },
]

export default function HowItWorks() {
  return (
    <section className="relative py-32 px-6 sm:px-8 lg:px-12">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <motion.h2 
            className="text-4xl sm:text-5xl font-bold mb-4 text-white tracking-tight"
            animate={{ 
              backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
            }}
            transition={{ 
              duration: 10, 
              repeat: Infinity,
              ease: "linear"
            }}
            style={{
              backgroundImage: 'linear-gradient(90deg, #fff 0%, #a855f7 50%, #3b82f6 50%, #fff 100%)',
              backgroundSize: '200% auto',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}
          >
            How It Works
          </motion.h2>
          <p className="text-lg text-[#8b949e] max-w-2xl mx-auto">
            Three steps from description to deployment, powered by RAG, MCP, and AI
          </p>
        </motion.div>

        <div className="space-y-8">
          {steps.map((step, index) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.2 }}
              className="border border-[#21262d] rounded-lg bg-black overflow-hidden hover:border-purple-500/50 transition-all relative"
              whileHover={{ scale: 1.01, boxShadow: '0 20px 60px rgba(139, 92, 246, 0.2)' }}
            >
              {/* Animated gradient border on hover */}
              <motion.div
                className="absolute inset-0 opacity-0 group-hover:opacity-100"
                animate={{ 
                  background: [
                    'linear-gradient(90deg, rgba(139, 92, 246, 0) 0%, rgba(139, 92, 246, 0.1) 50%, rgba(139, 92, 246, 0) 100%)',
                    'linear-gradient(90deg, rgba(139, 92, 246, 0) 0%, rgba(139, 92, 246, 0.2) 50%, rgba(139, 92, 246, 0) 100%)',
                  ]
                }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <div className="grid md:grid-cols-12 gap-6 p-8 relative z-10">
                {/* Left side - Number and icon */}
                <div className="md:col-span-2 flex flex-col items-start gap-4">
                  <motion.div 
                    className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-purple-500/10 border border-purple-500/20 text-lg font-semibold text-purple-400"
                    animate={{ 
                      rotate: [0, 5, -5, 0],
                      scale: [1, 1.05, 1]
                    }}
                    transition={{ 
                      duration: 3,
                      repeat: Infinity,
                      delay: index * 0.5
                    }}
                  >
                {step.number}
                  </motion.div>
                  <motion.div
                    animate={{ y: [0, -5, 0] }}
                    transition={{ 
                      duration: 2,
                      repeat: Infinity,
                      delay: index * 0.3
                    }}
                  >
                    <step.icon className="w-8 h-8 text-purple-500/50" />
                  </motion.div>
              </div>

                {/* Right side - Content */}
                <div className="md:col-span-10">
                  <div className="mb-3">
                    <h3 className="text-2xl font-bold text-white mb-1">
                {step.title}
              </h3>
                    <p className="text-purple-400 font-medium">
                      {step.subtitle}
                    </p>
                  </div>
                  
                  <p className="text-[#8b949e] mb-4 leading-relaxed">
                {step.description}
              </p>

                  <div className="space-y-2">
                    {step.features.map((feature, featIndex) => (
                      <motion.div 
                        key={featIndex} 
                        className="flex items-start gap-2"
                        initial={{ opacity: 0, x: -10 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.2 + featIndex * 0.1 }}
                        whileHover={{ x: 4 }}
                      >
                        <motion.div
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{ duration: 2, repeat: Infinity, delay: featIndex * 0.3 }}
                        >
                          <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        </motion.div>
                        <span className="text-sm text-[#8b949e]">{feature}</span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Additional info box */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="mt-12 border border-purple-500/20 rounded-lg bg-purple-500/5 p-6"
        >
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-semibold text-purple-400 mb-2 uppercase tracking-wider">RAG</h4>
              <p className="text-sm text-[#8b949e]">
                Retrieval-Augmented Generation pulls from official Terraform provider documentation, 
                ensuring your code uses best practices and up-to-date resource configurations.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-purple-400 mb-2 uppercase tracking-wider">MCP Validation</h4>
              <p className="text-sm text-[#8b949e]">
                Model Context Protocol validates your infrastructure against security policies, 
                cost optimization rules, and compliance requirements before deployment.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-purple-400 mb-2 uppercase tracking-wider">Cost Estimation</h4>
              <p className="text-sm text-[#8b949e]">
                Real-time cost tracking for 15+ AWS resources. Per-resource breakdown with budget alerts 
                at 80% thresholds. Know exactly what you'll spend before deploying.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-purple-400 mb-2 uppercase tracking-wider">OPA Policies</h4>
              <p className="text-sm text-[#8b949e]">
                Open Policy Agent with Rego policies enforces security, compliance, and governance rules. 
                Automated policy checks before every deployment with human-readable explanations.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

