# Local Development & Testing Guide

## Quick Start (Testing Locally)

### Step 1: Start Backend
**Terminal 1:**
```bash
cd /Users/ejames/Desktop/backup1/backup
./start-backend.sh
```
Leave this running! Backend will be at: http://localhost:8000

### Step 2: Build & Run Desktop App
**Terminal 2:**
```bash
cd /Users/ejames/Desktop/backup1/backup/frontend

# Build for local testing (uses localhost:8000)
chmod +x build-dev.sh
./build-dev.sh

# Run the app
open dist/Driftbox-darwin-x64/Driftbox.app
```

---

## What's Different in Dev vs Prod?

### Development Build (Local Testing)
- **Backend:** `http://localhost:8000` (fast!)
- **Purpose:** Testing, debugging, development
- **Build:** `./build-dev.sh`
- **Pros:** Fast, can see backend logs, full control
- **Cons:** Requires backend running locally

### Production Build (Shipping to Users)
- **Backend:** `http://129.212.181.126:8000` (your droplet)
- **Purpose:** Distribution to end users
- **Build:** `./build-production.sh`
- **Pros:** Users don't need backend, just download & run
- **Cons:** Slower (network latency)

---

## Testing Workflow

### After Making Changes to Frontend:
```bash
cd frontend
./build-dev.sh
open dist/Driftbox-darwin-x64/Driftbox.app
```

### After Making Changes to Backend:
Just restart backend (app will auto-connect):
```bash
# In backend terminal: Ctrl+C
./start-backend.sh
```

### Testing OAuth:
1. Make sure GitHub OAuth has `driftbox://auth/callback` in redirect URIs
2. Backend must have GitHub OAuth credentials in `.env`
3. Test login flow in app

---

## Common Testing Scenarios

### Test Chat:
1. Login
2. Select a repository
3. Open chat panel
4. Send a message
5. Check response comes back

### Test Repository Loading:
1. Login with GitHub
2. Check repos list loads
3. Click a repo
4. Check file tree loads
5. Click a file, check it opens

### Test Drift Detection:
1. Select a Terraform/Pulumi repo
2. Go to Drift view
3. Click "Detect Drift"
4. Check results appear

### Check Performance:
- Should load in < 2 seconds with local backend
- Chat should respond in < 5 seconds
- No console errors

---

## Debugging

### Check Backend is Running:
```bash
curl http://localhost:8000/health
# Should return: {"status":"ok"}
```

### Check Frontend Console:
1. Open app
2. Open DevTools: Right-click → Inspect
3. Go to Console tab
4. Look for errors or warnings

### Backend Logs:
Backend terminal shows all API requests:
```
INFO:     127.0.0.1:50000 - "GET /auth/me HTTP/1.1" 200 OK
INFO:     127.0.0.1:50001 - "GET /auth/github/repos HTTP/1.1" 200 OK
```

### Common Issues:

**"Failed to load" errors:**
- Check backend is running: `curl http://localhost:8000/health`
- Check app is using localhost: Look for `[API] Desktop mode - using backend: http://localhost:8000` in console

**"No repos showing":**
- Check GitHub OAuth token is valid
- Check backend logs for errors
- Try logout/login again

**App won't open:**
- Try: `open dist/Driftbox-darwin-x64/Driftbox.app`
- Check for build errors: `./build-dev.sh`

---

## When Ready to Ship

1. Test everything thoroughly locally
2. Switch to production build: `./build-production.sh`
3. Test with production backend
4. Follow `RELEASE_CHECKLIST.md`
5. Create DMG: `./create-dmg.sh`
6. Distribute!

---

## File Structure

```
frontend/
├── build-dev.sh              # Build for local testing ⬅️ Use this now
├── build-production.sh       # Build for shipping to users
├── create-dmg.sh            # Create installer
├── dist/                    # Built app goes here
│   └── Driftbox-darwin-x64/
│       └── Driftbox.app       # Your app!
└── out/                    # Next.js static files
```

---

## Pro Tips

1. **Use build-dev.sh while developing** - Much faster!
2. **Keep backend terminal open** - See what API calls are happening
3. **Check DevTools console** - Lots of useful debug info
4. **Test OAuth early** - It's the most common issue
5. **Test on clean macOS install** - Catches environment issues

---

## Ready to Ship?
When testing looks good, see `RELEASE_CHECKLIST.md`

