@echo off
taskkill /F /FI "WINDOWTITLE eq kunlun_bus_daemon*" 2>nul
start "kunlun_bus_daemon" /min python scripts\kunlun_mqtt.py listen --machine %1
echo [PASS] 昆仑三机平权协同总线已在后台启动！(本机: %1)
