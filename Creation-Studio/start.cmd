@echo off
setlocal
cd /d "%~dp0"
if "%H3_PORT%"=="" set H3_PORT=17821
ping -n 2 127.0.0.1 >nul
start "" "http://127.0.0.1:%H3_PORT%"
node src/server.js
if errorlevel 1 pause
