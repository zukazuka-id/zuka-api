#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# server-setup.sh — One-time Ubuntu server provisioning for a Node.js API server
# Target: Ubuntu 24.04 LTS on AWS Lightsail / similar VPS
#
# This script intentionally favors operational safety over extreme lockdown.
# It is meant for a fresh server. Re-running it on an existing production server
# may upgrade packages, overwrite Nginx/fail2ban configs, and change firewall
# rules. Treat it as provisioning code, not a day-to-day maintenance script.
#
# Security design principles:
#   1. Create a dedicated deploy user and use key-only SSH.
#   2. Keep SSH port 22 and 2222 open during setup to avoid lockout.
#   3. Validate required deployment config files before copying.
#   4. Avoid silent service failures; test Nginx before restarting.
#   5. Avoid direct curl | bash where practical; download then execute.
#   6. Keep unattended automatic reboot disabled by default until application
#      recovery is proven.
#   7. Do not store secrets in this script. .env files must be created manually
#      or through a secure secret-management workflow.
#
# Run example:
#   DEPLOY_SSH_KEY="$(cat ~/.ssh/id_ed25519.pub)" \
#   REPO_URL="git@github.com:your-org/your-repo.git" \
#   sudo -E bash server-setup.sh
#
# Optional environment variables:
#   DEPLOY_USER=deploy
#   SSH_PORT=2222
#   NODE_VERSION=22
#   DOMAIN=zuka.plus
#   REPO_URL=git@github.com:...
#   DEPLOY_SSH_KEY="ssh-ed25519 AAAA..."
#   AUTO_REBOOT_SECURITY_UPDATES=false
#   RUN_APP_BOOTSTRAP=false
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail
IFS=$'\n\t'

# ── Configuration ───────────────────────────────────────────────────────────

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SSH_PORT="${SSH_PORT:-2222}"
NODE_VERSION="${NODE_VERSION:-22}"
DOMAIN="${DOMAIN:-zuka.plus}"
REPO_URL="${REPO_URL:-}"
AUTO_REBOOT_SECURITY_UPDATES="${AUTO_REBOOT_SECURITY_UPDATES:-false}"
RUN_APP_BOOTSTRAP="${RUN_APP_BOOTSTRAP:-false}"

DEPLOY_HOME="/home/${DEPLOY_USER}"

echo "=== Server Setup ==="
echo "Deploy user                  : $DEPLOY_USER"
echo "SSH deploy port              : $SSH_PORT"
echo "Node.js major version        : $NODE_VERSION"
echo "Domain                       : $DOMAIN"
echo "Repo URL configured          : $([[ -n "$REPO_URL" ]] && echo yes || echo no)"
echo "Run app bootstrap            : $RUN_APP_BOOTSTRAP"
echo "Auto reboot security updates : $AUTO_REBOOT_SECURITY_UPDATES"
echo ""

# ── Preflight ───────────────────────────────────────────────────────────────

# Root check.
# Rationale: provisioning touches package manager, users, firewall, services,
# and /etc configuration. Running as non-root would fail unpredictably.
if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: This script must be run as root. Use sudo."
  exit 1
fi

# OS check.
# Rationale: commands and paths are Ubuntu/Debian-specific.
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    echo "WARNING: This script is designed for Ubuntu. Detected: ${PRETTY_NAME:-unknown}"
  fi
fi

# Port validation.
if ! [[ "$SSH_PORT" =~ ^[0-9]+$ ]] || (( SSH_PORT < 1 || SSH_PORT > 65535 )); then
  echo "ERROR: SSH_PORT must be a valid TCP port between 1 and 65535."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_DEPLOY_DIR="$SCRIPT_DIR/nginx"
F2B_DIR="$SCRIPT_DIR/fail2ban"
MONITOR_DIR="$SCRIPT_DIR/monitor"
HARDEN_SCRIPT="$SCRIPT_DIR/harden.sh"

echo "[0/12] Running preflight checks..."

# Validate local config files before making service changes.
# Rationale: failing late after package installation/firewall changes is painful.
# This gives a clear error if the deploy package is incomplete.
required_files=(
  "$HARDEN_SCRIPT"
  "$NGINX_DEPLOY_DIR/nginx.conf"
  "$NGINX_DEPLOY_DIR/security-headers.conf"
  "$NGINX_DEPLOY_DIR/ssl-params.conf"
  "$NGINX_DEPLOY_DIR/api.zuka.plus.conf"
  "$NGINX_DEPLOY_DIR/staging-api.zuka.plus.conf"
  "$F2B_DIR/jail.local"
  "$F2B_DIR/nginx-401.conf"
  "$F2B_DIR/bots.conf"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "ERROR: Required file missing: $file"
    echo "Place this script inside the deploy directory with nginx/ and fail2ban/ configs."
    exit 1
  fi
done

echo "  Required deployment files found."

# ── 1. System update and base packages ──────────────────────────────────────

echo "[1/12] Updating system packages and installing base tools..."

# Rationale:
# On a fresh server, applying available updates reduces known vulnerability
# exposure before the app is reachable. For existing production servers, this
# step should be controlled through maintenance windows.
apt update
apt upgrade -y
apt install -y \
  curl wget git unzip ca-certificates gnupg lsb-release \
  software-properties-common apt-transport-https \
  ufw fail2ban nginx certbot python3-certbot-nginx \
  unattended-upgrades apt-listchanges

# ── 2. Create deploy user ──────────────────────────────────────────────────

echo "[2/12] Creating and configuring deploy user..."

# Rationale:
# The app should not run as root. A dedicated deploy user limits blast radius.
# We initially add sudo for provisioning convenience. The final summary reminds
# you to remove sudo after setup if the user no longer needs admin access.
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "Deploy User" "$DEPLOY_USER"
  echo "  Created user: $DEPLOY_USER"
else
  echo "  User already exists: $DEPLOY_USER"
fi

usermod -aG sudo "$DEPLOY_USER"
usermod -aG www-data "$DEPLOY_USER"

DEPLOY_SSH_DIR="$DEPLOY_HOME/.ssh"
mkdir -p "$DEPLOY_SSH_DIR"

# Rationale:
# Do not hard-code SSH keys in the script. Provide DEPLOY_SSH_KEY securely from
# the local environment or paste it interactively. Only public keys belong here.
if [[ -n "${DEPLOY_SSH_KEY:-}" ]]; then
  echo "$DEPLOY_SSH_KEY" > "$DEPLOY_SSH_DIR/authorized_keys"
else
  echo "Paste the SSH PUBLIC key for the deploy user, then press Enter:"
  read -r ssh_key
  if [[ -z "$ssh_key" ]]; then
    echo "ERROR: Empty SSH public key. Aborting."
    exit 1
  fi
  echo "$ssh_key" > "$DEPLOY_SSH_DIR/authorized_keys"
fi

chmod 700 "$DEPLOY_SSH_DIR"
chmod 600 "$DEPLOY_SSH_DIR/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_SSH_DIR"
echo "  SSH key configured for $DEPLOY_USER."

# ── 3. Install Node.js ─────────────────────────────────────────────────────

echo "[3/12] Installing Node.js ${NODE_VERSION}..."

# Rationale:
# Avoiding direct curl | bash improves auditability. We still execute the
# official NodeSource setup script, but download it first so it can be logged,
# inspected, and removed explicitly. For highly regulated environments, replace
# this with fully pinned signed repository configuration.
NODESOURCE_SCRIPT="/tmp/nodesource-setup-${NODE_VERSION}.x.sh"
curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" -o "$NODESOURCE_SCRIPT"
bash "$NODESOURCE_SCRIPT"
rm -f "$NODESOURCE_SCRIPT"

apt install -y nodejs
echo "  Node.js installed: $(node -v)"
echo "  npm installed    : $(npm -v)"

# ── 4. Install pnpm and PM2 ────────────────────────────────────────────────

echo "[4/12] Installing pnpm and PM2..."

# Rationale:
# pnpm is used for deterministic Node dependency installation. PM2 is used as a
# process manager for Node API processes. Both are installed globally because
# this is a small VPS deployment; larger setups may prefer container images.
npm install -g pnpm pm2

echo "  pnpm: $(pnpm -v)"
echo "  pm2 : $(pm2 -v)"

# ── 5. Configure firewall early, safely ────────────────────────────────────

echo "[5/12] Configuring UFW firewall..."

# Rationale:
# Default deny incoming is a sane baseline. We open both 22 and 2222 during
# setup because SSH lockout is more damaging than temporary exposure of port 22.
# UFW limit rate-limits repeated connection attempts.
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp comment "SSH fallback during setup"
ufw limit "$SSH_PORT/tcp" comment "SSH deploy port"
ufw allow 80/tcp comment "HTTP for ACME and redirects"
ufw allow 443/tcp comment "HTTPS"

# Enable without interactive prompt.
echo "y" | ufw enable
ufw status verbose
echo "  Firewall enabled. Ports 22, ${SSH_PORT}, 80, and 443 are allowed."

# ── 6. Configure Nginx ─────────────────────────────────────────────────────

echo "[6/12] Installing and configuring Nginx..."

# Rationale:
# Nginx is the public edge service. Config files are copied from versioned deploy
# assets. We validate configuration before restart/reload. We do not suppress
# Nginx failures silently because a broken reverse proxy should be visible.
mkdir -p /etc/nginx/snippets /etc/nginx/sites-available /etc/nginx/sites-enabled

cp "$NGINX_DEPLOY_DIR/nginx.conf" /etc/nginx/nginx.conf
cp "$NGINX_DEPLOY_DIR/security-headers.conf" /etc/nginx/snippets/security-headers.conf
cp "$NGINX_DEPLOY_DIR/ssl-params.conf" /etc/nginx/snippets/ssl-params.conf
cp "$NGINX_DEPLOY_DIR/api.zuka.plus.conf" /etc/nginx/sites-available/api.zuka.plus.conf
cp "$NGINX_DEPLOY_DIR/staging-api.zuka.plus.conf" /etc/nginx/sites-available/staging-api.zuka.plus.conf

ln -sf /etc/nginx/sites-available/api.zuka.plus.conf /etc/nginx/sites-enabled/api.zuka.plus.conf
ln -sf /etc/nginx/sites-available/staging-api.zuka.plus.conf /etc/nginx/sites-enabled/staging-api.zuka.plus.conf
rm -f /etc/nginx/sites-enabled/default

systemctl enable nginx

if nginx -t; then
  systemctl restart nginx
  echo "  Nginx configuration is valid and service restarted."
else
  echo "WARNING: Nginx configuration is not valid yet."
  echo "         This may happen if configs reference SSL certificate files that"
  echo "         have not been issued. Nginx was NOT restarted."
  echo "         Fix config/certificates, then run: sudo nginx -t && sudo systemctl restart nginx"
fi

# ── 7. Configure Certbot renewal hook ──────────────────────────────────────

echo "[7/12] Configuring Certbot renewal hook..."

# Rationale:
# Certbot must reload Nginx after successful renewal so the service uses the new
# certificate without manual intervention.
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh << 'HOOK'
#!/usr/bin/env bash
set -euo pipefail
systemctl reload nginx
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

echo "  Certbot installed."
echo "  Suggested certificate commands after DNS is ready:"
echo "    sudo certbot --nginx -d api.${DOMAIN}"
echo "    sudo certbot --nginx -d staging-api.${DOMAIN}"

# ── 8. Configure fail2ban ─────────────────────────────────────────────────

echo "[8/12] Configuring fail2ban..."

# Rationale:
# UFW limits basic connection attempts; fail2ban adds log-based banning for SSH
# and Nginx patterns. Config is versioned in deploy/fail2ban.
cp "$F2B_DIR/jail.local" /etc/fail2ban/jail.local
cp "$F2B_DIR/nginx-401.conf" /etc/fail2ban/filter.d/nginx-401.conf
cp "$F2B_DIR/bots.conf" /etc/fail2ban/filter.d/bots.conf

systemctl enable fail2ban
if fail2ban-client -t; then
  systemctl restart fail2ban
  echo "  fail2ban configuration is valid and service restarted."
else
  echo "ERROR: fail2ban configuration validation failed."
  exit 1
fi

# ── 9. Run OS hardening ────────────────────────────────────────────────────

echo "[9/12] Running OS and SSH hardening script..."

# Rationale:
# This writes sysctl, /dev/shm, resource limits, and SSH hardening. It validates
# sshd config but intentionally does not reload SSH automatically.
chmod +x "$HARDEN_SCRIPT"
DEPLOY_USER="$DEPLOY_USER" PRIMARY_SSH_PORT="$SSH_PORT" KEEP_PORT_22=true bash "$HARDEN_SCRIPT"

# ── 10. Configure unattended security updates ──────────────────────────────

echo "[10/12] Configuring unattended security updates..."

# Rationale:
# Security updates should be applied automatically on internet-facing servers.
# Automatic reboot is disabled by default until PM2/app recovery is verified.
# Set AUTO_REBOOT_SECURITY_UPDATES=true if you explicitly accept scheduled
# unattended reboots at 03:00 local server time.
if [[ "$AUTO_REBOOT_SECURITY_UPDATES" == "true" ]]; then
  AUTO_REBOOT_VALUE="true"
else
  AUTO_REBOOT_VALUE="false"
fi

cat > /etc/apt/apt.conf.d/50unattended-upgrades << EOF
Unattended-Upgrade::Allowed-Origins {
    "\${distro_id}:\${distro_codename}-security";
    "\${distro_id}ESMApps:\${distro_codename}-apps-security";
    "\${distro_id}ESMInfrastructure:\${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "${AUTO_REBOOT_VALUE}";
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

systemctl enable unattended-upgrades
systemctl restart unattended-upgrades || true
echo "  Unattended security updates enabled. Automatic reboot: ${AUTO_REBOOT_VALUE}"

# ── 11. Prepare app directories and optional clone/build ───────────────────

echo "[11/12] Preparing application directories..."

# Rationale:
# Create predictable app/log/backup/script directories with deploy ownership.
# We keep app cloning optional because production secret setup, branch selection,
# and environment files should be deliberate.
mkdir -p "$DEPLOY_HOME/logs" "$DEPLOY_HOME/backups" "$DEPLOY_HOME/scripts"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/logs" "$DEPLOY_HOME/backups" "$DEPLOY_HOME/scripts"

if [[ "$RUN_APP_BOOTSTRAP" == "true" ]]; then
  if [[ -z "$REPO_URL" ]]; then
    echo "ERROR: RUN_APP_BOOTSTRAP=true but REPO_URL is empty."
    exit 1
  fi

  # Rationale:
  # Production and staging are separate working copies to avoid accidental
  # cross-environment deployments. This assumes the repo contains the required
  # build scripts and ecosystem.config.cjs.
  if [[ ! -d "$DEPLOY_HOME/zuka-api/.git" ]]; then
    sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$DEPLOY_HOME/zuka-api"
  fi

  if [[ ! -d "$DEPLOY_HOME/zuka-api-staging/.git" ]]; then
    sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$DEPLOY_HOME/zuka-api-staging"
  fi

  cd "$DEPLOY_HOME/zuka-api"
  sudo -u "$DEPLOY_USER" pnpm install --frozen-lockfile
  sudo -u "$DEPLOY_USER" pnpm build

  cd "$DEPLOY_HOME/zuka-api-staging"
  sudo -u "$DEPLOY_USER" pnpm install --frozen-lockfile
  sudo -u "$DEPLOY_USER" pnpm build

  if [[ -f "$DEPLOY_HOME/zuka-api/ecosystem.config.cjs" ]]; then
    cp "$DEPLOY_HOME/zuka-api/ecosystem.config.cjs" "$DEPLOY_HOME/ecosystem.config.cjs"
    chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/ecosystem.config.cjs"
  else
    echo "WARNING: ecosystem.config.cjs not found in production repo checkout."
  fi
else
  echo "  Skipped repo clone/build. Set RUN_APP_BOOTSTRAP=true to enable."
fi

# Copy optional monitoring scripts if present.
if [[ -f "$MONITOR_DIR/health-check.sh" ]]; then
  cp "$MONITOR_DIR/health-check.sh" "$DEPLOY_HOME/scripts/health-check.sh"
  chmod +x "$DEPLOY_HOME/scripts/health-check.sh"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/scripts/health-check.sh"
  echo "  Installed health-check.sh"
fi

if [[ -f "$MONITOR_DIR/db-backup.sh" ]]; then
  cp "$MONITOR_DIR/db-backup.sh" "$DEPLOY_HOME/scripts/db-backup.sh"
  chmod +x "$DEPLOY_HOME/scripts/db-backup.sh"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/scripts/db-backup.sh"
  echo "  Installed db-backup.sh"
fi

# ── 12. Configure PM2 startup and log rotation ─────────────────────────────

echo "[12/12] Configuring PM2 startup and log rotation..."

# Rationale:
# PM2 startup ensures app recovery after reboot. We parse the PM2-generated
# command instead of blindly piping arbitrary output to bash. This reduces the
# risk of executing unexpected text as root.
PM2_OUTPUT="$(sudo -u "$DEPLOY_USER" pm2 startup systemd -u "$DEPLOY_USER" --hp "$DEPLOY_HOME" || true)"
PM2_CMD="$(echo "$PM2_OUTPUT" | grep -E '^sudo .+env PATH=.* pm2 startup systemd' | tail -n 1 || true)"

if [[ -n "$PM2_CMD" ]]; then
  echo "  Running PM2 startup command generated by PM2..."
  eval "$PM2_CMD"
else
  echo "WARNING: Could not auto-detect PM2 startup command."
  echo "         PM2 output was:"
  echo "$PM2_OUTPUT"
  echo "         You may need to run PM2 startup manually."
fi

# Rationale:
# PM2 logs can fill disk on small VPS instances. Log rotation prevents avoidable
# outages caused by full disks.
sudo -u "$DEPLOY_USER" pm2 install pm2-logrotate || true
sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:max_size 50M
sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:retain 14
sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:compress true
sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss

# ── Summary ────────────────────────────────────────────────────────────────

PUBLIC_IP="$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"

cat << EOF

╔══════════════════════════════════════════════════════════════════════╗
║ SERVER SETUP COMPLETE                                               ║
╠══════════════════════════════════════════════════════════════════════╣
║ Domain           : ${DOMAIN}
║ Public IP        : ${PUBLIC_IP}
║ Deploy user      : ${DEPLOY_USER}
║ SSH ports open   : 22 fallback, ${SSH_PORT} deploy
║ Auto reboot      : ${AUTO_REBOOT_VALUE}
╚══════════════════════════════════════════════════════════════════════╝

Recommended next steps:

1. Confirm DNS records:
   api.${DOMAIN}          A  -> ${PUBLIC_IP}
   staging-api.${DOMAIN}  A  -> ${PUBLIC_IP}

2. Confirm SSH config and reload SSH deliberately:
   sudo sshd -t
   sudo systemctl reload ssh || sudo systemctl reload sshd

3. From a NEW terminal, test deploy SSH:
   ssh -p ${SSH_PORT} ${DEPLOY_USER}@${PUBLIC_IP}

4. Obtain SSL certificates after DNS is propagated:
   sudo certbot --nginx -d api.${DOMAIN}
   sudo certbot --nginx -d staging-api.${DOMAIN}

5. Create environment files manually; do not commit secrets:
   ${DEPLOY_HOME}/zuka-api/.env
   ${DEPLOY_HOME}/zuka-api-staging/.env

6. Start app processes after env files are ready:
   cd ${DEPLOY_HOME}
   sudo -u ${DEPLOY_USER} pm2 start ecosystem.config.cjs
   sudo -u ${DEPLOY_USER} pm2 save

7. Optional, after deploy SSH and app recovery are proven:
   - Remove deploy user from sudo:
     sudo deluser ${DEPLOY_USER} sudo

   - Remove SSH fallback port 22 from UFW and sshd config:
     sudo ufw delete limit 22/tcp
     sudo sed -i '/^Port 22$/d' /etc/ssh/sshd_config.d/99-zuka-hardened.conf
     sudo sshd -t && sudo systemctl reload ssh

EOF
