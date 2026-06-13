@echo off
echo Killing AgentDesk processes...
taskkill /f /im "AgentDesk.exe" >nul 2>&1
taskkill /f /im "DeepSeek Agent Window.exe" >nul 2>&1
echo Waiting for processes to terminate...
timeout /t 2 /nobreak >nul
echo Starting AgentDesk...
start "" "C:\code\AgentDesk\release\DeepSeek Agent Window-0.1.0-Portable-x64.exe"
echo Done.
pause
