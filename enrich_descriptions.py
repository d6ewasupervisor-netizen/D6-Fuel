#!/usr/bin/env python3
"""
Fetch full consumer-facing product names from Kroger API and cache locally.

Uses batch API calls (50 UPCs per request) to minimize API usage.
With ~1,247 unique UPCs, this needs only ~25 API calls.

Usage:
    python enrich_descriptions.py --location 70100351          # Use specific store
    python enrich_descriptions.py --zip 99016                  # Find stores by zip
    python enrich_descriptions.py --flush --location 70100351  # Retry empty results
    python enrich_descriptions.py --limit 10                   # Test with small batch
"""

import os
import sys
import time
import argparse
import sqlite3

from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.path.join(os.path.dirname(__file__), "db", "planograms.db")

BATCH_SIZE = 50  # Kroger API max for filter.productId

from app.kroger_api import (
    get_product_descriptions_batch,
    _get_token,
    _get_location_id,
    lookup_location_by_zip,
)


def ensure_table():
    """Create product_descriptions table if it doesn't exist."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS product_descriptions ("
        "upc TEXT PRIMARY KEY, full_name TEXT, fetched_at TEXT)"
    )
    conn.commit()
    conn.close()


def get_unique_upcs():
    """Get all unique UPCs from the products table."""
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT DISTINCT upc FROM products ORDER BY upc").fetchall()
    conn.close()
    return [r[0] for r in rows]


def get_cached_upcs():
    """Get UPCs that already have a cached description."""
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT upc FROM product_descriptions").fetchall()
    conn.close()
    return set(r[0] for r in rows)


def flush_empty_cache():
    """Remove cached entries with empty names so they can be retried."""
    conn = sqlite3.connect(DB_PATH)
    deleted = conn.execute(
        "DELETE FROM product_descriptions WHERE full_name = ''"
    ).rowcount
    conn.commit()
    conn.close()
    return deleted


def find_store_by_zip(zip_code):
    """Look up Kroger stores by zip code and let user pick one."""
    print(f"Looking up Kroger stores near {zip_code}...")
    locations = lookup_location_by_zip(zip_code)

    if not locations:
        print("No stores found. Check your zip code and API credentials.")
        return None

    print(f"\nFound {len(locations)} stores:\n")
    for i, loc in enumerate(locations, 1):
        print(f"  {i}. {loc['name']}")
        print(f"     Location ID: {loc['locationId']}  (div {loc['divisionNumber']}, store {loc['storeNumber']})")
        print(f"     {loc['address']}")
        print()

    while True:
        try:
            choice = input(f"Select a store (1-{len(locations)}), or 'q' to quit: ").strip()
            if choice.lower() == "q":
                return None
            idx = int(choice) - 1
            if 0 <= idx < len(locations):
                selected = locations[idx]
                print(f"\nUsing: {selected['name']} ({selected['locationId']})")
                return selected["locationId"]
        except (ValueError, EOFError):
            pass
        print("Invalid choice, try again.")


def enrich(delay=1.0, limit=0):
    """Main enrichment loop: fetch full names in batches."""
    token = _get_token()
    if not token:
        print("ERROR: Kroger API credentials not configured.")
        print("Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET in your .env file.")
        sys.exit(1)

    location_id = _get_location_id()
    if location_id:
        print(f"Using Kroger location ID: {location_id}")
    else:
        print("WARNING: No KROGER_LOCATION_ID set. The API may return no results.")
        print("         Use --location 70100351 or --zip 99016 to set one.")
        print()

    all_upcs = get_unique_upcs()
    total_in_db = len(all_upcs)

    if limit > 0:
        all_upcs = all_upcs[:limit]

    # Filter out UPCs that already have a cached description
    cached = get_cached_upcs()
    upcs_to_process = [upc for upc in all_upcs if upc not in cached]
    already = len(all_upcs) - len(upcs_to_process)

    num_batches = (len(upcs_to_process) + BATCH_SIZE - 1) // BATCH_SIZE if upcs_to_process else 0

    print(f"Found {total_in_db} unique UPCs in database")
    print(f"Processing: {len(all_upcs)}")
    print(f"Already cached: {already}")
    print(f"Remaining: {len(upcs_to_process)}")
    print(f"API batches needed: {num_batches} (50 UPCs per batch)")
    print(f"Delay between batches: {delay}s")
    print()

    if not upcs_to_process:
        print("Nothing to do!")
        return

    enriched = 0
    not_found = 0
    errors = 0
    start_time = time.time()

    for batch_idx in range(0, len(upcs_to_process), BATCH_SIZE):
        batch = upcs_to_process[batch_idx : batch_idx + BATCH_SIZE]
        batch_num = batch_idx // BATCH_SIZE + 1

        print(f"[Batch {batch_num}/{num_batches}] Fetching {len(batch)} UPCs from Kroger API...")

        name_map = get_product_descriptions_batch(batch)

        if not name_map:
            print(f"  API call failed, skipping batch")
            errors += len(batch)
            time.sleep(delay)
            continue

        for upc in batch:
            full_name = name_map.get(upc, "")
            if full_name:
                print(f"  {upc} -> {full_name}")
                enriched += 1
            else:
                not_found += 1

        # Rate limit between batches
        if batch_idx + BATCH_SIZE < len(upcs_to_process):
            time.sleep(delay)

    elapsed = time.time() - start_time
    minutes = int(elapsed // 60)
    seconds = int(elapsed % 60)

    print()
    print("=" * 40)
    print("SUMMARY")
    print("=" * 40)
    print(f"Enriched:   {enriched}")
    print(f"Not found:  {not_found}")
    print(f"Errors:     {errors}")
    print(f"Skipped:    {already} (already cached)")
    print(f"Total time: {minutes}m {seconds}s")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch full product names from Kroger API"
    )
    parser.add_argument(
        "--delay", type=float, default=1.0,
        help="Seconds between batch API calls (default: 1.0)",
    )
    parser.add_argument(
        "--limit", type=int, default=0,
        help="Max UPCs to process, 0 = all (default: 0)",
    )
    parser.add_argument(
        "--flush", action="store_true",
        help="Clear cached empty results before running (retry previously missing names)",
    )
    parser.add_argument(
        "--location", type=str, default="",
        help="Kroger location ID (8-digit: division + store, e.g. 70100351)",
    )
    parser.add_argument(
        "--zip", type=str, default="",
        help="Look up Kroger stores by zip code to find location ID",
    )
    args = parser.parse_args()

    print("=" * 40)
    print("KROGER PRODUCT NAME ENRICHMENT")
    print("=" * 40)
    print()

    ensure_table()

    # Verify credentials before anything else
    token = _get_token()
    if not token:
        print("ERROR: Kroger API credentials not configured.")
        print("Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET in your .env file.")
        sys.exit(1)

    # Handle location ID: --location flag > --zip lookup > env var
    if args.location:
        os.environ["KROGER_LOCATION_ID"] = args.location
        print(f"Location ID set to: {args.location}")
        print()
    elif args.zip:
        location_id = find_store_by_zip(args.zip)
        if not location_id:
            print("No store selected, exiting.")
            sys.exit(0)
        os.environ["KROGER_LOCATION_ID"] = location_id
        print()

    if args.flush:
        deleted = flush_empty_cache()
        print(f"Flushed {deleted} empty cache entries")
        print()

    enrich(delay=args.delay, limit=args.limit)


if __name__ == "__main__":
    main()
