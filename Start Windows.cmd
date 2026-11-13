@echo off
chcp 65001 >nul
setlocal
title TestRail - Codex
cd /d "%~dp0"
echo [1/4] Проверка Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.12 or newer from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)"
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Update Node.js and try again.
  pause
  exit /b 1
)
node --version
echo [1/4] Node.js готов.
echo.
echo [2/4] Проверка встроенного Codex CLI...
set "CODEX_BIN=%~dp0codex\codex-x86_64-pc-windows-msvc.exe"
if not exist "%CODEX_BIN%" (
  echo Не найден встроенный Codex. Распакуйте весь архив, сохранив папку codex.
  pause
  exit /b 1
)
"%CODEX_BIN%" --version
if errorlevel 1 (
  echo Не удалось запустить Codex CLI. Проверьте ошибку выше.
  pause
  exit /b 1
)
echo [2/4] Codex CLI готов.
echo.
echo [3/4] Проверка входа в Codex...
"%CODEX_BIN%" login status >nul 2>nul
if errorlevel 1 (
  echo Войдите в Codex через браузер. Ожидание завершения входа...
  "%CODEX_BIN%" login
  if errorlevel 1 (
    echo Codex sign-in failed. Run this file again to retry.
    pause
    exit /b 1
  )
)
echo [3/4] Вход выполнен.
echo.
echo [4/4] Запуск локального сервера...
echo После сообщения Codex bridge нажмите «Подключить Codex» в расширении.
echo Оставьте это окно открытым. Для остановки нажмите Ctrl+C.
node "%~dp0codex-bridge.mjs"
pause
