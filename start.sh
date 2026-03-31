#!/bin/bash
set -e

DATA_DIR="${DATA_DIR:-}"

if [ -n "$DATA_DIR" ]; then
    echo "=== Volume mount detected at $DATA_DIR ==="

    # Seed database from Docker image on first deploy
    if [ ! -f "$DATA_DIR/planograms.db" ]; then
        echo "First deploy — seeding database to volume..."
        cp /app/db/planograms.db "$DATA_DIR/planograms.db"
    fi

    # Symlink DB so the app's default path resolves to the volume
    ln -sf "$DATA_DIR/planograms.db" /app/db/planograms.db

    # Persistent directory for Kroger-fetched product images
    mkdir -p "$DATA_DIR/products"
    ln -sfn "$DATA_DIR/products" /app/static/images/products

    echo "=== Volume ready ==="
fi

# --- Schema migrations (safe to re-run every deploy) ---
echo "Running schema migrations..."
DB_FILE="${DATA_DIR:+$DATA_DIR/planograms.db}"
DB_FILE="${DB_FILE:-/app/db/planograms.db}"
sqlite3 "$DB_FILE" "ALTER TABLE user_sessions ADD COLUMN user_agent TEXT;" 2>/dev/null || true
sqlite3 "$DB_FILE" "ALTER TABLE user_sessions ADD COLUMN screen_width INTEGER;" 2>/dev/null || true
sqlite3 "$DB_FILE" "ALTER TABLE user_sessions ADD COLUMN screen_height INTEGER;" 2>/dev/null || true
sqlite3 "$DB_FILE" "ALTER TABLE user_sessions ADD COLUMN device_type TEXT;" 2>/dev/null || true
sqlite3 "$DB_FILE" "ALTER TABLE user_activity ADD COLUMN view_name TEXT;" 2>/dev/null || true
sqlite3 "$DB_FILE" "ALTER TABLE user_activity ADD COLUMN duration_ms INTEGER;" 2>/dev/null || true
sqlite3 "$DB_FILE" "ALTER TABLE user_activity ADD COLUMN meta TEXT;" 2>/dev/null || true
echo "Migrations complete."

echo "Starting Supplemental Intelligence..."
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-2}" \
    --proxy-headers \
    --forwarded-allow-ips "*"