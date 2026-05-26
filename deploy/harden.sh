#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# harden.sh — Baseline OS and SSH hardening for a small Ubuntu API server
# Target: Ubuntu 24.04 LTS on AWS Lightsail / similar VPS
#
# Design principles:
#   1. Safe-by-default: never restart SSH automatically.
#      Rationale: SSH hardening is one of the most common ways to lock yourself
#      out of a remote server. This script writes and validates config, but the
#      operator must intentionally reload/restart SSH after confirming firewall
#      and key-based access.
#
#   2. Conservative compatibility: keep both port 22 and 2222 during initial
#      hardening.
#      Rationale: port 2222 reduces noise from generic SSH scanners, while port
#      22 is kept temporarily as a Lightsail/browser-SSH fallback. You may remove
#      port 22 later after confirming that deploy@host:2222 works reliably.
#
#   3. Key-only SSH: disable password and keyboard-interactive auth.
#      Rationale: password SSH is a high-risk brute-force target. Public-key SSH
#      materially reduces credential guessing risk.
#
#   4. Do not disable PAM.
#      Rationale: PAM is not only password authentication. On Ubuntu it also
#      handles session setup, limits, environment, and integration with system
#      policies. We keep UsePAM yes while disabling password-based login.
#
#   5. Validate before applying.
#      Rationale: malformed sshd config should fail fast before the operator
#      reloads SSH. A timestamped backup is kept for rollback.
#
# Run:
#   sudo bash harden.sh
#
# After running:
#   1. Confirm cloud firewall allows TCP 2222 and, during transition, TCP 22.
#   2. Validate SSH config: sudo sshd -t
#   3. Reload SSH: sudo systemctl reload ssh || sudo systemctl reload sshd
#   4. From a new terminal, test: ssh -p 2222 deploy@<server-ip>
#   5. Only after confirmed, optionally remove port 22 later.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail
IFS=$'\n\t'

DEPLOY_USER="${DEPLOY_USER:-deploy}"
FALLBACK_USER="${FALLBACK_USER:-ubuntu}"
PRIMARY_SSH_PORT="${PRIMARY_SSH_PORT:-2222}"
KEEP_PORT_22="${KEEP_PORT_22:-true}"

SSHD_CONFIG="/etc/ssh/sshd_config"
SSHD_DROPIN_DIR="/etc/ssh/sshd_config.d"
SSHD_DROPIN="$SSHD_DROPIN_DIR/99-zuka-hardened.conf"

echo "=== Server Hardening ==="
echo "Deploy user       : $DEPLOY_USER"
echo "Fallback user     : $FALLBACK_USER"
echo "Primary SSH port  : $PRIMARY_SSH_PORT"
echo "Keep port 22      : $KEEP_PORT_22"
echo ""

# ── Preflight ────────────────────────────────────────────────────────────────

# Root check.
# Rationale: sysctl, /etc/fstab, systemd, and sshd configuration changes require
# root privileges. Failing early avoids partial writes and confusing errors.
if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: This script must be run as root. Use: sudo bash harden.sh"
  exit 1
fi

# OS sanity check.
# Rationale: this script is tuned for Ubuntu/Debian-style paths, systemd, and
# OpenSSH packaging. It may need changes for other distributions.
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" && "${ID_LIKE:-}" != *"debian"* ]]; then
    echo "WARNING: This script was designed for Ubuntu/Debian-like systems."
    echo "Detected: ${PRETTY_NAME:-unknown}"
  fi
fi

# Validate SSH port value.
# Rationale: invalid ports would produce broken sshd configuration.
if ! [[ "$PRIMARY_SSH_PORT" =~ ^[0-9]+$ ]] || (( PRIMARY_SSH_PORT < 1 || PRIMARY_SSH_PORT > 65535 )); then
  echo "ERROR: PRIMARY_SSH_PORT must be a valid TCP port between 1 and 65535."
  exit 1
fi

# Validate deploy user if it already exists.
# Rationale: AllowUsers deploy will block every other user except the explicitly
# allowed fallback user. We warn rather than fail because setup-server.sh may be
# responsible for creating the deploy user before this script runs.
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "WARNING: deploy user '$DEPLOY_USER' does not exist yet."
  echo "         If you reload SSH after this, ensure the fallback user can still login."
else
  DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  if [[ ! -f "$DEPLOY_HOME/.ssh/authorized_keys" ]]; then
    echo "WARNING: $DEPLOY_USER has no authorized_keys file."
    echo "         Key-only SSH will not work for this user until a public key is added."
  else
    chmod 700 "$DEPLOY_HOME/.ssh" || true
    chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys" || true
    chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/.ssh" || true
  fi
fi

mkdir -p "$SSHD_DROPIN_DIR"

# ── 1. Kernel and network hardening ──────────────────────────────────────────

echo "[1/5] Applying sysctl security parameters..."

# Rationale summary:
#   - TCP SYN cookies reduce SYN flood impact.
#   - rp_filter helps reduce spoofed source routing risk.
#   - Redirect/source-route settings prevent accepting network path manipulation.
#   - log_martians improves visibility into suspicious packets.
#   - ASLR and kernel pointer restrictions reduce exploit reliability.
#   - protected_* sysctls reduce symlink/hardlink/fifo/regular-file abuse.
cat > /etc/sysctl.d/99-zuka-security.conf << 'EOF'
# ── Network hardening ────────────────────────────────────────────
net.ipv4.tcp_syncookies = 1

# Reverse path filtering helps reject packets whose source address would not
# be routed back through the receiving interface. This is useful against simple
# IP spoofing. Value 1 is conservative and usually compatible with single-homed
# VPS servers.
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Source routing and ICMP redirects can be abused to influence routing paths.
# API servers should not accept or send redirects.
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.default.accept_source_route = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.default.secure_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0

# Log suspicious/malformed packets. Useful for post-incident diagnosis.
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1

# Ignore broadcast pings and bogus ICMP responses.
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1

# Router advertisements should not be accepted by a typical VPS API server.
# If your network requires IPv6 RA, change this deliberately.
net.ipv6.conf.all.accept_ra = 0
net.ipv6.conf.default.accept_ra = 0

# ── Kernel exploit-resistance hardening ──────────────────────────
kernel.randomize_va_space = 2
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.unprivileged_bpf_disabled = 1

# ── Filesystem link protection ───────────────────────────────────
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2
EOF

sysctl --system >/dev/null
echo "  Applied /etc/sysctl.d/99-zuka-security.conf"

# ── 2. Shared memory hardening ───────────────────────────────────────────────

echo "[2/5] Hardening /dev/shm mount options..."

# Rationale:
#   nodev  = do not interpret device files from shared memory.
#   nosuid = ignore setuid/setgid bits.
#   noexec = prevent direct execution from shared memory.
#
# This is a common defense-in-depth control because /dev/shm is writable by
# unprivileged processes. We update an existing fstab entry when present, instead
# of blindly appending duplicates.
if grep -Eq '^[^#]+\s+/dev/shm\s+' /etc/fstab; then
  cp /etc/fstab "/etc/fstab.bak.$(date +%Y%m%d-%H%M%S)"
  awk '
    BEGIN { updated=0 }
    /^[[:space:]]*#/ { print; next }
    $2 == "/dev/shm" {
      print "tmpfs /dev/shm tmpfs defaults,nodev,nosuid,noexec 0 0"
      updated=1
      next
    }
    { print }
    END {
      if (updated == 0) {
        print "tmpfs /dev/shm tmpfs defaults,nodev,nosuid,noexec 0 0"
      }
    }
  ' /etc/fstab > /etc/fstab.tmp
  mv /etc/fstab.tmp /etc/fstab
else
  echo 'tmpfs /dev/shm tmpfs defaults,nodev,nosuid,noexec 0 0' >> /etc/fstab
fi

if mountpoint -q /dev/shm; then
  if mount -o remount /dev/shm; then
    echo "  /dev/shm remounted with hardened options."
  else
    echo "  WARNING: Could not remount /dev/shm now. A reboot may be required."
  fi
else
  echo "  WARNING: /dev/shm is not currently a mountpoint. fstab entry was written."
fi

# ── 3. Disable unnecessary services ─────────────────────────────────────────

echo "[3/5] Disabling unnecessary desktop/discovery services when present..."

# Rationale:
# API servers should run the minimum number of services. These packages are often
# irrelevant on headless servers and may increase attack surface. Commands are
# tolerant because not every Ubuntu VPS has these services installed.
for svc in avahi-daemon cups bluetooth ModemManager; do
  if systemctl list-unit-files "$svc.service" >/dev/null 2>&1; then
    if systemctl is-enabled "$svc.service" >/dev/null 2>&1; then
      systemctl disable --now "$svc.service" >/dev/null 2>&1 || true
      echo "  Disabled: $svc"
    else
      echo "  Already disabled/not enabled: $svc"
    fi
  fi
done

# ── 4. Resource limits ──────────────────────────────────────────────────────

echo "[4/5] Setting resource limits for deploy user..."

# Rationale:
# Node.js/PM2/Nginx-backed apps can legitimately open many files/sockets under
# load. Raising nofile avoids avoidable EMFILE errors. nproc limits reduce
# accidental process explosions.
cat > "/etc/security/limits.d/99-${DEPLOY_USER}.conf" << EOF
# Limits for the application deploy user.
# Requires PAM sessions, hence SSH keeps UsePAM yes.
${DEPLOY_USER} soft nofile 65536
${DEPLOY_USER} hard nofile 65536
${DEPLOY_USER} soft nproc 4096
${DEPLOY_USER} hard nproc 4096
EOF

echo "  Wrote /etc/security/limits.d/99-${DEPLOY_USER}.conf"

# ── 5. SSH hardening ────────────────────────────────────────────────────────

echo "[5/5] Writing and validating SSH hardening config..."

SSHD_BACKUP="${SSHD_CONFIG}.bak.$(date +%Y%m%d-%H%M%S)"
cp "$SSHD_CONFIG" "$SSHD_BACKUP"

# Rationale:
#   - Port 2222 reduces generic internet scanner noise.
#   - Port 22 is kept temporarily for provider console/browser-SSH fallback.
#   - PasswordAuthentication and KbdInteractiveAuthentication are disabled to
#     enforce key-only access.
#   - UsePAM remains enabled for session/limits compatibility.
#   - AllowUsers creates a tight allowlist. Keep ubuntu during transition; remove
#     it later only after deploy user login is confirmed.
#   - Forwarding/tunneling are disabled unless intentionally needed.
#   - We avoid aggressive custom cipher/KEX restrictions because cloud provider
#     browser SSH implementations may break unexpectedly. Modern OpenSSH defaults
#     are generally strong enough for this threat model.
{
  echo "# Zuka API — Hardened SSH configuration"
  echo "# Managed by harden.sh. Review before editing manually."
  echo ""
  if [[ "$KEEP_PORT_22" == "true" ]]; then
    echo "Port 22"
  fi
  echo "Port ${PRIMARY_SSH_PORT}"
  echo ""
  echo "PermitRootLogin no"
  echo "PasswordAuthentication no"
  echo "KbdInteractiveAuthentication no"
  echo "ChallengeResponseAuthentication no"
  echo "PubkeyAuthentication yes"
  echo "UsePAM yes"
  echo ""
  echo "AllowUsers ${DEPLOY_USER} ${FALLBACK_USER}"
  echo ""
  echo "ClientAliveInterval 300"
  echo "ClientAliveCountMax 2"
  echo "LoginGraceTime 30"
  echo "MaxAuthTries 3"
  echo "MaxSessions 2"
  echo ""
  echo "X11Forwarding no"
  echo "AllowTcpForwarding no"
  echo "PermitTunnel no"
  echo "AllowAgentForwarding no"
} > "$SSHD_DROPIN"

if sshd -t; then
  echo "  SSH configuration is valid."
else
  echo "ERROR: sshd configuration validation failed."
  echo "Restoring original sshd_config backup and removing drop-in."
  cp "$SSHD_BACKUP" "$SSHD_CONFIG"
  rm -f "$SSHD_DROPIN"
  exit 1
fi

echo ""
echo "=== Hardening complete ==="
echo "SSH config backup : $SSHD_BACKUP"
echo "SSH drop-in       : $SSHD_DROPIN"
echo ""
echo "IMPORTANT:"
echo "  SSH has NOT been restarted/reloaded automatically."
echo "  Before reloading SSH, confirm OS/cloud firewall allows TCP ${PRIMARY_SSH_PORT}."
if [[ "$KEEP_PORT_22" == "true" ]]; then
  echo "  Port 22 is intentionally still configured as a temporary fallback."
fi
echo ""
echo "Recommended next commands:"
echo "  sudo sshd -t"
echo "  sudo systemctl reload ssh || sudo systemctl reload sshd"
echo "  ssh -p ${PRIMARY_SSH_PORT} ${DEPLOY_USER}@<server-ip>"
echo ""
echo "After deploy@${PRIMARY_SSH_PORT} is confirmed, you may later remove port 22"
echo "from SSH and UFW if you no longer need provider/browser SSH fallback."
