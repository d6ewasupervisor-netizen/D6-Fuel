import os
import uuid
import sqlite3

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from .database import query, execute, get_connection
from .kroger_api import get_product_description

router = APIRouter(prefix="/api")

# Products moving between planogram categories (not truly discontinued)
MOVING_PRODUCTS = {
    "0007631430213": {
        "from_category": "C180",
        "from_label": "Regular Vitamins",
        "to_category": "C678",
        "to_label": "NF Vitamins",
    },
}

LOCAL_IMAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "images", "products")
LOCAL_ORIGINAL_IMAGE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "static", "images", "products_original"
)
PDF_DIR = os.path.join(os.path.dirname(__file__), "..", "P3W3 C180 C678 Vitamins")


def _local_shelf_image_url(upc: str) -> str | None:
    """Bay thumbnails only: cropped PNG in products_original/."""
    orig_png = os.path.join(LOCAL_ORIGINAL_IMAGE_DIR, f"{upc}.png")
    if os.path.isfile(orig_png):
        return f"/static/images/products_original/{upc}.png"
    return None


def _local_detail_image_url(upc: str) -> str | None:
    """Product card / overlay only: JPG in products/."""
    jpg = os.path.join(LOCAL_IMAGE_DIR, f"{upc}.jpg")
    if os.path.isfile(jpg):
        return f"/static/images/products/{upc}.jpg"
    return None


# --- Login & Activity Tracking ---

DEFAULT_PASSWORD = "Vitamins"


class LoginRequest(BaseModel):
    user_name: str
    store_id: str
    password: str
    user_agent: str = ""
    screen_width: int = 0
    screen_height: int = 0
    device_type: str = ""


class ActivityRequest(BaseModel):
    session_token: str
    action: str
    detail: str = ""
    view_name: str = ""
    duration_ms: int = 0
    meta: str = ""


@router.post("/login")
def login(req: LoginRequest):
    if req.password != DEFAULT_PASSWORD:
        raise HTTPException(401, "Invalid password")
    store_padded = req.store_id.strip().zfill(5)
    # Validate store exists
    stores = query(
        "SELECT DISTINCT store_id FROM store_planograms WHERE store_id = ?",
        (store_padded,),
    )
    if not stores:
        raise HTTPException(404, f"Store {store_padded} not found")

    token = uuid.uuid4().hex
    execute(
        """INSERT INTO user_sessions
           (user_name, store_id, session_token, user_agent, screen_width, screen_height, device_type)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            req.user_name.strip(),
            store_padded,
            token,
            req.user_agent,
            req.screen_width,
            req.screen_height,
            req.device_type,
        ),
    )
    # Log login activity
    execute(
        "INSERT INTO user_activity (session_token, action, detail) VALUES (?, ?, ?)",
        (token, "login", f"Store {store_padded}"),
    )
    return {"session_token": token, "store_id": store_padded, "user_name": req.user_name.strip()}


@router.post("/activity")
def log_activity(req: ActivityRequest):
    execute(
        "UPDATE user_sessions SET last_active_at = datetime('now') WHERE session_token = ?",
        (req.session_token,),
    )
    execute(
        """INSERT INTO user_activity
           (session_token, action, detail, view_name, duration_ms, meta)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (req.session_token, req.action, req.detail, req.view_name, req.duration_ms, req.meta),
    )
    return {"ok": True}


# --- Store & Planogram Types ---

def _get_full_names(upcs):
    """Batch-read cached full product names for a list of UPCs."""
    if not upcs:
        return {}
    try:
        conn = get_connection()
        placeholders = ",".join("?" * len(upcs))
        rows = conn.execute(
            f"SELECT upc, full_name FROM product_descriptions WHERE upc IN ({placeholders})",
            upcs,
        ).fetchall()
        conn.close()
        return {r["upc"]: r["full_name"] for r in rows}
    except Exception:
        return {}



@router.get("/stores")
def list_stores():
    rows = query(
        "SELECT DISTINCT store_id FROM store_planograms ORDER BY store_id"
    )
    return {"stores": [r["store_id"] for r in rows]}


@router.get("/store/{store_id}/planogram-types")
def get_planogram_types(store_id: str):
    """Return available vitamin types (C180=Regular, C678=Natural) for a store."""
    store_padded = store_id.zfill(5)
    rows = query(
        """SELECT DISTINCT p.category, sp.pog_description, p.dbkey, p.name, p.num_bays
           FROM store_planograms sp
           JOIN planograms p ON sp.planogram_dbkey = p.dbkey
           WHERE sp.store_id = ?
           ORDER BY p.category""",
        (store_padded,),
    )
    if not rows:
        raise HTTPException(404, f"No planograms found for store {store_padded}")

    types = []
    for r in rows:
        types.append({
            "category": r["category"],
            "label": "Natural Vitamins" if r["category"] == "C678" else "Regular Vitamins",
            "description": r["pog_description"],
            "planogram_dbkey": r["dbkey"],
            "planogram_name": r["name"],
            "num_bays": r["num_bays"],
        })
    return {"types": types, "store_id": store_padded}


# --- Search ---

def _scanned_upc_to_db_formats(upc: str) -> list[str]:
    """Convert a scanned barcode value to candidate DB lookup formats.

    The planogram DB stores 13-digit UPCs: the barcode digits *without* the
    check digit, left-zero-padded to 13 characters.  Barcode scanners return
    the full code *with* the check digit (12 digits for UPC-A, 13 for EAN-13,
    8 for UPC-E).  This helper returns a list of candidate strings so the
    search query can try all plausible formats.
    """
    candidates = [upc]
    if len(upc) in (8, 12, 13) and upc.isdigit():
        without_check = upc[:-1].zfill(13)
        if without_check != upc:
            candidates.append(without_check)
    return candidates


@router.get("/search")
def search_product(
    store: str = Query(..., min_length=1),
    upc: str = Query(..., min_length=4),
):
    store_padded = store.zfill(5)

    # Get planograms for this store
    store_pogs = query(
        "SELECT planogram_dbkey, aisle, orientation, sequence, pog_description "
        "FROM store_planograms WHERE store_id = ?",
        (store_padded,),
    )
    if not store_pogs:
        raise HTTPException(404, f"Store {store_padded} not found")

    dbkeys = [sp["planogram_dbkey"] for sp in store_pogs]
    pog_info = {sp["planogram_dbkey"]: sp for sp in store_pogs}

    # Search for UPC matches across this store's planograms
    placeholders = ",".join("?" * len(dbkeys))
    upc_clean = upc.strip()

    # Normalize scanned UPC to match database storage format.
    # DB stores UPCs as 13-digit strings WITHOUT the check digit, left-padded
    # with zeros.  Barcode scanners return the full UPC-A (12 digits) or EAN-13
    # (13 digits) which include the check digit as the last character.
    # Strip the check digit and zero-pad to 13 so the lookup succeeds.
    if upc_clean.isdigit() and len(upc_clean) in (12, 13):
        upc_clean = upc_clean[:-1].zfill(13)

    if len(upc_clean) >= 10:
        upc_candidates = _scanned_upc_to_db_formats(upc_clean)
        upc_placeholders = ",".join("?" * len(upc_candidates))
        sql = (
            f"SELECT p.*, pg.name as planogram_name, pg.category "
            f"FROM products p JOIN planograms pg ON p.planogram_dbkey = pg.dbkey "
            f"WHERE p.planogram_dbkey IN ({placeholders}) AND p.upc IN ({upc_placeholders}) "
            f"ORDER BY pg.category, p.bay, p.shelf, p.position"
        )
        params = dbkeys + upc_candidates
    else:
        sql = (
            f"SELECT p.*, pg.name as planogram_name, pg.category "
            f"FROM products p JOIN planograms pg ON p.planogram_dbkey = pg.dbkey "
            f"WHERE p.planogram_dbkey IN ({placeholders}) AND p.upc LIKE ? "
            f"ORDER BY pg.category, p.bay, p.shelf, p.position"
        )
        params = dbkeys + [f"%{upc_clean}"]

    results = query(sql, params)

    # Enrich with store-specific info and full product names
    desc_map = _get_full_names(list(set(r["upc"] for r in results)))
    for r in results:
        info = pog_info.get(r["planogram_dbkey"], {})
        r["aisle"] = info.get("aisle", "")
        r["orientation"] = info.get("orientation", "")
        r["sequence"] = info.get("sequence", "")
        r["is_deleted"] = False
        r["full_name"] = desc_map.get(r["upc"]) or None

    # Also check deleted products
    if len(upc_clean) >= 10:
        upc_candidates = _scanned_upc_to_db_formats(upc_clean)
        upc_placeholders = ",".join("?" * len(upc_candidates))
        del_sql = (
            f"SELECT dp.*, pg.name as planogram_name, pg.category "
            f"FROM deleted_products dp JOIN planograms pg ON dp.planogram_dbkey = pg.dbkey "
            f"WHERE dp.planogram_dbkey IN ({placeholders}) AND dp.upc IN ({upc_placeholders})"
        )
        del_params = dbkeys + upc_candidates
    else:
        del_sql = (
            f"SELECT dp.*, pg.name as planogram_name, pg.category "
            f"FROM deleted_products dp JOIN planograms pg ON dp.planogram_dbkey = pg.dbkey "
            f"WHERE dp.planogram_dbkey IN ({placeholders}) AND dp.upc LIKE ?"
        )
        del_params = dbkeys + [f"%{upc_clean}"]

    deleted_results = query(del_sql, del_params)
    moving_seen_upcs = set()
    for dr in deleted_results:
        moving = MOVING_PRODUCTS.get(dr["upc"])
        if moving:
            dr["is_deleted"] = False
            dr["is_moving"] = True
            dr["moving_from"] = moving["from_label"]
            dr["moving_to"] = moving["to_label"]
            dr["moving_to_category"] = moving["to_category"]
            moving_seen_upcs.add(dr["upc"])
        else:
            dr["is_deleted"] = True
            dr["is_moving"] = False
        dr["bay"] = 0
        dr["shelf"] = 0
        dr["position"] = 0

    # For moving products, look up their new location in the destination planogram
    moving_location = {}
    for upc_val in moving_seen_upcs:
        to_cat = MOVING_PRODUCTS[upc_val]["to_category"]
        loc_rows = query(
            "SELECT p.bay, p.shelf, p.position, sp.aisle, sp.orientation, sp.sequence, pg.dbkey as planogram_dbkey "
            "FROM products p "
            "JOIN planograms pg ON p.planogram_dbkey = pg.dbkey "
            "JOIN store_planograms sp ON sp.planogram_dbkey = pg.dbkey "
            "WHERE p.upc = ? AND pg.category = ? AND sp.store_id = ? "
            "LIMIT 1",
            (upc_val, to_cat, store_padded),
        )
        if loc_rows:
            loc = loc_rows[0]
            moving_location[upc_val] = {
                "new_aisle": loc["aisle"],
                "new_bay": loc["bay"],
                "new_shelf": loc["shelf"],
                "new_position": loc["position"],
                "new_orientation": loc["orientation"],
                "new_planogram_dbkey": loc["planogram_dbkey"],
            }

    for dr in deleted_results:
        if dr.get("is_moving") and dr["upc"] in moving_location:
            dr.update(moving_location[dr["upc"]])

    all_results = results + deleted_results
    return {
        "results": all_results,
        "count": len(all_results),
        "store": store_padded,
        "has_deleted": any(r.get("is_deleted") for r in deleted_results),
        "has_moving": any(r.get("is_moving") for r in deleted_results),
    }


@router.get("/deleted-check/{upc}")
def check_deleted(upc: str):
    """Quick check if a UPC is in the deleted products list."""
    upc_clean = upc.strip()
    if upc_clean.isdigit() and len(upc_clean) in (12, 13):
        upc_clean = upc_clean[:-1].zfill(13)
    if len(upc_clean) >= 10:
        candidates = _scanned_upc_to_db_formats(upc_clean)
        placeholders = ",".join("?" * len(candidates))
        rows = query(f"SELECT * FROM deleted_products WHERE upc IN ({placeholders})", candidates)
    else:
        rows = query("SELECT * FROM deleted_products WHERE upc LIKE ?", (f"%{upc_clean}",))
    for row in rows:
        moving = MOVING_PRODUCTS.get(row["upc"])
        if moving:
            row["is_moving"] = True
            row["moving_from"] = moving["from_label"]
            row["moving_to"] = moving["to_label"]
            row["moving_to_category"] = moving["to_category"]
    is_moving = any(r.get("is_moving") for r in rows)
    return {"is_deleted": len(rows) > 0 and not is_moving, "is_moving": is_moving, "matches": rows}


# --- Planogram ---

@router.get("/planogram/{dbkey}")
def get_planogram(dbkey: int):
    pog = query("SELECT * FROM planograms WHERE dbkey = ?", (dbkey,), one=True)
    if not pog:
        raise HTTPException(404, f"Planogram {dbkey} not found")

    products = query(
        "SELECT * FROM products WHERE planogram_dbkey = ? "
        "ORDER BY bay, shelf, position",
        (dbkey,),
    )

    # Enrich with full product names
    desc_map = _get_full_names(list(set(p["upc"] for p in products)))
    for p in products:
        p["full_name"] = desc_map.get(p["upc"]) or None

    # Group by bay then shelf
    bays = {}
    for p in products:
        bay_num = p["bay"]
        shelf_num = p["shelf"]
        if bay_num not in bays:
            bays[bay_num] = {
                "bay": bay_num,
                "width_ft": p["bay_width_ft"],
                "shelves": {},
            }
        if shelf_num not in bays[bay_num]["shelves"]:
            bays[bay_num]["shelves"][shelf_num] = {
                "shelf": shelf_num,
                "height_inches": p["shelf_height_inches"],
                "products": [],
            }
        bays[bay_num]["shelves"][shelf_num]["products"].append(p)

    # Convert to sorted lists
    bay_list = []
    for bay_num in sorted(bays.keys()):
        bay = bays[bay_num]
        shelves = []
        for shelf_num in sorted(bay["shelves"].keys()):
            shelves.append(bay["shelves"][shelf_num])
        bay["shelves"] = shelves
        bay_list.append(bay)

    pog["bays"] = bay_list
    return pog


@router.get("/planogram/{dbkey}/bay/{bay_num}")
def get_bay(dbkey: int, bay_num: int):
    products = query(
        "SELECT * FROM products WHERE planogram_dbkey = ? AND bay = ? "
        "ORDER BY shelf, position",
        (dbkey, bay_num),
    )
    if not products:
        raise HTTPException(404, f"Bay {bay_num} not found in planogram {dbkey}")

    # Enrich with full product names
    desc_map = _get_full_names(list(set(p["upc"] for p in products)))
    for p in products:
        p["full_name"] = desc_map.get(p["upc"]) or None

    shelves = {}
    bay_width = None
    for p in products:
        bay_width = p["bay_width_ft"]
        s = p["shelf"]
        if s not in shelves:
            shelves[s] = {
                "shelf": s,
                "height_inches": p["shelf_height_inches"],
                "products": [],
            }
        shelves[s]["products"].append(p)

    return {
        "bay": bay_num,
        "width_ft": bay_width,
        "shelves": [shelves[k] for k in sorted(shelves.keys())],
    }


@router.get("/product-description/{upc}")
def product_description(upc: str):
    """Lazy-fetch full product name from cache or Kroger API."""
    full_name = get_product_description(upc)
    return {"upc": upc, "full_name": full_name}


# --- Product Image ---

@router.get("/product-image/{upc}")
def product_image(upc: str, context: str = Query("detail")):
    """
    context=detail: card / overlay — only products/{upc}.jpg.
    context=shelf: bay slots — only products_original/{upc}.png.
    No other folders or remote URLs.
    """
    ctx = context if context in ("detail", "shelf") else "detail"
    if ctx == "shelf":
        url = _local_shelf_image_url(upc)
    else:
        url = _local_detail_image_url(upc)
    return {"upc": upc, "image_url": url}


class BatchImageRequest(BaseModel):
    upcs: list[str]


@router.post("/product-images")
def batch_product_images(req: BatchImageRequest):
    """Bay thumbnails only: products_original/{upc}.png when present."""
    results = {upc: _local_shelf_image_url(upc) for upc in req.upcs}
    return {"images": results}


# --- PDF Serving ---

@router.get("/pdf/{filename}")
def serve_pdf(filename: str):
    """Serve a planogram PDF file."""
    safe_name = os.path.basename(filename)
    pdf_path = os.path.join(PDF_DIR, safe_name)
    if not os.path.isfile(pdf_path):
        raise HTTPException(404, f"PDF not found: {safe_name}")
    return FileResponse(pdf_path, media_type="application/pdf", filename=safe_name)


@router.get("/planogram/{dbkey}/pdf-info")
def get_pdf_info(dbkey: int):
    """Get PDF filename and metadata for a planogram."""
    pog = query("SELECT dbkey, name, pdf_filename, category FROM planograms WHERE dbkey = ?", (dbkey,), one=True)
    if not pog:
        raise HTTPException(404, f"Planogram {dbkey} not found")
    return {
        "dbkey": pog["dbkey"],
        "name": pog["name"],
        "pdf_filename": pog["pdf_filename"],
        "category": pog["category"],
        "pdf_url": f"/api/pdf/{pog['pdf_filename']}" if pog["pdf_filename"] else None,
    }
