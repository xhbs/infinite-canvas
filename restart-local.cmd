@echo off
setlocal
powershell.exe -NoProfile -File "%~dp0restart-local.ps1"
set "exitCode=%errorlevel%"
if not "%exitCode%"=="0" pause
exit /b %exitCode%
