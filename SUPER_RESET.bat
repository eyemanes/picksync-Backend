@echo off
cls
color 0A
echo.
echo  ========================================
echo          PICKSYNC SUPER RESET
echo  ========================================
echo.
echo  This will COMPLETELY RESET everything:
echo.
echo  [X] Stop the server
echo  [X] Delete database (picksync.db)
echo  [X] Delete node_modules
echo  [X] Delete package-lock.json
echo  [X] Reinstall all dependencies
echo.
echo  [SAFE] Keep your .env file
echo  [SAFE] Keep all source code
echo.
echo  ========================================
echo.
set /p CONFIRM="Type YES to continue: "
if /i not "%CONFIRM%"=="YES" (
    color 0C
    echo.
    echo Reset cancelled.
    echo.
    pause
    exit /b
)

echo.
echo  Starting super reset...
echo.

REM Step 1: Kill node processes
echo  [1/6] Stopping all Node processes...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo  Done!
echo.

REM Step 2: Delete database
echo  [2/6] Deleting database...
if exist picksync.db (
    del /f /q picksync.db
    echo  Database deleted!
) else (
    echo  No database found (already clean)
)
if exist picksync.db-shm del /f /q picksync.db-shm >nul 2>&1
if exist picksync.db-wal del /f /q picksync.db-wal >nul 2>&1
echo.

REM Step 3: Delete node_modules
echo  [3/6] Deleting node_modules...
if exist node_modules (
    rmdir /s /q node_modules
    echo  node_modules deleted!
) else (
    echo  node_modules not found (already clean)
)
echo.

REM Step 4: Delete package-lock
echo  [4/6] Deleting package-lock.json...
if exist package-lock.json (
    del /f /q package-lock.json
    echo  package-lock.json deleted!
) else (
    echo  package-lock.json not found
)
echo.

REM Step 5: Install dependencies
echo  [5/6] Installing dependencies...
echo  This may take a minute...
echo.
call npm install
echo.

REM Step 6: Verify .env exists
echo  [6/6] Checking .env file...
if exist .env (
    color 0A
    echo  .env file found - your config is safe!
) else (
    color 0E
    echo  WARNING: .env file not found!
    echo  You need to create it before running the server.
)
echo.

REM Done
color 0A
echo  ========================================
echo          RESET COMPLETE!
echo  ========================================
echo.
echo  What was reset:
echo   [X] Database (picksync.db)
echo   [X] node_modules
echo   [X] package-lock.json
echo   [X] Fresh npm install
echo.
echo  What was kept:
echo   [OK] .env file (your API keys)
echo   [OK] All source code
echo.
echo  Ready to start fresh!
echo  Run: npm run dev
echo.
echo  ========================================
echo.
pause
