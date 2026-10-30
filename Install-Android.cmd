@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\connect-android.ps1" -Install -Launch
if errorlevel 1 pause
