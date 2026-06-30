"""System health API handler."""

from __future__ import annotations

import os
import resource
import uuid
from http import HTTPStatus
from pathlib import Path
from typing import Any

import psutil

from viseron.components.storage.const import (
    TIER_CATEGORY_RECORDER,
    TIER_SUBCATEGORY_SEGMENTS,
)
from viseron.components.webserver.api.handlers import BaseAPIHandler
from viseron.components.webserver.auth import Role
from viseron.const import TEMP_DIR
from viseron.helpers import utcnow


def _empty_ffmpeg_summary() -> dict[str, Any]:
    """Return an empty ffmpeg process summary."""
    return {
        "count": 0,
        "cpu_percent": 0.0,
        "memory_percent": 0.0,
        "rss": 0,
        "pids": [],
    }


def _latest_file_age(path: str) -> float | None:
    """Return newest file age in seconds for a folder."""
    try:
        entries = [
            os.path.join(path, entry)
            for entry in os.listdir(path)
            if entry.endswith((".m4s", ".mp4", ".ts", ".m3u8"))
        ]
    except OSError:
        return None

    newest = 0.0
    for entry in entries:
        try:
            newest = max(newest, os.path.getmtime(entry))
        except OSError:
            continue

    if not newest:
        return None
    return max(0.0, utcnow().timestamp() - newest)


def _storage_usage(path: str) -> dict[str, Any]:
    """Return disk usage for a path."""
    exists = os.path.exists(path)
    if not exists:
        return {
            "path": path,
            "exists": False,
            "total": 0,
            "used": 0,
            "free": 0,
            "percent_used": None,
            "warning_level": "error",
            "warning": "Path is missing",
            "device": None,
            "fstype": None,
            "is_mount": False,
            "writable": False,
            "write_error": "Path is missing",
        }

    usage = psutil.disk_usage(path)
    mount = _mount_info(path)
    write_result = _write_check(path)
    warning_level = _storage_warning_level(usage.percent)
    warning = None
    if warning_level:
        warning = f"Storage usage is {usage.percent:.1f}%"
    if not write_result["writable"]:
        warning_level = "error"
        warning = write_result["write_error"] or "Storage path is not writable"

    return {
        "path": path,
        "exists": True,
        "total": usage.total,
        "used": usage.used,
        "free": usage.free,
        "percent_used": usage.percent,
        "warning_level": warning_level,
        "warning": warning,
        "device": mount.get("device"),
        "fstype": mount.get("fstype"),
        "is_mount": os.path.ismount(path),
        "writable": write_result["writable"],
        "write_error": write_result["write_error"],
    }


def _storage_warning_level(percent_used: float) -> str | None:
    """Return warning level for disk usage thresholds."""
    if percent_used >= 95:
        return "error"
    if percent_used >= 90:
        return "critical"
    if percent_used >= 85:
        return "warning"
    return None


def _mount_info(path: str) -> dict[str, str | None]:
    """Return mount device and fstype for a path."""
    resolved_path = os.path.abspath(path)
    best_mount = {"mountpoint": "", "device": None, "fstype": None}
    for partition in psutil.disk_partitions(all=True):
        mountpoint = os.path.abspath(partition.mountpoint)
        if (
            resolved_path == mountpoint
            or resolved_path.startswith(mountpoint.rstrip(os.sep) + os.sep)
        ) and len(mountpoint) > len(best_mount["mountpoint"]):
            best_mount = {
                "mountpoint": mountpoint,
                "device": partition.device,
                "fstype": partition.fstype,
            }
    return best_mount


def _write_check(path: str) -> dict[str, Any]:
    """Check whether a storage path is writable."""
    test_path = Path(path) / f".viseron-healthcheck-{uuid.uuid4().hex}.tmp"
    try:
        with open(test_path, "w", encoding="utf-8") as test_file:
            test_file.write("ok\n")
        test_path.unlink(missing_ok=True)
        return {"writable": True, "write_error": None}
    except OSError as error:
        try:
            test_path.unlink(missing_ok=True)
        except OSError:
            pass
        return {"writable": False, "write_error": str(error)}


class SystemHealthAPIHandler(BaseAPIHandler):
    """Handler for system health information."""

    routes = [
        {
            "requires_role": [Role.ADMIN],
            "path_pattern": r"/system_health",
            "supported_methods": ["GET"],
            "method": "get_system_health",
        },
    ]

    @staticmethod
    def _ffmpeg_processes_by_camera() -> dict[str, dict[str, Any]]:
        """Return ffmpeg process summaries grouped by camera identifier."""
        by_camera: dict[str, dict[str, Any]] = {}

        for proc in psutil.process_iter(
            ["pid", "name", "cmdline", "cpu_percent", "memory_percent", "memory_info"]
        ):
            try:
                process_name = proc.info.get("name") or ""
                cmdline = proc.info.get("cmdline") or []
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue

            candidate = process_name
            if not candidate.startswith("ffmpeg_"):
                for part in cmdline:
                    if os.path.basename(part).startswith("ffmpeg_"):
                        candidate = os.path.basename(part)
                        break

            if not candidate.startswith("ffmpeg_"):
                continue

            identifier = candidate.removeprefix("ffmpeg_").removesuffix("_seg")
            summary = by_camera.setdefault(identifier, _empty_ffmpeg_summary())
            try:
                memory_info = proc.info.get("memory_info")
                rss = memory_info.rss if memory_info else 0
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                rss = 0

            summary["count"] += 1
            summary["cpu_percent"] += float(proc.info.get("cpu_percent") or 0.0)
            summary["memory_percent"] += float(
                proc.info.get("memory_percent") or 0.0
            )
            summary["rss"] += int(rss)
            summary["pids"].append(proc.info["pid"])

        return by_camera

    def _camera_health(
        self,
        camera,
        ffmpeg_by_camera: dict[str, dict[str, Any]],
        *,
        failed: bool = False,
    ) -> dict[str, Any]:
        """Return health data for one camera."""
        ffmpeg = ffmpeg_by_camera.get(camera.identifier, _empty_ffmpeg_summary())
        latest_segment_age = None
        latest_temp_segment_age = None
        status = None

        if not failed:
            latest_temp_segment_age = _latest_file_age(
                os.path.join(TEMP_DIR, camera.segments_folder)
            )
            try:
                status = camera.as_dict(allow_policy_override=True)["status"]
            except (AttributeError, KeyError, ValueError, OSError):
                status = None
            try:
                latest_segment_age = _latest_file_age(
                    camera.tier_base_path(
                        0,
                        TIER_CATEGORY_RECORDER,
                        TIER_SUBCATEGORY_SEGMENTS,
                    )
                )
            except (KeyError, ValueError, OSError):
                latest_segment_age = None
        else:
            try:
                status = camera.as_dict()["status"]
            except (AttributeError, KeyError, ValueError, OSError):
                status = None

        return {
            "identifier": camera.identifier,
            "name": camera.name,
            "connected": bool(getattr(camera, "connected", False)),
            "is_on": bool(getattr(camera, "is_on", False)),
            "is_recording": bool(getattr(camera, "is_recording", False)),
            "live_stream_available": bool(
                getattr(camera, "live_stream_available", False)
            ),
            "width": getattr(camera, "width", None)
            if failed
            else camera.resolution[0],
            "height": getattr(camera, "height", None)
            if failed
            else camera.resolution[1],
            "latest_temp_segment_age": latest_temp_segment_age,
            "latest_segment_age": latest_segment_age,
            "ffmpeg": ffmpeg,
            "failed": failed,
            "error": getattr(camera, "error", None),
            "status": status,
            "stale_frame": bool(
                isinstance(status, dict)
                and status.get("stale_frame", {}).get("stale")
            ),
        }

    def _storage_paths(self) -> list[str]:
        """Return unique storage paths for health reporting."""
        paths: list[str] = []
        for handlers_by_category in self._storage.camera_tier_handlers.values():
            for tiers in handlers_by_category.values():
                for handlers_by_subcategory in tiers:
                    for handler in handlers_by_subcategory.values():
                        path = handler.tier.get("path")
                        if path and path not in paths:
                            paths.append(path)
        return paths

    def _system_health(self) -> dict[str, Any]:
        """Build system health response."""
        ffmpeg_by_camera = self._ffmpeg_processes_by_camera()
        cameras = self._get_cameras() or {}
        failed_cameras = self._get_failed_cameras() or {}

        camera_health = [
            self._camera_health(camera, ffmpeg_by_camera)
            for camera in cameras.values()
        ]
        camera_health.extend(
            self._camera_health(camera, ffmpeg_by_camera, failed=True)
            for camera in failed_cameras.values()
        )

        soft_nofile, hard_nofile = resource.getrlimit(resource.RLIMIT_NOFILE)
        memory = psutil.virtual_memory()

        storage_paths = self._storage_paths()
        storage = [_storage_usage(path) for path in storage_paths]

        return {
            "generated_at": utcnow().timestamp(),
            "system": {
                "load_average": list(os.getloadavg())
                if hasattr(os, "getloadavg")
                else None,
                "cpu_count": os.cpu_count(),
                "memory": {
                    "total": memory.total,
                    "available": memory.available,
                    "used": memory.used,
                },
                "nofile": {
                    "soft": soft_nofile,
                    "hard": hard_nofile,
                },
            },
            "storage": storage,
            "cameras": camera_health,
            "ffmpeg": {
                "process_count": sum(
                    item["count"] for item in ffmpeg_by_camera.values()
                ),
                "total_cpu_percent": sum(
                    item["cpu_percent"] for item in ffmpeg_by_camera.values()
                ),
                "total_rss": sum(item["rss"] for item in ffmpeg_by_camera.values()),
                "by_camera": ffmpeg_by_camera,
            },
            "summary": {
                "camera_count": len(camera_health),
                "connected_cameras": sum(
                    1 for camera in camera_health if camera["connected"]
                ),
                "recording_cameras": sum(
                    1 for camera in camera_health if camera["is_recording"]
                ),
                "offline_cameras": sum(
                    1
                    for camera in camera_health
                    if camera["failed"] or not camera["connected"]
                ),
                "stale_cameras": sum(
                    1 for camera in camera_health if camera["stale_frame"]
                ),
                "cameras_without_ffmpeg": [
                    camera["identifier"]
                    for camera in camera_health
                    if not camera["failed"]
                    and camera["is_on"]
                    and not camera["ffmpeg"]["count"]
                ],
            },
        }

    async def get_system_health(self) -> None:
        """Return system health."""
        try:
            response = await self.run_in_executor(self._system_health)
        except Exception as error:  # pylint: disable=broad-except
            self.response_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                reason=f"Could not collect system health: {error}",
            )
            return

        await self.response_success(response=response)
