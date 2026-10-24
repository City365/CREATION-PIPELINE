@echo off
chcp 65001 >nul
title H3 Studio
cd /d "%~dp0"
node scripts\launch.js --app %*
if errorlevel 1 pause
