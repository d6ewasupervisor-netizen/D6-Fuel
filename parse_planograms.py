"""
Parse Kroger fuel cooler planogram PDFs to extract shelf-position data.

Each PDF contains:
- Page 1: Metadata (name, DBKey, dimensions, counts)
- Page 2+: Product adds/removes/changes
- Final pages: Bay-Fixture-Position data with product details

Outputs planograms.json with full bay/shelf/position hierarchy,
merging full_name and image paths from existing products.json.
"""

import re
import os
import json
import glob
import pdfplumber

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Map PDF description keywords to section keys used in products.json
SECTION_KEY_MAP = {
    "GDM 9- CSD": "GDM 9 - CSD",
    "GDM 9- ALL BEVERAGE": "GDM 9 - All Beverage",
    "HABCO MONSTER COOLER 12 FT ASSORTMENT": "HABCO Monster Cooler 12 FT",
    "HABCO MONSTER COOLER 8 FT ASSORTMENT": "HABCO Monster Cooler 8 FT",
    "HABCO- RED BULL COOLER 12 FT ASSORTMENT": "HABCO Red Bull Cooler 12 FT",
    "HABCO- RED BULL COOLER 8 FT ASSORTMENT": "HABCO Red Bull Cooler 8 FT",
}

# Section header: "Bay 1 - 2 ft 7.75 in wide Shelf 3 - 25.00 inches from Base Shelf"
# Also handles base shelf variant: "Bay 1 - 2 ft 7.75 in wide Shelf 1 - 4.50 Base Shelf"
SECTION_HEADER_RE = re.compile(
    r"Bay\s+(\d+)\s*-\s*"
    r"(\d+)\s*ft\s+([\d.]+)\s*in\s+wide\s+"
    r"Shelf\s+(\d+)\s*-\s*([\d.]+)\s*"
    r"(?:inches from Base Shelf|Base Shelf)"
)

# Product line: UPC(13 digits) Facings(1-2 digits) [NEW|CHANGE] Description Size Height in Width in MerchStyle [TEST -TEST]
PRODUCT_RE = re.compile(
    r"(\d{10,14})\s+"           # UPC
    r"(\d{1,2})\s+"             # Facings
    r"(NEW\s+|CHANGE\s+)?"      # Optional NEW/CHANGE flag
    r"(.+?)\s+"                 # Description + size (non-greedy)
    r"(\d+\.?\d*)\s+in\s+"      # Height inches
    r"(\d+\.?\d*)\s+in\s+"      # Width inches
    r"(\w+)"                    # Merch style
)

SKIP_PATTERNS = [
    "Effective Date:",
    "Period Week:",
    "Bay #",
    "Bay - Fixture - Position Information",
    "Property of The Kroger Co",
    "Date PDF Created:",
    "Products Added",
    "Products Removed",
    "Products Changed",
    "UPC Change From",
    "UPC Product Size",
    "Page:",
    "D701_L00000",
    "Note: Measurement",
    "DBKey:",
    "HABCO - ESM",
    "GDM-9-LD",
]


def _is_skip_line(line):
    stripped = line.strip()
    if not stripped:
        return True
    if any(stripped.startswith(p) for p in SKIP_PATTERNS):
        return True
    # Lines that are just numbers and spaces (visual diagram labels)
    if re.match(r"^[\d\s]+$", stripped) and len(stripped) < 60:
        return True
    # Dimension lines like "8.5 in", "15 in", "1 ft 10 in"
    if re.match(r"^[\d.]+\s*(in|ft)(\s+[\d.]+\s*(in|ft))?$", stripped):
        return True
    # Tab-separated dimension pairs like "2 ft 7.75 in\t2 ft 7.75 in"
    if re.match(r"^\d+\s*ft\s+[\d.]+\s*in\t", stripped):
        return True
    # Tab-separated dimension pairs like "1 ft 10 in\t1 ft 10 in"
    if re.match(r"^\d+\s*ft\s+\d+\s*in\t", stripped):
        return True
    return False


def parse_metadata(pdf):
    """Extract planogram metadata from page 1."""
    text = pdf.pages[0].extract_text()
    if not text:
        return None

    metadata = {}

    m = re.search(r"Effective Date:\s*(.+)", text)
    if m:
        metadata["effective_date"] = m.group(1).strip()

    m = re.search(r"Period Week:\s*(.+)", text)
    if m:
        metadata["period_week"] = m.group(1).strip()

    # Full planogram name line
    for line in text.split("\n"):
        if line.strip().startswith("D701_"):
            parts = line.strip().split(" - ", 1)
            metadata["name"] = parts[0].strip()
            metadata["description"] = parts[1].strip() if len(parts) > 1 else ""
            break

    m = re.search(r"DBKey:\s*(\d+)", text)
    if m:
        metadata["dbkey"] = int(m.group(1))

    # Dimensions - fuel PDFs use "X ft Y.YY in" for width, "N Inches" for height/depth
    # The order in page 1 text is: depth, height, width (matching label order below)
    inches_vals = re.findall(r"(\d+)\s+Inches", text)
    if len(inches_vals) >= 2:
        metadata["depth_inches"] = int(inches_vals[0])
        metadata["height_inches"] = int(inches_vals[1])

    width_m = re.search(r"(\d+)\s*ft\s+([\d.]+)\s*in", text)
    if width_m:
        metadata["width_ft"] = int(width_m.group(1))
        metadata["width_extra_inches"] = float(width_m.group(2))
        metadata["width_inches"] = int(width_m.group(1)) * 12 + float(width_m.group(2))

    m = re.search(r"Number of Products:\s*\n\s*(\d+)", text)
    if not m:
        # Try extracting from the raw text structure
        lines = text.split("\n")
        for i, line in enumerate(lines):
            if "Number of Products:" in line and i > 0:
                # Product count is on a previous line in the extracted text
                break

    m = re.search(r"Number of Shelves:\s*\n\s*(\d+)", text)

    # Parse counts from the structured text at the top
    lines = text.split("\n")
    # In the fuel PDFs, the counts appear as standalone numbers near the top
    # Line 3 (0-indexed) = num_shelves, Line 4 = num_products based on observed patterns
    clean_lines = [l.strip() for l in lines if l.strip()]
    if len(clean_lines) >= 4:
        try:
            metadata["num_shelves"] = int(clean_lines[2])
            metadata["num_products"] = int(clean_lines[3])
        except ValueError:
            pass

    # Fixture type
    if "GDM-9-LD" in text:
        metadata["fixture_type"] = "GDM-9-LD"
    elif "HABCO - ESM46" in text or "HABCO" in text:
        metadata["fixture_type"] = "HABCO-ESM46"

    # Bay count from position pages
    for page in pdf.pages[2:]:
        pt = page.extract_text()
        if pt:
            bm = re.search(r"Bay\s*#\s*\d+\s+of\s+(\d+)", pt)
            if bm:
                metadata["num_bays"] = int(bm.group(1))
                break

    return metadata


def _determine_section_key(metadata):
    """Map planogram description to the products.json section key."""
    desc = metadata.get("description", "")
    for pdf_desc, section_key in SECTION_KEY_MAP.items():
        if pdf_desc in desc:
            return section_key
    return desc


def _split_desc_size(desc_and_size):
    """Split combined description+size string into (description, size).

    Fuel products use sizes like: 20 FO, 16 FO, 12 FO, 8.4 FO, 13.7 FO,
    4PK 4/16 FO, 12PK 12/16..., 4PK 4/15...., 12PK 12/8...., 4/16 FO, 4/12 FO
    """
    # Try structured size patterns first (most specific to least)
    size_patterns = [
        # Multi-pack with truncation: "12PK 12/16..." or "4PK 4/15...."
        r"\s+(\d+PK\s+[\d/]+\.{2,4})\s*$",
        # Multi-pack with FO: "4PK 4/16 FO" or "4PK 4/12 FO"
        r"\s+(\d+PK\s+[\d/]+\s+FO)\s*$",
        # Fraction with FO: "4/16 FO", "4/12 FO"
        r"\s+(\d+/[\d.]+\s+FO)\s*$",
        # Simple with FO: "20 FO", "8.4 FO", "15.5 FO"
        r"\s+([\d.]+\s+FO)\s*$",
        # Truncated sizes: "12PK 12/8...."
        r"\s+(\d+PK\s+\d+/[\d.]+\.{2,4})\s*$",
    ]

    for pattern in size_patterns:
        m = re.search(pattern, desc_and_size, re.IGNORECASE)
        if m:
            return desc_and_size[:m.start()].strip(), m.group(1).strip()

    return desc_and_size.strip(), ""


def parse_products(pdf):
    """Extract all product positions from position pages."""
    products = []
    current_bay = 0
    current_shelf = 0
    current_bay_width_inches = 22.0
    current_shelf_height = 0.0
    position_counter = 0

    # Find first page with position data
    start_page = None
    for i, page in enumerate(pdf.pages):
        text = page.extract_text()
        if text and "Bay - Fixture - Position Information" in text:
            start_page = i
            break
    if start_page is None:
        return products

    for page_idx in range(start_page, len(pdf.pages)):
        text = pdf.pages[page_idx].extract_text()
        if not text:
            continue

        for line in text.split("\n"):
            stripped = line.strip()

            # Check for section header
            header_match = SECTION_HEADER_RE.search(stripped)
            if header_match:
                current_bay = int(header_match.group(1))
                ft = int(header_match.group(2))
                extra_in = float(header_match.group(3))
                current_bay_width_inches = ft * 12 + extra_in
                current_shelf = int(header_match.group(4))
                current_shelf_height = float(header_match.group(5))
                position_counter = 0
                continue

            # Skip "Bay Fi..." header lines
            if "Bay Fi..." in stripped or "BayFi..." in stripped:
                continue

            if _is_skip_line(stripped):
                continue

            # Try to match a product
            match = PRODUCT_RE.search(stripped)
            if not match:
                continue

            upc = match.group(1)
            facings = int(match.group(2))
            flag = (match.group(3) or "").strip()
            desc_and_size_raw = match.group(4)
            height = float(match.group(5))
            width = float(match.group(6))
            merch = match.group(7)

            # Clean TEST -TEST suffix from description
            desc_and_size_raw = re.sub(r"\s*TEST\s*-\s*TEST\s*$", "", desc_and_size_raw)

            description, size = _split_desc_size(desc_and_size_raw)
            position_counter += 1

            products.append({
                "bay": current_bay,
                "shelf": current_shelf,
                "shelf_height_inches": current_shelf_height,
                "bay_width_inches": current_bay_width_inches,
                "position": position_counter,
                "upc": upc,
                "facings": facings,
                "is_new": flag == "NEW",
                "is_changed": flag == "CHANGE",
                "description": description,
                "size": size,
                "height_inches": height,
                "width_inches": width,
                "merch_style": merch,
            })

    return products


def parse_added_removed(pdf):
    """Extract added and removed product lists from pages 2+."""
    added = []
    removed = []

    end_page = min(4, len(pdf.pages))
    for page_idx in range(1, end_page):
        text = pdf.pages[page_idx].extract_text()
        if not text:
            continue

        if "Products Added" not in text and "Products Removed" not in text:
            continue

        lines = text.split("\n")
        current_section = None

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            if "Products Added" in stripped:
                current_section = "added"
                continue
            if "Products Removed" in stripped:
                current_section = "removed"
                continue
            if "Products Changed" in stripped:
                current_section = "changed"
                continue
            if stripped.startswith("UPC") or stripped.startswith("D701_"):
                continue
            if stripped.startswith("DBKey:") or stripped.startswith("Property"):
                continue
            if stripped.startswith("Effective Date:") or stripped.startswith("Period Week:"):
                continue
            if stripped.startswith("Page:") or stripped.startswith("Date PDF"):
                continue

            if current_section in ("added", "removed"):
                # Parse: seq_num UPC description size
                m = re.match(r"\d+\s+(\d{10,14})\s+(.+?)\s+([\d.]+(?:PK\s+)?[\d/.]+\s*(?:FO|\.{2,4}))\s*$", stripped)
                if not m:
                    # Simpler pattern
                    m = re.match(r"\d+\s+(\d{10,14})\s+(.+?)\s+([\d.]+\s+FO)\s*$", stripped)
                if m:
                    entry = {
                        "upc": m.group(1),
                        "description": m.group(2).strip(),
                        "size": m.group(3).strip(),
                    }
                    if current_section == "added":
                        added.append(entry)
                    else:
                        removed.append(entry)

    return added, removed


def parse_pdf(filepath):
    """Parse a single planogram PDF."""
    pdf = pdfplumber.open(filepath)
    metadata = parse_metadata(pdf)
    if not metadata:
        pdf.close()
        return None, [], [], []

    metadata["pdf_filename"] = os.path.basename(filepath)
    products = parse_products(pdf)
    added, removed = parse_added_removed(pdf)
    pdf.close()
    return metadata, products, added, removed


def build_planogram_json(metadata, products, added, removed):
    """Structure flat product list into bay->shelf->product hierarchy."""
    section_key = _determine_section_key(metadata)

    # Group products by bay
    bays_dict = {}
    for p in products:
        bay_num = p["bay"]
        if bay_num not in bays_dict:
            bays_dict[bay_num] = {
                "bay": bay_num,
                "width_inches": p["bay_width_inches"],
                "shelves": {},
            }
        shelf_num = p["shelf"]
        if shelf_num not in bays_dict[bay_num]["shelves"]:
            bays_dict[bay_num]["shelves"][shelf_num] = {
                "shelf": shelf_num,
                "height_from_base": p["shelf_height_inches"],
                "products": [],
            }
        bays_dict[bay_num]["shelves"][shelf_num]["products"].append({
            "position": p["position"],
            "upc": p["upc"],
            "facings": p["facings"],
            "is_new": p["is_new"],
            "is_changed": p["is_changed"],
            "description": p["description"],
            "size": p["size"],
            "height_inches": p["height_inches"],
            "width_inches": p["width_inches"],
            "merch_style": p["merch_style"],
        })

    # Convert dicts to sorted lists
    bays = []
    for bay_num in sorted(bays_dict.keys()):
        bay = bays_dict[bay_num]
        shelves = []
        for shelf_num in sorted(bay["shelves"].keys()):
            shelves.append(bay["shelves"][shelf_num])
        bays.append({
            "bay": bay["bay"],
            "width_inches": bay["width_inches"],
            "shelves": shelves,
        })

    return {
        "section_key": section_key,
        "name": metadata.get("name", ""),
        "description": metadata.get("description", ""),
        "dbkey": metadata.get("dbkey", 0),
        "effective_date": metadata.get("effective_date", ""),
        "period_week": metadata.get("period_week", ""),
        "width_inches": metadata.get("width_inches", 0),
        "height_inches": metadata.get("height_inches", 0),
        "depth_inches": metadata.get("depth_inches", 0),
        "num_bays": metadata.get("num_bays", len(bays)),
        "num_shelves": metadata.get("num_shelves", 0),
        "num_products": metadata.get("num_products", 0),
        "fixture_type": metadata.get("fixture_type", ""),
        "pdf_filename": metadata.get("pdf_filename", ""),
        "added": added,
        "removed": removed,
        "bays": bays,
    }


def merge_product_info(planograms, products_json_path):
    """Merge full_name and image from products.json into planogram products."""
    if not os.path.exists(products_json_path):
        return

    with open(products_json_path, "r", encoding="utf-8") as f:
        existing = json.load(f)

    # Build UPC -> product info lookup from all sections
    upc_lookup = {}
    for section_products in existing.values():
        for p in section_products:
            upc_lookup[p["upc"]] = {
                "full_name": p.get("full_name", ""),
                "image": p.get("image", ""),
            }

    # Merge into planogram products
    for section_key, planogram in planograms.items():
        for bay in planogram["bays"]:
            for shelf in bay["shelves"]:
                for product in shelf["products"]:
                    info = upc_lookup.get(product["upc"], {})
                    product["full_name"] = info.get("full_name", "")
                    product["image"] = info.get("image", f"images/{product['upc']}.jpg")


def update_products_json(planograms, products_json_path):
    """Regenerate products.json with clean sizes from parsed PDF data."""
    if not os.path.exists(products_json_path):
        return

    with open(products_json_path, "r", encoding="utf-8") as f:
        existing = json.load(f)

    # Build UPC -> clean size lookup from parsed planograms
    clean_sizes = {}
    for section_key, planogram in planograms.items():
        for bay in planogram["bays"]:
            for shelf in bay["shelves"]:
                for product in shelf["products"]:
                    clean_sizes[product["upc"]] = product["size"]

    # Update existing products.json with clean sizes
    # Also fix any remaining corrupted sizes (e.g., "12 FO 2 2 1 P13 W1 Y2025")
    size_cleanup_re = re.compile(r"^([\d.]+\s+FO)\s+\d+\s+\d+\s+\d+\s+P\d+")
    for section_key, products in existing.items():
        for product in products:
            if product["upc"] in clean_sizes:
                product["size"] = clean_sizes[product["upc"]]
            else:
                m = size_cleanup_re.match(product["size"])
                if m:
                    product["size"] = m.group(1)

    with open(products_json_path, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)
    print(f"  Updated {products_json_path} with clean sizes")


def main():
    pdf_dir = SCRIPT_DIR
    products_json_path = os.path.join(SCRIPT_DIR, "products.json")
    output_path = os.path.join(SCRIPT_DIR, "planograms.json")

    pdf_files = sorted(glob.glob(os.path.join(pdf_dir, "*.pdf")))
    if not pdf_files:
        print("No PDF files found in", pdf_dir)
        return

    print(f"Found {len(pdf_files)} PDF files\n")

    planograms = {}

    for filepath in pdf_files:
        filename = os.path.basename(filepath)
        print(f"Parsing: {filename}")

        metadata, products, added, removed = parse_pdf(filepath)
        if not metadata:
            print("  SKIPPED (no metadata)\n")
            continue

        planogram = build_planogram_json(metadata, products, added, removed)
        section_key = planogram["section_key"]
        planograms[section_key] = planogram

        total_products = sum(
            len(shelf["products"])
            for bay in planogram["bays"]
            for shelf in bay["shelves"]
        )
        print(f"  Section: {section_key}")
        print(f"  DBKey: {metadata.get('dbkey')}")
        print(f"  Bays: {planogram['num_bays']}, Shelves: {planogram['num_shelves']}")
        print(f"  Products parsed: {total_products} (expected: {planogram['num_products']})")
        print(f"  Added: {len(added)}, Removed: {len(removed)}")
        print()

    # Merge full_name and image paths
    merge_product_info(planograms, products_json_path)

    # Write planograms.json
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(planograms, f, indent=2, ensure_ascii=False)
    print(f"Wrote {output_path}")
    print(f"  Sections: {list(planograms.keys())}")

    # Update products.json with clean sizes
    update_products_json(planograms, products_json_path)


if __name__ == "__main__":
    main()
