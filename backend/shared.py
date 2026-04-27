import os
from pathlib import Path

from flask import Flask
from flask_socketio import SocketIO

BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_URL = (os.environ.get("DATABASE_URL") or "").strip()
IS_POSTGRES = DATABASE_URL.startswith("postgres://") or DATABASE_URL.startswith("postgresql://")
DB_DIR = BASE_DIR / "instance"
DB_PATH = DB_DIR / "tasks.db"
SCHEMA_PATH = BASE_DIR / "schema.sql"
POSTGRES_SCHEMA_PATH = BASE_DIR / "schema_postgres.sql"
PROFILE_UPLOAD_DIR = BASE_DIR / "static" / "uploads" / "profiles"
TASK_UPLOAD_DIR = BASE_DIR / "static" / "uploads" / "tasks"
TASK_ATTACHMENT_DIR = TASK_UPLOAD_DIR / "attachments"
SUBTASK_REQUIREMENT_DIR = TASK_UPLOAD_DIR / "subtask_requirements"

app = Flask(
    __name__,
    template_folder=str(BASE_DIR / "templates"),
    static_folder=str(BASE_DIR / "static"),
)
app.secret_key = os.environ.get("SECRET_KEY") or "replace-this-with-a-better-secret-for-production"
socketio = SocketIO(app, cors_allowed_origins="*", manage_session=False)
