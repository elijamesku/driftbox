#!/bin/bash
# Script to install Electron dependencies for desktop development
# Run this locally: chmod +x install-electron.sh && ./install-electron.sh

echo "Installing Electron dependencies for desktop development..."
npm install electron cross-env chokidar electron-builder --save-dev --no-optional

echo "✅ Electron dependencies installed!"
echo "Now you can run: npm run dev:electron"

