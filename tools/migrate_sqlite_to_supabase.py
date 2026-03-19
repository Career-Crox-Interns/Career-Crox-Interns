import json
import os
import sqlite3
from pathlib import Path

import requests
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")
DB_PATH = BASE_DIR / "data" / "career_crox_demo.db"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

HEADERS = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation,resolution=merge-duplicates",
}

TABLES = [
    ("users", "user_id"),
    ("candidates", "candidate_id"),
    ("tasks", "task_id"),
    ("notifications", "notification_id"),
    ("jd_master", "jd_id"),
    ("settings", "setting_key"),
    ("notes", "id"),
    ("messages", "id"),
    ("interviews", "interview_id"),
    ("submissions", "submission_id"),
]


def require_env():
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise SystemExit("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env")
    if not DB_PATH.exists():
        raise SystemExit(f"SQLite DB not found: {DB_PATH}")


def fetch_rows(table_name: str):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    rows = [dict(r) for r in cur.execute(f"SELECT * FROM {table_name}").fetchall()]
    conn.close()
    cleaned = []
    for row in rows:
        item = {}
        for k, v in row.items():
            if v is None:
                item[k] = ""
            elif isinstance(v, (int, float)):
                item[k] = v
            else:
                item[k] = str(v)
        cleaned.append(item)
    return cleaned


def delete_all(table_name: str, key_name: str):
    if key_name == "id":
        params = {"id": "gt.0"}
    else:
        params = {key_name: "not.is.null"}
    r = requests.delete(f"{SUPABASE_URL}/rest/v1/{table_name}", headers=HEADERS, params=params, timeout=60)
    if r.status_code not in (200, 204):
        raise RuntimeError(f"Delete failed for {table_name}: {r.status_code} {r.text}")


def insert_rows(table_name: str, rows, key_name: str):
    if not rows:
        print(f"{table_name}: no rows")
        return
    batch_size = 200
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        params = {"on_conflict": key_name}
        r = requests.post(f"{SUPABASE_URL}/rest/v1/{table_name}", headers=HEADERS, params=params, data=json.dumps(batch), timeout=60)
        if r.status_code not in (200, 201):
            raise RuntimeError(f"Insert failed for {table_name}: {r.status_code} {r.text}")
    print(f"{table_name}: inserted {len(rows)} rows")


def main():
    require_env()
    for table_name, key_name in TABLES:
        rows = fetch_rows(table_name)
        delete_all(table_name, key_name)
        insert_rows(table_name, rows, key_name)
    print("SQLite -> Supabase migration completed.")


if __name__ == "__main__":
    main()
