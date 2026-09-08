@echo off
chcp 65001 >nul
title EduQuest AI - Stopping...

echo Stopping Frontend (port 3000)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1

echo Stopping Backend (port 8000)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1

echo Stopping PostgreSQL (Docker)...
docker compose stop

echo.
echo ============================================
echo  All stopped. Bye!
echo ============================================
pause
