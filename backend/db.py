from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Any

from .shared import DATABASE_URL, DB_DIR, DB_PATH, IS_POSTGRES, POSTGRES_SCHEMA_PATH, SCHEMA_PATH

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - handled by runtime environment
    psycopg = None
    dict_row = None


TABLES_WITH_SERIAL_IDS = {
    "users",
    "profile_verification_tokens",
    "password_reset_tokens",
    "task_templates",
    "task_template_subtasks",
    "tasks",
    "subtasks",
    "subtask_requirement_submissions",
    "completed_tasks",
    "messages",
    "private_conversations",
    "private_messages",
    "task_attachments",
    "activity_log",
}


def _replace_qmark_placeholders(sql: str) -> str:
    parts = sql.split("?")
    if len(parts) == 1:
        return sql
    return "%s".join(parts)


def _translate_postgres_sql(sql: str) -> tuple[str, bool]:
    translated = str(sql or "").strip().rstrip(";")
    ignore_insert = bool(re.match(r"^\s*INSERT\s+OR\s+IGNORE\s+INTO\b", translated, re.IGNORECASE))
    translated = re.sub(
        r"INSERT\s+OR\s+IGNORE\s+INTO",
        "INSERT INTO",
        translated,
        flags=re.IGNORECASE,
    )
    translated = re.sub(
        r"(\b[\w\.]+)\s*=\s*\?\s+COLLATE\s+NOCASE",
        r"\1 ILIKE ?",
        translated,
        flags=re.IGNORECASE,
    )
    translated = re.sub(
        r"(\b[\w\.]+)\s+COLLATE\s+NOCASE(?:\s+(ASC|DESC))?",
        lambda match: f"LOWER({match.group(1)}) {match.group(2) or ''}".rstrip(),
        translated,
        flags=re.IGNORECASE,
    )
    translated = re.sub(
        r"datetime\(\s*'now'\s*,\s*'-7 days'\s*\)",
        "(CURRENT_TIMESTAMP - INTERVAL '7 days')",
        translated,
        flags=re.IGNORECASE,
    )
    translated = re.sub(
        r"datetime\(\s*'now'\s*\)",
        "CURRENT_TIMESTAMP",
        translated,
        flags=re.IGNORECASE,
    )
    translated = re.sub(
        r"datetime\(([^()]+)\)",
        lambda match: f"CAST(NULLIF({match.group(1).strip()}, '') AS timestamptz)",
        translated,
        flags=re.IGNORECASE,
    )
    translated = _replace_qmark_placeholders(translated)
    return translated, ignore_insert


class PostgresCursorCompat:
    def __init__(self, cursor: Any, *, lastrowid: int | None = None, prefetched_row: dict[str, Any] | None = None):
        self._cursor = cursor
        self.lastrowid = lastrowid
        self._prefetched_row = prefetched_row

    def fetchone(self) -> dict[str, Any] | None:
        if self._prefetched_row is not None:
            row = self._prefetched_row
            self._prefetched_row = None
            return row
        return self._cursor.fetchone()

    def fetchall(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        if self._prefetched_row is not None:
            rows.append(self._prefetched_row)
            self._prefetched_row = None
        rows.extend(self._cursor.fetchall())
        return rows


class SQLiteConnectionCompat:
    def __init__(self, connection: sqlite3.Connection):
        self._conn = connection

    def execute(self, sql: str, params: tuple[Any, ...] | list[Any] | None = None) -> sqlite3.Cursor:
        if params is None:
            return self._conn.execute(sql)
        return self._conn.execute(sql, params)

    def executemany(self, sql: str, seq_of_params: list[tuple[Any, ...]] | tuple[tuple[Any, ...], ...]) -> sqlite3.Cursor:
        return self._conn.executemany(sql, seq_of_params)

    def executescript(self, sql_script: str) -> sqlite3.Cursor:
        return self._conn.executescript(sql_script)

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "SQLiteConnectionCompat":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc_type is None:
            self.commit()
        else:
            self.rollback()
        self.close()


class PostgresConnectionCompat:
    def __init__(self, connection: Any):
        self._conn = connection

    def _execute(self, sql: str, params: tuple[Any, ...] | list[Any] | None = None) -> PostgresCursorCompat:
        translated, ignore_insert = _translate_postgres_sql(sql)
        params = tuple(params or ())
        table_match = re.match(r"^\s*INSERT\s+INTO\s+([a-z_]+)\b", translated, re.IGNORECASE)
        wants_lastrowid = bool(table_match and table_match.group(1).lower() in TABLES_WITH_SERIAL_IDS and " RETURNING " not in translated.upper())
        if ignore_insert:
            translated = f"{translated} ON CONFLICT DO NOTHING"
        if wants_lastrowid:
            translated = f"{translated} RETURNING id"

        cursor = self._conn.cursor()
        cursor.execute(translated, params)

        prefetched_row = None
        lastrowid = None
        if wants_lastrowid:
            prefetched_row = cursor.fetchone()
            if prefetched_row:
                lastrowid = int(prefetched_row["id"])

        return PostgresCursorCompat(cursor, lastrowid=lastrowid, prefetched_row=prefetched_row)

    def execute(self, sql: str, params: tuple[Any, ...] | list[Any] | None = None) -> PostgresCursorCompat:
        return self._execute(sql, params)

    def executemany(self, sql: str, seq_of_params: list[tuple[Any, ...]] | tuple[tuple[Any, ...], ...]) -> None:
        translated, ignore_insert = _translate_postgres_sql(sql)
        if ignore_insert:
            translated = f"{translated} ON CONFLICT DO NOTHING"
        with self._conn.cursor() as cursor:
            cursor.executemany(translated, seq_of_params)

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "PostgresConnectionCompat":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc_type is None:
            self.commit()
        else:
            self.rollback()
        self.close()


def _execute_sql_script(conn: Any, path: Path) -> None:
    sql_text = path.read_text(encoding="utf-8")
    if not IS_POSTGRES:
        conn.executescript(sql_text)
        return

    statements = [chunk.strip() for chunk in sql_text.split(";") if chunk.strip()]
    for statement in statements:
        conn.execute(statement)


def _get_table_columns(conn: Any, table_name: str) -> set[str]:
    if not IS_POSTGRES:
        return {row["name"] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()}

    rows = conn.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table_name,),
    ).fetchall()
    return {row["column_name"] for row in rows}


def get_db() -> SQLiteConnectionCompat | PostgresConnectionCompat:
    if IS_POSTGRES:
        if psycopg is None:
            raise RuntimeError("PostgreSQL support requires psycopg to be installed.")
        connection = psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=10)
        return PostgresConnectionCompat(connection)

    DB_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 10000")
    return SQLiteConnectionCompat(conn)


def init_db() -> None:
    if not IS_POSTGRES:
        DB_DIR.mkdir(exist_ok=True)
    with get_db() as conn:
        _execute_sql_script(conn, POSTGRES_SCHEMA_PATH if IS_POSTGRES else SCHEMA_PATH)
        ensure_user_admin_schema(conn)
        ensure_user_contact_schema(conn)
        ensure_user_profile_schema(conn)
        ensure_task_image_schema(conn)
        ensure_task_global_schema(conn)
        ensure_task_materials_schema(conn)
        ensure_task_templates_tables(conn)
        ensure_task_attachments_table(conn)
        ensure_subtask_requirement_schema(conn)
        ensure_messages_table(conn)
        ensure_private_chat_tables(conn)
        ensure_activity_log_table(conn)
        ensure_password_reset_tokens_table(conn)
        ensure_profile_verification_tokens_table(conn)
        ensure_completed_tasks_table(conn)
        cleanup_expired_reset_tokens(conn)
        cleanup_expired_profile_verification_tokens(conn)
        cleanup_completed_tasks(conn)
        conn.commit()


def ensure_db() -> None:
    if IS_POSTGRES:
        init_db()
        return

    if not DB_PATH.exists():
        init_db()
        return

    with get_db() as conn:
        ensure_user_admin_schema(conn)
        ensure_user_contact_schema(conn)
        ensure_user_profile_schema(conn)
        ensure_task_image_schema(conn)
        ensure_task_global_schema(conn)
        ensure_task_materials_schema(conn)
        ensure_task_templates_tables(conn)
        ensure_task_attachments_table(conn)
        ensure_subtask_requirement_schema(conn)
        ensure_messages_table(conn)
        ensure_private_chat_tables(conn)
        ensure_activity_log_table(conn)
        ensure_password_reset_tokens_table(conn)
        ensure_profile_verification_tokens_table(conn)
        ensure_completed_tasks_table(conn)
        cleanup_expired_reset_tokens(conn)
        cleanup_expired_profile_verification_tokens(conn)
        cleanup_completed_tasks(conn)
        conn.commit()


def ensure_user_contact_schema(conn: Any) -> None:
    columns = _get_table_columns(conn, "users")
    if "contact" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN contact TEXT")
    if not IS_POSTGRES:
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_contact ON users(contact)")
    else:
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_contact ON users(contact)")


def ensure_user_admin_schema(conn: Any) -> None:
    columns = _get_table_columns(conn, "users")
    if "is_admin" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
    conn.execute(
        "UPDATE users SET is_admin = 1 WHERE LOWER(username) = LOWER(?)",
        ("root",),
    )


def ensure_user_profile_schema(conn: Any) -> None:
    columns = _get_table_columns(conn, "users")
    if "profile_image_path" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN profile_image_path TEXT DEFAULT ''")


def ensure_task_image_schema(conn: Any) -> None:
    columns = _get_table_columns(conn, "tasks")
    if "main_image_path" not in columns:
        conn.execute("ALTER TABLE tasks ADD COLUMN main_image_path TEXT DEFAULT ''")
    if "banner_image_path" not in columns:
        conn.execute("ALTER TABLE tasks ADD COLUMN banner_image_path TEXT DEFAULT ''")


def ensure_task_global_schema(conn: Any) -> None:
    columns = _get_table_columns(conn, "tasks")
    if "is_global" not in columns:
        conn.execute("ALTER TABLE tasks ADD COLUMN is_global INTEGER NOT NULL DEFAULT 0")
    if "global_edit_mode" not in columns:
        conn.execute("ALTER TABLE tasks ADD COLUMN global_edit_mode TEXT NOT NULL DEFAULT 'members'")
    conn.execute(
        """
        UPDATE tasks
        SET global_edit_mode = 'members'
        WHERE global_edit_mode IS NULL OR TRIM(global_edit_mode) = '' OR LOWER(global_edit_mode) NOT IN ('everyone', 'members')
        """
    )


def ensure_task_materials_schema(conn: Any) -> None:
    columns = _get_table_columns(conn, "tasks")
    if "materials_config" not in columns:
        conn.execute("ALTER TABLE tasks ADD COLUMN materials_config TEXT DEFAULT '[]'")
    conn.execute(
        """
        UPDATE tasks
        SET materials_config = '[]'
        WHERE materials_config IS NULL OR TRIM(materials_config) = ''
        """
    )


def ensure_task_attachments_table(conn: Any) -> None:
    if IS_POSTGRES:
        return
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS task_attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            original_name TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            mime_type TEXT DEFAULT 'application/octet-stream',
            size_bytes INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        )
        """
    )


def ensure_task_templates_tables(conn: Any) -> None:
    if not IS_POSTGRES:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS task_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                default_priority TEXT DEFAULT '',
                default_deadline_offset_hours INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS task_template_subtasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                template_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (template_id) REFERENCES task_templates(id) ON DELETE CASCADE
            )
            """
        )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_task_templates_user_id ON task_templates(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_task_template_subtasks_template_id ON task_template_subtasks(template_id)")


def ensure_subtask_requirement_schema(conn: Any) -> None:
    columns = _get_table_columns(conn, "subtasks")
    if "requirement_type" not in columns:
        conn.execute("ALTER TABLE subtasks ADD COLUMN requirement_type TEXT DEFAULT ''")
    if "requirement_config" not in columns:
        conn.execute("ALTER TABLE subtasks ADD COLUMN requirement_config TEXT DEFAULT ''")
    if not IS_POSTGRES:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS subtask_requirement_submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subtask_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                requirement_type TEXT NOT NULL,
                original_name TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                mime_type TEXT DEFAULT 'application/octet-stream',
                size_bytes INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (subtask_id) REFERENCES subtasks(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )


def ensure_password_reset_tokens_table(conn: Any) -> None:
    if IS_POSTGRES:
        return
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )


def ensure_messages_table(conn: Any) -> None:
    if not IS_POSTGRES:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                has_mentions INTEGER NOT NULL DEFAULT 0,
                mentioned_usernames TEXT DEFAULT '',
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
    columns = _get_table_columns(conn, "messages")
    if "has_mentions" not in columns:
        conn.execute("ALTER TABLE messages ADD COLUMN has_mentions INTEGER NOT NULL DEFAULT 0")
    if "mentioned_usernames" not in columns:
        conn.execute("ALTER TABLE messages ADD COLUMN mentioned_usernames TEXT DEFAULT ''")


def ensure_private_chat_tables(conn: Any) -> None:
    if IS_POSTGRES:
        return
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS private_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT DEFAULT '',
            is_group INTEGER NOT NULL DEFAULT 0,
            created_by_user_id INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS private_conversation_members (
            conversation_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            PRIMARY KEY (conversation_id, user_id),
            FOREIGN KEY (conversation_id) REFERENCES private_conversations(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS private_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES private_conversations(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )


def ensure_activity_log_table(conn: Any) -> None:
    if IS_POSTGRES:
        return
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            task_id INTEGER,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
        )
        """
    )


def ensure_profile_verification_tokens_table(conn: Any) -> None:
    if IS_POSTGRES:
        return
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS profile_verification_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )


def ensure_completed_tasks_table(conn: Any) -> None:
    if not IS_POSTGRES:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS completed_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                description TEXT,
                completed_at TEXT,
                completed_by_user_id INTEGER,
                completed_by_username TEXT DEFAULT '',
                worked_on_usernames TEXT DEFAULT '[]',
                data TEXT
            )
            """
        )
    existing_columns = _get_table_columns(conn, "completed_tasks")
    if "completed_by_user_id" not in existing_columns:
        conn.execute("ALTER TABLE completed_tasks ADD COLUMN completed_by_user_id INTEGER")
    if "completed_by_username" not in existing_columns:
        conn.execute("ALTER TABLE completed_tasks ADD COLUMN completed_by_username TEXT DEFAULT ''")
    if "worked_on_usernames" not in existing_columns:
        conn.execute("ALTER TABLE completed_tasks ADD COLUMN worked_on_usernames TEXT DEFAULT '[]'")


def cleanup_completed_tasks(conn: Any) -> None:
    conn.execute(
        """
        DELETE FROM completed_tasks
        WHERE datetime(completed_at) < datetime('now', '-7 days')
        """
    )


def cleanup_expired_reset_tokens(conn: Any) -> None:
    conn.execute(
        """
        DELETE FROM password_reset_tokens
        WHERE datetime(expires_at) < datetime('now')
        """
    )


def cleanup_expired_profile_verification_tokens(conn: Any) -> None:
    conn.execute(
        """
        DELETE FROM profile_verification_tokens
        WHERE datetime(expires_at) < datetime('now')
        """
    )
