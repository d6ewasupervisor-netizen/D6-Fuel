import os

from fastapi import APIRouter, Query, HTTPException
from .database import query
from .kroger_api import get_product_image

router = APIRouter(prefix="/api")

LOCAL_IMAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "images", "products")


@router.get("/stores")
def list_stores():
    rows = query(
        "SELECT DISTINCT store_id FROM store_planograms ORDER BY store_id"
    )
    return {"stores": [r["store_id"] for r in rows]}


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

    if len(upc_clean) >= 10:
        # Full or near-full UPC: exact match
        sql = (
            f"SELECT p.*, pg.name as planogram_name, pg.category "
            f"FROM products p JOIN planograms pg ON p.planogram_dbkey = pg.dbkey "
            f"WHERE p.planogram_dbkey IN ({placeholders}) AND p.upc = ? "
            f"ORDER BY pg.category, p.bay, p.shelf, p.position"
        )
        params = dbkeys + [upc_clean]
    else:
        # Partial UPC: suffix match
        sql = (
            f"SELECT p.*, pg.name as planogram_name, pg.category "
            f"FROM products p JOIN planograms pg ON p.planogram_dbkey = pg.dbkey "
            f"WHERE p.planogram_dbkey IN ({placeholders}) AND p.upc LIKE ? "
            f"ORDER BY pg.category, p.bay, p.shelf, p.position"
        )
        params = dbkeys + [f"%{upc_clean}"]

    results = query(sql, params)

    # Enrich with store-specific info
    for r in results:
        info = pog_info.get(r["planogram_dbkey"], {})
        r["aisle"] = info.get("aisle", "")
        r["orientation"] = info.get("orientation", "")
        r["sequence"] = info.get("sequence", "")

    return {"results": results, "count": len(results), "store": store_padded}


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


@router.get("/product-image/{upc}")
def product_image(upc: str):
    # Serve preloaded local image if available
    local_path = os.path.join(LOCAL_IMAGE_DIR, f"{upc}.jpg")
    if os.path.isfile(local_path):
        return {"upc": upc, "image_url": f"/static/images/products/{upc}.jpg"}

    # Fall back to Kroger API (lazy fetch)
    url = get_product_image(upc)
    return {"upc": upc, "image_url": url}
