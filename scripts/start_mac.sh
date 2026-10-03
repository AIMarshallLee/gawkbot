#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
pkill -f "kunlun_mqtt.py listen" 2>/dev/null
nohup python3 "$DIR/kunlun_mqtt.py" listen --machine mac > /tmp/kunlun_mqtt.log 2>&1 &
echo "[PASS] Mac 端昆仑总线监听已在后台启动！PID: $!"
echo "日志文件: /tmp/kunlun_mqtt.log"
