#!/usr/bin/env bash
# StocMoon bot — server setup for Ubuntu 22.04/24.04 (Oracle Cloud Always Free, or any VPS).
# Run as the normal login user (e.g. "ubuntu"):
#   curl -fsSL https://raw.githubusercontent.com/Kennyvincss/Stocmoon/main/scripts/server/setup.sh | bash
# Safe to re-run: it updates the code and reinstalls dependencies.
set -euo pipefail
REPO="${REPO:-https://github.com/Kennyvincss/Stocmoon.git}"
DIR="${DIR:-$HOME/stocmoon}"

echo "==> Installing system packages"
sudo apt-get update -y -qq
sudo apt-get install -y -qq git curl ca-certificates nano

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE '^v(2[2-9])'; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
command -v pnpm >/dev/null 2>&1 || sudo npm install -g pnpm@10 --silent

echo "==> Getting the code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone --depth 1 "$REPO" "$DIR"; fi
cd "$DIR"
pnpm install --frozen-lockfile --filter 'services...'

if [ ! -f services/.env ]; then
  cp services/.env.server.example services/.env
  echo "==> Created services/.env from the template"
fi
chmod 600 services/.env

echo "==> Installing the stocmoon-bot service (starts on boot, restarts on failure)"
PNPM_BIN="$(command -v pnpm)"
sudo tee /etc/systemd/system/stocmoon-bot.service >/dev/null <<UNIT
[Unit]
Description=StocMoon bot (Chainlink price mirror, keeper, intraday operator)
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$DIR
ExecStart=$PNPM_BIN bot
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable stocmoon-bot >/dev/null

cat <<NEXT

Done. Next:
  1. nano $DIR/services/.env        # fill in OPERATOR_PRIVATE_KEY, ALPACA_API_KEY_ID, ALPACA_API_SECRET
  2. sudo systemctl restart stocmoon-bot
  3. journalctl -u stocmoon-bot -f   # live logs (Ctrl+C to stop watching; the bot keeps running)
NEXT
