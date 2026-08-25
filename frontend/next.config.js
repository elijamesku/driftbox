/** @type {import('next').NextConfig} */
const isElectron = process.env.ELECTRON_BUILD === 'true'

const nextConfig = {
  reactStrictMode: true,
  
  // Enable static export for Electron builds
  output: isElectron ? 'export' : undefined,
  
  // Trailing slash for static export compatibility
  trailingSlash: isElectron ? true : false,
  
  // ✅ KEY FIX: Use relative paths for file:// protocol (Electron)
  // This changes /_next/static/... to ./_next/static/... so assets load correctly
  assetPrefix: isElectron ? './' : undefined,
  
  // Skip type checking during build (we'll run it separately)
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  
  // Monaco Editor webpack configuration
  webpack: (config, { isServer, dev }) => {
    // Don't bundle Monaco Editor on the server side
    if (isServer) {
      config.externals = [...(config.externals || []), 'monaco-editor']
    } else {
      // Client-side Monaco Editor configuration
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        module: false,
      }
      
      // Handle web-tree-sitter and tree-sitter grammars which try to use Node.js modules
      const webpack = require('webpack')
      
      // Alias Node.js bindings to empty modules
      config.resolve.alias = {
        ...config.resolve.alias,
        'module': false,
        'node-gyp-build': false,
        '@tree-sitter-grammars/tree-sitter-hcl/bindings/node': false,
      }
      
      // Exclude Node.js bindings from tree-sitter grammars
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        module: false,
        'node-gyp-build': false,
      }
      
      // Use NormalModuleReplacementPlugin to replace problematic imports
      config.plugins = config.plugins || []
      
      // Create an empty module path for replacements
      const path = require('path')
      const fs = require('fs')
      const emptyModule = path.resolve(__dirname, 'empty-module.js')
      
      // Verify empty-module.js exists, create it if it doesn't
      if (!fs.existsSync(emptyModule)) {
        console.warn('[Next.js Config] empty-module.js not found, creating it...')
        fs.writeFileSync(emptyModule, '// Empty module to replace Node.js bindings that can\'t run in browser\nmodule.exports = {};\n', 'utf-8')
      }
      
      config.plugins.push(
        // Ignore node-gyp-build entirely
        new webpack.IgnorePlugin({
          resourceRegExp: /^node-gyp-build$/,
        }),
        // Replace bindings/node imports with empty module
        new webpack.NormalModuleReplacementPlugin(
          /@tree-sitter-grammars\/tree-sitter-hcl\/bindings\/node/,
          emptyModule
        ),
        // Replace the entire package index if it tries to load Node.js bindings
        // This prevents the require() call from executing
        // Note: The package's index.js tries to require() Node.js bindings at module load time
        // We can't easily replace that with webpack, but our try-catch in hclParser.ts will handle it
        new webpack.NormalModuleReplacementPlugin(
          /@tree-sitter-grammars\/tree-sitter-hcl$/,
          (resource) => {
            // Keep original request - the IgnorePlugin above will prevent bindings from being bundled
            // The runtime code will handle the missing bindings gracefully
            resource.request = resource.request
          }
        ),
        // Also ignore any require() calls in the bindings
        new webpack.IgnorePlugin({
          resourceRegExp: /bindings\/node/,
          contextRegExp: /@tree-sitter-grammars/,
        }),
        // Ignore the entire bindings directory
        new webpack.IgnorePlugin({
          checkResource(resource, context) {
            // Ignore if it's trying to import from bindings/node
            if (context && context.includes('@tree-sitter-grammars') && resource.includes('bindings/node')) {
              return true
            }
            return false
          }
        })
      )
      
      // Note: The package's index.js tries to require() Node.js bindings at module load time
      // We can't easily replace that with webpack, but our try-catch in hclParser.ts will handle it
      // The IgnorePlugin above should prevent the bindings from being bundled
    }
    
    // Performance optimizations for production
    if (!isServer && !dev) {
      // Optimize chunk splitting
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            default: false,
            vendors: false,
            // Vendor chunk for large libraries
            vendor: {
              name: 'vendor',
              chunks: 'all',
              test: /node_modules/,
              priority: 20,
            },
            // Separate chunk for common modules
            common: {
              name: 'common',
              minChunks: 2,
              chunks: 'all',
              priority: 10,
              reuseExistingChunk: true,
              enforce: true,
            },
            // Monaco Editor in its own chunk (large)
            monaco: {
              name: 'monaco',
              test: /[\\/]node_modules[\\/](monaco-editor|@monaco-editor)[\\/]/,
              chunks: 'all',
              priority: 30,
            },
            // React Query in its own chunk
            reactQuery: {
              name: 'react-query',
              test: /[\\/]node_modules[\\/]@tanstack[\\/]/,
              chunks: 'all',
              priority: 25,
            },
          },
        },
      }
    }

    return config
  },
  
  // Performance optimizations
  compress: true,
  poweredByHeader: false,
  generateEtags: false,
  
  // SWC Minification (faster than Terser)
  swcMinify: true,
  
  // Experimental optimizations
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@tanstack/react-query',
      'framer-motion',
    ],
  },
  
  // Optimize production builds
  productionBrowserSourceMaps: false,
  
  // Image optimization
  images: {
    unoptimized: true,  // Required for static export
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
  },
  
  // Headers for SEO and security (not used in static export)
  ...((process.env.ELECTRON_BUILD !== 'true') ? {
    async headers() {
      return [
        {
          source: '/(.*)',
          headers: [
            {
              key: 'X-Frame-Options',
              value: 'DENY',
            },
            {
              key: 'X-Content-Type-Options',
              value: 'nosniff',
            },
            {
              key: 'Referrer-Policy',
              value: 'origin-when-cross-origin',
            },
            {
              key: 'X-DNS-Prefetch-Control',
              value: 'on',
            },
          ],
        },
        {
          source: '/sitemap.xml',
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=86400, s-maxage=86400',
            },
          ],
        },
        {
          source: '/robots.txt',
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=86400, s-maxage=86400',
            },
          ],
        },
      ]
    },
    
    // Redirects for SEO (not used in static export)
    async redirects() {
      return [
        {
          source: '/home',
          destination: '/',
          permanent: true,
        },
      ]
    },
  } : {}),
}

module.exports = nextConfig

