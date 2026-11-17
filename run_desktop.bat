@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Manga Desktop

if not exist "manga-desktop.exe" (
    echo Building desktop app...
    go build -o mangaserver.exe .
    go get github.com/jchv/go-webview2
    go build -o manga-desktop.exe ./cmd/desktop
    if %errorlevel% neq 0 (
        echo Build failed. Install Go and WebView2 Runtime.
        pause
        exit /b 1
    )
)

echo Starting Manga Desktop WebView...
start "" "manga-desktop.exe"
