@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo Building Driftbox Desktop App...

:: Clean previous builds
echo Cleaning previous builds...
if exist ".next" rmdir /s /q .next 2>nul
if exist "out" rmdir /s /q out 2>nul
if exist "dist" rmdir /s /q dist 2>nul

:: Clean up any leftover backups from previous failed builds
if exist "..\api.backup.temp" (
    echo Cleaning up leftover API backup...
    rmdir /s /q "..\api.backup.temp" 2>nul
)
if exist "..\teams.backup.temp" (
    echo Cleaning up leftover teams backup...
    rmdir /s /q "..\teams.backup.temp" 2>nul
)
if exist "..\teamId-page.backup.temp" (
    echo Cleaning up leftover teamId page backup...
    del "..\teamId-page.backup.temp" 2>nul
)
if exist "..\invite-page.backup.temp" (
    echo Cleaning up leftover invite page backup...
    del "..\invite-page.backup.temp" 2>nul
)

:: Save API routes (not needed for desktop - Electron talks directly to backend)
:: Move OUTSIDE the project so Next.js doesn't find them
if not exist "app\api" goto :move_teams
echo Temporarily moving API routes (not needed for desktop)...

:: Use xcopy + rmdir instead of move (more reliable on Windows)
xcopy "app\api" "..\api.backup.temp\" /E /I /H /Y /Q >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    echo WARNING: Failed to backup API routes, trying alternative method...
    :: Try robocopy as fallback
    robocopy "app\api" "..\api.backup.temp" /E /NFL /NDL /NJH /NJS /nc /ns /np >nul 2>&1
)
:: Now remove the original
rmdir /s /q "app\api" 2>nul
if exist "app\api" (
    echo ERROR: Could not remove API routes directory. Please close any programs using these files.
    echo Trying to force remove...
    timeout /t 2 /nobreak >nul
    rmdir /s /q "app\api" 2>nul
)
if exist "app\api" (
    echo FATAL: Still cannot remove API routes. Build cannot continue.
    goto :restore_and_fail
)
echo API routes moved successfully.

:move_teams
:: Only remove the page.tsx files from dynamic routes - keep the client components
:: This prevents Next.js from trying to generate static pages for dynamic routes
:: while still allowing the client components to be imported

:: Move [teamId]/page.tsx only
if exist "app\teams\[teamId]\page.tsx" (
    echo Moving dynamic team detail page.tsx...
    copy "app\teams\[teamId]\page.tsx" "..\teamId-page.backup.temp" >nul 2>&1
    del "app\teams\[teamId]\page.tsx" 2>nul
)

:: Move invite/[token]/page.tsx only
if exist "app\teams\invite\[token]\page.tsx" (
    echo Moving dynamic invite page.tsx...
    copy "app\teams\invite\[token]\page.tsx" "..\invite-page.backup.temp" >nul 2>&1
    del "app\teams\invite\[token]\page.tsx" 2>nul
)
echo Dynamic route pages moved successfully.

:build
:: Build with Electron mode
echo Building Next.js static export...
set ELECTRON_BUILD=true
:: Set API URL for Electron build (defaults to production backend)
if not defined NEXT_PUBLIC_API_URL set NEXT_PUBLIC_API_URL=http://129.212.181.126
call next build
set BUILD_ERROR=!ERRORLEVEL!

:: Restore API routes
if not exist "..\api.backup.temp" goto :restore_teams
echo Restoring API routes...
xcopy "..\api.backup.temp" "app\api\" /E /I /H /Y /Q >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    robocopy "..\api.backup.temp" "app\api" /E /NFL /NDL /NJH /NJS /nc /ns /np >nul 2>&1
)
rmdir /s /q "..\api.backup.temp" 2>nul
echo API routes restored.

:restore_teams
:: Restore dynamic route page.tsx files
if exist "..\teamId-page.backup.temp" (
    echo Restoring team detail page.tsx...
    copy "..\teamId-page.backup.temp" "app\teams\[teamId]\page.tsx" >nul 2>&1
    del "..\teamId-page.backup.temp" 2>nul
)
if exist "..\invite-page.backup.temp" (
    echo Restoring invite page.tsx...
    copy "..\invite-page.backup.temp" "app\teams\invite\[token]\page.tsx" >nul 2>&1
    del "..\invite-page.backup.temp" 2>nul
)
echo Team route pages restored.

:check_build
if !BUILD_ERROR! NEQ 0 goto :build_failed

:: Clean up platform-specific references that cause electron-builder to fail
:: The .package-lock.json contains references to darwin/linux packages that don't exist on Windows
echo Cleaning up platform-specific dependencies...
if exist "node_modules\.package-lock.json" del /f /q "node_modules\.package-lock.json" 2>nul
if exist "node_modules\@next\swc-darwin-arm64" rmdir /s /q "node_modules\@next\swc-darwin-arm64" 2>nul
if exist "node_modules\@next\swc-darwin-x64" rmdir /s /q "node_modules\@next\swc-darwin-x64" 2>nul
if exist "node_modules\@next\swc-linux-arm64-gnu" rmdir /s /q "node_modules\@next\swc-linux-arm64-gnu" 2>nul
if exist "node_modules\@next\swc-linux-arm64-musl" rmdir /s /q "node_modules\@next\swc-linux-arm64-musl" 2>nul
if exist "node_modules\@next\swc-linux-x64-gnu" rmdir /s /q "node_modules\@next\swc-linux-x64-gnu" 2>nul
if exist "node_modules\@next\swc-linux-x64-musl" rmdir /s /q "node_modules\@next\swc-linux-x64-musl" 2>nul
if exist "node_modules\fsevents" rmdir /s /q "node_modules\fsevents" 2>nul

:: Build Electron app
echo Building Electron app...
call electron-builder --win
if !ERRORLEVEL! NEQ 0 goto :electron_failed

echo Build complete!
goto :end

:build_failed
echo Next.js build failed!
pause
exit /b 1

:restore_and_fail
:: Restore backups before failing
if exist "..\api.backup.temp" (
    xcopy "..\api.backup.temp" "app\api\" /E /I /H /Y /Q >nul 2>&1
    rmdir /s /q "..\api.backup.temp" 2>nul
)
:: Teams pages are no longer moved during build
echo Build preparation failed!
pause
exit /b 1

:electron_failed
echo Electron build failed!
pause
exit /b 1

:end
