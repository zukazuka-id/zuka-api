# Server Provisioning and Hardening Best Practices

This document explains the security and operational practices applied in the regenerated `harden.sh` and `server-setup.sh` scripts.

The scripts are designed for a small Ubuntu 24.04 LTS API server running on AWS Lightsail or a similar VPS provider. The goal is not to create a military-grade hardened image, but to establish a pragmatic production baseline that reduces common risks without creating unnecessary lockout or operational failure.

---

## 1. Core Security Principles

### 1.1 Avoid SSH Lockout

SSH hardening is one of the most dangerous parts of remote server provisioning because a mistake can permanently lock the operator out of the instance.

Applied practices:

- `harden.sh` writes SSH configuration but does **not** restart or reload SSH automatically.
- SSH config is validated using `sshd -t`.
- Port `22` is kept as a temporary fallback.
- Port `2222` is added as the primary deploy SSH port.
- The operator is instructed to test a new SSH session before closing the old one.

Recommended operator flow:

```bash
sudo sshd -t
sudo systemctl reload ssh || sudo systemctl reload sshd
ssh -p 2222 deploy@<server-ip>
```

Only after `deploy@2222` is confirmed should port `22` be removed.

---

### 1.2 Key-Only SSH Authentication

Password-based SSH login is disabled:

```sshconfig
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
```

Rationale:

- Password SSH attracts brute-force attempts.
- Public-key SSH is significantly harder to guess or brute-force.
- Disabling keyboard-interactive authentication closes another common password-like login path.

---

### 1.3 Keep PAM Enabled

The script keeps:

```sshconfig
UsePAM yes
```

Rationale:

PAM is not only about password authentication. On Ubuntu, PAM also handles session setup, environment, login limits, and other system integrations. Disabling PAM can break expected behavior, especially when `/etc/security/limits.d` is used.

---

### 1.4 Use an Explicit SSH Allowlist

The SSH config uses:

```sshconfig
AllowUsers deploy ubuntu
```

Rationale:

Only known administrative users should be allowed to SSH into the server.

The `ubuntu` user is kept temporarily because cloud providers such as Lightsail may rely on the default user for browser-based SSH fallback. After `deploy` access is confirmed, `ubuntu` can be removed from the allowlist if desired.

---

## 2. Firewall Strategy

The setup script configures UFW with:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp
ufw limit 2222/tcp
ufw allow 80/tcp
ufw allow 443/tcp
```

### Why keep both 22 and 2222 initially?

During provisioning, safety matters more than aggressive hardening. Keeping both ports open reduces the chance of lockout.

- `22`: fallback for provider/browser SSH.
- `2222`: main deploy SSH port.
- `80`: required for HTTP and Let's Encrypt validation.
- `443`: required for HTTPS API traffic.

Once the server is stable:

```bash
sudo ufw delete limit 22/tcp
```

Then remove `Port 22` from SSH config and reload SSH.

---

## 3. SSH Port 2222

Moving SSH from port `22` to `2222` is not a primary security control. It does not replace key-only authentication.

Its value is mostly practical:

- reduces noise from generic internet scanners,
- reduces repeated log spam,
- makes brute-force dashboards cleaner.

The real security control is key-only authentication plus UFW/fail2ban.

---

## 4. Kernel and Network Hardening

`harden.sh` writes `/etc/sysctl.d/99-zuka-security.conf`.

Applied controls include:

### SYN flood mitigation

```conf
net.ipv4.tcp_syncookies = 1
```

Helps reduce the impact of SYN flood attacks.

### Reverse path filtering

```conf
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
```

Helps reject spoofed traffic on simple single-interface servers.

### Disable source routing and redirects

```conf
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
```

API servers should not accept network path manipulation from external traffic.

### Kernel information leak reduction

```conf
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
```

Reduces kernel information exposure to unprivileged users.

### Exploit resistance

```conf
kernel.randomize_va_space = 2
kernel.unprivileged_bpf_disabled = 1
```

Improves exploit resistance and limits unprivileged BPF abuse.

### Filesystem link protections

```conf
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2
```

Reduces common local privilege escalation techniques involving symlinks, hardlinks, FIFOs, and regular files in shared directories.

---

## 5. `/dev/shm` Hardening

The script configures:

```fstab
tmpfs /dev/shm tmpfs defaults,nodev,nosuid,noexec 0 0
```

Rationale:

`/dev/shm` is writable shared memory. Attackers sometimes use writable locations to stage payloads.

Options:

- `nodev`: prevents device file interpretation.
- `nosuid`: ignores setuid/setgid bits.
- `noexec`: prevents direct execution from `/dev/shm`.

The regenerated script updates an existing `/dev/shm` line instead of blindly appending duplicates.

---

## 6. Service Minimization

The hardening script disables unnecessary services if present:

- `avahi-daemon`
- `cups`
- `bluetooth`
- `ModemManager`

Rationale:

A headless API server should run the minimum required services. Fewer services means smaller attack surface.

The script tolerates missing services because minimal cloud images may not include them.

---

## 7. Resource Limits for Deploy User

The script writes:

```conf
deploy soft nofile 65536
deploy hard nofile 65536
deploy soft nproc 4096
deploy hard nproc 4096
```

Rationale:

Node.js, PM2, and Nginx-backed APIs can open many sockets/files under load. Raising `nofile` prevents avoidable `EMFILE` errors. `nproc` limits reduce accidental process explosions.

Because these limits are applied via PAM, SSH keeps `UsePAM yes`.

---

## 8. Dedicated Deploy User

The setup script creates a dedicated non-root user:

```bash
adduser --disabled-password deploy
```

Rationale:

Application processes should not run as root. A compromised app running as `deploy` has a smaller blast radius than a compromised root process.

The user is initially added to `sudo` for provisioning convenience. After setup is complete, removing sudo is recommended:

```bash
sudo deluser deploy sudo
```

---

## 9. Avoiding Hard-Coded Secrets

The setup script does not include private keys, tokens, database URLs, or `.env` contents.

The deploy SSH public key is provided via:

```bash
DEPLOY_SSH_KEY="ssh-ed25519 AAAA..."
```

or pasted interactively.

Application secrets should be created manually on the server or delivered using a secure secret-management workflow.

Recommended locations:

```text
/home/deploy/zuka-api/.env
/home/deploy/zuka-api-staging/.env
```

These files should never be committed to Git.

---

## 10. Package Installation and Supply-Chain Risk

The previous script used:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
```

The regenerated script downloads the file first:

```bash
curl -fsSL "https://deb.nodesource.com/setup_22.x" -o /tmp/nodesource-setup-22.x.sh
bash /tmp/nodesource-setup-22.x.sh
rm -f /tmp/nodesource-setup-22.x.sh
```

Rationale:

This is still not perfect supply-chain security, but it is more auditable than directly piping remote content into root shell.

For stricter environments, replace this with manually pinned repository configuration and signed keyring verification.

---

## 11. Nginx Configuration Safety

The setup script copies versioned Nginx configs and runs:

```bash
nginx -t
```

before restarting Nginx.

Rationale:

A broken reverse proxy should not be hidden. The regenerated script does not use:

```bash
systemctl restart nginx || true
```

because silent service failure can create a false sense of success.

If configs reference SSL certificates that do not exist yet, the script warns and skips Nginx restart.

---

## 12. Certbot Strategy

The script installs Certbot and a renewal hook:

```bash
/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

Rationale:

After certificate renewal, Nginx must reload to use the renewed certificates.

Suggested certificate issuance:

```bash
sudo certbot --nginx -d api.zuka.plus
sudo certbot --nginx -d staging-api.zuka.plus
```

Separate certificates for production and staging are easier to reason about operationally.

---

## 13. fail2ban

The setup script installs fail2ban and validates config using:

```bash
fail2ban-client -t
```

Rationale:

UFW rate limiting protects at the network level. fail2ban adds log-based blocking for suspicious SSH and Nginx patterns.

This is useful for:

- repeated SSH failures,
- repeated HTTP 401 probes,
- bot-like request patterns.

---

## 14. Unattended Security Updates

The regenerated setup script enables unattended security updates but disables automatic reboot by default:

```conf
Unattended-Upgrade::Automatic-Reboot "false";
```

Rationale:

Security updates are important, but automatic reboot should only be enabled after application recovery is proven.

Enable automatic reboot only when:

- PM2 startup is confirmed,
- Nginx starts after reboot,
- environment files are present,
- health checks are working,
- downtime risk is acceptable.

To enable:

```bash
AUTO_REBOOT_SECURITY_UPDATES=true sudo -E bash server-setup.sh
```

---

## 15. PM2 Startup Safety

The previous script piped PM2 startup output directly into `bash`.

The regenerated script parses the PM2-generated startup command and executes only the expected line.

Rationale:

Piping arbitrary command output directly to root shell is fragile. PM2’s startup command is legitimate, but parsing it explicitly is safer and easier to review.

PM2 log rotation is also configured:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

Rationale:

Logs can fill a small VPS disk and cause outages.

---

## 16. Optional App Bootstrap

The regenerated setup script does not clone/build the application by default.

To enable:

```bash
RUN_APP_BOOTSTRAP=true REPO_URL="git@github.com:your-org/your-repo.git" sudo -E bash server-setup.sh
```

Rationale:

Provisioning and app deployment are related but not identical. App deployment often requires:

- branch selection,
- environment variables,
- database migration decisions,
- rollback planning,
- staging vs production differences.

Keeping app bootstrap optional reduces accidental production mistakes.

---

## 17. Recommended Production Rollout Sequence

Use this order for a safer first-time server setup:

1. Create fresh Ubuntu 24.04 Lightsail instance.
2. Confirm Lightsail firewall allows:
   - TCP 22
   - TCP 2222
   - TCP 80
   - TCP 443
3. Run setup script:
   ```bash
   DEPLOY_SSH_KEY="$(cat ~/.ssh/id_ed25519.pub)" sudo -E bash server-setup.sh
   ```
4. Validate SSH:
   ```bash
   sudo sshd -t
   sudo systemctl reload ssh
   ```
5. Test new SSH session:
   ```bash
   ssh -p 2222 deploy@<server-ip>
   ```
6. Configure DNS.
7. Issue SSL certificates.
8. Create `.env` files.
9. Start PM2 app.
10. Reboot test once.
11. Remove unnecessary sudo from deploy user.
12. Optionally remove SSH port 22 fallback.

---

## 18. What These Scripts Do Not Solve

These scripts are a baseline, not a full security program.

Still needed:

- application-level authentication and authorization,
- secure database configuration,
- encrypted backups,
- monitoring and alerting,
- dependency vulnerability scanning,
- secret rotation,
- incident response process,
- least-privilege database credentials,
- CI/CD deployment controls,
- WAF/rate limiting if traffic grows,
- Docker/container hardening if containers are introduced.

---

## 19. Final Notes

The strongest practical improvements in these regenerated scripts are:

1. no automatic SSH restart,
2. SSH config validation before reload,
3. key-only SSH,
4. temporary fallback access to avoid lockout,
5. explicit firewall rules,
6. no silent Nginx restart failure,
7. fail2ban validation,
8. unattended security updates without surprise reboot,
9. no hard-coded secrets,
10. clearer separation between server provisioning and app deployment.
