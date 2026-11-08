@echo off
setlocal
cd /d "%~dp0"

if not exist "playerify.exe" (
  echo playerify.exe bulunamadi.
  echo Once "cargo build --release" calistir, sonra exe'yi bu klasore kopyala.
  pause
  exit /b 1
)

tasklist /FI "IMAGENAME eq playerify.exe" 2>nul | find /I "playerify.exe" >nul
if not errorlevel 1 (
  echo Playerify zaten calisiyor.
  exit /b 0
)

start "" "%~dp0playerify.exe"
exit /b 0
