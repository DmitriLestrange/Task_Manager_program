from __future__ import annotations

import json
import os
import re
import secrets
import sqlite3
import base64
import binascii
import mimetypes
from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Any

from flask import jsonify, redirect, render_template, request, session, url_for
from flask_socketio import disconnect, join_room
from werkzeug.security import check_password_hash, generate_password_hash

from backend.db import ensure_db, get_db, init_db
from backend.shared import (
    BASE_DIR,
    DB_PATH,
    PROFILE_UPLOAD_DIR,
    SUBTASK_REQUIREMENT_DIR,
    TASK_ATTACHMENT_DIR,
    TASK_UPLOAD_DIR,
    app,
    socketio,
)
from backend.update_log import UPDATE_LOG


@app.after_request
def add_utf8_charset(response):
    if request.path.endswith((".js", ".css", ".html")):
        content_type = response.headers.get("Content-Type", "")
        if "charset=" not in content_type.lower():
            response.headers["Content-Type"] = f"{response.mimetype}; charset=utf-8"
    return response


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "You must be logged in."}), 401
        return fn(*args, **kwargs)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    @login_required
    def wrapper(*args, **kwargs):
        ensure_db()
        with get_db() as conn:
            user = conn.execute(
                "SELECT is_admin FROM users WHERE id = ?",
                (int(session["user_id"]),),
            ).fetchone()

        if not user or not bool(user["is_admin"]):
            return jsonify({"error": "Admin access required."}), 403
        return fn(*args, **kwargs)
    return wrapper


def password_is_valid(password: str) -> bool:
    return len(password) >= 8 and any(ch.isdigit() for ch in password)


def normalize_contact(contact: str) -> str:
    value = (contact or "").strip()
    if "@" in value:
        return value.lower()
    return re.sub(r"[\s\-\(\)]", "", value)


def ensure_root_account(conn: sqlite3.Connection) -> sqlite3.Row:
    existing = conn.execute(
        "SELECT id, username, contact, profile_image_path, is_admin FROM users WHERE username = ? COLLATE NOCASE",
        ("root",),
    ).fetchone()
    if existing:
        if not bool(existing["is_admin"]):
            conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (int(existing["id"]),))
            conn.commit()
            existing = conn.execute(
                "SELECT id, username, contact, profile_image_path, is_admin FROM users WHERE id = ?",
                (int(existing["id"]),),
            ).fetchone()
        return existing

    root_contact = normalize_contact(os.environ.get("TASK_MANAGER_ROOT_CONTACT") or "root@local.taskmanager")
    root_password = os.environ.get("TASK_MANAGER_ROOT_PASSWORD") or "RootAdmin1234"

    contact_row = conn.execute(
        "SELECT id FROM users WHERE contact = ?",
        (root_contact,),
    ).fetchone()
    if contact_row:
        root_contact = f"root_{secrets.token_hex(4)}@local.taskmanager"

    cursor = conn.execute(
        "INSERT INTO users (username, contact, password_hash, is_admin) VALUES (?, ?, ?, ?)",
        ("root", root_contact, generate_password_hash(root_password), 1),
    )
    conn.commit()
    return conn.execute(
        "SELECT id, username, contact, profile_image_path, is_admin FROM users WHERE id = ?",
        (int(cursor.lastrowid),),
    ).fetchone()


def serialize_user(user_row: sqlite3.Row) -> dict[str, Any]:
    username = user_row["username"]
    is_admin = bool(user_row["is_admin"]) if "is_admin" in user_row.keys() else False
    is_headadmin = is_admin and str(username).lower() == "root"
    return {
        "id": int(user_row["id"]),
        "username": username,
        "contact": user_row["contact"] or "",
        "profile_image_path": user_row["profile_image_path"] or "",
        "is_admin": is_admin,
        "is_headadmin": is_headadmin,
        "role": "headadmin" if is_headadmin else "admin" if is_admin else "user",
    }


def is_headadmin_user(*, username: str, is_admin: bool) -> bool:
    return bool(is_admin) and str(username).lower() == "root"


def role_payload(*, username: str, is_admin: bool) -> dict[str, Any]:
    is_headadmin = is_headadmin_user(username=username, is_admin=is_admin)
    return {
        "is_admin": bool(is_admin),
        "is_headadmin": is_headadmin,
        "role": "headadmin" if is_headadmin else "admin" if is_admin else "user",
    }


def parse_utc_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def build_completed_series_spec(period: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    period = (period or "1w").strip().lower()

    if period == "24h":
        step = timedelta(hours=1)
        end_bucket = now.replace(minute=0, second=0, microsecond=0)
        buckets = [end_bucket - (step * offset) for offset in reversed(range(24))]
        labels = [bucket.strftime("%H:%M") for bucket in buckets]
        bucket_key = lambda dt: dt.replace(minute=0, second=0, microsecond=0)
    elif period == "1m":
        step = timedelta(days=1)
        end_bucket = now.replace(hour=0, minute=0, second=0, microsecond=0)
        buckets = [end_bucket - (step * offset) for offset in reversed(range(30))]
        labels = [bucket.strftime("%d %b") for bucket in buckets]
        bucket_key = lambda dt: dt.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "1y":
        normalized_period = "1y"
        buckets: list[datetime] = []
        month_cursor = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        for _ in range(12):
            buckets.append(month_cursor)
            if month_cursor.month == 1:
                month_cursor = month_cursor.replace(year=month_cursor.year - 1, month=12)
            else:
                month_cursor = month_cursor.replace(month=month_cursor.month - 1)
        buckets.reverse()
        labels = [bucket.strftime("%b %Y") for bucket in buckets]
        bucket_key = lambda dt: dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return {
            "period": normalized_period,
            "now": now,
            "start": buckets[0],
            "buckets": buckets,
            "labels": labels,
            "bucket_key": bucket_key,
        }
    else:
        step = timedelta(days=1)
        end_bucket = now.replace(hour=0, minute=0, second=0, microsecond=0)
        buckets = [end_bucket - (step * offset) for offset in reversed(range(7))]
        labels = [bucket.strftime("%a") for bucket in buckets]
        bucket_key = lambda dt: dt.replace(hour=0, minute=0, second=0, microsecond=0)
        period = "1w"

    return {
        "period": period,
        "now": now,
        "start": buckets[0],
        "buckets": buckets,
        "labels": labels,
        "bucket_key": bucket_key,
    }


def format_numeric_amount(value: float) -> int | float:
    normalized = round(float(value or 0), 2)
    return int(normalized) if normalized.is_integer() else normalized


def slugify_material_type(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip().lower())
    slug = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return slug[:48]


def sanitize_material_label(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    text = re.sub(r"[\x00-\x1f]+", "", text)
    return text[:80]


def coerce_material_amount(value: Any) -> float:
    try:
        amount = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Material amounts must be valid numbers.") from exc
    if amount <= 0:
        raise ValueError("Material amounts must be greater than zero.")
    return round(amount, 2)


def normalize_task_materials_config(value: Any) -> list[dict[str, Any]]:
    raw_items = value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            raw_items = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError("Task materials could not be processed.") from exc

    if raw_items in (None, ""):
        return []
    if not isinstance(raw_items, list):
        raise ValueError("Task materials must be a list.")

    merged: dict[str, dict[str, Any]] = {}
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        label = sanitize_material_label(
            item.get("label")
            or item.get("material_label")
            or item.get("name")
            or item.get("material_type")
            or item.get("type")
        )
        material_type = slugify_material_type(
            item.get("material_type")
            or item.get("type")
            or label
        )
        if not material_type:
            continue
        material_label = label or material_type.replace("_", " ").title()
        amount = coerce_material_amount(
            item.get("allocated_amount", item.get("amount", item.get("allocated", 0)))
        )
        existing = merged.get(material_type)
        if existing:
            existing["allocated_amount"] = round(existing["allocated_amount"] + amount, 2)
            if len(material_label) > len(existing["material_label"]):
                existing["material_label"] = material_label
        else:
            merged[material_type] = {
                "material_type": material_type,
                "material_label": material_label,
                "allocated_amount": amount,
            }

    return [
        {
            "material_type": item["material_type"],
            "material_label": item["material_label"],
            "allocated_amount": format_numeric_amount(item["allocated_amount"]),
        }
        for item in sorted(merged.values(), key=lambda item: item["material_label"].lower())
    ]


def parse_material_requirement_config(value: Any) -> dict[str, Any] | None:
    raw = value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            return None
    if not isinstance(raw, dict):
        return None
    label = sanitize_material_label(
        raw.get("material_label")
        or raw.get("label")
        or raw.get("material_type")
        or raw.get("type")
    )
    material_type = slugify_material_type(raw.get("material_type") or raw.get("type") or label)
    if not material_type:
        return None
    try:
        amount = coerce_material_amount(raw.get("amount", raw.get("allocated_amount", 0)))
    except ValueError:
        return None
    return {
        "material_type": material_type,
        "material_label": label or material_type.replace("_", " ").title(),
        "amount": format_numeric_amount(amount),
    }


def normalize_material_requirement_config(value: Any) -> str:
    requirement = parse_material_requirement_config(value)
    if not requirement:
        raise ValueError("Materials requirement needs a material type and amount.")
    return json.dumps(requirement)


def get_subtask_material_usage_map(
    conn: sqlite3.Connection,
    task_id: int,
    *,
    exclude_subtask_id: int | None = None,
) -> dict[str, float]:
    rows = conn.execute(
        """
        SELECT id, requirement_type, requirement_config
        FROM subtasks
        WHERE task_id = ?
        """,
        (task_id,),
    ).fetchall()
    usage: dict[str, float] = {}
    for row in rows:
        if exclude_subtask_id is not None and int(row["id"]) == int(exclude_subtask_id):
            continue
        if normalize_subtask_requirement_type(row["requirement_type"]) != "materials":
            continue
        requirement = parse_material_requirement_config(row["requirement_config"])
        if not requirement:
            continue
        material_type = requirement["material_type"]
        usage[material_type] = round(usage.get(material_type, 0.0) + float(requirement["amount"]), 2)
    return usage


def build_task_materials_summary(
    conn: sqlite3.Connection,
    task_id: int,
    task_materials: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    usage_map = get_subtask_material_usage_map(conn, task_id)
    summary = []
    for material in task_materials:
        allocated = float(material["allocated_amount"])
        reserved = round(usage_map.get(material["material_type"], 0.0), 2)
        remaining = round(max(allocated - reserved, 0.0), 2)
        summary.append(
            {
                "material_type": material["material_type"],
                "material_label": material["material_label"],
                "allocated_amount": format_numeric_amount(allocated),
                "reserved_amount": format_numeric_amount(reserved),
                "remaining_amount": format_numeric_amount(remaining),
            }
        )
    return summary


def validate_task_materials_against_subtasks(
    conn: sqlite3.Connection,
    task_id: int,
    task_materials: list[dict[str, Any]],
) -> None:
    allocations = {item["material_type"]: float(item["allocated_amount"]) for item in task_materials}
    labels = {item["material_type"]: item["material_label"] for item in task_materials}
    usage_map = get_subtask_material_usage_map(conn, task_id)
    for material_type, reserved in usage_map.items():
        allocated = allocations.get(material_type)
        label = labels.get(material_type, material_type.replace("_", " ").title())
        if allocated is None:
            raise ValueError(f'Existing subtasks still reserve "{label}". Add it back or update those subtasks first.')
        if reserved > allocated + 1e-9:
            raise ValueError(f'Allocated "{label}" is below the {format_numeric_amount(reserved)} already reserved by subtasks.')


def validate_material_requirement_for_task(
    conn: sqlite3.Connection,
    task_id: int,
    requirement: dict[str, Any],
    *,
    exclude_subtask_id: int | None = None,
) -> dict[str, Any]:
    task_row = conn.execute("SELECT materials_config FROM tasks WHERE id = ?", (task_id,)).fetchone()
    task_materials = normalize_task_materials_config(task_row["materials_config"] if task_row else "[]")
    if not task_materials:
        raise ValueError("This task has no allocated materials yet.")

    allocations = {item["material_type"]: item for item in task_materials}
    allocation = allocations.get(requirement["material_type"])
    if not allocation:
        raise ValueError(f'This task does not have "{requirement["material_label"]}" allocated.')

    usage_map = get_subtask_material_usage_map(conn, task_id, exclude_subtask_id=exclude_subtask_id)
    reserved_other = round(usage_map.get(requirement["material_type"], 0.0), 2)
    allocated_amount = float(allocation["allocated_amount"])
    amount_needed = float(requirement["amount"])
    available = round(max(allocated_amount - reserved_other, 0.0), 2)
    if amount_needed > available + 1e-9:
        raise ValueError(
            f'Only {format_numeric_amount(available)} {allocation["material_label"]} remain for this task.'
        )
    return {
        "material_type": allocation["material_type"],
        "material_label": allocation["material_label"],
        "amount": format_numeric_amount(amount_needed),
        "available_before": format_numeric_amount(available),
        "remaining_after": format_numeric_amount(max(available - amount_needed, 0.0)),
    }


def extract_material_usage_from_task_data(task_data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    usage: dict[str, dict[str, Any]] = {}
    for subtask in task_data.get("subtasks") or []:
        if normalize_subtask_requirement_type(subtask.get("requirement_type")) != "materials":
            continue
        requirement = parse_material_requirement_config(subtask.get("requirement_config"))
        if not requirement:
            continue
        current = usage.setdefault(
            requirement["material_type"],
            {
                "material_type": requirement["material_type"],
                "material_label": requirement["material_label"],
                "amount": 0.0,
            },
        )
        current["amount"] = round(current["amount"] + float(requirement["amount"]), 2)
    return usage


def build_completed_tasks_series(conn: sqlite3.Connection, period: str) -> dict[str, Any]:
    spec = build_completed_series_spec(period)
    now = spec["now"]
    period = spec["period"]
    buckets = spec["buckets"]
    labels = spec["labels"]
    start = spec["start"]
    bucket_key = spec["bucket_key"]
    bucket_map = {bucket.isoformat(): 0 for bucket in buckets}
    rows = conn.execute(
        "SELECT completed_at FROM completed_tasks WHERE completed_at IS NOT NULL"
    ).fetchall()
    for row in rows:
        parsed = parse_utc_datetime(row["completed_at"])
        if not parsed or parsed < start or parsed > now:
            continue
        key = bucket_key(parsed).isoformat()
        if key in bucket_map:
            bucket_map[key] += 1

    return {
        "period": period,
        "labels": labels,
        "values": [bucket_map[bucket.isoformat()] for bucket in buckets],
    }


def build_completed_materials_series(conn: sqlite3.Connection, period: str) -> dict[str, Any]:
    spec = build_completed_series_spec(period)
    now = spec["now"]
    buckets = spec["buckets"]
    labels = spec["labels"]
    start = spec["start"]
    bucket_key = spec["bucket_key"]
    bucket_material_map = {bucket.isoformat(): {} for bucket in buckets}
    rows = conn.execute(
        "SELECT completed_at, data FROM completed_tasks WHERE completed_at IS NOT NULL"
    ).fetchall()

    material_labels: dict[str, str] = {}
    for row in rows:
        parsed = parse_utc_datetime(row["completed_at"])
        if not parsed or parsed < start or parsed > now:
            continue
        try:
            task_data = json.loads(row["data"] or "{}")
        except json.JSONDecodeError:
            task_data = {}
        key = bucket_key(parsed).isoformat()
        if key not in bucket_material_map:
            continue
        usage = extract_material_usage_from_task_data(task_data)
        for material_type, item in usage.items():
            material_labels[material_type] = item["material_label"]
            bucket_material_map[key][material_type] = round(
                bucket_material_map[key].get(material_type, 0.0) + float(item["amount"]),
                2,
            )

    materials = []
    for material_type, label in sorted(material_labels.items(), key=lambda item: item[1].lower()):
        values = [
            format_numeric_amount(bucket_material_map[bucket.isoformat()].get(material_type, 0.0))
            for bucket in buckets
        ]
        total = round(sum(float(value) for value in values), 2)
        materials.append(
            {
                "material_type": material_type,
                "material_label": label,
                "values": values,
                "total": format_numeric_amount(total),
            }
        )

    return {
        "period": spec["period"],
        "labels": labels,
        "materials": materials,
    }


def completed_task_matches_user(task_data: dict[str, Any], *, user_id: int, username: str) -> bool:
    members = {
        str(member).strip().lower()
        for member in (task_data.get("members") or [])
        if str(member).strip()
    }
    members.update(
        str(member.get("username") or "").strip().lower()
        for member in (task_data.get("member_details") or [])
        if str(member.get("username") or "").strip()
    )

    creator_user_id = task_data.get("creator_user_id")
    if creator_user_id is not None:
        try:
            if int(creator_user_id) == int(user_id):
                return True
        except (TypeError, ValueError):
            pass

    completed_by = task_data.get("completed_by") or {}
    completed_by_username = str(
        completed_by.get("username")
        or task_data.get("completed_by_username")
        or ""
    ).strip().lower()
    if completed_by_username and completed_by_username == username.strip().lower():
        return True

    completed_by_user_id = completed_by.get("id") or task_data.get("completed_by_user_id")
    if completed_by_user_id is not None:
        try:
            if int(completed_by_user_id) == int(user_id):
                return True
        except (TypeError, ValueError):
            pass

    return username.strip().lower() in members


def completed_task_search_usernames(task_data: dict[str, Any]) -> set[str]:
    usernames = {
        str(member).strip().lower()
        for member in (task_data.get("members") or [])
        if str(member).strip()
    }
    usernames.update(
        str(member.get("username") or "").strip().lower()
        for member in (task_data.get("member_details") or [])
        if str(member.get("username") or "").strip()
    )
    completed_by = task_data.get("completed_by") or {}
    completed_by_username = str(
        completed_by.get("username")
        or task_data.get("completed_by_username")
        or ""
    ).strip().lower()
    if completed_by_username:
        usernames.add(completed_by_username)
    return usernames


def parse_completed_task_archive_row(row: sqlite3.Row) -> tuple[dict[str, Any], dict[str, Any]]:
    try:
        task_data = json.loads(row["data"] or "{}")
    except json.JSONDecodeError:
        task_data = {}

    member_details = task_data.get("member_details") or []
    if member_details:
        worked_on_users = [
            {
                "username": member.get("username") or "",
                "profile_image_path": member.get("profile_image_path") or "",
                **role_payload(
                    username=member.get("username") or "",
                    is_admin=bool(member.get("is_admin") or member.get("role") in {"admin", "headadmin"}),
                ),
            }
            for member in member_details
            if str(member.get("username") or "").strip()
        ]
    else:
        worked_on_users = [
            {
                "username": str(username).strip(),
                "profile_image_path": "",
                **role_payload(username=str(username).strip(), is_admin=False),
            }
            for username in (task_data.get("members") or [])
            if str(username).strip()
        ]

    completed_by_data = task_data.get("completed_by") or {}
    completed_by_username = (
        completed_by_data.get("username")
        or row["completed_by_username"]
        or task_data.get("completed_by_username")
        or ""
    )
    completed_by = None
    if str(completed_by_username).strip():
        completed_by = {
            "id": completed_by_data.get("id") or row["completed_by_user_id"],
            "username": completed_by_username,
            "profile_image_path": completed_by_data.get("profile_image_path") or "",
            **role_payload(
                username=completed_by_username,
                is_admin=bool(
                    completed_by_data.get("is_admin")
                    or completed_by_data.get("role") in {"admin", "headadmin"}
                ),
            ),
        }

    archive = {
        "id": int(row["id"]),
        "title": row["title"] or task_data.get("title") or "",
        "description": row["description"] or task_data.get("description") or "",
        "completed_at": row["completed_at"] or task_data.get("completed_at") or "",
        "worked_on_users": worked_on_users,
        "worked_on_usernames": [user["username"] for user in worked_on_users],
        "completed_by": completed_by,
    }
    return archive, task_data


def build_user_completed_series(
    conn: sqlite3.Connection,
    *,
    user_id: int,
    username: str,
    period: str,
) -> dict[str, Any]:
    spec = build_completed_series_spec(period)
    now = spec["now"]
    period = spec["period"]
    labels = list(spec["labels"])
    values = [0 for _ in labels]
    buckets = spec["buckets"]
    start = spec["start"]
    bucket_key = spec["bucket_key"]
    bucket_map = {bucket.isoformat(): 0 for bucket in buckets}
    rows = conn.execute(
        "SELECT completed_at, data FROM completed_tasks WHERE completed_at IS NOT NULL"
    ).fetchall()

    for row in rows:
        parsed = parse_utc_datetime(row["completed_at"])
        if not parsed or parsed < start or parsed > now:
            continue
        try:
            task_data = json.loads(row["data"] or "{}")
        except json.JSONDecodeError:
            task_data = {}
        if not completed_task_matches_user(task_data, user_id=user_id, username=username):
            continue
        key = bucket_key(parsed).isoformat()
        if key in bucket_map:
            bucket_map[key] += 1

    for index, bucket in enumerate(buckets):
        values[index] = bucket_map.get(bucket.isoformat(), 0)

    return {
        "period": period,
        "labels": labels,
        "values": values,
    }


def save_profile_image(user_id: int, data_url: str) -> str:
    if not data_url:
        return ""

    match = re.fullmatch(r"data:image/(png|jpeg|jpg|gif|webp);base64,(.+)", data_url.strip(), re.IGNORECASE)
    if not match:
        raise ValueError("Profile picture must be a valid image file.")

    extension = match.group(1).lower().replace("jpeg", "jpg")
    try:
        image_bytes = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Profile picture could not be processed.") from exc

    PROFILE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"user_{user_id}_{secrets.token_hex(8)}.{extension}"
    path = PROFILE_UPLOAD_DIR / filename
    path.write_bytes(image_bytes)
    return f"/static/uploads/profiles/{filename}"


def remove_uploaded_file(relative_path: str) -> None:
    if not relative_path or not relative_path.startswith("/static/uploads/"):
        return
    target = BASE_DIR / relative_path.lstrip("/").replace("/", "\\")
    try:
        if target.exists() and target.is_file():
            target.unlink()
    except OSError:
        return


def save_task_image(task_id: int, slot: str, data_url: str) -> str:
    if not data_url:
        return ""

    match = re.fullmatch(r"data:image/(png|jpeg|jpg|gif|webp);base64,(.+)", data_url.strip(), re.IGNORECASE)
    if not match:
        raise ValueError("Task image must be a valid image file.")

    extension = match.group(1).lower().replace("jpeg", "jpg")
    try:
        image_bytes = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Task image could not be processed.") from exc

    safe_slot = "banner" if slot == "banner" else "main"
    TASK_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"task_{task_id}_{safe_slot}_{secrets.token_hex(8)}.{extension}"
    path = TASK_UPLOAD_DIR / filename
    path.write_bytes(image_bytes)
    return f"/static/uploads/tasks/{filename}"


def sanitize_attachment_name(name: str) -> str:
    cleaned = re.sub(r"[\x00-\x1f]+", "", str(name or "").strip())
    cleaned = cleaned.replace("\\", "_").replace("/", "_")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:180] or "attachment"


def get_attachment_extension(original_name: str, mime_type: str) -> str:
    suffix = Path(original_name or "").suffix.strip()
    if suffix and re.fullmatch(r"\.[A-Za-z0-9]{1,12}", suffix):
        return suffix.lower()
    guessed = mimetypes.guess_extension(mime_type or "")
    if guessed and re.fullmatch(r"\.[A-Za-z0-9]{1,12}", guessed):
        return guessed.lower()
    return ""


def save_task_attachment(task_id: int, attachment: dict[str, Any]) -> dict[str, Any]:
    original_name = sanitize_attachment_name(attachment.get("name") or "")
    data_url = str(attachment.get("data_url") or "").strip()
    size_bytes = int(attachment.get("size") or 0)
    mime_type = str(attachment.get("type") or "").strip() or "application/octet-stream"

    match = re.fullmatch(r"data:([^;,]+)?;base64,(.+)", data_url, re.IGNORECASE)
    if not match:
        raise ValueError("Attachment could not be processed.")

    if match.group(1):
        mime_type = match.group(1).strip().lower()

    try:
        file_bytes = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Attachment could not be processed.") from exc

    if not size_bytes:
        size_bytes = len(file_bytes)

    extension = get_attachment_extension(original_name, mime_type)
    TASK_ATTACHMENT_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"task_{task_id}_file_{secrets.token_hex(8)}{extension}"
    path = TASK_ATTACHMENT_DIR / filename
    path.write_bytes(file_bytes)

    return {
        "original_name": original_name,
        "stored_path": f"/static/uploads/tasks/attachments/{filename}",
        "mime_type": mime_type,
        "size_bytes": size_bytes,
    }


def save_subtask_requirement_submission(subtask_id: int, submission: dict[str, Any]) -> dict[str, Any]:
    original_name = sanitize_attachment_name(submission.get("name") or "")
    data_url = str(submission.get("data_url") or "").strip()
    size_bytes = int(submission.get("size") or 0)
    mime_type = str(submission.get("type") or "").strip() or "application/octet-stream"

    match = re.fullmatch(r"data:([^;,]+)?;base64,(.+)", data_url, re.IGNORECASE)
    if not match:
        raise ValueError("Requirement file could not be processed.")

    if match.group(1):
        mime_type = match.group(1).strip().lower()

    try:
        file_bytes = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Requirement file could not be processed.") from exc

    if not size_bytes:
        size_bytes = len(file_bytes)

    extension = get_attachment_extension(original_name, mime_type)
    SUBTASK_REQUIREMENT_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"subtask_{subtask_id}_req_{secrets.token_hex(8)}{extension}"
    path = SUBTASK_REQUIREMENT_DIR / filename
    path.write_bytes(file_bytes)

    return {
        "original_name": original_name,
        "stored_path": f"/static/uploads/tasks/subtask_requirements/{filename}",
        "mime_type": mime_type,
        "size_bytes": size_bytes,
    }


def get_subtask_requirement_submissions(conn: sqlite3.Connection, subtask_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT srs.*, u.username, u.is_admin
        FROM subtask_requirement_submissions srs
        JOIN users u ON u.id = srs.user_id
        WHERE srs.subtask_id = ?
        ORDER BY srs.created_at ASC, srs.id ASC
        """,
        (subtask_id,),
    ).fetchall()


def is_subtask_requirement_satisfied(conn: sqlite3.Connection, subtask_id: int, requirement_type: str) -> bool:
    normalized_type = normalize_subtask_requirement_type(requirement_type)
    if normalized_type == "":
        return True
    if normalized_type == "file":
        row = conn.execute(
            "SELECT 1 FROM subtask_requirement_submissions WHERE subtask_id = ? LIMIT 1",
            (subtask_id,),
        ).fetchone()
        return bool(row)
    if normalized_type == "materials":
        row = conn.execute(
            "SELECT task_id, requirement_config FROM subtasks WHERE id = ?",
            (subtask_id,),
        ).fetchone()
        if not row:
            return False
        requirement = parse_material_requirement_config(row["requirement_config"])
        if not requirement:
            return False
        try:
            validate_material_requirement_for_task(
                conn,
                int(row["task_id"]),
                requirement,
                exclude_subtask_id=subtask_id,
            )
            return True
        except ValueError:
            return False
    return False


def remove_subtask_requirement_files(conn: sqlite3.Connection, subtask_id: int) -> None:
    rows = conn.execute(
        "SELECT stored_path FROM subtask_requirement_submissions WHERE subtask_id = ?",
        (subtask_id,),
    ).fetchall()
    for row in rows:
        remove_uploaded_file(row["stored_path"] or "")
    conn.execute("DELETE FROM subtask_requirement_submissions WHERE subtask_id = ?", (subtask_id,))


def calculate_progress(subtasks: list[sqlite3.Row]) -> int:
    if not subtasks:
        return 0
    completed = sum(1 for s in subtasks if s["completed"] == 1)
    return round((completed / len(subtasks)) * 100)


def normalize_global_edit_mode(value: Any) -> str:
    return "everyone" if str(value or "").strip().lower() == "everyone" else "members"


def normalize_subtask_requirement_type(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized == "file":
        return "file"
    if normalized == "materials":
        return "materials"
    return ""


def normalize_template_priority(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in {"low", "medium", "high"} else ""


def normalize_template_deadline_offset_hours(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        hours = int(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError("Default deadline offset must be a whole number of hours.") from exc
    if hours < 1 or hours > 24 * 365:
        raise ValueError("Default deadline offset must be between 1 and 8760 hours.")
    return hours


def normalize_template_subtasks(payload: Any) -> list[dict[str, Any]]:
    if payload in (None, "", False):
        return []
    if not isinstance(payload, list):
        raise ValueError("Template subtasks must be a list.")

    normalized: list[dict[str, Any]] = []
    for index, raw_item in enumerate(payload):
        if isinstance(raw_item, dict):
            title = str(raw_item.get("title") or "").strip()
        else:
            title = str(raw_item or "").strip()
        if not title:
            continue
        normalized.append(
            {
                "title": title[:200],
                "position": index,
            }
        )

    if len(normalized) > 50:
        raise ValueError("A template can include up to 50 predefined subtasks.")
    return normalized


def replace_task_template_subtasks(
    conn: sqlite3.Connection,
    template_id: int,
    subtasks: list[dict[str, Any]],
) -> None:
    conn.execute(
        "DELETE FROM task_template_subtasks WHERE template_id = ?",
        (template_id,),
    )
    for index, subtask in enumerate(subtasks):
        conn.execute(
            """
            INSERT INTO task_template_subtasks (template_id, title, position)
            VALUES (?, ?, ?)
            """,
            (template_id, subtask["title"], index),
        )


def serialize_task_template(conn: sqlite3.Connection, template_row: sqlite3.Row) -> dict[str, Any]:
    subtasks = conn.execute(
        """
        SELECT id, title, position
        FROM task_template_subtasks
        WHERE template_id = ?
        ORDER BY position ASC, id ASC
        """,
        (int(template_row["id"]),),
    ).fetchall()
    return {
        "id": int(template_row["id"]),
        "name": template_row["name"] or "",
        "description": template_row["description"] or "",
        "default_priority": normalize_template_priority(template_row["default_priority"]),
        "default_deadline_offset_hours": (
            int(template_row["default_deadline_offset_hours"])
            if template_row["default_deadline_offset_hours"] is not None
            else None
        ),
        "subtasks": [
            {
                "id": int(subtask["id"]),
                "title": subtask["title"] or "",
                "position": int(subtask["position"] or 0),
            }
            for subtask in subtasks
        ],
        "created_at": template_row["created_at"],
        "updated_at": template_row["updated_at"],
    }


def task_is_global(task_row: sqlite3.Row | dict[str, Any] | None) -> bool:
    if not task_row:
        return False
    try:
        return bool(task_row["is_global"])
    except (KeyError, TypeError, IndexError):
        return False


def user_is_task_member(conn: sqlite3.Connection, task_id: int, user_id: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM task_users WHERE task_id = ? AND user_id = ?",
        (task_id, user_id),
    ).fetchone()
    return bool(row)


def user_can_view_task_row(conn: sqlite3.Connection, task_row: sqlite3.Row | None, user_id: int, *, is_admin: bool) -> bool:
    if not task_row:
        return False
    if is_admin or task_is_global(task_row):
        return True
    return user_is_task_member(conn, int(task_row["id"]), user_id)


def user_can_edit_task_row(conn: sqlite3.Connection, task_row: sqlite3.Row | None, user_id: int, *, is_admin: bool) -> bool:
    if not task_row:
        return False
    if is_admin:
        return True
    task_id = int(task_row["id"])
    if user_is_task_member(conn, task_id, user_id):
        return True
    if task_is_global(task_row) and normalize_global_edit_mode(task_row["global_edit_mode"]) == "everyone":
        return True
    return False


def user_can_delete_task_row(conn: sqlite3.Connection, task_row: sqlite3.Row | None, user_id: int, *, is_admin: bool) -> bool:
    if not task_row:
        return False
    if is_admin:
        return True
    return user_is_task_member(conn, int(task_row["id"]), user_id)


def serialize_task(conn: sqlite3.Connection, task_row: sqlite3.Row) -> dict[str, Any]:
    subtasks = conn.execute(
        "SELECT * FROM subtasks WHERE task_id = ? ORDER BY position ASC, id ASC",
        (task_row["id"],),
    ).fetchall()

    members = conn.execute(
        """
        SELECT u.username, u.is_admin, u.profile_image_path
        FROM task_users tu
        JOIN users u ON u.id = tu.user_id
        WHERE tu.task_id = ?
        ORDER BY u.username COLLATE NOCASE
        """,
        (task_row["id"],),
    ).fetchall()

    attachments = conn.execute(
        """
        SELECT id, original_name, stored_path, mime_type, size_bytes, created_at
        FROM task_attachments
        WHERE task_id = ?
        ORDER BY created_at ASC, id ASC
        """,
        (task_row["id"],),
    ).fetchall()

    progress = calculate_progress(subtasks)
    completed_count = sum(1 for s in subtasks if s["completed"] == 1)
    total_count = len(subtasks)
    task_materials = normalize_task_materials_config(task_row["materials_config"] if "materials_config" in task_row.keys() else "[]")
    materials_summary = build_task_materials_summary(conn, int(task_row["id"]), task_materials)
    materials_remaining_map = {
        item["material_type"]: item["remaining_amount"]
        for item in materials_summary
    }

    serialized_subtasks = []
    for s in subtasks:
        requirement_type = normalize_subtask_requirement_type(s["requirement_type"] if "requirement_type" in s.keys() else "")
        submissions = get_subtask_requirement_submissions(conn, int(s["id"]))
        requirement_satisfied = is_subtask_requirement_satisfied(conn, int(s["id"]), requirement_type)
        requirement_material = parse_material_requirement_config(s["requirement_config"] if "requirement_config" in s.keys() else "")
        serialized_subtasks.append(
            {
                "id": s["id"],
                "title": s["title"],
                "completed": bool(s["completed"]),
                "deadline": s["deadline"],
                "priority": s["priority"],
                "position": s["position"],
                "requirement_type": requirement_type,
                "requirement_config": s["requirement_config"] if "requirement_config" in s.keys() else "",
                "requirement_material": (
                    {
                        "material_type": requirement_material["material_type"],
                        "material_label": requirement_material["material_label"],
                        "amount": requirement_material["amount"],
                        "remaining_amount": materials_remaining_map.get(requirement_material["material_type"], 0),
                    }
                    if requirement_material and requirement_type == "materials"
                    else None
                ),
                "requirement_satisfied": requirement_satisfied,
                "requirement_submission_count": len(submissions),
                "requirement_submissions": [
                    {
                        "id": int(submission["id"]),
                        "name": submission["original_name"],
                        "path": submission["stored_path"],
                        "mime_type": submission["mime_type"] or "application/octet-stream",
                        "size_bytes": int(submission["size_bytes"] or 0),
                        "created_at": submission["created_at"],
                        "submitted_by": submission["username"],
                        "submitted_by_role": role_payload(
                            username=submission["username"],
                            is_admin=bool(submission["is_admin"]),
                        ),
                    }
                    for submission in submissions
                ],
            }
        )

    return {
        "id": task_row["id"],
        "title": task_row["title"],
        "description": task_row["description"],
        "deadline": task_row["deadline"],
        "priority": task_row["priority"],
        "main_image_path": task_row["main_image_path"] if "main_image_path" in task_row.keys() else "",
        "banner_image_path": task_row["banner_image_path"] if "banner_image_path" in task_row.keys() else "",
        "materials": materials_summary,
        "materials_config": json.dumps(task_materials),
        "is_global": bool(task_row["is_global"]) if "is_global" in task_row.keys() else False,
        "global_edit_mode": normalize_global_edit_mode(task_row["global_edit_mode"]) if "global_edit_mode" in task_row.keys() else "members",
        "creator_user_id": int(task_row["creator_user_id"]) if "creator_user_id" in task_row.keys() else None,
        "collapsed": bool(task_row["collapsed"]),
        "progress": progress,
        "completed_count": completed_count,
        "remaining_count": max(total_count - completed_count, 0),
        "subtask_count": total_count,
        "members": [m["username"] for m in members],
        "member_details": [
            {
                "username": m["username"],
                "profile_image_path": m["profile_image_path"] or "",
                **role_payload(username=m["username"], is_admin=bool(m["is_admin"])),
            }
            for m in members
        ],
        "subtasks": serialized_subtasks,
        "attachments": [
            {
                "id": int(a["id"]),
                "name": a["original_name"],
                "path": a["stored_path"],
                "mime_type": a["mime_type"] or "application/octet-stream",
                "size_bytes": int(a["size_bytes"] or 0),
                "created_at": a["created_at"],
            }
            for a in attachments
        ],
    }


def fetch_task_for_user(conn: sqlite3.Connection, task_id: int, user_id: int) -> dict[str, Any] | None:
    task = task_row_for_user(conn, task_id, user_id)
    if not task:
        return None
    return serialize_task(conn, task)


def task_row_for_user(conn: sqlite3.Connection, task_id: int, user_id: int) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT DISTINCT t.*
        FROM tasks t
        LEFT JOIN task_users tu ON tu.task_id = t.id
        WHERE t.id = ? AND (t.is_global = 1 OR tu.user_id = ?)
        """,
        (task_id, user_id),
    ).fetchone()


def current_user_is_admin(conn: sqlite3.Connection, user_id: int) -> bool:
    row = conn.execute(
        "SELECT is_admin FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    return bool(row and row["is_admin"])


def current_user_is_headadmin(conn: sqlite3.Connection, user_id: int) -> bool:
    row = conn.execute(
        "SELECT username, is_admin FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    return bool(
        row and is_headadmin_user(username=row["username"], is_admin=bool(row["is_admin"]))
    )


def task_row_for_access(
    conn: sqlite3.Connection,
    task_id: int,
    user_id: int,
    *,
    is_admin: bool,
) -> sqlite3.Row | None:
    task = conn.execute(
        "SELECT * FROM tasks WHERE id = ?",
        (task_id,),
    ).fetchone()
    if not task:
        return None
    if user_can_view_task_row(conn, task, user_id, is_admin=is_admin):
        return task
    return None


def fetch_task_for_access(
    conn: sqlite3.Connection,
    task_id: int,
    user_id: int,
    *,
    is_admin: bool,
) -> dict[str, Any] | None:
    task = task_row_for_access(conn, task_id, user_id, is_admin=is_admin)
    if not task:
        return None
    return serialize_task(conn, task)


def get_admin_user_ids(conn: sqlite3.Connection, *, exclude_user_ids: set[int] | None = None) -> list[int]:
    exclude_user_ids = exclude_user_ids or set()
    rows = conn.execute(
        "SELECT id FROM users WHERE is_admin = 1"
    ).fetchall()
    return [
        int(row["id"])
        for row in rows
        if int(row["id"]) not in exclude_user_ids
    ]


def get_all_user_ids(conn: sqlite3.Connection, *, exclude_user_ids: set[int] | None = None) -> list[int]:
    exclude_user_ids = exclude_user_ids or set()
    rows = conn.execute("SELECT id FROM users").fetchall()
    return [
        int(row["id"])
        for row in rows
        if int(row["id"]) not in exclude_user_ids
    ]


def get_task_audience_user_ids(conn: sqlite3.Connection, task_row: sqlite3.Row | dict[str, Any]) -> list[int]:
    task_id = int(task_row["id"])
    if task_is_global(task_row):
        return get_all_user_ids(conn)
    member_ids = set(get_task_member_ids(conn, task_id))
    return sorted(member_ids | set(get_admin_user_ids(conn, exclude_user_ids=member_ids)))


def get_private_conversation_member_ids(conn: sqlite3.Connection, conversation_id: int) -> list[int]:
    rows = conn.execute(
        """
        SELECT user_id
        FROM private_conversation_members
        WHERE conversation_id = ?
        ORDER BY user_id ASC
        """,
        (conversation_id,),
    ).fetchall()
    return [int(row["user_id"]) for row in rows]


def get_private_conversation_row_for_user(
    conn: sqlite3.Connection,
    conversation_id: int,
    user_id: int,
) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT pc.*
        FROM private_conversations pc
        JOIN private_conversation_members pcm ON pcm.conversation_id = pc.id
        WHERE pc.id = ? AND pcm.user_id = ?
        """,
        (conversation_id, user_id),
    ).fetchone()


def find_direct_conversation_between(
    conn: sqlite3.Connection,
    user_a_id: int,
    user_b_id: int,
) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT pc.*
        FROM private_conversations pc
        JOIN private_conversation_members pcm_a
            ON pcm_a.conversation_id = pc.id AND pcm_a.user_id = ?
        JOIN private_conversation_members pcm_b
            ON pcm_b.conversation_id = pc.id AND pcm_b.user_id = ?
        WHERE pc.is_group = 0
          AND (
              SELECT COUNT(*)
              FROM private_conversation_members pcm_count
              WHERE pcm_count.conversation_id = pc.id
          ) = 2
        ORDER BY pc.id ASC
        LIMIT 1
        """,
        (user_a_id, user_b_id),
    ).fetchone()


def serialize_private_message_row(
    row: sqlite3.Row,
    *,
    viewer_user_id: int,
) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "conversation_id": int(row["conversation_id"]),
        "user_id": int(row["user_id"]),
        "username": row["username"],
        "profile_image_path": row["profile_image_path"] or "",
        "content": row["content"],
        "timestamp": row["timestamp"],
        "is_current_user": int(row["user_id"]) == int(viewer_user_id),
        **role_payload(username=row["username"], is_admin=bool(row["is_admin"])),
    }


def serialize_private_conversation(
    conn: sqlite3.Connection,
    conversation_row: sqlite3.Row,
    *,
    viewer_user_id: int,
) -> dict[str, Any]:
    conversation_id = int(conversation_row["id"])
    member_rows = conn.execute(
        """
        SELECT u.id, u.username, u.contact, u.profile_image_path, u.is_admin
        FROM private_conversation_members pcm
        JOIN users u ON u.id = pcm.user_id
        WHERE pcm.conversation_id = ?
        ORDER BY u.username COLLATE NOCASE ASC
        """,
        (conversation_id,),
    ).fetchall()
    members = [
        {
            "id": int(row["id"]),
            "username": row["username"],
            "contact": row["contact"] or "",
            "profile_image_path": row["profile_image_path"] or "",
            **role_payload(username=row["username"], is_admin=bool(row["is_admin"])),
        }
        for row in member_rows
    ]
    other_members = [member for member in members if int(member["id"]) != int(viewer_user_id)]

    last_message_row = conn.execute(
        """
        SELECT pm.id, pm.conversation_id, pm.user_id, pm.content, pm.timestamp, u.username, u.profile_image_path, u.is_admin
        FROM private_messages pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.conversation_id = ?
        ORDER BY datetime(pm.timestamp) DESC, pm.id DESC
        LIMIT 1
        """,
        (conversation_id,),
    ).fetchone()

    if bool(conversation_row["is_group"]):
        display_name = (conversation_row["title"] or "").strip() or ", ".join(
            member["username"] for member in other_members[:3]
        ) or "Group chat"
    else:
        display_name = other_members[0]["username"] if other_members else (members[0]["username"] if members else "Direct chat")

    return {
        "id": conversation_id,
        "title": conversation_row["title"] or "",
        "display_name": display_name,
        "is_group": bool(conversation_row["is_group"]),
        "created_at": conversation_row["created_at"],
        "members": members,
        "other_members": other_members,
        "last_message": (
            serialize_private_message_row(last_message_row, viewer_user_id=viewer_user_id)
            if last_message_row
            else None
        ),
    }


def emit_private_chat_upserted(conversation: dict[str, Any], user_ids: list[int]) -> None:
    for user_id in sorted(set(user_ids)):
        socketio.emit("private_chat_upserted", conversation, room=f"user-{user_id}")


def emit_private_message_sent(
    conversation_id: int,
    message: dict[str, Any],
    conversation: dict[str, Any],
    user_ids: list[int],
) -> None:
    payload = {
        "conversation_id": conversation_id,
        "message": message,
        "conversation": conversation,
    }
    for user_id in sorted(set(user_ids)):
        socketio.emit("private_message_sent", payload, room=f"user-{user_id}")


@socketio.on("connect")
def handle_socket_connect():
    ensure_db()

    if "user_id" not in session:
        disconnect()
        return

    user_id = int(session["user_id"])
    join_room(f"user-{user_id}")

    with get_db() as conn:
        is_admin = current_user_is_admin(conn, user_id)
        if is_admin:
            rows = conn.execute(
                "SELECT DISTINCT id FROM tasks"
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT DISTINCT t.id
                FROM tasks t
                LEFT JOIN task_users tu ON tu.task_id = t.id
                WHERE t.is_global = 1 OR tu.user_id = ?
                """,
                (user_id,),
            ).fetchall()

    for row in rows:
        join_room(f"task-{int(row['id'])}")

    with get_db() as conn:
        private_rows = conn.execute(
            """
            SELECT conversation_id
            FROM private_conversation_members
            WHERE user_id = ?
            """,
            (user_id,),
        ).fetchall()

    for row in private_rows:
        join_room(f"private-chat-{int(row['conversation_id'])}")


def extract_message_mentions(conn: sqlite3.Connection, content: str) -> list[str]:
    mention_candidates = {
        match.group(1).lower()
        for match in re.finditer(r"@([A-Za-z0-9_]{3,30})", content or "")
    }
    if not mention_candidates:
        return []

    rows = conn.execute(
        "SELECT username FROM users"
    ).fetchall()
    usernames_by_lower = {
        row["username"].lower(): row["username"]
        for row in rows
    }

    mentions = [
        usernames_by_lower[name]
        for name in mention_candidates
        if name in usernames_by_lower
    ]
    mentions.sort(key=str.lower)
    return mentions


def get_task_member_ids(conn: sqlite3.Connection, task_id: int) -> list[int]:
    rows = conn.execute(
        "SELECT user_id FROM task_users WHERE task_id = ?",
        (task_id,),
    ).fetchall()
    return [int(row["user_id"]) for row in rows]


def emit_task_created(task: dict[str, Any], user_ids: list[int]) -> None:
    for user_id in user_ids:
        socketio.emit("task_created", task, room=f"user-{user_id}")


def emit_task_updated(task: dict[str, Any], user_ids: list[int]) -> None:
    for user_id in user_ids:
        socketio.emit("task_updated", task, room=f"user-{user_id}")


def emit_subtask_updated(task: dict[str, Any], user_ids: list[int]) -> None:
    for user_id in user_ids:
        socketio.emit("subtask_updated", task, room=f"user-{user_id}")


def emit_task_deleted(task_id: int, user_ids: list[int]) -> None:
    payload = {"task_id": task_id}
    for user_id in user_ids:
        socketio.emit("task_deleted", payload, room=f"user-{user_id}")


def emit_message_sent(task_id: int, message: dict[str, Any], user_ids: list[int]) -> None:
    for user_id in user_ids:
        socketio.emit("message_sent", {"task_id": task_id, "message": message}, room=f"user-{user_id}")


def log_activity(
    conn: sqlite3.Connection,
    *,
    user_id: int,
    action: str,
    task_id: int | None,
    audience_user_ids: list[int],
) -> dict[str, Any]:
    timestamp = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        """
        INSERT INTO activity_log (user_id, action, task_id, timestamp)
        VALUES (?, ?, ?, ?)
        """,
        (user_id, action, task_id, timestamp),
    )
    username_row = conn.execute(
        "SELECT username, is_admin, profile_image_path FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    username = username_row["username"] if username_row else ""
    role_info = role_payload(
        username=username,
        is_admin=bool(username_row["is_admin"]) if username_row else False,
    )
    entry = {
        "id": int(cursor.lastrowid),
        "user_id": user_id,
        "username": username,
        "profile_image_path": username_row["profile_image_path"] if username_row and "profile_image_path" in username_row.keys() else "",
        "action": action,
        "task_id": task_id,
        "timestamp": timestamp,
        **role_info,
    }
    for audience_user_id in audience_user_ids:
        socketio.emit("activity_logged", entry, room=f"user-{audience_user_id}")
    return entry


@app.route("/")
def index():
    ensure_db()
    return render_template("index.html")


@app.route("/boot/root-login")
def boot_root_login():
    # Legacy launcher links should land on the regular login page.
    # Startup no longer performs token-based root auto-login.
    return redirect(url_for("index"))


@app.route("/api/auth/register", methods=["POST"])
def register():
    ensure_db()
    data = request.get_json(silent=True) or {}

    username = (data.get("username") or "").strip()
    contact = normalize_contact(data.get("contact") or "")
    password = data.get("password") or ""
    confirm_password = data.get("confirm_password") or ""

    if not username:
        return jsonify({"error": "Username is required."}), 400

    if not re.fullmatch(r"[A-Za-z0-9_]{3,30}", username):
        return jsonify({"error": "Username must be 3–30 characters and only use letters, numbers, or underscores."}), 400

    if username.lower() == "root":
        with get_db() as conn:
            existing_root = conn.execute(
                "SELECT id FROM users WHERE username = ? COLLATE NOCASE",
                ("root",),
            ).fetchone()
        if existing_root:
            return jsonify({"error": 'The username "root" is reserved.'}), 400

    if not contact:
        return jsonify({"error": "Email or phone number is required."}), 400

    if password != confirm_password:
        return jsonify({"error": "Passwords do not match."}), 400

    if not password_is_valid(password):
        return jsonify({"error": "Password must be at least 8 characters and include a number."}), 400

    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE username = ? COLLATE NOCASE",
            (username,),
        ).fetchone()
        if existing:
            return jsonify({"error": "Username already exists."}), 400

        existing_contact = conn.execute(
            "SELECT id FROM users WHERE contact = ?",
            (contact,),
        ).fetchone()
        if existing_contact:
            return jsonify({"error": "That email or phone number is already in use."}), 400

        is_admin = 1 if username.lower() == "root" else 0
        cursor = conn.execute(
            "INSERT INTO users (username, contact, password_hash, is_admin) VALUES (?, ?, ?, ?)",
            (username, contact, generate_password_hash(password), is_admin),
        )
        conn.commit()
        user_id = cursor.lastrowid

    with get_db() as conn:
        user = conn.execute(
            "SELECT id, username, contact, profile_image_path, is_admin FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    session["user_id"] = user_id
    session["username"] = username
    return jsonify({"user": serialize_user(user)}), 201


@app.route("/api/auth/login", methods=["POST"])
def login():
    ensure_db()
    data = request.get_json(silent=True) or {}

    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    with get_db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE",
            (username,),
        ).fetchone()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid username or password."}), 401

    session["user_id"] = user["id"]
    session["username"] = user["username"]
    return jsonify({"user": serialize_user(user)})


@app.route("/api/auth/request-reset", methods=["POST"])
def request_reset():
    ensure_db()
    data = request.get_json(silent=True) or {}
    contact = normalize_contact(data.get("contact") or "")

    if not contact:
        return jsonify({"error": "Email or phone number is required."}), 400

    with get_db() as conn:
        user = conn.execute(
            "SELECT id FROM users WHERE contact = ?",
            (contact,),
        ).fetchone()

        if not user:
            return jsonify({"error": "No account found for that email or phone number."}), 404

        conn.execute(
            "DELETE FROM password_reset_tokens WHERE user_id = ?",
            (int(user["id"]),),
        )

        token = secrets.token_urlsafe(16)
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)

        conn.execute(
            """
            INSERT INTO password_reset_tokens (user_id, token, expires_at)
            VALUES (?, ?, ?)
            """,
            (int(user["id"]), token, expires_at.isoformat()),
        )
        conn.commit()

    return jsonify(
        {
            "message": "Reset token generated.",
            "token": token,
            "expires_at": expires_at.isoformat(),
        }
    )


@app.route("/api/auth/reset-password", methods=["POST"])
def reset_password():
    ensure_db()
    data = request.get_json(silent=True) or {}

    contact = normalize_contact(data.get("contact") or "")
    token = (data.get("token") or "").strip()
    password = data.get("password") or ""
    confirm_password = data.get("confirm_password") or ""

    if not contact:
        return jsonify({"error": "Email or phone number is required."}), 400

    if not token:
        return jsonify({"error": "Reset token is required."}), 400

    if password != confirm_password:
        return jsonify({"error": "Passwords do not match."}), 400

    if not password_is_valid(password):
        return jsonify({"error": "Password must be at least 8 characters and include a number."}), 400

    with get_db() as conn:
        user = conn.execute(
            "SELECT id FROM users WHERE contact = ?",
            (contact,),
        ).fetchone()
        if not user:
            return jsonify({"error": "No account found for that email or phone number."}), 404

        token_row = conn.execute(
            """
            SELECT id, expires_at
            FROM password_reset_tokens
            WHERE user_id = ? AND token = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (int(user["id"]), token),
        ).fetchone()
        if not token_row:
            return jsonify({"error": "Invalid reset token."}), 400

        expires_at = datetime.fromisoformat(token_row["expires_at"])
        if expires_at < datetime.now(timezone.utc):
            conn.execute(
                "DELETE FROM password_reset_tokens WHERE id = ?",
                (int(token_row["id"]),),
            )
            conn.commit()
            return jsonify({"error": "Reset token has expired."}), 400

        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (generate_password_hash(password), int(user["id"])),
        )
        conn.execute(
            "DELETE FROM password_reset_tokens WHERE user_id = ?",
            (int(user["id"]),),
        )
        conn.commit()

    return jsonify({"message": "Password reset successfully."})


@app.route("/api/auth/logout", methods=["POST"])
@login_required
def logout():
    session.clear()
    return jsonify({"message": "Logged out."})


@app.route("/api/profile", methods=["GET"])
@login_required
def get_profile():
    ensure_db()
    user_id = int(session["user_id"])

    with get_db() as conn:
        user = conn.execute(
            "SELECT id, username, contact, profile_image_path, password_hash, is_admin FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    if not user:
        return jsonify({"error": "User not found."}), 404

    return jsonify({"user": serialize_user(user)})


@app.route("/api/profile/request-verification", methods=["POST"])
@login_required
def request_profile_verification():
    ensure_db()
    user_id = int(session["user_id"])

    with get_db() as conn:
        user = conn.execute(
            "SELECT id, contact FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not user:
            return jsonify({"error": "User not found."}), 404

        conn.execute(
            "DELETE FROM profile_verification_tokens WHERE user_id = ?",
            (user_id,),
        )

        token = secrets.token_urlsafe(16)
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
        conn.execute(
            """
            INSERT INTO profile_verification_tokens (user_id, token, expires_at)
            VALUES (?, ?, ?)
            """,
            (user_id, token, expires_at.isoformat()),
        )
        conn.commit()

    return jsonify(
        {
            "message": "Verification token generated.",
            "token": token,
            "expires_at": expires_at.isoformat(),
            "contact": user["contact"] or "",
        }
    )


@app.route("/api/profile", methods=["PATCH"])
@login_required
def update_profile():
    ensure_db()
    user_id = int(session["user_id"])
    data = request.get_json(silent=True) or {}

    username = (data.get("username") or "").strip()
    contact = normalize_contact(data.get("contact") or "")
    new_password = data.get("new_password") or ""
    confirm_password = data.get("confirm_password") or ""
    profile_image_data = data.get("profile_image_data") or ""

    if not username:
        return jsonify({"error": "Username is required."}), 400

    if not re.fullmatch(r"[A-Za-z0-9_]{3,30}", username):
        return jsonify({"error": "Username must be 3-30 characters and only use letters, numbers, or underscores."}), 400

    if not contact:
        return jsonify({"error": "Email or phone number is required."}), 400

    if new_password or confirm_password:
        if new_password != confirm_password:
            return jsonify({"error": "Passwords do not match."}), 400
        if not password_is_valid(new_password):
            return jsonify({"error": "Password must be at least 8 characters and include a number."}), 400

    with get_db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not user:
            return jsonify({"error": "User not found."}), 404

        if str(user["username"]).lower() == "root" and username.lower() != "root":
            return jsonify({"error": 'The root username cannot be changed.'}), 400

        if username.lower() == "root" and str(user["username"]).lower() != "root":
            return jsonify({"error": 'The username "root" is reserved.'}), 400

        existing_username = conn.execute(
            "SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?",
            (username, user_id),
        ).fetchone()
        if existing_username:
            return jsonify({"error": "Username already exists."}), 400

        existing_contact = conn.execute(
            "SELECT id FROM users WHERE contact = ? AND id != ?",
            (contact, user_id),
        ).fetchone()
        if existing_contact:
            return jsonify({"error": "That email or phone number is already in use."}), 400

        profile_image_path = user["profile_image_path"] or ""
        if profile_image_data:
            try:
                profile_image_path = save_profile_image(user_id, profile_image_data)
            except ValueError as exc:
                return jsonify({"error": str(exc)}), 400

        password_hash = user["password_hash"]
        if new_password:
            password_hash = generate_password_hash(new_password)

        conn.execute(
            """
            UPDATE users
            SET username = ?, contact = ?, profile_image_path = ?, password_hash = ?
            WHERE id = ?
            """,
            (username, contact, profile_image_path, password_hash, user_id),
        )
        conn.execute(
            "DELETE FROM profile_verification_tokens WHERE user_id = ?",
            (user_id,),
        )
        conn.commit()

        updated_user = conn.execute(
            "SELECT id, username, contact, profile_image_path, is_admin FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    session["username"] = updated_user["username"]
    return jsonify({"user": serialize_user(updated_user), "message": "Profile updated successfully."})


@app.route("/api/profile", methods=["DELETE"])
@login_required
def delete_profile():
    ensure_db()
    user_id = int(session["user_id"])
    data = request.get_json(silent=True) or {}
    current_password = data.get("current_password") or ""

    if not current_password:
        return jsonify({"error": "Current password is required."}), 400

    with get_db() as conn:
        user = conn.execute(
            "SELECT id, username, password_hash, is_admin FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not user:
            session.clear()
            return jsonify({"error": "User not found."}), 404

        if not check_password_hash(user["password_hash"], current_password):
            return jsonify({"error": "Current password is incorrect."}), 400

        if bool(user["is_admin"]) and str(user["username"]).lower() == "root":
            return jsonify({"error": "The root admin account cannot be deleted from the app."}), 400

        conn.execute(
            "DELETE FROM users WHERE id = ?",
            (user_id,),
        )
        conn.commit()

    session.clear()
    return jsonify({"message": "Account deleted successfully."})


@app.route("/api/auth/me", methods=["GET"])
def me():
    if "user_id" not in session:
        return jsonify({"user": None})
    ensure_db()
    with get_db() as conn:
        user = conn.execute(
            "SELECT id, username, contact, profile_image_path, is_admin FROM users WHERE id = ?",
            (int(session["user_id"]),),
        ).fetchone()

    if not user:
        session.clear()
        return jsonify({"user": None})

    session["username"] = user["username"]
    return jsonify({"user": serialize_user(user)})


@app.route("/api/users", methods=["GET"])
@login_required
def list_users():
    ensure_db()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT username, is_admin, profile_image_path FROM users ORDER BY username COLLATE NOCASE ASC"
        ).fetchall()
    return jsonify([
        {
            "username": row["username"],
            "profile_image_path": row["profile_image_path"] or "",
            **role_payload(username=row["username"], is_admin=bool(row["is_admin"])),
        }
        for row in rows
    ])


@app.route("/api/users/<string:username>/profile", methods=["GET"])
@login_required
def get_user_profile(username: str):
    ensure_db()
    viewer_user_id = int(session["user_id"])
    period = request.args.get("period", "1w")

    with get_db() as conn:
        viewer_is_admin = current_user_is_admin(conn, viewer_user_id)
        target = conn.execute(
            """
            SELECT id, username, contact, profile_image_path, is_admin, created_at
            FROM users
            WHERE username = ? COLLATE NOCASE
            """,
            (username,),
        ).fetchone()
        if not target:
            return jsonify({"error": "User not found."}), 404

        target_user_id = int(target["id"])
        target_username = str(target["username"])
        can_view_contact = viewer_is_admin or target_user_id == viewer_user_id

        assigned_tasks = int(
            conn.execute(
                """
                SELECT COUNT(DISTINCT tu.task_id) AS count
                FROM task_users tu
                WHERE tu.user_id = ?
                """,
                (target_user_id,),
            ).fetchone()["count"]
        )
        created_tasks = int(
            conn.execute(
                "SELECT COUNT(*) AS count FROM tasks WHERE creator_user_id = ?",
                (target_user_id,),
            ).fetchone()["count"]
        )
        overdue_tasks = int(
            conn.execute(
                """
                SELECT COUNT(*) AS count
                FROM (
                    SELECT t.id
                    FROM tasks t
                    JOIN task_users tu ON tu.task_id = t.id
                    LEFT JOIN subtasks s ON s.task_id = t.id
                    WHERE tu.user_id = ?
                    GROUP BY t.id
                    HAVING t.deadline != ''
                       AND datetime(t.deadline) < datetime('now')
                       AND NOT (
                           COUNT(s.id) > 0
                           AND SUM(CASE WHEN s.completed = 1 THEN 1 ELSE 0 END) = COUNT(s.id)
                       )
                ) overdue
                """,
                (target_user_id,),
            ).fetchone()["count"]
        )

        archived_completed_tasks = 0
        completed_rows = conn.execute(
            "SELECT data FROM completed_tasks WHERE data IS NOT NULL AND data != ''"
        ).fetchall()
        for row in completed_rows:
            try:
                task_data = json.loads(row["data"] or "{}")
            except json.JSONDecodeError:
                task_data = {}
            if completed_task_matches_user(task_data, user_id=target_user_id, username=target_username):
                archived_completed_tasks += 1

        series = build_user_completed_series(
            conn,
            user_id=target_user_id,
            username=target_username,
            period=period,
        )

    return jsonify(
        {
            "user": {
                "id": target_user_id,
                "username": target_username,
                "profile_image_path": target["profile_image_path"] or "",
                "contact": (target["contact"] or "") if can_view_contact else "",
                "created_at": target["created_at"],
                "can_view_contact": can_view_contact,
                **role_payload(username=target_username, is_admin=bool(target["is_admin"])),
            },
            "stats": {
                "assigned_tasks": assigned_tasks,
                "created_tasks": created_tasks,
                "completed_tasks": archived_completed_tasks,
                "overdue_tasks": overdue_tasks,
            },
            "series": series,
        }
    )


@app.route("/api/tasks", methods=["GET"])
@login_required
def get_tasks():
    ensure_db()
    user_id = int(session["user_id"])

    with get_db() as conn:
        is_admin = current_user_is_admin(conn, user_id)
        if is_admin:
            rows = conn.execute(
                """
                SELECT DISTINCT t.*
                FROM tasks t
                ORDER BY t.id DESC
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT DISTINCT t.*
                FROM tasks t
                LEFT JOIN task_users tu ON tu.task_id = t.id
                WHERE t.is_global = 1 OR tu.user_id = ?
                ORDER BY t.id DESC
                """,
                (user_id,),
            ).fetchall()
        tasks = [serialize_task(conn, row) for row in rows]

    return jsonify(tasks)


@app.route("/api/activity", methods=["GET"])
@login_required
def get_activity():
    ensure_db()
    user_id = int(session["user_id"])

    with get_db() as conn:
        is_admin = current_user_is_admin(conn, user_id)
        if is_admin:
            rows = conn.execute(
                """
                SELECT DISTINCT a.id, a.user_id, a.action, a.task_id, a.timestamp, u.username, u.is_admin, u.profile_image_path
                FROM activity_log a
                JOIN users u ON u.id = a.user_id
                ORDER BY datetime(a.timestamp) DESC, a.id DESC
                LIMIT 25
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT DISTINCT a.id, a.user_id, a.action, a.task_id, a.timestamp, u.username, u.is_admin, u.profile_image_path
                FROM activity_log a
                JOIN users u ON u.id = a.user_id
                LEFT JOIN task_users tu ON tu.task_id = a.task_id
                LEFT JOIN tasks t ON t.id = a.task_id
                WHERE a.task_id IS NULL OR t.is_global = 1 OR tu.user_id = ? OR a.user_id = ?
                ORDER BY datetime(a.timestamp) DESC, a.id DESC
                LIMIT 25
                """,
                (user_id, user_id),
            ).fetchall()

    return jsonify(
        [
            {
                "id": int(row["id"]),
                "user_id": int(row["user_id"]),
                "username": row["username"],
                "profile_image_path": row["profile_image_path"] or "",
                "action": row["action"],
                "task_id": int(row["task_id"]) if row["task_id"] is not None else None,
                "timestamp": row["timestamp"],
                **role_payload(username=row["username"], is_admin=bool(row["is_admin"])),
            }
            for row in rows
        ]
    )


@app.route("/api/updates", methods=["GET"])
def get_updates():
    updates = sorted(
        UPDATE_LOG,
        key=lambda entry: (entry.get("date", ""), entry.get("version", "")),
        reverse=True,
    )
    return jsonify(updates)


@app.route("/api/task-templates", methods=["GET"])
@login_required
def get_task_templates():
    ensure_db()
    user_id = int(session["user_id"])

    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM task_templates
            WHERE user_id = ?
            ORDER BY datetime(updated_at) DESC, id DESC
            """,
            (user_id,),
        ).fetchall()
        templates = [serialize_task_template(conn, row) for row in rows]

    return jsonify(templates)


@app.route("/api/task-templates", methods=["POST"])
@login_required
def create_task_template():
    ensure_db()
    user_id = int(session["user_id"])
    data = request.get_json(silent=True) or {}

    name = (data.get("name") or "").strip()
    description = (data.get("description") or "").strip()
    default_priority = normalize_template_priority(data.get("default_priority"))

    if not name:
        return jsonify({"error": "Template name is required."}), 400

    try:
        default_deadline_offset_hours = normalize_template_deadline_offset_hours(
            data.get("default_deadline_offset_hours")
        )
        subtasks = normalize_template_subtasks(data.get("subtasks") or [])
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    timestamp = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO task_templates (user_id, name, description, default_priority, default_deadline_offset_hours, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                name,
                description,
                default_priority,
                default_deadline_offset_hours,
                timestamp,
                timestamp,
            ),
        )
        template_id = int(cursor.lastrowid)
        replace_task_template_subtasks(conn, template_id, subtasks)
        conn.commit()
        row = conn.execute(
            "SELECT * FROM task_templates WHERE id = ?",
            (template_id,),
        ).fetchone()
        template = serialize_task_template(conn, row)

    return jsonify(template), 201


@app.route("/api/task-templates/<int:template_id>", methods=["PATCH"])
@login_required
def update_task_template(template_id: int):
    ensure_db()
    user_id = int(session["user_id"])
    data = request.get_json(silent=True) or {}

    with get_db() as conn:
        existing = conn.execute(
            "SELECT * FROM task_templates WHERE id = ? AND user_id = ?",
            (template_id, user_id),
        ).fetchone()
        if not existing:
            return jsonify({"error": "Template not found."}), 404

        name = (data.get("name", existing["name"]) or "").strip()
        description = (data.get("description", existing["description"]) or "").strip()
        default_priority = normalize_template_priority(
            data.get("default_priority", existing["default_priority"])
        )
        if not name:
            return jsonify({"error": "Template name is required."}), 400

        try:
            default_deadline_offset_hours = normalize_template_deadline_offset_hours(
                data.get("default_deadline_offset_hours", existing["default_deadline_offset_hours"])
            )
            subtasks = normalize_template_subtasks(data.get("subtasks") or [])
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        conn.execute(
            """
            UPDATE task_templates
            SET name = ?, description = ?, default_priority = ?, default_deadline_offset_hours = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (
                name,
                description,
                default_priority,
                default_deadline_offset_hours,
                datetime.now(timezone.utc).isoformat(),
                template_id,
                user_id,
            ),
        )
        replace_task_template_subtasks(conn, template_id, subtasks)
        conn.commit()
        row = conn.execute(
            "SELECT * FROM task_templates WHERE id = ?",
            (template_id,),
        ).fetchone()
        template = serialize_task_template(conn, row)

    return jsonify(template)


@app.route("/api/task-templates/<int:template_id>", methods=["DELETE"])
@login_required
def delete_task_template(template_id: int):
    ensure_db()
    user_id = int(session["user_id"])

    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM task_templates WHERE id = ? AND user_id = ?",
            (template_id, user_id),
        ).fetchone()
        if not existing:
            return jsonify({"error": "Template not found."}), 404
        conn.execute(
            "DELETE FROM task_templates WHERE id = ? AND user_id = ?",
            (template_id, user_id),
        )
        conn.commit()

    return jsonify({"success": True})


@app.route("/api/private-chats", methods=["GET"])
@login_required
def get_private_chats():
    ensure_db()
    user_id = int(session["user_id"])

    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT DISTINCT pc.*
            FROM private_conversations pc
            JOIN private_conversation_members pcm ON pcm.conversation_id = pc.id
            WHERE pcm.user_id = ?
            ORDER BY COALESCE(
                (
                    SELECT MAX(datetime(pm.timestamp))
                    FROM private_messages pm
                    WHERE pm.conversation_id = pc.id
                ),
                datetime(pc.created_at)
            ) DESC,
            pc.id DESC
            """,
            (user_id,),
        ).fetchall()
        conversations = [
            serialize_private_conversation(conn, row, viewer_user_id=user_id)
            for row in rows
        ]

    return jsonify(conversations)


@app.route("/api/private-chats/direct", methods=["POST"])
@login_required
def open_or_create_direct_private_chat():
    ensure_db()
    user_id = int(session["user_id"])
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()

    if not username:
        return jsonify({"error": "Username is required."}), 400

    with get_db() as conn:
        actor = conn.execute(
            "SELECT username FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        target = conn.execute(
            """
            SELECT id, username
            FROM users
            WHERE username = ? COLLATE NOCASE
            """,
            (username,),
        ).fetchone()
        if not target:
            return jsonify({"error": "User not found."}), 404
        if int(target["id"]) == user_id:
            return jsonify({"error": "You cannot text yourself, you silly billy."}), 400

        existing = find_direct_conversation_between(conn, user_id, int(target["id"]))
        created = False
        if existing:
            conversation_row = existing
        else:
            timestamp = datetime.now(timezone.utc).isoformat()
            cursor = conn.execute(
                """
                INSERT INTO private_conversations (title, is_group, created_by_user_id, created_at)
                VALUES (?, 0, ?, ?)
                """,
                ("", user_id, timestamp),
            )
            conversation_id = int(cursor.lastrowid)
            conn.executemany(
                """
                INSERT INTO private_conversation_members (conversation_id, user_id)
                VALUES (?, ?)
                """,
                [
                    (conversation_id, user_id),
                    (conversation_id, int(target["id"])),
                ],
            )
            conn.commit()
            conversation_row = conn.execute(
                "SELECT * FROM private_conversations WHERE id = ?",
                (conversation_id,),
            ).fetchone()
            created = True

        conversation = serialize_private_conversation(conn, conversation_row, viewer_user_id=user_id)

        if created:
            audience_user_ids = get_private_conversation_member_ids(conn, int(conversation_row["id"]))
            for member_user_id in audience_user_ids:
                viewer_row = conn.execute(
                    "SELECT * FROM private_conversations WHERE id = ?",
                    (int(conversation_row["id"]),),
                ).fetchone()
                viewer_conversation = serialize_private_conversation(conn, viewer_row, viewer_user_id=member_user_id)
                socketio.emit("private_chat_upserted", viewer_conversation, room=f"user-{member_user_id}")
            log_activity(
                conn,
                user_id=user_id,
                action=f'started a private chat with "{target["username"]}"',
                task_id=None,
                audience_user_ids=audience_user_ids,
            )
            conn.commit()

    return jsonify({"conversation": conversation, "created": created}), 201 if created else 200


@app.route("/api/private-chats/<int:conversation_id>/messages", methods=["GET"])
@login_required
def get_private_chat_messages(conversation_id: int):
    ensure_db()
    user_id = int(session["user_id"])

    with get_db() as conn:
        conversation = get_private_conversation_row_for_user(conn, conversation_id, user_id)
        if not conversation:
            return jsonify({"error": "Private chat not found."}), 404

        rows = conn.execute(
            """
            SELECT pm.id, pm.conversation_id, pm.user_id, pm.content, pm.timestamp, u.username, u.profile_image_path, u.is_admin
            FROM private_messages pm
            JOIN users u ON u.id = pm.user_id
            WHERE pm.conversation_id = ?
            ORDER BY datetime(pm.timestamp) ASC, pm.id ASC
            """,
            (conversation_id,),
        ).fetchall()

    return jsonify([
        serialize_private_message_row(row, viewer_user_id=user_id)
        for row in rows
    ])


@app.route("/api/private-chats/<int:conversation_id>/messages", methods=["POST"])
@login_required
def create_private_chat_message(conversation_id: int):
    ensure_db()
    user_id = int(session["user_id"])
    data = request.get_json(silent=True) or {}
    content = (data.get("content") or "").strip()

    if not content:
        return jsonify({"error": "Message content is required."}), 400

    with get_db() as conn:
        conversation = get_private_conversation_row_for_user(conn, conversation_id, user_id)
        if not conversation:
            return jsonify({"error": "Private chat not found."}), 404

        timestamp = datetime.now(timezone.utc).isoformat()
        cursor = conn.execute(
            """
            INSERT INTO private_messages (conversation_id, user_id, content, timestamp)
            VALUES (?, ?, ?, ?)
            """,
            (conversation_id, user_id, content, timestamp),
        )
        conn.commit()

        row = conn.execute(
            """
            SELECT pm.id, pm.conversation_id, pm.user_id, pm.content, pm.timestamp, u.username, u.profile_image_path, u.is_admin
            FROM private_messages pm
            JOIN users u ON u.id = pm.user_id
            WHERE pm.id = ?
            """,
            (int(cursor.lastrowid),),
        ).fetchone()
        audience_user_ids = get_private_conversation_member_ids(conn, conversation_id)

        for member_user_id in audience_user_ids:
            viewer_row = conn.execute(
                "SELECT * FROM private_conversations WHERE id = ?",
                (conversation_id,),
            ).fetchone()
            viewer_conversation = serialize_private_conversation(conn, viewer_row, viewer_user_id=member_user_id)
            viewer_message = serialize_private_message_row(row, viewer_user_id=member_user_id)
            emit_private_message_sent(conversation_id, viewer_message, viewer_conversation, [member_user_id])
        conn.commit()

    return jsonify(serialize_private_message_row(row, viewer_user_id=user_id)), 201


@app.route("/api/tasks/<int:task_id>/messages", methods=["GET"])
@login_required
def get_task_messages(task_id: int):
    ensure_db()
    user_id = int(session["user_id"])

    with get_db() as conn:
        is_admin = current_user_is_admin(conn, user_id)
        task = task_row_for_access(conn, task_id, user_id, is_admin=is_admin)
        if not task:
            return jsonify({"error": "Task not found."}), 404

        rows = conn.execute(
            """
            SELECT m.id, m.content, m.timestamp, m.has_mentions, m.mentioned_usernames, u.username, u.is_admin, u.profile_image_path
            FROM messages m
            JOIN users u ON u.id = m.user_id
            WHERE m.task_id = ?
            ORDER BY datetime(m.timestamp) ASC, m.id ASC
            """,
            (task_id,),
        ).fetchall()

    return jsonify(
        [
            {
                "id": int(row["id"]),
                "username": row["username"],
                "profile_image_path": row["profile_image_path"] or "",
                "content": row["content"],
                "timestamp": row["timestamp"],
                "has_mentions": bool(row["has_mentions"]),
                "mentioned_usernames": json.loads(row["mentioned_usernames"] or "[]"),
                "mentions_current_user": session.get("username", "").lower() in {
                    username.lower() for username in json.loads(row["mentioned_usernames"] or "[]")
                },
                **role_payload(username=row["username"], is_admin=bool(row["is_admin"])),
            }
            for row in rows
        ]
    )


@app.route("/api/tasks/<int:task_id>/messages", methods=["POST"])
@login_required
def create_task_message(task_id: int):
    ensure_db()
    user_id = int(session["user_id"])
    data = request.get_json(silent=True) or {}
    content = (data.get("content") or "").strip()

    if not content:
        return jsonify({"error": "Message content is required."}), 400

    with get_db() as conn:
        is_admin = current_user_is_admin(conn, user_id)
        task = task_row_for_access(conn, task_id, user_id, is_admin=is_admin)
        if not task:
            return jsonify({"error": "Task not found."}), 404

        audience_user_ids = get_task_audience_user_ids(conn, task)
        mentioned_usernames = extract_message_mentions(conn, content)
        timestamp = datetime.now(timezone.utc).isoformat()
        cursor = conn.execute(
            """
            INSERT INTO messages (task_id, user_id, content, has_mentions, mentioned_usernames, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                user_id,
                content,
                1 if mentioned_usernames else 0,
                json.dumps(mentioned_usernames),
                timestamp,
            ),
        )
        conn.commit()

        row = conn.execute(
            """
            SELECT m.id, m.content, m.timestamp, m.has_mentions, m.mentioned_usernames, u.username, u.is_admin, u.profile_image_path
            FROM messages m
            JOIN users u ON u.id = m.user_id
            WHERE m.id = ?
            """,
            (int(cursor.lastrowid),),
        ).fetchone()
        audience_user_ids = sorted(set(audience_user_ids))

    message = {
        "id": int(row["id"]),
        "username": row["username"],
        "profile_image_path": row["profile_image_path"] or "",
        "content": row["content"],
        "timestamp": row["timestamp"],
        "has_mentions": bool(row["has_mentions"]),
        "mentioned_usernames": json.loads(row["mentioned_usernames"] or "[]"),
        "mentions_current_user": session.get("username", "").lower() in {
            username.lower() for username in json.loads(row["mentioned_usernames"] or "[]")
        },
        **role_payload(username=row["username"], is_admin=bool(row["is_admin"])),
    }
    emit_message_sent(task_id, message, audience_user_ids)
    return jsonify(message), 201


@app.route("/api/tasks", methods=["POST"])
@login_required
def create_task():
    ensure_db()
    data = request.get_json(silent=True) or {}

    title = (data.get("title") or "").strip()
    description = (data.get("description") or "").strip()
    deadline = (data.get("deadline") or "").strip()
    priority = (data.get("priority") or "medium").strip().lower()
    members_raw = data.get("members") or []
    is_global = bool(data.get("is_global"))
    global_edit_mode = normalize_global_edit_mode(data.get("global_edit_mode"))
    main_image_data = (data.get("main_image_data") or "").strip()
    banner_image_data = (data.get("banner_image_data") or "").strip()
    attachments_data = data.get("attachments_data") or []
    materials_data = data.get("materials_data") or []
    template_subtasks_data = data.get("template_subtasks") or []

    if not title:
        return jsonify({"error": "Task title is required."}), 400

    if priority not in {"low", "medium", "high"}:
        priority = "medium"

    creator_user_id = int(session["user_id"])

    with get_db() as conn:
        try:
            task_materials = normalize_task_materials_config(materials_data)
            template_subtasks = normalize_template_subtasks(template_subtasks_data)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        cursor = conn.execute(
            """
            INSERT INTO tasks (title, description, deadline, priority, collapsed, creator_user_id, main_image_path, banner_image_path, materials_config, is_global, global_edit_mode)
            VALUES (?, ?, ?, ?, 0, ?, '', '', ?, ?, ?)
            """,
            (
                title,
                description,
                deadline,
                priority,
                creator_user_id,
                json.dumps(task_materials),
                1 if is_global else 0,
                global_edit_mode,
            ),
        )
        task_id = cursor.lastrowid

        main_image_path = ""
        banner_image_path = ""
        try:
            if main_image_data:
                main_image_path = save_task_image(int(task_id), "main", main_image_data)
            if banner_image_data:
                banner_image_path = save_task_image(int(task_id), "banner", banner_image_data)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        if main_image_path or banner_image_path:
            conn.execute(
                """
                UPDATE tasks
                SET main_image_path = ?, banner_image_path = ?
                WHERE id = ?
                """,
                (main_image_path, banner_image_path, int(task_id)),
            )

        if not isinstance(attachments_data, list):
            return jsonify({"error": "Attachments payload is invalid."}), 400

        try:
            for item in attachments_data:
                saved = save_task_attachment(int(task_id), item or {})
                conn.execute(
                    """
                    INSERT INTO task_attachments (task_id, original_name, stored_path, mime_type, size_bytes)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        int(task_id),
                        saved["original_name"],
                        saved["stored_path"],
                        saved["mime_type"],
                        int(saved["size_bytes"]),
                    ),
                )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        user_ids_to_attach = {creator_user_id}

        if isinstance(members_raw, list):
            for username in members_raw:
                clean_name = str(username).strip()
                if not clean_name:
                    continue
                row = conn.execute(
                    "SELECT id FROM users WHERE username = ? COLLATE NOCASE",
                    (clean_name,),
                ).fetchone()
                if row:
                    user_ids_to_attach.add(int(row["id"]))

        for uid in user_ids_to_attach:
            conn.execute(
                "INSERT OR IGNORE INTO task_users (task_id, user_id) VALUES (?, ?)",
                (task_id, uid),
            )

        for index, subtask in enumerate(template_subtasks):
            conn.execute(
                """
                INSERT INTO subtasks (task_id, title, completed, deadline, priority, requirement_type, requirement_config, position)
                VALUES (?, ?, 0, '', ?, '', '', ?)
                """,
                (
                    int(task_id),
                    subtask["title"],
                    priority,
                    index,
                ),
            )

        conn.commit()
        task = fetch_task_for_user(conn, task_id, creator_user_id)
        realtime_user_ids = get_task_audience_user_ids(conn, task)
        log_activity(
            conn,
            user_id=creator_user_id,
            action=f'created task "{title}"',
            task_id=task_id,
            audience_user_ids=realtime_user_ids,
        )
        joined_usernames = sorted(
            {
                str(username).strip()
                for username in members_raw
                if str(username).strip() and str(username).strip().lower() != session["username"].lower()
            },
            key=str.lower,
        )
        for joined_username in joined_usernames:
            log_activity(
                conn,
                user_id=creator_user_id,
                action=f'added {joined_username} to task "{title}"',
                task_id=task_id,
                audience_user_ids=realtime_user_ids,
            )
        conn.commit()

    emit_task_created(task, realtime_user_ids)
    return jsonify(task), 201


@app.route("/api/tasks/<int:task_id>", methods=["PATCH"])
@login_required
def update_task(task_id: int):
    ensure_db()
    data = request.get_json(silent=True) or {}
    user_id = int(session["user_id"])

    with get_db() as conn:
        is_admin = current_user_is_admin(conn, user_id)
        existing = task_row_for_access(conn, task_id, user_id, is_admin=is_admin)

        if not existing:
            return jsonify({"error": "Task not found."}), 404
        if not user_can_edit_task_row(conn, existing, user_id, is_admin=is_admin):
            return jsonify({"error": "You do not have permission to edit this task."}), 403
        previous_audience_user_ids = set(get_task_audience_user_ids(conn, existing))

        title = (data.get("title", existing["title"]) or "").strip()
        description = (data.get("description", existing["description"]) or "").strip()
        deadline = (data.get("deadline", existing["deadline"]) or "").strip()
        priority = (data.get("priority", existing["priority"]) or "medium").strip().lower()
        is_global = 1 if bool(data.get("is_global", existing["is_global"] if "is_global" in existing.keys() else False)) else 0
        global_edit_mode = normalize_global_edit_mode(data.get("global_edit_mode", existing["global_edit_mode"] if "global_edit_mode" in existing.keys() else "members"))
        collapsed = 1 if bool(data.get("collapsed", existing["collapsed"])) else 0
        main_image_data = (data.get("main_image_data") or "").strip()
        banner_image_data = (data.get("banner_image_data") or "").strip()
        remove_main_image = bool(data.get("remove_main_image"))
        remove_banner_image = bool(data.get("remove_banner_image"))
        attachments_data = data.get("attachments_data") or []
        remove_attachment_ids = data.get("remove_attachment_ids") or []
        materials_data = data.get("materials_data", existing["materials_config"] if "materials_config" in existing.keys() else "[]")
        main_image_path = existing["main_image_path"] if "main_image_path" in existing.keys() else ""
        banner_image_path = existing["banner_image_path"] if "banner_image_path" in existing.keys() else ""

        if not title:
            return jsonify({"error": "Task title is required."}), 400

        if priority not in {"low", "medium", "high"}:
            priority = "medium"

        next_main_image_path = main_image_path
        next_banner_image_path = banner_image_path
        try:
            if main_image_data:
                next_main_image_path = save_task_image(task_id, "main", main_image_data)
            elif remove_main_image:
                next_main_image_path = ""

            if banner_image_data:
                next_banner_image_path = save_task_image(task_id, "banner", banner_image_data)
            elif remove_banner_image:
                next_banner_image_path = ""
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        if main_image_path and main_image_path != next_main_image_path:
            remove_uploaded_file(main_image_path)
        if banner_image_path and banner_image_path != next_banner_image_path:
            remove_uploaded_file(banner_image_path)

        main_image_path = next_main_image_path
        banner_image_path = next_banner_image_path

        if not isinstance(attachments_data, list):
            return jsonify({"error": "Attachments payload is invalid."}), 400
        if not isinstance(remove_attachment_ids, list):
            return jsonify({"error": "Attachment removal payload is invalid."}), 400
        try:
            task_materials = normalize_task_materials_config(materials_data)
            validate_task_materials_against_subtasks(conn, task_id, task_materials)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        attachment_rows = conn.execute(
            "SELECT id, stored_path FROM task_attachments WHERE task_id = ?",
            (task_id,),
        ).fetchall()
        attachment_map = {int(row["id"]): row["stored_path"] for row in attachment_rows}
        for attachment_id in {int(item) for item in remove_attachment_ids if str(item).strip().isdigit()}:
            stored_path = attachment_map.get(attachment_id)
            if not stored_path:
                continue
            conn.execute(
                "DELETE FROM task_attachments WHERE id = ? AND task_id = ?",
                (attachment_id, task_id),
            )
            remove_uploaded_file(stored_path)

        try:
            for item in attachments_data:
                saved = save_task_attachment(task_id, item or {})
                conn.execute(
                    """
                    INSERT INTO task_attachments (task_id, original_name, stored_path, mime_type, size_bytes)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        task_id,
                        saved["original_name"],
                        saved["stored_path"],
                        saved["mime_type"],
                        int(saved["size_bytes"]),
                    ),
                )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        conn.execute(
            """
            UPDATE tasks
            SET title = ?, description = ?, deadline = ?, priority = ?, collapsed = ?, main_image_path = ?, banner_image_path = ?, materials_config = ?, is_global = ?, global_edit_mode = ?
            WHERE id = ?
            """,
            (
                title,
                description,
                deadline,
                priority,
                collapsed,
                main_image_path,
                banner_image_path,
                json.dumps(task_materials),
                is_global,
                global_edit_mode,
                task_id,
            ),
        )
        conn.commit()
        updated_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        realtime_user_ids = get_task_audience_user_ids(conn, updated_row)
        task = fetch_task_for_access(conn, task_id, user_id, is_admin=is_admin)

    next_audience_user_ids = set(realtime_user_ids)
    removed_user_ids = sorted(previous_audience_user_ids - next_audience_user_ids)
    added_user_ids = sorted(next_audience_user_ids - previous_audience_user_ids)
    staying_user_ids = sorted(next_audience_user_ids & previous_audience_user_ids)

    if removed_user_ids:
        emit_task_deleted(task_id, removed_user_ids)
    if added_user_ids:
        emit_task_created(task, added_user_ids)
    emit_task_updated(task, staying_user_ids)
    return jsonify(task)


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
@login_required
def delete_task(task_id: int):
    ensure_db()
    user_id = int(session["user_id"])

    with get_db() as conn:
        is_admin = current_user_is_admin(conn, user_id)
        existing = task_row_for_access(conn, task_id, user_id, is_admin=is_admin)
        if not existing:
            return jsonify({"error": "Task not found."}), 404
        if not user_can_delete_task_row(conn, existing, user_id, is_admin=is_admin):
            return jsonify({"error": "You do not have permission to delete this task."}), 403

        realtime_user_ids = get_task_audience_user_ids(conn, existing)
        task_snapshot = serialize_task(conn, existing)
        remove_uploaded_file(task_snapshot.get("main_image_path") or "")
        remove_uploaded_file(task_snapshot.get("banner_image_path") or "")
        for attachment in task_snapshot.get("attachments") or []:
            remove_uploaded_file(attachment.get("path") or "")
        for subtask in task_snapshot.get("subtasks") or []:
            for submission in subtask.get("requirement_submissions") or []:
                remove_uploaded_file(submission.get("path") or "")
        log_activity(
            conn,
            user_id=user_id,
            action=f'deleted task "{task_snapshot["title"]}"',
            task_id=task_id,
            audience_user_ids=realtime_user_ids,
        )
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()

    emit_task_deleted(task_id, realtime_user_ids)
    return jsonify({"message": "Task deleted."})


@app.route("/api/tasks/<int:task_id>/confirm-complete", methods=["POST"])
@login_required
def confirm_task_completion(task_id: int):
    ensure_db()
    user_id = int(session["user_id"])

    with get_db() as conn:
        is_admin = current_user_is_admin(conn, user_id)
        confirmer_row = conn.execute(
            "SELECT username, profile_image_path, is_admin FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        existing = task_row_for_access(conn, task_id, user_id, is_admin=is_admin)
        if not existing:
            return jsonify({"error": "Task not found."}), 404
        if not user_can_delete_task_row(conn, existing, user_id, is_admin=is_admin):
            return jsonify({"error": "You do not have permission to complete this task."}), 403

        task_snapshot = serialize_task(conn, existing)
        if int(task_snapshot["progress"]) < 100:
            return jsonify({"error": "Task is not ready for completion confirmation."}), 400

        completed_at = datetime.now(timezone.utc).isoformat()
        completed_by_payload = {
            "id": user_id,
            "username": confirmer_row["username"] if confirmer_row else session.get("username", ""),
            "profile_image_path": confirmer_row["profile_image_path"] if confirmer_row else "",
            **role_payload(
                username=confirmer_row["username"] if confirmer_row else session.get("username", ""),
                is_admin=bool(confirmer_row["is_admin"]) if confirmer_row else False,
            ),
        }
        task_snapshot["completed_at"] = completed_at
        task_snapshot["completed_by"] = completed_by_payload
        task_snapshot["completed_by_user_id"] = user_id
        task_snapshot["completed_by_username"] = completed_by_payload["username"]

        realtime_user_ids = get_task_audience_user_ids(conn, existing)
        conn.execute(
            """
            INSERT INTO completed_tasks (
                title,
                description,
                completed_at,
                completed_by_user_id,
                completed_by_username,
                worked_on_usernames,
                data
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_snapshot["title"],
                task_snapshot["description"],
                completed_at,
                user_id,
                completed_by_payload["username"],
                json.dumps(task_snapshot.get("members") or []),
                json.dumps(task_snapshot),
            ),
        )
        remove_uploaded_file(task_snapshot.get("main_image_path") or "")
        remove_uploaded_file(task_snapshot.get("banner_image_path") or "")
        for attachment in task_snapshot.get("attachments") or []:
            remove_uploaded_file(attachment.get("path") or "")
        for subtask in task_snapshot.get("subtasks") or []:
            for submission in subtask.get("requirement_submissions") or []:
                remove_uploaded_file(submission.get("path") or "")
        log_activity(
            conn,
            user_id=user_id,
            action=f'confirmed completion of task "{task_snapshot["title"]}"',
            task_id=task_id,
            audience_user_ids=realtime_user_ids,
        )
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()

    emit_task_deleted(task_id, realtime_user_ids)
    return jsonify({"message": "Task completion confirmed.", "task_id": task_id})


@app.route("/api/completed-tasks", methods=["GET"])
@login_required
def get_completed_tasks():
    ensure_db()
    viewer_user_id = int(session["user_id"])
    user_query = (request.args.get("user") or "").strip().lower()

    with get_db() as conn:
        viewer = conn.execute(
            "SELECT username, is_admin FROM users WHERE id = ?",
            (viewer_user_id,),
        ).fetchone()
        viewer_username = str(viewer["username"] or "") if viewer else ""
        viewer_is_admin = bool(viewer["is_admin"]) if viewer else False

        rows = conn.execute(
            """
            SELECT id, title, description, completed_at, completed_by_user_id, completed_by_username, worked_on_usernames, data
            FROM completed_tasks
            ORDER BY datetime(completed_at) DESC, id DESC
            """
        ).fetchall()

        archives = []
        for row in rows:
            archive, task_data = parse_completed_task_archive_row(row)
            if not viewer_is_admin and not completed_task_matches_user(
                task_data,
                user_id=viewer_user_id,
                username=viewer_username,
            ):
                continue

            if user_query:
                if user_query not in completed_task_search_usernames(task_data):
                    continue

            archives.append(archive)

    return jsonify(archives)


@app.route("/api/tasks/<int:task_id>/subtasks", methods=["POST"])
@login_required
def create_subtask(task_id: int):
    ensure_db()
    data = request.get_json(silent=True) or {}
    user_id = int(session["user_id"])

    title = (data.get("title") or "").strip()
    deadline = (data.get("deadline") or "").strip()
    priority = (data.get("priority") or "medium").strip().lower()
    requirement_type = normalize_subtask_requirement_type(data.get("requirement_type"))
    requirement_config = ""

    if not title:
        return jsonify({"error": "Subtask title is required."}), 400

    if priority not in {"low", "medium", "high"}:
        priority = "medium"

    with get_db() as conn:
        is_admin = current_user_is_admin(conn, user_id)
        task = task_row_for_access(conn, task_id, user_id, is_admin=is_admin)

        if not task:
            return jsonify({"error": "Task not found."}), 404
        if not user_can_edit_task_row(conn, task, user_id, is_admin=is_admin):
            return jsonify({"error": "You do not have permission to edit this task."}), 403
        if requirement_type == "materials":
            try:
                requirement_config = normalize_material_requirement_config(data.get("requirement_config"))
                validate_material_requirement_for_task(
                    conn,
                    int(task["id"]),
                    parse_material_requirement_config(requirement_config) or {},
                )
            except ValueError as exc:
                return jsonify({"error": str(exc)}), 400

        max_position_row = conn.execute(
            "SELECT COALESCE(MAX(position), -1) AS max_pos FROM subtasks WHERE task_id = ?",
            (task_id,),
        ).fetchone()
        next_position = int(max_position_row["max_pos"]) + 1

        conn.execute(
            """
            INSERT INTO subtasks (task_id, title, completed, deadline, priority, requirement_type, requirement_config, position)
            VALUES (?, ?, 0, ?, ?, ?, ?, ?)
            """,
            (task_id, title, deadline, priority, requirement_type, requirement_config, next_position),
        )
        conn.commit()
        realtime_user_ids = get_task_audience_user_ids(conn, task)
        updated = fetch_task_for_access(conn, task_id, user_id, is_admin=is_admin)

    emit_subtask_updated(updated, realtime_user_ids)
    return jsonify(updated), 201


@app.route("/api/subtasks/<int:subtask_id>", methods=["PATCH"])
@login_required
def update_subtask(subtask_id: int):
    ensure_db()
    data = request.get_json(silent=True) or {}
    user_id = int(session["user_id"])

    with get_db() as conn:
        is_admin = current_user_is_admin(conn, user_id)
        existing = conn.execute(
            """
            SELECT s.*, t.id AS task_id_ref
            FROM subtasks s
            JOIN tasks t ON t.id = s.task_id
            WHERE s.id = ?
            """,
            (subtask_id,),
        ).fetchone()

        if not existing:
            return jsonify({"error": "Subtask not found."}), 404
        task_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (int(existing["task_id_ref"]),)).fetchone()
        if not user_can_edit_task_row(conn, task_row, user_id, is_admin=is_admin):
            return jsonify({"error": "You do not have permission to edit this task."}), 403

        title = (data.get("title", existing["title"]) or "").strip()
        deadline = (data.get("deadline", existing["deadline"]) or "").strip()
        priority = (data.get("priority", existing["priority"]) or "medium").strip().lower()
        requirement_type = normalize_subtask_requirement_type(
            data.get("requirement_type", existing["requirement_type"] if "requirement_type" in existing.keys() else "")
        )
        raw_requirement_config = data.get("requirement_config", existing["requirement_config"] if "requirement_config" in existing.keys() else "")
        requirement_config = (raw_requirement_config or "").strip() if isinstance(raw_requirement_config, str) else raw_requirement_config
        completed = 1 if bool(data.get("completed", existing["completed"])) else 0

        if not title:
            return jsonify({"error": "Subtask title is required."}), 400

        if priority not in {"low", "medium", "high"}:
            priority = "medium"

        if requirement_type == "materials":
            try:
                requirement_config = normalize_material_requirement_config(requirement_config)
                validate_material_requirement_for_task(
                    conn,
                    int(existing["task_id_ref"]),
                    parse_material_requirement_config(requirement_config) or {},
                    exclude_subtask_id=subtask_id,
                )
            except ValueError as exc:
                return jsonify({"error": str(exc)}), 400
        elif requirement_type == "file":
            requirement_config = ""
        elif requirement_type != "file":
            requirement_config = ""

        previous_requirement_type = normalize_subtask_requirement_type(existing["requirement_type"] if "requirement_type" in existing.keys() else "")
        if previous_requirement_type != requirement_type:
            if requirement_type != "file":
                remove_subtask_requirement_files(conn, subtask_id)
            if requirement_type and not is_subtask_requirement_satisfied(conn, subtask_id, requirement_type):
                completed = 0

        if completed == 1 and not is_subtask_requirement_satisfied(conn, subtask_id, requirement_type):
            return jsonify({"error": "This subtask requirement must be satisfied before completion."}), 400

        conn.execute(
            """
            UPDATE subtasks
            SET title = ?, completed = ?, deadline = ?, priority = ?, requirement_type = ?, requirement_config = ?
            WHERE id = ?
            """,
            (title, completed, deadline, priority, requirement_type, requirement_config, subtask_id),
        )
        task_id = int(existing["task_id_ref"])
        realtime_user_ids = get_task_audience_user_ids(conn, task_row)
        if completed == 1 and int(existing["completed"]) != 1:
            log_activity(
                conn,
                user_id=user_id,
                action=f'completed subtask "{title}"',
                task_id=task_id,
                audience_user_ids=realtime_user_ids,
            )
        conn.commit()
        updated = fetch_task_for_access(conn, task_id, user_id, is_admin=is_admin)

    emit_subtask_updated(updated, realtime_user_ids)
    return jsonify(updated)


@app.route("/api/subtasks/<int:subtask_id>", methods=["DELETE"])
@login_required
def delete_subtask(subtask_id: int):
    ensure_db()
    user_id = int(session["user_id"])

    with get_db() as conn:
        is_admin = current_user_is_admin(conn, user_id)
        existing = conn.execute(
            """
            SELECT s.*, t.id AS task_id_ref
            FROM subtasks s
            JOIN tasks t ON t.id = s.task_id
            WHERE s.id = ?
            """,
            (subtask_id,),
        ).fetchone()

        if not existing:
            return jsonify({"error": "Subtask not found."}), 404

        task_id = int(existing["task_id_ref"])
        task_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not user_can_edit_task_row(conn, task_row, user_id, is_admin=is_admin):
            return jsonify({"error": "You do not have permission to edit this task."}), 403
        remove_subtask_requirement_files(conn, subtask_id)
        conn.execute("DELETE FROM subtasks WHERE id = ?", (subtask_id,))
        conn.commit()
        realtime_user_ids = get_task_audience_user_ids(conn, task_row)
        updated = fetch_task_for_access(conn, task_id, user_id, is_admin=is_admin)

    emit_subtask_updated(updated, realtime_user_ids)
    return jsonify(updated)


@app.route("/api/subtasks/<int:subtask_id>/requirement-submission", methods=["POST"])
@login_required
def submit_subtask_requirement(subtask_id: int):
    ensure_db()
    data = request.get_json(silent=True) or {}
    user_id = int(session["user_id"])

    with get_db() as conn:
        is_admin = current_user_is_admin(conn, user_id)
        existing = conn.execute(
            """
            SELECT s.*, t.id AS task_id_ref
            FROM subtasks s
            JOIN tasks t ON t.id = s.task_id
            WHERE s.id = ?
            """,
            (subtask_id,),
        ).fetchone()

        if not existing:
            return jsonify({"error": "Subtask not found."}), 404

        task_id = int(existing["task_id_ref"])
        task_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not user_can_edit_task_row(conn, task_row, user_id, is_admin=is_admin):
            return jsonify({"error": "You do not have permission to update this task."}), 403

        requirement_type = normalize_subtask_requirement_type(existing["requirement_type"] if "requirement_type" in existing.keys() else "")
        if requirement_type != "file":
            return jsonify({"error": "This subtask does not require a file submission."}), 400

        try:
            saved = save_subtask_requirement_submission(subtask_id, data)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        conn.execute(
            """
            INSERT INTO subtask_requirement_submissions (subtask_id, user_id, requirement_type, original_name, stored_path, mime_type, size_bytes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                subtask_id,
                user_id,
                requirement_type,
                saved["original_name"],
                saved["stored_path"],
                saved["mime_type"],
                int(saved["size_bytes"]),
            ),
        )
        realtime_user_ids = get_task_audience_user_ids(conn, task_row)
        log_activity(
            conn,
            user_id=user_id,
            action=f'submitted a requirement file for subtask "{existing["title"]}"',
            task_id=task_id,
            audience_user_ids=realtime_user_ids,
        )
        conn.commit()
        updated = fetch_task_for_access(conn, task_id, user_id, is_admin=is_admin)

    emit_subtask_updated(updated, realtime_user_ids)
    return jsonify(updated), 201


@app.route("/api/tasks/<int:task_id>/subtasks/reorder", methods=["PATCH"])
@login_required
def reorder_subtasks(task_id: int):
    ensure_db()
    user_id = int(session["user_id"])
    data = request.get_json(silent=True) or {}
    order = data.get("order", [])

    if not isinstance(order, list):
        return jsonify({"error": "Order must be a list."}), 400

    with get_db() as conn:
        is_admin = current_user_is_admin(conn, user_id)
        task = task_row_for_access(conn, task_id, user_id, is_admin=is_admin)
        if not task:
            return jsonify({"error": "Task not found."}), 404
        if not user_can_edit_task_row(conn, task, user_id, is_admin=is_admin):
            return jsonify({"error": "You do not have permission to edit this task."}), 403

        current_ids = conn.execute(
            "SELECT id FROM subtasks WHERE task_id = ? ORDER BY position ASC, id ASC",
            (task_id,),
        ).fetchall()

        current_set = {int(r["id"]) for r in current_ids}
        incoming_set = {int(x) for x in order}

        if current_set != incoming_set:
            return jsonify({"error": "Reorder list does not match current subtasks."}), 400

        for pos, subtask_id in enumerate(order):
            conn.execute(
                "UPDATE subtasks SET position = ? WHERE id = ? AND task_id = ?",
                (pos, int(subtask_id), task_id),
            )

        conn.commit()
        realtime_user_ids = get_task_audience_user_ids(conn, task)
        updated = fetch_task_for_access(conn, task_id, user_id, is_admin=is_admin)

    emit_subtask_updated(updated, realtime_user_ids)
    return jsonify(updated)


@app.route("/api/admin/users", methods=["GET"])
@admin_required
def admin_list_users():
    ensure_db()
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT
                u.id,
                u.username,
                u.contact,
                u.profile_image_path,
                u.is_admin,
                u.created_at,
                COUNT(DISTINCT tu.task_id) AS task_count
            FROM users u
            LEFT JOIN task_users tu ON tu.user_id = u.id
            GROUP BY u.id
            ORDER BY
                CASE WHEN LOWER(u.username) = 'root' THEN 0 ELSE 1 END,
                u.is_admin DESC,
                u.username COLLATE NOCASE ASC
            """
        ).fetchall()

    return jsonify([
        {
            "id": int(row["id"]),
            "username": row["username"],
            "contact": row["contact"] or "",
            "profile_image_path": row["profile_image_path"] or "",
            "created_at": row["created_at"],
            "task_count": int(row["task_count"] or 0),
            **role_payload(username=row["username"], is_admin=bool(row["is_admin"])),
        }
        for row in rows
    ])


@app.route("/api/admin/analytics", methods=["GET"])
@admin_required
def admin_analytics():
    ensure_db()
    period = request.args.get("period", "1w")

    with get_db() as conn:
        total_users = int(
            conn.execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"]
        )
        active_tasks = int(
            conn.execute("SELECT COUNT(*) AS count FROM tasks").fetchone()["count"]
        )
        archived_completed_tasks = int(
            conn.execute("SELECT COUNT(*) AS count FROM completed_tasks").fetchone()["count"]
        )
        overdue_tasks = int(
            conn.execute(
                """
                SELECT COUNT(*) AS count
                FROM (
                    SELECT t.id
                    FROM tasks t
                    LEFT JOIN subtasks s ON s.task_id = t.id
                    GROUP BY t.id
                    HAVING t.deadline != ''
                       AND datetime(t.deadline) < datetime('now')
                       AND NOT (
                           COUNT(s.id) > 0 AND SUM(CASE WHEN s.completed = 1 THEN 1 ELSE 0 END) = COUNT(s.id)
                       )
                ) overdue
                """
            ).fetchone()["count"]
        )
        series = build_completed_tasks_series(conn, period)
        materials_series = build_completed_materials_series(conn, period)

    return jsonify(
        {
            "totals": {
                "total_users": total_users,
                "total_tasks": active_tasks + archived_completed_tasks,
                "completed_tasks": archived_completed_tasks,
                "overdue_tasks": overdue_tasks,
            },
            "series": series,
            "materials_series": materials_series,
        }
    )


@app.route("/api/admin/users/<int:target_user_id>", methods=["DELETE"])
@admin_required
def admin_delete_user(target_user_id: int):
    ensure_db()
    current_admin_id = int(session["user_id"])

    if target_user_id == current_admin_id:
        return jsonify({"error": "You cannot delete your own admin account."}), 400

    with get_db() as conn:
        target = conn.execute(
            "SELECT id, username, is_admin FROM users WHERE id = ?",
            (target_user_id,),
        ).fetchone()
        if not target:
            return jsonify({"error": "User not found."}), 404

        if str(target["username"]).lower() == "root":
            return jsonify({"error": "The root admin cannot be deleted."}), 400

        audience_user_ids = sorted(
            set(get_admin_user_ids(conn)) | {current_admin_id}
        )
        username = target["username"]
        conn.execute("DELETE FROM users WHERE id = ?", (target_user_id,))
        log_activity(
            conn,
            user_id=current_admin_id,
            action=f'deleted user "{username}"',
            task_id=None,
            audience_user_ids=audience_user_ids,
        )
        conn.commit()

    return jsonify({"message": f'User "{username}" deleted successfully.'})


@app.route("/api/admin/users/<int:target_user_id>/role", methods=["PATCH"])
@admin_required
def admin_update_user_role(target_user_id: int):
    ensure_db()
    acting_user_id = int(session["user_id"])
    data = request.get_json(silent=True) or {}
    make_admin = bool(data.get("is_admin"))

    with get_db() as conn:
        if not current_user_is_headadmin(conn, acting_user_id):
            return jsonify({"error": "Only the head admin can change admin roles."}), 403

        target = conn.execute(
            "SELECT id, username, is_admin FROM users WHERE id = ?",
            (target_user_id,),
        ).fetchone()
        if not target:
            return jsonify({"error": "User not found."}), 404

        if is_headadmin_user(username=target["username"], is_admin=bool(target["is_admin"])):
            return jsonify({"error": "The head admin role cannot be changed."}), 400

        conn.execute(
            "UPDATE users SET is_admin = ? WHERE id = ?",
            (1 if make_admin else 0, target_user_id),
        )

        updated = conn.execute(
            """
            SELECT id, username, contact, profile_image_path, is_admin, created_at
            FROM users
            WHERE id = ?
            """,
            (target_user_id,),
        ).fetchone()

        action = (
            f'promoted user "{target["username"]}" to admin'
            if make_admin
            else f'removed admin access from "{target["username"]}"'
        )
        audience_user_ids = sorted(set(get_admin_user_ids(conn)) | {acting_user_id, target_user_id})
        log_activity(
            conn,
            user_id=acting_user_id,
            action=action,
            task_id=None,
            audience_user_ids=audience_user_ids,
        )
        conn.commit()

    return jsonify(
        {
            "message": (
                f'User "{updated["username"]}" promoted to admin.'
                if make_admin
                else f'Admin access removed from "{updated["username"]}".'
            ),
            "user": {
                "id": int(updated["id"]),
                "username": updated["username"],
                "contact": updated["contact"] or "",
                "profile_image_path": updated["profile_image_path"] or "",
                "created_at": updated["created_at"],
                **role_payload(username=updated["username"], is_admin=bool(updated["is_admin"])),
            },
        }
    )


if __name__ == "__main__":
    ensure_db()
    host = os.environ.get("TASK_MANAGER_HOST", "127.0.0.1")
    import os

if __name__ == "__main__":
    host = "0.0.0.0"
    port = int(os.environ.get("PORT", 5000))
    debug_mode = False

    socketio.run(
        app,
        host=host,
        port=port,
        debug=debug_mode,
        use_reloader=False,
        allow_unsafe_werkzeug=True,
    )
