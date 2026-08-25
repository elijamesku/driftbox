#!/bin/bash
set -e

echo "🚀 Building Optimized DMG for Driftbox Desktop"
echo ""

# Configuration
BACKEND_URL="${NEXT_PUBLIC_API_URL:-http://129.212.181.126}"
APP_NAME="Driftbox"
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")

echo "📋 Configuration:"
echo "   Backend URL: $BACKEND_URL"
echo "   App Name: $APP_NAME"
echo "   Version: $VERSION"
echo ""

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf out dist *.dmg

# Clean up any leftover backups from previous failed builds
echo "🧹 Cleaning up leftover backups from previous builds..."
rm -rf "../api.backup.temp" 2>/dev/null || true
rm -rf "../teamId-page.backup.temp" 2>/dev/null || true
rm -rf "../invite-page.backup.temp" 2>/dev/null || true

# Temporarily move API routes and dynamic routes (not needed for desktop - Electron talks directly to backend)
# Only remove the page.tsx files from dynamic routes - keep the client components
# This prevents Next.js from trying to generate static pages for dynamic routes
# while still allowing the client components to be imported
API_BACKUP_DIR="../api.backup.temp"
TEAM_ID_PAGE_BACKUP="../teamId-page.backup.temp"
TEAM_INVITE_PAGE_BACKUP="../invite-page.backup.temp"

if [ -d "app/api" ]; then
  echo "📦 Temporarily moving API routes (not needed for desktop)..."
  rm -rf "$API_BACKUP_DIR"
  mv app/api "$API_BACKUP_DIR"
fi

# Move [teamId]/page.tsx only (keeps TeamDetailsClient.tsx)
if [ -f "app/teams/[teamId]/page.tsx" ]; then
  echo "📦 Moving dynamic team detail page.tsx..."
  cp "app/teams/[teamId]/page.tsx" "$TEAM_ID_PAGE_BACKUP" 2>/dev/null || true
  rm -f "app/teams/[teamId]/page.tsx" 2>/dev/null || true
fi

# Move invite/[token]/page.tsx only (keeps AcceptInvitationClient.tsx)
if [ -f "app/teams/invite/[token]/page.tsx" ]; then
  echo "📦 Moving dynamic invite page.tsx..."
  cp "app/teams/invite/[token]/page.tsx" "$TEAM_INVITE_PAGE_BACKUP" 2>/dev/null || true
  rm -f "app/teams/invite/[token]/page.tsx" 2>/dev/null || true
fi
echo "✅ Dynamic route pages moved successfully."

# Build Next.js with production optimizations
echo "🔨 Building Next.js app (optimized static export)..."
NEXT_PUBLIC_API_URL=$BACKEND_URL ELECTRON_BUILD=true NEXT_PUBLIC_ELECTRON_BUILD=true npm run build
BUILD_ERROR=$?

# Restore API routes and team routes
if [ -d "$API_BACKUP_DIR" ]; then
  echo "📦 Restoring API routes..."
  mv "$API_BACKUP_DIR" app/api
fi

# Restore dynamic route page.tsx files
if [ -f "$TEAM_ID_PAGE_BACKUP" ]; then
  echo "📦 Restoring team detail page.tsx..."
  mkdir -p "app/teams/[teamId]"
  cp "$TEAM_ID_PAGE_BACKUP" "app/teams/[teamId]/page.tsx" 2>/dev/null || true
  rm -f "$TEAM_ID_PAGE_BACKUP" 2>/dev/null || true
fi

if [ -f "$TEAM_INVITE_PAGE_BACKUP" ]; then
  echo "📦 Restoring invite page.tsx..."
  mkdir -p "app/teams/invite/[token]"
  cp "$TEAM_INVITE_PAGE_BACKUP" "app/teams/invite/[token]/page.tsx" 2>/dev/null || true
  rm -f "$TEAM_INVITE_PAGE_BACKUP" 2>/dev/null || true
fi
echo "✅ Team route pages restored."

# Check if build failed
if [ $BUILD_ERROR -ne 0 ]; then
  echo "❌ ERROR: Next.js build failed"
  exit 1
fi

# Verify out directory exists
if [ ! -d "out" ]; then
  echo "❌ ERROR: Next.js build failed - out directory not created"
  exit 1
fi

echo "✅ Next.js build complete"
echo "   Size: $(du -sh out | cut -f1)"

# Clean up platform-specific dependencies that aren't needed for Mac build
# This reduces package size and prevents electron-builder issues
echo "🧹 Cleaning up platform-specific dependencies..."
rm -rf "node_modules/@next/swc-win32-arm64"* 2>/dev/null || true
rm -rf "node_modules/@next/swc-win32-ia32"* 2>/dev/null || true
rm -rf "node_modules/@next/swc-linux"* 2>/dev/null || true
# Keep darwin packages (needed for Mac), but remove if building for specific arch only
# Note: electron-builder will handle arch-specific builds automatically

# Optimize the build output
echo "⚡ Optimizing build output..."
# Remove source maps if they exist (they're not needed in production)
find out -name "*.map" -type f -delete 2>/dev/null || true

# Package with electron-builder (optimized settings)
echo "📦 Packaging Electron app with electron-builder..."
NEXT_PUBLIC_API_URL=$BACKEND_URL npx electron-builder --mac --publish never

# Verify DMG was created
DMG_FILE=$(find dist -name "*.dmg" -type f | head -1)
if [ -z "$DMG_FILE" ]; then
  echo "❌ ERROR: DMG file not created"
  exit 1
fi

echo ""
echo "✅ ✅ ✅ BUILD COMPLETE! ✅ ✅ ✅"
echo ""
echo "📦 DMG location: $DMG_FILE"
echo "📏 DMG size: $(du -h "$DMG_FILE" | cut -f1)"
echo ""
echo "🎯 Performance optimizations applied:"
echo "   ✓ ASAR packaging enabled (faster file access)"
echo "   ✓ Optimized DMG compression (UDZO format)"
echo "   ✓ Source maps removed"
echo "   ✓ Static export with Next.js optimizations"
echo ""
echo "📋 Next steps:"
echo "   1. Test the DMG: open $DMG_FILE"
echo "   2. Verify app performance"
echo "   3. Distribute to users!"
echo ""

