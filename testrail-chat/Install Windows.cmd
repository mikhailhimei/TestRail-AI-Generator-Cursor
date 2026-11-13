@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.12 or newer from https://nodejs.org/ and try again.
  pause
  exit /b 1
)
node "%~dp0install.mjs"
if errorlevel 1 (
  echo Plugin installation failed. See the error above.
  pause
  exit /b 1
)
echo Plugin installed. Restart the MCP connection or open a new chat.
echo The plugin starts its server automatically.
pause
