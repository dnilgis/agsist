@echo off
rem AGSIST monthly backup. Double-click this file on the SSD.
rem It runs backup-agsist.ps1 from this same folder. Execution policy is
rem bypassed for this one run only; nothing on the PC is changed.
setlocal
cd /d "%~dp0"
title AGSIST backup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-agsist.ps1"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
