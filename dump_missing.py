#!/usr/bin/env python3
"""Dump full product details for items missing images."""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "db", "planograms.db")

MISSING_UPCS = [
    "0003367415940",
    "0004126002608",
    "0004126002659",
    "0009070003379",
    "0070619510606",
    "0070619510607",
    "0070619510610",
    "0073373901283",
    "0081012666067",
    "0081012666129",
    "0081012666196",
    "0081012666272",
    "0081012666296",
    "0081012666308",
    "0081012666310",
    "0081012666315",
    "0084009312863",
    "0084009312867",
    "0084009312920",
    "0085005976768",
    "0085006858575",
    "0085007479028",
    "0086000455532",
    "0542501039183",
]

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

# Get full product names if available
name_cache = {}
try:
    rows = conn.execute("SELECT upc, full_name FROM product_descriptions").fetchall()
    name_cache = {r["upc"]: r["full_name"] for r in rows if r["full_name"]}
except Exception:
    pass

placeholders = ",".join("?" * len(MISSING_UPCS))

products = conn.execute(f"""
    SELECT p.*, pg.name as planogram_name, pg.category, pg.pdf_filename
    FROM products p
    JOIN planograms pg ON p.planogram_dbkey = pg.dbkey
    WHERE p.upc IN ({placeholders})
    ORDER BY p.upc, p.planogram_dbkey, p.bay, p.shelf, p.position
""", MISSING_UPCS).fetchall()

print("=" * 120)
print(f"  MISSING IMAGE PRODUCTS — {len(MISSING_UPCS)} UPCs, {len(products)} total positions")
print("=" * 120)
print()

current_upc = None
for p in products:
    if p["upc"] != current_upc:
        current_upc = p["upc"]
        full_name = name_cache.get(p["upc"], "")
        print(f"{'─' * 120}")
        print(f"  UPC: {p['upc']}   DESC: {p['description']}   SIZE: {p['size']}")
        if full_name:
            print(f"  FULL NAME: {full_name}")
        print()

    flags = []
    if p["is_new"]:
        flags.append("NEW")
    if p["is_changed"]:
        flags.append("CHANGED")
    flag_str = f"  [{', '.join(flags)}]" if flags else ""

    print(f"    Planogram: {p['planogram_name']} ({p['category']})  |  PDF: {p['pdf_filename']}")
    print(f"    Bay {p['bay']} (W:{p['bay_width_ft']}ft)  Shelf {p['shelf']} (H:{p['shelf_height_inches']}in)  "
          f"Pos {p['position']}  Facings: {p['facings']}  "
          f"Dims: {p['height_inches']}\"H x {p['width_inches']}\"W  "
          f"Style: {p['merch_style']}{flag_str}")
    print()

# Also check deleted products
deleted = conn.execute(f"""
    SELECT dp.*, pg.name as planogram_name, pg.category
    FROM deleted_products dp
    JOIN planograms pg ON dp.planogram_dbkey = pg.dbkey
    WHERE dp.upc IN ({placeholders})
    ORDER BY dp.upc
""", MISSING_UPCS).fetchall()

if deleted:
    print(f"\n{'=' * 120}")
    print(f"  ALSO IN DELETED LIST — {len(deleted)} entries")
    print(f"{'=' * 120}")
    for d in deleted:
        print(f"  {d['upc']}  {d['description']}  {d['size']}  [{d['planogram_name']}]")

# Store mapping
store_info = conn.execute(f"""
    SELECT DISTINCT sp.store_id, sp.aisle, sp.orientation, sp.planogram_dbkey, pg.name, pg.category
    FROM store_planograms sp
    JOIN planograms pg ON sp.planogram_dbkey = pg.dbkey
    JOIN products p ON p.planogram_dbkey = pg.dbkey
    WHERE p.upc IN ({placeholders})
    ORDER BY sp.store_id, pg.category
""", MISSING_UPCS).fetchall()

unique_stores = set(r["store_id"] for r in store_info)
print(f"\n{'=' * 120}")
print(f"  APPEARS IN {len(unique_stores)} STORES")
print(f"{'=' * 120}")

# CSV-friendly output
print(f"\n\n{'=' * 120}")
print("  CSV FORMAT (for spreadsheet)")
print(f"{'=' * 120}")
print("UPC,Description,Full Name,Size,Bay,Shelf,Position,Facings,Height_in,Width_in,Merch_Style,Is_New,Is_Changed,Category,Planogram")
for p in products:
    full_name = name_cache.get(p["upc"], "").replace(",", ";")
    desc = (p["description"] or "").replace(",", ";")
    print(f'{p["upc"]},{desc},{full_name},{p["size"]},{p["bay"]},{p["shelf"]},{p["position"]},'
          f'{p["facings"]},{p["height_inches"]},{p["width_inches"]},{p["merch_style"]},'
          f'{1 if p["is_new"] else 0},{1 if p["is_changed"] else 0},{p["category"]},{p["planogram_name"]}')

conn.close()
