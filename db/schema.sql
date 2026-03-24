CREATE TABLE IF NOT EXISTS planograms (
    dbkey INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    effective_date TEXT,
    width_ft INTEGER,
    height_inches INTEGER,
    depth_inches INTEGER,
    num_products INTEGER,
    num_shelves INTEGER,
    num_bays INTEGER,
    category TEXT,
    pdf_filename TEXT
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    planogram_dbkey INTEGER NOT NULL,
    bay INTEGER NOT NULL,
    bay_width_ft INTEGER,
    shelf INTEGER NOT NULL,
    shelf_height_inches REAL,
    position INTEGER NOT NULL,
    upc TEXT NOT NULL,
    facings INTEGER DEFAULT 1,
    is_new BOOLEAN DEFAULT 0,
    is_changed BOOLEAN DEFAULT 0,
    description TEXT,
    size TEXT,
    height_inches REAL,
    width_inches REAL,
    merch_style TEXT,
    FOREIGN KEY (planogram_dbkey) REFERENCES planograms(dbkey)
);

CREATE TABLE IF NOT EXISTS store_planograms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id TEXT NOT NULL,
    planogram_dbkey INTEGER NOT NULL,
    aisle TEXT,
    orientation TEXT,
    sequence INTEGER,
    pog_status TEXT,
    live_date TEXT,
    pog_description TEXT,
    FOREIGN KEY (planogram_dbkey) REFERENCES planograms(dbkey)
);

CREATE TABLE IF NOT EXISTS product_images (
    upc TEXT PRIMARY KEY,
    image_url TEXT,
    fetched_at TEXT
);

-- User session tracking
CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL,
    store_id TEXT NOT NULL,
    session_token TEXT UNIQUE NOT NULL,
    login_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Detailed activity log
CREATE TABLE IF NOT EXISTS user_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_token TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_token) REFERENCES user_sessions(session_token)
);

-- Deleted/discontinued products parsed from PDFs
CREATE TABLE IF NOT EXISTS deleted_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    planogram_dbkey INTEGER NOT NULL,
    upc TEXT NOT NULL,
    description TEXT,
    size TEXT,
    FOREIGN KEY (planogram_dbkey) REFERENCES planograms(dbkey)
);

CREATE TABLE IF NOT EXISTS product_descriptions (
    upc TEXT PRIMARY KEY,
    full_name TEXT,
    fetched_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_upc ON products(upc);
CREATE INDEX IF NOT EXISTS idx_store_planograms_store ON store_planograms(store_id);
CREATE INDEX IF NOT EXISTS idx_products_planogram ON products(planogram_dbkey, bay, shelf, position);
CREATE INDEX IF NOT EXISTS idx_user_sessions_store ON user_sessions(store_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_activity_session ON user_activity(session_token);
CREATE INDEX IF NOT EXISTS idx_deleted_products_upc ON deleted_products(upc);
