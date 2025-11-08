@echo off
REM PICKSYNC POTD FIX - WINDOWS SETUP

echo.
echo 🔧 PICKSYNC POTD MIGRATION ^& STARTUP
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.

REM Check if database exists
if not exist "picksync.db" (
    echo ❌ ERROR: picksync.db not found!
    echo    Make sure you're in the PicksyncBackend directory
    pause
    exit /b 1
)

echo 📊 Step 1: Backing up database...
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c%%a%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a%%b)
copy picksync.db picksync.db.backup-%mydate%-%mytime% >nul
echo ✅ Backup created
echo.

echo 📊 Step 2: Running migration...
node run-migration.js

if %errorlevel% equ 0 (
    echo.
    echo ✅ Migration completed!
    echo.
    echo 📊 Step 3: Starting server...
    echo.
    npm start
) else (
    echo.
    echo ❌ Migration failed!
    echo    Check the errors above
    pause
    exit /b 1
)
