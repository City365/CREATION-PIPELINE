@echo off
chcp 65001 >nul
title WENYUN.M-DESKTOP
cd /d "%~dp0"
node scripts\launch.js --app %*
if errorlevel 1 pause
