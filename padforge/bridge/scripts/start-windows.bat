@echo off
rem PadForge bridge for Windows. Double-click to run.
rem Needs: Node.js 18+ (https://nodejs.org) and ViGEmBus (https://github.com/nefarius/ViGEmBus/releases)
rem Pass "ds4" as the first argument for a DualShock 4 (gyro passthrough to Steam):  start-windows.bat ds4
cd /d "%~dp0\.."
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)
set OUT=x360
if /i "%1"=="ds4" set OUT=ds4
node src\index.js --output %OUT%
pause
