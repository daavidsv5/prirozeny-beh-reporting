@echo off
cd /d "C:\Users\daavi\Desktop\VIBECODING\Prirozeny-beh-reporting\shoptet-reporting"
echo [%date% %time%] Starting data update... >> scripts\updateData.log
node scripts\updateData.js
if %errorlevel% neq 0 (
  echo [%date% %time%] Update FAILED >> scripts\updateData.log
  exit /b 1
)
echo [%date% %time%] Update OK >> scripts\updateData.log
