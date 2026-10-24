@echo off
setlocal
cd /d "%~dp0agent_backend"
if not defined AGENT_PYTHON set AGENT_PYTHON=D:\notebook\AIGC\ml-engineer\backend\.venv\Scripts\python.exe
if not defined AGENT_PORT set AGENT_PORT=17820
if not defined AGENT_SETTINGS_PATH set "AGENT_SETTINGS_PATH=%~dp0agent_backend\data\agent_settings.json"
if not defined HARNESS_AUTH_MODE set HARNESS_AUTH_MODE=development
if not defined H3_BASE_URL set H3_BASE_URL=http://127.0.0.1:17821
echo [h3-agent] python: %AGENT_PYTHON%
echo [h3-agent] port:   %AGENT_PORT%
echo [h3-agent] config: %AGENT_SETTINGS_PATH%
"%AGENT_PYTHON%" -m uvicorn app.main:app --host 127.0.0.1 --port %AGENT_PORT%
