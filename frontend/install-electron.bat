@echo off
REM Script to install Electron dependencies for desktop development (Windows)
REM Run this locally by double-clicking or: install-electron.bat

echo Installing Electron dependencies for desktop development...
call npm install electron cross-env chokidar electron-builder --save-dev --no-optional

echo.
echo Electron dependencies installed!
echo Now you can run: npm run dev:electron
pause

