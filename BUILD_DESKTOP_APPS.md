# Building Infrara Desktop Apps

Complete guide to building macOS and Windows installers for Infrara.

## Prerequisites

### For All Platforms
- Node.js 18+ installed
- All dependencies installed: `cd frontend && npm install`

### For macOS Building
- macOS 10.13+ (High Sierra or later)
- Xcode Command Line Tools: `xcode-select --install`

### For Windows Building
- Windows 10+ or
- macOS/Linux with Wine installed (for cross-platform building)

### For Code Signing (Optional but Recommended)

**macOS:**
- Apple Developer Account ($99/year)
- Developer ID Application certificate
- Apple ID and app-specific password for notarization

**Windows:**
- Code signing certificate (from DigiCert, Sectigo, etc.)
- Cost: ~$200-400/year

---

## Quick Start (Build Without Code Signing)

### Build for macOS

```bash
cd frontend

# 1. Build Next.js app for production
npm run build
npm run export  # Or: next export

# 2. Build Electron app
npm run build:electron

# Output: dist/Infrara-1.0.0-mac.dmg and dist/Infrara-1.0.0-mac.zip
```

### Build for Windows (on Windows)

```bash
cd frontend

# 1. Build Next.js app
npm run build
npm run export

# 2. Build Electron app
npm run build:electron

# Output: dist/Infrara-Setup-1.0.0.exe and dist/Infrara-1.0.0-portable.exe
```

### Build for Windows (from macOS/Linux)

```bash
cd frontend

# Install Wine (macOS)
brew install wine-stable

# Or on Ubuntu/Debian
# sudo dpkg --add-architecture i386
# sudo apt-get install wine32

# Build
npm run build
npm run export
npm run build:electron

# Output: dist/Infrara-Setup-1.0.0.exe
```

---

## Step-by-Step Instructions

### Step 1: Update package.json

Add these scripts to your `frontend/package.json`:

```json
{
  "scripts": {
    "export": "next export -o out",
    "build:electron": "next build && next export -o out && electron-builder",
    "build:mac": "next build && next export -o out && electron-builder --mac",
    "build:win": "next build && next export -o out && electron-builder --win",
    "build:linux": "next build && next export -o out && electron-builder --linux",
    "build:all": "next build && next export -o out && electron-builder -mwl"
  }
}
```

### Step 2: Configure Next.js for Static Export

Update `frontend/next.config.js`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',  // Enable static export
  images: {
    unoptimized: true,  // Required for static export
  },
  // Remove any server-side features for Electron
  // ...rest of your config
}

module.exports = nextConfig
```

### Step 3: Prepare Icons

Create icons for each platform in `frontend/build/`:

**Required Icons:**

1. **macOS** - `icon.icns` (1024x1024)
2. **Windows** - `icon.ico` (256x256 with multiple sizes)
3. **Linux** - `icon.png` (512x512 or 1024x1024)

**Tools to Create Icons:**

**For .icns (macOS):**
```bash
# Install iconutil (comes with Xcode)
# Create iconset folder with required sizes
mkdir icon.iconset
sips -z 16 16     logo.png --out icon.iconset/icon_16x16.png
sips -z 32 32     logo.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     logo.png --out icon.iconset/icon_32x32.png
sips -z 64 64     logo.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   logo.png --out icon.iconset/icon_128x128.png
sips -z 256 256   logo.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   logo.png --out icon.iconset/icon_256x256.png
sips -z 512 512   logo.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   logo.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 logo.png --out icon.iconset/icon_512x512@2x.png

# Convert to .icns
iconutil -c icns icon.iconset -o build/icon.icns
```

**For .ico (Windows):**
Use online converter or ImageMagick:
```bash
brew install imagemagick
convert logo.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
```

### Step 4: Create DMG Background (Optional for macOS)

Create a nice drag-to-Applications background image:
- Size: 540x380px
- Save as `build/dmg-background.png`
- Include visual guides showing "Drag app to Applications"

### Step 5: Create Windows Installer Graphics (Optional)

For professional Windows installer:
- **installerHeader.bmp** - 150x57px
- **installerSidebar.bmp** - 164x314px

### Step 6: Add License File

Create `frontend/LICENSE.txt` with your license terms (required for Windows NSIS installer).

### Step 7: Build!

```bash
cd frontend

# macOS DMG and ZIP
npm run build:mac

# Windows installer and portable
npm run build:win

# Linux AppImage, deb, rpm
npm run build:linux

# All platforms (if you have Wine for Windows on Mac/Linux)
npm run build:all
```

---

## Output Files

After building, you'll find installers in `frontend/dist/`:

### macOS
- `Infrara-1.0.0-mac.dmg` - Drag-and-drop installer (recommended)
- `Infrara-1.0.0-mac.zip` - Zip archive
- `Infrara-1.0.0-arm64-mac.dmg` - Apple Silicon (M1/M2/M3)
- `Infrara-1.0.0-x64-mac.dmg` - Intel Macs

### Windows
- `Infrara-Setup-1.0.0.exe` - Full installer (NSIS)
- `Infrara-1.0.0-portable.exe` - Portable version (no install)
- `Infrara-1.0.0-ia32.exe` - 32-bit version
- `Infrara-1.0.0-x64.exe` - 64-bit version

### Linux
- `Infrara-1.0.0.AppImage` - Universal Linux package
- `infrara_1.0.0_amd64.deb` - Debian/Ubuntu
- `infrara-1.0.0.x86_64.rpm` - Red Hat/Fedora/CentOS

---

## Code Signing (Production)

### macOS Code Signing

**Step 1: Get Developer ID Certificate**

1. Join Apple Developer Program ($99/year)
2. Create Developer ID Application certificate in Apple Developer portal
3. Download and install certificate on your Mac

**Step 2: Configure Signing**

Update `electron-builder.json`:

```json
{
  "mac": {
    "identity": "Developer ID Application: Your Company Name (TEAM_ID)",
    "notarize": {
      "teamId": "YOUR_TEAM_ID"
    }
  }
}
```

**Step 3: Set Environment Variables**

```bash
export APPLE_ID="your-apple-id@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YOUR_TEAM_ID"
```

**Step 4: Build with Signing**

```bash
npm run build:mac
```

The app will be automatically signed and notarized!

### Windows Code Signing

**Step 1: Get Code Signing Certificate**

Purchase from:
- DigiCert
- Sectigo (formerly Comodo)
- GlobalSign

**Step 2: Install Certificate**

Import `.pfx` file to Windows Certificate Store or keep as file.

**Step 3: Configure Signing**

Update `electron-builder.json`:

```json
{
  "win": {
    "certificateFile": "path/to/certificate.pfx",
    "certificatePassword": "YOUR_PASSWORD",
    "signingHashAlgorithms": ["sha256"],
    "sign": "./build/sign.js"
  }
}
```

Or use environment variables:
```bash
export CSC_LINK=path/to/certificate.pfx
export CSC_KEY_PASSWORD=your_password
```

**Step 4: Build with Signing**

```bash
npm run build:win
```

---

## Troubleshooting

### Error: "Cannot find module 'electron'"

```bash
cd frontend
npm install --save-dev electron electron-builder
```

### Error: "Next.js export failed"

Make sure your Next.js app doesn't use server-side features:
- No `getServerSideProps`
- No API routes (move to Electron IPC or external API)
- No Image optimization (use `unoptimized: true`)

### Error: "Icon file not found"

Create the required icon files:
```bash
mkdir -p frontend/build
# Add your icon files here
```

### macOS: "App is damaged and can't be opened"

This happens with unsigned apps. Either:
1. Sign the app (recommended)
2. Have users right-click → Open (once)
3. Have users run: `xattr -cr /Applications/Infrara.app`

### Windows: "Windows protected your PC"

This happens with unsigned apps. Either:
1. Sign the app (recommended)
2. Have users click "More info" → "Run anyway"

### Build is slow or large

Optimize:
```json
{
  "files": [
    "out/**/*",
    "electron/**/*",
    "!node_modules/**/*",
    "node_modules/package-needed-1/**/*",
    "node_modules/package-needed-2/**/*"
  ]
}
```

---

## Distribution

### Option 1: Direct Download (Simplest)

Host installers on your website:
```
https://infrara.com/downloads/Infrara-1.0.0-mac.dmg
https://infrara.com/downloads/Infrara-Setup-1.0.0.exe
```

### Option 2: Auto-Updates with electron-updater

Install:
```bash
npm install electron-updater
```

Add to `electron/main.js`:
```javascript
const { autoUpdater } = require('electron-updater');

app.whenReady().then(() => {
  autoUpdater.checkForUpdatesAndNotify();
});
```

Configure update server in `electron-builder.json`:
```json
{
  "publish": {
    "provider": "generic",
    "url": "https://infrara.com/downloads/"
  }
}
```

### Option 3: Mac App Store

Requires:
- Apple Developer Program
- Additional entitlements
- App Store review process

### Option 4: Microsoft Store

Requires:
- Microsoft Developer account ($19 one-time)
- Store review process

---

## GitHub Actions CI/CD (Optional)

Automate building with GitHub Actions:

Create `.github/workflows/build-desktop.yml`:

```yaml
name: Build Desktop Apps

on:
  push:
    tags:
      - 'v*'

jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: cd frontend && npm install
      - run: cd frontend && npm run build:mac
      - uses: actions/upload-artifact@v3
        with:
          name: mac-dmg
          path: frontend/dist/*.dmg

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: cd frontend && npm install
      - run: cd frontend && npm run build:win
      - uses: actions/upload-artifact@v3
        with:
          name: windows-installer
          path: frontend/dist/*.exe
```

---

## File Sizes

Typical installer sizes:
- **macOS DMG**: 150-250 MB (includes Electron + Chromium)
- **Windows Installer**: 130-200 MB
- **Linux AppImage**: 140-220 MB

Optimization tips:
1. Remove unnecessary node_modules
2. Use `asarUnpack` for large files
3. Enable compression in electron-builder
4. Split updates with differential updates

---

## Testing Installers

### macOS
```bash
# Install
open dist/Infrara-1.0.0-mac.dmg
# Drag to Applications, then launch

# Or test zip
unzip dist/Infrara-1.0.0-mac.zip
open Infrara.app
```

### Windows
```bash
# Install
dist/Infrara-Setup-1.0.0.exe

# Or portable
dist/Infrara-1.0.0-portable.exe
```

### Check File Size
```bash
ls -lh dist/
```

---

## Next Steps

1. ✅ Build unsigned versions for testing
2. ✅ Get code signing certificates
3. ✅ Set up auto-updates
4. ✅ Create download page on website
5. ✅ Set up analytics/crash reporting
6. ✅ Add update notifications in-app
7. ✅ Submit to app stores (optional)

---

## Resources

- [electron-builder docs](https://www.electron.build/)
- [Electron docs](https://www.electronjs.org/docs/latest/)
- [Apple notarization guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [Windows code signing guide](https://www.electron.build/code-signing#windows)

---

## Support

Need help? Contact support@infrara.com or open an issue on GitHub.

