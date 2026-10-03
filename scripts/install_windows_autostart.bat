@echo off
setlocal
set SCRIPT_DIR=%~dp0
set REPO_DIR=%SCRIPT_DIR%..
cd /d "%REPO_DIR%"

set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set VBS_FILE=%STARTUP_DIR%\kunlun_bus_daemon.vbs

echo Set WshShell = CreateObject("WScript.Shell") > "%VBS_FILE%"
echo WshShell.CurrentDirectory = "%REPO_DIR%" >> "%VBS_FILE%"
echo WshShell.Run "pythonw scripts\kunlun_mqtt.py listen", 0, False >> "%VBS_FILE%"

echo [PASS] 昆仑三机总线已成功注册为 Windows 开机自启守护！
echo 注册脚本: %VBS_FILE%
echo 以后开机无需手动运行，静默常驻后台。
