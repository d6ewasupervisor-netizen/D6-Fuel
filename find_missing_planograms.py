#!/usr/bin/env python3
"""
Find which planogram PDFs contain the still-missing product images.
Solves the set-cover problem: fewest PDFs to get all remaining UPCs.

Usage:
    python find_missing_planograms.py
    python find_missing_planograms.py --db path/to/planograms.db
"""

import sqlite3
import os
import sys
import argparse
from collections import defaultdict


# ── All 24 UPCs missing product images ────────────────────────────
STILL_MISSING = [
    "0002188830231",  # RNBW KIDS ONE MLTVTMN TBL
    "0003367415940",  # NTWY OMEGA 3 GMM CHEW
    "0004126002608",  # ST SAM-E 400MG
    "0004126002659",  # KRO BRAIN SUPPORT GUMMY
    "0004746908541",  # NTRL ULTRA SLEEP F/D TAB
    "0009070003379",  # HPHA LIONS MANE W/ REISHI
    "0070587580218",  # BRLN VGN OMEG FLX ALG OIL
    "0070619510606",  # OWHV ASTRAGALUS ORGANIC
    "0070619510607",  # OWH WLD HRVST ASHWGNDHA
    "0070619510610",  # OWH WLD HRVST MLK THSTL
    "0070619517049",  # OWHV ASHWAGANDHA BDYNMC
    "0073373901283",  # NOW MAGNSMCPS 400 MG 180
    "0081012666067",  # FRCFCTR ULT BRBRN CAP
    "0081012666129",  # FRC FCTR MAG GLYC PWDR
    "0081012666196",  # FRCFCTR AMZ ASHW COMP
    "0081012666199",  # FRC FCTR TOTAL BEETS CHWS
    "0081012666245",  # FRCFCTR LIPSOMAL GUMMIES
    "0081012666272",  # FRC FCTR HAIR GRWTH CHWS
    "0081012666296",  # FRC FCTR HAIR GRWTH CAPS
    "0081012666308",  # FRCFCTR MORINGA POWDER
    "0081012666310",  # FRC FCTR MTCHA SFT CHEWS
    "0081012666315",  # FRC FCTR MGHTY MTCHA
    "0081859401546",  # FRCFCTR TOTAL BEETS POWDR
    "0084009312863",  # NTRS TRTH BEET ROOT CHWS
    "0084009312867",  # NTRS TRTH MLTN MAGN CHWS
    "0084009312920",  # NTRS TRTH MAGNSM CHEWS
    "0085005976768",  # NELLO SPR BAL CRN APL DR
    "0085006858575",  # NCLL MLTI CLL RSE VIAL
    "0085007479028",  # NAT VTY MGNSM THRNATE
    "0085664500847",  # MRYRTHS ORG ADRN FCS LQ
    "0086000455530",  # PYM ORIGINAL MD CHEW SUPP
    "0086000455532",  # PYM ORGNL MOOD CHEWS SUPP
    "0542501039183",  # NATF BIOSIL SKIN/HAIR/NLS
]


def find_db(start_dir=None):
    """Locate planograms.db relative to script or cwd."""
    candidates = [
        os.path.join(start_dir or ".", "db", "planograms.db"),
        os.path.join(start_dir or ".", "planograms.db"),
        os.path.join(os.path.dirname(__file__), "db", "planograms.db"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


def greedy_set_cover(upc_set, pdf_upc_map):
    """
    Greedy set cover: pick the PDF that covers the most uncovered UPCs,
    repeat until all are covered.
    """
    remaining = set(upc_set)
    chosen = []

    while remaining:
        best_pdf = None
        best_covered = set()

        for pdf, upcs in pdf_upc_map.items():
            covered = remaining & upcs
            if len(covered) > len(best_covered):
                best_covered = covered
                best_pdf = pdf

        if not best_pdf or not best_covered:
            break

        chosen.append((best_pdf, best_covered))
        remaining -= best_covered

    return chosen, remaining


def main():
    ap = argparse.ArgumentParser(description="Find planogram PDFs for missing UPCs")
    ap.add_argument("--db", help="Path to planograms.db")
    args = ap.parse_args()

    db_path = args.db or find_db()
    if not db_path or not os.path.isfile(db_path):
        print("ERROR: planograms.db not found.")
        print("  Run from your project root, or pass --db path/to/planograms.db")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    placeholders = ",".join("?" * len(STILL_MISSING))

    # ── 1. Get all product records for these UPCs ──────────────────
    rows = conn.execute(f"""
        SELECT p.upc, p.description, p.size, p.bay, p.shelf, p.position,
               p.facings, p.is_new, p.is_changed,
               pg.dbkey, pg.name AS planogram_name, pg.category, pg.pdf_filename
        FROM products p
        JOIN planograms pg ON p.planogram_dbkey = pg.dbkey
        WHERE p.upc IN ({placeholders})
        ORDER BY p.upc, pg.pdf_filename, p.bay, p.shelf, p.position
    """, STILL_MISSING).fetchall()

    if not rows:
        print("No matching products found in the database.")
        conn.close()
        sys.exit(1)

    # ── 2. Map: PDF filename → set of missing UPCs it contains ────
    pdf_upc_map = defaultdict(set)       # pdf_filename → {upcs}
    pdf_info = {}                         # pdf_filename → planogram_name
    upc_details = {}                      # upc → {desc, size, locations: [...]}

    for r in rows:
        pdf = r["pdf_filename"]
        upc = r["upc"]

        pdf_upc_map[pdf].add(upc)
        pdf_info[pdf] = f"{r['planogram_name']} ({r['category']})"

        if upc not in upc_details:
            upc_details[upc] = {
                "desc": r["description"],
                "size": r["size"],
                "locations": [],
            }
        upc_details[upc]["locations"].append({
            "pdf": pdf,
            "planogram": r["planogram_name"],
            "bay": r["bay"],
            "shelf": r["shelf"],
            "pos": r["position"],
            "facings": r["facings"],
            "new": r["is_new"],
            "changed": r["is_changed"],
        })

    conn.close()

    # ── 3. Solve set cover ────────────────────────────────────────
    target_set = set(STILL_MISSING)
    found_set = set(upc_details.keys())
    not_in_db = target_set - found_set

    chosen, uncovered = greedy_set_cover(found_set & target_set, pdf_upc_map)

    # ── 4. Print results ──────────────────────────────────────────
    print()
    print("=" * 80)
    print("  MISSING IMAGE PLANOGRAM FINDER")
    print("=" * 80)
    print(f"  Target UPCs:      {len(STILL_MISSING)}")
    print(f"  Found in DB:      {len(found_set & target_set)}")
    if not_in_db:
        print(f"  NOT in DB:        {len(not_in_db)}")
    print(f"  PDFs with hits:   {len(pdf_upc_map)}")
    print(f"  Minimum PDFs:     {len(chosen)}")
    print("=" * 80)

    # ── Best-case extraction plan ─────────────────────────────────
    print()
    print("─" * 80)
    print("  EXTRACTION PLAN (fewest PDFs needed)")
    print("─" * 80)

    for i, (pdf, covered_upcs) in enumerate(chosen, 1):
        pname = pdf_info.get(pdf, "")
        print(f"\n  PDF {i}: {pdf}")
        print(f"         {pname}")
        print(f"         Covers {len(covered_upcs)} UPCs:")
        for upc in sorted(covered_upcs):
            d = upc_details[upc]
            loc = next(l for l in d["locations"] if l["pdf"] == pdf)
            flags = ""
            if loc["new"]:
                flags += " [NEW]"
            if loc["changed"]:
                flags += " [CHG]"
            print(f"           {upc}  B{loc['bay']} S{loc['shelf']} P{loc['pos']}  "
                  f"F{loc['facings']}  {d['desc']}{flags}")

    # ── Full detail per UPC ───────────────────────────────────────
    print()
    print("─" * 80)
    print("  FULL DETAIL PER UPC (all planograms containing each)")
    print("─" * 80)

    for upc in sorted(upc_details.keys()):
        d = upc_details[upc]
        print(f"\n  {upc}  {d['desc']}  {d['size']}")
        for loc in d["locations"]:
            flags = ""
            if loc["new"]:
                flags += " [NEW]"
            if loc["changed"]:
                flags += " [CHG]"
            print(f"    → {loc['pdf']}")
            print(f"      {loc['planogram']}  B{loc['bay']} S{loc['shelf']} P{loc['pos']}  "
                  f"F{loc['facings']}{flags}")

    # ── UPCs not found at all ─────────────────────────────────────
    if not_in_db:
        print()
        print("─" * 80)
        print(f"  NOT FOUND IN DATABASE ({len(not_in_db)} UPCs)")
        print("─" * 80)
        for upc in sorted(not_in_db):
            print(f"    {upc}")

    if uncovered:
        print()
        print("─" * 80)
        print(f"  UNCOVERED BY ANY PDF ({len(uncovered)} UPCs)")
        print("─" * 80)
        for upc in sorted(uncovered):
            print(f"    {upc}")

    # ── Command to run ────────────────────────────────────────────
    if chosen:
        print()
        print("─" * 80)
        print("  RUN THIS TO EXTRACT:")
        print("─" * 80)
        pdf_args = " ".join(f'"{pdf}"' for pdf, _ in chosen)
        print(f'  python extract_pdf_images.py {pdf_args} --only-missing --output .\\extracted')
    print()
    print("=" * 80)


if __name__ == "__main__":
    main()
