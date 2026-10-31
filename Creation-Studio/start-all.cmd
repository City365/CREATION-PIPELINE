@echo off
chcp 65001 >nul
title WENYUN.M-DESKTOP
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js，请先安装 Node 22 或更高版本。
  pause
  exit /b 1
)
node scripts\launch.js %*
if errorlevel 1 pause
