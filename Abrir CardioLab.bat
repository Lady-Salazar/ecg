@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo No encontre Node.js. Instala Node.js y vuelve a abrir este archivo.
  pause
  exit /b 1
)

start "CardioLab - servidor local" /D "%~dp0" node server.mjs
timeout /t 2 /nobreak >nul
start "" "http://localhost:8000"
endlocal
