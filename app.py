
import json
import os
import random
import re
import secrets
import sqlite3
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path
from urllib.parse import quote

import openpyxl
import requests
from dotenv import load_dotenv
from flask import Flask, abort, flash, g, jsonify, redirect, render_template, render_template_string, request, session, url_for

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
load_dotenv(BASE_DIR / ".env")
DATA_DIR = BASE_DIR / "data"
SEED_FILE = Path(os.environ.get("SEED_XLSX_PATH", str(BASE_DIR / "sample_data" / "Career_Crox_Interns_Seed.xlsx")))
DB_PATH = DATA_DIR / "career_crox_demo.db"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
USE_SUPABASE = bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)

print("BASE_DIR =", BASE_DIR)
print("TEMPLATES_DIR =", TEMPLATES_DIR, "exists =", TEMPLATES_DIR.exists())
print("LOGIN_TEMPLATE =", TEMPLATES_DIR / "login.html", "exists =", (TEMPLATES_DIR / "login.html").exists())

app = Flask(__name__, template_folder=str(TEMPLATES_DIR), static_folder=str(STATIC_DIR))
app.secret_key = os.environ.get("SECRET_KEY", "career-crox-demo-secret-key")

SIDEBAR_ITEMS = [
    ("Dashboard", "dashboard", {}),
    ("Candidates", "candidates", {}),
    ("Submissions", "submissions", {}),
    ("Submission Slice", "submission_slice", {}),
    ("JD Centre", "jds", {}),
    ("Interviews", "interviews", {}),
    ("Tasks", "tasks", {}),
    ("Dialer", "module_page", {"slug": "dialer"}),
    ("Meeting Room", "module_page", {"slug": "meeting-room"}),
    ("Learning Hub", "module_page", {"slug": "learning-hub"}),
    ("Social Career Crox", "module_page", {"slug": "social-career-crox"}),
    ("Wallet & Rewards", "module_page", {"slug": "wallet-rewards"}),
    ("Payout Tracker", "module_page", {"slug": "payout-tracker"}),
    ("Reports", "module_page", {"slug": "reports"}),
    ("Recent Activity", "recent_activity_page", {}),
    ("Admin Control", "admin_page", {}),
]

MODULE_SUMMARIES = {
    "dialer": {
        "title": "Dialer Command Center",
        "summary": "Call outcomes, talktime, callback suggestions, and recruiter productivity in one place.",
        "cards": [("Connected Today", "64"), ("Callbacks Due", "18"), ("Talktime", "06h 42m"), ("Best Hour", "10-11 AM")],
        "items": ["One-click dial flow", "Call outcome popup", "Hourly scoreboard", "Talktime analytics", "Follow-up suggestion engine"]
    },
    "meeting-room": {
        "title": "Meeting Room",
        "summary": "Create, join, and monitor internal meetings with attendance and quick notes.",
        "cards": [("Meetings Today", "7"), ("Live Rooms", "2"), ("Attendance Rate", "91%"), ("Pending Minutes", "3")],
        "items": ["Create Meeting", "Join Meeting", "Attendance", "Raise Hand", "Meeting chat"]
    },
    "learning-hub": {
        "title": "Learning Hub",
        "summary": "Training videos, process notes, and coaching clips for recruiters and TLs.",
        "cards": [("Videos", "24"), ("Playlists", "6"), ("Completion", "72%"), ("New This Week", "4")],
        "items": ["Airtel process videos", "Interview objection handling", "Salary negotiation tips", "Manager coaching clips"]
    },
    "social-career-crox": {
        "title": "Social Career Crox",
        "summary": "Plan social posts, manage queue, and track posting status across platforms.",
        "cards": [("Queued Posts", "12"), ("Posted", "41"), ("Missed", "2"), ("This Week Reach", "8.2k")],
        "items": ["Schedule Post", "Post Queue", "Posted Posts", "Missed Posts", "Platform filters"]
    },
    "wallet-rewards": {
        "title": "Wallet & Rewards",
        "summary": "Trips, reward milestones, and streak-based motivation without the fake motivational posters.",
        "cards": [("Reward Budget", "₹42,000"), ("Eligible Recruiters", "6"), ("Nearest Milestone", "2 joinings"), ("Trips Active", "3")],
        "items": ["20 Joining → Goa Trip", "10 Interview Conversions → Bonus", "Monthly target streak", "Reward history"]
    },
    "payout-tracker": {
        "title": "Payout Tracker",
        "summary": "Eligibility, confirmations, invoice readiness, and team-wise payout visibility.",
        "cards": [("Eligible Profiles", "11"), ("Client Confirmations", "8"), ("Invoice Ready", "6"), ("Pending Cases", "5")],
        "items": ["Recruiter earning view", "Team earnings", "Target vs achieved", "60-day eligible tracker", "Dispute notes"]
    },
    "reports": {
        "title": "Reports",
        "summary": "Funnel, conversion, source, and location reports for managers who enjoy charts more than chaos.",
        "cards": [("Lead → Join", "8.6%"), ("Top Source", "Naukri"), ("Top City", "Noida"), ("Top Recruiter", "Ritika")],
        "items": ["Daily report", "Weekly funnel", "Source performance", "Location analytics", "Recruiter efficiency"]
    }
}

SAMPLE_PUBLIC_NOTES = [
    ("C001", "recruiter.01", "public", "Candidate confirmed she can attend interview tomorrow around 11 AM.", -2),
    ("C003", "recruiter.02", "public", "Strong communication and ready for final round.", -1),
    ("C004", "admin", "public", "Reschedule approved. Keep candidate warm and confirm next slot.", -1),
]

SAMPLE_PRIVATE_NOTES = [
    ("C001", "recruiter.01", "private", "Responds faster after 6 PM. Daytime follow-up is messy.", -1),
    ("C003", "admin", "private", "Useful benchmark profile for this process.", -2),
]

SAMPLE_MESSAGES = [
    ("admin", "tl.noida", "Please review pending Airtel profiles today.", -1),
    ("tl.noida", "recruiter.01", "Do a proper callback and update note history.", -1),
    ("recruiter.01", "tl.noida", "Done. Candidate is responsive.", 0),
]

THEME_ALIASES = {
    "midnight": "dark-midnight",
    "cobalt": "ocean",
    "graphite": "dark-pro",
    "forest": "mint",
    "sunset": "sunset",
    "lavender": "lavender",
    "silver": "silver-pro",
    "silver-pro": "silver-pro",
    "dark": "dark-pro",
    "dark-pro": "dark-pro",
    "dark-midnight": "dark-midnight",
    "dark-vscode": "dark-vscode",
    "ocean": "ocean",
    "mint": "mint",
    "rose": "rose",
    "corporate-light": "corporate-light",
}

ALLOWED_THEMES = {
    "corporate-light", "ocean", "rose", "mint", "sunset",
    "lavender", "dark-pro", "dark-midnight", "dark-vscode", "silver-pro"
}

TABLE_COLUMNS = {
    "users": {"user_id","username","password","full_name","designation","role","recruiter_code","is_active","theme_name","updated_at"},
    "candidates": {"candidate_id","full_name","phone","qualification","location","experience","preferred_location","qualification_level","total_experience","relevant_experience","in_hand_salary","career_gap","documents_availability","communication_skill","relevant_experience_range","relevant_in_hand_range","submission_date","process","recruiter_code","recruiter_name","recruiter_designation","status","all_details_sent","interview_reschedule_date","is_duplicate","notes","resume_filename","recording_filename","created_at","updated_at"},
    "tasks": {"task_id","title","description","assigned_to_user_id","assigned_to_name","assigned_by_user_id","assigned_by_name","status","priority","due_date","created_at","updated_at"},
    "notifications": {"notification_id","user_id","title","message","category","status","metadata","created_at"},
    "jd_master": {"jd_id","job_title","company","location","experience","salary","notes","created_at"},
    "settings": {"setting_key","setting_value","notes","Instructions"},
    "notes": {"candidate_id","username","note_type","body","created_at"},
    "messages": {"sender_username","recipient_username","body","created_at"},
    "interviews": {"interview_id","candidate_id","jd_id","stage","scheduled_at","status","created_at"},
    "submissions": {"submission_id","candidate_id","jd_id","recruiter_code","status","submitted_at"},
}

def trim_to_columns(rows, table_name):
    allowed = TABLE_COLUMNS[table_name]
    out = []
    for row in rows:
        out.append({k: row.get(k, "") for k in allowed if k in row})
    return out


def now_iso():
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

def display_ts(value, default=""):
    if not value:
        return default
    text = str(value).replace("T", " ").strip()
    return text[:16]

def normalize_theme(theme_name):
    theme_name = (theme_name or "").strip()
    mapped = THEME_ALIASES.get(theme_name, theme_name)
    return mapped if mapped in ALLOWED_THEMES else "corporate-light"

def normalize_role(role):
    role = (role or "").strip().lower()
    if role in {"admin", "manager", "operations", "ops"}:
        return "manager"
    if role in {"tl", "team lead", "lead"}:
        return "tl"
    return "recruiter"

def to_boolish(val):
    return str(val).strip().lower() in {"1", "true", "yes", "y"}

def clean_row(row):
    cleaned = {}
    for k, v in row.items():
        if k is None:
            continue
        if isinstance(v, datetime):
            cleaned[k] = v.isoformat()
        elif v is None:
            cleaned[k] = ""
        else:
            cleaned[k] = str(v).strip() if not isinstance(v, (int, float)) else str(v)
    return cleaned

def parse_sheet_rows(xlsx_path, sheet_name):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    if sheet_name not in wb.sheetnames:
        return []
    ws = wb[sheet_name]
    raw_headers = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
    headers = [str(h).strip() if h is not None else None for h in raw_headers]
    rows = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if all(v in (None, "") for v in row):
            continue
        item = {}
        for idx, value in enumerate(row):
            key = headers[idx] if idx < len(headers) else None
            if not key:
                continue
            item[key] = value
        if item:
            rows.append(clean_row(item))
    wb.close()
    return rows

def derive_seed_payload(xlsx_path):
    users = parse_sheet_rows(xlsx_path, "Users")
    candidates = parse_sheet_rows(xlsx_path, "Candidates")
    tasks = parse_sheet_rows(xlsx_path, "Tasks")
    notifications = parse_sheet_rows(xlsx_path, "Notifications")
    jds = parse_sheet_rows(xlsx_path, "JD_Master")
    settings = parse_sheet_rows(xlsx_path, "Settings")

    if not users:
        users = [
            {"user_id": "U001", "username": "admin", "password": "Admin@123", "full_name": "Ava Operations", "designation": "Admin", "role": "admin", "recruiter_code": "ADMIN", "is_active": "1", "theme_name": "corporate-light", "updated_at": now_iso()},
            {"user_id": "U002", "username": "tl.noida", "password": "TL@12345", "full_name": "Rhea Team Lead", "designation": "Team Lead", "role": "tl", "recruiter_code": "TL-ND", "is_active": "1", "theme_name": "corporate-light", "updated_at": now_iso()},
            {"user_id": "U003", "username": "recruiter.01", "password": "Rec@12345", "full_name": "Arjun Recruiter", "designation": "Recruiter", "role": "recruiter", "recruiter_code": "RC-101", "is_active": "1", "theme_name": "corporate-light", "updated_at": now_iso()},
        ]
    if not candidates:
        candidates = [
            {"candidate_id": "C001", "full_name": "Neha Sharma", "phone": "9876543210", "qualification": "B.A.", "location": "Delhi", "experience": "6 Months", "preferred_location": "Noida", "qualification_level": "Graduate", "total_experience": "6", "relevant_experience": "4", "in_hand_salary": "18000", "career_gap": "Currently Working", "documents_availability": "Yes", "communication_skill": "Good", "relevant_experience_range": "4-6 Months", "relevant_in_hand_range": "16-20K", "submission_date": datetime.now().strftime("%Y-%m-%d"), "process": "Airtel", "recruiter_code": "RC-101", "recruiter_name": "Arjun Recruiter", "recruiter_designation": "Recruiter", "status": "New", "all_details_sent": "Pending", "interview_reschedule_date": "", "is_duplicate": "0", "notes": "Interested in voice process", "resume_filename": "", "recording_filename": "", "created_at": now_iso(), "updated_at": now_iso()},
        ]
    if not tasks:
        tasks = [
            {"task_id": "T001", "title": "Verify pending Airtel profiles", "description": "Review document status for Airtel candidates.", "assigned_to_user_id": "U003", "assigned_to_name": "Arjun Recruiter", "assigned_by_user_id": "U002", "assigned_by_name": "Rhea Team Lead", "status": "Open", "priority": "High", "due_date": datetime.now().strftime("%Y-%m-%d"), "created_at": now_iso(), "updated_at": now_iso()}
        ]
    if not notifications:
        notifications = [
            {"notification_id": "N001", "user_id": "U003", "title": "Seed imported", "message": "Candidate and user data loaded into CRM.", "category": "system", "status": "Unread", "metadata": "{}", "created_at": now_iso()}
        ]
    if not jds:
        jds = [
            {"jd_id": "J001", "job_title": "Customer Support Associate", "company": "Airtel", "location": "Noida", "experience": "0-12 Months", "salary": "16K-22K", "notes": "Voice support process", "created_at": now_iso()}
        ]
    if not settings:
        settings = [
            {"setting_key": "company_name", "setting_value": "Career Crox", "notes": "Replace with your company name", "Instructions": "Supabase-backed CRM configuration"},
            {"setting_key": "default_theme", "setting_value": "corporate-light", "notes": "One of the built-in themes", "Instructions": "User-specific themes are stored in users.theme_name"},
        ]

    usernames = [u.get("username", "") for u in users]
    candidate_codes = [c.get("candidate_id", "") for c in candidates]
    now = datetime.now()
    notes = []
    for candidate_id, username, note_type, body, day_offset in SAMPLE_PUBLIC_NOTES + SAMPLE_PRIVATE_NOTES:
        if candidate_id in candidate_codes and username in usernames:
            notes.append({
                "candidate_id": candidate_id,
                "username": username,
                "note_type": note_type,
                "body": body,
                "created_at": (now + timedelta(days=day_offset, hours=random.randint(8, 18))).isoformat(timespec="seconds")
            })

    messages = []
    for sender, recipient, body, day_offset in SAMPLE_MESSAGES:
        if sender in usernames and recipient in usernames:
            messages.append({
                "sender_username": sender,
                "recipient_username": recipient,
                "body": body,
                "created_at": (now + timedelta(days=day_offset, hours=random.randint(8, 18))).isoformat(timespec="seconds")
            })

    interviews = []
    submissions = []
    for idx, c in enumerate(candidates, start=1):
        candidate_id = c.get("candidate_id") or f"C{idx:03d}"
        process = c.get("process") or ""
        jd_match = next((j for j in jds if (j.get("company") or "").strip().lower() == process.strip().lower()), None)
        jd_id = jd_match.get("jd_id") if jd_match else ""
        status = c.get("status") or "New"
        submitted_at = c.get("submission_date") or now.strftime("%Y-%m-%d")
        submissions.append({
            "submission_id": f"S{idx:03d}",
            "candidate_id": candidate_id,
            "jd_id": jd_id,
            "recruiter_code": c.get("recruiter_code", ""),
            "status": status,
            "submitted_at": submitted_at
        })
        if "interview" in status.lower() or c.get("interview_reschedule_date"):
            when = c.get("interview_reschedule_date") or f"{submitted_at} 11:00"
            interviews.append({
                "interview_id": f"I{idx:03d}",
                "candidate_id": candidate_id,
                "jd_id": jd_id,
                "stage": status,
                "scheduled_at": when,
                "status": "Scheduled" if "reschedule" not in status.lower() else "Rescheduled",
                "created_at": now_iso()
            })

    return {
        "users": trim_to_columns(users, "users"),
        "candidates": trim_to_columns(candidates, "candidates"),
        "tasks": trim_to_columns(tasks, "tasks"),
        "notifications": trim_to_columns(notifications, "notifications"),
        "jd_master": trim_to_columns(jds, "jd_master"),
        "settings": trim_to_columns(settings, "settings"),
        "notes": trim_to_columns(notes, "notes"),
        "messages": trim_to_columns(messages, "messages"),
        "interviews": trim_to_columns(interviews, "interviews"),
        "submissions": trim_to_columns(submissions, "submissions"),
    }

class SQLiteBackend:
    def __init__(self, db_path, seed_file):
        self.db_path = str(db_path)
        self.seed_file = Path(seed_file)
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self._seed_if_empty()

    def describe(self):
        return {"store_mode": "sqlite-demo", "seed_file": str(self.seed_file)}

    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=10, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA temp_store=MEMORY")
        conn.execute("PRAGMA cache_size=-20000")
        conn.execute("PRAGMA busy_timeout=10000")
        return conn

    def _init_db(self):
        conn = self._connect()
        cur = conn.cursor()
        cur.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            username TEXT UNIQUE,
            password TEXT,
            full_name TEXT,
            designation TEXT,
            role TEXT,
            recruiter_code TEXT,
            is_active TEXT,
            theme_name TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS candidates (
            candidate_id TEXT PRIMARY KEY,
            full_name TEXT,
            phone TEXT,
            qualification TEXT,
            location TEXT,
            experience TEXT,
            preferred_location TEXT,
            qualification_level TEXT,
            total_experience TEXT,
            relevant_experience TEXT,
            in_hand_salary TEXT,
            career_gap TEXT,
            documents_availability TEXT,
            communication_skill TEXT,
            relevant_experience_range TEXT,
            relevant_in_hand_range TEXT,
            submission_date TEXT,
            process TEXT,
            recruiter_code TEXT,
            recruiter_name TEXT,
            recruiter_designation TEXT,
            status TEXT,
            all_details_sent TEXT,
            interview_reschedule_date TEXT,
            is_duplicate TEXT,
            notes TEXT,
            resume_filename TEXT,
            recording_filename TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS tasks (
            task_id TEXT PRIMARY KEY,
            title TEXT,
            description TEXT,
            assigned_to_user_id TEXT,
            assigned_to_name TEXT,
            assigned_by_user_id TEXT,
            assigned_by_name TEXT,
            status TEXT,
            priority TEXT,
            due_date TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS notifications (
            notification_id TEXT PRIMARY KEY,
            user_id TEXT,
            title TEXT,
            message TEXT,
            category TEXT,
            status TEXT,
            metadata TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS jd_master (
            jd_id TEXT PRIMARY KEY,
            job_title TEXT,
            company TEXT,
            location TEXT,
            experience TEXT,
            salary TEXT,
            notes TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT,
            notes TEXT,
            Instructions TEXT
        );
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id TEXT,
            username TEXT,
            note_type TEXT,
            body TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_username TEXT,
            recipient_username TEXT,
            body TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS interviews (
            interview_id TEXT PRIMARY KEY,
            candidate_id TEXT,
            jd_id TEXT,
            stage TEXT,
            scheduled_at TEXT,
            status TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS submissions (
            submission_id TEXT PRIMARY KEY,
            candidate_id TEXT,
            jd_id TEXT,
            recruiter_code TEXT,
            status TEXT,
            submitted_at TEXT
        );
        """)
        cur.executescript("""
        CREATE INDEX IF NOT EXISTS idx_candidates_phone ON candidates(phone);
        CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
        CREATE INDEX IF NOT EXISTS idx_candidates_recruiter_code ON candidates(recruiter_code);
        CREATE INDEX IF NOT EXISTS idx_candidates_created_at ON candidates(created_at);
        CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_user_id ON tasks(assigned_to_user_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_notifications_user_id_status ON notifications(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_notes_candidate_id ON notes(candidate_id);
        CREATE INDEX IF NOT EXISTS idx_interviews_candidate_id ON interviews(candidate_id);
        CREATE INDEX IF NOT EXISTS idx_interviews_scheduled_at ON interviews(scheduled_at);
        CREATE INDEX IF NOT EXISTS idx_submissions_candidate_id ON submissions(candidate_id);
        CREATE INDEX IF NOT EXISTS idx_submissions_recruiter_code ON submissions(recruiter_code);
        """)
        conn.commit()
        conn.close()

    def _seed_if_empty(self):
        if self.count("users") > 0:
            return
        payload = derive_seed_payload(self.seed_file) if self.seed_file.exists() else derive_seed_payload("")
        for table, rows in payload.items():
            if rows:
                self.bulk_insert(table, rows)

    def count(self, table):
        conn = self._connect()
        cur = conn.execute(f"SELECT COUNT(*) as c FROM {table}")
        c = cur.fetchone()["c"]
        conn.close()
        return c

    def list_rows(self, table):
        cache = getattr(g, "_table_cache", None)
        if cache is None:
            g._table_cache = {}
            cache = g._table_cache
        if table in cache:
            return [dict(r) for r in cache[table]]
        conn = self._connect()
        rows = [dict(r) for r in conn.execute(f"SELECT * FROM {table}").fetchall()]
        conn.close()
        cache[table] = rows
        return [dict(r) for r in rows]

    def bulk_insert(self, table, rows):
        if not rows:
            return
        if hasattr(g, "_table_cache"):
            g._table_cache.pop(table, None)
        conn = self._connect()
        keys = list(rows[0].keys())
        placeholders = ",".join(["?"] * len(keys))
        sql = f"INSERT INTO {table} ({','.join(keys)}) VALUES ({placeholders})"
        vals = [[row.get(k, "") for k in keys] for row in rows]
        conn.executemany(sql, vals)
        conn.commit()
        conn.close()

    def insert(self, table, row):
        if hasattr(g, "_table_cache"):
            g._table_cache.pop(table, None)
        keys = list(row.keys())
        placeholders = ",".join(["?"] * len(keys))
        conn = self._connect()
        conn.execute(f"INSERT INTO {table} ({','.join(keys)}) VALUES ({placeholders})", [row.get(k, "") for k in keys])
        conn.commit()
        conn.close()

    def update_where(self, table, filters, values):
        if not values:
            return
        if hasattr(g, "_table_cache"):
            g._table_cache.pop(table, None)
        set_sql = ", ".join([f"{k}=?" for k in values.keys()])
        where_sql = " AND ".join([f"{k}=?" for k in filters.keys()])
        params = list(values.values()) + list(filters.values())
        conn = self._connect()
        conn.execute(f"UPDATE {table} SET {set_sql} WHERE {where_sql}", params)
        conn.commit()
        conn.close()

    def delete_where(self, table, filters):
        if hasattr(g, "_table_cache"):
            g._table_cache.pop(table, None)
        where_sql = " AND ".join([f"{k}=?" for k in filters.keys()]) if filters else "1=1"
        params = list(filters.values()) if filters else []
        conn = self._connect()
        conn.execute(f"DELETE FROM {table} WHERE {where_sql}", params)
        conn.commit()
        conn.close()

class SupabaseBackend:
    def __init__(self, url, service_role_key):
        self.url = url.rstrip("/")
        self.key = service_role_key
        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def describe(self):
        return {"store_mode": "supabase", "url": self.url}

    def _request(self, method, path, params=None, json_body=None):
        resp = requests.request(
            method,
            f"{self.url}/rest/v1/{path}",
            headers=self.headers,
            params=params or {},
            json=json_body,
            timeout=20,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Supabase {method} {path} failed: {resp.status_code} {resp.text[:250]}")
        if not resp.text:
            return []
        try:
            return resp.json()
        except Exception:
            return []

    def list_rows(self, table):
        cache = getattr(g, "_table_cache", None)
        if cache is None:
            g._table_cache = {}
            cache = g._table_cache
        cache_key = ("supabase", table)
        if cache_key in cache:
            return [dict(r) for r in cache[cache_key]]
        rows = self._request("GET", table, params={"select": "*"})
        rows = [dict(r) for r in rows]
        cache[cache_key] = rows
        return [dict(r) for r in rows]

    def insert(self, table, row):
        if hasattr(g, "_table_cache"):
            g._table_cache.pop(("supabase", table), None)
            g._table_cache.pop(table, None)
        self._request("POST", table, json_body=row)

    def bulk_insert(self, table, rows):
        if rows:
            if hasattr(g, "_table_cache"):
                g._table_cache.pop(("supabase", table), None)
                g._table_cache.pop(table, None)
            self._request("POST", table, json_body=rows)

    def update_where(self, table, filters, values):
        if hasattr(g, "_table_cache"):
            g._table_cache.pop(("supabase", table), None)
            g._table_cache.pop(table, None)
        params = {"select": "*"}
        for k, v in filters.items():
            params[k] = f"eq.{v}"
        self._request("PATCH", table, params=params, json_body=values)

    def delete_where(self, table, filters):
        if hasattr(g, "_table_cache"):
            g._table_cache.pop(("supabase", table), None)
            g._table_cache.pop(table, None)
        params = {"select": "*"}
        for k, v in filters.items():
            params[k] = f"eq.{v}"
        self._request("DELETE", table, params=params)

def get_backend():
    if "backend" not in g:
        if USE_SUPABASE:
            g.backend = SupabaseBackend(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        else:
            g.backend = SQLiteBackend(DB_PATH, SEED_FILE)
    return g.backend

@app.teardown_appcontext
def close_backend(error=None):
    g.pop("backend", None)

def list_users():
    rows = get_backend().list_rows("users")
    normalized = []
    for row in rows:
        item = dict(row)
        item["role"] = normalize_role(item.get("role"))
        item["app_role"] = item["role"]
        item["theme_name"] = normalize_theme(item.get("theme_name"))
        item["is_active"] = "1" if to_boolish(item.get("is_active", "1")) else "0"
        normalized.append(item)
    return normalized

def user_map(by="username"):
    rows = list_users()
    return {u.get(by): u for u in rows if u.get(by)}

def get_user(username):
    return user_map("username").get(username)

def find_user_by_recruiter_code(code):
    code = (code or "").strip()
    for user in list_users():
        if (user.get("recruiter_code") or "").strip() == code:
            return user
    return None

def visible_private_notes(candidate_id, user):
    notes = [n for n in get_backend().list_rows("notes") if (n.get("candidate_id") or "") == candidate_id and (n.get("note_type") or "") == "private"]
    users = user_map("username")
    if user["role"] != "manager":
        notes = [n for n in notes if (n.get("username") or "") == user["username"]]
    notes.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    for n in notes:
        u = users.get(n.get("username")) or {}
        n["full_name"] = u.get("full_name", n.get("username"))
        n["designation"] = u.get("designation", "")
        n["created_at"] = display_ts(n.get("created_at"))
    return notes

def recruiters_for_filters():
    items = []
    for u in list_users():
        if u["role"] == "recruiter":
            items.append({"username": u.get("recruiter_code") or u.get("username"), "full_name": u.get("full_name", "")})
    return items

def enrich_candidates():
    users_by_code = {u.get("recruiter_code"): u for u in list_users() if u.get("recruiter_code")}
    tl_users = [u for u in list_users() if u["role"] == "tl"]
    jds = get_backend().list_rows("jd_master")
    rows = get_backend().list_rows("candidates")
    enriched = []
    for row in rows:
        item = dict(row)
        item["code"] = item.get("candidate_id", "")
        item["jd_code"] = item.get("process", "")
        item["created_at"] = display_ts(item.get("created_at"))
        item["updated_at"] = display_ts(item.get("updated_at"))
        item["recruiter_code"] = item.get("recruiter_code", "")
        item["experience"] = item.get("experience") or item.get("total_experience") or ""
        user = users_by_code.get(item["recruiter_code"]) or {}
        item["recruiter_name"] = item.get("recruiter_name") or user.get("full_name", "")
        item["recruiter_designation"] = item.get("recruiter_designation") or user.get("designation", "")
        tl = tl_users[0] if tl_users else {}
        item["tl_name"] = tl.get("full_name", "")
        item["tl_username"] = tl.get("username", "")
        jd = next((j for j in jds if (j.get("company") or "").strip().lower() == (item.get("process") or "").strip().lower()), None)
        item["jd_title"] = f"{jd.get('job_title')} • {jd.get('company')}" if jd else (item.get("process") or "")
        item["payout"] = jd.get("salary", "") if jd else ""
        item["jd_status"] = "Open"
        enriched.append(item)
    return enriched

def candidate_map():
    return {c["code"]: c for c in enrich_candidates()}

def get_candidate(code):
    return candidate_map().get(code)

def enrich_notifications():
    users_by_id = user_map("user_id")
    out = []
    for row in get_backend().list_rows("notifications"):
        item = dict(row)
        user = users_by_id.get(item.get("user_id")) or {}
        item["username"] = user.get("username", "")
        item["is_read"] = 1 if (item.get("status") or "").lower() == "read" else 0
        item["created_at"] = display_ts(item.get("created_at"))
        out.append(item)
    out.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return out

def user_notifications(user, candidate_code=None, unread_only=False):
    notifications = enrich_notifications()
    items = []
    for n in notifications:
        if n.get("username") != user["username"]:
            continue
        if candidate_code:
            metadata = n.get("metadata") or ""
            if candidate_code not in metadata and candidate_code != n.get("candidate_id"):
                continue
        if unread_only and n["is_read"]:
            continue
        items.append(n)
    return items

def current_user():
    if hasattr(g, "_current_user_cached"):
        return g._current_user_cached
    uname = session.get("impersonated_as") or session.get("username")
    g._current_user_cached = get_user(uname) if uname else None
    return g._current_user_cached


def _active_session_write(payload, mode="insert"):
    backend = get_backend()
    active_payload = {k: v for k, v in payload.items() if v is not None}
    variants = []
    if mode == "insert":
        variants = [
            active_payload,
            {k: v for k, v in active_payload.items() if k != "ip_address"},
            {k: v for k, v in active_payload.items() if k not in {"ip_address", "user_agent"}},
            {k: v for k, v in active_payload.items() if k in {"username", "session_token", "updated_at"}},
            {k: v for k, v in active_payload.items() if k in {"username", "session_token"}},
            {k: v for k, v in active_payload.items() if k == "username"},
        ]
    else:
        variants = [
            active_payload,
            {k: v for k, v in active_payload.items() if k != "ip_address"},
            {k: v for k, v in active_payload.items() if k not in {"ip_address", "user_agent"}},
            {k: v for k, v in active_payload.items() if k in {"session_token", "updated_at"}},
            {k: v for k, v in active_payload.items() if k == "updated_at"},
        ]
    last_error = None
    tried = set()
    for variant in variants:
        compact = tuple(sorted((k, str(v)) for k, v in variant.items()))
        if not variant or compact in tried:
            continue
        tried.add(compact)
        try:
            if mode == "insert":
                backend.insert("active_sessions", variant)
            else:
                backend.update_where("active_sessions", {"username": payload.get("username")}, variant)
            return True
        except Exception as exc:
            last_error = exc
            continue
    if last_error:
        app.logger.warning("Active session %s fallback failed: %s", mode, last_error)
    return False


def clear_active_session(username):
    if not username:
        return
    try:
        get_backend().delete_where("active_sessions", {"username": username})
    except Exception as exc:
        app.logger.warning("Active session delete skipped for %s: %s", username, exc)


def create_active_session(username, session_token, req=None):
    if not username:
        return False
    req = req or request
    return _active_session_write({
        "username": username,
        "session_token": session_token,
        "ip_address": req.headers.get("X-Forwarded-For", req.remote_addr or ""),
        "user_agent": (req.headers.get("User-Agent", "")[:255]),
        "updated_at": now_iso(),
    }, mode="insert")


def touch_active_session(username, req=None):
    if not username:
        return False
    req = req or request
    return _active_session_write({
        "username": username,
        "ip_address": req.headers.get("X-Forwarded-For", req.remote_addr or ""),
        "user_agent": (req.headers.get("User-Agent", "")[:255]),
        "updated_at": now_iso(),
    }, mode="update")

def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("username"):
            return redirect(url_for("login"))
        return fn(*args, **kwargs)
    return wrapper

def manager_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user or user["role"] != "manager":
            abort(403)
        return fn(*args, **kwargs)
    return wrapper



def pending_submission_requests_for(user):
    if not user:
        return []
    role = normalize_role(user.get("role"))
    rows = []
    visible_ids = visible_candidate_ids(user) if "visible_candidate_ids" in globals() else {c.get("candidate_id") for c in enrich_candidates()}
    for row in get_backend().list_rows("submissions"):
        status = (row.get("approval_status") or row.get("status") or "").strip().lower()
        if status not in {"pending approval", "pending review"}:
            continue
        if role == "recruiter" and row.get("candidate_id") not in visible_ids:
            continue
        rows.append(dict(row))
    rows.sort(key=lambda x: x.get("submitted_at", ""), reverse=True)
    return rows


def pending_unlock_requests_for(user):
    if not user:
        return []
    role = normalize_role(user.get("role"))
    rows = []
    for row in get_backend().list_rows("unlock_requests") if "unlock_requests" in TABLE_COLUMNS else []:
        status = (row.get("status") or "").strip().lower()
        if status != "pending":
            continue
        target = user_map("user_id").get(row.get("user_id")) or {}
        if role == "manager":
            rows.append(dict(row))
        elif role == "tl" and normalize_role(target.get("role")) == "recruiter":
            rows.append(dict(row))
    rows.sort(key=lambda x: x.get("requested_at", ""), reverse=True)
    return rows


def approval_requests_count_for(user):
    return len(pending_submission_requests_for(user)) + len(pending_unlock_requests_for(user))

@app.context_processor
def inject_globals():
    user = current_user()
    unread = len(user_notifications(user, unread_only=True)) if user else 0
    active_theme = normalize_theme((user or {}).get("theme_name"))
    return {
        "sidebar_items": SIDEBAR_ITEMS,
        "current_user_data": user,
        "unread_notifications": unread,
        "approval_requests_count": approval_requests_count_for(user) if user else 0,
        "now": datetime.now(),
        "active_theme": active_theme,
        "display_phone": (lambda phone, _user=user: display_phone_for_user(phone, _user)),
    }


@app.route("/approvals")
@login_required
def approvals_page():
    user = current_user()
    unlock_rows = pending_unlock_requests_for(user)
    submission_rows = []
    candidates_by_id = {c.get("candidate_id"): c for c in enrich_candidates()}
    jds_by_id = {j.get("jd_id"): j for j in get_backend().list_rows("jd_master")}
    for row in pending_submission_requests_for(user):
        item = dict(row)
        c = candidates_by_id.get(item.get("candidate_id"), {})
        jd = jds_by_id.get(item.get("jd_id"), {})
        item["full_name"] = c.get("full_name", item.get("candidate_id", ""))
        item["phone"] = c.get("phone", "")
        item["title"] = jd.get("job_title", c.get("process", ""))
        item["submitted_at_view"] = display_ts(item.get("submitted_at"))
        submission_rows.append(item)
    return render_template("approvals.html", unlock_requests=unlock_rows, submissions=submission_rows)

@app.route("/health")
def health():
    try:
        info = get_backend().describe()
        return {"ok": True, **info}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}, 500

@app.route("/debug_store")
def debug_store():
    info = get_backend().describe()
    sample_users = list_users()[:5]
    sample_candidates = enrich_candidates()[:5]
    return jsonify({"store": info, "users": sample_users, "candidates": sample_candidates})

@app.route("/api/theme", methods=["POST"])
@login_required
def save_theme():
    user = current_user()
    payload = request.get_json(silent=True) or {}
    theme = normalize_theme(payload.get("theme"))
    if theme not in ALLOWED_THEMES:
        return jsonify({"ok": False}), 400
    get_backend().update_where("users", {"user_id": user["user_id"]}, {"theme_name": theme, "updated_at": now_iso()})
    session["theme_name"] = theme
    return jsonify({"ok": True, "theme": theme})

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()
        user = get_user(username)
        if user and user.get("password") == password and to_boolish(user.get("is_active", "1")):
            session.clear()
            session_token = secrets.token_hex(16)
            session["username"] = user["username"]
            session["theme_name"] = normalize_theme(user.get("theme_name"))
            session["session_token"] = session_token
            reset_stale_presence_on_login(user)
            clear_active_session(user["username"])
            create_active_session(user["username"], session_token, request)
            try:
                log_activity(user, "login", metadata={"ip": request.headers.get("X-Forwarded-For", request.remote_addr or ""), "user_agent": request.headers.get("User-Agent", "")[:120]})
            except Exception as exc:
                app.logger.warning("Login activity log skipped: %s", exc)
            flash(f"Welcome back, {user.get('full_name', user['username'])}.", "success")
            return redirect(url_for("dashboard"))
        flash("Invalid login. Check the username/password from your imported Users sheet.", "danger")
    demo_users = sorted(list_users(), key=lambda x: (x.get("role", ""), x.get("full_name", "")))
    login_template_path = TEMPLATES_DIR / "login.html"
    print("Trying login template from:", login_template_path, "exists =", login_template_path.exists())
    if login_template_path.exists():
        return render_template("login.html", demo_users=demo_users)
    fallback_html = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Login - Career Crox CRM</title>
      <style>
        body { font-family: Arial, sans-serif; background: #f5f7fb; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
        .card { background:#fff; padding:30px; border-radius:12px; width:360px; box-shadow:0 10px 30px rgba(0,0,0,0.08); }
        h2 { margin-top:0; margin-bottom:20px; text-align:center; }
        label { display:block; margin-bottom:6px; font-size:14px; font-weight:600; }
        input { width:100%; padding:10px 12px; margin-bottom:16px; border:1px solid #d0d7de; border-radius:8px; box-sizing:border-box; }
        button { width:100%; padding:12px; border:none; background:#2563eb; color:white; border-radius:8px; font-size:15px; cursor:pointer; }
        .flash { margin-bottom:12px; color:#b91c1c; font-size:14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>Career Crox Login</h2>
        {% with messages = get_flashed_messages(with_categories=true) %}
          {% if messages %}
            {% for category, message in messages %}
              <div class="flash">{{ message }}</div>
            {% endfor %}
          {% endif %}
        {% endwith %}
        <form method="POST">
          <label>Username</label>
          <input type="text" name="username" required>
          <label>Password</label>
          <input type="password" name="password" required>
          <button type="submit">Login</button>
        </form>
      </div>
    </body>
    </html>
    """
    return render_template_string(fallback_html, demo_users=demo_users)

@app.route("/logout")
def logout():
    username = session.get("username", "")
    if username:
        clear_active_session(username)
    session.clear()
    flash("Logged out.", "info")
    return redirect(url_for("login"))


@app.before_request
def enforce_single_active_session_v10():
    endpoint = request.endpoint or ""
    if endpoint in {"login", "logout", "static", "health"} or endpoint.startswith("static"):
        return None
    username = session.get("username")
    session_token = session.get("session_token")
    if not username or not session_token:
        return None
    try:
        rows = [dict(r) for r in get_backend().list_rows("active_sessions") if r.get("username") == username]
    except Exception:
        rows = []
    if not rows:
        session.clear()
        return redirect(url_for("login"))
    current = rows[0]
    if current.get("session_token") != session_token:
        session.clear()
        flash("This ID was opened on another device. You have been logged out here.", "danger")
        return redirect(url_for("login"))
    touch_active_session(username, request)
    return None

@app.route("/")
@login_required
def root():
    return redirect(url_for("dashboard"))

@app.route("/dashboard")
@login_required
def dashboard():
    user = current_user()
    candidates = enrich_candidates()
    interviews = get_backend().list_rows("interviews")
    tasks = get_backend().list_rows("tasks")
    users = list_users()

    total_profiles = len([c for c in candidates if not to_boolish(c.get("is_duplicate", "0"))])
    today_calls = max(12, len(candidates) * 3)
    today_str = datetime.now().strftime("%Y-%m-%d")
    interviews_today = len([i for i in interviews if today_str in str(i.get("scheduled_at", ""))])
    active_managers = len([u for u in users if u["role"] in {"manager", "tl"}])

    recent_activity = sorted(candidates, key=lambda x: x.get("created_at", ""), reverse=True)[:6]
    due_tasks = []
    user_by_id = user_map("user_id")
    for task in tasks:
        t = dict(task)
        assigned = user_by_id.get(t.get("assigned_to_user_id")) or {}
        t["full_name"] = assigned.get("full_name", t.get("assigned_to_name", ""))
        t["assigned_to"] = assigned.get("username", "")
        t["due_at"] = t.get("due_date", "")
        due_tasks.append(t)
    due_tasks.sort(key=lambda x: (x.get("status", ""), x.get("due_at", "")))
    due_tasks = due_tasks[:6]

    manager_monitoring = []
    for u in users:
        if u["role"] not in {"recruiter", "tl"}:
            continue
        ccount = len([c for c in candidates if (c.get("recruiter_code") or "") == (u.get("recruiter_code") or "")])
        open_tasks = len([t for t in tasks if t.get("assigned_to_user_id") == u.get("user_id") and (t.get("status") or "") != "Closed"])
        manager_monitoring.append({"full_name": u.get("full_name"), "designation": u.get("designation"), "candidate_count": ccount, "open_tasks": open_tasks})
    manager_monitoring.sort(key=lambda x: (-x["candidate_count"], x["full_name"]))
    manager_monitoring = manager_monitoring[:6]

    unread_notes = user_notifications(user)[:5]
    return render_template("dashboard.html",
        total_profiles=total_profiles,
        today_calls=today_calls,
        interviews_today=interviews_today,
        active_managers=active_managers,
        recent_activity=recent_activity,
        due_tasks=due_tasks,
        manager_monitoring=manager_monitoring,
        unread_notes=unread_notes
    )

@app.route("/candidates")
@login_required
def candidates():
    q = request.args.get("q", "").strip().lower()
    recruiter = request.args.get("recruiter", "").strip()
    status = request.args.get("status", "").strip()
    rows = [c for c in enrich_candidates() if not to_boolish(c.get("is_duplicate", "0"))]
    if q:
        rows = [c for c in rows if q in " ".join([c.get("full_name",""), c.get("phone",""), c.get("location",""), c.get("status",""), c.get("jd_code",""), c.get("recruiter_code","")]).lower()]
    if recruiter:
        rows = [c for c in rows if c.get("recruiter_code") == recruiter]
    if status:
        rows = [c for c in rows if c.get("status") == status]
    rows.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    statuses = sorted({c.get("status", "") for c in enrich_candidates() if c.get("status")})
    return render_template("candidates.html", candidates=rows, q=request.args.get("q",""), recruiters=recruiters_for_filters(), current_recruiter=recruiter, statuses=statuses, current_status=status)

@app.route("/candidate/<candidate_code>")
@login_required
def candidate_detail(candidate_code):
    user = current_user()
    candidate = get_candidate(candidate_code)
    if not candidate:
        abort(404)
    notes = get_backend().list_rows("notes")
    users = user_map("username")
    public_notes = []
    for n in notes:
        if n.get("candidate_id") != candidate_code or n.get("note_type") != "public":
            continue
        item = dict(n)
        u = users.get(item.get("username")) or {}
        item["full_name"] = u.get("full_name", item.get("username", ""))
        item["designation"] = u.get("designation", "")
        item["created_at"] = display_ts(item.get("created_at"))
        public_notes.append(item)
    public_notes.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    private_notes = visible_private_notes(candidate_code, user)
    related_notifications = user_notifications(user, candidate_code=candidate_code)[:8]

    timeline = []
    for s in get_backend().list_rows("submissions"):
        if s.get("candidate_id") == candidate_code:
            timeline.append({"event_type": "Submission", "label": s.get("status", ""), "event_time": display_ts(s.get("submitted_at")), "jd_code": s.get("jd_id", ""), "owner": s.get("recruiter_code","")})
    for i in get_backend().list_rows("interviews"):
        if i.get("candidate_id") == candidate_code:
            timeline.append({"event_type": "Interview", "label": i.get("status", ""), "event_time": display_ts(i.get("scheduled_at")), "jd_code": i.get("jd_id", ""), "owner": ""})
    timeline.sort(key=lambda x: x.get("event_time", ""), reverse=True)

    return render_template("candidate_detail.html",
                           candidate=candidate,
                           public_notes=public_notes,
                           private_notes=private_notes,
                           related_notifications=related_notifications,
                           timeline=timeline)

@app.route("/candidate/<candidate_code>/add-note", methods=["POST"])
@login_required
def add_note(candidate_code):
    user = current_user()
    note_type = request.form.get("note_type", "public")
    body = request.form.get("body", "").strip()

    if not body:
        flash("Empty note save नहीं होगा. Software भी कुछ standards रखता है.", "danger")
        return redirect(url_for("candidate_detail", candidate_code=candidate_code))

    # 1) Save the note
    get_backend().insert("notes", {
        "candidate_id": candidate_code,
        "username": user["username"],
        "note_type": note_type,
        "body": body,
        "created_at": now_iso()
    })

    # 2) Send notifications for public notes without crashing if a notification fails
    candidate = get_candidate(candidate_code)
    if note_type == "public" and candidate:
        try:
            targets = [u for u in list_users() if u["role"] in {"manager", "tl"}]
            owner = find_user_by_recruiter_code(candidate.get("recruiter_code"))
            if owner:
                targets.append(owner)

            dedup = {}
            for t in targets:
                if t.get("user_id"):
                    dedup[t["user_id"]] = t

            preview = body[:90] + ("..." if len(body) > 90 else "")

            for i, target in enumerate(dedup.values(), start=1):
                get_backend().insert("notifications", {
                    "notification_id": f"N{int(datetime.now().timestamp()*1000)}{i}{random.randint(100,999)}",
                    "user_id": target["user_id"],
                    "title": f"Note updated: {candidate.get('full_name', candidate_code)}",
                    "message": f"{user.get('full_name', user['username'])} ({user.get('designation', '')}) added a public note on {candidate.get('full_name', candidate_code)}: {preview}",
                    "category": "note",
                    "status": "Unread",
                    "metadata": json.dumps({"candidate_id": candidate_code}),
                    "created_at": now_iso()
                })
        except Exception as e:
            print("Notification insert failed:", e)

    flash("Note saved successfully.", "success")
    return redirect(url_for("candidate_detail", candidate_code=candidate_code))
    user = current_user()
    note_type = request.form.get("note_type", "public")
    body = request.form.get("body", "").strip()
    if not body:
        flash("Empty note save नहीं होगा. Software भी कुछ standards रखता है.", "danger")
        return redirect(url_for("candidate_detail", candidate_code=candidate_code))
    get_backend().insert("notes", {
        "candidate_id": candidate_code,
        "username": user["username"],
        "note_type": note_type,
        "body": body,
        "created_at": now_iso()
    })
    candidate = get_candidate(candidate_code)
    if note_type == "public" and candidate:
        targets = [u for u in list_users() if u["role"] in {"manager", "tl"}]
        owner = find_user_by_recruiter_code(candidate.get("recruiter_code"))
        if owner:
            targets.append(owner)
        dedup = {}
        for t in targets:
            dedup[t["user_id"]] = t
        preview = body[:90] + ("..." if len(body) > 90 else "")
        for target in dedup.values():
            get_backend().insert("notifications", {
                "notification_id": f"N{int(datetime.now().timestamp()*1000)}{random.randint(10,99)}",
                "user_id": target["user_id"],
                "title": f"Note updated: {candidate['full_name']}",
                "message": f"{user['full_name']} ({user['designation']}) added a public note on {candidate['full_name']}: {preview}",
                "category": "note",
                "status": "Unread",
                "metadata": json.dumps({"candidate_id": candidate_code}),
                "created_at": now_iso()
            })
    flash("Note saved successfully.", "success")
    return redirect(url_for("candidate_detail", candidate_code=candidate_code))

@app.route("/candidate/create", methods=["POST"])
@login_required
def create_candidate():
    recruiter_code = request.form.get("recruiter_code", "").strip()
    owner = find_user_by_recruiter_code(recruiter_code) or current_user()
    all_rows = get_backend().list_rows("candidates")
    next_id = f"C{len(all_rows)+1:03d}"
    row = {
        "candidate_id": next_id,
        "full_name": request.form.get("full_name", "").strip(),
        "phone": request.form.get("phone", "").strip(),
        "qualification": request.form.get("qualification", "").strip(),
        "location": request.form.get("location", "").strip(),
        "experience": request.form.get("experience", "").strip(),
        "preferred_location": "",
        "qualification_level": "",
        "total_experience": "",
        "relevant_experience": "",
        "in_hand_salary": "",
        "career_gap": "",
        "documents_availability": "",
        "communication_skill": "",
        "relevant_experience_range": "",
        "relevant_in_hand_range": "",
        "submission_date": datetime.now().strftime("%Y-%m-%d"),
        "process": request.form.get("process", "").strip(),
        "recruiter_code": owner.get("recruiter_code", ""),
        "recruiter_name": owner.get("full_name", ""),
        "recruiter_designation": owner.get("designation", ""),
        "status": request.form.get("status", "New").strip() or "New",
        "all_details_sent": "Pending",
        "interview_reschedule_date": "",
        "is_duplicate": "0",
        "notes": request.form.get("notes", "").strip(),
        "resume_filename": "",
        "recording_filename": "",
        "created_at": now_iso(),
        "updated_at": now_iso()
    }
    if not row["full_name"] or not row["phone"]:
        flash("Candidate name and phone are required.", "danger")
        return redirect(url_for("candidates"))
    get_backend().insert("candidates", row)
    if owner:
        get_backend().insert("notifications", {
            "notification_id": f"N{int(datetime.now().timestamp()*1000)}{random.randint(10,99)}",
            "user_id": owner["user_id"],
            "title": "New candidate added",
            "message": f"{row['full_name']} was added to the CRM.",
            "category": "candidate",
            "status": "Unread",
            "metadata": json.dumps({"candidate_id": next_id}),
            "created_at": now_iso()
        })
    flash(f"Candidate {row['full_name']} added.", "success")
    return redirect(url_for("candidate_detail", candidate_code=next_id))

@app.route("/jds")
@login_required
def jds():
    status = request.args.get("status", "").strip()
    q = request.args.get("q", "").strip().lower()
    rows = [dict(r) for r in get_backend().list_rows("jd_master")]
    for row in rows:
        row["code"] = row.get("jd_id", "")
        row["title"] = row.get("job_title", "")
        row["status"] = "Open"
        row["experience_required"] = row.get("experience", "")
        row["payout"] = row.get("salary", "")
        row["payout_days"] = "60"
    if q:
        rows = [r for r in rows if q in " ".join([r.get("jd_id",""), r.get("job_title",""), r.get("company",""), r.get("location","")]).lower()]
    if status:
        rows = [r for r in rows if r.get("status") == status]
    status_choices = ["Open"]
    rows.sort(key=lambda x: x.get("code",""))
    return render_template("jds.html", jds=rows, status=status, status_choices=status_choices, q=request.args.get("q",""))

@app.route("/jd/create", methods=["POST"])
@login_required
def create_jd():
    rows = get_backend().list_rows("jd_master")
    jd_id = f"J{len(rows)+1:03d}"
    row = {
        "jd_id": jd_id,
        "job_title": request.form.get("job_title", "").strip(),
        "company": request.form.get("company", "").strip(),
        "location": request.form.get("location", "").strip(),
        "experience": request.form.get("experience", "").strip(),
        "salary": request.form.get("salary", "").strip(),
        "notes": request.form.get("notes", "").strip(),
        "created_at": now_iso()
    }
    if not row["job_title"] or not row["company"]:
        flash("JD title and company are required.", "danger")
        return redirect(url_for("jds"))
    get_backend().insert("jd_master", row)
    flash(f"JD {row['job_title']} added.", "success")
    return redirect(url_for("jds"))

@app.route("/interviews")
@login_required
def interviews():
    current_stage = request.args.get("stage", "All")
    interviews = []
    candidates_by_id = candidate_map()
    jd_by_id = {j.get("jd_id"): j for j in get_backend().list_rows("jd_master")}
    for row in get_backend().list_rows("interviews"):
        item = dict(row)
        candidate = candidates_by_id.get(item.get("candidate_id")) or {}
        jd = jd_by_id.get(item.get("jd_id")) or {}
        item["full_name"] = candidate.get("full_name", "")
        item["title"] = jd.get("job_title", candidate.get("process", ""))
        if current_stage != "All" and item.get("stage") != current_stage:
            continue
        interviews.append(item)
    interviews.sort(key=lambda x: x.get("scheduled_at",""))
    return render_template("interviews.html", interviews=interviews, current_stage=current_stage)

@app.route("/interview/create", methods=["POST"])
@login_required
def create_interview():
    candidate_id = request.form.get("candidate_id", "").strip()
    jd_id = request.form.get("jd_id", "").strip()
    stage = request.form.get("stage", "").strip() or "Screening"
    scheduled_at = request.form.get("scheduled_at", "").strip()
    if not candidate_id or not scheduled_at:
        flash("Candidate ID and schedule time are required.", "danger")
        return redirect(url_for("interviews"))
    rows = get_backend().list_rows("interviews")
    row = {
        "interview_id": f"I{len(rows)+1:03d}",
        "candidate_id": candidate_id,
        "jd_id": jd_id,
        "stage": stage,
        "scheduled_at": scheduled_at,
        "status": "Scheduled",
        "created_at": now_iso()
    }
    get_backend().insert("interviews", row)
    flash(f"Interview scheduled for {candidate_id}.", "success")
    return redirect(url_for("interviews"))

@app.route("/tasks")
@login_required
def tasks():
    user = current_user()
    rows = []
    users_by_id = user_map("user_id")
    raw = get_backend().list_rows("tasks")
    for t in raw:
        item = dict(t)
        assigned_user = users_by_id.get(item.get("assigned_to_user_id")) or {}
        item["full_name"] = assigned_user.get("full_name", item.get("assigned_to_name", ""))
        item["due_at"] = item.get("due_date", "")
        if user["role"] != "manager" and item.get("assigned_to_user_id") != user["user_id"]:
            continue
        rows.append(item)
    rows.sort(key=lambda x: x.get("due_at",""))
    return render_template("tasks.html", tasks=rows)

@app.route("/task/create", methods=["POST"])
@login_required
def create_task():
    target = get_user(request.form.get("assigned_to_username", "").strip())
    creator = current_user()
    if not target:
        flash("Assigned username not found.", "danger")
        return redirect(url_for("tasks"))
    rows = get_backend().list_rows("tasks")
    row = {
        "task_id": f"T{len(rows)+1:03d}",
        "title": request.form.get("title", "").strip(),
        "description": request.form.get("description", "").strip(),
        "assigned_to_user_id": target["user_id"],
        "assigned_to_name": target["full_name"],
        "assigned_by_user_id": creator["user_id"],
        "assigned_by_name": creator["full_name"],
        "status": request.form.get("status", "Open").strip() or "Open",
        "priority": request.form.get("priority", "Normal").strip() or "Normal",
        "due_date": request.form.get("due_date", datetime.now().strftime("%Y-%m-%d")),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    if not row["title"]:
        flash("Task title required.", "danger")
        return redirect(url_for("tasks"))
    get_backend().insert("tasks", row)
    get_backend().insert("notifications", {
        "notification_id": f"N{int(datetime.now().timestamp()*1000)}{random.randint(10,99)}",
        "user_id": target["user_id"],
        "title": "Task assigned",
        "message": row["title"],
        "category": "task",
        "status": "Unread",
        "metadata": json.dumps({"task_id": row["task_id"]}),
        "created_at": now_iso()
    })
    flash("Task added.", "success")
    return redirect(url_for("tasks"))

def build_submission_rows():
    candidates_by_id = candidate_map()
    jds_by_id = {j.get("jd_id"): j for j in get_backend().list_rows("jd_master")}
    rows = []
    for s in get_backend().list_rows("submissions"):
        item = dict(s)
        candidate = candidates_by_id.get(item.get("candidate_id")) or {}
        jd = jds_by_id.get(item.get("jd_id")) or {}
        item["full_name"] = candidate.get("full_name", "")
        item["phone"] = candidate.get("phone", "")
        item["company"] = jd.get("company", "")
        item["title"] = jd.get("job_title", candidate.get("process", ""))
        item["submitted_at_view"] = display_ts(item.get("submitted_at"), item.get("submitted_at", ""))
        item["approval_status"] = item.get("approval_status") or item.get("status") or "Draft"
        rows.append(item)
    rows.sort(key=lambda x: x.get("submitted_at", ""), reverse=True)
    return rows


def build_submission_score_rows(rows):
    users_by_code = {u.get("recruiter_code"): u for u in list_users() if u.get("recruiter_code")}
    bucket = {}
    for row in rows:
        code = row.get("recruiter_code") or "-"
        entry = bucket.setdefault(code, {
            "recruiter_code": code,
            "full_name": (users_by_code.get(code) or {}).get("full_name", row.get("recruiter_name", code)),
            "count": 0,
            "approved": 0,
            "pending": 0,
            "rescheduled": 0,
        })
        entry["count"] += 1
        status = (row.get("approval_status") or row.get("status") or "").strip().lower()
        if status == "approved":
            entry["approved"] += 1
        elif status == "rescheduled":
            entry["rescheduled"] += 1
        else:
            entry["pending"] += 1
    score_rows = list(bucket.values())
    score_rows.sort(key=lambda x: (-x["count"], -x["approved"], x["full_name"]))
    for idx, row in enumerate(score_rows, start=1):
        row["rank"] = idx
        row["approval_rate"] = f"{int(round((row['approved'] / row['count']) * 100)) if row['count'] else 0}%"
        if idx == 1:
            row["rank_class"] = "success"
        elif idx == len(score_rows) and len(score_rows) > 1:
            row["rank_class"] = "danger"
        else:
            row["rank_class"] = "info"
    return score_rows


@app.route("/submissions")
@login_required
def submissions():
    rows = build_submission_rows()
    recruiter_scores = build_submission_score_rows(rows)
    pending_count = len([r for r in rows if (r.get("approval_status") or "").lower() in {"pending approval", "draft", "pending"}])
    approved_count = len([r for r in rows if (r.get("approval_status") or "").lower() == "approved"])
    rescheduled_count = len([r for r in rows if (r.get("approval_status") or "").lower() == "rescheduled"])
    return render_template(
        "submissions.html",
        submissions=rows,
        recruiter_scores=recruiter_scores,
        pending_count=pending_count,
        approved_count=approved_count,
        rescheduled_count=rescheduled_count,
    )


def parse_dt_safe(value):
    value = str(value or "").strip()
    if not value:
        return None
    cleaned = value.replace("Z", "")
    for candidate in [cleaned, cleaned.replace("T", " ")]:
        try:
            return datetime.fromisoformat(candidate)
        except Exception:
            pass
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"]:
        try:
            return datetime.strptime(cleaned.replace("T", " "), fmt)
        except Exception:
            pass
    return None


def visible_submission_rows(user):
    visible_ids = visible_candidate_ids(user)
    return [r for r in build_submission_rows() if r.get("candidate_id") in visible_ids]


def visible_interview_rows(user):
    visible_ids = visible_candidate_ids(user)
    candidates_by_id = {c.get("candidate_id") or c.get("code"): c for c in visible_candidates_rows(user)}
    jd_by_id = {j.get("jd_id"): j for j in get_backend().list_rows("jd_master")}
    rows = []
    for row in get_backend().list_rows("interviews"):
        if row.get("candidate_id") not in visible_ids:
            continue
        candidate = candidates_by_id.get(row.get("candidate_id")) or {}
        jd = jd_by_id.get(row.get("jd_id")) or {}
        item = dict(row)
        item["candidate_id"] = item.get("candidate_id", "")
        item["interview_id"] = item.get("interview_id", "")
        item["full_name"] = candidate.get("full_name", "")
        item["phone"] = candidate.get("phone", "")
        item["location"] = candidate.get("location", "")
        item["recruiter_code"] = candidate.get("recruiter_code", "")
        item["recruiter_name"] = candidate.get("recruiter_name", "")
        item["title"] = jd.get("job_title") or candidate.get("process", "")
        item["scheduled_at_raw"] = item.get("scheduled_at", "")
        item["scheduled_at_view"] = display_ts(item.get("scheduled_at"), item.get("scheduled_at", ""))
        rows.append(item)
    rows.sort(key=lambda x: x.get("scheduled_at_raw", ""), reverse=True)
    return rows


def module_rows_for_slice(user, module):
    module = (module or "submissions").strip().lower()
    if module == "candidates":
        rows = []
        for row in visible_candidates_rows(user):
            item = dict(row)
            item["created_at_raw"] = row.get("created_at", "") if "T" in str(row.get("created_at", "")) else row.get("created_at", "")
            item["created_at_view"] = row.get("created_at", "")
            rows.append(item)
        rows.sort(key=lambda x: x.get("created_at_raw", x.get("created_at_view", "")), reverse=True)
        return rows
    if module == "interviews":
        return visible_interview_rows(user)
    rows = []
    for row in visible_submission_rows(user):
        item = dict(row)
        candidate = get_candidate(item.get("candidate_id") or "") or {}
        item["location"] = candidate.get("location", item.get("location", ""))
        item["submitted_at_raw"] = item.get("submitted_at", "")
        rows.append(item)
    rows.sort(key=lambda x: x.get("submitted_at_raw", ""), reverse=True)
    return rows


def module_columns_for_slice(module):
    module = (module or "submissions").strip().lower()
    if module == "candidates":
        return [
            ("candidate_id", "Candidate ID"),
            ("full_name", "Candidate"),
            ("phone", "Phone"),
            ("qualification", "Qualification"),
            ("location", "Location"),
            ("recruiter_code", "Recruiter Code"),
            ("status", "Status"),
            ("process", "Process / JD"),
            ("created_at_view", "Created"),
        ]
    if module == "interviews":
        return [
            ("interview_id", "Interview ID"),
            ("candidate_id", "Candidate ID"),
            ("full_name", "Candidate"),
            ("phone", "Phone"),
            ("recruiter_code", "Recruiter Code"),
            ("location", "Location"),
            ("title", "JD / Process"),
            ("stage", "Stage"),
            ("status", "Status"),
            ("scheduled_at_view", "Interview Date"),
        ]
    return [
        ("submission_id", "Submission ID"),
        ("candidate_id", "Candidate ID"),
        ("full_name", "Candidate"),
        ("phone", "Phone"),
        ("recruiter_code", "Recruiter Code"),
        ("location", "Location"),
        ("title", "JD / Process"),
        ("approval_status", "Approval"),
        ("submitted_at_view", "Submitted"),
    ]


def slice_filter_options(rows, key):
    vals = []
    seen = set()
    for row in rows:
        value = (row.get(key) or "").strip() if isinstance(row.get(key), str) else row.get(key)
        value = str(value or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        vals.append(value)
    return sorted(vals, key=lambda x: x.lower())


def compute_slice_cards(module, rows):
    now = datetime.now()
    today = now.date()
    next_week = today + timedelta(days=7)
    module = (module or "submissions").lower()
    if module == "candidates":
        created_today = sum(1 for r in rows if (parse_dt_safe(r.get("created_at_raw") or r.get("created_at_view")) or now).date() == today if (r.get("created_at_raw") or r.get("created_at_view")))
        interested = sum(1 for r in rows if "interested" in (r.get("status") or "").lower() and "not" not in (r.get("status") or "").lower())
        not_interested = sum(1 for r in rows if "not interested" in (r.get("status") or "").lower() or (r.get("status") or "").lower() == "reject")
        follow_up = sum(1 for r in rows if any(word in (r.get("status") or "").lower() for word in ["follow", "pending", "new", "screen"]))
        return [
            {"id": "total", "label": "Total Profiles", "value": len(rows), "hint": "Current slice"},
            {"id": "today", "label": "Today Added", "value": created_today, "hint": "Date based"},
            {"id": "interested", "label": "Interested", "value": interested, "hint": "Status based"},
            {"id": "followup", "label": "Need Follow-up", "value": follow_up, "hint": "Status based"},
            {"id": "notint", "label": "Not Interested", "value": not_interested, "hint": "Status based"},
        ]
    if module == "interviews":
        scheduled_today = 0
        next7 = 0
        rescheduled = 0
        selected = 0
        for r in rows:
            dt = parse_dt_safe(r.get("scheduled_at_raw") or r.get("scheduled_at_view"))
            if dt and dt.date() == today:
                scheduled_today += 1
            if dt and today <= dt.date() <= next_week:
                next7 += 1
            status = (r.get("status") or "").lower()
            if "resched" in status:
                rescheduled += 1
            if "select" in status:
                selected += 1
        return [
            {"id": "total", "label": "Total Interviews", "value": len(rows), "hint": "Current slice"},
            {"id": "today", "label": "Today Interviews", "value": scheduled_today, "hint": "Date based"},
            {"id": "next7", "label": "Next 7 Days", "value": next7, "hint": "Upcoming"},
            {"id": "rescheduled", "label": "Rescheduled", "value": rescheduled, "hint": "Status based"},
            {"id": "selected", "label": "Selected / Cleared", "value": selected, "hint": "Status based"},
        ]
    submitted_today = 0
    pending = 0
    approved = 0
    rescheduled = 0
    for r in rows:
        dt = parse_dt_safe(r.get("submitted_at_raw") or r.get("submitted_at_view"))
        if dt and dt.date() == today:
            submitted_today += 1
        status = (r.get("approval_status") or r.get("status") or "").lower()
        if status == "approved":
            approved += 1
        elif "resched" in status:
            rescheduled += 1
        else:
            pending += 1
    return [
        {"id": "total", "label": "Total Submissions", "value": len(rows), "hint": "Current slice"},
        {"id": "today", "label": "Today Submitted", "value": submitted_today, "hint": "Date based"},
        {"id": "pending", "label": "Pending Approval", "value": pending, "hint": "Approval based"},
        {"id": "approved", "label": "Approved", "value": approved, "hint": "Approval based"},
        {"id": "rescheduled", "label": "Rescheduled", "value": rescheduled, "hint": "Approval based"},
    ]


@app.route("/submission-slice")
@login_required
def submission_slice():
    user = current_user()
    module = request.args.get("module", "submissions").strip().lower()
    if module not in {"candidates", "interviews", "submissions"}:
        module = "submissions"

    q = request.args.get("q", "").strip().lower()
    recruiter = request.args.get("recruiter", "").strip()
    status = request.args.get("status", "").strip()
    approval = request.args.get("approval", "").strip()
    stage = request.args.get("stage", "").strip()
    location = request.args.get("location", "").strip()
    date_from = request.args.get("date_from", "").strip()
    date_to = request.args.get("date_to", "").strip()
    slice_name = request.args.get("slice_name", "").strip()

    rows = module_rows_for_slice(user, module)
    if q:
        rows = [r for r in rows if q in " ".join([str(v or "") for v in [r.get("candidate_id"), r.get("interview_id"), r.get("submission_id"), r.get("full_name"), r.get("phone"), r.get("title"), r.get("recruiter_code"), r.get("status"), r.get("approval_status"), r.get("stage"), r.get("location")]]).lower()]
    if recruiter:
        rows = [r for r in rows if (r.get("recruiter_code") or "") == recruiter]
    if location:
        rows = [r for r in rows if (r.get("location") or "") == location]
    if status and module in {"candidates", "interviews"}:
        rows = [r for r in rows if (r.get("status") or "") == status]
    if approval and module == "submissions":
        rows = [r for r in rows if (r.get("approval_status") or "") == approval]
    if stage and module == "interviews":
        rows = [r for r in rows if (r.get("stage") or "") == stage]

    if date_from or date_to:
        filtered = []
        start_dt = parse_dt_safe(date_from) if date_from else None
        end_dt = parse_dt_safe(date_to) if date_to else None
        if end_dt:
            end_dt = end_dt + timedelta(days=1)
        for row in rows:
            raw = row.get("created_at_raw") or row.get("submitted_at_raw") or row.get("scheduled_at_raw") or row.get("created_at_view") or row.get("submitted_at_view") or row.get("scheduled_at_view")
            dt = parse_dt_safe(raw)
            if not dt:
                continue
            if start_dt and dt < start_dt:
                continue
            if end_dt and dt >= end_dt:
                continue
            filtered.append(row)
        rows = filtered

    cards = compute_slice_cards(module, rows)
    columns = module_columns_for_slice(module)
    quick_presets = {
        "submissions_today": {"module": "submissions", "slice_name": "Aaj ke submissions", "date_from": datetime.now().strftime("%Y-%m-%d"), "date_to": datetime.now().strftime("%Y-%m-%d")},
        "submissions_pending": {"module": "submissions", "slice_name": "Pending approval", "approval": "Pending Approval"},
        "interviews_today": {"module": "interviews", "slice_name": "Aaj ke interviews", "date_from": datetime.now().strftime("%Y-%m-%d"), "date_to": datetime.now().strftime("%Y-%m-%d")},
        "interviews_next_week": {"module": "interviews", "slice_name": "Next 7 days interviews", "date_from": datetime.now().strftime("%Y-%m-%d"), "date_to": (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")},
    }

    return render_template(
        "submission_slice.html",
        module=module,
        rows=rows,
        columns=columns,
        cards=cards,
        q=request.args.get("q", ""),
        recruiters=slice_filter_options(module_rows_for_slice(user, module), "recruiter_code"),
        statuses=slice_filter_options(module_rows_for_slice(user, module), "status"),
        approvals=slice_filter_options(module_rows_for_slice(user, module), "approval_status"),
        stages=slice_filter_options(module_rows_for_slice(user, module), "stage"),
        locations=slice_filter_options(module_rows_for_slice(user, module), "location"),
        current_recruiter=recruiter,
        current_status=status,
        current_approval=approval,
        current_stage=stage,
        current_location=location,
        current_date_from=date_from,
        current_date_to=date_to,
        slice_name=slice_name,
        quick_presets=quick_presets,
        page_total=len(rows),
    )

@app.route("/notifications")
@login_required
def notifications_page():
    user = current_user()
    rows = user_notifications(user)
    return render_template("notifications.html", notifications=rows)

@app.route("/notifications/mark-all-read")
@login_required
def mark_all_read():
    user = current_user()
    for n in user_notifications(user):
        get_backend().update_where("notifications", {"notification_id": n["notification_id"]}, {"status": "Read"})
    flash("All notifications marked as read.", "success")
    return redirect(url_for("notifications_page"))

@app.route("/chat", methods=["GET", "POST"])
@login_required
def chat_page():
    user = current_user()
    users = [u for u in list_users() if u["username"] != user["username"]]
    users.sort(key=lambda x: (x["role"], x.get("full_name","")))
    selected = request.args.get("with") or (users[0]["username"] if users else None)
    if request.method == "POST":
        recipient = request.form.get("recipient")
        body = request.form.get("body", "").strip()
        if recipient and body:
            get_backend().insert("messages", {
                "sender_username": user["username"],
                "recipient_username": recipient,
                "body": body,
                "created_at": now_iso()
            })
            flash("Message sent.", "success")
            return redirect(url_for("chat_page", **{"with": recipient}))
    convo = []
    if selected:
        for m in get_backend().list_rows("messages"):
            if {m.get("sender_username"), m.get("recipient_username")} == {user["username"], selected}:
                item = dict(m)
                item["sender_name"] = (get_user(item.get("sender_username")) or {}).get("full_name", item.get("sender_username"))
                item["recipient_name"] = (get_user(item.get("recipient_username")) or {}).get("full_name", item.get("recipient_username"))
                convo.append(item)
    convo.sort(key=lambda x: x.get("created_at", ""))
    return render_template("chat.html", users=users, selected=selected, convo=convo)

@app.route("/admin")
@login_required
@manager_required
def admin_page():
    users = sorted(list_users(), key=lambda x: (x["role"], x.get("full_name","")))
    notes = get_backend().list_rows("notes")
    counts = []
    for user in users:
        public_count = len([n for n in notes if n.get("username") == user["username"] and n.get("note_type") == "public"])
        private_count = len([n for n in notes if n.get("username") == user["username"] and n.get("note_type") == "private"])
        counts.append({"full_name": user["full_name"], "public_count": public_count, "private_count": private_count})
    return render_template("admin.html", users=users, notes_count=counts)

@app.route("/admin/impersonate", methods=["POST"])
@login_required
@manager_required
def impersonate_login():
    username = request.form.get("username", "").strip()
    target = get_user(username)
    manager = get_user(session.get("username"))
    if not target or not manager:
        flash("Target account not found.", "danger")
        return redirect(url_for("admin_page"))
    session["impersonator"] = manager["username"]
    session["impersonated_as"] = target["username"]
    flash(f"You are now viewing the account of {target['full_name']}.", "success")
    return redirect(url_for("dashboard"))

@app.route("/admin/stop-impersonation")
@login_required
def stop_impersonation():
    if session.get("impersonator"):
        original = session.get("impersonator")
        session.pop("impersonated_as", None)
        session.pop("impersonator", None)
        session["username"] = original
        flash("Returned to the manager account.", "success")
    return redirect(url_for("admin_page"))

@app.route("/module/<slug>")
@login_required
def module_page(slug):
    module = MODULE_SUMMARIES.get(slug)
    if not module:
        abort(404)
    if slug in {'wallet-rewards','payout-tracker'} and current_user().get('role') != 'manager':
        flash('This section is available to managers only.', 'warning')
        return redirect(url_for('dashboard'))
    dialer_candidates = visible_candidates_rows(current_user()) if slug == "dialer" else []
    meeting_feed = []
    learning_videos = []
    if slug == 'meeting-room':
        meeting_feed = [
            {"name": "Ritika joined", "time": "03:00 PM", "state": "Joined"},
            {"name": "Mohit joined", "time": "03:02 PM", "state": "Joined"},
            {"name": "Barnali left", "time": "03:11 PM", "state": "Left"},
            {"name": "Neha joined", "time": "03:14 PM", "state": "Joined"},
        ]
    if slug == 'learning-hub':
        learning_videos = [
            {"title":"Sales Training (Hindi) | Salesman ke 5 hunar", "url":"https://www.youtube.com/watch?v=Dc1eYELE12c", "thumb":"https://img.youtube.com/vi/Dc1eYELE12c/hqdefault.jpg", "topic":"Sales basics"},
            {"title":"How To Handle Sales Objections | Hindi", "url":"https://www.youtube.com/watch?v=dAtWqrQJlZA", "thumb":"https://img.youtube.com/vi/dAtWqrQJlZA/hqdefault.jpg", "topic":"Objection handling"},
            {"title":"Sales Training 3 | Tonality & Body Language", "url":"https://www.youtube.com/watch?v=6Z7oWBr0Jqc", "thumb":"https://img.youtube.com/vi/6Z7oWBr0Jqc/hqdefault.jpg", "topic":"Confidence"},
            {"title":"Sales Communication Mastery | Hindi", "url":"https://www.youtube.com/watch?v=6a_ETt_NUzg", "thumb":"https://img.youtube.com/vi/6a_ETt_NUzg/hqdefault.jpg", "topic":"Communication"},
            {"title":"Price Negotiation | Sales Tip in Hindi", "url":"https://www.youtube.com/watch?v=-cInsd2w6W8", "thumb":"https://img.youtube.com/vi/-cInsd2w6W8/hqdefault.jpg", "topic":"Negotiation"},
            {"title":"How to Sell Anything to Anyone in Hindi", "url":"https://www.youtube.com/watch?v=wau0anwlL4k", "thumb":"https://img.youtube.com/vi/wau0anwlL4k/hqdefault.jpg", "topic":"Closing"},
            {"title":"5 Sales Strategies for Small Businesses", "url":"https://www.youtube.com/watch?v=Xuvyl4-fbUk", "thumb":"https://img.youtube.com/vi/Xuvyl4-fbUk/hqdefault.jpg", "topic":"Strategy"},
            {"title":"Screening in Recruitment | How to do Screening", "url":"https://www.youtube.com/watch?v=mmAoGT-tMMw", "thumb":"https://img.youtube.com/vi/mmAoGT-tMMw/hqdefault.jpg", "topic":"Screening"},
            {"title":"HR Recruiter Interview Questions and Answers", "url":"https://www.youtube.com/watch?v=sLmI_wJeR4Y", "thumb":"https://img.youtube.com/vi/sLmI_wJeR4Y/hqdefault.jpg", "topic":"Recruiter interview"},
            {"title":"IT Recruiter Interview Questions and Answers", "url":"https://www.youtube.com/watch?v=R_oH9FlU2P0", "thumb":"https://img.youtube.com/vi/R_oH9FlU2P0/hqdefault.jpg", "topic":"Recruiter interview"},
            {"title":"Mock Calling Practice for US IT Recruiter", "url":"https://www.youtube.com/watch?v=GjifoJso5QU", "thumb":"https://img.youtube.com/vi/GjifoJso5QU/hqdefault.jpg", "topic":"Mock call"},
            {"title":"How to Conduct Interview", "url":"https://www.youtube.com/watch?v=VaIX26zGK4g", "thumb":"https://img.youtube.com/vi/VaIX26zGK4g/hqdefault.jpg", "topic":"Interviewing"},
            {"title":"Job Interview Preparation Hindi Playlist", "url":"https://www.youtube.com/playlist?list=PLximbScRxaFOdT4GroCjXKYRME8Es9cKm", "thumb":"https://i.ytimg.com/vi/XLT0Ed16irY/hqdefault.jpg", "topic":"Interview prep"},
            {"title":"Interview Tips & Tricks in Hindi Playlist", "url":"https://www.youtube.com/playlist?list=PLZ7AqTKr0lARkwf4ge22sFCJswm2WvpIm", "thumb":"https://i.ytimg.com/vi/wrzS68NynTE/hqdefault.jpg", "topic":"Interview prep"},
            {"title":"Selling Techniques and Strategies Playlist", "url":"https://www.youtube.com/playlist?list=PLZ7AqTKr0lATOxOD9qep_xCjx0khywv5Q", "thumb":"https://i.ytimg.com/vi/Dc1eYELE12c/hqdefault.jpg", "topic":"Sales playlist"},
            {"title":"Interview Process and Tricks Playlist", "url":"https://www.youtube.com/playlist?list=PLiNJY9A1AeKYk07QanO2oyv9IX81waJkT", "thumb":"https://i.ytimg.com/vi/VqkFrkHwbEM/hqdefault.jpg", "topic":"Interview playlist"},
        ]
    return render_template("module_page.html", module=module, slug=slug, dialer_candidates=dialer_candidates, meeting_feed=meeting_feed, learning_videos=learning_videos)

@app.route("/blueprint")
@login_required
def blueprint_page():
    blueprint_path = BASE_DIR / "docs" / "MEGA_BLUEPRINT_120_PLUS_FEATURES.md"
    context_path = BASE_DIR / "docs" / "CROSS_CHAT_MASTER_CONTEXT.txt"
    blueprint_text = blueprint_path.read_text(encoding="utf-8")
    context_text = context_path.read_text(encoding="utf-8")
    return render_template("blueprint.html", blueprint_text=blueprint_text, context_text=context_text)

@app.route("/preview")
def preview_page():
    demo_users = sorted(list_users(), key=lambda x: (x["role"], x.get("full_name","")))
    return render_template("preview.html", demo_users=demo_users)


# === Career Crox upgraded professional CRM block ===
SIDEBAR_ITEMS = [
    ("Dashboard", "dashboard", {}),
    ("Candidates", "candidates", {}),
    ("JD Centre", "jds", {}),
    ("Interviews", "interviews", {}),
    ("Tasks", "tasks", {}),
    ("Submissions", "submissions", {}),
    ("Attendance & Breaks", "attendance_breaks", {}),
    ("Dialer", "module_page", {"slug": "dialer"}),
    ("Meeting Room", "module_page", {"slug": "meeting-room"}),
    ("Learning Hub", "module_page", {"slug": "learning-hub"}),
    ("Social Career Crox", "module_page", {"slug": "social-career-crox"}),
    ("Wallet & Rewards", "module_page", {"slug": "wallet-rewards"}),
    ("Payout Tracker", "module_page", {"slug": "payout-tracker"}),
    ("Reports", "module_page", {"slug": "reports"}),
    ("Recent Activity", "recent_activity_page", {}),
    ("Admin Control", "admin_page", {}),
]

MODULE_SUMMARIES = {
    "dialer": {
        "title": "Dialer Command Center",
        "summary": "Call queue, follow-ups, recruiter productivity, and quick actions in one view.",
        "cards": [("Connected Today", "64"), ("Callbacks Due", "18"), ("Talktime", "06h 42m"), ("Best Hour", "10-11 AM")],
        "items": ["One-click dial flow", "Call outcome popup", "Hourly scoreboard", "Talktime analytics", "Follow-up suggestion engine"],
    },
    "meeting-room": {
        "title": "Meeting Room",
        "summary": "Create, join, and monitor internal meetings with attendance and quick notes.",
        "cards": [("Meetings Today", "7"), ("Live Rooms", "2"), ("Attendance Rate", "91%"), ("Pending Minutes", "3")],
        "items": ["Create Meeting", "Join Meeting", "Attendance", "Raise Hand", "Meeting chat"],
    },
    "learning-hub": {
        "title": "Learning Hub",
        "summary": "Training videos, process notes, and coaching clips for recruiters and team leads.",
        "cards": [("Videos", "24"), ("Playlists", "6"), ("Completion", "72%"), ("New This Week", "4")],
        "items": ["Airtel process videos", "Interview objection handling", "Salary negotiation tips", "Manager coaching clips"],
    },
    "social-career-crox": {
        "title": "Social Career Crox",
        "summary": "Plan social posts, manage queue, and track posting status across platforms.",
        "cards": [("Queued Posts", "12"), ("Posted", "41"), ("Missed", "2"), ("This Week Reach", "8.2k")],
        "items": ["Schedule Post", "Post Queue", "Posted Posts", "Missed Posts", "Platform filters"],
    },
    "wallet-rewards": {
        "title": "Wallet & Rewards",
        "summary": "Reward milestones, target streaks, and incentive visibility.",
        "cards": [("Reward Budget", "₹42,000"), ("Eligible Recruiters", "6"), ("Nearest Milestone", "2 joinings"), ("Trips Active", "3")],
        "items": ["20 Joining → Goa Trip", "10 Interview Conversions → Bonus", "Monthly target streak", "Reward history"],
    },
    "payout-tracker": {
        "title": "Payout Tracker",
        "summary": "Eligibility, confirmations, invoice readiness, and team-wise payout visibility.",
        "cards": [("Eligible Profiles", "11"), ("Client Confirmations", "8"), ("Invoice Ready", "6"), ("Pending Cases", "5")],
        "items": ["Recruiter earning view", "Team earnings", "Target vs achieved", "60-day eligible tracker", "Dispute notes"],
    },
    "reports": {
        "title": "Reports",
        "summary": "Operational reports for funnel, source, attendance, and recruiter performance.",
        "cards": [("Lead → Join", "8.6%"), ("Top Source", "Naukri"), ("Top City", "Noida"), ("Top Recruiter", "Rabia")],
        "items": ["Daily report", "Weekly funnel", "Source performance", "Location analytics", "Recruiter efficiency"],
    },
}

SAMPLE_PUBLIC_NOTES = [
    ("C001", "rabia.rec", "public", "Candidate confirmed that she can attend the interview tomorrow at 11:00 AM.", -2),
    ("C003", "sakshi.tl", "public", "Communication is strong. Keep this profile warm for the next round.", -1),
    ("C004", "aaryansh.manager", "public", "Reschedule approved. Please confirm the updated slot with the candidate.", -1),
]

SAMPLE_PRIVATE_NOTES = [
    ("C001", "rabia.rec", "private", "Candidate usually responds faster after 6 PM.", -1),
    ("C003", "aaryansh.manager", "private", "Useful benchmark profile for this process.", -2),
]

SAMPLE_MESSAGES = [
    ("aaryansh.manager", "sakshi.tl", "Please review the pending approval queue today.", -1),
    ("sakshi.tl", "rabia.rec", "Please update the profile note history after the callback.", -1),
    ("rabia.rec", "sakshi.tl", "Updated. Candidate is responsive and ready for follow-up.", 0),
]

TABLE_COLUMNS = {
    "users": {"user_id", "username", "password", "full_name", "designation", "role", "recruiter_code", "is_active", "theme_name", "updated_at"},
    "candidates": {"candidate_id", "call_connected", "looking_for_job", "full_name", "phone", "qualification", "location", "preferred_location", "qualification_level", "total_experience", "relevant_experience", "in_hand_salary", "ctc_monthly", "career_gap", "documents_availability", "communication_skill", "relevant_experience_range", "relevant_in_hand_range", "submission_date", "process", "recruiter_code", "recruiter_name", "recruiter_designation", "status", "all_details_sent", "interview_availability", "interview_reschedule_date", "follow_up_at", "follow_up_note", "follow_up_status", "approval_status", "approval_requested_at", "approved_at", "approved_by_name", "is_duplicate", "notes", "resume_filename", "recording_filename", "created_at", "updated_at", "experience"},
    "tasks": {"task_id", "title", "description", "assigned_to_user_id", "assigned_to_name", "assigned_by_user_id", "assigned_by_name", "status", "priority", "due_date", "created_at", "updated_at"},
    "notifications": {"notification_id", "user_id", "title", "message", "category", "status", "metadata", "created_at"},
    "jd_master": {"jd_id", "job_title", "company", "location", "experience", "salary", "pdf_url", "jd_status", "notes", "created_at"},
    "settings": {"setting_key", "setting_value", "notes", "Instructions"},
    "notes": {"candidate_id", "username", "note_type", "body", "created_at"},
    "messages": {"sender_username", "recipient_username", "body", "created_at"},
    "interviews": {"interview_id", "candidate_id", "jd_id", "stage", "scheduled_at", "status", "created_at"},
    "submissions": {"submission_id", "candidate_id", "jd_id", "recruiter_code", "status", "approval_status", "decision_note", "approval_requested_at", "approved_by_name", "approved_at", "approval_rescheduled_at", "submitted_at"},
    "presence": {"user_id", "last_seen_at", "last_page", "is_on_break", "break_reason", "break_started_at", "break_expected_end_at", "total_break_minutes", "locked", "last_call_dial_at", "last_call_candidate_id", "last_call_alert_sent_at", "meeting_joined", "meeting_joined_at", "screen_sharing", "screen_frame_url", "last_screen_frame_at", "work_started_at", "total_work_minutes"},
    "unlock_requests": {"request_id", "user_id", "status", "reason", "requested_at", "approved_by_user_id", "approved_by_name", "approved_at"},
    "activity_log": {"activity_id", "user_id", "username", "action_type", "candidate_id", "metadata", "created_at"},
}

PRIMARY_LOCATIONS = ["Noida", "Gurgaon"]
ADDITIONAL_LOCATIONS = ["Mumbai", "Bangalore", "Chennai", "Pune"]
BREAK_OPTIONS = ["Tea Break", "Lunch Break", "Washroom Break", "Prayer Break", "Technical Issue", "Training Break", "Other"]
CALL_CONNECTED_OPTIONS = ["Yes", "No", "Partially"]
LOOKING_FOR_JOB_OPTIONS = ["Yes", "No"]
DEGREE_OPTIONS = ["Non-Graduate", "Graduate"]
CAREER_GAP_OPTIONS = ["No Gap", "Currently Working", "0-3 Months", "3-6 Months", "6-12 Months", "1+ Year"]
INTERVIEW_AVAILABILITY_OPTIONS = ["Immediate", "Today", "Tomorrow", "This Week", "After Notice Period"]
CANDIDATE_STATUS_OPTIONS = ["Eligible", "Screening Scheduled", "Interview Scheduled", "Interview Done", "Submitted", "Pending Approval", "Approved", "Rejected", "Needs New Interview"]
ALL_DETAILS_SENT_OPTIONS = ["Pending", "Completed"]


def trim_to_columns(rows, table_name):
    allowed = TABLE_COLUMNS[table_name]
    out = []
    for row in rows:
        item = {}
        for key in allowed:
            item[key] = row.get(key, "")
        out.append(item)
    return out


def normalize_phone(phone):
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if digits.startswith("91") and len(digits) > 10:
        digits = digits[-10:]
    return digits[:10]


def display_phone_for_user(phone, user=None):
    digits = normalize_phone(phone)
    role = normalize_role((user or {}).get("role"))
    if not digits:
        return ""
    if role in {"manager", "tl"}:
        return digits
    if len(digits) >= 8:
        return f"{digits[:4]}##{digits[-4:]}"
    return digits


def parse_intish(value, default=0):
    text = str(value or "").strip()
    if not text:
        return default
    filtered = "".join(ch for ch in text if ch.isdigit())
    return int(filtered) if filtered else default


def humanize_minutes(value):
    minutes = max(0, parse_intish(value, 0))
    hours, mins = divmod(minutes, 60)
    if hours:
        return f"{hours}h {mins}m"
    return f"{mins}m"


def parse_floatish(value, default=0.0):
    text = str(value or "").strip()
    if not text:
        return default
    filtered = "".join(ch for ch in text if ch.isdigit() or ch == ".")
    try:
        return float(filtered)
    except Exception:
        return default


def derive_experience_range(value):
    months = parse_intish(value, 0)
    if months <= 0:
        return "Fresher"
    if months <= 3:
        return "0-3 Months"
    if months <= 6:
        return "4-6 Months"
    if months <= 12:
        return "7-12 Months"
    if months <= 24:
        return "1-2 Years"
    return "2+ Years"


def derive_salary_range(value):
    amount = parse_intish(value, 0)
    if amount <= 0:
        return "0"
    if amount <= 10000:
        return "0-10K"
    if amount <= 15000:
        return "10-15K"
    if amount <= 20000:
        return "16-20K"
    if amount <= 25000:
        return "21-25K"
    if amount <= 35000:
        return "26-35K"
    return "35K+"


def parse_local_datetime(raw):
    raw = (raw or "").strip()
    if not raw:
        return ""
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(raw, fmt)
            if fmt == "%Y-%m-%d":
                dt = dt.replace(hour=11, minute=0)
            return dt.strftime("%Y-%m-%d %H:%M")
        except Exception:
            continue
    return raw.replace("T", " ")[:16]


def to_datetime_local(raw):
    text = parse_local_datetime(raw)
    return text.replace(" ", "T") if text else ""


def safe_json_loads(value, default=None):
    if value in (None, ""):
        return default or {}
    if isinstance(value, dict):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default or {}


def ensure_candidate_defaults(item):
    row = dict(item)
    row.setdefault("candidate_id", "")
    row.setdefault("call_connected", "")
    row.setdefault("looking_for_job", "Yes")
    row.setdefault("full_name", "")
    row.setdefault("phone", "")
    row.setdefault("qualification", "")
    row.setdefault("location", "")
    row.setdefault("preferred_location", row.get("location", ""))
    row.setdefault("qualification_level", "")
    row.setdefault("total_experience", row.get("experience", ""))
    row.setdefault("relevant_experience", "")
    row.setdefault("in_hand_salary", "")
    row.setdefault("ctc_monthly", "")
    row.setdefault("career_gap", "")
    row.setdefault("documents_availability", "")
    row.setdefault("communication_skill", "")
    row.setdefault("relevant_experience_range", derive_experience_range(row.get("relevant_experience") or row.get("total_experience")))
    row.setdefault("relevant_in_hand_range", derive_salary_range(row.get("in_hand_salary")))
    row.setdefault("submission_date", datetime.now().strftime("%Y-%m-%d"))
    row.setdefault("process", "")
    row.setdefault("recruiter_code", "")
    row.setdefault("recruiter_name", "")
    row.setdefault("recruiter_designation", "")
    row.setdefault("status", "Eligible")
    row.setdefault("all_details_sent", "Pending")
    row.setdefault("interview_availability", "")
    row.setdefault("interview_reschedule_date", "")
    row.setdefault("follow_up_at", "")
    row.setdefault("follow_up_note", "")
    row.setdefault("follow_up_status", "Open")
    row.setdefault("approval_status", "Draft")
    row.setdefault("approval_requested_at", "")
    row.setdefault("approved_at", "")
    row.setdefault("approved_by_name", "")
    row.setdefault("is_duplicate", "0")
    row.setdefault("notes", "")
    row.setdefault("resume_filename", "")
    row.setdefault("recording_filename", "")
    row.setdefault("created_at", now_iso())
    row.setdefault("updated_at", now_iso())
    row["phone"] = normalize_phone(row.get("phone"))
    row["experience"] = row.get("experience") or row.get("total_experience") or ""
    row["relevant_experience_range"] = derive_experience_range(row.get("relevant_experience") or row.get("total_experience"))
    row["relevant_in_hand_range"] = derive_salary_range(row.get("in_hand_salary"))
    row["interview_reschedule_date"] = parse_local_datetime(row.get("interview_reschedule_date"))
    return row


def derive_seed_payload(xlsx_path):
    users = parse_sheet_rows(xlsx_path, "Users")
    user_by_code = {}
    for u in users:
        u.setdefault("theme_name", "corporate-light")
        u.setdefault("is_active", "1")
        u.setdefault("updated_at", now_iso())
        code = (u.get("recruiter_code") or "").strip()
        if code:
            user_by_code[code] = u

    candidates = [ensure_candidate_defaults(c) for c in parse_sheet_rows(xlsx_path, "Candidates")]
    for idx, c in enumerate(candidates, start=1):
        if not c.get("candidate_id"):
            c["candidate_id"] = f"C{idx:03d}"
        owner = user_by_code.get((c.get("recruiter_code") or "").strip()) or {}
        if owner:
            c["recruiter_name"] = c.get("recruiter_name") or owner.get("full_name", "")
            c["recruiter_designation"] = c.get("recruiter_designation") or owner.get("designation", "")
        if c.get("all_details_sent", "").lower() == "complete":
            c["approval_status"] = c.get("approval_status") or "Approved"
            c["approved_at"] = c.get("approved_at") or c.get("updated_at") or now_iso()
        elif c.get("approval_status") in ("", None):
            c["approval_status"] = "Draft"

    tasks = parse_sheet_rows(xlsx_path, "Tasks")
    notifications = parse_sheet_rows(xlsx_path, "Notifications")
    jds = parse_sheet_rows(xlsx_path, "JD_Master")
    for idx, jd in enumerate(jds, start=1):
        jd.setdefault("jd_id", f"J{idx:03d}")
        jd.setdefault("pdf_url", "")
        jd.setdefault("jd_status", "Open")
        jd.setdefault("created_at", now_iso())
    settings = parse_sheet_rows(xlsx_path, "Settings")
    presence = parse_sheet_rows(xlsx_path, "Presence")
    unlock_requests = parse_sheet_rows(xlsx_path, "Unlock_Requests")
    activity_log = parse_sheet_rows(xlsx_path, "Activity_Log")

    if not settings:
        settings = [
            {"setting_key": "company_name", "setting_value": "Career Crox", "notes": "CRM branding", "Instructions": "Update if needed."},
            {"setting_key": "idle_lock_minutes", "setting_value": "5", "notes": "CRM lock after no movement", "Instructions": "Attendance module uses this value."},
            {"setting_key": "break_limit_minutes", "setting_value": "120", "notes": "Total daily break limit", "Instructions": "More than this may be marked half day."},
        ]

    if not jds:
        jds = [
            {"jd_id": "J001", "job_title": "Customer Support Associate", "company": "Airtel", "location": "Noida", "experience": "0-12 Months", "salary": "16K-22K", "pdf_url": "", "jd_status": "Open", "notes": "Voice support process", "created_at": now_iso()},
        ]

    notes = []
    if not parse_sheet_rows(xlsx_path, "Notes"):
        candidate_codes = {c.get("candidate_id") for c in candidates}
        usernames = {u.get("username") for u in users}
        now = datetime.now()
        for candidate_id, username, note_type, body, day_offset in SAMPLE_PUBLIC_NOTES + SAMPLE_PRIVATE_NOTES:
            if candidate_id in candidate_codes and username in usernames:
                notes.append({
                    "candidate_id": candidate_id,
                    "username": username,
                    "note_type": note_type,
                    "body": body,
                    "created_at": (now + timedelta(days=day_offset, hours=random.randint(8, 18))).isoformat(timespec="seconds"),
                })

    messages = []
    usernames = {u.get("username") for u in users}
    now = datetime.now()
    for sender, recipient, body, day_offset in SAMPLE_MESSAGES:
        if sender in usernames and recipient in usernames:
            messages.append({
                "sender_username": sender,
                "recipient_username": recipient,
                "body": body,
                "created_at": (now + timedelta(days=day_offset, hours=random.randint(8, 18))).isoformat(timespec="seconds"),
            })

    interviews = []
    submissions = []
    for idx, c in enumerate(candidates, start=1):
        process_name = (c.get("process") or "").split(",")[0].strip()
        jd_match = next((j for j in jds if (j.get("company") or "").strip().lower() == process_name.lower()), None)
        jd_id = jd_match.get("jd_id") if jd_match else ""
        submissions.append({
            "submission_id": f"S{idx:03d}",
            "candidate_id": c.get("candidate_id", f"C{idx:03d}"),
            "jd_id": jd_id,
            "recruiter_code": c.get("recruiter_code", ""),
            "status": c.get("status", "Eligible"),
            "approval_status": c.get("approval_status", "Draft"),
            "decision_note": "",
            "approval_requested_at": c.get("approval_requested_at", ""),
            "approved_by_name": c.get("approved_by_name", ""),
            "approved_at": c.get("approved_at", ""),
            "approval_rescheduled_at": "",
            "submitted_at": c.get("submission_date") or datetime.now().strftime("%Y-%m-%d"),
        })
        if c.get("interview_reschedule_date"):
            interviews.append({
                "interview_id": f"I{idx:03d}",
                "candidate_id": c.get("candidate_id", f"C{idx:03d}"),
                "jd_id": jd_id,
                "stage": c.get("status") or "Interview Scheduled",
                "scheduled_at": parse_local_datetime(c.get("interview_reschedule_date")),
                "status": "Scheduled",
                "created_at": now_iso(),
            })

    if not presence:
        presence = []
        for u in users:
            presence.append({
                "user_id": u.get("user_id"),
                "last_seen_at": now_iso(),
                "last_page": "dashboard",
                "is_on_break": "0",
                "break_reason": "",
                "break_started_at": "",
                "break_expected_end_at": "",
                "total_break_minutes": "0",
                "locked": "0",
                "last_call_dial_at": "",
                "last_call_candidate_id": "",
                "last_call_alert_sent_at": "",
                "meeting_joined": "0",
                "meeting_joined_at": "",
                "screen_sharing": "0",
                "screen_frame_url": "",
                "last_screen_frame_at": "",
                "work_started_at": "",
                "total_work_minutes": "0",
            })

    return {
        "users": trim_to_columns(users, "users"),
        "candidates": trim_to_columns(candidates, "candidates"),
        "tasks": trim_to_columns(tasks, "tasks"),
        "notifications": trim_to_columns(notifications, "notifications"),
        "jd_master": trim_to_columns(jds, "jd_master"),
        "settings": trim_to_columns(settings, "settings"),
        "notes": trim_to_columns(notes, "notes"),
        "messages": trim_to_columns(messages, "messages"),
        "interviews": trim_to_columns(interviews, "interviews"),
        "submissions": trim_to_columns(submissions, "submissions"),
        "presence": trim_to_columns(presence, "presence"),
        "unlock_requests": trim_to_columns(unlock_requests, "unlock_requests"),
        "activity_log": trim_to_columns(activity_log, "activity_log"),
    }


def upgraded_sqlite_init_db(self):
    conn = self._connect()
    cur = conn.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        full_name TEXT,
        designation TEXT,
        role TEXT,
        recruiter_code TEXT,
        is_active TEXT,
        theme_name TEXT,
        updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS candidates (
        candidate_id TEXT PRIMARY KEY,
        call_connected TEXT,
        looking_for_job TEXT,
        full_name TEXT,
        phone TEXT,
        qualification TEXT,
        location TEXT,
        preferred_location TEXT,
        qualification_level TEXT,
        total_experience TEXT,
        relevant_experience TEXT,
        in_hand_salary TEXT,
        ctc_monthly TEXT,
        career_gap TEXT,
        documents_availability TEXT,
        communication_skill TEXT,
        relevant_experience_range TEXT,
        relevant_in_hand_range TEXT,
        submission_date TEXT,
        process TEXT,
        recruiter_code TEXT,
        recruiter_name TEXT,
        recruiter_designation TEXT,
        status TEXT,
        all_details_sent TEXT,
        interview_availability TEXT,
        interview_reschedule_date TEXT,
        follow_up_at TEXT,
        follow_up_note TEXT,
        follow_up_status TEXT,
        approval_status TEXT,
        approval_requested_at TEXT,
        approved_at TEXT,
        approved_by_name TEXT,
        is_duplicate TEXT,
        notes TEXT,
        resume_filename TEXT,
        recording_filename TEXT,
        created_at TEXT,
        updated_at TEXT,
        experience TEXT
    );
    CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        title TEXT,
        description TEXT,
        assigned_to_user_id TEXT,
        assigned_to_name TEXT,
        assigned_by_user_id TEXT,
        assigned_by_name TEXT,
        status TEXT,
        priority TEXT,
        due_date TEXT,
        created_at TEXT,
        updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS notifications (
        notification_id TEXT PRIMARY KEY,
        user_id TEXT,
        title TEXT,
        message TEXT,
        category TEXT,
        status TEXT,
        metadata TEXT,
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS jd_master (
        jd_id TEXT PRIMARY KEY,
        job_title TEXT,
        company TEXT,
        location TEXT,
        experience TEXT,
        salary TEXT,
        pdf_url TEXT,
        jd_status TEXT,
        notes TEXT,
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT,
        notes TEXT,
        Instructions TEXT
    );
    CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT,
        username TEXT,
        note_type TEXT,
        body TEXT,
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_username TEXT,
        recipient_username TEXT,
        body TEXT,
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS interviews (
        interview_id TEXT PRIMARY KEY,
        candidate_id TEXT,
        jd_id TEXT,
        stage TEXT,
        scheduled_at TEXT,
        status TEXT,
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS submissions (
        submission_id TEXT PRIMARY KEY,
        candidate_id TEXT,
        jd_id TEXT,
        recruiter_code TEXT,
        status TEXT,
        approval_status TEXT,
        decision_note TEXT,
        approval_requested_at TEXT,
        approved_by_name TEXT,
        approved_at TEXT,
        approval_rescheduled_at TEXT,
        submitted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS presence (
        user_id TEXT PRIMARY KEY,
        last_seen_at TEXT,
        last_page TEXT,
        is_on_break TEXT,
        break_reason TEXT,
        break_started_at TEXT,
        break_expected_end_at TEXT,
        total_break_minutes TEXT,
        locked TEXT,
        last_call_dial_at TEXT,
        last_call_candidate_id TEXT,
        last_call_alert_sent_at TEXT,
        meeting_joined TEXT,
        meeting_joined_at TEXT,
        screen_sharing TEXT,
        screen_frame_url TEXT,
        last_screen_frame_at TEXT,
        work_started_at TEXT,
        total_work_minutes TEXT
    );
    CREATE TABLE IF NOT EXISTS unlock_requests (
        request_id TEXT PRIMARY KEY,
        user_id TEXT,
        status TEXT,
        reason TEXT,
        requested_at TEXT,
        approved_by_user_id TEXT,
        approved_by_name TEXT,
        approved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS activity_log (
        activity_id TEXT PRIMARY KEY,
        user_id TEXT,
        username TEXT,
        action_type TEXT,
        candidate_id TEXT,
        metadata TEXT,
        created_at TEXT
    );
    """)
    alter_statements = [
        "ALTER TABLE candidates ADD COLUMN call_connected TEXT",
        "ALTER TABLE candidates ADD COLUMN looking_for_job TEXT",
        "ALTER TABLE candidates ADD COLUMN ctc_monthly TEXT",
        "ALTER TABLE candidates ADD COLUMN interview_availability TEXT",
        "ALTER TABLE candidates ADD COLUMN follow_up_at TEXT",
        "ALTER TABLE candidates ADD COLUMN follow_up_note TEXT",
        "ALTER TABLE candidates ADD COLUMN follow_up_status TEXT",
        "ALTER TABLE candidates ADD COLUMN approval_status TEXT",
        "ALTER TABLE candidates ADD COLUMN approval_requested_at TEXT",
        "ALTER TABLE candidates ADD COLUMN approved_at TEXT",
        "ALTER TABLE candidates ADD COLUMN approved_by_name TEXT",
        "ALTER TABLE candidates ADD COLUMN experience TEXT",
        "ALTER TABLE jd_master ADD COLUMN pdf_url TEXT",
        "ALTER TABLE jd_master ADD COLUMN jd_status TEXT",
        "ALTER TABLE submissions ADD COLUMN approval_status TEXT",
        "ALTER TABLE submissions ADD COLUMN decision_note TEXT",
        "ALTER TABLE submissions ADD COLUMN approval_requested_at TEXT",
        "ALTER TABLE submissions ADD COLUMN approved_by_name TEXT",
        "ALTER TABLE submissions ADD COLUMN approved_at TEXT",
        "ALTER TABLE submissions ADD COLUMN approval_rescheduled_at TEXT",
    ]
    for statement in alter_statements:
        try:
            conn.execute(statement)
        except Exception:
            pass
    conn.commit()
    conn.close()


def upgraded_sqlite_seed_if_empty(self):
    if self.count("users") > 0:
        return
    payload = derive_seed_payload(self.seed_file) if self.seed_file.exists() else derive_seed_payload("")
    for table, rows in payload.items():
        if rows:
            self.bulk_insert(table, rows)


SQLiteBackend._init_db = upgraded_sqlite_init_db
SQLiteBackend._seed_if_empty = upgraded_sqlite_seed_if_empty


def next_prefixed_id(table, key, prefix, width=3):
    max_num = 0
    for row in get_backend().list_rows(table):
        value = str(row.get(key, "")).strip()
        if value.startswith(prefix):
            digits = "".join(ch for ch in value[len(prefix):] if ch.isdigit())
            if digits:
                max_num = max(max_num, int(digits))
    return f"{prefix}{max_num + 1:0{width}d}"


def notify_users(user_ids, title, message, category="info", metadata=None):
    for uid in [u for u in dict.fromkeys(user_ids) if u]:
        try:
            get_backend().insert("notifications", {
                "notification_id": f"N{int(datetime.now().timestamp()*1000)}{random.randint(100,999)}",
                "user_id": uid,
                "title": title,
                "message": message,
                "category": category,
                "status": "Unread",
                "metadata": json.dumps(metadata or {}),
                "created_at": now_iso(),
            })
        except Exception:
            pass


def log_activity(user, action_type, candidate_id="", metadata=None):
    try:
        get_backend().insert("activity_log", {
            "activity_id": f"A{int(datetime.now().timestamp()*1000)}{random.randint(100,999)}",
            "user_id": user.get("user_id", ""),
            "username": user.get("username", ""),
            "action_type": action_type,
            "candidate_id": candidate_id,
            "metadata": json.dumps(metadata or {}),
            "created_at": now_iso(),
        })
    except Exception:
        pass


def existing_submission_for_candidate(candidate_id):
    rows = [dict(r) for r in get_backend().list_rows("submissions") if r.get("candidate_id") == candidate_id]
    rows.sort(key=lambda x: str(x.get("submitted_at", "")), reverse=True)
    return rows[0] if rows else None


def visible_notes(candidate_id, user):
    users = user_map("username")
    out = []
    for n in get_backend().list_rows("notes"):
        if n.get("candidate_id") != candidate_id:
            continue
        note_type = (n.get("note_type") or "public").lower()
        if note_type == "private" and user.get("role") != "manager" and n.get("username") != user.get("username"):
            continue
        item = dict(n)
        profile = users.get(item.get("username")) or {}
        item["full_name"] = profile.get("full_name", item.get("username", ""))
        item["designation"] = profile.get("designation", "")
        item["created_at"] = display_ts(item.get("created_at"))
        item["visibility_label"] = "Private" if note_type == "private" else "Public"
        item["visibility_class"] = "private" if note_type == "private" else "public"
        out.append(item)
    out.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return out


def ensure_presence_rows():
    existing = {r.get("user_id"): r for r in get_backend().list_rows("presence")}
    for user in list_users():
        if user.get("user_id") not in existing:
            get_backend().insert("presence", {
                "user_id": user.get("user_id"),
                "last_seen_at": now_iso(),
                "last_page": "dashboard",
                "is_on_break": "0",
                "break_reason": "",
                "break_started_at": "",
                "break_expected_end_at": "",
                "total_break_minutes": "0",
                "locked": "0",
                "last_call_dial_at": "",
                "last_call_candidate_id": "",
                "last_call_alert_sent_at": "",
                "meeting_joined": "0",
                "meeting_joined_at": "",
                "screen_sharing": "0",
                "screen_frame_url": "",
                "last_screen_frame_at": "",
                "work_started_at": "",
                "total_work_minutes": "0",
            })


def get_presence_for_user(user_id):
    ensure_presence_rows()
    return next((dict(r) for r in get_backend().list_rows("presence") if r.get("user_id") == user_id), None)


def manager_and_tl_users():
    return [u for u in list_users() if u.get("role") in {"manager", "tl"}]


def professional_dashboard():
    user = current_user()
    candidates = [ensure_candidate_defaults(c) for c in enrich_candidates()]
    interviews = [dict(i) for i in get_backend().list_rows("interviews")]
    tasks = [dict(t) for t in get_backend().list_rows("tasks")]
    users = list_users()
    submissions_rows = [dict(s) for s in get_backend().list_rows("submissions")]
    ensure_presence_rows()
    presence_rows = [dict(p) for p in get_backend().list_rows("presence")]

    total_profiles = len([c for c in candidates if not to_boolish(c.get("is_duplicate", "0"))])
    today_calls = max(12, len(candidates) * 3)
    today_str = datetime.now().strftime("%Y-%m-%d")
    interviews_today = len([i for i in interviews if today_str in str(i.get("scheduled_at", ""))])
    active_managers = len([u for u in users if u["role"] in {"manager", "tl"}])
    pending_approvals = len([s for s in submissions_rows if (s.get("approval_status") or "").lower() in {"pending approval", "pending review"}])
    active_workers = len([p for p in presence_rows if not to_boolish(p.get("locked", "0"))])

    recent_activity = sorted(candidates, key=lambda x: x.get("updated_at", x.get("created_at", "")), reverse=True)[:6]
    due_tasks = []
    user_by_id = user_map("user_id")
    for task in tasks:
        t = dict(task)
        assigned = user_by_id.get(t.get("assigned_to_user_id")) or {}
        t["full_name"] = assigned.get("full_name", t.get("assigned_to_name", ""))
        t["assigned_to"] = assigned.get("username", "")
        t["due_at"] = t.get("due_date", "")
        due_tasks.append(t)
    due_tasks.sort(key=lambda x: (x.get("status", ""), x.get("due_at", "")))
    due_tasks = due_tasks[:6]

    manager_monitoring = []
    for u in users:
        if u["role"] not in {"recruiter", "tl"}:
            continue
        ccount = len([c for c in candidates if (c.get("recruiter_code") or "") == (u.get("recruiter_code") or "")])
        open_tasks = len([t for t in tasks if t.get("assigned_to_user_id") == u.get("user_id") and (t.get("status") or "") != "Closed"])
        manager_monitoring.append({"full_name": u.get("full_name"), "designation": u.get("designation"), "candidate_count": ccount, "open_tasks": open_tasks})
    manager_monitoring.sort(key=lambda x: (-x["candidate_count"], x["full_name"]))
    manager_monitoring = manager_monitoring[:6]

    theme_options = [
        {"key": "corporate-light", "label": "Corporate"},
        {"key": "ocean", "label": "Ocean"},
        {"key": "mint", "label": "Mint"},
        {"key": "sunset", "label": "Sunset"},
        {"key": "dark-pro", "label": "Dark Pro"},
        {"key": "silver-pro", "label": "Silver"},
    ]
    return render_template(
        "dashboard.html",
        total_profiles=total_profiles,
        today_calls=today_calls,
        interviews_today=interviews_today,
        active_managers=active_managers,
        recent_activity=recent_activity,
        due_tasks=due_tasks,
        manager_monitoring=manager_monitoring,
        unread_notes=user_notifications(user)[:5],
        pending_approvals=pending_approvals,
        active_workers=active_workers,
        theme_options=theme_options,
    )


def professional_candidates():
    q = request.args.get("q", "").strip().lower()
    recruiter = request.args.get("recruiter", "").strip()
    status = request.args.get("status", "").strip()
    location = request.args.get("location", "").strip()
    qualification = request.args.get("qualification", "").strip()
    rows = [ensure_candidate_defaults(c) for c in enrich_candidates() if not to_boolish(c.get("is_duplicate", "0"))]
    if q:
        rows = [c for c in rows if q in " ".join([c.get("full_name", ""), c.get("phone", ""), c.get("location", ""), c.get("status", ""), c.get("process", ""), c.get("recruiter_code", "")]).lower()]
    if recruiter:
        rows = [c for c in rows if c.get("recruiter_code") == recruiter]
    if status:
        rows = [c for c in rows if c.get("status") == status]
    if location:
        rows = [c for c in rows if c.get("location") == location]
    if qualification:
        rows = [c for c in rows if c.get("qualification_level") == qualification or c.get("qualification") == qualification]
    rows.sort(key=lambda x: x.get("updated_at", x.get("created_at", "")), reverse=True)
    statuses = sorted({c.get("status", "") for c in rows if c.get("status")})
    locations = sorted({c.get("location", "") for c in enrich_candidates() if c.get("location")})
    qualifications = sorted({c.get("qualification_level", "") for c in enrich_candidates() if c.get("qualification_level")})
    return render_template(
        "candidates.html",
        candidates=rows,
        q=request.args.get("q", ""),
        recruiters=recruiters_for_filters(),
        current_recruiter=recruiter,
        statuses=statuses,
        current_status=status,
        locations=locations,
        current_location=location,
        qualifications=qualifications,
        current_qualification=qualification,
    )


def professional_candidate_detail(candidate_code):
    user = current_user()
    candidate = ensure_candidate_defaults(get_candidate(candidate_code) or {})
    if not candidate.get("candidate_id"):
        abort(404)
    history = visible_notes(candidate_code, user)
    related_notifications = user_notifications(user, candidate_code=candidate_code)[:8]
    timeline = []
    submission_row = existing_submission_for_candidate(candidate_code)
    for s in get_backend().list_rows("submissions"):
        if s.get("candidate_id") == candidate_code:
            timeline.append({"event_type": "Submission", "label": s.get("approval_status") or s.get("status", ""), "event_time": display_ts(s.get("submitted_at")), "jd_code": s.get("jd_id", ""), "owner": s.get("recruiter_code", "")})
    for i in get_backend().list_rows("interviews"):
        if i.get("candidate_id") == candidate_code:
            timeline.append({"event_type": "Interview", "label": i.get("status", ""), "event_time": display_ts(i.get("scheduled_at")), "jd_code": i.get("jd_id", ""), "owner": ""})
    timeline.sort(key=lambda x: x.get("event_time", ""), reverse=True)
    jd_choices = [dict(j) for j in get_backend().list_rows("jd_master")]
    process_options = sorted({j.get("company", "") for j in jd_choices if j.get("company")})
    return render_template(
        "candidate_detail.html",
        candidate=candidate,
        note_history=history,
        related_notifications=related_notifications,
        timeline=timeline,
        submission_row=submission_row,
        status_options=CANDIDATE_STATUS_OPTIONS,
        call_connected_options=CALL_CONNECTED_OPTIONS,
        looking_for_job_options=LOOKING_FOR_JOB_OPTIONS,
        degree_options=DEGREE_OPTIONS,
        career_gap_options=CAREER_GAP_OPTIONS,
        interview_availability_options=INTERVIEW_AVAILABILITY_OPTIONS,
        all_details_sent_options=ALL_DETAILS_SENT_OPTIONS,
        primary_locations=PRIMARY_LOCATIONS,
        additional_locations=ADDITIONAL_LOCATIONS,
        process_options=process_options,
        jd_choices=jd_choices,
        interview_dt_local=to_datetime_local(candidate.get("interview_reschedule_date")),
        follow_up_dt_local=to_datetime_local(candidate.get("follow_up_at")),
    )


def professional_create_candidate():
    user = current_user()
    recruiter_code = request.form.get("recruiter_code", "").strip() or user.get("recruiter_code", "")
    owner = find_user_by_recruiter_code(recruiter_code) or user
    next_id = next_prefixed_id("candidates", "candidate_id", "C")
    total_exp = request.form.get("total_experience", request.form.get("experience", "")).strip()
    relevant_exp = request.form.get("relevant_experience", "").strip()
    in_hand = request.form.get("in_hand_salary", "").strip()
    looking_for_job = request.form.get("looking_for_job", "Yes").strip() or "Yes"
    preferred_locations = request.form.getlist("preferred_locations")
    other_pref = request.form.get("preferred_location_other", "").strip()
    if other_pref:
        preferred_locations.append(other_pref)
    preferred_location = ", ".join([p for p in preferred_locations if p])
    row = ensure_candidate_defaults({
        "candidate_id": next_id,
        "call_connected": request.form.get("call_connected", "").strip(),
        "looking_for_job": looking_for_job,
        "full_name": request.form.get("full_name", "").strip(),
        "phone": request.form.get("phone", "").strip(),
        "qualification": request.form.get("qualification", "").strip(),
        "location": request.form.get("location", "").strip(),
        "preferred_location": preferred_location,
        "qualification_level": request.form.get("qualification_level", "").strip(),
        "total_experience": total_exp,
        "relevant_experience": relevant_exp,
        "in_hand_salary": in_hand,
        "ctc_monthly": request.form.get("ctc_monthly", "").strip(),
        "career_gap": request.form.get("career_gap", "").strip(),
        "process": request.form.get("process", "").strip(),
        "recruiter_code": owner.get("recruiter_code", ""),
        "recruiter_name": owner.get("full_name", ""),
        "recruiter_designation": owner.get("designation", ""),
        "status": request.form.get("status", "Eligible").strip() or "Eligible",
        "all_details_sent": request.form.get("all_details_sent", "Pending").strip() or "Pending",
        "interview_availability": request.form.get("interview_availability", "").strip(),
        "interview_reschedule_date": request.form.get("interview_reschedule_date", "").strip(),
        "notes": request.form.get("notes", "").strip(),
        "approval_status": "Draft",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    })
    if looking_for_job == "Yes" and (not row["full_name"] or not row["phone"] or not row["qualification"] or not row["location"]):
        flash("For job-seeking candidates, name, phone, qualification, and location are required.", "danger")
        return redirect(url_for("candidates"))
    get_backend().insert("candidates", row)
    if row.get("notes"):
        get_backend().insert("notes", {
            "candidate_id": next_id,
            "username": user["username"],
            "note_type": "public",
            "body": row.get("notes"),
            "created_at": now_iso(),
        })
    notify_users([owner.get("user_id")], "New candidate added", f"{row['full_name']} has been added to the CRM.", "candidate", {"candidate_id": next_id})
    log_activity(user, "candidate_created", next_id, {"full_name": row.get("full_name")})
    flash(f"Candidate {row['full_name']} added successfully.", "success")
    return redirect(url_for("candidate_detail", candidate_code=next_id))


def professional_jds():
    rows = [dict(r) for r in get_backend().list_rows("jd_master")]
    rows.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    candidate_choices = [
        {"code": c.get("code"), "label": f"{c.get('full_name')} • {display_phone_for_user(c.get('phone'), current_user())}", "phone": c.get("phone")}
        for c in visible_candidates_rows(current_user())
        if c.get("code") and c.get("phone")
    ]
    return render_template("jds.html", jds=rows, candidate_choices=candidate_choices)


def professional_create_jd():
    rows = get_backend().list_rows("jd_master")
    upload = request.files.get("jd_pdf")
    pdf_url = request.form.get("pdf_url", "").strip()
    if upload and getattr(upload, "filename", ""):
        uploads_dir = BASE_DIR / "static" / "uploads" / "jds"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        original = Path(upload.filename).name
        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", original) or "jd.pdf"
        filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{safe_name}"
        upload.save(str(uploads_dir / filename))
        pdf_url = f"/static/uploads/jds/{filename}"
    row = {
        "jd_id": f"J{len(rows)+1:03d}",
        "job_title": request.form.get("job_title", "").strip(),
        "company": request.form.get("company", "").strip(),
        "location": request.form.get("location", "").strip(),
        "experience": request.form.get("experience", "").strip(),
        "salary": request.form.get("salary", "").strip(),
        "pdf_url": pdf_url,
        "jd_status": request.form.get("jd_status", "Open").strip() or "Open",
        "notes": request.form.get("notes", "").strip(),
        "created_at": now_iso(),
    }
    if not row["job_title"] or not row["company"]:
        flash("JD title and company are required.", "danger")
        return redirect(url_for("jds"))
    get_backend().insert("jd_master", row)
    flash(f"JD {row['job_title']} added successfully.", "success")
    return redirect(url_for("jds"))


def professional_create_interview():
    candidate_id = request.form.get("candidate_id", "").strip()
    jd_id = request.form.get("jd_id", "").strip()
    stage = request.form.get("stage", "").strip() or "Interview Scheduled"
    scheduled_at = parse_local_datetime(request.form.get("scheduled_at", "").strip())
    if not candidate_id or not scheduled_at:
        flash("Candidate ID and interview date/time are required.", "danger")
        return redirect(url_for("interviews"))
    row = {
        "interview_id": next_prefixed_id("interviews", "interview_id", "I"),
        "candidate_id": candidate_id,
        "jd_id": jd_id,
        "stage": stage,
        "scheduled_at": scheduled_at,
        "status": request.form.get("status", "Scheduled").strip() or "Scheduled",
        "created_at": now_iso(),
    }
    get_backend().insert("interviews", row)
    get_backend().update_where("candidates", {"candidate_id": candidate_id}, {"status": stage, "interview_reschedule_date": scheduled_at, "updated_at": now_iso()})
    flash(f"Interview scheduled for {candidate_id}.", "success")
    return redirect(url_for("interviews"))


def professional_submissions():
    candidates_by_id = candidate_map()
    jds_by_id = {j.get("jd_id"): j for j in get_backend().list_rows("jd_master")}
    rows = []
    recruiter_scores = {}
    for s in get_backend().list_rows("submissions"):
        item = dict(s)
        candidate = candidates_by_id.get(item.get("candidate_id")) or {}
        jd = jds_by_id.get(item.get("jd_id")) or {}
        item["full_name"] = candidate.get("full_name", "")
        item["phone"] = candidate.get("phone", "")
        item["title"] = jd.get("job_title", candidate.get("process", ""))
        item["company"] = jd.get("company", "")
        item["submitted_at_view"] = display_ts(item.get("submitted_at"))
        rows.append(item)
        code = item.get("recruiter_code", "")
        recruiter_scores.setdefault(code, {"recruiter_code": code, "count": 0, "approved": 0})
        recruiter_scores[code]["count"] += 1
        if (item.get("approval_status") or "").lower() == "approved":
            recruiter_scores[code]["approved"] += 1
    rows.sort(key=lambda x: x.get("submitted_at", ""), reverse=True)
    score_rows = list(recruiter_scores.values())
    users_by_code = {u.get("recruiter_code"): u for u in list_users() if u.get("recruiter_code")}
    for row in score_rows:
        user = users_by_code.get(row["recruiter_code"]) or {}
        row["full_name"] = user.get("full_name", row["recruiter_code"])
        row["approval_rate"] = f"{int((row['approved'] / row['count']) * 100) if row['count'] else 0}%"
    score_rows.sort(key=lambda x: (-x["count"], x["full_name"]))
    return render_template(
        "submissions.html",
        submissions=rows,
        pending_count=len([r for r in rows if (r.get("approval_status") or "").lower() in {"pending approval", "pending review"}]),
        approved_count=len([r for r in rows if (r.get("approval_status") or "").lower() == "approved"]),
        rescheduled_count=len([r for r in rows if (r.get("approval_status") or "").lower() == "rescheduled"]),
        recruiter_scores=score_rows,
    )


app.view_functions["dashboard"] = login_required(professional_dashboard)
app.view_functions["candidates"] = login_required(professional_candidates)
app.view_functions["candidate_detail"] = login_required(professional_candidate_detail)
app.view_functions["create_candidate"] = login_required(professional_create_candidate)
app.view_functions["jds"] = login_required(professional_jds)
app.view_functions["create_jd"] = login_required(professional_create_jd)
app.view_functions["create_interview"] = login_required(professional_create_interview)
app.view_functions["submissions"] = login_required(professional_submissions)


@app.route("/candidate/<candidate_code>/update", methods=["POST"])
@login_required
def update_candidate(candidate_code):
    user = current_user()
    candidate = ensure_candidate_defaults(get_candidate(candidate_code) or {})
    if not candidate.get("candidate_id"):
        abort(404)
    looking_for_job = request.form.get("looking_for_job", "Yes").strip() or "Yes"
    preferred_locations = request.form.getlist("preferred_locations")
    other_pref = request.form.get("preferred_location_other", "").strip()
    if other_pref:
        preferred_locations.append(other_pref)
    preferred_location = ", ".join([p for p in preferred_locations if p])
    selected_processes = request.form.getlist("processes")
    extra_process = request.form.get("extra_process", "").strip()
    if extra_process:
        selected_processes.append(extra_process)
    process_string = ", ".join([p for p in dict.fromkeys([p for p in selected_processes if p])])
    total_exp = request.form.get("total_experience", "").strip()
    relevant_exp = request.form.get("relevant_experience", "").strip()
    in_hand = request.form.get("in_hand_salary", "").strip()
    interview_dt = parse_local_datetime(request.form.get("interview_reschedule_date", "").strip())
    values = ensure_candidate_defaults({
        **candidate,
        "call_connected": request.form.get("call_connected", "").strip(),
        "looking_for_job": looking_for_job,
        "full_name": request.form.get("full_name", "").strip(),
        "phone": request.form.get("phone", "").strip(),
        "qualification": request.form.get("qualification", "").strip(),
        "location": request.form.get("location", "").strip(),
        "preferred_location": preferred_location,
        "qualification_level": request.form.get("qualification_level", "").strip(),
        "total_experience": total_exp,
        "relevant_experience": relevant_exp,
        "in_hand_salary": in_hand,
        "ctc_monthly": request.form.get("ctc_monthly", "").strip(),
        "career_gap": request.form.get("career_gap", "").strip(),
        "process": process_string,
        "status": request.form.get("status", "").strip() or candidate.get("status", "Eligible"),
        "all_details_sent": request.form.get("all_details_sent", "").strip() or candidate.get("all_details_sent", "Pending"),
        "submission_date": request.form.get("submission_date", "").strip() or datetime.now().strftime("%Y-%m-%d"),
        "interview_availability": request.form.get("interview_availability", "").strip(),
        "interview_reschedule_date": interview_dt,
        "follow_up_at": parse_local_datetime(request.form.get("follow_up_at", "").strip()),
        "follow_up_note": request.form.get("follow_up_note", "").strip(),
        "follow_up_status": request.form.get("follow_up_status", candidate.get("follow_up_status", "Open")).strip() or "Open",
        "updated_at": now_iso(),
    })
    values = {k: values.get(k, "") for k in TABLE_COLUMNS["candidates"]}
    if looking_for_job == "Yes" and (not values["full_name"] or not values["phone"] or not values["qualification"] or not values["location"]):
        flash("For job-seeking candidates, name, phone, qualification, and location are required.", "danger")
        return redirect(url_for("candidate_detail", candidate_code=candidate_code))
    get_backend().update_where("candidates", {"candidate_id": candidate_code}, values)

    note_body = request.form.get("note_body", "").strip()
    note_type = request.form.get("note_type", "public").strip() or "public"
    if note_body:
        get_backend().insert("notes", {
            "candidate_id": candidate_code,
            "username": user["username"],
            "note_type": note_type,
            "body": note_body,
            "created_at": now_iso(),
        })
        if note_type == "public":
            targets = [u.get("user_id") for u in manager_and_tl_users()]
            owner = find_user_by_recruiter_code(values.get("recruiter_code"))
            if owner:
                targets.append(owner.get("user_id"))
            notify_users(targets, f"Note updated: {values.get('full_name', candidate_code)}", f"{user.get('full_name')} added a note on {values.get('full_name', candidate_code)}.", "note", {"candidate_id": candidate_code})

    if user.get("role") in {"manager", "tl"}:
        owner = find_user_by_recruiter_code(values.get("recruiter_code"))
        if owner and owner.get("user_id") != user.get("user_id"):
            notify_users([owner.get("user_id")], "Candidate profile updated", f"{values.get('full_name', candidate_code)} was updated by {user.get('full_name')}.", "candidate", {"candidate_id": candidate_code})

    if request.form.get("send_for_approval"):
        existing = existing_submission_for_candidate(candidate_code)
        jd_match = next((j for j in get_backend().list_rows("jd_master") if (j.get("company") or "").strip().lower() == ((values.get("process") or "").split(",")[0].strip().lower())), None)
        if existing:
            get_backend().update_where("submissions", {"submission_id": existing["submission_id"]}, {
                "jd_id": (jd_match or {}).get("jd_id", existing.get("jd_id", "")),
                "status": values.get("status", "Submitted"),
                "approval_status": "Pending Approval",
                "approval_requested_at": now_iso(),
                "submitted_at": values.get("submission_date"),
            })
        else:
            get_backend().insert("submissions", {
                "submission_id": next_prefixed_id("submissions", "submission_id", "S"),
                "candidate_id": candidate_code,
                "jd_id": (jd_match or {}).get("jd_id", ""),
                "recruiter_code": values.get("recruiter_code", ""),
                "status": values.get("status", "Submitted"),
                "approval_status": "Pending Approval",
                "decision_note": "",
                "approval_requested_at": now_iso(),
                "approved_by_name": "",
                "approved_at": "",
                "approval_rescheduled_at": "",
                "submitted_at": values.get("submission_date"),
            })
        get_backend().update_where("candidates", {"candidate_id": candidate_code}, {"approval_status": "Pending Approval", "approval_requested_at": now_iso(), "updated_at": now_iso()})
        notify_users([u.get("user_id") for u in manager_and_tl_users()], "Approval requested", f"{values.get('full_name', candidate_code)} has been sent for approval.", "submission", {"candidate_id": candidate_code})

    if interview_dt:
        existing_interview = next((i for i in get_backend().list_rows("interviews") if i.get("candidate_id") == candidate_code), None)
        jd_match = next((j for j in get_backend().list_rows("jd_master") if (j.get("company") or "").strip().lower() == ((values.get("process") or "").split(",")[0].strip().lower())), None)
        if existing_interview:
            get_backend().update_where("interviews", {"interview_id": existing_interview["interview_id"]}, {"scheduled_at": interview_dt, "stage": values.get("status", "Interview Scheduled"), "status": "Scheduled"})
        else:
            get_backend().insert("interviews", {
                "interview_id": next_prefixed_id("interviews", "interview_id", "I"),
                "candidate_id": candidate_code,
                "jd_id": (jd_match or {}).get("jd_id", ""),
                "stage": values.get("status", "Interview Scheduled"),
                "scheduled_at": interview_dt,
                "status": "Scheduled",
                "created_at": now_iso(),
            })

    log_activity(user, "candidate_updated", candidate_code, {"status": values.get("status")})
    flash("Candidate details updated successfully.", "success")
    return redirect(url_for("candidate_detail", candidate_code=candidate_code))


@app.route("/submission/<submission_id>/<action>", methods=["POST"])
@login_required
def submission_action(submission_id, action):
    user = current_user()
    if user.get("role") not in {"manager", "tl"}:
        abort(403)
    submission = next((dict(s) for s in get_backend().list_rows("submissions") if s.get("submission_id") == submission_id), None)
    if not submission:
        abort(404)
    candidate = get_candidate(submission.get("candidate_id")) or {}
    owner = find_user_by_recruiter_code(submission.get("recruiter_code"))
    if action == "approve":
        get_backend().update_where("submissions", {"submission_id": submission_id}, {
            "approval_status": "Approved",
            "approved_by_name": user.get("full_name", ""),
            "approved_at": now_iso(),
            "status": "Approved",
        })
        get_backend().update_where("candidates", {"candidate_id": submission.get("candidate_id")}, {"approval_status": "Approved", "approved_by_name": user.get("full_name", ""), "approved_at": now_iso(), "status": "Approved", "updated_at": now_iso()})
        if owner:
            notify_users([owner.get("user_id")], "Submission approved", f"{candidate.get('full_name', submission.get('candidate_id'))} was approved by {user.get('full_name')}", "submission", {"candidate_id": submission.get("candidate_id")})
        flash("Submission approved.", "success")
    elif action == "reschedule":
        get_backend().update_where("submissions", {"submission_id": submission_id}, {
            "approval_status": "Rescheduled",
            "approval_rescheduled_at": now_iso(),
            "status": "Needs Update",
        })
        get_backend().update_where("candidates", {"candidate_id": submission.get("candidate_id")}, {"approval_status": "Rescheduled", "status": "Needs New Interview", "updated_at": now_iso()})
        if owner:
            notify_users([owner.get("user_id")], "Submission rescheduled", f"{candidate.get('full_name', submission.get('candidate_id'))} needs an updated submission.", "submission", {"candidate_id": submission.get("candidate_id")})
        flash("Submission moved to reschedule.", "success")
    return redirect(url_for("submissions"))


@app.route("/attendance")
@login_required
def attendance_breaks():
    ensure_presence_rows()
    users_by_id = user_map("user_id")
    rows = []
    for row in get_backend().list_rows("presence"):
        item = dict(row)
        user = users_by_id.get(item.get("user_id")) or {}
        item["full_name"] = user.get("full_name", item.get("user_id", ""))
        item["designation"] = user.get("designation", "")
        item["role"] = user.get("role", "")
        item["is_on_break_bool"] = to_boolish(item.get("is_on_break", "0"))
        item["locked_bool"] = to_boolish(item.get("locked", "0"))
        item["last_seen_at_view"] = display_ts(item.get("last_seen_at"))
        item["work_started_at_view"] = display_ts(item.get("work_started_at"))
        item["break_expected_end_at_view"] = display_ts(item.get("break_expected_end_at"))
        rows.append(item)
    rows.sort(key=lambda x: (x.get("role", ""), x.get("full_name", "")))
    current_presence = get_presence_for_user(current_user().get("user_id")) or {}
    unlock_requests = [dict(r) for r in get_backend().list_rows("unlock_requests")]
    unlock_requests.sort(key=lambda x: x.get("requested_at", ""), reverse=True)
    return render_template(
        "attendance.html",
        presence_rows=rows,
        current_presence=current_presence,
        break_options=BREAK_OPTIONS,
        unlock_requests=unlock_requests[:8],
        working_now=len([r for r in rows if not r.get("locked_bool")]),
        on_break_now=len([r for r in rows if r.get("is_on_break_bool")]),
        locked_now=len([r for r in rows if r.get("locked_bool")]),
    )


@app.route("/attendance/join", methods=["POST"])
@login_required
def attendance_join():
    user = current_user()
    ensure_presence_rows()
    get_backend().update_where("presence", {"user_id": user.get("user_id")}, {"work_started_at": now_iso(), "last_seen_at": now_iso(), "last_page": "attendance", "locked": "0", "is_on_break": "0", "break_reason": "", "break_started_at": "", "break_expected_end_at": ""})
    notify_users([u.get("user_id") for u in manager_and_tl_users() if u.get("user_id") != user.get("user_id")], "User joined office", f"{user.get('full_name')} joined office.", "attendance", {"user_id": user.get("user_id")})
    flash("Office time started.", "success")
    return redirect(url_for("attendance_breaks"))


@app.route("/attendance/start-break", methods=["POST"])
@login_required
def attendance_start_break():
    user = current_user()
    reason = request.form.get("break_reason", "Tea Break").strip() or "Tea Break"
    duration = max(1, min(120, parse_intish(request.form.get("break_minutes", "15"), 15)))
    end_at = datetime.now() + timedelta(minutes=duration)
    get_backend().update_where("presence", {"user_id": user.get("user_id")}, {
        "is_on_break": "1",
        "break_reason": reason,
        "break_started_at": now_iso(),
        "break_expected_end_at": end_at.strftime("%Y-%m-%dT%H:%M:%S"),
        "last_seen_at": now_iso(),
    })
    flash("Break started.", "success")
    return redirect(url_for("attendance_breaks"))


@app.route("/attendance/end-break", methods=["POST"])
@login_required
def attendance_end_break():
    user = current_user()
    row = get_presence_for_user(user.get("user_id")) or {}
    total_break = parse_intish(row.get("total_break_minutes"), 0)
    if row.get("break_started_at"):
        try:
            started = datetime.fromisoformat(str(row.get("break_started_at")))
            total_break += max(0, int((datetime.now() - started).total_seconds() // 60))
        except Exception:
            total_break += 0
    get_backend().update_where("presence", {"user_id": user.get("user_id")}, {
        "is_on_break": "0",
        "break_reason": "",
        "break_started_at": "",
        "break_expected_end_at": "",
        "total_break_minutes": str(total_break),
        "last_seen_at": now_iso(),
    })
    flash("Break ended.", "success")
    return redirect(url_for("attendance_breaks"))


@app.route("/attendance/request-unlock", methods=["POST"])
@login_required
def attendance_request_unlock():
    user = current_user()
    reason = request.form.get("reason", "Unlock requested").strip() or "Unlock requested"
    get_backend().insert("unlock_requests", {
        "request_id": next_prefixed_id("unlock_requests", "request_id", "UR"),
        "user_id": user.get("user_id"),
        "status": "Pending",
        "reason": reason,
        "requested_at": now_iso(),
        "approved_by_user_id": "",
        "approved_by_name": "",
        "approved_at": "",
    })
    get_backend().update_where("presence", {"user_id": user.get("user_id")}, {"locked": "1", "last_seen_at": now_iso()})
    notify_users([u.get("user_id") for u in manager_and_tl_users()], "Unlock request raised", f"{user.get('full_name')} raised an unlock request.", "attendance", {"user_id": user.get("user_id")})
    flash("Unlock request sent to TL and manager.", "success")
    return redirect(url_for("attendance_breaks"))


@app.route("/attendance/ping", methods=["POST"])
def attendance_ping():
    if not session.get("username"):
        return jsonify({"ok": False}), 401
    user = current_user()
    payload = request.get_json(silent=True) or {}
    ensure_presence_rows()
    get_backend().update_where("presence", {"user_id": user.get("user_id")}, {
        "last_seen_at": now_iso(),
        "last_page": payload.get("page", request.path),
        "locked": "0",
    })
    return jsonify({"ok": True})



# === Final Aaria + Reports + CV Tools block ===
from werkzeug.utils import secure_filename
from flask import send_from_directory
from docx import Document
from docx.shared import Inches
from pypdf import PdfReader
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
try:
    import pytesseract
except Exception:
    pytesseract = None

EXPORT_DIR = DATA_DIR / "exports"
GENERATED_DIR = DATA_DIR / "generated"
JD_UPLOAD_DIR = BASE_DIR / "static" / "uploads" / "jds"
CV_UPLOAD_DIR = BASE_DIR / "static" / "uploads" / "cv"
for _p in [EXPORT_DIR, GENERATED_DIR, JD_UPLOAD_DIR, CV_UPLOAD_DIR]:
    _p.mkdir(parents=True, exist_ok=True)

REPORT_TYPES = [
    ("submissions", "Submissions"),
    ("interviews", "Interviews"),
    ("calls", "Calls"),
    ("attendance", "Attendance"),
    ("activity", "Employee Activity"),
    ("day_end", "Day End Summary"),
]

SIDEBAR_ITEMS = [
    ("Dashboard", "dashboard", {}),
    ("Candidates", "candidates", {}),
    ("JD Centre", "jds", {}),
    ("Interviews", "interviews", {}),
    ("Tasks", "tasks", {}),
    ("Submissions", "submissions", {}),
    ("Attendance & Breaks", "attendance_breaks", {}),
    ("Reports", "reports_page", {}),
    ("Testing AI Features", "testing_ai_page", {}),
    ("Dialer", "module_page", {"slug": "dialer"}),
    ("Meeting Room", "module_page", {"slug": "meeting-room"}),
    ("Learning Hub", "module_page", {"slug": "learning-hub"}),
    ("Social Career Crox", "module_page", {"slug": "social-career-crox"}),
    ("Wallet & Rewards", "module_page", {"slug": "wallet-rewards"}),
    ("Payout Tracker", "module_page", {"slug": "payout-tracker"}),
    ("Recent Activity", "recent_activity_page", {}),
    ("Admin Control", "admin_page", {}),
]

TABLE_COLUMNS.update({
    "scheduled_reports": {"report_id", "user_id", "title", "report_type", "filters_json", "file_format", "frequency_minutes", "status", "next_run_at", "last_run_at", "last_file_name", "created_at"},
    "aaria_queue": {"task_id", "user_id", "serial_hint", "command_text", "status", "result_text", "created_at", "updated_at"},
})

_old_upgraded_sqlite_init_db = SQLiteBackend._init_db

def final_sqlite_init_db(self):
    _old_upgraded_sqlite_init_db(self)
    conn = self._connect()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS scheduled_reports (
        report_id TEXT PRIMARY KEY,
        user_id TEXT,
        title TEXT,
        report_type TEXT,
        filters_json TEXT,
        file_format TEXT,
        frequency_minutes TEXT,
        status TEXT,
        next_run_at TEXT,
        last_run_at TEXT,
        last_file_name TEXT,
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS aaria_queue (
        task_id TEXT PRIMARY KEY,
        user_id TEXT,
        serial_hint TEXT,
        command_text TEXT,
        status TEXT,
        result_text TEXT,
        created_at TEXT,
        updated_at TEXT
    );
    """)
    for statement in [
        "ALTER TABLE jd_master ADD COLUMN pdf_url TEXT",
        "ALTER TABLE jd_master ADD COLUMN jd_status TEXT",
    ]:
        try:
            conn.execute(statement)
        except Exception:
            pass
    conn.commit()
    conn.close()

SQLiteBackend._init_db = final_sqlite_init_db

@app.context_processor
def inject_aaria_globals():
    user = current_user()
    employee_options = [
        {"username": u.get("username", ""), "full_name": u.get("full_name", ""), "designation": u.get("designation", ""), "recruiter_code": u.get("recruiter_code", "")}
        for u in list_users()
    ] if user else []
    latest = None
    aaria_target_suggestions = []
    if user:
        unread = user_notifications(user, unread_only=True)
        latest = unread[0] if unread else None
        seen = set()
        def add_value(value):
            value = str(value or '').strip()
            if value and value.lower() not in seen:
                seen.add(value.lower())
                aaria_target_suggestions.append(value)
        for cand in visible_candidates_rows(user)[:200]:
            add_value(cand.get('candidate_id'))
            add_value(cand.get('full_name'))
            add_value(cand.get('phone'))
        for emp in employee_options:
            add_value(emp.get('username'))
            add_value(emp.get('full_name'))
            add_value(emp.get('recruiter_code'))
        for task in get_backend().list_rows('tasks')[:200]:
            add_value(task.get('task_id'))
        for row in get_backend().list_rows('submissions')[:200]:
            add_value(row.get('submission_id'))
            add_value(row.get('candidate_id'))
    return {"employee_options": employee_options, "latest_toast_notification": latest, "aaria_avatar_seed": (user or {}).get("username", "aaria"), "aaria_target_suggestions": aaria_target_suggestions}



def log_page_activity(page_name, extra=None):
    user = current_user()
    if user:
        log_activity(user, f"page_view:{page_name}", metadata=extra or {})


def ensure_iso_date(raw):
    text = (raw or "").strip()
    if not text:
        return ""
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except Exception:
            pass
    return text[:10]


def parse_candidate_hint(serial_hint):
    hint = (serial_hint or "").strip()
    digits = "".join(ch for ch in hint if ch.isdigit())
    rows = [ensure_candidate_defaults(c) for c in enrich_candidates()]
    for c in rows:
        cid = str(c.get("candidate_id") or c.get("code") or "")
        phone = normalize_phone(c.get("phone"))
        if hint and hint.lower() in {cid.lower(), c.get("code", "").lower(), phone.lower()}:
            return c
        if digits and (phone.endswith(digits) or "".join(ch for ch in cid if ch.isdigit()).endswith(digits)):
            return c
    if hint:
        hint_l = hint.lower()
        for c in rows:
            if hint_l in c.get("full_name", "").lower():
                return c
    return None


def parse_command_target_date(command_text):
    text = (command_text or "").strip().lower()
    base = datetime.now().replace(hour=11, minute=0)
    if "कल" in command_text or "tomorrow" in text or "tmr" in text:
        base += timedelta(days=1)
    elif not ("today" in text or "आज" in command_text):
        m = re.search(r"(\d{4}-\d{2}-\d{2})", command_text)
        if m:
            try:
                base = datetime.strptime(m.group(1), "%Y-%m-%d").replace(hour=11, minute=0)
            except Exception:
                pass
        else:
            m = re.search(r"(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?", command_text)
            if m:
                d, mo, yr = m.group(1), m.group(2), m.group(3)
                year = int(yr) if yr else datetime.now().year
                if year < 100:
                    year += 2000
                try:
                    base = datetime(year, int(mo), int(d), 11, 0)
                except Exception:
                    pass
    tm = re.search(r"(?:at|time|ko)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", text)
    if tm:
        hh = int(tm.group(1)); mm = int(tm.group(2) or 0); ampm = tm.group(3)
        if ampm == "pm" and hh < 12: hh += 12
        if ampm == "am" and hh == 12: hh = 0
        if 0 <= hh <= 23: base = base.replace(hour=hh, minute=mm)
    return base.strftime("%Y-%m-%d %H:%M")


def aaria_parse_instruction(command_text, serial_hint=""):
    raw = (command_text or "").strip()
    text = raw.lower()
    action = None; payload = {}
    if not raw:
        return {"ok": False, "message": "Instruction not clear. Command khali hai.", "action": "none"}
    candidate = parse_candidate_hint(serial_hint)
    if any(k in text for k in ["theme", "color theme", "colour theme"]):
        aliases = {"corporate": "corporate-light", "ocean": "ocean", "mint": "mint", "sunset": "sunset", "lavender": "lavender", "dark": "dark-pro", "silver": "silver-pro"}
        for theme in sorted(ALLOWED_THEMES):
            if theme in text:
                action = "theme"; payload["theme"] = theme; break
        if not action:
            for key, val in aliases.items():
                if key in text: action = "theme"; payload["theme"] = val; break
    elif any(k in text for k in ["call", "dial"]):
        action = "call"
    elif "whatsapp" in text or "whats app" in text:
        action = "whatsapp"
        m = re.search(r"message[:\-]?\s*(.+)$", raw, re.I)
        payload["message"] = (m.group(1).strip() if m else f"Hello {candidate.get('full_name','')}, this message was prepared by Aaria.") if candidate else (m.group(1).strip() if m else "Hello from Career Crox.")
    elif "not interested" in text or "reject" in text or "rejected" in text:
        action = "candidate_status"; payload["status"] = "Not Interested"
    elif "interview" in text and any(k in text for k in ["date", "reschedule", "schedule", "kal", "tomorrow", "today"]):
        action = "interview_date"; payload["scheduled_at"] = parse_command_target_date(raw)
    elif "note" in text:
        action = "add_note"
        m = re.search(r"note(?:s)?(?: me| में|:)?\s*(.+)$", raw, re.I)
        payload["note"] = (m.group(1).strip() if m else raw); payload["note_type"] = "public"
    if not action:
        return {"ok": False, "message": "Instruction not clear. Example: schedule C001 for tomorrow at 11:00 AM, or mark C001 as Not Interested.", "action": "none", "candidate": candidate}
    if action != "theme" and not candidate:
        return {"ok": False, "message": "Candidate nahi mila. Serial / phone last digits / candidate ID dubara daalo.", "action": action}
    msg = ""
    if action == "theme": msg = f"Theme preview ready: {payload['theme']}"
    elif action == "call": msg = f"Call shortcut ready for {candidate.get('full_name')}"
    elif action == "whatsapp": msg = f"WhatsApp draft ready for {candidate.get('full_name')}"
    elif action == "candidate_status": msg = f"{candidate.get('full_name')} ko {payload['status']} mark karne ke liye ready."
    elif action == "interview_date": msg = f"{candidate.get('full_name')} ka interview {payload['scheduled_at']} par set karne ke liye ready."
    elif action == "add_note": msg = f"A note will be added for {candidate.get('full_name')}: {payload['note'][:120]}"
    return {"ok": True, "action": action, "payload": payload, "message": msg, "candidate": candidate}


def aaria_execute_instruction(command_text, serial_hint="", preview=False):
    parsed = aaria_parse_instruction(command_text, serial_hint)
    if not parsed.get("ok"): return parsed
    user = current_user(); action = parsed["action"]; payload = parsed.get("payload", {}); candidate = parsed.get("candidate")
    response = dict(parsed)
    if preview: return response
    if action == "theme":
        theme = normalize_theme(payload.get("theme"))
        get_backend().update_where("users", {"user_id": user["user_id"]}, {"theme_name": theme, "updated_at": now_iso()}); session["theme_name"] = theme
        response["message"] = f"Theme changed to {theme}."; response["avatar_state"] = "success"
    elif action == "call":
        phone = normalize_phone(candidate.get("phone")); response["message"] = f"Dialer khul raha hai for {candidate.get('full_name')}."; response["action_link"] = f"tel:+91{phone}"; response["action_type"] = "call"; response["avatar_state"] = "call"; log_activity(user, "aaria_call", candidate.get("candidate_id"), {"phone": phone})
    elif action == "whatsapp":
        phone = normalize_phone(candidate.get("phone")); message = payload.get("message") or f"Hello {candidate.get('full_name')}, Career Crox se message."; response["message"] = f"WhatsApp draft ready for {candidate.get('full_name')}."; response["action_link"] = f"https://wa.me/91{phone}?text={quote(message)}"; response["action_type"] = "whatsapp"; response["avatar_state"] = "success"; log_activity(user, "aaria_whatsapp", candidate.get("candidate_id"), {"phone": phone})
    elif action == "candidate_status":
        get_backend().update_where("candidates", {"candidate_id": candidate.get("candidate_id")}, {"status": payload["status"], "updated_at": now_iso()}); log_activity(user, "aaria_status_update", candidate.get("candidate_id"), {"status": payload["status"]}); response["message"] = f"{candidate.get('full_name')} ko {payload['status']} mark kar diya."; response["avatar_state"] = "success"
    elif action == "interview_date":
        existing = next((dict(i) for i in get_backend().list_rows("interviews") if i.get("candidate_id") == candidate.get("candidate_id")), None)
        jd_match = next((j for j in get_backend().list_rows("jd_master") if (j.get("company") or "").strip().lower() == ((candidate.get("process") or "").split(',')[0].strip().lower())), None)
        if existing: get_backend().update_where("interviews", {"interview_id": existing["interview_id"]}, {"scheduled_at": payload["scheduled_at"], "status": "Scheduled", "stage": "Interview Scheduled"})
        else: get_backend().insert("interviews", {"interview_id": next_prefixed_id("interviews", "interview_id", "I"), "candidate_id": candidate.get("candidate_id"), "jd_id": (jd_match or {}).get("jd_id", ""), "stage": "Interview Scheduled", "scheduled_at": payload["scheduled_at"], "status": "Scheduled", "created_at": now_iso()})
        get_backend().update_where("candidates", {"candidate_id": candidate.get("candidate_id")}, {"interview_reschedule_date": payload["scheduled_at"], "status": "Interview Scheduled", "updated_at": now_iso()}); notify_users([u.get("user_id") for u in manager_and_tl_users()], "Interview updated by Aaria", f"{candidate.get('full_name')} ka interview {payload['scheduled_at']} par set hua.", "interview", {"candidate_id": candidate.get("candidate_id")}); log_activity(user, "aaria_interview_update", candidate.get("candidate_id"), {"scheduled_at": payload["scheduled_at"]}); response["message"] = f"Interview updated for {candidate.get('full_name')} on {payload['scheduled_at']}."; response["avatar_state"] = "success"
    elif action == "add_note":
        get_backend().insert("notes", {"candidate_id": candidate.get("candidate_id"), "username": user.get("username"), "note_type": payload.get("note_type", "public"), "body": payload.get("note", ""), "created_at": now_iso()}); log_activity(user, "aaria_note_added", candidate.get("candidate_id"), {"note": payload.get("note", "")[:140]}); response["message"] = f"Note add kar diya for {candidate.get('full_name')}."; response["avatar_state"] = "success"
    get_backend().insert("aaria_queue", {"task_id": f"AQ{int(datetime.now().timestamp()*1000)}{random.randint(100,999)}", "user_id": user.get("user_id", ""), "serial_hint": serial_hint, "command_text": command_text, "status": "Completed", "result_text": response.get("message", ""), "created_at": now_iso(), "updated_at": now_iso()})
    return response


def rows_for_report(report_type, filters):
    candidates = [ensure_candidate_defaults(c) for c in enrich_candidates()]
    cand_by_id = {c.get("candidate_id") or c.get("code"): c for c in candidates}
    jds_by_id = {j.get("jd_id"): dict(j) for j in get_backend().list_rows("jd_master")}
    users_by_code = {u.get("recruiter_code"): u for u in list_users() if u.get("recruiter_code")}
    rows = []
    if report_type == "submissions":
        for s in get_backend().list_rows("submissions"):
            c = cand_by_id.get(s.get("candidate_id")) or {}; jd = jds_by_id.get(s.get("jd_id")) or {}
            rows.append({"Candidate ID": s.get("candidate_id", ""), "Name": c.get("full_name", ""), "Phone": c.get("phone", ""), "Recruiter Code": s.get("recruiter_code", c.get("recruiter_code", "")), "Recruiter": c.get("recruiter_name", ""), "Location": c.get("location", ""), "JD": jd.get("job_title", c.get("process", "")), "Company": jd.get("company", ""), "Approval": s.get("approval_status", s.get("status", "")), "Submitted At": display_ts(s.get("submitted_at"))})
    elif report_type == "interviews":
        for i in get_backend().list_rows("interviews"):
            c = cand_by_id.get(i.get("candidate_id")) or {}; jd = jds_by_id.get(i.get("jd_id")) or {}
            rows.append({"Candidate ID": i.get("candidate_id", ""), "Name": c.get("full_name", ""), "Phone": c.get("phone", ""), "Recruiter Code": c.get("recruiter_code", ""), "Recruiter": c.get("recruiter_name", ""), "Location": c.get("location", ""), "JD": jd.get("job_title", c.get("process", "")), "Stage": i.get("stage", ""), "Status": i.get("status", ""), "Scheduled At": display_ts(i.get("scheduled_at"))})
    elif report_type == "calls":
        by_uid = user_map("user_id")
        for a in get_backend().list_rows("activity_log"):
            if a.get("action_type") not in {"manual_call", "aaria_call"}:
                continue
            u = by_uid.get(a.get("user_id")) or {}
            c = cand_by_id.get(a.get("candidate_id")) or {}
            meta = safe_json_loads(a.get("metadata"), {})
            rows.append({
                "When": display_ts(a.get("created_at")),
                "Recruiter Code": u.get("recruiter_code", ""),
                "Recruiter": u.get("full_name", a.get("username", "")),
                "Candidate ID": a.get("candidate_id", ""),
                "Candidate": c.get("full_name", ""),
                "Phone": meta.get("phone", c.get("phone", "")),
                "Action": a.get("action_type", "")
            })
    elif report_type == "attendance":
        ensure_presence_rows(); by_id = user_map("user_id")
        for p in get_backend().list_rows("presence"):
            u = by_id.get(p.get("user_id")) or {}
            rows.append({"User": u.get("full_name", p.get("user_id", "")), "Username": u.get("username", ""), "Recruiter Code": u.get("recruiter_code", ""), "Designation": u.get("designation", ""), "Last Seen": display_ts(p.get("last_seen_at")), "Work Started": display_ts(p.get("work_started_at")), "On Break": "Yes" if to_boolish(p.get("is_on_break", "0")) else "No", "Break Reason": p.get("break_reason", ""), "Break Minutes": p.get("total_break_minutes", "0"), "Locked": "Yes" if to_boolish(p.get("locked", "0")) else "No"})
    elif report_type == "activity":
        by_uid = user_map("user_id")
        for a in get_backend().list_rows("activity_log"):
            u = by_uid.get(a.get("user_id")) or {}; c = cand_by_id.get(a.get("candidate_id")) or {}
            rows.append({"When": display_ts(a.get("created_at")), "User": u.get("full_name", a.get("username", "")), "Username": a.get("username", ""), "Recruiter Code": u.get("recruiter_code", ""), "Action": a.get("action_type", ""), "Candidate ID": a.get("candidate_id", ""), "Candidate": c.get("full_name", ""), "Metadata": a.get("metadata", "")})
    elif report_type == "day_end":
        summary = {}
        for c in candidates:
            code = c.get("recruiter_code", "") or "UNASSIGNED"; summary.setdefault(code, {"Recruiter Code": code, "Recruiter": c.get("recruiter_name", code), "Candidates": 0, "Submissions": 0, "Interviews": 0, "Approved": 0, "Not Interested": 0}); summary[code]["Candidates"] += 1
            if (c.get("status") or "").lower() == "not interested": summary[code]["Not Interested"] += 1
        for s in get_backend().list_rows("submissions"):
            code = s.get("recruiter_code", "") or "UNASSIGNED"; summary.setdefault(code, {"Recruiter Code": code, "Recruiter": (users_by_code.get(code) or {}).get("full_name", code), "Candidates": 0, "Submissions": 0, "Interviews": 0, "Approved": 0, "Not Interested": 0}); summary[code]["Submissions"] += 1
            if (s.get("approval_status") or "").lower() == "approved": summary[code]["Approved"] += 1
        for i in get_backend().list_rows("interviews"):
            c = cand_by_id.get(i.get("candidate_id")) or {}; code = c.get("recruiter_code", "") or "UNASSIGNED"; summary.setdefault(code, {"Recruiter Code": code, "Recruiter": c.get("recruiter_name", code), "Candidates": 0, "Submissions": 0, "Interviews": 0, "Approved": 0, "Not Interested": 0}); summary[code]["Interviews"] += 1
        rows = list(summary.values())
    return apply_report_filters(rows, filters)


def row_date_value(row):
    for key in ["Submitted At", "Scheduled At", "Work Started", "Last Seen", "When"]:
        if row.get(key): return ensure_iso_date(str(row.get(key)).replace("T", " ").split(" ")[0])
    return ""


def apply_report_filters(rows, filters):
    recruiters = set(filters.get("recruiters") or []); date_from = filters.get("date_from") or ""; date_to = filters.get("date_to") or ""; status = (filters.get("status") or "").strip().lower(); location = (filters.get("location") or "").strip().lower(); out = []
    for row in rows:
        if recruiters:
            row_recruiter = str(row.get("Recruiter Code") or row.get("Username") or "")
            row_recruiter_name = str(row.get("Recruiter") or row.get("User") or "")
            if row_recruiter not in recruiters and row_recruiter_name not in recruiters: continue
        rv = row_date_value(row)
        if date_from and rv and rv < date_from: continue
        if date_to and rv and rv > date_to: continue
        if status:
            hay = " ".join(str(v) for k, v in row.items() if "status" in k.lower() or "approval" in k.lower()).lower()
            if status not in hay: continue
        if location and location not in str(row.get("Location", "")).lower(): continue
        out.append(row)
    return out


def write_xlsx(rows, path, title="Report"):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = title[:31]
    if not rows: ws["A1"] = "No rows found"
    else:
        headers = list(rows[0].keys()); ws.append(headers)
        from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
        fill = PatternFill("solid", fgColor="305496"); white_font = Font(color="FFFFFF", bold=True); thin = Side(style="thin", color="D9E1F2")
        for cell in ws[1]: cell.fill = fill; cell.font = white_font; cell.alignment = Alignment(horizontal="center"); cell.border = Border(bottom=thin)
        for row in rows: ws.append([row.get(h, "") for h in headers])
        for col_idx, header in enumerate(headers, start=1):
            width = max(len(str(header)), max((len(str(r.get(header, ""))) for r in rows), default=10)) + 2
            ws.column_dimensions[openpyxl.utils.get_column_letter(col_idx)].width = min(max(width, 12), 34)
        ws.freeze_panes = "A2"; ws.auto_filter.ref = ws.dimensions
    wb.save(path)


def write_csv(rows, path):
    import csv
    headers = list(rows[0].keys()) if rows else ["Info"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers); writer.writeheader(); writer.writerows(rows or [{"Info": "No rows found"}])


def make_report_file(report_type, filters, file_format="xlsx"):
    rows = rows_for_report(report_type, filters); stamp = datetime.now().strftime("%Y%m%d_%H%M%S"); ext = "xlsx" if file_format == "xlsx" else "csv"; filename = f"career_crox_{report_type}_{stamp}.{ext}"; path = EXPORT_DIR / filename
    if ext == "xlsx": write_xlsx(rows, path, title=report_type.replace("_", " ").title())
    else: write_csv(rows, path)
    return filename, path, rows


def process_due_scheduled_reports():
    try: jobs = [dict(j) for j in get_backend().list_rows("scheduled_reports") if (j.get("status") or "Active") == "Active"]
    except Exception: return
    now_text = now_iso()
    for job in jobs:
        if not job.get("next_run_at") or str(job.get("next_run_at")) > now_text: continue
        filters = safe_json_loads(job.get("filters_json"), {}); filename, _, _ = make_report_file(job.get("report_type"), filters, job.get("file_format") or "xlsx")
        freq = parse_intish(job.get("frequency_minutes"), 30); next_run = (datetime.now() + timedelta(minutes=freq)).strftime("%Y-%m-%dT%H:%M:%S")
        get_backend().update_where("scheduled_reports", {"report_id": job.get("report_id")}, {"last_run_at": now_iso(), "next_run_at": next_run, "last_file_name": filename})
        if job.get("user_id"): notify_users([job.get("user_id")], "Scheduled report ready", f"{job.get('title', 'Report')} has been generated.", "report", {"file": filename})

@app.before_request
def aaria_before_request_tick():
    now_ts = datetime.now().timestamp()
    last_run = getattr(app, "_last_scheduled_report_tick", 0)
    if now_ts - last_run < 90:
        return
    app._last_scheduled_report_tick = now_ts
    try:
        process_due_scheduled_reports()
    except Exception:
        pass


def recent_export_files(limit=12):
    files = []
    for p in sorted(EXPORT_DIR.glob("*"), key=lambda x: x.stat().st_mtime, reverse=True): files.append({"name": p.name, "created_at": datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M")})
    return files[:limit]


def activity_monitor_rows():
    rows = []; by_uid = user_map("user_id"); per_user = {}
    for item in sorted([dict(a) for a in get_backend().list_rows("activity_log")], key=lambda x: x.get("created_at", ""), reverse=True):
        user = by_uid.get(item.get("user_id")) or {}; meta = safe_json_loads(item.get("metadata"), {})
        entry = {"when": display_ts(item.get("created_at")), "username": item.get("username", ""), "full_name": user.get("full_name", item.get("username", "")), "recruiter_code": user.get("recruiter_code", ""), "action": item.get("action_type", ""), "candidate_id": item.get("candidate_id", ""), "metadata": json.dumps(meta, ensure_ascii=False)[:120]}
        per_user.setdefault(entry["username"], {"views": 0, "candidate_views": 0})
        if "page_view" in entry["action"]: per_user[entry["username"]]["views"] += 1
        if item.get("candidate_id"): per_user[entry["username"]]["candidate_views"] += 1
        rows.append(entry)
    risk_rows = []
    for uname, stats in per_user.items():
        risk = "Normal"
        if stats["candidate_views"] >= 8 and stats["views"] >= 12: risk = "Review"
        if stats["candidate_views"] >= 15: risk = "High"
        risk_rows.append({"username": uname, "full_name": (get_user(uname) or {}).get("full_name", uname), "page_views": stats["views"], "candidate_views": stats["candidate_views"], "risk": risk})
    risk_rows.sort(key=lambda x: (x["risk"] != "High", x["risk"] != "Review", -x["candidate_views"]))
    return rows[:50], risk_rows


def extract_text_from_pdf(path):
    reader = PdfReader(str(path)); chunks = []
    for page in reader.pages[:10]:
        try: chunks.append(page.extract_text() or "")
        except Exception: pass
    return "\n".join(chunks).strip()


def extract_text_from_docx(path):
    doc = Document(str(path)); return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def extract_text_from_image(path):
    if pytesseract is None: return ""
    try: return pytesseract.image_to_string(Image.open(path))
    except Exception: return ""


def simple_resume_extract(text):
    lines = [l.strip() for l in text.splitlines() if l.strip()]; joined = " \n".join(lines)
    email = re.search(r"[\w\.-]+@[\w\.-]+", joined); phone = re.search(r"(?:\+?91[-\s]?)?[6-9]\d{9}", joined); name = lines[0] if lines else ""; skills = []
    for key in ["excel", "customer support", "recruitment", "bpo", "sales", "english", "hindi", "communication", "calling"]:
        if key.lower() in joined.lower(): skills.append(key.title())
    return {"Name": name[:120], "Phone": (phone.group(0) if phone else ""), "Email": (email.group(0) if email else ""), "Top Skills": ", ".join(skills[:8]), "Summary": " ".join(lines[:8])[:800]}


def save_text_docx(text, path, title="Converted Document"):
    doc = Document(); doc.add_heading(title, 0)
    for para in text.splitlines():
        if para.strip(): doc.add_paragraph(para.strip())
    doc.save(str(path))


def save_text_pdf(text, path, title="Converted Document"):
    c = canvas.Canvas(str(path), pagesize=A4); width, height = A4; y = height - 50; c.setFont("Helvetica-Bold", 14); c.drawString(40, y, title); y -= 24; c.setFont("Helvetica", 10)
    for line in text.splitlines() or [""]:
        wrapped = [line[i:i+95] for i in range(0, len(line), 95)] or [""]
        for part in wrapped:
            if y < 60: c.showPage(); y = height - 50; c.setFont("Helvetica", 10)
            c.drawString(40, y, part); y -= 14
    c.save()


def save_text_image(text, path, title="Converted Image"):
    img = Image.new("RGB", (1400, 1800), color=(248, 251, 255)); draw = ImageDraw.Draw(img)
    try:
        font_title = ImageFont.truetype("DejaVuSans-Bold.ttf", 42); font = ImageFont.truetype("DejaVuSans.ttf", 26)
    except Exception:
        font_title = ImageFont.load_default(); font = ImageFont.load_default()
    y = 40; draw.text((40, y), title, fill=(24, 45, 82), font=font_title); y += 80
    for raw_line in (text.splitlines() or [""]):
        line = raw_line.strip() or " "; chunks = [line[i:i+70] for i in range(0, len(line), 70)] or [" "]
        for chunk in chunks:
            draw.text((40, y), chunk, fill=(40, 58, 88), font=font); y += 38
            if y > 1700: break
    img.save(str(path))


def process_cv_upload(upload, action):
    fname = secure_filename(upload.filename or "resume"); source_path = CV_UPLOAD_DIR / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{fname}"; upload.save(str(source_path)); suffix = source_path.suffix.lower(); text = ""
    if suffix == ".pdf": text = extract_text_from_pdf(source_path)
    elif suffix == ".docx": text = extract_text_from_docx(source_path)
    elif suffix in {".png", ".jpg", ".jpeg", ".webp"}: text = extract_text_from_image(source_path)
    else: text = source_path.read_text(encoding="utf-8", errors="ignore") if source_path.exists() else ""
    summary = simple_resume_extract(text); stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if action == "extract_details": out_path = GENERATED_DIR / f"resume_extract_{stamp}.docx"; save_text_docx("\n".join(f"{k}: {v}" for k, v in summary.items()), out_path, title="Resume Extract")
    elif action == "pdf_to_word": out_path = GENERATED_DIR / f"pdf_to_word_{stamp}.docx"; save_text_docx(text or json.dumps(summary, ensure_ascii=False, indent=2), out_path, title="PDF to Word")
    elif action == "word_to_pdf": out_path = GENERATED_DIR / f"word_to_pdf_{stamp}.pdf"; save_text_pdf(text or json.dumps(summary, ensure_ascii=False, indent=2), out_path, title="Word to PDF")
    elif action == "image_to_word":
        out_path = GENERATED_DIR / f"image_to_word_{stamp}.docx"; doc = Document(); doc.add_heading("Image to Word", 0)
        try: doc.add_picture(str(source_path), width=Inches(5.8))
        except Exception: pass
        doc.add_paragraph(text.strip() or "OCR text not available, image embedded in Word file."); doc.save(str(out_path))
    elif action == "word_to_image": out_path = GENERATED_DIR / f"word_to_image_{stamp}.png"; save_text_image(text or json.dumps(summary, ensure_ascii=False, indent=2), out_path, title="Word to Image")
    else: out_path = GENERATED_DIR / f"resume_extract_{stamp}.docx"; save_text_docx(text or json.dumps(summary, ensure_ascii=False, indent=2), out_path, title="Resume Extract")
    return source_path, out_path, summary

@app.route("/reports")
@login_required
def reports_page():
    log_page_activity("reports", {"query": dict(request.args)})
    filters = {"date_from": ensure_iso_date(request.args.get("date_from", "")), "date_to": ensure_iso_date(request.args.get("date_to", "")), "recruiters": request.args.getlist("recruiters"), "location": request.args.get("location", ""), "status": request.args.get("status", "")}
    scheduled_jobs = []
    try:
        for job in get_backend().list_rows("scheduled_reports"):
            item = dict(job); item["next_run_at_view"] = display_ts(item.get("next_run_at")); item["last_run_at_view"] = display_ts(item.get("last_run_at")); scheduled_jobs.append(item)
        scheduled_jobs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    except Exception: pass
    locations = sorted({c.get("location", "") for c in enrich_candidates() if c.get("location")})
    return render_template("reports.html", report_types=REPORT_TYPES, report_type=request.args.get("report_type", "submissions"), filters=filters, recruiters=recruiters_for_filters(), locations=locations, scheduled_jobs=scheduled_jobs, recent_exports=recent_export_files())

@app.route("/reports/generate")
@login_required
def generate_report_now():
    report_type = request.args.get("report_type", "submissions"); file_format = request.args.get("file_format", "xlsx"); filters = {"date_from": ensure_iso_date(request.args.get("date_from", "")), "date_to": ensure_iso_date(request.args.get("date_to", "")), "recruiters": request.args.getlist("recruiters"), "location": request.args.get("location", ""), "status": request.args.get("status", "")}
    filename, _, rows = make_report_file(report_type, filters, file_format); log_activity(current_user(), "report_generated", metadata={"report_type": report_type, "file": filename, "rows": len(rows)}); notify_users([current_user().get("user_id")], "Report generated", f"{report_type.replace('_', ' ').title()} report ready.", "report", {"file": filename})
    return redirect(url_for("download_report_file", filename=filename))

@app.route("/reports/schedule", methods=["POST"])
@login_required
def schedule_report():
    filters = {"date_from": ensure_iso_date(request.form.get("date_from", "")), "date_to": ensure_iso_date(request.form.get("date_to", "")), "recruiters": request.form.getlist("recruiters"), "location": request.form.get("location", ""), "status": request.form.get("status", "")}
    freq = max(5, parse_intish(request.form.get("frequency_minutes", "30"), 30)); now = datetime.now(); row = {"report_id": f"RP{int(now.timestamp()*1000)}{random.randint(100,999)}", "user_id": current_user().get("user_id"), "title": f"{request.form.get('report_type', 'submissions').replace('_', ' ').title()} report", "report_type": request.form.get("report_type", "submissions"), "filters_json": json.dumps(filters), "file_format": "xlsx", "frequency_minutes": str(freq), "status": "Active", "next_run_at": (now + timedelta(minutes=freq)).strftime("%Y-%m-%dT%H:%M:%S"), "last_run_at": "", "last_file_name": "", "created_at": now_iso()}
    get_backend().insert("scheduled_reports", row); flash("Report schedule saved. Due time aate hi file generate hogi and notification aayegi.", "success"); return redirect(url_for("reports_page", report_type=row["report_type"]))

@app.route("/reports/download/<path:filename>")
@login_required
def download_report_file(filename):
    return send_from_directory(str(EXPORT_DIR), filename, as_attachment=True)

@app.route("/recent-activity")
@login_required
def recent_activity_page():
    user = current_user()
    if normalize_role((user or {}).get("role")) not in {"manager", "tl"}:
        abort(403)
    selected_username = request.args.get("username", "").strip()
    users = list_users()
    user_by_username = {u.get("username"): u for u in users}
    rows = []
    for item in sorted([dict(a) for a in get_backend().list_rows("activity_log")], key=lambda x: x.get("created_at", ""), reverse=True):
        username = item.get("username", "")
        if selected_username and username != selected_username:
            continue
        who = user_by_username.get(username) or {}
        meta = safe_json_loads(item.get("metadata"), {})
        rows.append({
            "when": display_ts(item.get("created_at")),
            "full_name": who.get("full_name", username),
            "username": username,
            "designation": who.get("designation", who.get("role", "")).title(),
            "recruiter_code": who.get("recruiter_code", ""),
            "action": item.get("action_type", ""),
            "candidate_id": item.get("candidate_id", ""),
            "ip_address": meta.get("ip", ""),
            "meta": json.dumps(meta, ensure_ascii=False)[:160],
        })
    people = [u for u in users if normalize_role(u.get("role")) in {"manager", "tl", "recruiter"}]
    people.sort(key=lambda x: (normalize_role(x.get("role")) != "manager", normalize_role(x.get("role")) != "tl", x.get("full_name", "")))
    return render_template("recent_activity.html", rows=rows[:300], people=people, selected_username=selected_username)


@app.route("/generated/download/<path:filename>")
@login_required
def download_generated_file(filename):
    return send_from_directory(str(GENERATED_DIR), filename, as_attachment=True)

@app.route("/testing-ai", methods=["GET", "POST"])
@login_required

def testing_ai_page():
    cv_result = None
    if request.method == "POST" and request.files.get("cv_file"):
        action = request.form.get("cv_action", "extract_details"); source_path, out_path, summary = process_cv_upload(request.files["cv_file"], action); cv_result = {"source_name": source_path.name, "output_name": out_path.name, "summary": summary}; flash("CV tool processed file successfully.", "success"); log_activity(current_user(), "cv_tool", metadata={"action": action, "output": out_path.name})
    activity_rows, risk_rows = activity_monitor_rows(); queue_rows = [dict(r) for r in get_backend().list_rows("aaria_queue")]; queue_rows.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return render_template("testing_ai.html", cv_result=cv_result, activity_rows=activity_rows, risk_rows=risk_rows, queue_rows=queue_rows[:20])

@app.route("/aaria/execute", methods=["POST"])
@login_required
def aaria_execute():
    payload = request.get_json(silent=True) or request.form.to_dict(flat=True); command_text = payload.get("command", ""); serial_hint = payload.get("serial", ""); preview = str(payload.get("mode", "execute")).lower() == "preview"
    result = aaria_parse_instruction(command_text, serial_hint) if preview else aaria_execute_instruction(command_text, serial_hint, preview=False)
    cand = result.get("candidate") or {}
    if cand: result["candidate"] = {"candidate_id": cand.get("candidate_id") or cand.get("code", ""), "full_name": cand.get("full_name", ""), "phone": cand.get("phone", ""), "status": cand.get("status", ""), "location": cand.get("location", "")}
    return jsonify(result)

@app.route("/aaria/resolve")
@login_required
def aaria_resolve():
    cand = parse_candidate_hint(request.args.get("serial", ""))
    if not cand: return jsonify({"ok": False})
    return jsonify({"ok": True, "candidate": {"candidate_id": cand.get("candidate_id") or cand.get("code", ""), "full_name": cand.get("full_name", ""), "phone": cand.get("phone", ""), "status": cand.get("status", ""), "location": cand.get("location", "")}})

@app.route("/call/<candidate_code>")
@login_required
def log_call(candidate_code):
    cand = get_candidate(candidate_code) or parse_candidate_hint(candidate_code)
    if not cand: flash("Candidate not found.", "danger"); return redirect(url_for("candidates"))
    user = current_user(); log_activity(user, "manual_call", cand.get("candidate_id") or cand.get("code"), {"phone": cand.get("phone")}); ensure_presence_rows(); get_backend().update_where("presence", {"user_id": user.get("user_id")}, {"last_call_dial_at": now_iso(), "last_call_candidate_id": cand.get("candidate_id") or cand.get("code", ""), "last_seen_at": now_iso()}); return redirect(f"tel:+91{normalize_phone(cand.get('phone'))}")

@app.route("/whatsapp/<candidate_code>")
@login_required
def open_whatsapp(candidate_code):
    cand = get_candidate(candidate_code) or parse_candidate_hint(candidate_code)
    if not cand:
        flash("Candidate not found.", "danger")
        return redirect(url_for("candidates"))
    user = current_user()
    log_activity(user, "manual_whatsapp", cand.get("candidate_id") or cand.get("code"), {"phone": cand.get("phone")})
    message = request.args.get("text", "").strip() or f"Hello {cand.get('full_name')}, this is Career Crox."
    return redirect(f"https://wa.me/91{normalize_phone(cand.get('phone'))}?text={quote(message)}")

# improved JD upload handling

def professional_create_jd_v2():
    rows = get_backend().list_rows("jd_master"); pdf_url = request.form.get("pdf_url", "").strip(); upload = request.files.get("jd_pdf")
    if upload and upload.filename:
        safe_name = secure_filename(upload.filename); final_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{safe_name}"; save_path = JD_UPLOAD_DIR / final_name; upload.save(str(save_path)); pdf_url = f"/static/uploads/jds/{final_name}"
    row = {"jd_id": f"J{len(rows)+1:03d}", "job_title": request.form.get("job_title", "").strip(), "company": request.form.get("company", "").strip(), "location": request.form.get("location", "").strip(), "experience": request.form.get("experience", "").strip(), "salary": request.form.get("salary", "").strip(), "pdf_url": pdf_url, "jd_status": request.form.get("jd_status", "Open").strip() or "Open", "notes": request.form.get("notes", "").strip(), "created_at": now_iso()}
    if not row["job_title"] or not row["company"]: flash("JD title and company are required.", "danger"); return redirect(url_for("jds"))
    get_backend().insert("jd_master", row); log_activity(current_user(), "jd_created", metadata={"jd_id": row["jd_id"]}); flash(f"JD {row['job_title']} added successfully.", "success"); return redirect(url_for("jds"))

app.view_functions["create_jd"] = login_required(professional_create_jd_v2)

# improved interviews page with filters and recruiter code visibility

def professional_interviews_v2():
    q = request.args.get("q", "").strip().lower(); recruiter = request.args.get("recruiter", "").strip(); location = request.args.get("location", "").strip(); date_from = ensure_iso_date(request.args.get("date_from", "")); date_to = ensure_iso_date(request.args.get("date_to", "")); rows = []; candidates_by_id = candidate_map(); jds_by_id = {j.get("jd_id"): dict(j) for j in get_backend().list_rows("jd_master")}
    for row in get_backend().list_rows("interviews"):
        item = dict(row); c = candidates_by_id.get(item.get("candidate_id")) or {}; jd = jds_by_id.get(item.get("jd_id")) or {}
        item["full_name"] = c.get("full_name", item.get("candidate_id", "")); item["recruiter_code"] = c.get("recruiter_code", ""); item["recruiter_name"] = c.get("recruiter_name", ""); item["location"] = c.get("location", ""); item["title"] = jd.get("job_title", c.get("process", "")); item["scheduled_at"] = display_ts(item.get("scheduled_at"))
        search_blob = " ".join([item.get("full_name", ""), item.get("candidate_id", ""), item.get("recruiter_code", ""), item.get("recruiter_name", ""), item.get("location", ""), item.get("title", "")]).lower()
        if q and q not in search_blob: continue
        if recruiter and item.get("recruiter_code") != recruiter: continue
        if location and item.get("location") != location: continue
        row_date = ensure_iso_date((item.get("scheduled_at") or "")[:10])
        if date_from and row_date and row_date < date_from: continue
        if date_to and row_date and row_date > date_to: continue
        rows.append(item)
    rows.sort(key=lambda x: x.get("scheduled_at", "")); log_page_activity("interviews", {"q": q, "recruiter": recruiter, "location": location})
    return render_template("interviews.html", interviews=rows, q=request.args.get("q", ""), recruiters=recruiters_for_filters(), current_recruiter=recruiter, locations=sorted({c.get('location','') for c in enrich_candidates() if c.get('location')}), current_location=location, date_from=date_from, date_to=date_to)

app.view_functions["interviews"] = login_required(professional_interviews_v2)

# better task resolver for autocomplete usernames / names / recruiter codes

def find_user_by_hint(hint):
    hint = (hint or "").strip().lower()
    if not hint: return None
    for u in list_users():
        if hint == u.get("username", "").lower() or hint == u.get("recruiter_code", "").lower(): return u
    for u in list_users():
        if hint in u.get("full_name", "").lower() or hint in u.get("username", "").lower() or hint in u.get("recruiter_code", "").lower(): return u
    return None

@app.route("/task/create-v2", methods=["POST"])
@login_required
def create_task_v2():
    target = find_user_by_hint(request.form.get("assigned_to_username", "")); creator = current_user()
    if not target: flash("Assigned username / name not found.", "danger"); return redirect(url_for("tasks"))
    rows = get_backend().list_rows("tasks"); row = {"task_id": f"T{len(rows)+1:03d}", "title": request.form.get("title", "").strip(), "description": request.form.get("description", "").strip(), "assigned_to_user_id": target["user_id"], "assigned_to_name": target["full_name"], "assigned_by_user_id": creator["user_id"], "assigned_by_name": creator["full_name"], "status": request.form.get("status", "Open").strip() or "Open", "priority": request.form.get("priority", "Normal").strip() or "Normal", "due_date": parse_local_datetime(request.form.get("due_date", "")) or datetime.now().strftime("%Y-%m-%d %H:%M"), "created_at": now_iso(), "updated_at": now_iso()}
    if not row["title"]: flash("Task title required.", "danger"); return redirect(url_for("tasks"))
    get_backend().insert("tasks", row); notify_users([target.get("user_id")], "Task assigned", row["title"], "task", {"task_id": row["task_id"]}); log_activity(creator, "task_created", metadata={"task_id": row["task_id"], "assigned_to": target.get("username")}); flash("Task added.", "success"); return redirect(url_for("tasks"))

app.view_functions["create_task"] = login_required(create_task_v2)

def tasks_v2():
    user = current_user(); rows = []; users_by_id = user_map("user_id")
    for t in get_backend().list_rows("tasks"):
        item = dict(t); assigned_user = users_by_id.get(item.get("assigned_to_user_id")) or {}; item["full_name"] = assigned_user.get("full_name", item.get("assigned_to_name", "")); item["due_at"] = display_ts(item.get("due_date", ""))
        if user["role"] != "manager" and item.get("assigned_to_user_id") != user["user_id"]: continue
        rows.append(item)
    rows.sort(key=lambda x: x.get("due_at", "")); log_page_activity("tasks"); return render_template("tasks.html", tasks=rows)

app.view_functions["tasks"] = login_required(tasks_v2)

_old_candidates_view = app.view_functions.get("candidates")
def candidates_v3(*args, **kwargs):
    resp = _old_candidates_view(*args, **kwargs); log_page_activity("candidates", {"q": request.args.get("q", "")}); return resp
app.view_functions["candidates"] = login_required(candidates_v3)

_old_candidate_detail_view = app.view_functions.get("candidate_detail")
def candidate_detail_v3(*args, **kwargs):
    resp = _old_candidate_detail_view(*args, **kwargs); log_page_activity("candidate_detail", {"candidate": kwargs.get("candidate_code", "")}); return resp
app.view_functions["candidate_detail"] = login_required(candidate_detail_v3)

# attendance notification + logging overrides
_old_attendance_view = app.view_functions.get("attendance_breaks")
def attendance_breaks_v2(*args, **kwargs):
    log_page_activity("attendance"); return _old_attendance_view(*args, **kwargs)
app.view_functions["attendance_breaks"] = login_required(attendance_breaks_v2)

def attendance_start_break_v2():
    user = current_user(); reason = request.form.get("break_reason", "Tea Break").strip() or "Tea Break"; duration = max(1, min(120, parse_intish(request.form.get("break_minutes", "15"), 15))); end_at = datetime.now() + timedelta(minutes=duration)
    get_backend().update_where("presence", {"user_id": user.get("user_id")}, {"is_on_break": "1", "break_reason": reason, "break_started_at": now_iso(), "break_expected_end_at": end_at.strftime("%Y-%m-%dT%H:%M:%S"), "last_seen_at": now_iso()})
    notify_users([u.get("user_id") for u in manager_and_tl_users() if u.get("user_id") != user.get("user_id")], "Break started", f"{user.get('full_name')} started {reason} for {duration} minutes.", "attendance", {"user_id": user.get("user_id")}); log_activity(user, "break_started", metadata={"reason": reason, "minutes": duration}); flash("Break started.", "success"); return redirect(url_for("attendance_breaks"))
app.view_functions["attendance_start_break"] = login_required(attendance_start_break_v2)

def attendance_end_break_v2():
    user = current_user(); row = get_presence_for_user(user.get("user_id")) or {}; total_break = parse_intish(row.get("total_break_minutes"), 0)
    if row.get("break_started_at"):
        try: total_break += max(0, int((datetime.now() - datetime.fromisoformat(str(row.get("break_started_at")))).total_seconds() // 60))
        except Exception: pass
    get_backend().update_where("presence", {"user_id": user.get("user_id")}, {"is_on_break": "0", "break_reason": "", "break_started_at": "", "break_expected_end_at": "", "total_break_minutes": str(total_break), "last_seen_at": now_iso()})
    notify_users([u.get("user_id") for u in manager_and_tl_users() if u.get("user_id") != user.get("user_id")], "Break ended", f"{user.get('full_name')} is back from break.", "attendance", {"user_id": user.get("user_id")}); log_activity(user, "break_ended", metadata={"total_break": total_break}); flash("Break ended.", "success"); return redirect(url_for("attendance_breaks"))
app.view_functions["attendance_end_break"] = login_required(attendance_end_break_v2)




# === final row-open + multi-command Aaria + break watch patch ===
def extract_candidate_hint_from_text(command_text):
    raw = command_text or ""
    for pattern in [r"\bC\d{3,4}\b", r"\b\d{3,10}\b"]:
        m = re.search(pattern, raw, re.I)
        if m:
            return m.group(0)
    raw_l = raw.lower()
    for c in enrich_candidates():
        full_name = str(c.get("full_name", "")).strip()
        if not full_name:
            continue
        parts = [p for p in re.split(r"\s+", full_name.lower()) if len(p) >= 3]
        if full_name.lower() in raw_l or any(p in raw_l for p in parts):
            return full_name
    return ""


def split_aaria_commands(command_text):
    raw = (command_text or "").replace("\n", ";").replace("|", ";")
    raw = raw.replace("।", ";").replace("؛", ";")
    multi_refs = len(re.findall(r"\b(?:C\d{3,4}|\d{3,10}|T\d{3,4})\b", raw, re.I))
    if raw.count(",") >= 1 and multi_refs > 1:
        raw = raw.replace(",", ";")
    if multi_refs > 1:
        raw = re.sub(r"\s+(?:and|aur|&|और)\s+(?=(?:C\d{3,4}|\d{3,10}|T\d{3,4}))", "; ", raw, flags=re.I)
    parts = [p.strip(" -") for p in re.split(r"\s*;\s*", raw) if p.strip(" -")]
    return parts[:10]


def parse_task_hint(task_hint):
    hint = (task_hint or "").strip().lower()
    if not hint:
        return None
    tasks = [dict(t) for t in get_backend().list_rows("tasks")]
    for t in tasks:
        if hint == str(t.get("task_id", "")).lower():
            return t
    for t in tasks:
        blob = " ".join([str(t.get("task_id", "")), str(t.get("title", "")), str(t.get("description", "")), str(t.get("assigned_to_name", ""))]).lower()
        if hint in blob:
            return t
    return None


def aaria_parse_instruction_v2(command_text, serial_hint=""):
    raw = (command_text or "").strip()
    text = raw.lower()
    action = None
    payload = {}
    candidate = parse_candidate_hint(serial_hint) if serial_hint else None
    if not candidate:
        candidate = parse_candidate_hint(extract_candidate_hint_from_text(raw))
    if not candidate:
        candidate = parse_candidate_hint(raw)
    task = parse_task_hint(extract_candidate_hint_from_text(raw)) if ("task" in text or re.search(r"\bT\d{3,4}\b", raw, re.I)) else None

    if any(k in text for k in ["theme", "color theme", "colour theme"]):
        aliases = {"corporate": "corporate-light", "ocean": "ocean", "mint": "mint", "sunset": "sunset", "lavender": "lavender", "dark": "dark-pro", "silver": "silver-pro"}
        for theme in sorted(ALLOWED_THEMES):
            if theme in text:
                action = "theme"
                payload["theme"] = theme
                break
        if not action:
            for key, val in aliases.items():
                if key in text:
                    action = "theme"
                    payload["theme"] = val
                    break
    elif any(k in text for k in ["call", "dial"]):
        action = "call"
    elif "whatsapp" in text or "whats app" in text or " wa " in f" {text} ":
        action = "whatsapp"
        m = re.search(r"message[:\-]?\s*(.+)$", raw, re.I)
        msg = m.group(1).strip() if m else ""
        if not msg:
            m2 = re.search(r"whatsapp(?: pe)?\s+(.+?)(?:\s+kar do|\s+bhej do|\s+draft karo|$)", raw, re.I)
            msg = m2.group(1).strip() if m2 else ""
        if not msg and ("waiting" in text or "wait" in text):
            msg = "Aapka profile abhi waiting me hai. Shortlist update aate hi hum aapko inform karenge."
        if candidate:
            payload["message"] = msg or f"Hello {candidate.get('full_name','')}, Career Crox se message."
        else:
            payload["message"] = msg or "Hello from Career Crox."
    elif any(k in text for k in ["not interested", "notinterested"]):
        action = "candidate_status"
        payload["status"] = "Not Interested"
    elif any(k in text for k in ["reject", "rejected"]):
        action = "candidate_status"
        payload["status"] = "Rejected"
    elif any(k in text for k in ["select", "selected"]):
        action = "candidate_status"
        payload["status"] = "Selected"
    elif "interview" in text and any(k in text for k in ["date", "reschedule", "schedule", "kal", "tomorrow", "today", "baje"]):
        action = "interview_date"
        payload["scheduled_at"] = parse_command_target_date(raw)
    elif ("phone" in text or "number" in text) and any(k in text for k in ["change", "update", "kar do", "set", "replace"]):
        m = re.search(r"([6-9]\d{9})", raw)
        if m:
            action = "phone_update"
            payload["phone"] = normalize_phone(m.group(1))
    elif "note" in text:
        action = "add_note"
        m = re.search(r"note(?:s)?(?: me| mein| में|:)?\s*(.+)$", raw, re.I)
        payload["note"] = m.group(1).strip() if m else raw
        payload["note_type"] = "public"
    elif "task" in text and any(k in text for k in ["add", "create"]):
        action = "task_create"
        title = re.sub(r"\b(?:add|create|task|for|candidate|profile)\b", " ", raw, flags=re.I)
        title = re.sub(r"\bC\d{3,4}\b", " ", title, flags=re.I)
        title = re.sub(r"\s+", " ", title).strip(" :-") or f"Follow up {candidate.get('full_name','candidate')}"
        payload["title"] = title
    elif task and any(k in text for k in ["close", "closed", "done"]):
        action = "task_update"
        payload["status"] = "Closed"
    elif task and any(k in text for k in ["open", "reopen"]):
        action = "task_update"
        payload["status"] = "Open"
    elif task and "pending" in text:
        action = "task_update"
        payload["status"] = "Pending"

    if not action:
        return {"ok": False, "message": "Instruction not clear. Example: reject C001; select C002; add a note to C003; close T001.", "action": "none", "candidate": candidate}
    if action in {"call", "whatsapp", "candidate_status", "interview_date", "add_note", "phone_update"} and not candidate:
        return {"ok": False, "message": "Candidate nahi mila. Name, Candidate ID, serial, ya phone last digits do.", "action": action}
    if action == "task_update" and not task:
        return {"ok": False, "message": "Task nahi mila. T001 jaisa task id do.", "action": action}
    msg = "Ready."
    if action == "candidate_status":
        msg = f"{candidate.get('full_name')} ko {payload['status']} mark karne ke liye ready."
    elif action == "interview_date":
        msg = f"{candidate.get('full_name')} ka interview {payload['scheduled_at']} par set karne ke liye ready."
    elif action == "add_note":
        msg = f"A note will be added for {candidate.get('full_name')}: {payload['note'][:120]}"
    elif action == "phone_update":
        msg = f"The phone number for {candidate.get('full_name')} will be updated to {payload['phone']}."
    elif action == "task_create":
        msg = f"Task ready: {payload['title']}"
    elif action == "task_update":
        msg = f"{task.get('task_id')} ko {payload['status']} kiya jayega."
    elif action == "theme":
        msg = f"Theme preview ready: {payload['theme']}"
    elif action == "call":
        msg = f"Call shortcut ready for {candidate.get('full_name')}"
    elif action == "whatsapp":
        msg = f"WhatsApp draft ready for {candidate.get('full_name')}"
    return {"ok": True, "action": action, "payload": payload, "message": msg, "candidate": candidate, "task": task}


def aaria_execute_single_v2(command_text, serial_hint="", preview=False):
    parsed = aaria_parse_instruction_v2(command_text, serial_hint)
    if not parsed.get("ok"):
        return parsed
    user = current_user()
    action = parsed["action"]
    payload = parsed.get("payload", {})
    candidate = parsed.get("candidate")
    task = parsed.get("task")
    response = dict(parsed)
    if preview:
        return response
    if action == "theme":
        theme = normalize_theme(payload.get("theme"))
        get_backend().update_where("users", {"user_id": user["user_id"]}, {"theme_name": theme, "updated_at": now_iso()})
        session["theme_name"] = theme
        response["message"] = f"Theme changed to {theme}."
        response["avatar_state"] = "success"
    elif action == "call":
        phone = normalize_phone(candidate.get("phone"))
        response["message"] = f"Dialer khul raha hai for {candidate.get('full_name')}."
        response["action_link"] = f"tel:+91{phone}"
        response["action_type"] = "call"
        response["avatar_state"] = "call"
        log_activity(user, "aaria_call", candidate.get("candidate_id"), {"phone": phone})
    elif action == "whatsapp":
        phone = normalize_phone(candidate.get("phone"))
        message = payload.get("message") or f"Hello {candidate.get('full_name')}, Career Crox se message."
        response["message"] = f"WhatsApp draft ready for {candidate.get('full_name')}."
        response["action_link"] = f"https://wa.me/91{phone}?text={quote(message)}"
        response["action_type"] = "whatsapp"
        response["avatar_state"] = "success"
        log_activity(user, "aaria_whatsapp", candidate.get("candidate_id"), {"phone": phone})
    elif action == "candidate_status":
        get_backend().update_where("candidates", {"candidate_id": candidate.get("candidate_id")}, {"status": payload["status"], "updated_at": now_iso()})
        log_activity(user, "aaria_status_update", candidate.get("candidate_id"), {"status": payload["status"]})
        response["message"] = f"{candidate.get('full_name')} ko {payload['status']} mark kar diya."
        response["avatar_state"] = "success"
    elif action == "interview_date":
        existing = next((dict(i) for i in get_backend().list_rows("interviews") if i.get("candidate_id") == candidate.get("candidate_id")), None)
        jd_match = next((j for j in get_backend().list_rows("jd_master") if (j.get("company") or "").strip().lower() == ((candidate.get("process") or "").split(',')[0].strip().lower())), None)
        if existing:
            get_backend().update_where("interviews", {"interview_id": existing["interview_id"]}, {"scheduled_at": payload["scheduled_at"], "status": "Scheduled", "stage": "Interview Scheduled"})
        else:
            get_backend().insert("interviews", {"interview_id": next_prefixed_id("interviews", "interview_id", "I"), "candidate_id": candidate.get("candidate_id"), "jd_id": (jd_match or {}).get("jd_id", ""), "stage": "Interview Scheduled", "scheduled_at": payload["scheduled_at"], "status": "Scheduled", "created_at": now_iso()})
        get_backend().update_where("candidates", {"candidate_id": candidate.get("candidate_id")}, {"interview_reschedule_date": payload["scheduled_at"], "status": "Interview Scheduled", "updated_at": now_iso()})
        response["message"] = f"Interview updated for {candidate.get('full_name')} on {payload['scheduled_at']}."
        response["avatar_state"] = "success"
        log_activity(user, "aaria_interview_update", candidate.get("candidate_id"), {"scheduled_at": payload["scheduled_at"]})
    elif action == "add_note":
        get_backend().insert("notes", {"candidate_id": candidate.get("candidate_id"), "username": user.get("username"), "note_type": payload.get("note_type", "public"), "body": payload.get("note", ""), "created_at": now_iso()})
        response["message"] = f"Note add kar diya for {candidate.get('full_name')}."
        response["avatar_state"] = "success"
        log_activity(user, "aaria_note_added", candidate.get("candidate_id"), {"note": payload.get("note", "")[:140]})
    elif action == "phone_update":
        get_backend().update_where("candidates", {"candidate_id": candidate.get("candidate_id")}, {"phone": payload.get("phone"), "updated_at": now_iso()})
        response["message"] = f"{candidate.get('full_name')} ka phone update kar diya."
        response["avatar_state"] = "success"
        log_activity(user, "aaria_phone_update", candidate.get("candidate_id"), {"phone": payload.get("phone")})
    elif action == "task_create":
        task_id = next_prefixed_id("tasks", "task_id", "T")
        desc = f"Aaria task for {candidate.get('full_name')} ({candidate.get('candidate_id')})" if candidate else "Aaria generated task"
        get_backend().insert("tasks", {"task_id": task_id, "title": payload.get("title"), "description": desc, "assigned_to_user_id": user.get("user_id"), "assigned_to_name": user.get("full_name"), "assigned_by_user_id": user.get("user_id"), "assigned_by_name": user.get("full_name"), "status": "Open", "priority": "Normal", "due_date": datetime.now().strftime("%Y-%m-%d %H:%M"), "created_at": now_iso(), "updated_at": now_iso()})
        response["message"] = f"Task {task_id} create kar diya."
        response["avatar_state"] = "success"
        log_activity(user, "aaria_task_create", candidate.get("candidate_id") if candidate else "", {"task_id": task_id, "title": payload.get("title")})
    elif action == "task_update":
        get_backend().update_where("tasks", {"task_id": task.get("task_id")}, {"status": payload.get("status"), "updated_at": now_iso()})
        response["message"] = f"{task.get('task_id')} ko {payload.get('status')} kar diya."
        response["avatar_state"] = "success"
        log_activity(user, "aaria_task_update", metadata={"task_id": task.get("task_id"), "status": payload.get("status")})
    get_backend().insert("aaria_queue", {"task_id": f"AQ{int(datetime.now().timestamp()*1000)}{random.randint(100,999)}", "user_id": user.get("user_id", ""), "serial_hint": serial_hint or extract_candidate_hint_from_text(command_text), "command_text": command_text, "status": "Completed", "result_text": response.get("message", ""), "created_at": now_iso(), "updated_at": now_iso()})
    return response


def aaria_execute_batch(command_text, serial_hint="", preview=False):
    commands = split_aaria_commands(command_text)
    if not commands:
        return {"ok": False, "message": "Instruction not clear. Command khali hai.", "batch_results": []}
    results = []
    for cmd in commands:
        serial_for_cmd = serial_hint or extract_candidate_hint_from_text(cmd)
        item = aaria_execute_single_v2(cmd, serial_for_cmd, preview=preview)
        item["command"] = cmd
        results.append(item)
    ok_count = len([r for r in results if r.get("ok")])
    fail_count = len(results) - ok_count
    primary = next((r for r in results if r.get("candidate")), results[0] if results else {})
    return {"ok": ok_count > 0, "message": f"{ok_count} command complete, {fail_count} need review.", "batch_results": results, "candidate": primary.get("candidate"), "avatar_state": "success" if fail_count == 0 else "warning"}


def break_count_today_for_user(user_id):
    today = datetime.now().strftime("%Y-%m-%d")
    count = 0
    for a in get_backend().list_rows("activity_log"):
        if a.get("user_id") == user_id and a.get("action_type") == "break_started" and str(a.get("created_at", "")).startswith(today):
            count += 1
    return count


def break_remaining_minutes(row):
    if not row or not row.get("break_expected_end_at"):
        return 0
    try:
        end_at = datetime.fromisoformat(str(row.get("break_expected_end_at")))
        return max(0, int((end_at - datetime.now()).total_seconds() // 60))
    except Exception:
        return 0


def maybe_auto_lock_overdue_break(user):
    if not user:
        return False
    row = get_presence_for_user(user.get("user_id")) or {}
    if (not to_boolish(row.get("is_on_break", "0"))) or to_boolish(row.get("locked", "0")) or (not row.get("break_expected_end_at")):
        return False
    try:
        end_at = datetime.fromisoformat(str(row.get("break_expected_end_at")))
    except Exception:
        return False
    overdue_seconds = (datetime.now() - end_at).total_seconds()
    if overdue_seconds < 60:
        return False
    get_backend().update_where("presence", {"user_id": user.get("user_id")}, {"locked": "1", "last_seen_at": now_iso()})
    existing = next((r for r in get_backend().list_rows("unlock_requests") if r.get("user_id") == user.get("user_id") and r.get("status") == "Pending"), None)
    if not existing:
        get_backend().insert("unlock_requests", {"request_id": next_prefixed_id("unlock_requests", "request_id", "UR"), "user_id": user.get("user_id"), "status": "Pending", "reason": "Late return from break auto-lock", "requested_at": now_iso(), "approved_by_user_id": "", "approved_by_name": "", "approved_at": ""})
        notify_users([u.get("user_id") for u in manager_and_tl_users()], "Auto lock due to late break", f"{user.get('full_name')} break time cross hone ke 60 second baad auto lock ho gaya.", "attendance", {"user_id": user.get("user_id")})
    log_activity(user, "break_auto_locked", metadata={"break_end": row.get("break_expected_end_at")})
    return True


def attendance_breaks_v3(*args, **kwargs):
    ensure_presence_rows()
    maybe_auto_lock_overdue_break(current_user())
    users_by_id = user_map("user_id")
    rows = []
    for row in get_backend().list_rows("presence"):
        item = dict(row)
        user = users_by_id.get(item.get("user_id")) or {}
        item["full_name"] = user.get("full_name", item.get("user_id", ""))
        item["designation"] = user.get("designation", "")
        item["role"] = user.get("role", "")
        item["is_on_break_bool"] = to_boolish(item.get("is_on_break", "0"))
        item["locked_bool"] = to_boolish(item.get("locked", "0"))
        item["last_seen_at_view"] = display_ts(item.get("last_seen_at"))
        item["work_started_at_view"] = display_ts(item.get("work_started_at"))
        item["break_expected_end_at_view"] = display_ts(item.get("break_expected_end_at"))
        item["total_break_human"] = humanize_minutes(item.get("total_break_minutes", "0"))
        rows.append(item)
    rows.sort(key=lambda x: (x.get("role", ""), x.get("full_name", "")))
    current_presence = get_presence_for_user(current_user().get("user_id")) or {}
    current_presence["total_break_human"] = humanize_minutes(current_presence.get("total_break_minutes", "0"))
    current_presence["break_count"] = break_count_today_for_user(current_user().get("user_id"))
    current_presence["remaining_break_human"] = humanize_minutes(break_remaining_minutes(current_presence)) if current_presence.get("is_on_break") in ["1", 1] else "0m"
    unlock_requests = [dict(r) for r in get_backend().list_rows("unlock_requests")]
    unlock_requests.sort(key=lambda x: x.get("requested_at", ""), reverse=True)
    return render_template("attendance.html", presence_rows=rows, current_presence=current_presence, break_options=BREAK_OPTIONS, unlock_requests=unlock_requests[:8], working_now=len([r for r in rows if not r.get("locked_bool")]), on_break_now=len([r for r in rows if r.get("is_on_break_bool")]), locked_now=len([r for r in rows if r.get("locked_bool")]))


@app.route("/attendance/break-watch", methods=["POST"])
@login_required
def attendance_break_watch():
    locked = maybe_auto_lock_overdue_break(current_user())
    return jsonify({"ok": True, "locked": locked})


@app.route("/task/<task_id>")
@login_required
def task_detail(task_id):
    task = next((dict(t) for t in get_backend().list_rows("tasks") if t.get("task_id") == task_id), None)
    if not task:
        abort(404)
    due_raw = str(task.get("due_date") or "")
    due_local = due_raw.replace(" ", "T")[:16] if due_raw else ""
    log_page_activity("task_detail", {"task_id": task_id})
    return render_template("task_detail.html", task=task, due_local=due_local)


@app.route("/task/<task_id>/update", methods=["POST"])
@login_required
def update_task(task_id):
    task = next((dict(t) for t in get_backend().list_rows("tasks") if t.get("task_id") == task_id), None)
    if not task:
        abort(404)
    target = find_user_by_hint(request.form.get("assigned_to_username", "")) if request.form.get("assigned_to_username") else None
    status = request.form.get("quick_status") or request.form.get("status") or task.get("status", "Open")
    values = {"title": request.form.get("title", task.get("title", "")).strip(), "description": request.form.get("description", task.get("description", "")).strip(), "priority": request.form.get("priority", task.get("priority", "Normal")).strip(), "status": status.strip(), "due_date": parse_local_datetime(request.form.get("due_date", "")) or task.get("due_date", ""), "updated_at": now_iso()}
    if target:
        values["assigned_to_user_id"] = target.get("user_id")
        values["assigned_to_name"] = target.get("full_name")
    get_backend().update_where("tasks", {"task_id": task_id}, values)
    log_activity(current_user(), "task_updated", metadata={"task_id": task_id, "status": values.get("status")})
    flash(f"Task {task_id} updated.", "success")
    return redirect(url_for("task_detail", task_id=task_id))


def aaria_execute_v2():
    payload = request.get_json(silent=True) or request.form.to_dict(flat=True)
    command_text = payload.get("command", "")
    serial_hint = payload.get("serial", "")
    preview = str(payload.get("mode", "execute")).lower() == "preview"
    result = aaria_execute_batch(command_text, serial_hint, preview=preview)
    cand = result.get("candidate") or {}
    if cand:
        result["candidate"] = {"candidate_id": cand.get("candidate_id") or cand.get("code", ""), "full_name": cand.get("full_name", ""), "phone": cand.get("phone", ""), "status": cand.get("status", ""), "location": cand.get("location", "")}
    return jsonify(result)


app.view_functions["attendance_breaks"] = login_required(attendance_breaks_v3)
app.view_functions["aaria_execute"] = login_required(aaria_execute_v2)



# === final scope + lock + bulk queue patch ===
def visible_recruiter_codes_for(user):
    role = normalize_role((user or {}).get("role"))
    if role in {"manager", "tl"}:
        return {u.get("recruiter_code") for u in list_users() if normalize_role(u.get("role")) == "recruiter" and u.get("recruiter_code")}
    return {((user or {}).get("recruiter_code") or "").strip()} if (user or {}).get("recruiter_code") else set()


def candidate_visible_to_user(candidate, user):
    if not user:
        return False
    role = normalize_role(user.get("role"))
    if role in {"manager", "tl"}:
        return True
    return (candidate.get("recruiter_code") or "").strip() == (user.get("recruiter_code") or "").strip()


def visible_candidates_rows(user):
    cache = getattr(g, "_visible_candidates_cache", None)
    if cache is None:
        g._visible_candidates_cache = {}
        cache = g._visible_candidates_cache
    key = (user or {}).get("user_id") or (user or {}).get("username") or "guest"
    if key in cache:
        return [dict(r) for r in cache[key]]
    rows = [ensure_candidate_defaults(c) for c in enrich_candidates() if not to_boolish(c.get("is_duplicate", "0"))]
    rows = [c for c in rows if candidate_visible_to_user(c, user)]
    cache[key] = [dict(r) for r in rows]
    return [dict(r) for r in rows]


def visible_candidate_ids(user):
    cache = getattr(g, "_visible_candidate_ids_cache", None)
    if cache is None:
        g._visible_candidate_ids_cache = {}
        cache = g._visible_candidate_ids_cache
    key = (user or {}).get("user_id") or (user or {}).get("username") or "guest"
    if key not in cache:
        cache[key] = {c.get("candidate_id") for c in visible_candidates_rows(user) if c.get("candidate_id")}
    return set(cache[key])


def approver_users_for(user):
    role = normalize_role((user or {}).get("role"))
    users = list_users()
    if role == "manager":
        return []
    if role == "tl":
        return [u for u in users if normalize_role(u.get("role")) == "manager"]
    return [u for u in users if normalize_role(u.get("role")) in {"manager", "tl"}]


def pending_unlock_request_for(user_id):
    for req in sorted([dict(r) for r in get_backend().list_rows("unlock_requests")], key=lambda x: x.get("requested_at", ""), reverse=True):
        if req.get("user_id") == user_id and (req.get("status") or "").lower() == "pending":
            return req
    return None


def lock_reason_message(reason):
    reason = (reason or "").strip()
    if "Late return from break" in reason:
        return "Break khatam hone ke 90 second baad CRM auto-lock ho gaya. Unlock ke liye TL / Manager approval chahiye."
    if "Inactivity" in reason:
        return "The CRM was locked after five minutes of inactivity. Access will remain locked until approval is granted."
    return reason or "CRM locked. Unlock approval required."


def create_unlock_request_if_missing(user, reason):
    existing = pending_unlock_request_for(user.get("user_id"))
    if existing:
        return existing
    row = {
        "request_id": next_prefixed_id("unlock_requests", "request_id", "UR"),
        "user_id": user.get("user_id"),
        "status": "Pending",
        "reason": reason,
        "requested_at": now_iso(),
        "approved_by_user_id": "",
        "approved_by_name": "",
        "approved_at": "",
    }
    get_backend().insert("unlock_requests", row)
    notify_users([u.get("user_id") for u in approver_users_for(user)], "Unlock request", f"{user.get('full_name')} ko unlock approval chahiye.", "attendance", {"user_id": user.get("user_id"), "reason": reason})
    return row


def force_lock_user(user, reason):
    if not user or normalize_role(user.get("role")) == "manager":
        return False
    ensure_presence_rows()
    row = get_presence_for_user(user.get("user_id")) or {}
    if to_boolish(row.get("locked", "0")):
        create_unlock_request_if_missing(user, reason)
        return False
    values = {"locked": "1", "last_seen_at": now_iso()}
    if "break" in reason.lower():
        values.update({"is_on_break": "0", "break_reason": "", "break_started_at": "", "break_expected_end_at": ""})
    get_backend().update_where("presence", {"user_id": user.get("user_id")}, values)
    create_unlock_request_if_missing(user, reason)
    log_activity(user, "crm_locked", metadata={"reason": reason})
    return True


def maybe_auto_lock_overdue_break_v5(user):
    if not user or normalize_role(user.get("role")) == "manager":
        return False
    row = get_presence_for_user(user.get("user_id")) or {}
    if not to_boolish(row.get("is_on_break", "0")) or not row.get("break_expected_end_at"):
        return False
    try:
        end_at = datetime.fromisoformat(str(row.get("break_expected_end_at")))
    except Exception:
        return False
    overdue_seconds = (datetime.now() - end_at).total_seconds()
    if overdue_seconds < 90:
        return False
    return force_lock_user(user, "Late return from break auto-lock")


def maybe_auto_lock_inactive_v5(user):
    if not user or normalize_role(user.get("role")) == "manager":
        return False
    row = get_presence_for_user(user.get("user_id")) or {}
    if to_boolish(row.get("locked", "0")) or to_boolish(row.get("is_on_break", "0")):
        return False
    last_seen = row.get("last_seen_at") or row.get("work_started_at")
    if not last_seen:
        return False
    try:
        last_dt = datetime.fromisoformat(str(last_seen))
    except Exception:
        return False
    if (datetime.now() - last_dt).total_seconds() < 300:
        return False
    return force_lock_user(user, "Inactivity auto-lock")


def can_unlock_request(actor, request_row):
    actor_role = normalize_role((actor or {}).get("role"))
    if actor_role == "manager":
        return True
    if actor_role != "tl":
        return False
    target_user = user_map("user_id").get(request_row.get("user_id")) or {}
    return normalize_role(target_user.get("role")) == "recruiter"


def human_lock_summary(user):
    presence = get_presence_for_user((user or {}).get("user_id")) or {}
    req = pending_unlock_request_for((user or {}).get("user_id"))
    return {
        "locked": to_boolish(presence.get("locked", "0")) if user else False,
        "reason": lock_reason_message((req or {}).get("reason", "")),
        "request_id": (req or {}).get("request_id", ""),
        "requested_at": (req or {}).get("requested_at", ""),
        "pending": bool(req),
    }


def maybe_auto_lock_no_call_v6(user):
    role = normalize_role((user or {}).get("role"))
    if not user or role != "recruiter":
        return False
    row = get_presence_for_user(user.get("user_id")) or {}
    if to_boolish(row.get("locked", "0")) or to_boolish(row.get("is_on_break", "0")):
        return False
    anchor = row.get("last_call_dial_at") or row.get("work_started_at")
    if not anchor:
        return False
    try:
        anchor_dt = datetime.fromisoformat(str(anchor))
    except Exception:
        return False
    if (datetime.now() - anchor_dt).total_seconds() < NO_CALL_LOCK_SECONDS:
        return False
    return force_lock_user(user, "No call dialed for 15 minutes auto-lock")

def reset_stale_presence_on_login(user):
    if not user or normalize_role(user.get("role")) == "manager":
        return
    ensure_presence_rows()
    get_backend().update_where(
        "presence",
        {"user_id": user.get("user_id")},
        {
            "locked": "0",
            "is_on_break": "0",
            "break_reason": "",
            "break_started_at": "",
            "break_expected_end_at": "",
            "last_seen_at": now_iso(),
            "work_started_at": now_iso(),
        },
    )


@app.before_request
def final_security_scope_tick():
    if request.endpoint in {None, "static", "login", "health"}:
        return None
    if not session.get("username"):
        return None
    user = current_user()
    if not user:
        return None
    ensure_presence_rows()
    if normalize_role(user.get("role")) != "manager":
        maybe_auto_lock_overdue_break_v5(user)
        maybe_auto_lock_inactive_v5(user)
        locked = get_presence_for_user(user.get("user_id")) or {}
        if to_boolish(locked.get("locked", "0")):
            allowed = {"attendance_breaks", "attendance_request_unlock", "attendance_unlock_decision", "attendance_ping", "notifications_page", "approvals_page", "logout", "stop_impersonation", "admin_page", "impersonate_login"}
            if request.endpoint not in allowed:
                flash("CRM is locked. Please request unlock approval first.", "danger")
                return redirect(url_for("attendance_breaks"))
    return None


@app.context_processor
def inject_final_lock_state():
    user = current_user()
    state = human_lock_summary(user) if user else {"locked": False, "reason": "", "request_id": "", "pending": False}
    can_switch_back = bool(session.get("impersonator"))
    return {"current_lock_state": state, "can_switch_back": can_switch_back}


@app.route("/attendance/unlock/<request_id>/<decision>", methods=["POST"])
@login_required
def attendance_unlock_decision(request_id, decision):
    actor = current_user()
    req = next((dict(r) for r in get_backend().list_rows("unlock_requests") if r.get("request_id") == request_id), None)
    if not req:
        abort(404)
    if not can_unlock_request(actor, req):
        abort(403)
    if (req.get("status") or "").lower() != "pending":
        return redirect(url_for("attendance_breaks"))
    if decision == "approve":
        get_backend().update_where("unlock_requests", {"request_id": request_id}, {"status": "Approved", "approved_by_user_id": actor.get("user_id"), "approved_by_name": actor.get("full_name"), "approved_at": now_iso()})
        get_backend().update_where("presence", {"user_id": req.get("user_id")}, {"locked": "0", "is_on_break": "0", "break_reason": "", "break_started_at": "", "break_expected_end_at": "", "last_seen_at": now_iso(), "last_call_dial_at": now_iso(), "last_call_alert_sent_at": ""})
        notify_users([req.get("user_id")], "CRM unlocked", f"{actor.get('full_name')} approved your unlock request.", "attendance", {"request_id": request_id})
        flash("Unlock approved.", "success")
    else:
        get_backend().update_where("unlock_requests", {"request_id": request_id}, {"status": "Rejected", "approved_by_user_id": actor.get("user_id"), "approved_by_name": actor.get("full_name"), "approved_at": now_iso()})
        notify_users([req.get("user_id")], "Unlock rejected", f"{actor.get('full_name')} rejected your unlock request.", "attendance", {"request_id": request_id})
        flash("Unlock rejected.", "danger")
    return redirect(url_for("attendance_breaks"))


def attendance_request_unlock_v3():
    user = current_user()
    reason = request.form.get("reason", "Unlock requested").strip() or "Unlock requested"
    create_unlock_request_if_missing(user, reason)
    get_backend().update_where("presence", {"user_id": user.get("user_id")}, {"locked": "1", "last_seen_at": now_iso()})
    flash("Unlock request sent to the approval team.", "success")
    return redirect(url_for("attendance_breaks"))


def attendance_ping_v3():
    if not session.get("username"):
        return jsonify({"ok": False}), 401
    user = current_user()
    ensure_presence_rows()
    if normalize_role(user.get("role")) != "manager":
        maybe_auto_lock_overdue_break_v5(user)
        maybe_auto_lock_inactive_v5(user)
    presence = get_presence_for_user(user.get("user_id")) or {}
    if to_boolish(presence.get("locked", "0")):
        return jsonify({"ok": True, "locked": True})
    payload = request.get_json(silent=True) or {}
    get_backend().update_where("presence", {"user_id": user.get("user_id")}, {"last_seen_at": now_iso(), "last_page": payload.get("page", request.path)})
    return jsonify({"ok": True, "locked": False})



def _soft_page_limit(rows, default_limit=250):
    rows = [dict(r) for r in rows]
    if request.args.get("show") == "all":
        return rows
    try:
        limit = max(50, min(1000, int(request.args.get("limit", default_limit))))
    except Exception:
        limit = default_limit
    return rows[:limit]

def professional_dashboard_v5():
    user = current_user()
    users = list_users()
    visible_candidates = visible_candidates_rows(user)
    visible_candidate_id_set = {c.get("candidate_id") for c in visible_candidates}
    interviews = [dict(i) for i in get_backend().list_rows("interviews") if i.get("candidate_id") in visible_candidate_id_set]
    tasks_all = [dict(t) for t in get_backend().list_rows("tasks")]
    tasks = tasks_all if normalize_role(user.get("role")) in {"manager", "tl"} else [t for t in tasks_all if t.get("assigned_to_user_id") == user.get("user_id")]
    submissions_rows = [dict(s) for s in get_backend().list_rows("submissions") if s.get("candidate_id") in visible_candidate_id_set]
    today_str = datetime.now().strftime("%Y-%m-%d")
    interviews_today = len([i for i in interviews if today_str in str(i.get("scheduled_at", ""))])
    active_managers = len([u for u in users if normalize_role(u.get("role")) in {"manager", "tl"}])
    pending_approvals = len([s for s in submissions_rows if (s.get("approval_status") or "").lower() in {"pending approval", "pending review"}])
    due_tasks = []
    for task in tasks:
        t = dict(task); t["due_at"] = display_ts(t.get("due_date")); due_tasks.append(t)
    due_tasks.sort(key=lambda x: (x.get("status", ""), x.get("due_at", "")))
    due_tasks = due_tasks[:6]
    manager_monitoring = []
    for u in users:
        role = normalize_role(u.get("role"))
        if role not in {"recruiter", "tl"}:
            continue
        if normalize_role(user.get("role")) == "recruiter" and u.get("user_id") != user.get("user_id"):
            continue
        ccount = len([c for c in visible_candidates if role == "recruiter" and c.get("recruiter_code") == u.get("recruiter_code")]) if role == "recruiter" else len(visible_candidates)
        open_tasks = len([t for t in tasks_all if t.get("assigned_to_user_id") == u.get("user_id") and (t.get("status") or "") != "Closed"])
        manager_monitoring.append({"full_name": u.get("full_name"), "designation": u.get("designation"), "candidate_count": ccount, "open_tasks": open_tasks})
    activity_feed = visible_candidates[:6]
    return render_template("dashboard.html", candidate_count=len(visible_candidates), todays_calls=len([a for a in get_backend().list_rows("activity_log") if a.get("action_type") in {"manual_call", "aaria_call"} and today_str in str(a.get("created_at", "")) and (normalize_role(user.get("role")) in {"manager", "tl"} or a.get("user_id") == user.get("user_id"))]), interviews_today=interviews_today, active_managers=active_managers, due_tasks=due_tasks, manager_monitoring=manager_monitoring[:6], unread_notes=user_notifications(user)[:5], pending_approvals=pending_approvals, activity_feed=activity_feed, active_workers=len([p for p in get_backend().list_rows("presence") if not to_boolish(p.get("locked", "0"))]), theme_options=ALLOWED_THEMES)


def professional_candidates_v5():
    user = current_user()
    q = request.args.get("q", "").strip().lower()
    recruiter = request.args.get("recruiter", "").strip()
    status = request.args.get("status", "").strip()
    location = request.args.get("location", "").strip()
    qualification = request.args.get("qualification", "").strip()
    rows = visible_candidates_rows(user)
    if q:
        rows = [c for c in rows if q in " ".join([c.get("full_name", ""), c.get("phone", ""), c.get("location", ""), c.get("status", ""), c.get("process", ""), c.get("recruiter_code", "")]).lower()]
    if recruiter:
        rows = [c for c in rows if c.get("recruiter_code") == recruiter]
    if status:
        rows = [c for c in rows if c.get("status") == status]
    if location:
        rows = [c for c in rows if c.get("location") == location]
    if qualification:
        rows = [c for c in rows if c.get("qualification_level") == qualification or c.get("qualification") == qualification]
    rows.sort(key=lambda x: x.get("updated_at", x.get("created_at", "")), reverse=True)
    all_rows = visible_candidates_rows(user)
    statuses = sorted({c.get("status", "") for c in all_rows if c.get("status")})
    locations = sorted({c.get("location", "") for c in all_rows if c.get("location")})
    qualifications = sorted({c.get("qualification_level", "") for c in all_rows if c.get("qualification_level")})
    recruiters = recruiters_for_filters() if normalize_role(user.get("role")) in {"manager", "tl"} else [{"username": user.get("recruiter_code") or user.get("username"), "full_name": user.get("full_name", "")} ]
    rows = _soft_page_limit(rows, 250)
    return render_template("candidates.html", candidates=rows, q=request.args.get("q", ""), recruiters=recruiters, current_recruiter=recruiter, statuses=statuses, current_status=status, locations=locations, current_location=location, qualifications=qualifications, current_qualification=qualification)


def professional_candidate_detail_v5(candidate_code):
    candidate = ensure_candidate_defaults(get_candidate(candidate_code) or {})
    if not candidate.get("candidate_id"):
        abort(404)
    if not candidate_visible_to_user(candidate, current_user()):
        abort(403)
    return professional_candidate_detail(candidate_code)


def professional_interviews_v5():
    user = current_user()
    q = request.args.get("q", "").strip().lower()
    recruiter = request.args.get("recruiter", "").strip()
    location = request.args.get("location", "").strip()
    date_from = ensure_iso_date(request.args.get("date_from", ""))
    date_to = ensure_iso_date(request.args.get("date_to", ""))
    visible_ids = visible_candidate_ids(user)
    rows = []
    candidates_by_id = candidate_map()
    jds_by_id = {j.get("jd_id"): dict(j) for j in get_backend().list_rows("jd_master")}
    for row in get_backend().list_rows("interviews"):
        if row.get("candidate_id") not in visible_ids:
            continue
        item = dict(row)
        c = candidates_by_id.get(item.get("candidate_id")) or {}
        jd = jds_by_id.get(item.get("jd_id")) or {}
        item["full_name"] = c.get("full_name", item.get("candidate_id", ""))
        item["recruiter_code"] = c.get("recruiter_code", "")
        item["recruiter_name"] = c.get("recruiter_name", "")
        item["location"] = c.get("location", "")
        item["title"] = jd.get("job_title", c.get("process", ""))
        item["scheduled_at"] = display_ts(item.get("scheduled_at"))
        search_blob = " ".join([item.get("full_name", ""), item.get("candidate_id", ""), item.get("recruiter_code", ""), item.get("recruiter_name", ""), item.get("location", ""), item.get("title", "")]).lower()
        if q and q not in search_blob:
            continue
        if recruiter and item.get("recruiter_code") != recruiter:
            continue
        if location and item.get("location") != location:
            continue
        row_date = ensure_iso_date((item.get("scheduled_at") or "")[:10])
        if date_from and row_date and row_date < date_from:
            continue
        if date_to and row_date and row_date > date_to:
            continue
        rows.append(item)
    rows.sort(key=lambda x: x.get("scheduled_at", ""))
    recruiters = recruiters_for_filters() if normalize_role(user.get("role")) in {"manager", "tl"} else [{"username": user.get("recruiter_code") or user.get("username"), "full_name": user.get("full_name", "")} ]
    locations = sorted({c.get('location','') for c in visible_candidates_rows(user) if c.get('location')})
    log_page_activity("interviews", {"q": q, "recruiter": recruiter, "location": location})
    rows = _soft_page_limit(rows, 250)
    return render_template("interviews.html", interviews=rows, q=request.args.get("q", ""), recruiters=recruiters, current_recruiter=recruiter, locations=locations, current_location=location, date_from=date_from, date_to=date_to)


def professional_submissions_v5():
    user = current_user()
    visible_ids = visible_candidate_ids(user)
    candidates_by_id = candidate_map()
    jds_by_id = {j.get("jd_id"): j for j in get_backend().list_rows("jd_master")}
    rows = []
    recruiter_scores = {}
    for s in get_backend().list_rows("submissions"):
        if s.get("candidate_id") not in visible_ids:
            continue
        item = dict(s)
        candidate = candidates_by_id.get(item.get("candidate_id")) or {}
        jd = jds_by_id.get(item.get("jd_id")) or {}
        item["full_name"] = candidate.get("full_name", "")
        item["phone"] = candidate.get("phone", "")
        item["title"] = jd.get("job_title", candidate.get("process", ""))
        item["company"] = jd.get("company", "")
        item["submitted_at_view"] = display_ts(item.get("submitted_at"))
        rows.append(item)
        code = item.get("recruiter_code", "")
        recruiter_scores.setdefault(code, {"recruiter_code": code, "count": 0, "approved": 0})
        recruiter_scores[code]["count"] += 1
        if (item.get("approval_status") or "").lower() == "approved":
            recruiter_scores[code]["approved"] += 1
    rows.sort(key=lambda x: x.get("submitted_at", ""), reverse=True)
    score_rows = list(recruiter_scores.values())
    users_by_code = {u.get("recruiter_code"): u for u in list_users() if u.get("recruiter_code")}
    for row in score_rows:
        u = users_by_code.get(row["recruiter_code"]) or {}
        row["full_name"] = u.get("full_name", row["recruiter_code"])
        row["approval_rate"] = f"{int((row['approved'] / row['count']) * 100) if row['count'] else 0}%"
    score_rows.sort(key=lambda x: (-x["count"], x["full_name"]))
    rows = _soft_page_limit(rows, 250)
    return render_template("submissions.html", submissions=rows, pending_count=len([r for r in rows if (r.get("approval_status") or "").lower() in {"pending approval", "pending review"}]), approved_count=len([r for r in rows if (r.get("approval_status") or "").lower() == "approved"]), rescheduled_count=len([r for r in rows if (r.get("approval_status") or "").lower() == "rescheduled"]), recruiter_scores=score_rows)


@app.route("/bulk-action", methods=["POST"])
@login_required
def bulk_action():
    payload = request.get_json(silent=True) or request.form.to_dict(flat=False)
    action = (payload.get("action") if isinstance(payload.get("action"), str) else (payload.get("action") or [""])[0]).strip()
    candidate_ids = payload.get("candidate_ids") or []
    if isinstance(candidate_ids, str):
        candidate_ids = [c.strip() for c in candidate_ids.split(",") if c.strip()]
    candidate_ids = candidate_ids[:100]
    user = current_user()
    visible_ids = visible_candidate_ids(user)
    candidate_ids = [cid for cid in candidate_ids if cid in visible_ids]
    candidates = [get_candidate(cid) or {} for cid in candidate_ids]
    if action == "bulk_note":
        note = (payload.get("note") if isinstance(payload.get("note"), str) else (payload.get("note") or [""])[0]).strip()
        if not note:
            return jsonify({"ok": False, "message": "Note is empty."}), 400
        for cand in candidates:
            get_backend().insert("notes", {"candidate_id": cand.get("candidate_id"), "username": user.get("username"), "note_type": "public", "body": note, "created_at": now_iso()})
            log_activity(user, "bulk_note_added", cand.get("candidate_id"), {"note": note[:140]})
        return jsonify({"ok": True, "message": f"Note added to {len(candidates)} profiles."})
    message = (payload.get("message") if isinstance(payload.get("message"), str) else (payload.get("message") or [""])[0]).strip()
    queue = [{"candidate_id": c.get("candidate_id"), "full_name": c.get("full_name"), "phone": c.get("phone"), "call_link": f"tel:+91{normalize_phone(c.get('phone'))}", "wa_link": f"https://wa.me/91{normalize_phone(c.get('phone'))}?text={quote(message or 'Hello from Career Crox')}", "message": message or "Hello from Career Crox"} for c in candidates if c.get("phone")]
    return jsonify({"ok": True, "queue": queue, "message": f"{len(queue)} contacts are ready in the queue."})


def testing_ai_page_v2():
    cv_result = None
    if request.method == "POST" and request.files.get("cv_file"):
        action = request.form.get("cv_action", "extract_details")
        source_path, out_path, summary = process_cv_upload(request.files["cv_file"], action)
        cv_result = {"source_name": source_path.name, "output_name": out_path.name, "summary": summary}
        flash("CV tool processed file successfully.", "success")
        log_activity(current_user(), "cv_tool", metadata={"action": action, "output": out_path.name})
    activity_rows, risk_rows = activity_monitor_rows()
    queue_rows = [dict(r) for r in get_backend().list_rows("aaria_queue")]
    queue_rows.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    candidate_options = [{"candidate_id": c.get("candidate_id"), "full_name": c.get("full_name"), "phone": c.get("phone"), "status": c.get("status"), "location": c.get("location")} for c in visible_candidates_rows(current_user())[:120]]
    return render_template("testing_ai.html", cv_result=cv_result, activity_rows=activity_rows, risk_rows=risk_rows, queue_rows=queue_rows[:20], candidate_options=candidate_options)


app.view_functions["attendance_request_unlock"] = login_required(attendance_request_unlock_v3)
app.view_functions["attendance_ping"] = attendance_ping_v3
app.view_functions["dashboard"] = login_required(professional_dashboard_v5)
app.view_functions["candidates"] = login_required(professional_candidates_v5)
app.view_functions["candidate_detail"] = login_required(professional_candidate_detail_v5)
app.view_functions["interviews"] = login_required(professional_interviews_v5)
app.view_functions["submissions"] = login_required(professional_submissions_v5)
app.view_functions["testing_ai_page"] = login_required(testing_ai_page_v2)


# === Let's Chit-Chat + Mac Theme + stronger row-click patch ===

def ensure_extended_local_schema_v2():
    if USE_SUPABASE:
        return
    try:
        SQLiteBackend(DB_PATH, SEED_FILE)
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.executescript("""
        CREATE TABLE IF NOT EXISTS chat_groups (
            group_id TEXT PRIMARY KEY,
            title TEXT,
            created_by_username TEXT,
            created_at TEXT,
            updated_at TEXT,
            is_active TEXT DEFAULT '1',
            is_manager_pinned TEXT DEFAULT '0'
        );
        CREATE TABLE IF NOT EXISTS chat_group_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT,
            username TEXT,
            joined_at TEXT
        );
        CREATE TABLE IF NOT EXISTS chat_user_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            thread_key TEXT,
            thread_type TEXT,
            is_pinned TEXT DEFAULT '0',
            pin_order INTEGER DEFAULT 999,
            is_hidden TEXT DEFAULT '0',
            is_blocked TEXT DEFAULT '0',
            muted TEXT DEFAULT '0',
            last_read_at TEXT DEFAULT '',
            UNIQUE(username, thread_key)
        );
        """)
        existing = {row[1] for row in cur.execute("PRAGMA table_info(messages)").fetchall()}
        for column_sql in [
            "ALTER TABLE messages ADD COLUMN thread_key TEXT",
            "ALTER TABLE messages ADD COLUMN thread_type TEXT",
            "ALTER TABLE messages ADD COLUMN reference_type TEXT",
            "ALTER TABLE messages ADD COLUMN reference_id TEXT",
            "ALTER TABLE messages ADD COLUMN mention_usernames TEXT",
        ]:
            col = column_sql.split(" ADD COLUMN ",1)[1].split()[0]
            if col not in existing:
                try:
                    cur.execute(column_sql)
                except Exception:
                    pass
        conn.commit()
        conn.close()
    except Exception:
        pass


def _safe_list_rows(table):
    try:
        return [dict(r) for r in get_backend().list_rows(table)]
    except Exception:
        return []


def direct_thread_key_for(user_a, user_b):
    return f"dm:{'|'.join(sorted([user_a, user_b]))}"


def direct_thread_partner(thread_key, current_username):
    parts = thread_key.replace("dm:", "", 1).split("|")
    return next((p for p in parts if p != current_username), current_username)


def chat_state_for(username, thread_key, thread_type="direct"):
    rows = [r for r in _safe_list_rows("chat_user_state") if r.get("username") == username and r.get("thread_key") == thread_key]
    if rows:
        row = rows[0]
        row["pin_order"] = int(row.get("pin_order") or 999)
        return row
    if USE_SUPABASE:
        return {"username": username, "thread_key": thread_key, "thread_type": thread_type, "is_pinned": "0", "pin_order": 999, "is_hidden": "0", "is_blocked": "0", "muted": "0", "last_read_at": ""}
    try:
        get_backend().insert("chat_user_state", {"username": username, "thread_key": thread_key, "thread_type": thread_type, "is_pinned": "0", "pin_order": 999, "is_hidden": "0", "is_blocked": "0", "muted": "0", "last_read_at": ""})
    except Exception:
        pass
    return {"username": username, "thread_key": thread_key, "thread_type": thread_type, "is_pinned": "0", "pin_order": 999, "is_hidden": "0", "is_blocked": "0", "muted": "0", "last_read_at": ""}


def update_chat_state(username, thread_key, values, thread_type="direct"):
    chat_state_for(username, thread_key, thread_type)
    try:
        get_backend().update_where("chat_user_state", {"username": username, "thread_key": thread_key}, values)
    except Exception:
        pass


def can_direct_chat(actor, target):
    actor_role = normalize_role((actor or {}).get("role"))
    target_role = normalize_role((target or {}).get("role"))
    if not actor or not target or actor.get("username") == target.get("username"):
        return False
    if actor_role == "recruiter" and target_role == "recruiter":
        return False
    return True


def chat_contact_options(user):
    out = []
    for u in list_users():
        if can_direct_chat(user, u):
            out.append(u)
    out.sort(key=lambda x: (0 if normalize_role(x.get("role")) == "manager" else 1, x.get("full_name", "")))
    return out


def chat_group_rows_for_user(user):
    memberships = [m for m in _safe_list_rows("chat_group_members") if m.get("username") == user.get("username")]
    group_ids = {m.get("group_id") for m in memberships}
    rows = [g for g in _safe_list_rows("chat_groups") if g.get("group_id") in group_ids and not str(g.get("is_active","1")).lower() in {"0","false","no"}]
    return rows


def extract_mentions(text):
    body = text or ""
    found = []
    for u in list_users():
        uname = u.get("username") or ""
        if uname and f"@{uname.lower()}" in body.lower():
            found.append(uname)
    return found


def chat_reference_options(user):
    options = []
    for c in visible_candidates_rows(user)[:120]:
        options.append({"type": "candidate", "value": c.get("candidate_id"), "label": f"Candidate • {c.get('candidate_id')} • {c.get('full_name')}"})
    task_rows = [dict(t) for t in _safe_list_rows("tasks")]
    if normalize_role(user.get("role")) == "recruiter":
        task_rows = [t for t in task_rows if t.get("assigned_to_user_id") == user.get("user_id") or t.get("assigned_by_user_id") == user.get("user_id")]
    for t in task_rows[:80]:
        options.append({"type": "task", "value": t.get("task_id"), "label": f"Task • {t.get('task_id')} • {t.get('title')}"})
    interview_rows = [dict(i) for i in _safe_list_rows("interviews") if i.get("candidate_id") in visible_candidate_ids(user)]
    for i in interview_rows[:80]:
        options.append({"type": "interview", "value": i.get("interview_id"), "label": f"Interview • {i.get('interview_id')} • {i.get('candidate_id')} • {display_ts(i.get('scheduled_at'))}"})
    sub_rows = [dict(s) for s in _safe_list_rows("submissions") if s.get("candidate_id") in visible_candidate_ids(user)]
    for s in sub_rows[:80]:
        options.append({"type": "submission", "value": s.get("submission_id"), "label": f"Submission • {s.get('submission_id')} • {s.get('candidate_id')}"})
    for j in _safe_list_rows("jd_master")[:50]:
        options.append({"type": "jd", "value": j.get("jd_id"), "label": f"JD • {j.get('jd_id')} • {j.get('job_title')}"})
    return options


def reference_url_and_label(ref_type, ref_id):
    if not ref_type or not ref_id:
        return "", ""
    if ref_type == "candidate":
        cand = get_candidate(ref_id) or {}
        return url_for("candidate_detail", candidate_code=ref_id), f"{cand.get('full_name', ref_id)} • {ref_id}"
    if ref_type == "task":
        task = next((dict(t) for t in _safe_list_rows("tasks") if t.get("task_id") == ref_id), None) or {}
        return url_for("task_detail", task_id=ref_id), f"{task.get('title', ref_id)} • {ref_id}"
    if ref_type == "interview":
        row = next((dict(i) for i in _safe_list_rows("interviews") if i.get("interview_id") == ref_id), None) or {}
        target = row.get("candidate_id") or ref_id
        return url_for("candidate_detail", candidate_code=target), f"Interview {ref_id} • {target}"
    if ref_type == "submission":
        row = next((dict(s) for s in _safe_list_rows("submissions") if s.get("submission_id") == ref_id), None) or {}
        target = row.get("candidate_id") or ref_id
        return url_for("candidate_detail", candidate_code=target), f"Submission {ref_id} • {target}"
    if ref_type == "jd":
        return url_for("jds"), f"JD {ref_id}"
    return "", ref_id


def _message_thread_info(msg):
    item = dict(msg)
    if item.get("thread_key"):
        return item.get("thread_key"), item.get("thread_type") or "group"
    sender = item.get("sender_username") or ""
    recipient = item.get("recipient_username") or ""
    if sender and recipient:
        return direct_thread_key_for(sender, recipient), "direct"
    return "", "direct"


def build_chat_threads(user, q=""):
    current_username = user.get("username")
    users_by_username = user_map("username")
    messages = []
    for raw in _safe_list_rows("messages"):
        msg = dict(raw)
        thread_key, thread_type = _message_thread_info(msg)
        if not thread_key:
            continue
        msg["thread_key"] = thread_key
        msg["thread_type"] = thread_type
        messages.append(msg)
    threads = []
    # direct threads
    for other in chat_contact_options(user):
        other_username = other.get("username")
        key = direct_thread_key_for(current_username, other_username)
        state = chat_state_for(current_username, key, "direct")
        if to_boolish(state.get("is_hidden", "0")):
            continue
        convo = [m for m in messages if m.get("thread_key") == key]
        last_msg = sorted(convo, key=lambda x: x.get("created_at", ""))[-1] if convo else None
        last_read = state.get("last_read_at") or ""
        unread = len([m for m in convo if m.get("sender_username") != current_username and (m.get("created_at") or "") > last_read])
        mentions = len([m for m in convo if m.get("sender_username") != current_username and current_username in json.loads(m.get("mention_usernames") or "[]") and (m.get("created_at") or "") > last_read])
        preview = (last_msg or {}).get("body") or f"Direct chat with {other.get('full_name','')}"
        latest_at = (last_msg or {}).get("created_at") or ""
        ref_url, ref_label = reference_url_and_label((last_msg or {}).get("reference_type", ""), (last_msg or {}).get("reference_id", "")) if last_msg else ("", "")
        item = {"thread_key": key, "thread_type": "direct", "title": other.get("full_name", other_username), "subtitle": other.get("designation", ""), "preview": preview[:140], "latest_at": latest_at, "latest_at_view": display_ts(latest_at) if latest_at else "", "unread": unread, "mentions": mentions, "is_pinned": to_boolish(state.get("is_pinned", "0")), "pin_order": int(state.get("pin_order") or 999), "is_blocked": to_boolish(state.get("is_blocked", "0")), "other_user": other, "is_manager_priority": normalize_role(other.get("role")) == "manager", "reference_url": ref_url, "reference_label": ref_label}
        search_blob = " ".join([item["title"], item["subtitle"], item["preview"], ref_label]).lower()
        if q and q.lower() not in search_blob:
            continue
        threads.append(item)
    # group threads
    group_rows = chat_group_rows_for_user(user)
    group_members = _safe_list_rows("chat_group_members")
    for group in group_rows:
        key = f"grp:{group.get('group_id')}"
        state = chat_state_for(current_username, key, "group")
        if to_boolish(state.get("is_hidden", "0")):
            continue
        convo = [m for m in messages if m.get("thread_key") == key]
        last_msg = sorted(convo, key=lambda x: x.get("created_at", ""))[-1] if convo else None
        names = [users_by_username.get(m.get("username"), {}).get("full_name", m.get("username")) for m in group_members if m.get("group_id") == group.get("group_id")]
        latest_at = (last_msg or {}).get("created_at") or group.get("updated_at") or group.get("created_at") or ""
        preview = (last_msg or {}).get("body") or "Group ready"
        last_read = state.get("last_read_at") or ""
        unread = len([m for m in convo if m.get("sender_username") != current_username and (m.get("created_at") or "") > last_read])
        mentions = len([m for m in convo if m.get("sender_username") != current_username and current_username in json.loads(m.get("mention_usernames") or "[]") and (m.get("created_at") or "") > last_read])
        ref_url, ref_label = reference_url_and_label((last_msg or {}).get("reference_type", ""), (last_msg or {}).get("reference_id", "")) if last_msg else ("", "")
        item = {"thread_key": key, "thread_type": "group", "title": group.get("title", key), "subtitle": ", ".join(names[:3]) + (" ..." if len(names) > 3 else ""), "preview": preview[:140], "latest_at": latest_at, "latest_at_view": display_ts(latest_at) if latest_at else "", "unread": unread, "mentions": mentions, "is_pinned": to_boolish(state.get("is_pinned", "0")) or to_boolish(group.get("is_manager_pinned", "0")), "pin_order": int(state.get("pin_order") or 999), "is_blocked": False, "other_user": None, "is_manager_priority": to_boolish(group.get("is_manager_pinned", "0")), "reference_url": ref_url, "reference_label": ref_label}
        search_blob = " ".join([item["title"], item["subtitle"], item["preview"], ref_label]).lower()
        if q and q.lower() not in search_blob:
            continue
        threads.append(item)
    threads.sort(key=lambda x: (0 if x.get("is_manager_priority") else 1, 0 if x.get("is_pinned") else 1, x.get("pin_order", 999), -(int(datetime.fromisoformat((x.get("latest_at") or "1970-01-01T00:00:00").replace("Z","" if "Z" else "" )).timestamp()) if x.get("latest_at") else 0), x.get("title", "")))
    return threads


def chat_conversation(user, thread_key):
    rows = []
    for raw in _safe_list_rows("messages"):
        msg = dict(raw)
        key, ttype = _message_thread_info(msg)
        if key != thread_key:
            continue
        msg["thread_key"] = key
        msg["thread_type"] = ttype
        sender = get_user(msg.get("sender_username")) or {}
        msg["sender_name"] = sender.get("full_name", msg.get("sender_username"))
        msg["created_at_view"] = display_ts(msg.get("created_at"))
        msg["reference_url"], msg["reference_label"] = reference_url_and_label(msg.get("reference_type", ""), msg.get("reference_id", ""))
        msg["mention_badge"] = current_user().get("username") in json.loads(msg.get("mention_usernames") or "[]")
        rows.append(msg)
    rows.sort(key=lambda x: x.get("created_at", ""))
    return rows


def mark_thread_read(user, thread_key, thread_type):
    update_chat_state(user.get("username"), thread_key, {"last_read_at": now_iso()}, thread_type)


def thread_meta_from_threads(threads, thread_key):
    return next((t for t in threads if t.get("thread_key") == thread_key), None)


def chat_send_message(user, thread_key, body, reference_type="", reference_key=""):
    body = (body or "").strip()
    if not body:
        return False, "Blank message"
    mentions = extract_mentions(body)
    if thread_key.startswith("dm:"):
        other_username = direct_thread_partner(thread_key, user.get("username"))
        other = get_user(other_username)
        if not can_direct_chat(user, other):
            return False, "Direct recruiter-to-recruiter chat is not available. Please use a team lead or manager thread."
        if to_boolish(chat_state_for(user.get("username"), thread_key, "direct").get("is_blocked", "0")):
            return False, "Blocked thread"
        row = {"sender_username": user.get("username"), "recipient_username": other_username, "body": body, "created_at": now_iso(), "thread_key": thread_key, "thread_type": "direct", "reference_type": reference_type, "reference_id": reference_key, "mention_usernames": json.dumps(mentions)}
        get_backend().insert("messages", row)
        if other:
            notify_users([other.get("user_id")], "New chat message", f"{user.get('full_name')} sent you a message.", "chat", {"thread_key": thread_key})
            if other_username in mentions:
                notify_users([other.get("user_id")], "You were mentioned", f"{user.get('full_name')} tagged you in chat.", "chat", {"thread_key": thread_key})
        update_chat_state(user.get("username"), thread_key, {"last_read_at": now_iso()}, "direct")
        return True, "Message sent"
    if thread_key.startswith("grp:"):
        group_id = thread_key.replace("grp:", "", 1)
        members = [m.get("username") for m in _safe_list_rows("chat_group_members") if m.get("group_id") == group_id]
        if user.get("username") not in members:
            return False, "Group access denied."
        row = {"sender_username": user.get("username"), "recipient_username": "", "body": body, "created_at": now_iso(), "thread_key": thread_key, "thread_type": "group", "reference_type": reference_type, "reference_id": reference_key, "mention_usernames": json.dumps(mentions)}
        get_backend().insert("messages", row)
        try:
            get_backend().update_where("chat_groups", {"group_id": group_id}, {"updated_at": now_iso()})
        except Exception:
            pass
        target_ids = [u.get("user_id") for u in list_users() if u.get("username") in members and u.get("username") != user.get("username")]
        notify_users(target_ids, "Group chat update", f"{user.get('full_name')} posted in group chat.", "chat", {"thread_key": thread_key})
        mentioned_ids = [u.get("user_id") for u in list_users() if u.get("username") in mentions and u.get("username") in members and u.get("username") != user.get("username")]
        if mentioned_ids:
            notify_users(mentioned_ids, "You were mentioned", f"{user.get('full_name')} tagged you in group chat.", "chat", {"thread_key": thread_key})
        update_chat_state(user.get("username"), thread_key, {"last_read_at": now_iso()}, "group")
        return True, "Group message sent"
    return False, "Unknown thread"


def chat_page_v2():
    user = current_user()
    q = (request.args.get("q") or "").strip()
    selected_thread = (request.args.get("thread") or "").strip()
    if request.method == "POST":
        thread_key = (request.form.get("thread_key") or "").strip()
        body = request.form.get("body", "")
        reference_type = (request.form.get("reference_type") or "").strip()
        reference_key = (request.form.get("reference_key") or "").strip()
        ok, msg = chat_send_message(user, thread_key, body, reference_type, reference_key)
        flash(msg, "success" if ok else "danger")
        return redirect(url_for("chat_page", thread=thread_key, q=q))
    threads = build_chat_threads(user, q=q)
    if not selected_thread and threads:
        selected_thread = threads[0].get("thread_key")
    selected_meta = thread_meta_from_threads(threads, selected_thread) if selected_thread else None
    convo = chat_conversation(user, selected_thread) if selected_thread else []
    if selected_meta:
        mark_thread_read(user, selected_thread, selected_meta.get("thread_type", "direct"))
        selected_meta["is_blocked"] = to_boolish(chat_state_for(user.get("username"), selected_thread, selected_meta.get("thread_type", "direct")).get("is_blocked", "0"))
    return render_template("chat.html", threads=threads, selected_thread=selected_thread, selected_meta=selected_meta, convo=convo, q=q, can_create_group=normalize_role(user.get("role")) in {"manager", "tl"}, group_candidates=chat_contact_options(user), reference_options=chat_reference_options(user))


@app.route("/chat/create-group", methods=["POST"])
@login_required
def chat_create_group():
    user = current_user()
    if normalize_role(user.get("role")) not in {"manager", "tl"}:
        abort(403)
    members = request.form.getlist("members")
    title = (request.form.get("title") or "").strip()
    members = [m for m in dict.fromkeys(members + [user.get("username")]) if get_user(m)]
    if not title or len(members) < 2:
        flash("Group title aur kam se kam 2 members chahiye.", "danger")
        return redirect(url_for("chat_page"))
    group_id = f"G{int(datetime.now().timestamp()*1000)}{random.randint(100,999)}"
    get_backend().insert("chat_groups", {"group_id": group_id, "title": title, "created_by_username": user.get("username"), "created_at": now_iso(), "updated_at": now_iso(), "is_active": "1", "is_manager_pinned": "1" if normalize_role(user.get("role")) == "manager" else "0"})
    for uname in members:
        get_backend().insert("chat_group_members", {"group_id": group_id, "username": uname, "joined_at": now_iso()})
        update_chat_state(uname, f"grp:{group_id}", {"thread_type": "group", "last_read_at": "", "is_hidden": "0"}, "group")
    notify_users([u.get("user_id") for u in list_users() if u.get("username") in members and u.get("username") != user.get("username")], "Added to group", f"{user.get('full_name')} added you to group {title}.", "chat", {"thread_key": f"grp:{group_id}"})
    flash("Group created.", "success")
    return redirect(url_for("chat_page", thread=f"grp:{group_id}"))


@app.route("/chat/toggle", methods=["POST"])
@login_required
def chat_toggle_state():
    user = current_user()
    thread_key = (request.form.get("thread_key") or "").strip()
    action = (request.form.get("action") or "").strip()
    thread_type = "group" if thread_key.startswith("grp:") else "direct"
    state = chat_state_for(user.get("username"), thread_key, thread_type)
    values = {}
    if action == "pin":
        values = {"is_pinned": "0" if to_boolish(state.get("is_pinned", "0")) else "1", "pin_order": int(state.get("pin_order") or 999) if not to_boolish(state.get("is_pinned", "0")) else 999}
    elif action == "hide":
        values = {"is_hidden": "0" if to_boolish(state.get("is_hidden", "0")) else "1"}
    elif action == "block" and thread_type == "direct":
        values = {"is_blocked": "0" if to_boolish(state.get("is_blocked", "0")) else "1"}
    update_chat_state(user.get("username"), thread_key, values, thread_type)
    flash("Chat view updated.", "success")
    return redirect(url_for("chat_page"))


@app.route("/chat/reorder", methods=["POST"])
@login_required
def chat_reorder_threads():
    user = current_user()
    payload = request.get_json(silent=True) or {}
    ordered = payload.get("ordered") or []
    for item in ordered:
        thread_key = item.get("thread_key")
        order = int(item.get("order") or 999)
        if thread_key:
            update_chat_state(user.get("username"), thread_key, {"is_pinned": "1", "pin_order": order}, "group" if str(thread_key).startswith("grp:") else "direct")
    return jsonify({"ok": True})


def _chat_sidebar_item_patch():
    global SIDEBAR_ITEMS
    if not any(label == "Let's Chit-Chat" for label,_,_ in SIDEBAR_ITEMS):
        items = []
        inserted = False
        for label, endpoint, kwargs in SIDEBAR_ITEMS:
            items.append((label, endpoint, kwargs))
            if label == "Reports" and not inserted:
                items.append(("Let's Chit-Chat", "chat_page", {}))
                inserted = True
        if not inserted:
            items.append(("Let's Chit-Chat", "chat_page", {}))
        SIDEBAR_ITEMS = items


def inject_chat_context_v2():
    user = current_user()
    manager_user = next((u for u in list_users() if normalize_role(u.get("role")) == "manager"), None)
    return {"chat_manager_username": (manager_user or {}).get("username", "")}


ensure_extended_local_schema_v2()
_chat_sidebar_item_patch()
app.context_processor(inject_chat_context_v2)
app.view_functions["chat_page"] = login_required(chat_page_v2)



# === final Aaria command guide + global search + scoped command patch ===
AARIA_GUIDE_STATIC_PATH = 'downloads/AARIA_COMMAND_GUIDE_ENGLISH.pdf'


def normalize_digits(value):
    return ''.join(ch for ch in str(value or '') if ch.isdigit())


def search_score(query, values):
    q = (query or '').strip().lower()
    if not q:
        return 0
    digits = normalize_digits(q)
    score = 0
    for value in values:
        text = str(value or '').strip()
        low = text.lower()
        if not text:
            continue
        if low == q:
            score = max(score, 120)
        elif q in low:
            score = max(score, 80 if low.startswith(q) else 55)
        value_digits = normalize_digits(text)
        if digits and value_digits:
            if value_digits == digits:
                score = max(score, 115)
            elif value_digits.endswith(digits):
                score = max(score, 95)
            elif digits in value_digits:
                score = max(score, 65)
    return score


def visible_tasks_rows(user):
    rows = []
    users_by_id = user_map('user_id')
    for t in get_backend().list_rows('tasks'):
        item = dict(t)
        assigned_user = users_by_id.get(item.get('assigned_to_user_id')) or {}
        item['full_name'] = assigned_user.get('full_name', item.get('assigned_to_name', ''))
        if normalize_role(user.get('role')) not in {'manager', 'tl'} and item.get('assigned_to_user_id') != user.get('user_id'):
            continue
        rows.append(item)
    return rows


def visible_interviews_rows_for_search(user):
    visible_ids = visible_candidate_ids(user)
    candidates_by_id = candidate_map()
    out = []
    for row in get_backend().list_rows('interviews'):
        if row.get('candidate_id') not in visible_ids:
            continue
        item = dict(row)
        cand = candidates_by_id.get(item.get('candidate_id')) or {}
        item['full_name'] = cand.get('full_name', '')
        item['phone'] = cand.get('phone', '')
        item['location'] = cand.get('location', '')
        out.append(item)
    return out


def visible_submissions_rows_for_search(user):
    visible_ids = visible_candidate_ids(user)
    candidates_by_id = candidate_map()
    out = []
    for row in get_backend().list_rows('submissions'):
        if row.get('candidate_id') not in visible_ids:
            continue
        item = dict(row)
        cand = candidates_by_id.get(item.get('candidate_id')) or {}
        item['full_name'] = cand.get('full_name', '')
        item['phone'] = cand.get('phone', '')
        out.append(item)
    return out


def global_search_payload(user, q):
    q = (q or '').strip()
    candidates = []
    tasks = []
    interviews = []
    submissions = []
    jds = []
    if not q:
        return {'candidates': candidates, 'tasks': tasks, 'interviews': interviews, 'submissions': submissions, 'jds': jds}
    for row in visible_candidates_rows(user):
        score = search_score(q, [row.get('candidate_id'), row.get('full_name'), row.get('phone'), row.get('location'), row.get('process'), row.get('recruiter_code'), row.get('status')])
        if score:
            item = dict(row)
            item['_score'] = score
            candidates.append(item)
    for row in visible_tasks_rows(user):
        score = search_score(q, [row.get('task_id'), row.get('title'), row.get('description'), row.get('full_name'), row.get('status'), row.get('priority')])
        if score:
            item = dict(row)
            item['_score'] = score
            tasks.append(item)
    for row in visible_interviews_rows_for_search(user):
        score = search_score(q, [row.get('interview_id'), row.get('candidate_id'), row.get('full_name'), row.get('phone'), row.get('stage'), row.get('scheduled_at')])
        if score:
            item = dict(row)
            item['_score'] = score
            interviews.append(item)
    for row in visible_submissions_rows_for_search(user):
        score = search_score(q, [row.get('submission_id'), row.get('candidate_id'), row.get('full_name'), row.get('phone'), row.get('approval_status'), row.get('status')])
        if score:
            item = dict(row)
            item['_score'] = score
            submissions.append(item)
    for row in get_backend().list_rows('jd_master'):
        score = search_score(q, [row.get('jd_id'), row.get('job_title'), row.get('company'), row.get('location'), row.get('experience'), row.get('salary')])
        if score:
            item = dict(row)
            item['_score'] = score
            jds.append(item)
    for bucket in [candidates, tasks, interviews, submissions, jds]:
        bucket.sort(key=lambda x: (-x.get('_score', 0), str(x.get('updated_at') or x.get('created_at') or x.get('submitted_at') or x.get('scheduled_at') or '')), reverse=False)
    return {
        'candidates': candidates[:12],
        'tasks': tasks[:12],
        'interviews': interviews[:10],
        'submissions': submissions[:10],
        'jds': jds[:10],
    }


@app.route('/search')
@login_required
def global_search():
    user = current_user()
    q = (request.args.get('q') or '').strip()
    payload = global_search_payload(user, q)
    total = sum(len(payload[k]) for k in payload)
    log_page_activity('global_search', {'q': q, 'total': total})
    return render_template('search_results.html', q=q, total_results=total, **payload)


def visible_candidate_for_command(candidate, user):
    return bool(candidate and candidate_visible_to_user(candidate, user))


def parse_submission_hint(command_text, candidate=None):
    raw = str(command_text or '')
    m = re.search(r'\bS\d{3,6}\b', raw, re.I)
    hint = m.group(0).upper() if m else ''
    rows = [dict(r) for r in get_backend().list_rows('submissions')]
    if hint:
        sub = next((r for r in rows if str(r.get('submission_id', '')).upper() == hint), None)
        if sub:
            return sub
    if candidate:
        cand_id = candidate.get('candidate_id')
        matches = [r for r in rows if r.get('candidate_id') == cand_id]
        matches.sort(key=lambda x: str(x.get('submitted_at', '')), reverse=True)
        if matches:
            return matches[0]
    return None


def extract_candidate_hint_from_text_v3(command_text):
    raw = str(command_text or '')
    for pattern in [r'\bC\d{3,6}\b', r'\b[6-9]\d{9}\b', r'\b\d{3,10}\b']:
        m = re.search(pattern, raw, re.I)
        if m:
            return m.group(0)
    raw_l = raw.lower()
    for c in enrich_candidates():
        full_name = str(c.get('full_name', '')).strip()
        if not full_name:
            continue
        parts = [p for p in re.split(r'\s+', full_name.lower()) if len(p) >= 3]
        if full_name.lower() in raw_l or any(p in raw_l for p in parts):
            return full_name
    return ''


def split_aaria_commands_v3(command_text):
    raw = str(command_text or '').strip()
    if not raw:
        return []
    raw = re.sub(r'(?m)^\s*(\d{1,2})[\.)\-:]\s*', '', raw)
    raw = re.sub(r'(?m)^\s*(?:sr\.?\s*no\.?|step)\s*\d+\s*[:\-]?\s*', '', raw, flags=re.I)
    raw = raw.replace('\n', '; ').replace('|', '; ').replace('।', '; ').replace('؛', '; ')
    raw = re.sub(r'\s{2,}', ' ', raw)
    low = raw.lower()
    if ';' not in raw and ('whatsapp' in low or 'whats app' in low) and 'call' in low:
        hint = extract_candidate_hint_from_text_v3(raw)
        parts = []
        if hint:
            parts.append(f'call {hint}')
            msg = ''
            msg_match = re.search(r'(?:send|message|msg|bhej)\s+(.+?)\s+(?:to|for|ko)\s+(?:candidate\s+)?(?:' + re.escape(hint) + r')', raw, re.I)
            if msg_match:
                msg = msg_match.group(1).strip(' :-')
            elif re.search(r'\bhi\b', low):
                msg = 'Hi'
            parts.append(f'whatsapp {msg} to {hint}'.strip())
            raw = '; '.join(parts)
    raw = re.sub(r'\s+(?:and|aur|और|&)\s+(?=(?:call|dial|whatsapp|open whatsapp|send message|message|mark|update|change|set|approve|reject|close|open|pending)\b)', '; ', raw, flags=re.I)
    items = [p.strip(' -') for p in re.split(r'\s*;\s*', raw) if p.strip(' -')]
    return items[:10]


def parse_text_after_keyword(raw, keyword):
    m = re.search(keyword + r'\s*(?:to|as|=|:)?\s*(.+)$', raw, re.I)
    return m.group(1).strip(' :-') if m else ''


def candidate_field_updates_from_text(raw):
    text = raw.lower()
    updates = {}
    if any(k in text for k in ['salary', 'in hand', 'in-hand', 'salary update']):
        value = parse_text_after_keyword(raw, r'(?:salary|in hand|in-hand)')
        value = re.sub(r'\b(?:update|change|set|kar do|kardo|karna|please)\b', ' ', value, flags=re.I).strip(' :-')
        if value:
            updates['in_hand_salary'] = value
    if 'location' in text:
        value = parse_text_after_keyword(raw, r'location')
        value = re.sub(r'\b(?:update|change|set|kar do|kardo|city|current)\b', ' ', value, flags=re.I).strip(' :-,')
        if value:
            updates['location'] = value.title() if value.islower() else value
    if 'qualification' in text:
        value = parse_text_after_keyword(raw, r'qualification')
        value = re.sub(r'\b(?:update|change|set|kar do|kardo)\b', ' ', value, flags=re.I).strip(' :-,')
        if value:
            updates['qualification'] = value
    if 'experience' in text:
        value = parse_text_after_keyword(raw, r'experience')
        value = re.sub(r'\b(?:update|change|set|kar do|kardo|total)\b', ' ', value, flags=re.I).strip(' :-,')
        if value:
            updates['total_experience'] = value
            updates['experience'] = value
    if 'process' in text or 'specification' in text:
        value = parse_text_after_keyword(raw, r'(?:process|specification)')
        value = re.sub(r'\b(?:update|change|set|kar do|kardo)\b', ' ', value, flags=re.I).strip(' :-,')
        if value:
            updates['process'] = value
    return updates


def parse_internal_message_command(raw):
    target = None
    message = ''
    m = re.search(r'(?:message|chat|msg|send message)\s+(?:to\s+)?([^:]+?)\s*[:\-]\s*(.+)$', raw, re.I)
    if m:
        target = find_user_by_hint(m.group(1).strip())
        message = m.group(2).strip()
    if not target:
        m = re.search(r'(?:message|chat|msg|send message)\s+(?:to\s+)?(.+?)\s+(?:saying|bolo|that|ki)\s+(.+)$', raw, re.I)
        if m:
            target = find_user_by_hint(m.group(1).strip())
            message = m.group(2).strip()
    return target, message


def parse_task_assignment_command(raw):
    title = ''
    target = None
    due_at = ''
    m = re.search(r'(?:assign|create|add)\s+task\s+(.+?)\s+to\s+(.+)$', raw, re.I)
    if m:
        title = m.group(1).strip(' :-')
        tail = m.group(2).strip()
        due_match = re.search(r'\s+due\s+(.+)$', tail, re.I)
        if due_match:
            due_at = parse_command_target_date(due_match.group(1).strip())
            tail = tail[:due_match.start()].strip()
        target = find_user_by_hint(tail)
    return title, target, due_at





def parse_unlock_request_hint(raw, actor=None):
    actor = actor or current_user()
    rows = pending_unlock_requests_for(actor) if actor else []
    if not rows:
        return None
    raw_text = str(raw or '').strip()
    low = raw_text.lower()
    req_match = re.search(r'\bUR\d{3,10}\b', raw_text, re.I)
    if req_match:
        req_id = req_match.group(0).upper()
        hit = next((dict(r) for r in rows if str(r.get('request_id', '')).upper() == req_id), None)
        if hit:
            return hit
    users_by_id = user_map('user_id')
    for row in rows:
        req = dict(row)
        target = users_by_id.get(req.get('user_id')) or {}
        for value in [req.get('request_id', ''), target.get('username', ''), target.get('full_name', ''), target.get('recruiter_code', '')]:
            sval = str(value or '').strip().lower()
            if sval and (low == sval or sval in low):
                return req
    return dict(rows[0]) if len(rows) == 1 else None


def aaria_fix_suggestion(command_text, result=None):
    raw = str(command_text or '').strip()
    low = raw.lower()
    if 'salary' in low:
        return 'update salary C001 to 22000'
    if 'location' in low:
        return 'update location C001 to Noida'
    if 'qualification' in low:
        return 'update qualification C001 to Graduate'
    if 'experience' in low:
        return 'update experience C001 to 12'
    if 'interview' in low:
        return 'update interview C001 to tomorrow 4 pm'
    if 'note' in low:
        return 'note C001 candidate is available after 6 pm'
    if 'whatsapp' in low:
        return 'whatsapp Hi to C001'
    if 'call' in low or 'dial' in low:
        return 'call C001'
    if 'unlock' in low:
        return 'unlock recruiter.01'
    if 'approve' in low:
        return 'approve S001'
    if 'reject' in low:
        return 'reject S001'
    if 'message' in low or 'chat' in low:
        return 'message tl.noida: please review the queue'
    if 'task' in low:
        return 'add task for C001 callback by 5 pm'
    return 'call C001; whatsapp Hi to C001; update location C001 to Delhi'


def aaria_parse_instruction_v3(command_text, serial_hint=''):
    raw = str(command_text or '').strip()
    text = raw.lower()
    if not raw:
        return {'ok': False, 'message': 'Command is empty.', 'action': 'none', 'fix_suggestion': aaria_fix_suggestion(raw)}
    user = current_user()
    candidate_hint = serial_hint or extract_candidate_hint_from_text_v3(raw)
    candidate = parse_candidate_hint(candidate_hint) if candidate_hint else None
    task = parse_task_hint(extract_candidate_hint_from_text_v3(raw)) if ('task' in text or re.search(r'\bT\d{3,6}\b', raw, re.I)) else None
    submission = parse_submission_hint(raw, candidate)
    unlock_request = parse_unlock_request_hint(raw, user)
    action = None
    payload = {}
    target_user = None

    if any(k in text for k in ['mark all notifications read', 'notifications read', 'mark notifications', 'notification mark read']):
        action = 'notifications_mark_all'
    elif 'unlock' in text:
        action = 'unlock_decision'
        payload['decision'] = 'Rejected' if 'reject' in text else 'Approved'
    elif re.search(r'\bapprove\b', text) or re.search(r'\breject\b', text):
        if submission or 'pending approval' in text or 'approval' in text:
            action = 'submission_decision'
            payload['decision'] = 'Approved' if 'approve' in text else 'Rejected'
    elif any(k in text for k in ['message ', 'chat ', 'msg ', 'send message']):
        target_user, msg = parse_internal_message_command(raw)
        if target_user and msg:
            action = 'internal_message'
            payload['message'] = msg
    elif ('assign task' in text or 'create task' in text or 'add task' in text) and ' to ' in text:
        title, target_user, due_at = parse_task_assignment_command(raw)
        if title and target_user:
            action = 'task_assign'
            payload.update({'title': title, 'due_date': due_at or datetime.now().strftime('%Y-%m-%d %H:%M')})
    elif candidate_field_updates_from_text(raw):
        action = 'candidate_field_update'
        payload['updates'] = candidate_field_updates_from_text(raw)
    elif ('phone' in text or 'number' in text) and any(k in text for k in ['change', 'update', 'set', 'replace']):
        m = re.search(r'([6-9]\d{9})', raw)
        if m:
            action = 'phone_update'
            payload['phone'] = normalize_phone(m.group(1))
    elif 'note' in text:
        action = 'add_note'
        m = re.search(r'note(?:s)?(?:\s+for)?(?:\s*:?\s*)(.+)$', raw, re.I)
        payload['note'] = m.group(1).strip() if m else raw
        payload['note_type'] = 'public'
    elif 'interview' in text and any(k in text for k in ['date', 'reschedule', 'schedule', 'tomorrow', 'today', 'update', 'pm', 'am']):
        action = 'interview_date'
        payload['scheduled_at'] = parse_command_target_date(raw)
    elif any(k in text for k in ['not interested', 'notinterested']):
        action = 'candidate_status'; payload['status'] = 'Not Interested'
    elif any(k in text for k in ['reject', 'rejected']) and not action:
        action = 'candidate_status'; payload['status'] = 'Rejected'
    elif any(k in text for k in ['select', 'selected']) and not action:
        action = 'candidate_status'; payload['status'] = 'Selected'
    elif 'whatsapp' in text or 'whats app' in text or 'open whatsapp' in text:
        action = 'whatsapp'
        m = re.search(r'(?:send|message|msg)\s+(.+?)\s+(?:to|for)\s+(?:candidate\s+)?(?:' + re.escape(candidate_hint or '') + r')', raw, re.I) if candidate_hint else None
        msg = m.group(1).strip() if m else ''
        if not msg and re.search(r'\bhi\b', text):
            msg = 'Hi'
        payload['message'] = msg or (f'Hello {candidate.get("full_name", "")}, this message is from Career Crox.' if candidate else 'Hello from Career Crox.')
    elif any(k in text for k in ['call', 'dial']):
        action = 'call'
    elif task and any(k in text for k in ['close', 'closed', 'done']):
        action = 'task_update'; payload['status'] = 'Closed'
    elif task and any(k in text for k in ['open', 'reopen']):
        action = 'task_update'; payload['status'] = 'Open'
    elif task and 'pending' in text:
        action = 'task_update'; payload['status'] = 'Pending'
    elif 'task' in text and any(k in text for k in ['add', 'create']) and candidate:
        action = 'task_create'
        title = re.sub(r'\b(?:add|create|task|for|candidate|profile)\b', ' ', raw, flags=re.I)
        title = re.sub(r'\bC\d{3,6}\b', ' ', title, flags=re.I)
        title = re.sub(r'\s+', ' ', title).strip(' :-') or f'Follow up {candidate.get("full_name", "candidate")}'
        payload['title'] = title

    if not action:
        return {'ok': False, 'message': 'Command not clear.', 'action': 'none', 'candidate': candidate, 'fix_suggestion': aaria_fix_suggestion(raw)}
    if action in {'call', 'whatsapp', 'candidate_status', 'interview_date', 'add_note', 'phone_update', 'candidate_field_update'} and not candidate:
        return {'ok': False, 'message': 'Candidate not found. Use candidate name, candidate ID, or phone digits.', 'action': action, 'fix_suggestion': aaria_fix_suggestion(raw)}
    if action == 'task_update' and not task:
        return {'ok': False, 'message': 'Task not found. Use a task ID such as T001.', 'action': action, 'fix_suggestion': 'close T001'}
    if action == 'task_assign' and not target_user:
        return {'ok': False, 'message': 'Team member not found.', 'action': action, 'fix_suggestion': 'assign task callback to tl.noida'}
    if action == 'internal_message' and not target_user:
        return {'ok': False, 'message': 'Message target not found.', 'action': action, 'fix_suggestion': 'message tl.noida: please review the queue'}
    if action == 'submission_decision' and not submission:
        return {'ok': False, 'message': 'Pending submission not found.', 'action': action, 'fix_suggestion': 'approve S001'}
    if action == 'unlock_decision' and not unlock_request:
        return {'ok': False, 'message': 'Pending unlock request not found.', 'action': action, 'fix_suggestion': 'unlock recruiter.01'}
    return {'ok': True, 'action': action, 'payload': payload, 'candidate': candidate, 'task': task, 'submission': submission, 'unlock_request': unlock_request, 'target_user': target_user, 'message': 'Ready.'}

def aaria_recent_history_for(user, limit=10):
    if not user:
        return []
    rows = [dict(r) for r in get_backend().list_rows('aaria_queue') if r.get('user_id') == user.get('user_id')]
    rows.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    return rows[:limit]



def aaria_execute_single_v3(command_text, serial_hint='', preview=False):
    parsed = aaria_parse_instruction_v3(command_text, serial_hint)
    if not parsed.get('ok'):
        parsed.setdefault('fix_suggestion', aaria_fix_suggestion(command_text, parsed))
        return parsed
    user = current_user()
    action = parsed['action']
    payload = parsed.get('payload', {})
    candidate = parsed.get('candidate')
    task = parsed.get('task')
    submission = parsed.get('submission')
    unlock_request = parsed.get('unlock_request')
    target_user = parsed.get('target_user')
    response = dict(parsed)
    if candidate and not visible_candidate_for_command(candidate, user):
        return {'ok': False, 'message': 'You do not have access to this profile.', 'action': action, 'fix_suggestion': aaria_fix_suggestion(command_text)}
    if action in {'submission_decision', 'unlock_decision'} and normalize_role(user.get('role')) not in {'manager', 'tl'}:
        return {'ok': False, 'message': 'Only a manager or team lead can complete this approval.', 'action': action, 'fix_suggestion': aaria_fix_suggestion(command_text)}
    if action == 'task_assign' and normalize_role(user.get('role')) not in {'manager', 'tl'} and target_user.get('user_id') != user.get('user_id'):
        return {'ok': False, 'message': 'A recruiter cannot assign a task to another user.', 'action': action, 'fix_suggestion': 'add task for C001 callback'}
    if preview:
        response['message'] = 'Ready.'
        if action == 'candidate_field_update':
            response['message'] = f"Fields ready: {', '.join(payload.get('updates', {}).keys())}"
        elif action == 'internal_message':
            response['message'] = f"Message ready for {target_user.get('full_name')}"
        elif action == 'task_assign':
            response['message'] = f"Task ready for {target_user.get('full_name')}: {payload.get('title')}"
        elif action == 'submission_decision':
            response['message'] = f"Submission {submission.get('submission_id')} is ready for {payload.get('decision')}"
        elif action == 'unlock_decision':
            response['message'] = f"Unlock request {unlock_request.get('request_id')} is ready for {payload.get('decision')}"
        elif action == 'notifications_mark_all':
            response['message'] = 'All notifications are ready to be marked as read.'
        return response
    if action == 'call':
        phone = normalize_phone(candidate.get('phone'))
        response['message'] = f"Dialer ready for {candidate.get('full_name')}."
        response['action_link'] = f'tel:+91{phone}'
        response['action_type'] = 'call'
        response['avatar_state'] = 'call'
        log_activity(user, 'aaria_call', candidate.get('candidate_id'), {'phone': phone})
    elif action == 'whatsapp':
        phone = normalize_phone(candidate.get('phone'))
        message = payload.get('message') or f"Hello {candidate.get('full_name')}, this message is from Career Crox."
        response['message'] = f"WhatsApp draft ready for {candidate.get('full_name')}."
        response['action_link'] = f"https://wa.me/91{phone}?text={quote(message)}"
        response['action_type'] = 'whatsapp'
        response['avatar_state'] = 'success'
        log_activity(user, 'aaria_whatsapp', candidate.get('candidate_id'), {'phone': phone, 'message': message[:120]})
    elif action == 'candidate_status':
        get_backend().update_where('candidates', {'candidate_id': candidate.get('candidate_id')}, {'status': payload['status'], 'updated_at': now_iso()})
        response['message'] = f"Status updated for {candidate.get('full_name')} to {payload['status']}."
        response['avatar_state'] = 'success'
        log_activity(user, 'aaria_status_update', candidate.get('candidate_id'), {'status': payload['status']})
    elif action == 'interview_date':
        existing = next((dict(i) for i in get_backend().list_rows('interviews') if i.get('candidate_id') == candidate.get('candidate_id')), None)
        jd_match = next((j for j in get_backend().list_rows('jd_master') if (j.get('company') or '').strip().lower() == ((candidate.get('process') or '').split()[0] if candidate.get('process') else '').strip().lower()), None)
        if existing:
            get_backend().update_where('interviews', {'interview_id': existing.get('interview_id')}, {'scheduled_at': payload['scheduled_at'], 'status': 'Scheduled', 'stage': 'Interview Scheduled'})
        else:
            get_backend().insert('interviews', {'interview_id': next_prefixed_id('interviews', 'interview_id', 'I'), 'candidate_id': candidate.get('candidate_id'), 'jd_id': (jd_match or {}).get('jd_id', ''), 'stage': 'Interview Scheduled', 'scheduled_at': payload['scheduled_at'], 'status': 'Scheduled', 'created_at': now_iso()})
        get_backend().update_where('candidates', {'candidate_id': candidate.get('candidate_id')}, {'interview_reschedule_date': payload['scheduled_at'], 'status': 'Interview Scheduled', 'updated_at': now_iso()})
        response['message'] = f"Interview updated for {candidate.get('full_name')} on {payload['scheduled_at']}."
        response['avatar_state'] = 'success'
        log_activity(user, 'aaria_interview_update', candidate.get('candidate_id'), {'scheduled_at': payload['scheduled_at']})
    elif action == 'add_note':
        get_backend().insert('notes', {'candidate_id': candidate.get('candidate_id'), 'username': user.get('username'), 'note_type': payload.get('note_type', 'public'), 'body': payload.get('note', ''), 'created_at': now_iso()})
        response['message'] = f"Note added for {candidate.get('full_name')}."
        response['avatar_state'] = 'success'
        log_activity(user, 'aaria_note_added', candidate.get('candidate_id'), {'note': payload.get('note', '')[:140]})
    elif action == 'phone_update':
        get_backend().update_where('candidates', {'candidate_id': candidate.get('candidate_id')}, {'phone': payload.get('phone'), 'updated_at': now_iso()})
        response['message'] = f"Phone number updated for {candidate.get('full_name')}."
        response['avatar_state'] = 'success'
        log_activity(user, 'aaria_phone_update', candidate.get('candidate_id'), {'phone': payload.get('phone')})
    elif action == 'candidate_field_update':
        updates = dict(payload.get('updates') or {})
        if 'total_experience' in updates:
            updates['experience'] = updates['total_experience']
            updates['relevant_experience_range'] = derive_experience_range(updates['total_experience'])
        if 'in_hand_salary' in updates:
            updates['relevant_in_hand_range'] = derive_salary_range(updates['in_hand_salary'])
        updates['updated_at'] = now_iso()
        get_backend().update_where('candidates', {'candidate_id': candidate.get('candidate_id')}, updates)
        changed = ', '.join([k.replace('_', ' ') for k in updates.keys() if k != 'updated_at'])
        response['message'] = f"Updated {changed} for {candidate.get('full_name')}."
        response['avatar_state'] = 'success'
        log_activity(user, 'aaria_field_update', candidate.get('candidate_id'), {'fields': list(updates.keys())})
    elif action == 'task_create':
        task_id = next_prefixed_id('tasks', 'task_id', 'T')
        desc = f"Aaria task for {candidate.get('full_name')} ({candidate.get('candidate_id')})"
        get_backend().insert('tasks', {'task_id': task_id, 'title': payload.get('title'), 'description': desc, 'assigned_to_user_id': user.get('user_id'), 'assigned_to_name': user.get('full_name'), 'assigned_by_user_id': user.get('user_id'), 'assigned_by_name': user.get('full_name'), 'status': 'Open', 'priority': 'Normal', 'due_date': datetime.now().strftime('%Y-%m-%d %H:%M'), 'created_at': now_iso(), 'updated_at': now_iso()})
        response['message'] = f"Task {task_id} created successfully."
        response['avatar_state'] = 'success'
        log_activity(user, 'aaria_task_create', candidate.get('candidate_id'), {'task_id': task_id, 'title': payload.get('title')})
    elif action == 'task_assign':
        task_id = next_prefixed_id('tasks', 'task_id', 'T')
        get_backend().insert('tasks', {'task_id': task_id, 'title': payload.get('title'), 'description': payload.get('title'), 'assigned_to_user_id': target_user.get('user_id'), 'assigned_to_name': target_user.get('full_name'), 'assigned_by_user_id': user.get('user_id'), 'assigned_by_name': user.get('full_name'), 'status': 'Open', 'priority': 'Normal', 'due_date': payload.get('due_date') or datetime.now().strftime('%Y-%m-%d %H:%M'), 'created_at': now_iso(), 'updated_at': now_iso()})
        notify_users([target_user.get('user_id')], 'Task assigned', payload.get('title'), 'task', {'task_id': task_id})
        response['message'] = f"Task {task_id} assigned to {target_user.get('full_name')}."
        response['avatar_state'] = 'success'
        log_activity(user, 'aaria_task_assign', metadata={'task_id': task_id, 'assigned_to': target_user.get('username')})
    elif action == 'task_update':
        get_backend().update_where('tasks', {'task_id': task.get('task_id')}, {'status': payload.get('status'), 'updated_at': now_iso()})
        response['message'] = f"Task {task.get('task_id')} updated to {payload.get('status')}."
        response['avatar_state'] = 'success'
        log_activity(user, 'aaria_task_update', metadata={'task_id': task.get('task_id'), 'status': payload.get('status')})
    elif action == 'internal_message':
        get_backend().insert('messages', {'sender_username': user.get('username'), 'recipient_username': target_user.get('username'), 'body': payload.get('message'), 'created_at': now_iso()})
        notify_users([target_user.get('user_id')], 'New internal message', f"{user.get('full_name')} sent you a message.", 'chat', {'from': user.get('username')})
        response['message'] = f"Message sent to {target_user.get('full_name')}."
        response['avatar_state'] = 'success'
        log_activity(user, 'aaria_internal_message', metadata={'to': target_user.get('username')})
    elif action == 'submission_decision':
        decision = payload.get('decision')
        if decision == 'Approved':
            get_backend().update_where('submissions', {'submission_id': submission.get('submission_id')}, {'approval_status': 'Approved', 'approved_by_name': user.get('full_name', ''), 'approved_at': now_iso(), 'status': 'Approved'})
            get_backend().update_where('candidates', {'candidate_id': submission.get('candidate_id')}, {'approval_status': 'Approved', 'approved_by_name': user.get('full_name', ''), 'approved_at': now_iso(), 'status': 'Approved', 'updated_at': now_iso()})
        else:
            get_backend().update_where('submissions', {'submission_id': submission.get('submission_id')}, {'approval_status': 'Rejected', 'approved_by_name': user.get('full_name', ''), 'approved_at': now_iso(), 'status': 'Rejected'})
            get_backend().update_where('candidates', {'candidate_id': submission.get('candidate_id')}, {'approval_status': 'Rejected', 'approved_by_name': user.get('full_name', ''), 'approved_at': now_iso(), 'status': 'Rejected', 'updated_at': now_iso()})
        owner = find_user_by_recruiter_code(submission.get('recruiter_code'))
        if owner:
            notify_users([owner.get('user_id')], f'Submission {decision.lower()}', f"{submission.get('submission_id')} was {decision.lower()}.", 'submission', {'submission_id': submission.get('submission_id')})
        response['message'] = f"Submission {submission.get('submission_id')} marked as {decision}."
        response['avatar_state'] = 'success'
        log_activity(user, 'aaria_submission_decision', submission.get('candidate_id'), {'submission_id': submission.get('submission_id'), 'decision': decision})
    elif action == 'unlock_decision':
        req = unlock_request
        decision = payload.get('decision')
        if decision == 'Approved':
            get_backend().update_where('unlock_requests', {'request_id': req.get('request_id')}, {'status': 'Approved', 'approved_by_user_id': user.get('user_id'), 'approved_by_name': user.get('full_name'), 'approved_at': now_iso()})
            get_backend().update_where('presence', {'user_id': req.get('user_id')}, {'locked': '0', 'is_on_break': '0', 'break_reason': '', 'break_started_at': '', 'break_expected_end_at': '', 'last_seen_at': now_iso()})
            notify_users([req.get('user_id')], 'CRM unlocked', f"{user.get('full_name')} approved your unlock request.", 'attendance', {'request_id': req.get('request_id')})
            response['message'] = f"Unlock request {req.get('request_id')} approved."
        else:
            get_backend().update_where('unlock_requests', {'request_id': req.get('request_id')}, {'status': 'Rejected', 'approved_by_user_id': user.get('user_id'), 'approved_by_name': user.get('full_name'), 'approved_at': now_iso()})
            notify_users([req.get('user_id')], 'Unlock rejected', f"{user.get('full_name')} rejected your unlock request.", 'attendance', {'request_id': req.get('request_id')})
            response['message'] = f"Unlock request {req.get('request_id')} rejected."
        response['avatar_state'] = 'success'
        log_activity(user, 'aaria_unlock_decision', metadata={'request_id': req.get('request_id'), 'decision': decision})
    elif action == 'notifications_mark_all':
        for n in user_notifications(user):
            get_backend().update_where('notifications', {'notification_id': n['notification_id']}, {'status': 'Read'})
        response['message'] = 'All notifications marked as read.'
        response['avatar_state'] = 'success'
        log_activity(user, 'aaria_notifications_mark_all')
    get_backend().insert('aaria_queue', {'task_id': f"AQ{int(datetime.now().timestamp()*1000)}{random.randint(100,999)}", 'user_id': user.get('user_id', ''), 'serial_hint': serial_hint or extract_candidate_hint_from_text_v3(command_text), 'command_text': command_text, 'status': 'Completed', 'result_text': response.get('message', ''), 'created_at': now_iso(), 'updated_at': now_iso()})
    return response


def aaria_execute_batch_v3(command_text, serial_hint='', preview=False):
    commands = split_aaria_commands_v3(command_text)
    if not commands:
        return {'ok': False, 'message': 'Command is empty.', 'batch_results': [], 'fix_suggestion': aaria_fix_suggestion(command_text)}
    results = []
    for cmd in commands:
        item = aaria_execute_single_v3(cmd, serial_hint or extract_candidate_hint_from_text_v3(cmd), preview=preview)
        item['command'] = cmd
        if not item.get('ok'):
            item.setdefault('fix_suggestion', aaria_fix_suggestion(cmd, item))
        results.append(item)
    ok_count = len([r for r in results if r.get('ok')])
    fail_count = len(results) - ok_count
    primary = next((r for r in results if r.get('candidate')), results[0] if results else {})
    return {'ok': ok_count > 0, 'message': f'{ok_count} command completed. {fail_count} need review.', 'batch_results': results, 'candidate': primary.get('candidate'), 'avatar_state': 'success' if fail_count == 0 else 'warning'}

def aaria_execute_v3():
    payload = request.get_json(silent=True) or request.form.to_dict(flat=True)
    command_text = payload.get('command', '')
    serial_hint = payload.get('serial', '')
    preview = str(payload.get('mode', 'execute')).lower() == 'preview'
    result = aaria_execute_batch_v3(command_text, serial_hint, preview=preview)
    cand = result.get('candidate') or {}
    if cand:
        result['candidate'] = {'candidate_id': cand.get('candidate_id') or cand.get('code', ''), 'full_name': cand.get('full_name', ''), 'phone': cand.get('phone', ''), 'status': cand.get('status', ''), 'location': cand.get('location', '')}
    return jsonify(result)


def aaria_resolve_v3():
    cand = parse_candidate_hint(request.args.get('serial', ''))
    user = current_user()
    if not cand or not visible_candidate_for_command(cand, user):
        return jsonify({'ok': False})
    return jsonify({'ok': True, 'candidate': {'candidate_id': cand.get('candidate_id') or cand.get('code', ''), 'full_name': cand.get('full_name', ''), 'phone': display_phone_for_user(cand.get('phone', ''), user), 'status': cand.get('status', ''), 'location': cand.get('location', '')}})


def update_candidate_v7(candidate_code):
    candidate = ensure_candidate_defaults(get_candidate(candidate_code) or {})
    if not candidate.get('candidate_id'):
        abort(404)
    if not candidate_visible_to_user(candidate, current_user()):
        abort(403)
    return update_candidate(candidate_code)


def testing_ai_page_v3():
    cv_result = None
    if request.method == 'POST' and request.files.get('cv_file'):
        action = request.form.get('cv_action', 'extract_details')
        source_path, out_path, summary = process_cv_upload(request.files['cv_file'], action)
        cv_result = {'source_name': source_path.name, 'output_name': out_path.name, 'summary': summary}
        flash('CV tool processed file successfully.', 'success')
        log_activity(current_user(), 'cv_tool', metadata={'action': action, 'output': out_path.name})
    activity_rows, risk_rows = activity_monitor_rows()
    queue_rows = aaria_recent_history_for(current_user(), 10)
    candidate_options = [{'candidate_id': c.get('candidate_id'), 'full_name': c.get('full_name'), 'phone': display_phone_for_user(c.get('phone'), current_user()), 'status': c.get('status'), 'location': c.get('location')} for c in visible_candidates_rows(current_user())[:120]]
    return render_template('testing_ai.html', cv_result=cv_result, activity_rows=activity_rows, risk_rows=risk_rows, queue_rows=queue_rows, candidate_options=candidate_options, aaria_recent_history=queue_rows, aaria_command_guide_pdf=url_for('static', filename=AARIA_GUIDE_STATIC_PATH))


def inject_aaria_history_v3():
    user = current_user()
    history = aaria_recent_history_for(user, 10) if user else []
    return {'aaria_recent_history': history, 'aaria_command_guide_pdf': (url_for('static', filename=AARIA_GUIDE_STATIC_PATH) if user else '')}


app.context_processor(inject_aaria_history_v3)
SIDEBAR_ITEMS = [('AI Operations', endpoint, kwargs) if label == 'Testing AI Features' else (label, endpoint, kwargs) for label, endpoint, kwargs in SIDEBAR_ITEMS]
app.view_functions['aaria_execute'] = login_required(aaria_execute_v3)
app.view_functions['aaria_resolve'] = login_required(aaria_resolve_v3)
app.view_functions['update_candidate'] = login_required(update_candidate_v7)
app.view_functions['testing_ai_page'] = login_required(testing_ai_page_v3)


def upcoming_follow_up_for_user(user):
    if not user:
        return None
    now = datetime.now()
    rows = []
    for cand in visible_candidates_rows(user):
        follow_at = parse_dt_safe(cand.get("follow_up_at"))
        if not follow_at:
            continue
        if (cand.get("follow_up_status") or "Open") in {"Completed", "Closed"}:
            continue
        delta = (follow_at - now).total_seconds()
        if -180 <= delta <= 180:
            rows.append((abs(delta), cand))
    rows.sort(key=lambda x: x[0])
    return rows[0][1] if rows else None


@app.route("/api/followups/upcoming")
@login_required
def api_followups_upcoming():
    cand = upcoming_follow_up_for_user(current_user())
    if not cand:
        return jsonify({"ok": False})
    return jsonify({"ok": True, "candidate_id": cand.get("candidate_id"), "full_name": cand.get("full_name"), "follow_up_at": cand.get("follow_up_at"), "follow_up_note": cand.get("follow_up_note"), "follow_up_status": cand.get("follow_up_status")})


@app.route("/api/followups/action", methods=["POST"])
@login_required
def api_followups_action():
    payload = request.get_json(silent=True) or request.form.to_dict(flat=True)
    candidate_id = payload.get("candidate_id", "")
    action = payload.get("action", "")
    cand = ensure_candidate_defaults(get_candidate(candidate_id) or {})
    if not cand.get("candidate_id") or not candidate_visible_to_user(cand, current_user()):
        return jsonify({"ok": False, "message": "Candidate not found."}), 404
    if action == "complete":
        get_backend().update_where("candidates", {"candidate_id": candidate_id}, {"follow_up_status": "Completed", "updated_at": now_iso()})
        return jsonify({"ok": True})
    if action == "reschedule":
        new_time = parse_local_datetime(payload.get("follow_up_at", "").strip())
        if not new_time:
            return jsonify({"ok": False, "message": "New date and time required."}), 400
        get_backend().update_where("candidates", {"candidate_id": candidate_id}, {"follow_up_at": new_time, "follow_up_status": "Open", "updated_at": now_iso()})
        return jsonify({"ok": True})
    return jsonify({"ok": False, "message": "Unsupported action."}), 400


TABLE_COLUMNS.update({"active_sessions": {"username", "session_token", "ip_address", "user_agent", "updated_at"}})
_prev_sqlite_init_v10 = SQLiteBackend._init_db

def sqlite_init_v10(self):
    _prev_sqlite_init_v10(self)
    conn = self._connect()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS active_sessions (
        username TEXT PRIMARY KEY,
        session_token TEXT,
        ip_address TEXT,
        user_agent TEXT,
        updated_at TEXT
    );
    """)
    conn.commit()
    conn.close()

SQLiteBackend._init_db = sqlite_init_v10



# === Growth Suite v14: manager-only client and revenue modules, leadership performance ===
TABLE_COLUMNS.update({
    "client_pipeline": {"lead_id","client_name","contact_person","contact_phone","city","industry","status","owner_username","priority","openings_count","last_follow_up_at","next_follow_up_at","notes","created_at","updated_at"},
    "client_requirements": {"req_id","lead_id","jd_title","city","openings","target_ctc","status","assigned_tl","assigned_manager","fill_target_date","created_at"},
    "revenue_entries": {"rev_id","client_name","candidate_id","jd_id","recruiter_code","amount_billed","amount_collected","invoice_status","billing_month","joined_at","expected_payout_date","source_channel","created_at"},
})

_prev_sqlite_init_v14 = SQLiteBackend._init_db

def sqlite_init_v14(self):
    _prev_sqlite_init_v14(self)
    conn = self._connect()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS client_pipeline (
        lead_id TEXT PRIMARY KEY,
        client_name TEXT,
        contact_person TEXT,
        contact_phone TEXT,
        city TEXT,
        industry TEXT,
        status TEXT,
        owner_username TEXT,
        priority TEXT,
        openings_count TEXT,
        last_follow_up_at TEXT,
        next_follow_up_at TEXT,
        notes TEXT,
        created_at TEXT,
        updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS client_requirements (
        req_id TEXT PRIMARY KEY,
        lead_id TEXT,
        jd_title TEXT,
        city TEXT,
        openings TEXT,
        target_ctc TEXT,
        status TEXT,
        assigned_tl TEXT,
        assigned_manager TEXT,
        fill_target_date TEXT,
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS revenue_entries (
        rev_id TEXT PRIMARY KEY,
        client_name TEXT,
        candidate_id TEXT,
        jd_id TEXT,
        recruiter_code TEXT,
        amount_billed TEXT,
        amount_collected TEXT,
        invoice_status TEXT,
        billing_month TEXT,
        joined_at TEXT,
        expected_payout_date TEXT,
        source_channel TEXT,
        created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_client_pipeline_status ON client_pipeline(status);
    CREATE INDEX IF NOT EXISTS idx_client_pipeline_owner ON client_pipeline(owner_username);
    CREATE INDEX IF NOT EXISTS idx_revenue_entries_month ON revenue_entries(billing_month);
    CREATE INDEX IF NOT EXISTS idx_revenue_entries_invoice_status ON revenue_entries(invoice_status);
    CREATE INDEX IF NOT EXISTS idx_revenue_entries_recruiter_code ON revenue_entries(recruiter_code);
    """)
    conn.commit()
    conn.close()

SQLiteBackend._init_db = sqlite_init_v14

GROWTH_MANAGER_LABELS = {"Client Pipeline", "Revenue Hub"}
LEADERSHIP_LABELS = {"Performance Centre", "Recent Activity"}
for _item in [
    ("Client Pipeline", "client_pipeline_page", {}),
    ("Revenue Hub", "revenue_hub_page", {}),
    ("Performance Centre", "performance_centre_page", {}),
]:
    if _item not in SIDEBAR_ITEMS:
        insert_at = max(0, len(SIDEBAR_ITEMS) - 2)
        SIDEBAR_ITEMS.insert(insert_at, _item)


def safe_list_rows(table):
    try:
        return [dict(r) for r in get_backend().list_rows(table)]
    except Exception:
        return []


def safe_table_exists_and_has_rows(table):
    try:
        return len(get_backend().list_rows(table)) > 0
    except Exception:
        return False


def ensure_growth_suite_seeded():
    if getattr(app, '_growth_suite_seeded', False):
        return
    app._growth_suite_seeded = True
    now = datetime.now()
    month = now.strftime('%Y-%m')
    leads = [
        {"lead_id":"L001","client_name":"Blinkit Hiring Desk","contact_person":"Rohit Sharma","contact_phone":"9812345678","city":"Gurgaon","industry":"E-commerce","status":"Proposal Sent","owner_username":"aaryansh.manager","priority":"High","openings_count":"18","last_follow_up_at":(now-timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S'),"next_follow_up_at":(now+timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S'),"notes":"Blended customer support ramp expected this week.","created_at":(now-timedelta(days=12)).strftime('%Y-%m-%dT%H:%M:%S'),"updated_at":now_iso()},
        {"lead_id":"L002","client_name":"Teleperformance North","contact_person":"Megha Jain","contact_phone":"9876501234","city":"Noida","industry":"BPO","status":"Negotiation","owner_username":"aaryansh.manager","priority":"Hot","openings_count":"32","last_follow_up_at":(now-timedelta(hours=6)).strftime('%Y-%m-%dT%H:%M:%S'),"next_follow_up_at":(now+timedelta(hours=18)).strftime('%Y-%m-%dT%H:%M:%S'),"notes":"Awaiting revised commercial approval.","created_at":(now-timedelta(days=9)).strftime('%Y-%m-%dT%H:%M:%S'),"updated_at":now_iso()},
        {"lead_id":"L003","client_name":"Airtel Process Hub","contact_person":"Ankita Singh","contact_phone":"9898989898","city":"Noida","industry":"Telecom","status":"Active Hiring","owner_username":"aaryansh.manager","priority":"Critical","openings_count":"24","last_follow_up_at":(now-timedelta(hours=3)).strftime('%Y-%m-%dT%H:%M:%S'),"next_follow_up_at":(now+timedelta(hours=5)).strftime('%Y-%m-%dT%H:%M:%S'),"notes":"Daily submission commitment in place.","created_at":(now-timedelta(days=21)).strftime('%Y-%m-%dT%H:%M:%S'),"updated_at":now_iso()},
    ]
    reqs = [
        {"req_id":"R001","lead_id":"L001","jd_title":"Customer Support Executive","city":"Gurgaon","openings":"12","target_ctc":"26000","status":"Open","assigned_tl":"sakshi.tl","assigned_manager":"aaryansh.manager","fill_target_date":(now+timedelta(days=5)).strftime('%Y-%m-%d'),"created_at":now_iso()},
        {"req_id":"R002","lead_id":"L001","jd_title":"Chat Support Associate","city":"Gurgaon","openings":"6","target_ctc":"24000","status":"Sourcing","assigned_tl":"anjali.tl","assigned_manager":"aaryansh.manager","fill_target_date":(now+timedelta(days=7)).strftime('%Y-%m-%d'),"created_at":now_iso()},
        {"req_id":"R003","lead_id":"L002","jd_title":"Claims Process Executive","city":"Noida","openings":"15","target_ctc":"31000","status":"Interviewing","assigned_tl":"sakshi.tl","assigned_manager":"aaryansh.manager","fill_target_date":(now+timedelta(days=8)).strftime('%Y-%m-%d'),"created_at":now_iso()},
        {"req_id":"R004","lead_id":"L003","jd_title":"Blended Process Associate","city":"Noida","openings":"24","target_ctc":"28000","status":"Active","assigned_tl":"anjali.tl","assigned_manager":"aaryansh.manager","fill_target_date":(now+timedelta(days=3)).strftime('%Y-%m-%d'),"created_at":now_iso()},
    ]
    revenue = [
        {"rev_id":"REV001","client_name":"Airtel Process Hub","candidate_id":"C001","jd_id":"J001","recruiter_code":"RC-101","amount_billed":"55000","amount_collected":"55000","invoice_status":"Collected","billing_month":month,"joined_at":(now-timedelta(days=6)).strftime('%Y-%m-%d'),"expected_payout_date":(now+timedelta(days=24)).strftime('%Y-%m-%d'),"source_channel":"Database","created_at":now_iso()},
        {"rev_id":"REV002","client_name":"Blinkit Hiring Desk","candidate_id":"C002","jd_id":"J002","recruiter_code":"RC-102","amount_billed":"48000","amount_collected":"20000","invoice_status":"Partially Collected","billing_month":month,"joined_at":(now-timedelta(days=4)).strftime('%Y-%m-%d'),"expected_payout_date":(now+timedelta(days=26)).strftime('%Y-%m-%d'),"source_channel":"Indeed","created_at":now_iso()},
        {"rev_id":"REV003","client_name":"Teleperformance North","candidate_id":"C003","jd_id":"J003","recruiter_code":"RC-103","amount_billed":"62000","amount_collected":"0","invoice_status":"Invoice Raised","billing_month":month,"joined_at":(now-timedelta(days=2)).strftime('%Y-%m-%d'),"expected_payout_date":(now+timedelta(days=28)).strftime('%Y-%m-%d'),"source_channel":"Naukri","created_at":now_iso()},
        {"rev_id":"REV004","client_name":"Airtel Process Hub","candidate_id":"C004","jd_id":"J004","recruiter_code":"RC-101","amount_billed":"53000","amount_collected":"0","invoice_status":"Offer Accepted","billing_month":month,"joined_at":(now+timedelta(days=5)).strftime('%Y-%m-%d'),"expected_payout_date":(now+timedelta(days=35)).strftime('%Y-%m-%d'),"source_channel":"Reference","created_at":now_iso()},
    ]
    for table, rows in [("client_pipeline", leads), ("client_requirements", reqs), ("revenue_entries", revenue)]:
        if not safe_table_exists_and_has_rows(table):
            try:
                get_backend().bulk_insert(table, trim_to_columns(rows, table))
            except Exception:
                pass

@app.before_request
def ensure_growth_suite_seeded_before_request():
    ensure_growth_suite_seeded()


def leadership_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user or normalize_role(user.get('role')) not in {'manager', 'tl'}:
            abort(403)
        return fn(*args, **kwargs)
    return wrapper


def visible_sidebar_items_v14(items, user):
    role = normalize_role((user or {}).get('role'))
    out = []
    for label, endpoint, kwargs in items:
        if label in GROWTH_MANAGER_LABELS and role != 'manager':
            continue
        if label in LEADERSHIP_LABELS and role not in {'manager', 'tl'}:
            continue
        if label in {'Wallet & Rewards', 'Payout Tracker', 'Admin Control'} and role != 'manager':
            continue
        out.append((label, endpoint, kwargs))
    return out

_prev_inject_globals_v14 = inject_globals

@app.context_processor
def inject_growth_globals():
    base_ctx = _prev_inject_globals_v14()
    user = current_user()
    base_ctx['sidebar_items'] = visible_sidebar_items_v14(SIDEBAR_ITEMS, user)
    base_ctx['leadership_role'] = normalize_role((user or {}).get('role')) in {'manager', 'tl'}
    base_ctx['manager_role'] = normalize_role((user or {}).get('role')) == 'manager'
    return base_ctx


def client_pipeline_rows(filters=None):
    filters = filters or {}
    leads = safe_list_rows('client_pipeline')
    requirements = safe_list_rows('client_requirements')
    req_by_lead = {}
    for req in requirements:
        req_by_lead.setdefault(req.get('lead_id'), []).append(req)
    status = (filters.get('status') or '').strip().lower()
    city = (filters.get('city') or '').strip().lower()
    q = (filters.get('q') or '').strip().lower()
    rows = []
    for lead in leads:
        item = dict(lead)
        if status and status not in (item.get('status') or '').lower():
            continue
        if city and city not in (item.get('city') or '').lower():
            continue
        hay = ' '.join([item.get('lead_id',''), item.get('client_name',''), item.get('contact_person',''), item.get('city',''), item.get('industry','')]).lower()
        if q and q not in hay:
            continue
        item['requirements'] = req_by_lead.get(item.get('lead_id'), [])
        item['open_requirements'] = len([r for r in item['requirements'] if (r.get('status') or '').lower() not in {'closed','filled'}])
        item['next_follow_up_view'] = display_ts(item.get('next_follow_up_at'))
        item['last_follow_up_view'] = display_ts(item.get('last_follow_up_at'))
        rows.append(item)
    rows.sort(key=lambda x: (x.get('priority') != 'Critical', x.get('status') != 'Active Hiring', x.get('next_follow_up_at') or ''))
    return rows


def revenue_hub_rows(filters=None):
    filters = filters or {}
    rows = safe_list_rows('revenue_entries')
    month = (filters.get('billing_month') or '').strip()
    client = (filters.get('client_name') or '').strip().lower()
    invoice_status = (filters.get('invoice_status') or '').strip().lower()
    out = []
    for row in rows:
        item = dict(row)
        if month and item.get('billing_month') != month:
            continue
        if client and client not in (item.get('client_name') or '').lower():
            continue
        if invoice_status and invoice_status not in (item.get('invoice_status') or '').lower():
            continue
        billed = parse_intish(item.get('amount_billed'), 0)
        collected = parse_intish(item.get('amount_collected'), 0)
        item['amount_billed_int'] = billed
        item['amount_collected_int'] = collected
        item['outstanding_int'] = max(0, billed - collected)
        out.append(item)
    out.sort(key=lambda x: (-x.get('amount_billed_int',0), x.get('client_name','')))
    return out


def recruiter_performance_rows(selected_username=''):
    users = [u for u in list_users() if normalize_role(u.get('role')) in {'recruiter','tl'}]
    candidates = enrich_candidates()
    tasks = safe_list_rows('tasks')
    activity = safe_list_rows('activity_log')
    revenue = safe_list_rows('revenue_entries')
    presence = {p.get('user_id'): dict(p) for p in safe_list_rows('presence') if p.get('user_id')}
    rows = []
    now = datetime.now()
    for user in users:
        if selected_username and user.get('username') != selected_username:
            continue
        recruiter_code = user.get('recruiter_code','')
        user_id = user.get('user_id','')
        user_candidates = [c for c in candidates if (c.get('recruiter_code') or '') == recruiter_code]
        user_tasks = [t for t in tasks if t.get('assigned_to_user_id') == user_id]
        user_activity = [a for a in activity if a.get('user_id') == user_id]
        calls = len([a for a in user_activity if a.get('action_type') in {'manual_call','aaria_call'}])
        updates = len([a for a in user_activity if 'update' in (a.get('action_type') or '') or a.get('action_type') in {'candidate_created','bulk_note_added','task_created'}])
        interviews = len([a for a in user_activity if 'interview' in (a.get('action_type') or '')])
        billings = [r for r in revenue if (r.get('recruiter_code') or '') == recruiter_code]
        billed = sum(parse_intish(r.get('amount_billed'),0) for r in billings)
        collected = sum(parse_intish(r.get('amount_collected'),0) for r in billings)
        pres = presence.get(user_id, {})
        last_seen = pres.get('last_seen_at') or ''
        idle_minutes = 999
        if last_seen:
            try:
                idle_minutes = int((now - datetime.fromisoformat(str(last_seen).replace('Z',''))).total_seconds() // 60)
            except Exception:
                idle_minutes = 999
        row = {
            'username': user.get('username'),
            'full_name': user.get('full_name'),
            'designation': user.get('designation'),
            'recruiter_code': recruiter_code,
            'candidate_count': len(user_candidates),
            'open_tasks': len([t for t in user_tasks if (t.get('status') or '').lower() not in {'closed','done'}]),
            'calls': calls,
            'updates': updates,
            'interviews': interviews,
            'billed': billed,
            'collected': collected,
            'last_seen': display_ts(last_seen),
            'idle_state': 'No movement detected for the past 3 minutes' if idle_minutes >= 3 and idle_minutes < 999 else 'Active',
            'idle_alert': idle_minutes >= 3 and idle_minutes < 999,
        }
        rows.append(row)
    rows.sort(key=lambda x: (x['designation'] != 'Team Lead', -x['calls'], -x['candidate_count']))
    return rows


def suspicious_activity_alerts():
    now = datetime.now()
    alerts = []
    by_user = {}
    for item in safe_list_rows('activity_log'):
        username = item.get('username','')
        when = str(item.get('created_at') or '')
        try:
            dt = datetime.fromisoformat(when.replace('Z',''))
        except Exception:
            continue
        bucket = by_user.setdefault(username, {'minute_actions':0, 'searches':0, 'whatsapp':0, 'profiles':0, 'last':dt})
        if (now - dt).total_seconds() <= 60:
            bucket['minute_actions'] += 1
            if 'search' in (item.get('action_type') or ''):
                bucket['searches'] += 1
            if 'whatsapp' in (item.get('action_type') or ''):
                bucket['whatsapp'] += 1
            if item.get('candidate_id'):
                bucket['profiles'] += 1
        if dt > bucket['last']:
            bucket['last'] = dt
    for username, stats in by_user.items():
        reasons = []
        if stats['profiles'] >= 10:
            reasons.append(f"{stats['profiles']} candidate-touch events in one minute")
        if stats['whatsapp'] >= 8:
            reasons.append(f"{stats['whatsapp']} WhatsApp actions in one minute")
        if stats['searches'] >= 10:
            reasons.append(f"{stats['searches']} search events in one minute")
        if stats['last'].hour < 7 or stats['last'].hour > 23:
            reasons.append('unusual activity hour detected')
        if reasons:
            user = get_user(username) or {}
            alerts.append({'username': username, 'full_name': user.get('full_name', username), 'designation': user.get('designation', ''), 'risk': 'High' if len(reasons) >= 2 else 'Review', 'reason': '; '.join(reasons), 'last_seen': stats['last'].strftime('%Y-%m-%d %H:%M:%S')})
    alerts.sort(key=lambda x: (x['risk'] != 'High', x['full_name']))
    return alerts[:20]


def export_dataset_rows(dataset, user, filters=None):
    filters = filters or {}
    if dataset == 'client_pipeline':
        rows = []
        for lead in client_pipeline_rows(filters):
            rows.append({
                'Lead ID': lead.get('lead_id'),
                'Client': lead.get('client_name'),
                'Contact Person': lead.get('contact_person'),
                'Phone': display_phone_for_user(lead.get('contact_phone'), user),
                'City': lead.get('city'),
                'Industry': lead.get('industry'),
                'Status': lead.get('status'),
                'Priority': lead.get('priority'),
                'Openings': lead.get('openings_count'),
                'Open Requirements': lead.get('open_requirements'),
                'Next Follow Up': lead.get('next_follow_up_view'),
            })
        return rows
    if dataset == 'revenue_hub':
        rows = []
        for r in revenue_hub_rows(filters):
            rows.append({
                'Revenue ID': r.get('rev_id'),
                'Client': r.get('client_name'),
                'Candidate ID': r.get('candidate_id'),
                'Recruiter Code': r.get('recruiter_code'),
                'Billed': r.get('amount_billed_int'),
                'Collected': r.get('amount_collected_int'),
                'Outstanding': r.get('outstanding_int'),
                'Invoice Status': r.get('invoice_status'),
                'Billing Month': r.get('billing_month'),
                'Source': r.get('source_channel'),
            })
        return rows
    if dataset == 'performance_centre':
        rows = []
        for r in recruiter_performance_rows(filters.get('username','')):
            rows.append({
                'Name': r.get('full_name'),
                'Designation': r.get('designation'),
                'Recruiter Code': r.get('recruiter_code'),
                'Candidates': r.get('candidate_count'),
                'Open Tasks': r.get('open_tasks'),
                'Calls': r.get('calls'),
                'Updates': r.get('updates'),
                'Interviews': r.get('interviews'),
                'Billed': r.get('billed'),
                'Collected': r.get('collected'),
                'Last Seen': r.get('last_seen'),
                'Idle State': r.get('idle_state'),
            })
        return rows
    return []


def money_inr(value):
    return f"₹{parse_intish(value,0):,}"

@app.context_processor
def inject_money_helper_v14():
    return {'money_inr': money_inr}

@app.route('/client-pipeline')
@login_required
@manager_required
def client_pipeline_page():
    filters = {
        'q': request.args.get('q','').strip(),
        'status': request.args.get('status','').strip(),
        'city': request.args.get('city','').strip(),
    }
    leads = client_pipeline_rows(filters)
    requirements = safe_list_rows('client_requirements')
    total_openings = sum(parse_intish(l.get('openings_count'),0) for l in leads)
    active_clients = len([l for l in leads if (l.get('status') or '').lower() in {'active hiring','proposal sent','negotiation'}])
    hot_leads = len([l for l in leads if (l.get('priority') or '').lower() in {'critical','hot','high'}])
    fill_deadlines = sorted([r for r in requirements if (r.get('status') or '').lower() not in {'closed','filled'}], key=lambda x: x.get('fill_target_date') or '')[:6]
    log_page_activity('client_pipeline', filters)
    return render_template('client_pipeline.html', filters=filters, leads=leads, total_openings=total_openings, active_clients=active_clients, hot_leads=hot_leads, fill_deadlines=fill_deadlines)

@app.route('/revenue-hub')
@login_required
@manager_required
def revenue_hub_page():
    filters = {
        'billing_month': request.args.get('billing_month','').strip(),
        'client_name': request.args.get('client_name','').strip(),
        'invoice_status': request.args.get('invoice_status','').strip(),
    }
    rows = revenue_hub_rows(filters)
    billed = sum(r.get('amount_billed_int',0) for r in rows)
    collected = sum(r.get('amount_collected_int',0) for r in rows)
    outstanding = billed - collected
    by_client = {}
    by_source = {}
    for r in rows:
        by_client[r.get('client_name','Unknown')] = by_client.get(r.get('client_name','Unknown'), 0) + r.get('amount_billed_int',0)
        by_source[r.get('source_channel','Unknown')] = by_source.get(r.get('source_channel','Unknown'), 0) + r.get('amount_billed_int',0)
    client_breakdown = sorted([{'client_name':k,'amount':v} for k,v in by_client.items()], key=lambda x: -x['amount'])
    source_breakdown = sorted([{'source':k,'amount':v} for k,v in by_source.items()], key=lambda x: -x['amount'])
    log_page_activity('revenue_hub', filters)
    return render_template('revenue_hub.html', filters=filters, rows=rows, billed=billed, collected=collected, outstanding=outstanding, client_breakdown=client_breakdown, source_breakdown=source_breakdown)

@app.route('/performance-centre')
@login_required
@leadership_required
def performance_centre_page():
    user = current_user()
    selected_username = request.args.get('username','').strip()
    rows = recruiter_performance_rows(selected_username)
    alerts = suspicious_activity_alerts()
    total_calls = sum(r.get('calls',0) for r in rows)
    total_updates = sum(r.get('updates',0) for r in rows)
    total_interviews = sum(r.get('interviews',0) for r in rows)
    total_billed = sum(r.get('billed',0) for r in rows)
    people = [u for u in list_users() if normalize_role(u.get('role')) in {'recruiter','tl'}]
    people.sort(key=lambda x: (normalize_role(x.get('role')) != 'tl', x.get('full_name','')))
    log_page_activity('performance_centre', {'username': selected_username})
    return render_template('performance_centre.html', rows=rows, alerts=alerts, people=people, selected_username=selected_username, total_calls=total_calls, total_updates=total_updates, total_interviews=total_interviews, total_billed=total_billed, manager_role=normalize_role(user.get('role')) == 'manager')

@app.route('/manager-export/<dataset>')
@login_required
def manager_export_dataset(dataset):
    user = current_user()
    role = normalize_role((user or {}).get('role'))
    if dataset in {'client_pipeline','revenue_hub'} and role != 'manager':
        abort(403)
    if dataset == 'performance_centre' and role not in {'manager','tl'}:
        abort(403)
    file_format = (request.args.get('format') or 'xlsx').strip().lower()
    filters = dict(request.args)
    rows = export_dataset_rows(dataset, user, filters)
    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    ext = 'csv' if file_format == 'csv' else 'xlsx'
    filename = f"career_crox_{dataset}_{stamp}.{ext}"
    path = EXPORT_DIR / filename
    if ext == 'csv':
        write_csv(rows, path)
    else:
        write_xlsx(rows, path, title=dataset.replace('_',' ').title())
    log_activity(user, 'manager_export', metadata={'dataset': dataset, 'format': ext, 'rows': len(rows)})
    return redirect(url_for('download_report_file', filename=filename))

# app.run moved to the real end of file so all late patches/routes load in local mode too.

# === stability + speed + roles + quick add patch ===
PRIVILEGED_ROLES = {"manager", "tl"}
REPORT_ROLES = {"manager", "tl"}
UNLOCK_EXEMPT_ROLES = {"manager", "tl"}
INACTIVITY_LOCK_SECONDS = 5 * 60
NO_CALL_LOCK_SECONDS = 15 * 60
BREAK_OVERDUE_LOCK_SECONDS = 90

_old_get_backend_for_patch = get_backend

def get_backend():
    backend = _old_get_backend_for_patch()
    if getattr(backend, "_request_cache_wrapped", False):
        return backend
    raw_list_rows = backend.list_rows
    def cached_list_rows(table_name, *args, **kwargs):
        if args or kwargs:
            return raw_list_rows(table_name, *args, **kwargs)
        cache = getattr(g, "_row_cache", None)
        if cache is None:
            g._row_cache = {}
            cache = g._row_cache
        if table_name not in cache:
            cache[table_name] = [dict(r) for r in raw_list_rows(table_name)]
        return [dict(r) for r in cache[table_name]]
    backend._raw_list_rows = raw_list_rows
    backend.list_rows = cached_list_rows
    backend._request_cache_wrapped = True
    return backend


def invalidate_table_cache(*tables):
    cache = getattr(g, "_row_cache", None)
    if not cache:
        return
    for table in tables:
        cache.pop(table, None)


def list_users():
    if hasattr(g, "_users_cache"):
        return [dict(u) for u in g._users_cache]
    rows = get_backend().list_rows("users")
    normalized = []
    for row in rows:
        item = dict(row)
        item["role"] = normalize_role(item.get("role"))
        item["app_role"] = item["role"]
        item["theme_name"] = normalize_theme(item.get("theme_name"))
        item["is_active"] = "1" if to_boolish(item.get("is_active", "1")) else "0"
        normalized.append(item)
    g._users_cache = [dict(u) for u in normalized]
    return [dict(u) for u in normalized]


def user_map(by="username"):
    cache = getattr(g, "_user_map_cache", None)
    if cache is None:
        g._user_map_cache = {}
        cache = g._user_map_cache
    if by not in cache:
        cache[by] = {u.get(by): u for u in list_users() if u.get(by)}
    return {k: dict(v) for k, v in cache[by].items()}


def get_user(username):
    return user_map("username").get(username)


def find_user_by_recruiter_code(code):
    code = (code or "").strip()
    if not code:
        return None
    for user in list_users():
        if (user.get("recruiter_code") or "").strip() == code:
            return user
    return None


def enrich_candidates():
    if hasattr(g, "_enriched_candidates_cache"):
        return [dict(r) for r in g._enriched_candidates_cache]
    users_by_code = {u.get("recruiter_code"): u for u in list_users() if u.get("recruiter_code")}
    tl_users = [u for u in list_users() if u["role"] == "tl"]
    jds = get_backend().list_rows("jd_master")
    rows = get_backend().list_rows("candidates")
    enriched = []
    jd_by_company = {(j.get("company") or "").strip().lower(): dict(j) for j in jds if (j.get("company") or "").strip()}
    for row in rows:
        item = ensure_candidate_defaults(dict(row))
        item["code"] = item.get("candidate_id", "")
        item["jd_code"] = item.get("process", "")
        item["created_at"] = display_ts(item.get("created_at"))
        item["updated_at"] = display_ts(item.get("updated_at"))
        item["recruiter_code"] = item.get("recruiter_code", "")
        item["experience"] = item.get("experience") or item.get("total_experience") or ""
        user = users_by_code.get(item["recruiter_code"]) or {}
        item["recruiter_name"] = item.get("recruiter_name") or user.get("full_name", "")
        item["recruiter_designation"] = item.get("recruiter_designation") or user.get("designation", "")
        tl = tl_users[0] if tl_users else {}
        item["tl_name"] = tl.get("full_name", "")
        item["tl_username"] = tl.get("username", "")
        jd = jd_by_company.get((item.get("process") or "").strip().lower()) or {}
        item["jd_title"] = f"{jd.get('job_title')} • {jd.get('company')}" if jd else (item.get("process") or "")
        item["payout"] = jd.get("salary", "") if jd else ""
        item["jd_status"] = jd.get("jd_status") or "Open"
        enriched.append(item)
    g._enriched_candidates_cache = [dict(r) for r in enriched]
    return [dict(r) for r in enriched]


def candidate_map():
    if not hasattr(g, "_candidate_map_cache"):
        g._candidate_map_cache = {c["code"]: c for c in enrich_candidates() if c.get("code")}
    return {k: dict(v) for k, v in g._candidate_map_cache.items()}


def get_candidate(code):
    return candidate_map().get(code)


def _is_privileged(user):
    return normalize_role((user or {}).get("role")) in PRIVILEGED_ROLES


def approver_users_for(user):
    role = normalize_role((user or {}).get("role"))
    users = list_users()
    if role in UNLOCK_EXEMPT_ROLES:
        return []
    if role == "tl":
        return [u for u in users if normalize_role(u.get("role")) == "manager"]
    return [u for u in users if normalize_role(u.get("role")) in PRIVILEGED_ROLES]


def pending_unlock_requests_for(user):
    if not user:
        return []
    actor_role = normalize_role(user.get("role"))
    users_by_id = user_map("user_id")
    rows = []
    for row in get_backend().list_rows("unlock_requests") if "unlock_requests" in TABLE_COLUMNS else []:
        status = (row.get("status") or "").strip().lower()
        if status != "pending":
            continue
        target = users_by_id.get(row.get("user_id")) or {}
        target_role = normalize_role(target.get("role"))
        if actor_role == "manager" or (actor_role == "tl" and target_role == "recruiter"):
            item = dict(row)
            item["requester_name"] = target.get("full_name", row.get("user_id", ""))
            item["requester_role"] = target_role
            item["requester_designation"] = target.get("designation", "")
            rows.append(item)
    rows.sort(key=lambda x: x.get("requested_at", ""), reverse=True)
    return rows


def pending_submission_requests_for(user):
    if not user or normalize_role(user.get("role")) not in PRIVILEGED_ROLES:
        return []
    rows = []
    for row in get_backend().list_rows("submissions"):
        status = (row.get("approval_status") or row.get("status") or "").strip().lower()
        if status in {"pending approval", "pending review", "pending"}:
            rows.append(dict(row))
    rows.sort(key=lambda x: x.get("submitted_at", ""), reverse=True)
    return rows


def approval_requests_count_for(user):
    if normalize_role((user or {}).get("role")) not in PRIVILEGED_ROLES:
        return 0
    return len(pending_submission_requests_for(user)) + len(pending_unlock_requests_for(user))


def lock_reason_message(reason):
    reason = (reason or "").strip()
    if "Late return from break" in reason:
        return "Break khatam hone ke thodi der baad recruiter CRM auto-lock ho gaya. Unlock ke liye TL / Manager approval chahiye."
    if "No call dialed" in reason:
        return "15 minute tak koi call dial nahi hui, isliye recruiter CRM auto-lock ho gaya. Unlock ke liye TL / Manager approval chahiye."
    if "Inactivity" in reason:
        return "5 minute tak CRM activity nahi hui, isliye recruiter CRM auto-lock ho gaya. Unlock approval TL / Manager se hoga."
    return reason or "CRM locked. Unlock approval required."


def create_unlock_request_if_missing(user, reason):
    if not user or normalize_role(user.get("role")) in UNLOCK_EXEMPT_ROLES:
        return None
    existing = pending_unlock_request_for(user.get("user_id"))
    if existing:
        return existing
    row = {
        "request_id": next_prefixed_id("unlock_requests", "request_id", "UR"),
        "user_id": user.get("user_id"),
        "status": "Pending",
        "reason": reason,
        "requested_at": now_iso(),
        "approved_by_user_id": "",
        "approved_by_name": "",
        "approved_at": "",
    }
    get_backend().insert("unlock_requests", row)
    invalidate_table_cache("unlock_requests", "notifications")
    notify_users([u.get("user_id") for u in approver_users_for(user)], "Unlock request", f"{user.get('full_name')} ko unlock approval chahiye.", "attendance", {"user_id": user.get("user_id"), "reason": reason})
    return row


def force_lock_user(user, reason):
    if not user or normalize_role(user.get("role")) in UNLOCK_EXEMPT_ROLES:
        return False
    ensure_presence_rows()
    row = get_presence_for_user(user.get("user_id")) or {}
    if to_boolish(row.get("locked", "0")):
        create_unlock_request_if_missing(user, reason)
        return False
    values = {"locked": "1", "last_seen_at": now_iso()}
    if "break" in reason.lower():
        values.update({"is_on_break": "0", "break_reason": "", "break_started_at": "", "break_expected_end_at": ""})
    get_backend().update_where("presence", {"user_id": user.get("user_id")}, values)
    invalidate_table_cache("presence")
    create_unlock_request_if_missing(user, reason)
    log_activity(user, "crm_locked", metadata={"reason": reason})
    return True


def maybe_auto_lock_overdue_break_v6(user):
    role = normalize_role((user or {}).get("role"))
    if not user or role != "recruiter":
        return False
    row = get_presence_for_user(user.get("user_id")) or {}
    if not to_boolish(row.get("is_on_break", "0")) or not row.get("break_expected_end_at"):
        return False
    try:
        end_at = datetime.fromisoformat(str(row.get("break_expected_end_at")))
    except Exception:
        return False
    if (datetime.now() - end_at).total_seconds() < BREAK_OVERDUE_LOCK_SECONDS:
        return False
    return force_lock_user(user, "Late return from break auto-lock")


def maybe_auto_lock_inactive_v6(user):
    role = normalize_role((user or {}).get("role"))
    if not user or role != "recruiter":
        return False
    row = get_presence_for_user(user.get("user_id")) or {}
    if to_boolish(row.get("locked", "0")) or to_boolish(row.get("is_on_break", "0")):
        return False
    last_seen = row.get("last_seen_at") or row.get("work_started_at")
    if not last_seen:
        return False
    try:
        last_dt = datetime.fromisoformat(str(last_seen))
    except Exception:
        return False
    if (datetime.now() - last_dt).total_seconds() < INACTIVITY_LOCK_SECONDS:
        return False
    return force_lock_user(user, "Inactivity auto-lock")


def reset_stale_presence_on_login(user):
    if not user:
        return
    ensure_presence_rows()
    get_backend().update_where(
        "presence",
        {"user_id": user.get("user_id")},
        {
            "locked": "0",
            "is_on_break": "0",
            "break_reason": "",
            "break_started_at": "",
            "break_expected_end_at": "",
            "last_seen_at": now_iso(),
            "work_started_at": now_iso(),
        },
    )
    invalidate_table_cache("presence")


def _notification_fingerprint_exists(user_id, fingerprint):
    for row in get_backend().list_rows("notifications"):
        if row.get("user_id") != user_id:
            continue
        try:
            metadata = json.loads(row.get("metadata") or "{}")
        except Exception:
            metadata = {}
        if metadata.get("fingerprint") == fingerprint and (row.get("status") or "Unread") != "Read":
            return True
    return False


def maybe_emit_due_followup_notifications(user):
    if not user or normalize_role(user.get("role")) != "recruiter":
        return
    now = datetime.now()
    for cand in visible_candidates_rows(user):
        follow_at = parse_dt_safe(cand.get("follow_up_at"))
        if not follow_at:
            continue
        if (cand.get("follow_up_status") or "Open") in {"Completed", "Closed"}:
            continue
        delta = (now - follow_at).total_seconds()
        if delta < -60 or delta > 900:
            continue
        fingerprint = f"followup:{cand.get('candidate_id')}:{cand.get('follow_up_at')}"
        if _notification_fingerprint_exists(user.get("user_id"), fingerprint):
            continue
        notify_users([user.get("user_id")], "Follow-up reminder", f"{cand.get('full_name')} ka follow-up ab due hai.", "followup", {"candidate_id": cand.get("candidate_id"), "fingerprint": fingerprint, "follow_up_at": cand.get("follow_up_at")})
        invalidate_table_cache("notifications")


def upcoming_follow_up_for_user(user):
    if not user or normalize_role(user.get("role")) != "recruiter":
        return None
    now = datetime.now()
    rows = []
    for cand in visible_candidates_rows(user):
        follow_at = parse_dt_safe(cand.get("follow_up_at"))
        if not follow_at:
            continue
        if (cand.get("follow_up_status") or "Open") in {"Completed", "Closed"}:
            continue
        delta = (follow_at - now).total_seconds()
        if -180 <= delta <= 180:
            rows.append((abs(delta), cand))
    rows.sort(key=lambda x: x[0])
    return rows[0][1] if rows else None


def api_followups_upcoming_v2():
    cand = upcoming_follow_up_for_user(current_user())
    if not cand:
        return jsonify({"ok": False})
    return jsonify({"ok": True, "candidate_id": cand.get("candidate_id"), "full_name": cand.get("full_name"), "follow_up_at": cand.get("follow_up_at"), "follow_up_note": cand.get("follow_up_note"), "follow_up_status": cand.get("follow_up_status")})


def _candidate_update_values(candidate, form):
    looking_for_job = form.get("looking_for_job", "Yes").strip() or "Yes"
    preferred_locations = form.getlist("preferred_locations")
    other_pref = form.get("preferred_location_other", "").strip()
    if other_pref:
        preferred_locations.append(other_pref)
    preferred_location = ", ".join([p for p in preferred_locations if p])
    selected_processes = form.getlist("processes")
    extra_process = form.get("extra_process", "").strip()
    if extra_process:
        selected_processes.append(extra_process)
    process_string = ", ".join([p for p in dict.fromkeys([p for p in selected_processes if p])])
    total_exp = form.get("total_experience", "").strip()
    relevant_exp = form.get("relevant_experience", "").strip()
    interview_dt = parse_local_datetime(form.get("interview_reschedule_date", "").strip())
    values = ensure_candidate_defaults({
        **candidate,
        "call_connected": form.get("call_connected", "").strip(),
        "looking_for_job": looking_for_job,
        "full_name": form.get("full_name", "").strip(),
        "phone": form.get("phone", candidate.get("phone", "")).strip(),
        "qualification": form.get("qualification", "").strip(),
        "location": form.get("location", "").strip(),
        "preferred_location": preferred_location,
        "qualification_level": form.get("qualification_level", "").strip(),
        "total_experience": total_exp,
        "relevant_experience": relevant_exp,
        "in_hand_salary": form.get("in_hand_salary", "").strip(),
        "ctc_monthly": form.get("ctc_monthly", "").strip(),
        "career_gap": form.get("career_gap", "").strip(),
        "process": process_string,
        "status": form.get("status", "").strip() or candidate.get("status", "Eligible"),
        "all_details_sent": form.get("all_details_sent", "").strip() or candidate.get("all_details_sent", "Pending"),
        "submission_date": form.get("submission_date", "").strip() or candidate.get("submission_date") or datetime.now().strftime("%Y-%m-%d"),
        "interview_availability": form.get("interview_availability", "").strip(),
        "interview_reschedule_date": interview_dt,
        "follow_up_at": parse_local_datetime(form.get("follow_up_at", "").strip()),
        "follow_up_note": form.get("follow_up_note", "").strip(),
        "follow_up_status": form.get("follow_up_status", candidate.get("follow_up_status", "Open")).strip() or "Open",
        "updated_at": now_iso(),
    })
    values = {k: values.get(k, "") for k in TABLE_COLUMNS["candidates"]}
    return values, interview_dt


def update_candidate_v8(candidate_code):
    user = current_user()
    candidate = ensure_candidate_defaults(get_candidate(candidate_code) or {})
    if not candidate.get("candidate_id"):
        abort(404)
    if not candidate_visible_to_user(candidate, user):
        abort(403)
    try:
        values, interview_dt = _candidate_update_values(candidate, request.form)
        if values.get("looking_for_job") == "Yes" and (not values.get("full_name") or not values.get("phone") or not values.get("qualification") or not values.get("location")):
            flash("For job-seeking candidates, name, phone, qualification, and location are required.", "danger")
            return redirect(url_for("candidate_detail", candidate_code=candidate_code))
        get_backend().update_where("candidates", {"candidate_id": candidate_code}, values)
        invalidate_table_cache("candidates")

        note_body = request.form.get("note_body", "").strip()
        note_type = request.form.get("note_type", "public").strip() or "public"
        if note_body:
            get_backend().insert("notes", {
                "candidate_id": candidate_code,
                "username": user["username"],
                "note_type": note_type,
                "body": note_body,
                "created_at": now_iso(),
            })
            invalidate_table_cache("notes")
            try:
                if note_type == "public":
                    targets = [u.get("user_id") for u in manager_and_tl_users()]
                    owner = find_user_by_recruiter_code(values.get("recruiter_code"))
                    if owner:
                        targets.append(owner.get("user_id"))
                    notify_users(targets, f"Note updated: {values.get('full_name', candidate_code)}", f"{user.get('full_name')} added a note on {values.get('full_name', candidate_code)}.", "note", {"candidate_id": candidate_code})
                    invalidate_table_cache("notifications")
            except Exception:
                app.logger.exception("Public note notification failed for %s", candidate_code)

        if _is_privileged(user):
            owner = find_user_by_recruiter_code(values.get("recruiter_code"))
            if owner and owner.get("user_id") != user.get("user_id"):
                try:
                    notify_users([owner.get("user_id")], "Candidate profile updated", f"{values.get('full_name', candidate_code)} was updated by {user.get('full_name')}.", "candidate", {"candidate_id": candidate_code})
                    invalidate_table_cache("notifications")
                except Exception:
                    app.logger.exception("Owner notification failed for %s", candidate_code)

        if request.form.get("send_for_approval"):
            existing = existing_submission_for_candidate(candidate_code)
            jd_match = next((j for j in get_backend().list_rows("jd_master") if (j.get("company") or "").strip().lower() == ((values.get("process") or "").split(",")[0].strip().lower())), None)
            if existing:
                get_backend().update_where("submissions", {"submission_id": existing.get("submission_id")}, {
                    "jd_id": (jd_match or {}).get("jd_id", existing.get("jd_id", "")),
                    "status": values.get("status", "Submitted"),
                    "approval_status": "Pending Approval",
                    "approval_requested_at": now_iso(),
                    "submitted_at": values.get("submission_date"),
                })
            else:
                get_backend().insert("submissions", {
                    "submission_id": next_prefixed_id("submissions", "submission_id", "S"),
                    "candidate_id": candidate_code,
                    "jd_id": (jd_match or {}).get("jd_id", ""),
                    "recruiter_code": values.get("recruiter_code", ""),
                    "status": values.get("status", "Submitted"),
                    "approval_status": "Pending Approval",
                    "decision_note": "",
                    "approval_requested_at": now_iso(),
                    "approved_by_name": "",
                    "approved_at": "",
                    "approval_rescheduled_at": "",
                    "submitted_at": values.get("submission_date"),
                })
            get_backend().update_where("candidates", {"candidate_id": candidate_code}, {"approval_status": "Pending Approval", "approval_requested_at": now_iso(), "updated_at": now_iso()})
            invalidate_table_cache("candidates", "submissions", "notifications")
            try:
                notify_users([u.get("user_id") for u in manager_and_tl_users()], "Approval requested", f"{values.get('full_name', candidate_code)} has been sent for approval.", "submission", {"candidate_id": candidate_code})
            except Exception:
                app.logger.exception("Approval notification failed for %s", candidate_code)

        if interview_dt:
            existing_interview = next((i for i in get_backend().list_rows("interviews") if i.get("candidate_id") == candidate_code), None)
            jd_match = next((j for j in get_backend().list_rows("jd_master") if (j.get("company") or "").strip().lower() == ((values.get("process") or "").split(",")[0].strip().lower())), None)
            if existing_interview:
                get_backend().update_where("interviews", {"interview_id": existing_interview.get("interview_id")}, {"scheduled_at": interview_dt, "stage": values.get("status", "Interview Scheduled"), "status": "Scheduled"})
            else:
                get_backend().insert("interviews", {
                    "interview_id": next_prefixed_id("interviews", "interview_id", "I"),
                    "candidate_id": candidate_code,
                    "jd_id": (jd_match or {}).get("jd_id", ""),
                    "stage": values.get("status", "Interview Scheduled"),
                    "scheduled_at": interview_dt,
                    "status": "Scheduled",
                    "created_at": now_iso(),
                })
            invalidate_table_cache("interviews")

        log_activity(user, "candidate_updated", candidate_code, {"status": values.get("status")})
        flash("Candidate details updated successfully.", "success")
    except Exception:
        app.logger.exception("Candidate update failed for %s", candidate_code)
        flash("Candidate save failed because one value or linked record caused a conflict. Core data is safe. Please open once and save again.", "danger")
    return redirect(url_for("candidate_detail", candidate_code=candidate_code))


def attendance_breaks_v4():
    ensure_presence_rows()
    actor = current_user()
    actor_role = normalize_role((actor or {}).get("role"))
    users_by_id = user_map("user_id")
    rows = []
    for row in get_backend().list_rows("presence"):
        item = dict(row)
        user = users_by_id.get(item.get("user_id")) or {}
        if actor_role == "recruiter" and item.get("user_id") != actor.get("user_id"):
            continue
        item["full_name"] = user.get("full_name", item.get("user_id", ""))
        item["designation"] = user.get("designation", "")
        item["role"] = normalize_role(user.get("role", ""))
        item["is_on_break_bool"] = to_boolish(item.get("is_on_break", "0"))
        item["locked_bool"] = to_boolish(item.get("locked", "0"))
        item["last_seen_at_view"] = display_ts(item.get("last_seen_at"))
        item["work_started_at_view"] = display_ts(item.get("work_started_at"))
        item["break_expected_end_at_view"] = display_ts(item.get("break_expected_end_at"))
        rows.append(item)
    rows.sort(key=lambda x: (x.get("role", ""), x.get("full_name", "")))
    current_presence = get_presence_for_user(actor.get("user_id")) or {}
    if actor_role in PRIVILEGED_ROLES:
        unlock_requests = pending_unlock_requests_for(actor)
    else:
        unlock_requests = [dict(r) for r in get_backend().list_rows("unlock_requests") if r.get("user_id") == actor.get("user_id")]
        unlock_requests.sort(key=lambda x: x.get("requested_at", ""), reverse=True)
    return render_template("attendance.html", presence_rows=rows, current_presence=current_presence, break_options=BREAK_OPTIONS, unlock_requests=unlock_requests[:8], working_now=len([r for r in rows if not r.get("locked_bool")]), on_break_now=len([r for r in rows if r.get("is_on_break_bool")]), locked_now=len([r for r in rows if r.get("locked_bool")]))


def attendance_request_unlock_v4():
    user = current_user()
    if normalize_role(user.get("role")) in UNLOCK_EXEMPT_ROLES:
        flash("Manager / TL CRM par unlock approval apply nahi hota.", "info")
        return redirect(url_for("attendance_breaks"))
    reason = request.form.get("reason", "Unlock requested").strip() or "Unlock requested"
    create_unlock_request_if_missing(user, reason)
    get_backend().update_where("presence", {"user_id": user.get("user_id")}, {"locked": "1", "last_seen_at": now_iso()})
    invalidate_table_cache("presence", "unlock_requests", "notifications")
    flash("Unlock request sent to the approval team.", "success")
    return redirect(url_for("attendance_breaks"))


def attendance_ping_v4():
    if not session.get("username"):
        return jsonify({"ok": False}), 401
    user = current_user()
    ensure_presence_rows()
    if normalize_role(user.get("role")) not in UNLOCK_EXEMPT_ROLES:
        maybe_auto_lock_overdue_break_v6(user)
        maybe_auto_lock_inactive_v6(user)
        maybe_auto_lock_no_call_v6(user)
    presence = get_presence_for_user(user.get("user_id")) or {}
    if to_boolish(presence.get("locked", "0")):
        return jsonify({"ok": True, "locked": True})
    payload = request.get_json(silent=True) or {}
    get_backend().update_where("presence", {"user_id": user.get("user_id")}, {"last_seen_at": now_iso(), "last_page": payload.get("page", request.path)})
    invalidate_table_cache("presence")
    return jsonify({"ok": True, "locked": False})


def approvals_page_v2():
    user = current_user()
    if normalize_role(user.get("role")) not in PRIVILEGED_ROLES:
        abort(403)
    unlock_rows = pending_unlock_requests_for(user)
    submission_rows = []
    candidates_by_id = {c.get("candidate_id"): c for c in enrich_candidates()}
    jds_by_id = {j.get("jd_id"): j for j in get_backend().list_rows("jd_master")}
    for row in pending_submission_requests_for(user):
        item = dict(row)
        c = candidates_by_id.get(item.get("candidate_id"), {})
        jd = jds_by_id.get(item.get("jd_id"), {})
        item["full_name"] = c.get("full_name", item.get("candidate_id", ""))
        item["phone"] = c.get("phone", "")
        item["title"] = jd.get("job_title", c.get("process", ""))
        item["submitted_at_view"] = display_ts(item.get("submitted_at"))
        submission_rows.append(item)
    return render_template("approvals.html", unlock_requests=unlock_rows, submissions=submission_rows)


def tasks_v3():
    user = current_user()
    actor_role = normalize_role(user.get("role"))
    rows = []
    users_by_id = user_map("user_id")
    for t in get_backend().list_rows("tasks"):
        item = dict(t)
        assigned_user = users_by_id.get(item.get("assigned_to_user_id")) or {}
        item["full_name"] = assigned_user.get("full_name", item.get("assigned_to_name", ""))
        item["due_at"] = display_ts(item.get("due_date", ""))
        if actor_role not in PRIVILEGED_ROLES and item.get("assigned_to_user_id") != user.get("user_id"):
            continue
        rows.append(item)
    rows.sort(key=lambda x: x.get("due_at", ""))
    log_page_activity("tasks")
    return render_template("tasks.html", tasks=rows)


def create_task_v3():
    creator = current_user()
    if normalize_role(creator.get("role")) not in PRIVILEGED_ROLES:
        flash("Task create access sirf TL / Manager ke paas hai.", "danger")
        return redirect(url_for("tasks"))
    target = find_user_by_hint(request.form.get("assigned_to_username", ""))
    if not target:
        flash("Assigned username / name not found.", "danger")
        return redirect(url_for("tasks"))
    row = {
        "task_id": next_prefixed_id("tasks", "task_id", "T"),
        "title": request.form.get("title", "").strip(),
        "description": request.form.get("description", "").strip(),
        "assigned_to_user_id": target.get("user_id"),
        "assigned_to_name": target.get("full_name"),
        "assigned_by_user_id": creator.get("user_id"),
        "assigned_by_name": creator.get("full_name"),
        "status": request.form.get("status", "Open").strip() or "Open",
        "priority": request.form.get("priority", "Normal").strip() or "Normal",
        "due_date": parse_local_datetime(request.form.get("due_date", "")) or datetime.now().strftime("%Y-%m-%d %H:%M"),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    if not row["title"]:
        flash("Task title required.", "danger")
        return redirect(url_for("tasks"))
    get_backend().insert("tasks", row)
    invalidate_table_cache("tasks", "notifications")
    notify_users([target.get("user_id")], "Task assigned", row["title"], "task", {"task_id": row["task_id"]})
    log_activity(creator, "task_created", metadata={"task_id": row["task_id"], "assigned_to": target.get("username")})
    flash("Task added.", "success")
    return redirect(url_for("tasks"))


@app.route("/quick-note/create", methods=["POST"])
@login_required
def create_quick_note():
    user = current_user()
    candidate_id = request.form.get("candidate_id", "").strip()
    note_body = request.form.get("note_body", "").strip()
    note_type = request.form.get("note_type", "public").strip() or "public"
    candidate = ensure_candidate_defaults(get_candidate(candidate_id) or {})
    if not candidate.get("candidate_id"):
        flash("Candidate ID not found.", "danger")
        return redirect(url_for("dashboard"))
    if not candidate_visible_to_user(candidate, user):
        abort(403)
    if not note_body:
        flash("Note text required.", "danger")
        return redirect(url_for("candidate_detail", candidate_code=candidate_id))
    get_backend().insert("notes", {
        "candidate_id": candidate_id,
        "username": user.get("username"),
        "note_type": note_type,
        "body": note_body,
        "created_at": now_iso(),
    })
    invalidate_table_cache("notes", "notifications")
    if note_type == "public":
        owner = find_user_by_recruiter_code(candidate.get("recruiter_code"))
        targets = [u.get("user_id") for u in manager_and_tl_users()]
        if owner:
            targets.append(owner.get("user_id"))
        notify_users(targets, f"Quick note: {candidate.get('full_name', candidate_id)}", f"{user.get('full_name')} added a note.", "note", {"candidate_id": candidate_id})
    flash("Note added successfully.", "success")
    return redirect(url_for("candidate_detail", candidate_code=candidate_id))


def professional_create_candidate_v2():
    user = current_user()
    recruiter_code = request.form.get("recruiter_code", "").strip() or user.get("recruiter_code", "")
    owner = find_user_by_recruiter_code(recruiter_code) or user
    next_id = next_prefixed_id("candidates", "candidate_id", "C")
    total_exp = request.form.get("total_experience", request.form.get("experience", "")).strip()
    relevant_exp = request.form.get("relevant_experience", "").strip()
    in_hand = request.form.get("in_hand_salary", "").strip()
    looking_for_job = request.form.get("looking_for_job", "Yes").strip() or "Yes"
    preferred_locations = request.form.getlist("preferred_locations")
    other_pref = request.form.get("preferred_location_other", "").strip()
    if other_pref:
        preferred_locations.append(other_pref)
    preferred_location = ", ".join([p for p in preferred_locations if p])
    row = ensure_candidate_defaults({
        "candidate_id": next_id,
        "call_connected": request.form.get("call_connected", "").strip(),
        "looking_for_job": looking_for_job,
        "full_name": request.form.get("full_name", "").strip(),
        "phone": request.form.get("phone", "").strip(),
        "qualification": request.form.get("qualification", "").strip(),
        "location": request.form.get("location", "").strip(),
        "preferred_location": preferred_location,
        "qualification_level": request.form.get("qualification_level", "").strip(),
        "total_experience": total_exp,
        "relevant_experience": relevant_exp,
        "in_hand_salary": in_hand,
        "ctc_monthly": request.form.get("ctc_monthly", "").strip(),
        "career_gap": request.form.get("career_gap", "").strip(),
        "process": request.form.get("process", "").strip(),
        "recruiter_code": owner.get("recruiter_code", ""),
        "recruiter_name": owner.get("full_name", ""),
        "recruiter_designation": owner.get("designation", ""),
        "status": request.form.get("status", "Eligible").strip() or "Eligible",
        "all_details_sent": request.form.get("all_details_sent", "Pending").strip() or "Pending",
        "interview_availability": request.form.get("interview_availability", "").strip(),
        "interview_reschedule_date": request.form.get("interview_reschedule_date", "").strip(),
        "notes": request.form.get("notes", "").strip(),
        "approval_status": "Draft",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    })
    if looking_for_job == "Yes" and (not row.get("full_name") or not row.get("phone") or not row.get("qualification") or not row.get("location")):
        flash("For job-seeking candidates, name, phone, qualification, and location are required.", "danger")
        return redirect(url_for("candidates"))
    get_backend().insert("candidates", row)
    invalidate_table_cache("candidates", "notes", "notifications")
    if row.get("notes"):
        get_backend().insert("notes", {"candidate_id": next_id, "username": user.get("username"), "note_type": "public", "body": row.get("notes"), "created_at": now_iso()})
        invalidate_table_cache("notes")
    try:
        notify_users([owner.get("user_id")], "New candidate added", f"{row.get('full_name')} has been added to the CRM.", "candidate", {"candidate_id": next_id})
    except Exception:
        app.logger.exception("New candidate notification failed for %s", next_id)
    log_activity(user, "candidate_created", next_id, {"full_name": row.get("full_name")})
    flash(f"Candidate {row.get('full_name')} added successfully.", "success")
    return redirect(url_for("candidate_detail", candidate_code=next_id))


def professional_create_interview_v2():
    user = current_user()
    candidate_id = request.form.get("candidate_id", "").strip()
    candidate = ensure_candidate_defaults(get_candidate(candidate_id) or {})
    if not candidate.get("candidate_id") or not candidate_visible_to_user(candidate, user):
        flash("Candidate not found or not visible.", "danger")
        return redirect(url_for("interviews"))
    jd_id = request.form.get("jd_id", "").strip()
    stage = request.form.get("stage", "").strip() or "Interview Scheduled"
    scheduled_at = parse_local_datetime(request.form.get("scheduled_at", "").strip())
    if not candidate_id or not scheduled_at:
        flash("Candidate ID and interview date/time are required.", "danger")
        return redirect(url_for("interviews"))
    row = {
        "interview_id": next_prefixed_id("interviews", "interview_id", "I"),
        "candidate_id": candidate_id,
        "jd_id": jd_id,
        "stage": stage,
        "scheduled_at": scheduled_at,
        "status": request.form.get("status", "Scheduled").strip() or "Scheduled",
        "created_at": now_iso(),
    }
    get_backend().insert("interviews", row)
    get_backend().update_where("candidates", {"candidate_id": candidate_id}, {"status": stage, "interview_reschedule_date": scheduled_at, "updated_at": now_iso()})
    invalidate_table_cache("interviews", "candidates")
    flash(f"Interview scheduled for {candidate_id}.", "success")
    return redirect(url_for("interviews"))


def reports_page_v2():
    user = current_user()
    if normalize_role(user.get("role")) not in REPORT_ROLES:
        abort(403)
    return reports_page()


def generate_report_now_v2():
    user = current_user()
    if normalize_role(user.get("role")) not in REPORT_ROLES:
        abort(403)
    return generate_report_now()


def schedule_report_v2():
    user = current_user()
    if normalize_role(user.get("role")) not in REPORT_ROLES:
        abort(403)
    return schedule_report()


def download_report_file_v2(filename):
    user = current_user()
    if normalize_role(user.get("role")) not in REPORT_ROLES:
        abort(403)
    return send_from_directory(str(EXPORT_DIR), filename, as_attachment=True)


def module_page_v2(slug):
    user = current_user()
    role = normalize_role((user or {}).get("role"))
    if slug in {"reports"} and role not in REPORT_ROLES:
        abort(403)
    if slug in {"wallet-rewards", "payout-tracker"} and role != "manager":
        abort(403)
    return module_page(slug)


def _soft_page_limit(rows, default_limit=120):
    rows = [dict(r) for r in rows]
    if request.args.get("show") == "all":
        return rows
    try:
        limit = max(50, min(500, int(request.args.get("limit", default_limit))))
    except Exception:
        limit = default_limit
    return rows[:limit]

# replace old before_request guard with TL-safe version
try:
    funcs = app.before_request_funcs.get(None, [])
    app.before_request_funcs[None] = [f for f in funcs if getattr(f, "__name__", "") != "final_security_scope_tick"]
except Exception:
    pass

@app.before_request
def final_security_scope_tick_v2():
    if request.endpoint in {None, "static", "login", "health"}:
        return None
    if not session.get("username"):
        return None
    user = current_user()
    if not user:
        return None
    maybe_emit_due_followup_notifications(user)
    ensure_presence_rows()
    if normalize_role(user.get("role")) not in UNLOCK_EXEMPT_ROLES:
        maybe_auto_lock_overdue_break_v6(user)
        maybe_auto_lock_inactive_v6(user)
        maybe_auto_lock_no_call_v6(user)
        locked = get_presence_for_user(user.get("user_id")) or {}
        if to_boolish(locked.get("locked", "0")):
            allowed = {"attendance_breaks", "attendance_request_unlock", "attendance_unlock_decision", "attendance_ping", "notifications_page", "approvals_page", "logout", "stop_impersonation", "admin_page", "impersonate_login"}
            if request.endpoint not in allowed:
                flash("CRM is locked. Please request unlock approval first.", "danger")
                return redirect(url_for("attendance_breaks"))
    return None

app.view_functions["api_followups_upcoming"] = login_required(api_followups_upcoming_v2)
app.view_functions["update_candidate"] = login_required(update_candidate_v8)
app.view_functions["attendance_breaks"] = login_required(attendance_breaks_v4)
app.view_functions["attendance_request_unlock"] = login_required(attendance_request_unlock_v4)
app.view_functions["attendance_ping"] = attendance_ping_v4
app.view_functions["approvals_page"] = login_required(approvals_page_v2)
app.view_functions["tasks"] = login_required(tasks_v3)
app.view_functions["create_task"] = login_required(create_task_v3)
app.view_functions["create_candidate"] = login_required(professional_create_candidate_v2)
app.view_functions["create_interview"] = login_required(professional_create_interview_v2)
app.view_functions["reports_page"] = login_required(reports_page_v2)
app.view_functions["generate_report_now"] = login_required(generate_report_now_v2)
app.view_functions["schedule_report"] = login_required(schedule_report_v2)
app.view_functions["download_report_file"] = login_required(download_report_file_v2)
app.view_functions["module_page"] = login_required(module_page_v2)



# === dialer popup + recruiter visibility patch ===
DIALER_OUTCOME_OPTIONS = ["Connected", "Not Picked", "Busy", "Switched Off", "Wrong Number", "Callback"]

def display_phone_for_user(phone, user=None):
    digits = normalize_phone(phone)
    role = normalize_role((user or {}).get("role"))
    if not digits:
        return ""
    if role in {"manager", "tl", "admin"}:
        return digits
    if len(digits) <= 2:
        return digits
    return f"{'#' * max(0, len(digits) - 2)}{digits[-2:]}"


def visible_recruiter_codes_for(user):
    role = normalize_role((user or {}).get("role"))
    if role in {"manager", "tl", "admin"}:
        return {u.get("recruiter_code") for u in list_users() if normalize_role(u.get("role")) == "recruiter" and u.get("recruiter_code")}
    my_code = ((user or {}).get("recruiter_code") or "").strip()
    return {my_code, ""} if my_code else {""}


def candidate_visible_to_user(candidate, user):
    if not user:
        return False
    role = normalize_role(user.get("role"))
    if role in {"manager", "tl", "admin"}:
        return True
    assigned_code = (candidate.get("recruiter_code") or "").strip()
    my_code = (user.get("recruiter_code") or "").strip()
    return (not assigned_code) or assigned_code == my_code


def _dialer_duration_label(seconds):
    sec = max(0, parse_intish(seconds, 0))
    return f"{sec // 60:02d}:{sec % 60:02d}"


def _dialer_connected_value(outcome):
    low = (outcome or "").strip().lower()
    if low == "connected":
        return "Yes"
    if low == "callback":
        return "Partially"
    if low:
        return "No"
    return ""


def _dialer_note_body(outcome, duration_seconds, note):
    bits = ["Dialer call"]
    if outcome:
        bits.append(f"Status: {outcome}")
    if parse_intish(duration_seconds, 0):
        bits.append(f"Duration: {_dialer_duration_label(duration_seconds)}")
    body = " | ".join(bits)
    clean_note = (note or "").strip()
    if clean_note:
        body += f" | Note: {clean_note}"
    return body


@app.route('/api/dialer/call/end', methods=['POST'])
@login_required
def api_dialer_call_end():
    payload = request.get_json(silent=True) or request.form.to_dict(flat=True)
    candidate_id = (payload.get('candidate_id') or '').strip()
    candidate = ensure_candidate_defaults(get_candidate(candidate_id) or parse_candidate_hint(candidate_id) or {})
    user = current_user()
    if not candidate.get('candidate_id'):
        return jsonify({'ok': False, 'message': 'Candidate not found.'}), 404
    if not candidate_visible_to_user(candidate, user):
        return jsonify({'ok': False, 'message': 'Candidate is not visible to this user.'}), 403
    outcome = (payload.get('outcome') or 'Not Picked').strip()
    duration_seconds = parse_intish(payload.get('duration_seconds'), 0)
    note = (payload.get('note') or '').strip()
    connected_value = _dialer_connected_value(outcome)
    try:
        get_backend().update_where('candidates', {'candidate_id': candidate.get('candidate_id')}, {
            'call_connected': connected_value,
            'updated_at': now_iso(),
        })
        note_body = _dialer_note_body(outcome, duration_seconds, note)
        get_backend().insert('notes', {
            'candidate_id': candidate.get('candidate_id'),
            'username': user.get('username'),
            'note_type': 'public',
            'body': note_body,
            'created_at': now_iso(),
        })
        log_activity(user, 'dialer_call_ended', candidate.get('candidate_id'), {
            'outcome': outcome,
            'duration_seconds': duration_seconds,
            'duration_label': _dialer_duration_label(duration_seconds),
            'note_preview': note[:140],
        })
        invalidate_table_cache('candidates', 'notes', 'activity_log')
    except Exception:
        app.logger.exception('Dialer call end save failed for %s', candidate.get('candidate_id'))
        return jsonify({'ok': False, 'message': 'Call save failed on server.'}), 500
    return jsonify({'ok': True, 'message': f"{candidate.get('full_name')} ki call {outcome} ke saath save ho gayi. Duration {_dialer_duration_label(duration_seconds)}."})


@app.route('/api/dialer/note', methods=['POST'])
@login_required
def api_dialer_note():
    payload = request.get_json(silent=True) or request.form.to_dict(flat=True)
    candidate_id = (payload.get('candidate_id') or '').strip()
    candidate = ensure_candidate_defaults(get_candidate(candidate_id) or parse_candidate_hint(candidate_id) or {})
    user = current_user()
    if not candidate.get('candidate_id'):
        return jsonify({'ok': False, 'message': 'Candidate not found.'}), 404
    if not candidate_visible_to_user(candidate, user):
        return jsonify({'ok': False, 'message': 'Candidate is not visible to this user.'}), 403
    note = (payload.get('note') or '').strip()
    outcome = (payload.get('outcome') or '').strip()
    if not note:
        return jsonify({'ok': False, 'message': 'Khali note save nahi hoga.'}), 400
    body = f"Dialer note{' • ' + outcome if outcome else ''}: {note}"
    try:
        get_backend().insert('notes', {
            'candidate_id': candidate.get('candidate_id'),
            'username': user.get('username'),
            'note_type': 'public',
            'body': body,
            'created_at': now_iso(),
        })
        log_activity(user, 'dialer_note_saved', candidate.get('candidate_id'), {
            'outcome': outcome,
            'note_preview': note[:140],
        })
        invalidate_table_cache('notes', 'activity_log')
    except Exception:
        app.logger.exception('Dialer note save failed for %s', candidate.get('candidate_id'))
        return jsonify({'ok': False, 'message': 'Note server par save nahi hua.'}), 500
    return jsonify({'ok': True, 'message': f"{candidate.get('full_name')} ka note save ho gaya."})


def professional_candidate_detail_v6(candidate_code):
    user = current_user()
    candidate = ensure_candidate_defaults(get_candidate(candidate_code) or {})
    if not candidate.get('candidate_id'):
        abort(404)
    if not candidate_visible_to_user(candidate, user):
        abort(403)
    history = visible_notes(candidate_code, user)
    related_notifications = user_notifications(user, candidate_code=candidate_code)[:8]
    timeline = []
    submission_row = existing_submission_for_candidate(candidate_code)
    for s in get_backend().list_rows('submissions'):
        if s.get('candidate_id') == candidate_code:
            timeline.append({'event_type': 'Submission', 'label': s.get('approval_status') or s.get('status', ''), 'event_time': display_ts(s.get('submitted_at')), 'jd_code': s.get('jd_id', ''), 'owner': s.get('recruiter_code', ''), '_sort': s.get('submitted_at') or ''})
    for i in get_backend().list_rows('interviews'):
        if i.get('candidate_id') == candidate_code:
            timeline.append({'event_type': 'Interview', 'label': i.get('status', ''), 'event_time': display_ts(i.get('scheduled_at')), 'jd_code': i.get('jd_id', ''), 'owner': '', '_sort': i.get('scheduled_at') or ''})
    for a in get_backend().list_rows('activity_log'):
        if a.get('candidate_id') != candidate_code:
            continue
        action = (a.get('action_type') or '').strip()
        meta = safe_json_loads(a.get('metadata'), {})
        created_at = a.get('created_at') or ''
        if action in {'manual_call', 'aaria_call'}:
            timeline.append({'event_type': 'Call', 'label': 'Call dialed', 'event_time': display_ts(created_at), 'jd_code': '', 'owner': a.get('username', ''), '_sort': created_at})
        elif action == 'dialer_call_ended':
            label = (meta.get('outcome') or 'Call ended').strip()
            duration_label = (meta.get('duration_label') or '').strip()
            if duration_label:
                label = f"{label} • {duration_label}"
            timeline.append({'event_type': 'Call', 'label': label, 'event_time': display_ts(created_at), 'jd_code': meta.get('note_preview', ''), 'owner': a.get('username', ''), '_sort': created_at})
        elif action in {'manual_whatsapp', 'aaria_whatsapp'}:
            timeline.append({'event_type': 'WhatsApp', 'label': 'WhatsApp opened', 'event_time': display_ts(created_at), 'jd_code': '', 'owner': a.get('username', ''), '_sort': created_at})
        elif action == 'dialer_note_saved':
            timeline.append({'event_type': 'Note', 'label': f"Call note saved{' • ' + meta.get('outcome') if meta.get('outcome') else ''}", 'event_time': display_ts(created_at), 'jd_code': meta.get('note_preview', ''), 'owner': a.get('username', ''), '_sort': created_at})
    timeline.sort(key=lambda x: x.get('_sort', ''), reverse=True)
    for item in timeline:
        item.pop('_sort', None)
    jd_choices = [dict(j) for j in get_backend().list_rows('jd_master')]
    process_options = sorted({j.get('company', '') for j in jd_choices if j.get('company')})
    return render_template(
        'candidate_detail.html',
        candidate=candidate,
        note_history=history,
        related_notifications=related_notifications,
        timeline=timeline,
        submission_row=submission_row,
        status_options=CANDIDATE_STATUS_OPTIONS,
        call_connected_options=CALL_CONNECTED_OPTIONS,
        looking_for_job_options=LOOKING_FOR_JOB_OPTIONS,
        degree_options=DEGREE_OPTIONS,
        career_gap_options=CAREER_GAP_OPTIONS,
        interview_availability_options=INTERVIEW_AVAILABILITY_OPTIONS,
        all_details_sent_options=ALL_DETAILS_SENT_OPTIONS,
        primary_locations=PRIMARY_LOCATIONS,
        additional_locations=ADDITIONAL_LOCATIONS,
        process_options=process_options,
        jd_choices=jd_choices,
        interview_dt_local=to_datetime_local(candidate.get('interview_reschedule_date')),
        follow_up_dt_local=to_datetime_local(candidate.get('follow_up_at')),
    )


app.view_functions['candidate_detail'] = login_required(professional_candidate_detail_v6)


# === final local/dev stability patch ===
OPTIONAL_RUNTIME_TABLES = {
    "active_sessions",
    "presence",
    "unlock_requests",
    "activity_log",
    "scheduled_reports",
    "aaria_queue",
    "client_pipeline",
    "client_requirements",
    "revenue_entries",
}


def _clear_runtime_table_cache(*tables):
    try:
        invalidate_table_cache(*tables)
    except Exception:
        cache = getattr(g, "_row_cache", None)
        if cache:
            for table in tables:
                cache.pop(table, None)


def _build_runtime_safe_backend(backend):
    if getattr(backend, "_runtime_safe_wrapped", False):
        return backend

    raw_list_rows = backend.list_rows
    raw_insert = getattr(backend, "insert", None)
    raw_bulk_insert = getattr(backend, "bulk_insert", None)
    raw_update_where = getattr(backend, "update_where", None)
    raw_delete_where = getattr(backend, "delete_where", None)

    def runtime_safe_list_rows(table_name, *args, **kwargs):
        cache = getattr(g, "_row_cache", None)
        use_cache = not args and not kwargs
        if use_cache:
            if cache is None:
                g._row_cache = {}
                cache = g._row_cache
            if table_name in cache:
                return [dict(r) for r in cache[table_name]]
        try:
            rows = raw_list_rows(table_name, *args, **kwargs)
            rows = [dict(r) for r in rows]
            if use_cache:
                cache[table_name] = [dict(r) for r in rows]
            return rows
        except Exception as exc:
            if table_name == "active_sessions":
                username = session.get("username")
                session_token = session.get("session_token")
                if username and session_token:
                    return [{
                        "username": username,
                        "session_token": session_token,
                        "ip_address": "",
                        "user_agent": "",
                        "updated_at": now_iso(),
                    }]
                app.logger.warning("active_sessions unavailable, continuing without strict device lock: %s", exc)
                return []
            if table_name in OPTIONAL_RUNTIME_TABLES:
                app.logger.warning("Optional table %s unavailable, continuing safely: %s", table_name, exc)
                return []
            raise

    def runtime_safe_insert(table_name, row):
        try:
            _clear_runtime_table_cache(table_name)
            return raw_insert(table_name, row)
        except Exception as exc:
            if table_name in OPTIONAL_RUNTIME_TABLES:
                app.logger.warning("Optional insert skipped for %s: %s", table_name, exc)
                return None
            raise

    def runtime_safe_bulk_insert(table_name, rows):
        try:
            _clear_runtime_table_cache(table_name)
            return raw_bulk_insert(table_name, rows)
        except Exception as exc:
            if table_name in OPTIONAL_RUNTIME_TABLES:
                app.logger.warning("Optional bulk insert skipped for %s: %s", table_name, exc)
                return None
            raise

    def runtime_safe_update_where(table_name, filters, values):
        try:
            _clear_runtime_table_cache(table_name)
            return raw_update_where(table_name, filters, values)
        except Exception as exc:
            if table_name in OPTIONAL_RUNTIME_TABLES:
                app.logger.warning("Optional update skipped for %s: %s", table_name, exc)
                return None
            raise

    def runtime_safe_delete_where(table_name, filters):
        try:
            _clear_runtime_table_cache(table_name)
            return raw_delete_where(table_name, filters)
        except Exception as exc:
            if table_name in OPTIONAL_RUNTIME_TABLES:
                app.logger.warning("Optional delete skipped for %s: %s", table_name, exc)
                return None
            raise

    backend.list_rows = runtime_safe_list_rows
    if raw_insert:
        backend.insert = runtime_safe_insert
    if raw_bulk_insert:
        backend.bulk_insert = runtime_safe_bulk_insert
    if raw_update_where:
        backend.update_where = runtime_safe_update_where
    if raw_delete_where:
        backend.delete_where = runtime_safe_delete_where
    backend._runtime_safe_wrapped = True
    return backend


_SQLITE_FALLBACK_LOGGED = False

def get_backend():
    global _SQLITE_FALLBACK_LOGGED
    backend = getattr(g, "backend", None)
    if backend is not None:
        return _build_runtime_safe_backend(backend)

    if USE_SUPABASE:
        try:
            backend = SupabaseBackend(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
            probe_rows = backend.list_rows("users")
            if not isinstance(probe_rows, list):
                raise RuntimeError("Supabase probe returned invalid response for users table")
            g.backend = _build_runtime_safe_backend(backend)
            return g.backend
        except Exception as exc:
            if not _SQLITE_FALLBACK_LOGGED:
                app.logger.warning("Supabase unavailable or incomplete. Falling back to local SQLite preview: %s", exc)
                _SQLITE_FALLBACK_LOGGED = True

    g.backend = _build_runtime_safe_backend(SQLiteBackend(DB_PATH, SEED_FILE))
    return g.backend


_prev_notify_users_final = notify_users

def notify_users(user_ids, title, message, category="info", metadata=None):
    try:
        return _prev_notify_users_final(user_ids, title, message, category, metadata)
    except Exception as exc:
        app.logger.warning("Notification write skipped: %s", exc)
        return None


_prev_log_activity_final = log_activity

def log_activity(user, action_type, candidate_id="", metadata=None):
    try:
        return _prev_log_activity_final(user or {}, action_type, candidate_id, metadata)
    except Exception as exc:
        app.logger.warning("Activity log skipped: %s", exc)
        return None


def ensure_presence_rows():
    try:
        existing = {r.get("user_id"): r for r in get_backend().list_rows("presence")}
        for user in list_users():
            if user.get("user_id") not in existing:
                get_backend().insert("presence", {
                    "user_id": user.get("user_id"),
                    "last_seen_at": now_iso(),
                    "last_page": "dashboard",
                    "is_on_break": "0",
                    "break_reason": "",
                    "break_started_at": "",
                    "break_expected_end_at": "",
                    "total_break_minutes": "0",
                    "locked": "0",
                    "last_call_dial_at": "",
                    "last_call_candidate_id": "",
                    "last_call_alert_sent_at": "",
                    "meeting_joined": "0",
                    "meeting_joined_at": "",
                    "screen_sharing": "0",
                    "screen_frame_url": "",
                    "last_screen_frame_at": "",
                    "work_started_at": "",
                    "total_work_minutes": "0",
                })
    except Exception as exc:
        app.logger.warning("Presence sync skipped: %s", exc)


def get_presence_for_user(user_id):
    try:
        ensure_presence_rows()
        return next((dict(r) for r in get_backend().list_rows("presence") if r.get("user_id") == user_id), None)
    except Exception:
        return None


def reset_stale_presence_on_login(user):
    try:
        if not user or normalize_role(user.get("role")) == "manager":
            return
        ensure_presence_rows()
        get_backend().update_where(
            "presence",
            {"user_id": user.get("user_id")},
            {
                "locked": "0",
                "is_on_break": "0",
                "break_reason": "",
                "break_started_at": "",
                "break_expected_end_at": "",
                "last_seen_at": now_iso(),
                "work_started_at": now_iso(),
            },
        )
    except Exception as exc:
        app.logger.warning("Presence reset skipped during login: %s", exc)


def clear_active_session(username):
    if not username:
        return
    try:
        get_backend().delete_where("active_sessions", {"username": username})
    except Exception as exc:
        app.logger.warning("Active session clear skipped for %s: %s", username, exc)


def create_active_session(username, session_token, req=None):
    if not username:
        return False
    req = req or request
    try:
        get_backend().insert("active_sessions", {
            "username": username,
            "session_token": session_token,
            "ip_address": req.headers.get("X-Forwarded-For", req.remote_addr or ""),
            "user_agent": (req.headers.get("User-Agent", "")[:255]),
            "updated_at": now_iso(),
        })
        return True
    except Exception as exc:
        app.logger.warning("Active session create skipped for %s: %s", username, exc)
        return False


def touch_active_session(username, req=None):
    if not username:
        return False
    req = req or request
    try:
        get_backend().update_where("active_sessions", {"username": username}, {
            "ip_address": req.headers.get("X-Forwarded-For", req.remote_addr or ""),
            "user_agent": (req.headers.get("User-Agent", "")[:255]),
            "updated_at": now_iso(),
        })
        return True
    except Exception as exc:
        app.logger.warning("Active session touch skipped for %s: %s", username, exc)
        return False


@app.errorhandler(500)
def _final_internal_server_error(err):
    app.logger.exception("Unhandled server error: %s", err)
    try:
        return render_template_string(
            """
            <!doctype html>
            <html lang="en">
            <head><meta charset="utf-8"><title>Server issue</title></head>
            <body style="font-family:Arial,sans-serif;background:#f6f8fb;padding:32px;">
                <div style="max-width:720px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.08);">
                    <h2 style="margin-top:0;">Server issue</h2>
                    <p>App ne ek error hit kiya, but crash karke chup baithna koi achievement nahi hai.</p>
                    <p>Data folder ke andar <strong>flask_error.log</strong> check karo. Agar Supabase use kar rahe ho, latest SQL patch bhi run karo.</p>
                    <p><a href="{{ url_for('login') }}">Back to login</a></p>
                </div>
            </body>
            </html>
            """
        ), 500
    except Exception:
        return "Server issue. Check data/flask_error.log", 500


try:
    from logging.handlers import RotatingFileHandler
    import logging
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _error_log_path = DATA_DIR / "flask_error.log"
    if not any(getattr(h, "baseFilename", None) == str(_error_log_path) for h in app.logger.handlers):
        _file_handler = RotatingFileHandler(_error_log_path, maxBytes=750000, backupCount=3, encoding="utf-8")
        _file_handler.setLevel(logging.WARNING)
        _file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        app.logger.addHandler(_file_handler)
except Exception:
    pass


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
