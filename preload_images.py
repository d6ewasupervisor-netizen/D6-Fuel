#!/usr/bin/env python3
"""
Download product images from Kroger API and store locally for instant loading.

Usage:
    python preload_images.py                # Download all images
    python preload_images.py --limit 10     # Download first 10 only (testing)
    python preload_images.py --delay 0.5    # Faster (risk rate limits)
"""

import os
import sys
import time
import argparse
import sqlite3

import httpx
from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.path.join(os.path.dirname(__file__), "db", "planograms.db")
IMAGE_DIR = os.path.join(os.path.dirname(__file__), "static", "images", "products")

# Reuse auth and API logic from the app
from app.kroger_api import get_product_image, _get_token


def get_unique_upcs():
    """Get all unique UPCs from the products table."""
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT DISTINCT upc FROM products ORDER BY upc").fetchall()
    conn.close()
    return [r[0] for r in rows]


def download_image(url, filepath):
    """Download an image from a URL and save to filepath. Returns True on success."""
    try:
        resp = httpx.get(url, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if not content_type.startswith("image/") or len(resp.content) < 100:
            return False
        with open(filepath, "wb") as f:
            f.write(resp.content)
        return True
    except Exception:
        return False


def preload(delay=1.0, limit=0):
    """Main preload loop: fetch image URLs and download files."""
    # Verify credentials early
    token = _get_token()
    if not token:
        print("ERROR: Kroger API credentials not configured.")
        print("Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET in your .env file.")
        sys.exit(1)

    os.makedirs(IMAGE_DIR, exist_ok=True)

    upcs = get_unique_upcs()
    total = len(upcs)
    if limit > 0:
        upcs = upcs[:limit]
        total_to_process = limit
    else:
        total_to_process = total

    # Count already downloaded
    already = sum(1 for upc in upcs if os.path.isfile(os.path.join(IMAGE_DIR, f"{upc}.jpg")))

    print(f"Found {total} unique UPCs in database")
    print(f"Processing: {total_to_process}")
    print(f"Already downloaded: {already}")
    print(f"Remaining: {total_to_process - already}")
    print(f"Delay between API calls: {delay}s")
    print()

    downloaded = 0
    no_image = 0
    errors = 0
    skipped = 0
    start_time = time.time()

    for i, upc in enumerate(upcs, 1):
        filepath = os.path.join(IMAGE_DIR, f"{upc}.jpg")

        # Skip if already downloaded
        if os.path.isfile(filepath):
            skipped += 1
            continue

        # Get image URL from Kroger API (uses cache + auto-refreshes token)
        try:
            image_url = get_product_image(upc)
        except Exception as e:
            print(f"  [{i}/{total_to_process}] {upc} ... API error: {e}")
            errors += 1
            time.sleep(delay)
            continue

        if not image_url:
            print(f"  [{i}/{total_to_process}] {upc} ... no image available")
            no_image += 1
            time.sleep(delay)
            continue

        # Download the actual image file
        if download_image(image_url, filepath):
            size_kb = os.path.getsize(filepath) / 1024
            print(f"  [{i}/{total_to_process}] {upc} ... downloaded ({size_kb:.1f} KB)")
            downloaded += 1
        else:
            print(f"  [{i}/{total_to_process}] {upc} ... download failed")
            errors += 1

        # Rate limit
        time.sleep(delay)

    elapsed = time.time() - start_time
    minutes = int(elapsed // 60)
    seconds = int(elapsed % 60)

    print()
    print("=" * 40)
    print("SUMMARY")
    print("=" * 40)
    print(f"Downloaded: {downloaded}")
    print(f"No image:   {no_image}")
    print(f"Errors:     {errors}")
    print(f"Skipped:    {skipped} (already existed)")
    print(f"Total time: {minutes}m {seconds}s")


def main():
    parser = argparse.ArgumentParser(description="Preload Kroger product images locally")
    parser.add_argument("--delay", type=float, default=1.0,
                        help="Seconds between API calls (default: 1.0)")
    parser.add_argument("--limit", type=int, default=0,
                        help="Max UPCs to process, 0 = all (default: 0)")
    args = parser.parse_args()

    print("=" * 40)
    print("KROGER IMAGE PRELOAD")
    print("=" * 40)
    print()

    preload(delay=args.delay, limit=args.limit)


if __name__ == "__main__":
    main()
