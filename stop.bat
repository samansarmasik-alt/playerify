@echo off
setlocal
taskkill /IM playerify.exe /F >nul 2>&1
if errorlevel 1 (
  echo Playerify calismiyor.
) else (
  echo Playerify kapatildi.
)
exit /b 0
