#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# deploy.sh — Server-side deploy script for Zuka API
#
# Usage: ./deploy.sh <environment> [branch]
#   ./deploy.sh staging          # deploys staging from main
#   ./deploy.sh production      # deploys production from production
#   ./deploy.sh staging feature/invite-redesign
#
# Run as deploy user: bash deploy/deploy.sh staging
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

ENV=${1:-staging}
BRANCH=${2:-}

if [ "$ENV" = "production" ]; then
    APP_NAME="zuka-api-prod"
    APP_DIR="$HOME/zuka-api"
    PORT=3456
    DEFAULT_BRANCH="production"
elif [ "$ENV" = "staging" ]; then
    APP_NAME="zuka-api-staging"
    APP_DIR="$HOME/zuka-api-staging"
    PORT=3457
    DEFAULT_BRANCH="main"
else
    echo "Usage: $0 <staging|production> [branch]"
    exit 1
fi

BRANCH="${BRANCH:-$DEFAULT_BRANCH}"

echo "=== Deploying $ENV ==="
echo "  App:     $APP_NAME"
echo "  Dir:     $APP_DIR"
echo "  Branch:  $BRANCH"
echo "  Port:    $PORT"
echo ""

cd "$APP_DIR"

# ── Save current state for rollback ─────────────────────────────
PREV_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "none")
echo "Previous commit: $PREV_COMMIT"

# ── Pull latest code ────────────────────────────────────────────
echo "[1/4] Fetching latest code..."
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

NEW_COMMIT=$(git rev-parse HEAD)
echo "  Updated: $PREV_COMMIT → $NEW_COMMIT"

if [ "$PREV_COMMIT" = "$NEW_COMMIT" ]; then
    echo "  No changes detected. Skipping deploy."
    exit 0
fi

# ── Install dependencies ────────────────────────────────────────
echo "[2/4] Installing dependencies..."
pnpm install --frozen-lockfile

# ── Build ────────────────────────────────────────────────────────
echo "[3/4] Building..."
if ! pnpm build; then
    echo "  BUILD FAILED! Rolling back to $PREV_COMMIT..."
    git checkout "$PREV_COMMIT"
    pnpm install --frozen-lockfile
    pnpm build
    echo "  Rolled back. Build from previous commit succeeded."
    exit 1
fi

# ── Reload PM2 (zero-downtime) ──────────────────────────────────
echo "[4/4] Reloading PM2..."
pm2 reload "$APP_NAME" --update-env

# ── Health Check ─────────────────────────────────────────────────
echo "Running health check..."
sleep 5

HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:$PORT/health")

if [ "$HEALTH_STATUS" = "200" ]; then
    echo ""
    echo "=== Deploy SUCCESSFUL ==="
    echo "  Environment: $ENV"
    echo "  Commit:      $NEW_COMMIT"
    echo "  Health:      HTTP $HEALTH_STATUS"
    pm2 status
else
    echo ""
    echo "=== Health check FAILED (HTTP $HEALTH_STATUS) ==="
    echo "Rolling back to $PREV_COMMIT..."

    git checkout "$PREV_COMMIT"
    pnpm install --frozen-lockfile
    pnpm build
    pm2 reload "$APP_NAME" --update-env

    sleep 5
    ROLLBACK_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:$PORT/health")
    echo "  Rollback health: HTTP $ROLLBACK_STATUS"

    if [ "$ROLLBACK_STATUS" = "200" ]; then
        echo "  Rollback successful. App is running on previous commit."
    else
        echo "  CRITICAL: Rollback also failed! Manual intervention required."
    fi

    exit 1
fi
