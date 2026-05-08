@echo off
setlocal
cd /d "%~dp0"
rem Windows file drag-and-drop works best when Electron is launched from a normal Explorer/PowerShell context.
rem Avoid starting the dev app from elevated, sandboxed, or packaged-host terminals if native file drops show a "not allowed" cursor.
start "Agent Window Demo" /min cmd /c "npm run dev"
