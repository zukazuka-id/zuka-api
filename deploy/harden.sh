#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# harden.sh — System hardening for Zuka API Lightsail server
# Run as root: sudo bash deploy/harden.sh
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
cat > /etc/ssh/sshd_config.d/99-hardened.conf << 'EOF'
# Zuka API — Hardened SSH Configuration
Port 2222
PermitRootLogin no
PasswordAuthentication no
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
UsePAM no

AllowUsers deploy

KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com

ClientAliveInterval 300
ClientAliveCountMax 2
MaxAuthTries 3

X11Forwarding no
AllowTcpForwarding no
PermitTunnel no
AllowAgentForwarding no
EOF

echo "  SSH hardened. Backup at $SSHD_BACKUP"
echo ""
echo "  WARNING: SSH is now on port 2222, key-only auth, deploy user only."
echo "  Test with: ssh -p 2222 deploy@<host> BEFORE closing this session."
echo ""
echo "=== Hardening complete ==="
