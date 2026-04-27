from __future__ import annotations

import sqlite3

from .shared import DB_DIR, DB_PATH, SCHEMA_PATH


def get_db() -> sqlite3.Connection:
    DB_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


def init_db() -> None:
    DB_DIR.mkdir(exist_ok=True)
    with get_db() as conn:
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            conn.executescript(f.read())
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


def ensure_user_contact_schema(conn: sqlite3.Connection) -> None:
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()
    }
    if "contact" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN contact TEXT")

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_contact ON users(contact)"
    )


def ensure_user_admin_schema(conn: sqlite3.Connection) -> None:
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()
    }
    if "is_admin" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")

    conn.execute(
        "UPDATE users SET is_admin = 1 WHERE username = ? COLLATE NOCASE",
        ("root",),
    )


def ensure_user_profile_schema(conn: sqlite3.Connection) -> None:
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()
    }
    if "profile_image_path" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN profile_image_path TEXT DEFAULT ''")


def ensure_task_image_schema(conn: sqlite3.Connection) -> None:
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()
    }
    if "main_image_path" not in columns:
        conn.execute("ALTER TABLE tasks ADD COLUMN main_image_path TEXT DEFAULT ''")
    if "banner_image_path" not in columns:
        conn.execute("ALTER TABLE tasks ADD COLUMN banner_image_path TEXT DEFAULT ''")


def ensure_task_global_schema(conn: sqlite3.Connection) -> None:
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()
    }
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


def ensure_task_materials_schema(conn: sqlite3.Connection) -> None:
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()
    }
    if "materials_config" not in columns:
        conn.execute("ALTER TABLE tasks ADD COLUMN materials_config TEXT DEFAULT '[]'")
    conn.execute(
        """
        UPDATE tasks
        SET materials_config = '[]'
        WHERE materials_config IS NULL OR TRIM(materials_config) = ''
        """
    )


def ensure_task_attachments_table(conn: sqlite3.Connection) -> None:
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


def ensure_task_templates_tables(conn: sqlite3.Connection) -> None:
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
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_task_templates_user_id ON task_templates(user_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_task_template_subtasks_template_id ON task_template_subtasks(template_id)"
    )


def ensure_subtask_requirement_schema(conn: sqlite3.Connection) -> None:
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(subtasks)").fetchall()
    }
    if "requirement_type" not in columns:
        conn.execute("ALTER TABLE subtasks ADD COLUMN requirement_type TEXT DEFAULT ''")
    if "requirement_config" not in columns:
        conn.execute("ALTER TABLE subtasks ADD COLUMN requirement_config TEXT DEFAULT ''")
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


def ensure_password_reset_tokens_table(conn: sqlite3.Connection) -> None:
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


def ensure_messages_table(conn: sqlite3.Connection) -> None:
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
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(messages)").fetchall()
    }
    if "has_mentions" not in columns:
        conn.execute("ALTER TABLE messages ADD COLUMN has_mentions INTEGER NOT NULL DEFAULT 0")
    if "mentioned_usernames" not in columns:
        conn.execute("ALTER TABLE messages ADD COLUMN mentioned_usernames TEXT DEFAULT ''")


def ensure_private_chat_tables(conn: sqlite3.Connection) -> None:
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


def ensure_activity_log_table(conn: sqlite3.Connection) -> None:
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


def ensure_profile_verification_tokens_table(conn: sqlite3.Connection) -> None:
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


def ensure_completed_tasks_table(conn: sqlite3.Connection) -> None:
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
    existing_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(completed_tasks)").fetchall()
    }
    if "completed_by_user_id" not in existing_columns:
        conn.execute("ALTER TABLE completed_tasks ADD COLUMN completed_by_user_id INTEGER")
    if "completed_by_username" not in existing_columns:
        conn.execute("ALTER TABLE completed_tasks ADD COLUMN completed_by_username TEXT DEFAULT ''")
    if "worked_on_usernames" not in existing_columns:
        conn.execute("ALTER TABLE completed_tasks ADD COLUMN worked_on_usernames TEXT DEFAULT '[]'")


def cleanup_completed_tasks(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        DELETE FROM completed_tasks
        WHERE datetime(completed_at) < datetime('now', '-7 days')
        """
    )


def cleanup_expired_reset_tokens(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        DELETE FROM password_reset_tokens
        WHERE datetime(expires_at) < datetime('now')
        """
    )


def cleanup_expired_profile_verification_tokens(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        DELETE FROM profile_verification_tokens
        WHERE datetime(expires_at) < datetime('now')
        """
    )
