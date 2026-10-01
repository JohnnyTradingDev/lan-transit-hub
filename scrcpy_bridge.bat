@echo off
chcp 65001 >nul
title Scrcpy Cable Bridge - Homeserver Content Feeder
echo =========================================================
echo   ⚡ KHOI DONG SCRCPY CABLE BRIDGE CHO LAPTOP WINDOWS
echo =========================================================
echo.

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [LOI] Khong tim thay Python tren may tinh cua ban!
    echo Vui long cai dat Python 3 tu https://www.python.org/
    pause
    exit /b
)

if not exist scrcpy_bridge.py (
    echo Dang tai file scrcpy_bridge.py tu Homeserver...
    curl -s -O http://100.75.112.62:7777/scrcpy_bridge.py
)

python scrcpy_bridge.py %*
pause
