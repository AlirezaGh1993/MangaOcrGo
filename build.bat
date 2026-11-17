@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Building mangaserver.exe ...
go build -o mangaserver.exe .
if %errorlevel% neq 0 (
    echo Build FAILED
    pause
    exit /b 1
)
echo Building manga-desktop.exe (WebView2) ...
go build -o manga-desktop.exe ./cmd/desktop
if %errorlevel% neq 0 (
    echo Desktop build FAILED - ensure WebView2 module is available
    echo Try: go get github.com/jchv/go-webview2
    pause
    exit /b 1
)
echo.
echo DONE:
echo   mangaserver.exe
echo   manga-desktop.exe
echo   run_desktop.bat
pause
