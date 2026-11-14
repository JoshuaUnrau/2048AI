#!/usr/bin/env bash
# Installs the PadForge bridge on a Steam Deck (or any Linux PC) as a background
# service, so it is running in Game Mode too. Run from Desktop Mode in Konsole:
#   bash scripts/install-steamdeck.sh
# Re-run it any time to update. Everything goes in your home folder, so SteamOS
# updates don't remove it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSION="v22.11.0"
NODE_DIR="$HOME/.local/share/padforge/node"
NODE="$NODE_DIR/bin/node"

echo "== PadForge bridge installer"

# 1. Node.js (SteamOS doesn't ship it). Use the system one if it's new enough.
if command -v node >/dev/null && node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)'; then
  NODE="$(command -v node)"
  echo "Using system Node.js $(node -v)"
elif [ ! -x "$NODE" ]; then
  arch="$(uname -m)"; case "$arch" in x86_64) arch=x64;; aarch64) arch=arm64;; esac
  echo "Downloading Node.js $NODE_VERSION ($arch) to $NODE_DIR"
  mkdir -p "$NODE_DIR"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-$arch.tar.xz" | tar -xJ -C "$NODE_DIR" --strip-components=1
fi

# 2. Dependencies.
echo "Installing dependencies"
(cd "$HERE" && PATH="$(dirname "$NODE"):$PATH" npm install --omit=dev --no-audit --no-fund)

# 3. Permission to create virtual controllers. Steam's own udev rules usually
#    already allow this; if not, add the same rule Steam uses (needs your sudo password).
if [ -w /dev/uinput ]; then
  echo "/dev/uinput is writable: OK"
else
  echo "Allowing your user to create virtual controllers (sudo needed)"
  echo 'KERNEL=="uinput", SUBSYSTEM=="misc", TAG+="uaccess", OPTIONS+="static_node=uinput"' | sudo tee /etc/udev/rules.d/60-padforge-uinput.rules >/dev/null
  sudo udevadm control --reload-rules
  sudo udevadm trigger --name-match=uinput || true
  if [ ! -w /dev/uinput ]; then
    echo "!! Still no access to /dev/uinput. Log out and back in (or reboot), then run this again."
  fi
fi

# 4. Background service that starts at login, including Game Mode.
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/padforge.service" <<EOF
[Unit]
Description=PadForge phone controller bridge
After=graphical-session.target

[Service]
ExecStart=$NODE $HERE/src/index.js --output uinput
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now padforge.service
sleep 2
systemctl --user restart padforge.service
sleep 2

echo
echo "== Done. PadForge is running and will start automatically."
echo "Pairing code: $(cat "$HOME/.padforge/token" 2>/dev/null || echo '(see log)')"
for ip in $(hostname -I 2>/dev/null); do
  case "$ip" in *:*) continue;; esac
  echo "Open on your phone: https://$ip:8443/#k=$(cat "$HOME/.padforge/token" 2>/dev/null)"
done
echo "Log / QR code:  journalctl --user -u padforge -f"
echo "Stop:           systemctl --user stop padforge   (disable: systemctl --user disable --now padforge)"
