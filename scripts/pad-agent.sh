#!/bin/sh
# Installs the phone pad relay as a macOS login agent: it starts at login, restarts if it stops, and the drive page
# always finds it. Run again (npm run pad:install) after moving the project or switching node versions - the agent
# keeps the node binary it was installed with. Remove: launchctl bootout gui/$(id -u)/test.sim-app.pad
set -e
LABEL=test.sim-app.pad
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$(command -v node)</string><string>$DIR/scripts/pad-relay.mjs</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/storage/logs/pad-relay.log</string>
  <key>StandardErrorPath</key><string>$DIR/storage/logs/pad-relay.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "pad relay running in the background - log: storage/logs/pad-relay.log"
