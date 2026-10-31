@echo off
setlocal
cd /d "%~dp0"
if "%WMD_PORT%"=="" set WMD_PORT=17821
ping -n 2 127.0.0.1 >nul
start "" "http://127.0.0.1:%WMD_PORT%"
node src/server.js
if errorlevel 1 pause
