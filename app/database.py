import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "db", "planograms.db")


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def query(sql, params=(), one=False):
    conn = get_connection()
    try:
        cursor = conn.execute(sql, params)
        rows = cursor.fetchall()
        return dict(rows[0]) if one and rows else [dict(r) for r in rows]
    finally:
        conn.close()
