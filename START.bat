@echo off
chcp 65001 >nul
title EduQuest AI - Starting...

echo [1/3] Starting PostgreSQL (Docker)...
docker compose up -d
if errorlevel 1 (
    echo.
    echo ERROR: Docker not running! Please open Docker Desktop first.
    pause
    exit /b 1
)

echo [2/3] Starting Backend (port 8000)...
start "EduQuest Backend" cmd /k "cd /d %~dp0backend && venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000"

echo [3/3] Starting Frontend (port 3000)...
start "EduQuest Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 6 /nobreak >nul
start http://localhost:3000

echo.
echo ============================================
echo  EduQuest AI is running!
echo  Web   : http://localhost:3000
echo  API   : http://127.0.0.1:8000/docs
echo.
echo  Close = run STOP.bat or close the
echo  two windows that just opened.
echo ============================================
pause
