#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# db-backup.sh — Daily database backup
#
# Setup:
#   chmod +x ~/scripts/db-backup.sh
#   (crontab -l 2>/dev/null; echo "0 2 * * * ~/scripts/db-backup.sh >> ~/logs/db-backup.log 2>&1") | crontab -
#
# Prerequisites:
#   - DATABASE_URL env var set in .env
#   - pg_dump available (install: sudo apt install -y postgresql-client)
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

BACKUP_DIR="$HOME/backups/db"
RETAIN_DAYS=30
mkdir -p "$BACKUP_DIR"

# Source the production env file for DATABASE_URL
if [ -f "$HOME/zuka-api/.env" ]; then
    set -a
    source "$HOME/zuka-api/.env"
    set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: DATABASE_URL not set"
    exit 1
fi

FILENAME="zuka-db-$(date '+%Y%m%d-%H%M%S').sql.gz"

if command -v pg_dump &>/dev/null; then
    pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip > "$BACKUP_DIR/$FILENAME"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup completed: $FILENAME ($(du -h "$BACKUP_DIR/$FILENAME" | cut -f1))"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: pg_dump not installed. Run: sudo apt install -y postgresql-client"
    exit 1
fi

# Cleanup old backups
find "$BACKUP_DIR" -name "zuka-db-*.sql.gz" -mtime +"$RETAIN_DAYS" -delete
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleaned up backups older than $RETAIN_DAYS days."
