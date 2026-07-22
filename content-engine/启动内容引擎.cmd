@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\.bin\electron.cmd" (
  echo Installing project dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

call npm run dev
