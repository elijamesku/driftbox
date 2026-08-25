import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/contexts'

export const metadata: Metadata = {
  title: 'Driftbox - Infrastructure Operating System',
  description: 'Deploy cloud infrastructure faster than ever with Driftbox, an Infrastructure Operating System. Build and manage AWS, Azure, and GCP resources using natural language.',
  keywords: [
    'infrastructure as code',
    'terraform automation',
    'devops tools',
    'ai infrastructure',
    'cloud automation',
    'aws terraform',
    'azure infrastructure',
    'gcp automation',
    'infrastructure management',
    'devops ide',
    'cloud-agnostic',
    'natural language infrastructure',
    'infrastructure deployment',
    'cloud resources',
    'terraform generator',
    'devops platform',
    'infrastructure builder',
    'cloud infrastructure tool',
    'automated devops',
    'infrastructure as conversation'
  ],
  openGraph: {
    title: 'Driftbox - Infrastructure Operating System',
    description: 'Deploy cloud infrastructure faster than ever with Driftbox. Build and manage AWS, Azure, and GCP resources using natural language.',
    type: 'website',
    url: 'https://driftbox.com',
    siteName: 'Driftbox',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Driftbox - Infrastructure Operating System',
    description: 'Deploy cloud infrastructure faster than ever with Driftbox.',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Driftbox",
    "description": "Infrastructure Operating System - Deploy cloud infrastructure faster than ever with natural language. Terraform without the complexity.",
    "url": "https://driftbox.com",
    "applicationCategory": "DeveloperApplication",
    "operatingSystem": "Web",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    },
    "creator": {
      "@type": "Organization",
      "name": "Driftbox Team"
    }
  }

  return (
    <html lang="en">
      <head>
        {/* Preconnect to CDN for faster font loading */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://code.iconify.design" />
        
        {/* Cascadia Code - Load with font-display: swap to prevent render blocking */}
        <link 
          href="https://cdn.jsdelivr.net/npm/@fontsource/cascadia-code@4.2.1/index.css" 
          rel="stylesheet"
          crossOrigin="anonymous"
        />
        
        {/* VS Code Codicons - Load with font-display: swap */}
        <link 
          href="https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.41/dist/codicon.css" 
          rel="stylesheet"
          crossOrigin="anonymous"
        />
        
        {/* Iconify for file type icons - Load async to prevent blocking render */}
        <script 
          src="https://code.iconify.design/3/3.1.0/iconify.min.js" 
          async
          defer
          crossOrigin="anonymous"
        />
        
        {/* Structured data for SEO */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}

