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

echo "Starting Supplemental Intelligence..."
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-2}" \
    --proxy-headers \
    --forwarded-allow-ips "*"
