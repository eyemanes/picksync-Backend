@echo off
echo 🚀 PickSync - First Scan Setup
echo ================================
echo.

REM Backend URL
set BACKEND_URL=https://picksync-backend.vercel.app

REM Login credentials
set USERNAME=admin
set PASSWORD=PicksyncAdmin2024!

echo 1️⃣  Logging in...
curl -X POST "%BACKEND_URL%/api/login" -H "Content-Type: application/json" -d "{\"username\":\"%USERNAME%\",\"password\":\"%PASSWORD%\"}" > login.json
type login.json
echo.

echo.
echo 2️⃣  Copy the token from above and run:
echo    curl -X POST %BACKEND_URL%/api/scan -H "Authorization: Bearer YOUR_TOKEN"
echo.
echo 3️⃣  Monitor scan status at:
echo    %BACKEND_URL%/api/scan/status
echo.

pause
