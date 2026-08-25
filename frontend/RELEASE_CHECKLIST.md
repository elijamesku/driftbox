# Driftbox Desktop - Release Checklist

## Pre-Release Checklist

### 1. Update Version Numbers
- [ ] Update version in `build-production.sh`
- [ ] Update version in `create-dmg.sh`
- [ ] Update version in `package.json`

### 2. Backend Verification
- [ ] Backend is running at: http://129.212.181.126:8000
- [ ] Test backend is accessible: `curl http://129.212.181.126:8000/health`
- [ ] Database is connected and working
- [ ] API keys are configured (OpenAI, Anthropic, GitHub OAuth)

### 3. Build Production App
```bash
cd /Users/ejames/Desktop/backup1/backup/frontend
chmod +x build-production.sh
./build-production.sh
```

### 4. Test the App
- [ ] Open the app: `open dist/Driftbox-darwin-x64/Driftbox.app`
- [ ] Test login with GitHub OAuth
- [ ] Load a repository
- [ ] Test chat functionality
- [ ] Test drift detection
- [ ] Test diagram generation
- [ ] Check all views load properly

### 5. Create Installer (Optional but Recommended)
```bash
chmod +x create-dmg.sh
./create-dmg.sh
```

### 6. Code Signing (Optional but Recommended)
**Without code signing:**
- Users will see "App from unidentified developer" warning
- They need to: Right-click > Open (first time only)

**With code signing:**
```bash
# You need Apple Developer account ($99/year)
codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: YOUR NAME" \
  dist/Driftbox-darwin-x64/Driftbox.app
```

### 7. Notarization (Optional - for no warnings)
**Requires Apple Developer account**
```bash
# Create DMG first
./create-dmg.sh

# Submit for notarization
xcrun notarytool submit Driftbox-1.0.0-macOS.dmg \
  --apple-id YOUR_APPLE_ID \
  --password YOUR_APP_PASSWORD \
  --team-id YOUR_TEAM_ID \
  --wait

# Staple the notarization
xcrun stapler staple Driftbox-1.0.0-macOS.dmg
```

## Distribution Options

### Option A: Direct Download (Simplest)
1. Upload DMG to your website/GitHub releases
2. Users download and install
3. First launch: Right-click > Open (if not code signed)

### Option B: GitHub Releases
1. Create release on GitHub
2. Upload DMG as release asset
3. Users download from releases page

### Option C: Website Download
1. Host DMG on your server/CDN
2. Create download page with instructions
3. Add analytics to track downloads

## User Instructions to Include

### Installation Instructions:
1. Download Driftbox-X.X.X-macOS.dmg
2. Open the DMG file
3. Drag Driftbox to Applications folder
4. Open Applications, right-click Driftbox, click "Open"
5. Click "Open" in the security dialog
6. Log in with GitHub

### System Requirements:
- macOS 10.13 or later
- 4GB RAM minimum
- Internet connection required
- GitHub account

## Post-Release

- [ ] Monitor backend logs for errors
- [ ] Check backend API rate limits
- [ ] Monitor server resources (CPU, memory)
- [ ] Collect user feedback
- [ ] Plan next release

## Support Resources

### Backend URL
Production: http://129.212.181.126:8000

### Common Issues
1. "App is damaged" - User needs to right-click > Open
2. Slow loading - Check backend is accessible
3. Login fails - Verify GitHub OAuth is configured
4. No repos showing - Check GitHub token permissions

### Monitoring
- Backend logs: `ssh root@129.212.181.126 'journalctl -u backend -f'`
- Check uptime: `curl http://129.212.181.126:8000/health`

