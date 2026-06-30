"""Helpers for backing up config files before UI writes."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from viseron.const import CONFIG_PATH
from viseron.helpers import utcnow

CONFIG_BACKUP_DIR = Path("/config/backups/config")


def backup_config(reason: str) -> str | None:
    """Create a timestamped config.yaml backup and return the backup path."""
    config_path = Path(CONFIG_PATH)
    if not config_path.exists():
        return None

    safe_reason = "".join(
        char if char.isalnum() or char in {"-", "_"} else "_"
        for char in reason.strip().lower()
    ).strip("_")
    if not safe_reason:
        safe_reason = "ui_save"

    timestamp = utcnow().strftime("%Y%m%dT%H%M%SZ")
    CONFIG_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = CONFIG_BACKUP_DIR / f"config.{timestamp}.{safe_reason}.yaml"
    latest_path = CONFIG_BACKUP_DIR / "config.latest.yaml"

    shutil.copy2(config_path, backup_path)
    try:
        if latest_path.exists() or latest_path.is_symlink():
            latest_path.unlink()
        os.link(backup_path, latest_path)
    except OSError:
        shutil.copy2(backup_path, latest_path)
    return str(backup_path)
