"""SQLite storage. Times are stored as UTC ISO-8601 strings."""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS reference_posts (
    id TEXT PRIMARY KEY,
    keyword TEXT NOT NULL,
    text TEXT NOT NULL,
    permalink TEXT,
    username TEXT,
    posted_at TEXT,
    collected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    hook_text TEXT NOT NULL,
    comment_body TEXT NOT NULL,
    rationale TEXT,
    product_name TEXT NOT NULL,
    product_url TEXT NOT NULL,
    product_price INTEGER,
    affiliate_rate REAL,
    status TEXT NOT NULL DEFAULT 'pending',
    used_confirmed INTEGER NOT NULL DEFAULT 0,
    scheduled_at TEXT,
    published_post_id TEXT,
    published_reply_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
    draft_id INTEGER NOT NULL REFERENCES drafts(id),
    collected_at TEXT NOT NULL,
    views INTEGER, likes INTEGER, replies INTEGER, reposts INTEGER, quotes INTEGER
);
"""

# pending -> approved -> published / failed ; pending -> rejected
STATUSES = ("pending", "approved", "rejected", "published", "failed")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: str) -> sqlite3.Connection:
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def save_reference_posts(conn, keyword: str, posts: list[dict]) -> int:
    added = 0
    for p in posts:
        if not p.get("text"):
            continue
        cur = conn.execute(
            "INSERT OR IGNORE INTO reference_posts (id, keyword, text, permalink, username, posted_at, collected_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (p["id"], keyword, p["text"], p.get("permalink"), p.get("username"), p.get("timestamp"), now_iso()),
        )
        added += cur.rowcount
    conn.commit()
    return added


def recent_reference_posts(conn, keyword: str, limit: int = 15) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM reference_posts WHERE keyword = ? ORDER BY collected_at DESC LIMIT ?",
        (keyword, limit),
    ).fetchall()


def insert_draft(conn, **fields) -> int:
    ts = now_iso()
    fields = {**fields, "created_at": ts, "updated_at": ts}
    cols = ", ".join(fields)
    marks = ", ".join("?" for _ in fields)
    cur = conn.execute(f"INSERT INTO drafts ({cols}) VALUES ({marks})", tuple(fields.values()))
    conn.commit()
    return cur.lastrowid


def get_draft(conn, draft_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()


def update_draft(conn, draft_id: int, **fields) -> None:
    fields["updated_at"] = now_iso()
    sets = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(f"UPDATE drafts SET {sets} WHERE id = ?", (*fields.values(), draft_id))
    conn.commit()


def drafts_by_status(conn, status: str, limit: int = 50) -> list[sqlite3.Row]:
    order = "scheduled_at" if status == "approved" else "updated_at DESC"
    return conn.execute(
        f"SELECT * FROM drafts WHERE status = ? ORDER BY {order} LIMIT ?", (status, limit)
    ).fetchall()


def due_drafts(conn, now: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM drafts WHERE status = 'approved' AND scheduled_at <= ? ORDER BY scheduled_at",
        (now,),
    ).fetchall()


def published_count_since(conn, since: str) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM drafts WHERE status = 'published' AND updated_at >= ?", (since,)
    ).fetchone()[0]


def save_metrics(conn, draft_id: int, m: dict) -> None:
    conn.execute(
        "INSERT INTO metrics (draft_id, collected_at, views, likes, replies, reposts, quotes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (draft_id, now_iso(), m.get("views"), m.get("likes"), m.get("replies"), m.get("reposts"), m.get("quotes")),
    )
    conn.commit()


def latest_metrics(conn, draft_id: int) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM metrics WHERE draft_id = ? ORDER BY collected_at DESC LIMIT 1", (draft_id,)
    ).fetchone()
