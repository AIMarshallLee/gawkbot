#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
PLIST="$HOME/Library/LaunchAgents/com.kunlun.bus.plist"
mkdir -p "$HOME/Library/LaunchAgents"

cat <<EOF > "$PLIST"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.kunlun.bus</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>$DIR/scripts/kunlun_mqtt.py</string>
        <string>listen</string>
        <string>--machine</string>
        <string>mac</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/kunlun_mqtt.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/kunlun_mqtt.err</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "[PASS] 昆仑三机总线已成功注册为 Mac 系统开机/登录常驻守护服务 (launchd)！"
echo "服务配置: $PLIST"
echo "日志文件: /tmp/kunlun_mqtt.log"
