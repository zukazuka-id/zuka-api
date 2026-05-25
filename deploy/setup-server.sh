#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# setup-server.sh — One-time Lightsail instance provisioning
# Run as root: sudo bash deploy/setup-server.sh
#
# Prerequisites:
#   - Fresh Ubuntu 24.04 LTS Lightsail instance
#   - Your SSH public key ready (pass via DEPLOY_SSH_KEY env var or paste)
#   - DNS records pointing api.zuka.plus and staging-api.zuka.plus to this IP
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────
DEPLOY_USER="deploy"
SSH_PORT=2222
NODE_VERSION=22
# IMPORTANT: Set this to your actual repo URL before running.
# For SSH:    git@github.com:zukazuka-id/zuka.git
# For HTTPS:  https://github.com/zukazuka-id/zuka.git
# Can also be passed via env: REPO_URL=... bash deploy/setup-server.sh
REPO_URL="${REPO_URL:-}"
DOMAIN="zuka.plus"

echo "=== Zuka API — Server Setup (Ubuntu 24.04) ==="
echo "Domain: $DOMAIN"
echo "Deploy user: $DEPLOY_USER"
echo "SSH port: $SSH_PORT"
echo ""

# ── 1. System Update ────────────────────────────────────────────
echo "[1/10] Updating system packages..."
apt update && apt upgrade -y
apt install -y curl wget git unzip software-properties-common apt-transport-https ca-certificates gnupg

# ── 2. Create Deploy User ───────────────────────────────────────
echo "[2/10] Creating deploy user..."
if ! id "$DEPLOY_USER" &>/dev/null; then
    adduser --disabled-password --gecos "Deploy User" "$DEPLOY_USER"
    usermod -aG sudo "$DEPLOY_USER"
    usermod -aG www-data "$DEPLOY_USER"
    echo "  User '$DEPLOY_USER' created."
else
    echo "  User '$DEPLOY_USER' already exists."
fi

# Set up SSH key for deploy user
DEPLOY_HOME="/home/$DEPLOY_USER"
DEPLOY_SSH_DIR="$DEPLOY_HOME/.ssh"
mkdir -p "$DEPLOY_SSH_DIR"

if [ -n "${DEPLOY_SSH_KEY:-}" ]; then
    echo "$DEPLOY_SSH_KEY" > "$DEPLOY_SSH_DIR/authorized_keys"
else
    echo "  Paste the SSH PUBLIC key for the deploy user:"
    read -r ssh_key
    echo "$ssh_key" > "$DEPLOY_SSH_DIR/authorized_keys"
fi

chmod 700 "$DEPLOY_SSH_DIR"
chmod 600 "$DEPLOY_SSH_DIR/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_SSH_DIR"
echo "  SSH key configured for $DEPLOY_USER."

# ── 3. Install Node.js ──────────────────────────────────────────
echo "[3/10] Installing Node.js $NODE_VERSION..."
curl -fsSL https://deb.nodesource.com/setup_$NODE_VERSION.x | bash -
apt install -y nodejs
echo "  Node.js $(node -v) installed."

# ── 4. Install pnpm ─────────────────────────────────────────────
echo "[4/10] Installing pnpm..."
npm install -g pnpm
echo "  pnpm $(pnpm -v) installed."

# ── 5. Install PM2 ──────────────────────────────────────────────
echo "[5/10] Installing PM2..."
npm install -g pm2
echo "  PM2 installed."

# ── 6. Install Nginx ────────────────────────────────────────────
echo "[6/10] Installing and configuring Nginx..."
apt install -y nginx

# Copy nginx configs
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NGINX_DEPLOY_DIR="$SCRIPT_DIR/nginx"

cp "$NGINX_DEPLOY_DIR/nginx.conf" /etc/nginx/nginx.conf
cp "$NGINX_DEPLOY_DIR/security-headers.conf" /etc/nginx/snippets/security-headers.conf
cp "$NGINX_DEPLOY_DIR/ssl-params.conf" /etc/nginx/snippets/ssl-params.conf
cp "$NGINX_DEPLOY_DIR/api.zuka.plus.conf" /etc/nginx/sites-available/api.zuka.plus.conf
cp "$NGINX_DEPLOY_DIR/staging-api.zuka.plus.conf" /etc/nginx/sites-available/staging-api.zuka.plus.conf

# Enable sites
ln -sf /etc/nginx/sites-available/api.zuka.plus.conf /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/staging-api.zuka.plus.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test config (will fail without SSL certs — that's expected)
nginx -t 2>/dev/null || echo "  Note: nginx config test will pass after SSL certs are obtained."
systemctl enable nginx
systemctl restart nginx || true
echo "  Nginx configured."

# ── 7. Install Certbot ──────────────────────────────────────────
echo "[7/10] Installing Certbot for Let's Encrypt..."
apt install -y certbot python3-certbot-nginx

# Create certbot renewal hook
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh << 'HOOK'
#!/bin/bash
systemctl reload nginx
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
echo "  Certbot installed. Run after DNS is configured:"
echo "    sudo certbot certonly --nginx -d api.$DOMAIN -d staging-api.$DOMAIN"

# ── 8. Configure UFW Firewall ───────────────────────────────────
echo "[8/10] Configuring UFW firewall..."
apt install -y ufw

ufw default deny incoming
ufw default allow outgoing
ufw limit "$SSH_PORT/tcp" comment "SSH (rate-limited)"
ufw allow 80/tcp comment "HTTP"
ufw allow 443/tcp comment "HTTPS"

# Enable without prompt
echo "y" | ufw enable
ufw status verbose
echo "  Firewall configured. Only ports $SSH_PORT, 80, 443 are open."

# ── 9. Install and Configure fail2ban ───────────────────────────
echo "[9/10] Configuring fail2ban..."
apt install -y fail2ban

F2B_DIR="$SCRIPT_DIR/fail2ban"
cp "$F2B_DIR/jail.local" /etc/fail2ban/jail.local
cp "$F2B_DIR/nginx-401.conf" /etc/fail2ban/filter.d/nginx-401.conf
cp "$F2B_DIR/bots.conf" /etc/fail2ban/filter.d/bots.conf

systemctl enable fail2ban
systemctl restart fail2ban
echo "  fail2ban configured with SSH and nginx jails."

# ── 10. System Hardening ────────────────────────────────────────
echo "[10/10] Running system hardening..."
bash "$SCRIPT_DIR/harden.sh"

# ── Enable Unattended Security Upgrades ─────────────────────────
echo "Enabling unattended security upgrades..."
apt install -y unattended-upgrades apt-listchanges
dpkg-reconfigure -plow unattended-upgrades << EOF
yes
EOF

cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESMInfrastructure:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::SyslogEnable "true";
EOF

cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
EOF

# ── Clone and Initial Build ─────────────────────────────────────
echo ""
echo "=== Setting up application directories ==="

if [ -n "$REPO_URL" ]; then
    sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$DEPLOY_HOME/zuka-api"
    sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$DEPLOY_HOME/zuka-api-staging"

    # Build production
    cd "$DEPLOY_HOME/zuka-api"
    sudo -u "$DEPLOY_USER" pnpm install --frozen-lockfile
    sudo -u "$DEPLOY_USER" pnpm build

    # Build staging
    cd "$DEPLOY_HOME/zuka-api-staging"
    sudo -u "$DEPLOY_USER" pnpm install --frozen-lockfile
    sudo -u "$DEPLOY_USER" pnpm build

    # Copy ecosystem config
    cp "$DEPLOY_HOME/zuka-api/ecosystem.config.cjs" "$DEPLOY_HOME/ecosystem.config.cjs"
    chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/ecosystem.config.cjs"
fi

# ── Setup PM2 as deploy user ────────────────────────────────────
echo "Setting up PM2 startup..."
sudo -u "$DEPLOY_USER" bash -c 'pm2 startup systemd -u deploy --hp /home/deploy' 2>/dev/null | bash

# ── Setup PM2 log rotation ──────────────────────────────────────
sudo -u "$DEPLOY_USER" pm2 install pm2-logrotate
sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:max_size 50M
sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:retain 14
sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:compress true
sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss

# ── Create necessary directories ────────────────────────────────
mkdir -p "$DEPLOY_HOME/logs"
mkdir -p "$DEPLOY_HOME/backups"
mkdir -p "$DEPLOY_HOME/scripts"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/logs" "$DEPLOY_HOME/backups" "$DEPLOY_HOME/scripts"

# Copy monitoring scripts
MONITOR_DIR="$SCRIPT_DIR/monitor"
if [ -f "$MONITOR_DIR/health-check.sh" ]; then
    cp "$MONITOR_DIR/health-check.sh" "$DEPLOY_HOME/scripts/health-check.sh"
    chmod +x "$DEPLOY_HOME/scripts/health-check.sh"
    chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/scripts/health-check.sh"
fi

if [ -f "$MONITOR_DIR/db-backup.sh" ]; then
    cp "$MONITOR_DIR/db-backup.sh" "$DEPLOY_HOME/scripts/db-backup.sh"
    chmod +x "$DEPLOY_HOME/scripts/db-backup.sh"
    chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/scripts/db-backup.sh"
fi

# ── Summary ─────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           SERVER SETUP COMPLETE                             ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                              ║"
echo "║  Next steps:                                                 ║"
echo "║                                                              ║"
echo "║  1. Add DNS records:                                         ║"
echo "║     api.$DOMAIN        A  →  $(curl -s ifconfig.me)           ║"
echo "║     staging-api.$DOMAIN A  →  $(curl -s ifconfig.me)           ║"
echo "║                                                              ║"
echo "║  2. Obtain SSL certificates:                                 ║"
echo "║     sudo certbot certonly --nginx -d api.$DOMAIN              ║"
echo "║     sudo certbot certonly --nginx -d staging-api.$DOMAIN      ║"
echo "║                                                              ║"
echo "║  3. Create .env files on the server:                         ║"
echo "║     ~/zuka-api/.env          (production)                    ║"
echo "║     ~/zuka-api-staging/.env  (staging)                       ║"
echo "║                                                              ║"
echo "║  4. Start PM2 processes:                                     ║"
echo "║     pm2 start ecosystem.config.cjs                           ║"
echo "║     pm2 save                                                 ║"
echo "║                                                              ║"
echo "║  5. Setup health check cron:                                 ║"
echo "║     crontab -e                                               ║"
echo "║     */2 * * * * ~/scripts/health-check.sh                    ║"
echo "║                                                              ║"
echo "║  6. Remove deploy user from sudo (security):                 ║"
echo "║     sudo deluser deploy sudo                                 ║"
echo "║                                                              ║"
echo "║  SSH: ssh -p $SSH_PORT $DEPLOY_USER@$(curl -s ifconfig.me)              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
