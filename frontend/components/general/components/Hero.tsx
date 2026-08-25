'use client'

import { motion } from 'framer-motion'
import { useState, useEffect } from 'react' 

const CURSOR_CHAR = '|'

export default function Hero() {
  const [cursorVisible, setCursorVisible] = useState(true)
  const [activeTab, setActiveTab] = useState(0)
  const [codeVisible, setCodeVisible] = useState(false)
  const [prCount, setPrCount] = useState(1251)

  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible((v) => !v)
    }, 530)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const basePrCount = 1251
    
    // Animate counting up to 1251 on page load
    const duration = 2000 // 2 seconds
    const startTime = Date.now()
    const startValue = 0
    
    const animateCount = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      // Easing function for smooth animation
      const easeOutQuart = 1 - Math.pow(1 - progress, 4)
      const currentCount = Math.floor(startValue + (basePrCount - startValue) * easeOutQuart)
      setPrCount(currentCount)
      
      if (progress < 1) {
        requestAnimationFrame(animateCount)
      } else {
        // After animation completes, start the 2-hour increment logic
        const startDate = new Date()
        
        const updateCount = () => {
          const now = new Date()
          const minutesElapsed = (now.getTime() - startDate.getTime()) / (1000 * 60)
          const periodsElapsed = Math.floor(minutesElapsed / 120) // 2 hours = 120 minutes
          setPrCount(basePrCount + (periodsElapsed * 3))
        }
        
        // Update every minute
        const interval = setInterval(updateCount, 60000)
        
        // Initial update
        updateCount()
      }
    }
    
    animateCount()
  }, [])

  useEffect(() => {
    setCodeVisible(false)
    const timer = setTimeout(() => setCodeVisible(true), 100)
    return () => clearTimeout(timer)
  }, [activeTab])

  const tabs = [
    { name: 'infrastructure.tf', type: 'code' },
    { name: 'explanation.md', type: 'explanation' },
    { name: 'diff', type: 'diff' },
  ]

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-6 sm:px-8 lg:px-12 pt-32">
      {/* Simple centered content */}
      <div className="w-full max-w-4xl mx-auto text-center">
        {/* PR Counter */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex items-center justify-center gap-2 mb-10"
        >
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-2 h-2 rounded-full bg-green-500"
          />
          <span className="text-xs text-gray-500 font-mono">
            PRs created {prCount.toLocaleString()}
          </span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
            <p className="text-sm text-gray-500 mb-8 tracking-wider uppercase">
              Infrastructure as Code — Automated
            </p>
          
          <div className="text-6xl sm:text-7xl font-bold mb-6 text-white tracking-tight">
            <motion.span
              initial={{ opacity: 0, y: 20 }}
              animate={{ 
                opacity: 1,
                y: 0,
              }}
              transition={{ 
                duration: 0.8, 
                delay: 0.1
              }}
              className="relative inline-block"
              style={{
                textShadow: '0 0 20px rgba(168, 85, 247, 0.3), 0 0 40px rgba(168, 85, 247, 0.15)'
              }}
            >
              AI-first
            </motion.span>
            <br />
            <motion.span
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="relative inline-block"
            >
              Infrastructure Builder
            </motion.span>
          </div>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-xl text-gray-500 mb-12 max-w-2xl mx-auto"
          >
            Deploy your infrastructure faster than ever before in the worlds first cloud-agnostic, DevOps-only IDE
        </motion.p>

        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mb-12"
        > 
          </motion.div>
        </motion.div>
      </div>

      {/* Code editor preview */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.4, type: "spring", stiffness: 300, damping: 30 }}
        className="w-full max-w-5xl mx-auto mt-16"
        whileHover={{ 
          scale: 1.01,
          boxShadow: '0 25px 100px rgba(168, 85, 247, 0.3)',
          borderColor: 'rgba(168, 85, 247, 0.5)'
        }}
      >
        <motion.div 
          className="bg-black rounded-lg border border-[#21262d] overflow-hidden shadow-2xl group transition-colors"
        >
          {/* Terminal bar */}
          <div className="bg-[#0d1117] border-b border-[#21262d]">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[#21262d]">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <div className="w-3 h-3 rounded-full bg-[#28ca42]" />
              </div>
              <div className="flex-1" />
              <span className="text-xs text-[#8b949e] font-mono">infrara</span>
              <div className="flex-1" />
              <div className="flex gap-3 items-center">
                <svg className="w-4 h-4 text-[#8b949e] hover:text-white cursor-pointer" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <div className="w-5 h-5 rounded bg-green-500/20 flex items-center justify-center">
                  <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M13.5 4.5l3 3a5 5 0 01-5 5v-6a5 5 0 01-5-5l3-3 4 3z" />
                  </svg>
                </div>
              </div>
            </div>
            {/* Tabs */}
            <div className="flex items-center gap-1 px-4 py-1 border-b border-[#21262d]">
              {tabs.map((tab, index) => (
                <motion.button
                  key={index}
                  onClick={() => setActiveTab(index)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.95 }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: index * 0.1 }}
                  className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                    activeTab === index
                      ? 'text-white bg-black border-b-2 border-purple-500'
                      : 'text-[#8b949e] hover:text-[#c9d1d9]'
                  }`}
                >
                  {tab.name}
                </motion.button>
              ))}
              <motion.button
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                className="p-2 text-[#8b949e] hover:text-white rounded transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </motion.button>
            </div>
          </div>

          {/* Editor content */}
          <div className="h-[450px] overflow-hidden relative bg-black">
            {/* AI Assistant Panel */}
            <motion.div
              initial={{ x: -1000 }}
              animate={{ x: 0 }}
              transition={{ duration: 0.6, delay: 0.8 }}
              className="absolute inset-y-0 right-0 w-[400px] bg-black border-l border-[#21262d] p-4"
            >
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1 }}
                className="flex items-center gap-2 mb-4"
              >
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-2 h-2 rounded-full bg-purple-500"
                />
                <span className="text-xs font-medium text-[#c9d1d9]">Infrara AI</span>
              </motion.div>
              <div className="space-y-3">
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 1.2 }}
                  className="p-3 rounded border border-[#21262d] bg-black"
                >
                  <p className="text-xs text-[#8b949e] mb-2">User asked:</p>
                  <p className="text-sm text-white">Create a secure Lambda API with auto-scaling</p>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 1.4 }}
                  className="p-3 rounded border border-[#21262d]"
                >
                  <p className="text-xs text-[#8b949e] mb-2">Infrara AI:</p>
                  <p className="text-sm text-[#c9d1d9] leading-relaxed">
                    Generating Terraform configuration with:
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-[#8b949e] ml-4">
                    <li>• VPC isolation</li>
                    <li>• Auto-scaling enabled</li>
                    <li>• Security groups</li>
                    <li>• IAM roles</li>
                  </ul>
                </motion.div>
              </div>
            </motion.div>

            {/* Code view - scrollable */}
            <div className="h-full overflow-auto cursor-text">
              <motion.pre
                initial={{ opacity: 0 }}
                animate={{ opacity: codeVisible ? 1 : 0 }}
                transition={{ duration: 0.3 }}
                className="p-6 text-sm font-mono leading-relaxed whitespace-pre"
              >
                <code className="block">
                  {activeTab === 0 ? (
                    // infrastructure.tf - Main Terraform code
                    <>
                      <span className="text-[#58a6ff]"># Generated by Infrara AI</span>{'\n'}
                      <span className="text-[#8b949e]"># Request: Create a secure API with auto-scaling</span>{'\n\n'}
                      <span className="text-[#79c0ff]">terraform</span> <span className="text-[#d2a8ff]">{'{'}</span>{'\n'}
                      <span className="text-[#8b949e]">  # Terraform configuration</span>{'\n'}
                      <span className="text-[#79c0ff]">  required_providers</span> <span className="text-[#d2a8ff]">{'{'}</span>{'\n'}
                      <span className="text-[#58a6ff]">    aws</span> <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">{'{'}</span>{'\n'}
                      <span className="text-[#c9d1d9]">      source</span>  <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"hashicorp/aws"</span>{'\n'}
                      <span className="text-[#c9d1d9]">      version</span> <span className="text-[#79c0ff]">=</span> <span className="text-[#a5d6ff]">"~&gt; 5.0"</span>{'\n'}
                      <span className="text-[#7ee787]">    {'}'}</span>{'\n'}
                      <span className="text-[#d2a8ff]">  {'}'}</span>{'\n'}
                      <span className="text-[#d2a8ff]">{'}'}</span>{'\n\n'}
                      <span className="text-[#79c0ff]">resource</span> <span className="text-[#d2a8ff]">"aws_lambda_function"</span> <span className="text-[#a5d6ff]">"api"</span> <span className="text-[#d2a8ff]">{'{'}</span>{'\n'}
                      <span className="text-[#c9d1d9]">  function_name</span> <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"secure-api"</span>{'\n'}
                      <span className="text-[#c9d1d9]">  runtime</span>      <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"python3.11"</span>{'\n'}
                      <span className="text-[#c9d1d9]">  handler</span>       <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"index.handler"</span>{'\n\n'}
                      <span className="text-[#8b949e]">  # Auto-scaling configuration</span>{'\n'}
                      <span className="text-[#c9d1d9]">  reserved_concurrent_executions</span> <span className="text-[#79c0ff]">=</span> <span className="text-[#a5d6ff]">100</span>{'\n\n'}
                      <span className="text-[#c9d1d9]">  vpc_config</span> <span className="text-[#d2a8ff]">{'{'}</span>{'\n'}
                      <span className="text-[#c9d1d9]">    subnet_ids</span>         <span className="text-[#79c0ff]">=</span> <span className="text-[#58a6ff]">aws_subnet.private</span><span className="text-[#a5d6ff]">[*]</span><span className="text-[#58a6ff]">.id</span>{'\n'}
                      <span className="text-[#c9d1d9]">    security_group_ids</span> <span className="text-[#79c0ff]">=</span> <span className="text-[#d2a8ff]">[</span><span className="text-[#58a6ff]">aws_security_group.lambda.id</span><span className="text-[#d2a8ff]">]</span>{'\n'}
                      <span className="text-[#d2a8ff]">  {'}'}</span>{'\n\n'}
                      <span className="text-[#c9d1d9]">  tags</span> <span className="text-[#d2a8ff]">{'{'}</span>{'\n'}
                      <span className="text-[#c9d1d9]">    Name</span>       <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"secure-api"</span>{'\n'}
                      <span className="text-[#c9d1d9]">    ManagedBy</span>  <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"Infrara"</span>{'\n'}
                      <span className="text-[#d2a8ff]">  {'}'}</span>{'\n'}
                      <span className="text-[#d2a8ff]">{'}'}</span>{'\n\n'}
                      <span className="text-[#79c0ff]">resource</span> <span className="text-[#d2a8ff]">"aws_cloudwatch_log_group"</span> <span className="text-[#a5d6ff]">"api_logs"</span> <span className="text-[#d2a8ff]">{'{'}</span>{'\n'}
                      <span className="text-[#c9d1d9]">  name</span>              <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"/aws/lambda/secure-api"</span>{'\n'}
                      <span className="text-[#c9d1d9]">  retention_in_days</span>   <span className="text-[#79c0ff]">=</span> <span className="text-[#a5d6ff]">30</span>{'\n'}{'\n'}
                      <span className="text-[#c9d1d9]">  tags</span> <span className="text-[#d2a8ff]">{'{'}</span>{'\n'}
                      <span className="text-[#c9d1d9]">    Environment</span>  <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"production"</span>{'\n'}
                      <span className="text-[#c9d1d9]">    ManagedBy</span>     <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"Infrara"</span>{'\n'}
                      <span className="text-[#d2a8ff]">  {'}'}</span>{'\n'}
                      <span className="text-[#d2a8ff]">{'}'}</span>{'\n\n'}
                      <span className="text-[#79c0ff]">resource</span> <span className="text-[#d2a8ff]">"aws_iam_role"</span> <span className="text-[#a5d6ff]">"lambda_execution"</span> <span className="text-[#d2a8ff]">{'{'}</span>{'\n'}
                      <span className="text-[#c9d1d9]">  name</span> <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"lambda-execution-role"</span>{'\n'}{'\n'}
                      <span className="text-[#c9d1d9]">  assume_role_policy</span> <span className="text-[#79c0ff]">=</span> <span className="text-[#79c0ff]">jsonencode</span><span className="text-[#d2a8ff]">({'{'}</span>{'\n'}
                      <span className="text-[#79c0ff]">    Version</span> <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"2012-10-17"</span>{'\n'}
                      <span className="text-[#79c0ff]">    Statement</span> <span className="text-[#79c0ff]">=</span> <span className="text-[#d2a8ff]">[{'{'}</span>{'\n'}
                      <span className="text-[#79c0ff]">      Effect</span>    <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"Allow"</span>{'\n'}
                      <span className="text-[#79c0ff]">      Principal</span> <span className="text-[#79c0ff]">=</span> <span className="text-[#d2a8ff]">{'{'}</span>{'\n'}
                      <span className="text-[#79c0ff]">        Service</span> <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"lambda.amazonaws.com"</span>{'\n'}
                      <span className="text-[#d2a8ff]">      {'}'}</span>{'\n'}
                      <span className="text-[#79c0ff]">      Action</span>    <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"sts:AssumeRole"</span>{'\n'}
                      <span className="text-[#d2a8ff]">    </span><span className="text-[#d2a8ff]">{'}'}</span><span className="text-[#d2a8ff]">]</span>{'\n'}
                      <span className="text-[#d2a8ff]">  {'}'})</span>{'\n'}{'\n'}
                      <span className="text-[#c9d1d9]">  tags</span> <span className="text-[#d2a8ff]">{'{'}</span>{'\n'}
                      <span className="text-[#c9d1d9]">    Name</span>       <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"lambda-execution"</span>{'\n'}
                      <span className="text-[#c9d1d9]">    ManagedBy</span>  <span className="text-[#79c0ff]">=</span> <span className="text-[#7ee787]">"Infrara"</span>{'\n'}
                      <span className="text-[#d2a8ff]">  {'}'}</span>{'\n'}
                      <span className="text-[#d2a8ff]">{'}'}</span>{'\n\n'}
                      <span className="text-[#8b949e]">  </span>
                      <span className="text-[#8b949e]">
                        {cursorVisible && CURSOR_CHAR}
                      </span>
                    </>
                  ) : activeTab === 1 ? (
                    // explanation.md - Documentation
                    <>
                      <span className="text-[#58a6ff]"># Infrastructure Explanation</span>{'\n\n'}
                      <span className="text-[#8b949e]">## Overview</span>{'\n'}
                      <span className="text-white">This Terraform configuration creates a secure, auto-scaling Lambda API with comprehensive monitoring and IAM roles.</span>{'\n\n'}
                      <span className="text-[#8b949e]">## Components</span>{'\n\n'}
                      <span className="text-[#58a6ff]">### 1. Lambda Function (`aws_lambda_function`)</span>{'\n'}
                      <span className="text-white">- Python 3.11 runtime for modern language features</span>{'\n'}
                      <span className="text-white">- Reserved concurrency: 100 to control costs</span>{'\n'}
                      <span className="text-white">- VPC isolation for enhanced security</span>{'\n'}{'\n'}
                      <span className="text-[#58a6ff]">### 2. CloudWatch Logs (`aws_cloudwatch_log_group`)</span>{'\n'}
                      <span className="text-white">- Centralized logging infrastructure</span>{'\n'}
                      <span className="text-white">- 30-day retention for compliance</span>{'\n'}{'\n'}
                      <span className="text-[#58a6ff]">### 3. IAM Role (`aws_iam_role`)</span>{'\n'}
                      <span className="text-white">- Least-privilege execution policy</span>{'\n'}
                      <span className="text-white">- Automatic assume role for Lambda service</span>{'\n\n'}
                      <span className="text-[#8b949e]">## Security Features</span>{'\n'}
                      <span className="text-green-500">✓</span><span className="text-white"> VPC isolation prevents direct internet access</span>{'\n'}
                      <span className="text-green-500">✓</span><span className="text-white"> Security groups control traffic flow</span>{'\n'}
                      <span className="text-green-500">✓</span><span className="text-white"> Private subnets for internal networking</span>{'\n'}
                      <span className="text-green-500">✓</span><span className="text-white"> CloudWatch monitoring enabled</span>{'\n\n'}
                      <span className="text-[#8b949e]">
                        {cursorVisible && CURSOR_CHAR}
                      </span>
                    </>
                  ) : (
                    // diff - Show code changes
                    <>
                      <span className="text-[#8b949e]">diff --git a/infrastructure.tf b/infrastructure.tf</span>{'\n'}
                      <span className="text-[#8b949e]">index abc1234..def5678 100644</span>{'\n'}
                      <span className="text-[#8b949e]">--- a/infrastructure.tf</span>{'\n'}
                      <span className="text-[#8b949e]">+++ b/infrastructure.tf</span>{'\n'}
                      <span className="text-[#8b949e]">@@ -1,5 +1,14 @@</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-[#58a6ff]"> # Generated by Infrara AI</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-[#8b949e]"> # Request: Create a secure API</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span>{'\n'}
                      <span className="text-white">  terraform {'{'}</span>{'\n'}
                      <span className="text-white">    required_providers {'{'}</span>{'\n'}
                      <span className="text-red-500">-</span><span className="text-white">     version = </span><span className="text-[#a5d6ff]">"~&gt; 4.0"</span>{'\n'}
                      <span className="text-green-500">+</span><span className="text-white">     version = </span><span className="text-[#a5d6ff]">"~&gt; 5.0"</span>{'\n'}
                      <span className="text-white">   {'}'}</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-white"> resource </span><span className="text-[#d2a8ff]">"aws_lambda_function"</span> <span className="text-[#a5d6ff]">"api"</span> <span className="text-white">{'{'}</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-white">   function_name = </span><span className="text-green-500">"secure-api"</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-white">   runtime      = </span><span className="text-green-500">"python3.11"</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-white">   handler       = </span><span className="text-green-500">"index.handler"</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-white">   reserved_concurrent_executions = </span><span className="text-[#a5d6ff]">100</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-white">   vpc_config {'{'}</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-white">     subnet_ids = </span><span className="text-[#58a6ff]">aws_subnet.private[*]</span><span className="text-white">.id</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-white">     security_group_ids = [</span><span className="text-[#58a6ff]">aws_security_group.lambda.id</span><span className="text-white">]</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-white">   {'}'}</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-white">   tags {'{'}</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-white">     ManagedBy = </span><span className="text-green-500">"Infrara"</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-white">   {'}'}</span>{'\n'}
                      <span className="text-[#79c0ff]">+</span><span className="text-white"> {'}'}</span>{'\n\n'}
                      <span className="text-[#8b949e]">
                        {cursorVisible && CURSOR_CHAR}
                      </span>
                    </>
                  )}
                </code>
              </motion.pre>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </section>
  )
}

