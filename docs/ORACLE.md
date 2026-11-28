# Running the StocMoon bot on Oracle Cloud (Always Free)

One small always-on server runs everything: the Chainlink price mirror, the 24H/7D keeper and the 5m–1H intraday
operator (`pnpm bot`). Nothing needs to be opened to the internet — the bot only makes outgoing connections.

## 1. Create the account
1. Go to **cloud.oracle.com** → **Sign up** (Free Tier). A card is required for identity verification; Always Free
   resources are not charged.
2. Pick a **home region** close to you. It cannot be changed later.

## 2. Create the server
1. Console → **☰ → Compute → Instances → Create instance**.
2. **Image**: *Canonical Ubuntu 24.04*.
3. **Shape**: *Ampere → VM.Standard.A1.Flex*, 1 OCPU, 6 GB memory (marked "Always Free-eligible").
   If it says "out of capacity", use *VM.Standard.E2.1.Micro* (AMD, also Always Free) instead.
4. **Networking**: keep the defaults (it gets a public IP).
5. **SSH keys**: choose **Generate a key pair for me** → **Save private key** (a file like `ssh-key-2026-11-28.key`).
6. **Create**. When the state is *Running*, copy the **Public IP address**.

## 3. Connect (from Git Bash on your PC)
```bash
mkdir -p ~/.ssh && mv ~/Downloads/ssh-key-*.key ~/.ssh/oracle.key && chmod 600 ~/.ssh/oracle.key
ssh -i ~/.ssh/oracle.key ubuntu@YOUR_PUBLIC_IP
```
Type `yes` the first time. Your prompt changes to `ubuntu@...`.

## 4. Install the bot (on the server)
```bash
curl -fsSL https://raw.githubusercontent.com/Kennyvincss/Stocmoon/main/scripts/server/setup.sh | bash
```

## 5. Add your keys
```bash
nano ~/stocmoon/services/.env
```
Fill in `OPERATOR_PRIVATE_KEY` (operator wallet), `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET`.
Save with **Ctrl+O**, **Enter**, then exit with **Ctrl+X**.

## 6. Start it and watch the logs
```bash
sudo systemctl restart stocmoon-bot
journalctl -u stocmoon-bot -f
```
You should see `"bot","msg":"running"` with relayer, keeper and intraday. **Ctrl+C** only stops watching — the bot
keeps running, restarts itself if it crashes, and starts automatically when the server reboots.
You can now close the SSH window and turn your PC off.

## Everyday commands (on the server)
| What | Command |
| --- | --- |
| Live logs | `journalctl -u stocmoon-bot -f` |
| Status | `systemctl status stocmoon-bot` |
| Restart | `sudo systemctl restart stocmoon-bot` |
| Update to the latest code | `bash ~/stocmoon/scripts/server/setup.sh && sudo systemctl restart stocmoon-bot` |

## Keep the server from being reclaimed
Oracle may reclaim *idle* Always Free servers (very low CPU/network/memory use over 7 days), and this bot is light.
To avoid that, upgrade the account to **Pay As You Go** (☰ → Billing → Upgrade). Always Free resources stay free;
you are only charged if you create paid resources. Optionally set a budget alert of $1 under Billing → Budgets.

## Only one bot at a time
Stop any copy running on your PC (`Ctrl+C`) — two bots with the same wallet would send duplicate transactions.
