#!/usr/bin/env python3
"""
Master import script: parse all PDFs and Excel, populate the SQLite database.

Usage: python import_data.py
"""

import os
import sys
import sqlite3

from db.init_db import init_db, get_connection
from parsers.pdf_parser import parse_all_pdfs
from parsers.excel_parser import parse_store_mapping

PDF_DIR = os.path.join(os.path.dirname(__file__), "P3W3 C180 C678 Vitamins")
EXCEL_FILE = os.path.join(PDF_DIR, "P3W2 C180 C678 Vitamins Store Mapping.xlsx")


def import_store_mappings(conn, mappings):
    """Insert store-planogram mappings into the database."""
    cursor = conn.cursor()
    for m in mappings:
        cursor.execute(
            """INSERT INTO store_planograms
               (store_id, planogram_dbkey, aisle, orientation, sequence,
                pog_status, live_date, pog_description)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                m["store_id"],
                m["planogram_dbkey"],
                m["aisle"],
                m["orientation"],
                m["sequence"],
                m["pog_status"],
                m["live_date"],
                m["pog_description"],
            ),
        )
    conn.commit()
    return len(mappings)


def import_planogram(conn, metadata, products, removed=None):
    """Insert a planogram and its products into the database."""
    cursor = conn.cursor()

    # Insert planogram metadata
    cursor.execute(
        """INSERT OR REPLACE INTO planograms
           (dbkey, name, description, effective_date, width_ft, height_inches,
            depth_inches, num_products, num_shelves, num_bays, category, pdf_filename)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            metadata["dbkey"],
            metadata.get("name", ""),
            metadata.get("description", ""),
            metadata.get("effective_date", ""),
            metadata.get("width_ft"),
            metadata.get("height_inches"),
            metadata.get("depth_inches"),
            metadata.get("num_products"),
            metadata.get("num_shelves"),
            metadata.get("num_bays"),
            metadata.get("category", ""),
            metadata.get("pdf_filename", ""),
        ),
    )

    # Insert products
    for p in products:
        cursor.execute(
            """INSERT INTO products
               (planogram_dbkey, bay, bay_width_ft, shelf, shelf_height_inches,
                position, upc, facings, is_new, is_changed, description, size,
                height_inches, width_inches, merch_style)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                metadata["dbkey"],
                p["bay"],
                p.get("bay_width_ft"),
                p["shelf"],
                p.get("shelf_height_inches"),
                p["position"],
                p["upc"],
                p["facings"],
                p["is_new"],
                p["is_changed"],
                p["description"],
                p["size"],
                p["height_inches"],
                p["width_inches"],
                p["merch_style"],
            ),
        )

    # Insert removed/deleted products
    if removed:
        for r in removed:
            cursor.execute(
                """INSERT INTO deleted_products
                   (planogram_dbkey, upc, description, size)
                   VALUES (?, ?, ?, ?)""",
                (
                    metadata["dbkey"],
                    r["upc"],
                    r.get("description", ""),
                    r.get("size", ""),
                ),
            )

    conn.commit()
    return len(products)


def validate(conn):
    """Run validation checks on the imported data."""
    cursor = conn.cursor()

    # Count tables
    cursor.execute("SELECT COUNT(*) FROM planograms")
    num_planograms = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM products")
    num_products = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM store_planograms")
    num_mappings = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(DISTINCT store_id) FROM store_planograms")
    num_stores = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(DISTINCT upc) FROM products")
    num_unique_upcs = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM deleted_products")
    num_deleted = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(DISTINCT upc) FROM deleted_products")
    num_deleted_upcs = cursor.fetchone()[0]

    print(f"\n{'=' * 50}")
    print(f"DATABASE SUMMARY")
    print(f"{'=' * 50}")
    print(f"Planograms:         {num_planograms}")
    print(f"Product positions:  {num_products}")
    print(f"Unique UPCs:        {num_unique_upcs}")
    print(f"Store mappings:     {num_mappings}")
    print(f"Unique stores:      {num_stores}")
    print(f"Deleted products:   {num_deleted}")
    print(f"Deleted unique UPCs:{num_deleted_upcs}")

    # Check for store mappings pointing to missing planograms
    cursor.execute(
        """SELECT DISTINCT sp.planogram_dbkey
           FROM store_planograms sp
           LEFT JOIN planograms p ON sp.planogram_dbkey = p.dbkey
           WHERE p.dbkey IS NULL"""
    )
    missing = cursor.fetchall()
    if missing:
        print(f"\nWARNING: {len(missing)} store mappings point to missing planograms:")
        for row in missing:
            print(f"  DBKey {row[0]}")
    else:
        print(f"\nAll store mappings have matching planograms.")

    # Spot check: store 00005
    cursor.execute(
        """SELECT sp.planogram_dbkey, p.name, p.category, p.num_products
           FROM store_planograms sp
           JOIN planograms p ON sp.planogram_dbkey = p.dbkey
           WHERE sp.store_id = '00005'"""
    )
    rows = cursor.fetchall()
    print(f"\nSpot check - Store 00005 planograms:")
    for row in rows:
        print(f"  DBKey {row[0]}: {row[1]} ({row[2]}) - {row[3]} products")

    return num_planograms, num_products, num_stores


def main():
    print("=" * 50)
    print("PLANOGRAM DATABASE IMPORT")
    print("=" * 50)

    # Step 1: Initialize database
    print("\n[1/4] Initializing database...")
    db_path = init_db(reset=True)
    print(f"  Database: {db_path}")

    conn = get_connection()

    # Step 2: Import store mappings
    print("\n[2/4] Importing store mappings...")
    mappings = parse_store_mapping(EXCEL_FILE)
    num_mappings = import_store_mappings(conn, mappings)
    print(f"  Imported {num_mappings} store-planogram mappings")

    # Step 3: Parse and import PDFs
    print("\n[3/4] Parsing PDFs...")
    results = parse_all_pdfs(PDF_DIR)

    total_products = 0
    total_expected = 0
    total_removed = 0
    mismatches = []
    for metadata, products, removed in results:
        num_imported = import_planogram(conn, metadata, products, removed)
        total_products += num_imported
        total_removed += len(removed)
        expected = metadata.get("num_products", 0)
        total_expected += expected
        if num_imported != expected:
            mismatches.append(
                (metadata["pdf_filename"], num_imported, expected)
            )

    print(f"\n  Total products imported: {total_products}")
    print(f"  Total expected:         {total_expected}")
    print(f"  Total removed/deleted:  {total_removed}")
    if mismatches:
        print(f"  Mismatches ({len(mismatches)}):")
        for fn, got, exp in mismatches:
            print(f"    {fn}: got {got}, expected {exp} (diff {got - exp})")
    else:
        print(f"  All PDFs parsed with exact product count match!")

    # Step 4: Validate
    print("\n[4/4] Validating...")
    validate(conn)

    conn.close()
    print(f"\nDone! Database saved to {db_path}")


if __name__ == "__main__":
    main()
