@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0prepare-windows.ps1"
if errorlevel 1 (
    pause
    exit /b 1
)
start "" "%~dp0clash-verge.exe"
