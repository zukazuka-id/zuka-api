#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# harden.sh — System hardening for Zuka API Lightsail server
# Run as root: sudo bash deploy/harden.sh
#
# IMPORTANT: This script does NOT restart ssh automatically.
# After running, test SSH on port 2222 BEFORE restarting:
#   ssh -p 2222 deploy@<host>
# Then: sudo systemctl restart ssh
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

echo "=== Zuka API — System Hardening ==="

# ── 1. sysctl Security Parameters ───────────────────────────────
echo "[1/5] Applying sysctl security parameters..."

cat > /etc/sysctl.d/99-security.conf << 'EOF'
# Network Security
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1

# IPv6 Hardening
net.ipv6.conf.all.accept_ra = 0
net.ipv6.conf.default.accept_ra = 0

# Kernel Protection
kernel.randomize_va_space = 2
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.unprivileged_bpf_disabled = 1

# File System Protection
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2
EOF

sysctl --system
echo "  sysctl parameters applied."

# ── 2. Shared Memory Hardening ──────────────────────────────────
echo "[2/5] Hardening shared memory..."

if ! grep -q '/dev/shm' /etc/fstab; then
    echo 'tmpfs /dev/shm tmpfs defaults,nodev,nosuid,noexec 0 0' >> /etc/fstab
    mount -o remount /dev/shm 2>/dev/null || true
    echo "  /dev/shm hardened (nodev,nosuid,noexec)."
else
    echo "  /dev/shm already configured."
fi

# ── 3. Disable Unnecessary Services ─────────────────────────────
echo "[3/5] Disabling unnecessary services..."

for svc in avahi-daemon cups bluetooth ModemManager; do
    if systemctl is-enabled "$svc" &>/dev/null; then
        systemctl disable --now "$svc" 2>/dev/null || true
        echo "  Disabled: $svc"
    fi
done

# ── 4. File Descriptor Limits ───────────────────────────────────
echo "[4/5] Setting file descriptor limits..."

cat > /etc/security/limits.d/99-deploy.conf << 'EOF'
deploy soft nofile 65536
deploy hard nofile 65536
deploy soft nproc 4096
deploy hard nproc 4096
EOF

echo "  File descriptor limits set for deploy user."

# ── 5. SSH Hardening ────────────────────────────────────────────
echo "[5/5] Hardening SSH configuration..."

SSHD_CONFIG="/etc/ssh/sshd_config"
SSHD_BACKUP="/etc/ssh/sshd_config.bak.$(date +%Y%m%d)"

cp "$SSHD_CONFIG" "$SSHD_BACKUP"

# Apply hardened SSH settings
# NOTE: Port 22 kept open as fallback for Lightsail browser SSH.
#       No cipher/KEX restrictions — those broke Lightsail browser auth.
cat > /etc/ssh/sshd_config.d/99-hardened.conf << 'EOF'
# Zuka API — Hardened SSH Configuration
# Dual-listen: port 22 for Lightsail browser fallback, 2222 for deploy
Port 22
Port 2222
PermitRootLogin no
PasswordAuthentication no

AllowUsers deploy ubuntu

ClientAliveInterval 300
ClientAliveCountMax 2
MaxAuthTries 3

X11Forwarding no
EOF

echo "  SSH config written. Backup at $SSHD_BACKUP"
echo ""
echo "  Changes (NOT yet applied — ssh not restarted):"
echo "    - Port 22 (Lightsail browser fallback) + Port 2222"
echo "    - Users: deploy, ubuntu"
echo "    - Key-only auth (no passwords)"
echo "    - Removed cipher/KEX restrictions (they broke Lightsail browser SSH)"
echo ""
echo "  BEFORE restarting ssh, make sure port 2222 is open in Lightsail firewall."
echo "  Then apply: sudo systemctl restart ssh"
echo "  Test from Mac: ssh zuka-server"
echo ""
echo "=== Hardening complete ==="
