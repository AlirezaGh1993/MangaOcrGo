@echo off
chcp 65001 >nul
title Manga Server (Go)
cd /d "%~dp0"

echo ==================================================
echo   Manga Server Launcher - Go Edition
echo ==================================================
echo.

where go >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Go is not installed or not in PATH.
    echo Download: https://go.dev/dl/
    pause
    exit /b 1
)

echo [INFO] Working directory: %cd%
echo.

if exist "mangaserver.exe" (
    echo [INFO] Found mangaserver.exe - starting binary...
    start "MangaServer" /MIN mangaserver.exe
) else (
    echo [INFO] Building server binary...
    go build -o mangaserver.exe .
    if %errorlevel% neq 0 (
        echo [ERROR] Build failed.
        pause
        exit /b 1
    )
    echo [INFO] Starting mangaserver.exe...
    start "MangaServer" /MIN mangaserver.exe
)

echo [INFO] Waiting for http://127.0.0.1:6465 ...
set /a tries=0
:waitloop
set /a tries+=1
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:6465/api/config 2>nul | findstr /r "200" >nul
if %errorlevel% equ 0 goto ready
if %tries% geq 30 (
    echo [ERROR] Server did not respond in time.
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto waitloop

:ready
echo [OK] Server is online.
echo [INFO] Opening browser...
start "" "http://127.0.0.1:6465"

echo.
echo Server is running in a minimized window titled MangaServer.
echo Close that window or end the process to stop the server.
echo.
pause
