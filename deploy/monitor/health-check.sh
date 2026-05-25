#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# health-check.sh — Run via cron every 2 minutes
#
# Setup:
#   chmod +x ~/scripts/health-check.sh
#   (crontab -l 2>/dev/null; echo "*/2 * * * * ~/scripts/health-check.sh >> ~/logs/health-check.log 2>&1") | crontab -
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

PROD_URL="https://api.zuka.plus/health"
STAGING_URL="https://staging-api.zuka.plus/health"
WEBHOOK_URL="${DEPLOY_NOTIFY_WEBHOOK:-}"  # Set env var for Slack/Discord notifications

check_health() {
    local name=$1
    local url=$2

    response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")

    if [ "$response" != "200" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT: $name returned HTTP $response"

        # Send notification
        if [ -n "$WEBHOOK_URL" ]; then
            curl -s -X POST "$WEBHOOK_URL" \
                -H 'Content-Type: application/json' \
                -d "{\"text\": \"ALERT: $name health check failed (HTTP $response) on $(hostname)\"}" \
                > /dev/null 2>&1 || true
        fi

        # Auto-restart PM2 if the app is down
        pm2 restart "$name" 2>/dev/null || true
    fi
}

check_health "zuka-api-prod" "$PROD_URL"
check_health "zuka-api-staging" "$STAGING_URL"
