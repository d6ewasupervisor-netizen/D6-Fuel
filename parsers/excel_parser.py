"""Parse the store-to-planogram mapping Excel file."""

import openpyxl


def parse_store_mapping(filepath):
    """Parse the Excel store mapping file.

    Returns list of dicts with keys:
        store_id, planogram_dbkey, aisle, orientation, sequence,
        pog_status, live_date, pog_description, space_station_name
    """
    wb = openpyxl.load_workbook(filepath, read_only=True)
    ws = wb.active

    mappings = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]:
            continue

        store_id = str(row[0]).strip()
        pog_status = str(row[1]).strip() if row[1] else ""
        dbkey = int(row[2]) if row[2] else None
        space_station_name = str(row[3]).strip() if row[3] else ""
        description = str(row[4]).strip() if row[4] else ""
        live_date = str(row[5]).strip() if row[5] else ""
        aisle = str(row[6]).strip() if row[6] else ""
        orientation = str(row[7]).strip() if row[7] else ""
        sequence = int(row[8]) if row[8] else None
        # row[9] = # of Items, row[10] = No. of Stores (informational)

        if dbkey is None:
            continue

        mappings.append({
            "store_id": store_id,
            "planogram_dbkey": dbkey,
            "aisle": aisle,
            "orientation": orientation,
            "sequence": sequence,
            "pog_status": pog_status,
            "live_date": live_date,
            "pog_description": description,
            "space_station_name": space_station_name,
        })

    wb.close()
    return mappings
