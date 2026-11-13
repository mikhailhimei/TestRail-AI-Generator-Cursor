@echo off
setlocal
cd /d "%~dp0"
set "CODEX_CHAT_CLI=%~dp0codex\codex-x86_64-pc-windows-msvc.exe"
if not exist "%CODEX_CHAT_CLI%" (
  echo Portable Codex CLI not found. Extract the entire server archive.
  pause
  exit /b 1
)
"%CODEX_CHAT_CLI%" mcp add testrail-extension -- node "%~dp0testrail-chat\server.mjs"
if errorlevel 1 (
  echo Chat connection setup failed. See the error above.
  pause
  exit /b 1
)
echo Chat tools registered. Restart the MCP connection or open a new chat.
echo Keep the local server running and the extension panel open.
pause
