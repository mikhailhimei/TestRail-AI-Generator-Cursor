@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.12 or newer from https://nodejs.org/ and try again.
  pause
  exit /b 1
)
node "%~dp0install-cli.mjs"
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
