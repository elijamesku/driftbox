# Start Electron app with clean port
Write-Host "Starting Electron app..." -ForegroundColor Cyan

# First, kill any existing processes on port 3000
& "$PSScriptRoot\kill-port-3000.ps1"

Start-Sleep -Seconds 2

# Set NODE_ENV explicitly
$env:NODE_ENV = "development"

# Start the Electron app
# Electron's main.js will start Next.js automatically
Write-Host "Launching Electron in development mode..." -ForegroundColor Green
Write-Host "NODE_ENV = $env:NODE_ENV" -ForegroundColor Gray

# Use npx electron directly with NODE_ENV set
npx electron electron/main.js

Write-Host "Done!" -ForegroundColor Green

