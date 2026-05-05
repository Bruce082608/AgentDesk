@echo off
setlocal
cd /d "%~dp0"
start "Agent Window Demo" /min cmd /c "npm run dev"
