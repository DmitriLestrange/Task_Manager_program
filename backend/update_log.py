import json
from pathlib import Path

UPDATE_LOG_PATH = Path(__file__).resolve().parent.parent / "data" / "update_log.json"


def load_update_log():
    with open(UPDATE_LOG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


UPDATE_LOG = load_update_log()
