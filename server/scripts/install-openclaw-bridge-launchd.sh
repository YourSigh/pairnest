#!/usr/bin/env bash

set -euo pipefail

LABEL="top.yoursigh.pairnest.openclaw-bridge"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="$(command -v node)"
OPENCLAW_BIN="$(command -v openclaw)"
CONFIG_DIR="$HOME/.config/pairnest"
ENV_FILE="$CONFIG_DIR/openclaw-bridge.env"
LOG_DIR="$HOME/Library/Logs/pairnest"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BRIDGE_URL="${PAIRNEST_OPENCLAW_BRIDGE_URL:-}"
BRIDGE_TOKEN="${PAIRNEST_OPENCLAW_BRIDGE_TOKEN:-}"

if [[ -z "$BRIDGE_URL" ]]; then
  read -r -p "请输入 PairNest WebSocket 地址（例如 wss://pairnest.example.com/ws）: " BRIDGE_URL
fi
if [[ -z "$BRIDGE_URL" ]]; then
  echo "WebSocket 地址不能为空" >&2
  exit 1
fi
if [[ -z "$BRIDGE_TOKEN" ]]; then
  read -r -s -p "请输入服务器 PAIRNEST_OPENCLAW_BRIDGE_TOKEN: " BRIDGE_TOKEN
  printf '\n'
fi
if [[ -z "$BRIDGE_TOKEN" ]]; then
  echo "Token 不能为空" >&2
  exit 1
fi

mkdir -p "$CONFIG_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"
umask 077
{
  printf 'PAIRNEST_OPENCLAW_BRIDGE_TOKEN=%q\n' "$BRIDGE_TOKEN"
  printf 'PAIRNEST_OPENCLAW_BRIDGE_URL=%q\n' "$BRIDGE_URL"
  printf 'PAIRNEST_OPENCLAW_BIN=%q\n' "$OPENCLAW_BIN"
  printf 'PATH=%q\n' "$PATH"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>set -a; source &quot;$ENV_FILE&quot;; set +a; exec &quot;$NODE_BIN&quot; &quot;$SCRIPT_DIR/openclaw-bridge.mjs&quot;</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/openclaw-bridge.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/openclaw-bridge.error.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$UID" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl kickstart -k "gui/$UID/$LABEL"

echo "OpenClaw 连接器已安装并启动"
echo "状态：launchctl print gui/$UID/$LABEL"
echo "日志：$LOG_DIR/openclaw-bridge.log"
