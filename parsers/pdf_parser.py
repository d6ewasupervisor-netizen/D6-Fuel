"""
Parse Kroger planogram PDFs to extract product position data.

Each PDF contains:
- Page 1: Metadata (name, DBKey, dimensions, counts)
- Pages 2-4: Product adds/removes/changes
- Pages 5+: Bay-Fixture-Position data with product details
"""

import re
import os
import pdfplumber


# Reversed text artifacts from vertical labels in the PDF
REVERSED_WORDS = {
    ".pu", "flehs", "txen", "eht", "fo", "pot", "ot", "morf",
    "ecnatsid", "si", "margonalp", "edis", "tfel", "no", "nwohs",
    "tnemerusaeM", ":etoN",
}

# Regex: section header like "Bay 1 - 4 ft wide Shelf 8 - 61.00 inches from Base Shelf"
SECTION_HEADER_RE = re.compile(
    r"Bay\s+(\d+)\s*-\s*(\d+)\s*ft\s+wide\s+Shelf\s+(\d+)\s*-\s*([\d.]+)\s*(?:inches from Base Shelf|Base Shelf)"
)

# Regex: a single product entry
# Matches: UPC(10-14 digits) Facings(1-2 digits) [NEW|CHANGE] Description Size Height in Width in MerchStyle
PRODUCT_RE = re.compile(
    r"(\d{10,14})\s+"        # UPC
    r"(\d{1,2})\s+"          # Facings
    r"(NEW\s+|CHANGE\s+)?"   # Optional NEW/CHANGE flag
    r"(.+?)\s+"              # Description (non-greedy)
    r"(\d+\.?\d*)\s+in\s+"   # Height inches
    r"(\d+\.?\d*)\s+in\s+"   # Width inches
    r"(\w+)"                 # Merch style (Unit, etc.)
)

# Regex: position number at start of a product line segment
# Could be just position (e.g., "2 ") or bay+shelf+position (e.g., "1 8 1 ")
POSITION_PREFIX_RE = re.compile(r"^(\d{1,3})\s+")

# First line of section has bay+shelf+position before UPC: "1 8 1 0030573475592..."
FIRST_LINE_RE = re.compile(r"^(\d{1,2})\s+(\d{1,2})\s+(\d{1,3})\s+(\d{10,14})")

# Lines to skip in position section
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
]

# Regex for removed product lines on pages 2-4
# Format: UPC Description Size (various formats)
REMOVED_PRODUCT_RE = re.compile(
    r"(\d{10,14})\s+"        # UPC
    r"(.+?)\s+"              # Description (non-greedy)
    r"(\d+(?:[/.]\d+)?\s*(?:CT|OZ|EA|PC|ML|MG|IU|SG|FL|LB|GM|GRM|G|CAP|TAB|TABS|CHWS|SFTGL|SFTGEL|TBLTS|GMMY|GUMS|GUMMIES|CAPS|PKTS|PKT|SRV|DZ|BG|BX|PT|QT|GAL)(?:\s+\S+)?)\s*$",
    re.IGNORECASE,
)


def parse_metadata(pdf):
    """Extract planogram metadata from page 1."""
    text = pdf.pages[0].extract_text()
    if not text:
        return None

    lines = text.split("\n")
    metadata = {}

    # Line 0: Effective Date
    m = re.search(r"Effective Date:\s*(.+)", text)
    if m:
        metadata["effective_date"] = m.group(1).strip()

    # Line 1: Planogram name
    for line in lines:
        if line.startswith("D701_"):
            parts = line.split(" - ", 1)
            metadata["name"] = parts[0].strip()
            metadata["description"] = parts[1].strip() if len(parts) > 1 else ""
            break

    # DBKey
    m = re.search(r"DBKey:\s*(\d+)", text)
    if m:
        metadata["dbkey"] = int(m.group(1))

    # Dimensions and counts
    m = re.search(r"Planogram Width:\s*(\d+)\s*ft", text)
    if m:
        metadata["width_ft"] = int(m.group(1))

    m = re.search(r"Planogram Height:\s*(\d+)\s*Inches", text)
    if m:
        metadata["height_inches"] = int(m.group(1))

    m = re.search(r"Planogram Depth:\s*(\d+)\s*Inches", text)
    if m:
        metadata["depth_inches"] = int(m.group(1))

    m = re.search(r"Number of Products:\s*(\d+)", text)
    if m:
        metadata["num_products"] = int(m.group(1))

    m = re.search(r"Number of Shelves:\s*(\d+)", text)
    if m:
        metadata["num_shelves"] = int(m.group(1))

    # Category from name
    if "C180" in metadata.get("name", ""):
        metadata["category"] = "C180"
    elif "C678" in metadata.get("name", ""):
        metadata["category"] = "C678"

    # Bay count from "Bay # X of Y" on position pages
    for page in pdf.pages[3:6]:
        pt = page.extract_text()
        if pt:
            m = re.search(r"Bay\s*#\s*\d+\s+of\s+(\d+)", pt)
            if m:
                metadata["num_bays"] = int(m.group(1))
                break

    return metadata


def _is_skip_line(line):
    """Check if a line should be skipped."""
    stripped = line.strip()
    if not stripped:
        return True
    if stripped in REVERSED_WORDS:
        return True
    if any(stripped.startswith(p) for p in SKIP_PATTERNS):
        return True
    # Lines that are just numbers and spaces (visual diagram position labels)
    if re.match(r"^[\d\s]+$", stripped) and len(stripped) < 60:
        return True
    # Lines like "8 in", "9 in", "6 in", "4 ft", "44 fftt"
    if re.match(r"^\d+\s*(in|ft|fftt)$", stripped):
        return True
    return False


def _split_concatenated(line):
    """Split lines where two products are concatenated, joined by 'Unit'.

    Example: '...70 CT 4.56 in 2.50 in Unit 6 0001650058735 2 OAD...'
    Split into two segments at the merch style boundary where a new product starts.
    """
    # Split on merch style word (Unit, Alt, etc.) followed by a new position+UPC pattern
    parts = re.split(r"(Unit|Alt|Peg|Tray)\s+(?=\d{1,3}\s+\d{10,14})", line)
    if len(parts) <= 1:
        return [line]

    # Reassemble: odd indices are the merch style, pair with previous segment
    segments = []
    current = ""
    for i, part in enumerate(parts):
        if part in ("Unit", "Alt", "Peg", "Tray"):
            current += part
            segments.append(current.strip())
            current = ""
        else:
            current += part
    if current.strip():
        segments.append(current.strip())
    return segments


def _parse_product_segment(segment, current_bay, current_shelf):
    """Parse a single product segment and return product dict or None."""
    match = PRODUCT_RE.search(segment)
    if not match:
        return None

    upc = match.group(1)
    facings = int(match.group(2))
    flag = (match.group(3) or "").strip()
    desc_and_size = match.group(4)
    height = float(match.group(5))
    width = float(match.group(6))
    merch = match.group(7)

    # Split description and size from the combined match
    # Size is typically at the end: "120 CT", "6.61 OZ", "3/10 CT", "60/.32 OZ", etc.
    size_match = re.search(
        r"\s+(\d+(?:[/.]\d+)?\s*(?:CT|OZ|EA|PC|ML|MG|IU|SG|FL|LB|GM|GRM|G|CAP|TAB|TABS|CHWS|SFTGL|SFTGEL|TBLTS|GMMY|GUMS|GUMMIES|CAPS|PKTS|PKT|SRV|DZ|BG|BX|PT|QT|GAL)(?:\s+\S+)?)$",
        desc_and_size,
        re.IGNORECASE,
    )
    if size_match:
        description = desc_and_size[: size_match.start()].strip()
        size = size_match.group(1).strip()
    else:
        # Fallback: try splitting on last numeric-alpha pattern
        size_match2 = re.search(r"\s+(\d+(?:[/.]\d+)?\s+\S+)$", desc_and_size)
        if size_match2:
            description = desc_and_size[: size_match2.start()].strip()
            size = size_match2.group(1).strip()
        else:
            description = desc_and_size.strip()
            size = ""

    # Extract position number from text before the UPC
    before_upc = segment[: segment.index(upc)].strip()
    position = None
    bay = current_bay
    shelf = current_shelf

    # Check if this is a first-line-of-section with bay+shelf+position
    first_match = FIRST_LINE_RE.match(before_upc + " " + upc)
    if first_match:
        # Could be bay+shelf+pos or just pos (need context)
        nums = re.findall(r"\d+", before_upc)
        if len(nums) >= 3:
            bay = int(nums[0])
            shelf = int(nums[1])
            position = int(nums[2])
        elif len(nums) == 2:
            # Could be shelf+position or bay+position - use context
            shelf = int(nums[0])
            position = int(nums[1])
        elif len(nums) == 1:
            position = int(nums[0])
    else:
        nums = re.findall(r"\d+", before_upc)
        if nums:
            position = int(nums[-1])

    if position is None:
        position = 0

    return {
        "bay": bay,
        "shelf": shelf,
        "position": position,
        "upc": upc,
        "facings": facings,
        "is_new": flag == "NEW",
        "is_changed": flag == "CHANGE",
        "description": description,
        "size": size,
        "height_inches": height,
        "width_inches": width,
        "merch_style": merch,
    }


def _find_position_start_page(pdf):
    """Find the first page that contains Bay-Fixture-Position data."""
    for i, page in enumerate(pdf.pages):
        text = page.extract_text()
        if text and "Bay - Fixture - Position Information" in text:
            return i
    return None


def parse_removed_products(pdf):
    """Extract removed/deleted products from pages 2-4 of the PDF.

    These pages use a two-column layout:
    Left column: Products Added (NEW)
    Right column: Products Removed (DELETE)

    Each line contains both an added and removed entry, like:
    1 0003076800460 OSTBFLX TRPL STR TUMERIC 120 CT 1 0001111035353 KRO PRENATAL VITAMIN 100 CT
    """
    removed = []
    in_add_remove_section = False

    # Regex to find removed entries in the right column
    # Pattern: sequence_num UPC description size (in the right half of the line)
    # We look for ALL UPC-like patterns in a line, the rightmost one(s) are "removed"
    UPC_PATTERN = re.compile(r"(\d{10,14})")

    end_page = min(6, len(pdf.pages))
    for page_idx in range(1, end_page):
        page = pdf.pages[page_idx]
        text = page.extract_text()
        if not text:
            continue

        # Only process pages that have "Removed" header
        if "Products Removed" not in text and "DELETE" not in text:
            continue

        lines = text.split("\n")
        for line in lines:
            stripped = line.strip()

            # Skip headers
            if not stripped:
                continue
            if "Products Added" in stripped or "Products Removed" in stripped:
                in_add_remove_section = True
                continue
            if "UPC" in stripped and "Product" in stripped and "Size" in stripped:
                continue
            if stripped.startswith("Effective Date:") or stripped.startswith("Period Week:"):
                in_add_remove_section = False
                continue
            if stripped.startswith("D701_") or stripped.startswith("Property of"):
                continue
            if "Products Changed" in stripped or "Bay - Fixture" in stripped:
                in_add_remove_section = False
                continue

            if not in_add_remove_section:
                continue

            # Find all UPCs in the line. In the two-column layout, the line
            # typically has: seqnum UPC1 desc1 size1 seqnum UPC2 desc2 size2
            # where UPC2 is the removed product
            all_upcs = list(UPC_PATTERN.finditer(stripped))
            if len(all_upcs) < 2:
                # Single UPC line - could be removed-only (no added product)
                # or added-only. Check if it's after a column split
                if len(all_upcs) == 1:
                    # Check context: if only removed products on this page
                    upc_match = all_upcs[0]
                    upc = upc_match.group(1)
                    after_upc = stripped[upc_match.end():].strip()
                    # Parse description and size
                    m = REMOVED_PRODUCT_RE.match(upc + " " + after_upc)
                    if m:
                        removed.append({
                            "upc": m.group(1),
                            "description": m.group(2).strip(),
                            "size": m.group(3).strip(),
                        })
                continue

            # Two or more UPCs: the second (and beyond) are typically removed products
            # The first UPC belongs to "added" column, second to "removed" column
            for upc_idx in range(1, len(all_upcs)):
                upc_match = all_upcs[upc_idx]
                upc = upc_match.group(1)

                # Extract text after this UPC until the next UPC or end of line
                start = upc_match.end()
                if upc_idx + 1 < len(all_upcs):
                    end = all_upcs[upc_idx + 1].start()
                else:
                    end = len(stripped)
                after_text = stripped[start:end].strip()

                # Parse description and size from after_text
                desc = after_text
                size = ""
                size_m = re.search(
                    r"\s+(\d+(?:[/.]\d+)?\s*(?:CT|OZ|EA|PC|ML|MG|IU|SG|FL|LB|GM|GRM|G|CAP|TAB|TABS|CHWS|SFTGL|SFTGEL|TBLTS|GMMY|GUMS|GUMMIES|CAPS|PKTS|PKT|SRV|DZ|BG|BX|PT|QT|GAL)(?:\s+\S+)?)\s*$",
                    after_text,
                    re.IGNORECASE,
                )
                if size_m:
                    desc = after_text[:size_m.start()].strip()
                    size = size_m.group(1).strip()

                # Clean up: remove leading sequence numbers from description
                desc = re.sub(r"^\d{1,3}\s+", "", desc)

                if upc and len(upc) >= 10:
                    removed.append({
                        "upc": upc,
                        "description": desc,
                        "size": size,
                    })

    return removed


def parse_products(pdf):
    """Extract all product positions from the PDF."""
    products = []
    current_bay = 0
    current_shelf = 0
    current_bay_width = 4
    current_shelf_height = 0.0

    start_page = _find_position_start_page(pdf)
    if start_page is None:
        return products

    in_position_section = False

    for page_idx in range(start_page, len(pdf.pages)):
        page = pdf.pages[page_idx]
        text = page.extract_text()
        if not text:
            continue

        lines = text.split("\n")

        for line in lines:
            stripped = line.strip()

            # Check for section header
            header_match = SECTION_HEADER_RE.search(stripped)
            if header_match:
                current_bay = int(header_match.group(1))
                current_bay_width = int(header_match.group(2))
                current_shelf = int(header_match.group(3))
                current_shelf_height = float(header_match.group(4))
                in_position_section = True
                continue

            # Activate on "Bay - Fixture - Position Information"
            if "Bay - Fixture - Position Information" in stripped:
                in_position_section = True
                continue

            # Handle BayFi... header line BEFORE skip check (may have product appended)
            if "BayFi..." in stripped:
                # Check if product data is appended after the header
                after_header = stripped.split("Safer Info")[-1].strip() if "Safer Info" in stripped else ""
                if after_header and PRODUCT_RE.search(after_header):
                    segments = _split_concatenated(after_header)
                    for seg in segments:
                        prod = _parse_product_segment(seg, current_bay, current_shelf)
                        if prod:
                            prod["bay_width_ft"] = current_bay_width
                            prod["shelf_height_inches"] = current_shelf_height
                            products.append(prod)
                continue

            if _is_skip_line(stripped):
                continue

            # Only parse product lines after we've seen position section markers
            if not in_position_section:
                continue

            # Regular product lines - may contain concatenated products
            segments = _split_concatenated(stripped)
            for seg in segments:
                prod = _parse_product_segment(seg, current_bay, current_shelf)
                if prod:
                    prod["bay_width_ft"] = current_bay_width
                    prod["shelf_height_inches"] = current_shelf_height
                    products.append(prod)

    return products


def parse_pdf(filepath):
    """Parse a single PDF file and return metadata, products, and removed products."""
    pdf = pdfplumber.open(filepath)
    metadata = parse_metadata(pdf)
    if not metadata or "dbkey" not in metadata:
        pdf.close()
        return None, [], []

    metadata["pdf_filename"] = os.path.basename(filepath)
    products = parse_products(pdf)
    removed = parse_removed_products(pdf)
    pdf.close()
    return metadata, products, removed


def parse_all_pdfs(pdf_dir):
    """Parse all PDFs in a directory. Returns list of (metadata, products, removed) tuples."""
    results = []
    pdf_files = sorted(
        f for f in os.listdir(pdf_dir) if f.endswith(".pdf")
    )

    for filename in pdf_files:
        filepath = os.path.join(pdf_dir, filename)
        print(f"  Parsing {filename}...", end=" ")
        try:
            metadata, products, removed = parse_pdf(filepath)
            if metadata:
                print(f"{len(products)} products (expected {metadata.get('num_products', '?')}), {len(removed)} removed")
                results.append((metadata, products, removed))
            else:
                print("SKIPPED (no metadata)")
        except Exception as e:
            print(f"ERROR: {e}")

    return results
