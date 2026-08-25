# Desktop App OAuth Setup

Your Driftbox desktop app is now configured to use custom URL schemes for GitHub OAuth!

## What Was Changed

1. **Electron Main Process** - Registered `driftbox://` protocol handler
2. **Frontend** - Detects desktop mode and uses custom OAuth flow
3. **OAuth Flow** - Opens browser for GitHub login, then redirects back to app

## GitHub OAuth App Settings

You need to add the desktop redirect URI to your GitHub OAuth app:

### Steps:

1. Go to https://github.com/settings/developers
2. Click on your OAuth App (or create a new one for desktop)
3. Add this to **Authorization callback URLs**:
   ```
   driftbox://auth/callback
   ```
4. Keep your existing web callback URL (for web version)
5. Save changes

### Your Callback URLs Should Include:
- `http://localhost:8000/auth/github/callback` (for backend/web)
- `driftbox://auth/callback` (for desktop app)

## Rebuild the App

After making the GitHub changes, rebuild your desktop app:

```bash
cd /Users/ejames/Desktop/backup1/backup/frontend
npm run build
rm -rf dist/Driftbox-darwin-x64
npx electron-packager . Driftbox --platform=darwin --arch=x64 --out=dist --overwrite --ignore="^/dist$" --app-bundle-id=com.driftbox.desktop
```

## How It Works

1. User clicks "Continue with GitHub" in the desktop app
2. App opens default browser with GitHub OAuth page
3. User authorizes on GitHub
4. GitHub redirects to `driftbox://auth/callback?code=...`
5. macOS opens your Driftbox app with the code
6. App exchanges code for token
7. User is logged in!

## Testing

1. Launch the rebuilt app
2. Click "Continue with GitHub"
3. Browser opens to GitHub
4. Authorize the app
5. You'll be redirected back to the desktop app automatically

That's it! 🎉

