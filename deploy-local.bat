@echo off
REM ===================================================================
REM  Eater map - run the site locally. Double-click this file.
REM  Builds the app, serves it, and opens it in your browser.
REM ===================================================================
cd /d "%~dp0"
title Eater map (local)

echo.
echo   Eater map - building and serving locally...
echo.

where pnpm >nul 2>nul
if errorlevel 1 (
  echo   ERROR: pnpm is not installed or not on your PATH.
  echo   Install Node.js + pnpm, then run this again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo   Installing dependencies (first run only)...
  call pnpm install || (echo   Install failed. & pause & exit /b 1)
)

call pnpm build || (echo   Build failed - see the messages above. & pause & exit /b 1)

echo.
echo   Serving at http://127.0.0.1:4173  (close this window to stop)
echo.
REM open the browser a moment after the preview server starts
start "" cmd /c "timeout /t 3 /nobreak >nul & start "" http://127.0.0.1:4173"
call pnpm preview --host 127.0.0.1
