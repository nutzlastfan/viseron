"""WebSocket API commands."""

from __future__ import annotations

import asyncio
import datetime
import enum
import inspect
import logging
import os
import shutil
import signal
import subprocess as sp
import time
import uuid
from collections.abc import Callable
from functools import wraps
from typing import TYPE_CHECKING, Any, Literal, overload

import voluptuous as vol
from debouncer import DebounceOptions, debounce
from sqlalchemy import select
from sqlalchemy.exc import NoResultFound

from viseron.components.storage.const import (
    EVENT_FILE_CREATED,
    EVENT_FILE_DELETED,
    TIER_CATEGORY_RECORDER,
    TIER_SUBCATEGORY_SEGMENTS,
)
from viseron.components.storage.models import (
    Motion,
    Objects,
    PostProcessorResults,
    Recordings,
)
from viseron.components.storage.queries import (
    get_recording_fragments,
    get_time_period_fragments,
)
from viseron.components.storage.util import EventFileCreated, EventFileDeleted
from viseron.components.webserver.auth import Role
from viseron.components.webserver.const import (
    DOWNLOAD_PATH,
    WS_ERROR_NOT_FOUND,
    WS_ERROR_RELOAD_CONFIG_FAILED,
    WS_ERROR_SAVE_CONFIG_FAILED,
)
from viseron.components.webserver.config_backup import backup_config
from viseron.components.webserver.download_token import DownloadToken
from viseron.const import (
    CONFIG_PATH,
    EVENT_STATE_CHANGED,
    RESTART_EXIT_CODE,
)
from viseron.domains.camera.const import CONFIG_FFMPEG_LOGLEVEL, CONFIG_RECORDER
from viseron.domains.camera.fragmenter import (
    Fragment,
    Timespan,
    get_available_timespans,
)
from viseron.exceptions import Unauthorized
from viseron.helpers import create_directory, daterange_to_utc, get_utc_offset
from viseron.helpers.template import render_template
from viseron.helpers.validators import jinja2_template
from viseron.reload import reload_config

from .messages import (
    BASE_MESSAGE_SCHEMA,
    cancel_subscription_message,
    error_message,
    pong_message,
    result_message,
    subscription_error_message,
    subscription_result_message,
)

if TYPE_CHECKING:
    from viseron import Event
    from viseron.states import EventStateChangedData

    from . import WebSocketHandler

LOGGER = logging.getLogger(__name__)

ZOOM_PAN_TRANSFORM_SCHEMA = vol.Schema(
    {
        vol.Required("scale"): vol.All(vol.Coerce(float), vol.Range(min=1.0)),
        vol.Required("centerX"): vol.All(
            vol.Coerce(float), vol.Range(min=0.0, max=1.0)
        ),
        vol.Required("centerY"): vol.All(
            vol.Coerce(float), vol.Range(min=0.0, max=1.0)
        ),
        vol.Optional("viewportAspectRatio", default=None): vol.Maybe(
            vol.All(vol.Coerce(float), vol.Range(min=0.1, max=10.0))
        ),
        vol.Optional("flip", default=False): bool,
    },
    extra=False,
)


def _even(value: int) -> int:
    """Return the nearest lower even integer."""
    return value - (value % 2)


def _even_at_least(value: float, minimum: int = 2) -> int:
    """Return an even integer no smaller than minimum."""
    return max(minimum, _even(round(value)))


def _video_resolution(
    video_path: str,
    fallback_resolution: tuple[int, int],
) -> tuple[int, int]:
    """Return video resolution from ffprobe, falling back to camera metadata."""
    try:
        result = sp.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "csv=s=x:p=0",
                video_path,
            ],
            stdout=sp.PIPE,
            stderr=sp.PIPE,
            text=True,
            check=True,
        )
        width, height = result.stdout.strip().split("x", 1)
        parsed_resolution = (int(width), int(height))
        if parsed_resolution[0] > 0 and parsed_resolution[1] > 0:
            return parsed_resolution
    except (ValueError, sp.CalledProcessError, OSError):
        LOGGER.debug("Failed to probe export video resolution", exc_info=True)
    return fallback_resolution


def _zoom_pan_video_filter(
    source_width: int,
    source_height: int,
    fallback_viewport_aspect_ratio: float,
    zoom_pan_transform: dict[str, float | bool] | None,
) -> str | None:
    """Build an FFmpeg crop/scale filter from a normalized zoom/pan transform."""
    if not zoom_pan_transform:
        return None

    if source_width <= 0 or source_height <= 0:
        return None

    scale = float(zoom_pan_transform["scale"])
    flip = bool(zoom_pan_transform.get("flip", False))
    if scale <= 1 and not flip:
        return None
    if scale <= 1:
        return "hflip,vflip"

    source_aspect_ratio = source_width / source_height
    viewport_aspect_ratio = float(
        zoom_pan_transform.get("viewportAspectRatio")
        or fallback_viewport_aspect_ratio
        or source_aspect_ratio
    )
    uses_legacy_container_coordinates = (
        zoom_pan_transform.get("viewportAspectRatio") is None
    )

    if viewport_aspect_ratio >= source_aspect_ratio:
        crop_height = _even_at_least(source_height / scale)
        crop_width = _even_at_least(crop_height * viewport_aspect_ratio)
        if crop_width > source_width:
            crop_width = _even(source_width)
            crop_height = _even_at_least(crop_width / viewport_aspect_ratio)
    else:
        crop_width = _even_at_least(source_width / scale)
        crop_height = _even_at_least(crop_width / viewport_aspect_ratio)
        if crop_height > source_height:
            crop_height = _even(source_height)
            crop_width = _even_at_least(crop_height * viewport_aspect_ratio)

    crop_width = max(2, min(source_width, crop_width))
    crop_height = max(2, min(source_height, crop_height))

    center_x = float(zoom_pan_transform["centerX"])
    center_y = float(zoom_pan_transform["centerY"])
    if uses_legacy_container_coordinates:
        if source_aspect_ratio >= viewport_aspect_ratio:
            content_width = 1.0
            content_height = viewport_aspect_ratio / source_aspect_ratio
            content_left = 0.0
            content_top = (1.0 - content_height) / 2.0
        else:
            content_width = source_aspect_ratio / viewport_aspect_ratio
            content_height = 1.0
            content_left = (1.0 - content_width) / 2.0
            content_top = 0.0
        center_x = (center_x - content_left) / content_width
        center_y = (center_y - content_top) / content_height

    center_x = max(0.0, min(1.0, center_x))
    center_y = max(0.0, min(1.0, center_y))
    if flip:
        center_x = 1 - center_x
        center_y = 1 - center_y

    max_x = max(0, source_width - crop_width)
    max_y = max(0, source_height - crop_height)
    crop_x = round(center_x * source_width - crop_width / 2)
    crop_y = round(center_y * source_height - crop_height / 2)
    crop_x = _even(max(0, min(max_x, crop_x)))
    crop_y = _even(max(0, min(max_y, crop_y)))

    filters = [f"crop={crop_width}:{crop_height}:{crop_x}:{crop_y}"]
    if flip:
        filters.extend(["hflip", "vflip"])
    filters.append("setsar=1")

    return ",".join(filters)


EXPORT_TEMP_PATH = "/segments/.viseron_exports/tmp"
EXPORT_CLEANUP_MAX_AGE_SECONDS = 48 * 60 * 60
EXPORT_CLEANUP_INTERVAL_SECONDS = 60 * 60
_last_export_cleanup = 0.0


def _cleanup_export_buffers() -> None:
    """Remove stale export buffers that were never downloaded."""
    global _last_export_cleanup  # pylint: disable=global-statement
    now = time.time()
    if now - _last_export_cleanup < EXPORT_CLEANUP_INTERVAL_SECONDS:
        return
    _last_export_cleanup = now

    cutoff = now - EXPORT_CLEANUP_MAX_AGE_SECONDS
    for directory in (EXPORT_TEMP_PATH, DOWNLOAD_PATH):
        create_directory(directory)
        for entry in os.scandir(directory):
            if not entry.is_file():
                continue
            try:
                if entry.stat().st_mtime >= cutoff:
                    continue
                os.remove(entry.path)
                LOGGER.info("Removed stale export buffer %s", entry.path)
            except OSError:
                LOGGER.debug("Failed to remove stale export buffer", exc_info=True)


def _configured_export_destinations(connection: WebSocketHandler) -> dict[str, dict]:
    """Return configured non-browser export destinations."""
    site_config = connection.webserver.config.get("site", {})
    destinations = site_config.get("export_destinations", {})
    return destinations if isinstance(destinations, dict) else {}


def _safe_export_filename(filename: str) -> str:
    """Return a filename that cannot escape the configured destination."""
    return os.path.basename(filename).replace(os.sep, "_")


def _server_export_destination(
    connection: WebSocketHandler,
    destination_id: str,
) -> dict | None:
    """Resolve a server-side export destination from config."""
    if destination_id == "browser":
        return None
    destination = _configured_export_destinations(connection).get(destination_id)
    if not isinstance(destination, dict) or not isinstance(destination.get("path"), str):
        return None
    if not destination.get("enabled", True):
        return None
    return destination


def _finalize_export(
    connection: WebSocketHandler,
    message: dict[str, Any],
    source_path: str,
    filename: str,
    *,
    move_source: bool,
) -> dict[str, Any] | str:
    """Move/copy an export to browser-download storage or a server destination."""
    destination_id = message.get("export_destination", "browser")
    if destination_id == "browser":
        create_directory(DOWNLOAD_PATH)
        new_path = os.path.join(DOWNLOAD_PATH, _safe_export_filename(filename))
        if move_source:
            shutil.move(source_path, new_path)
        else:
            shutil.copy2(source_path, new_path)

        download_token = DownloadToken(
            filename=new_path,
            token=str(uuid.uuid4()),
            delete_after_download=True,
        )
        connection.webserver.download_tokens[download_token.token] = download_token
        return {
            "filename": download_token.filename,
            "token": download_token.token,
            "destination": "browser",
        }

    destination = _server_export_destination(connection, destination_id)
    if not destination:
        return subscription_error_message(
            message["command_id"],
            WS_ERROR_NOT_FOUND,
            f"Export destination {destination_id} is not configured.",
        )

    target_dir = os.path.join(destination["path"], message["camera_identifier"])
    create_directory(target_dir)
    target_path = os.path.join(target_dir, _safe_export_filename(filename))
    if move_source:
        shutil.move(source_path, target_path)
    else:
        shutil.copy2(source_path, target_path)

    return {
        "filename": target_path,
        "destination": destination_id,
        "destination_name": destination.get("name", destination_id),
        "downloaded": False,
    }


def _apply_zoom_pan_transform(
    camera,
    video_path: str,
    zoom_pan_transform: dict[str, float | bool] | None,
) -> str | Literal[False]:
    """Create a zoomed copy of video_path if a zoom transform is configured."""
    source_width, source_height = _video_resolution(
        video_path, camera.mainstream_resolution
    )
    fallback_width, fallback_height = camera.mainstream_resolution
    fallback_viewport_aspect_ratio = (
        fallback_width / fallback_height if fallback_width and fallback_height else 0
    )
    video_filter = _zoom_pan_video_filter(
        source_width,
        source_height,
        fallback_viewport_aspect_ratio,
        zoom_pan_transform,
    )
    if not video_filter:
        return video_path

    _cleanup_export_buffers()
    filename = os.path.join(EXPORT_TEMP_PATH, f"{uuid.uuid4()}.mp4")
    ffmpeg_cmd = [
        "ffmpeg",
        "-hide_banner",
        "-y",
        "-loglevel",
        camera.config[CONFIG_RECORDER][CONFIG_FFMPEG_LOGLEVEL],
        "-i",
        video_path,
        "-vf",
        video_filter,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        filename,
    ]
    LOGGER.info(
        "Applying zoom/pan export filter for %s: transform=%s, filter=%s",
        camera.identifier,
        zoom_pan_transform,
        video_filter,
    )
    LOGGER.debug(f"Zoomed export command: {' '.join(ffmpeg_cmd)}")
    try:
        sp.run(  # type: ignore[call-overload]
            ffmpeg_cmd,
            stdout=sp.PIPE,
            stderr=sp.PIPE,
            check=True,
        )
    except (sp.CalledProcessError, OSError) as err:
        LOGGER.error("Failed to apply zoom/pan transform to export: %s", err)
        return False

    try:
        os.remove(video_path)
    except OSError:
        LOGGER.debug("Failed to remove unzoomed temporary export", exc_info=True)
    return filename


@overload
def websocket_command(schema: dict[Any, Any]) -> Callable: ...


@overload
def websocket_command(schema: dict[Any, Any], command: str) -> Callable: ...


@overload
def websocket_command(schema: vol.Schema, command: str) -> Callable: ...


def websocket_command(
    schema: dict[Any, Any] | vol.Schema, command: str | None = None
) -> Callable:
    """Websocket command decorator."""
    if isinstance(schema, dict):
        if command is None:
            command = schema["type"]

    def decorate(func):
        """Decorate websocket command function."""
        setattr(func, "command", command)
        setattr(func, "schema", BASE_MESSAGE_SCHEMA.extend(schema))
        return func

    return decorate


def require_admin(func):
    """Websocket decorator to require user to be an admin."""

    if inspect.iscoroutinefunction(func):

        @wraps(func)
        async def async_with_admin(
            connection: WebSocketHandler, message: dict[str, Any]
        ) -> None:
            """Check admin and call async function."""
            if connection.webserver.auth:
                user = connection.current_user
                if user is None or not user.role == Role.ADMIN:
                    raise Unauthorized()

            await func(connection, message)

        return async_with_admin

    @wraps(func)
    def with_admin(connection: WebSocketHandler, message: dict[str, Any]) -> None:
        """Check admin and call function."""
        if connection.webserver.auth:
            user = connection.current_user
            if user is None or not user.role == Role.ADMIN:
                raise Unauthorized()

        func(connection, message)

    return with_admin


@websocket_command({vol.Required("type"): "ping"})
async def ping(connection: WebSocketHandler, message) -> None:
    """Respond to ping."""
    await connection.async_send_message(pong_message(message["command_id"]))


@websocket_command(
    {
        vol.Required("type"): "subscribe_event",
        vol.Required("event"): str,
        # Use only when not consuming the data, as the debounced events will be lost
        vol.Optional("debounce", default=None): vol.Maybe(vol.Any(float, int)),
    }
)
async def subscribe_event(connection: WebSocketHandler, message) -> None:
    """Subscribe to an event."""

    async def forward_event(event: Event) -> None:
        """Forward event to WebSocket connection."""
        await connection.async_send_message(
            subscription_result_message(message["command_id"], event)
        )

    @debounce(
        wait=message["debounce"],
        options=DebounceOptions(
            time_window=message["debounce"],
        ),
    )
    async def debounced_forward_event(event: Event) -> None:
        """Debounce forward event to WebSocket connection.

        Use only when the data is not of importance as information may be lost!
        """
        await forward_event(event)

    connection.subscriptions[message["command_id"]] = connection.vis.listen_event(
        message["event"],
        debounced_forward_event if message["debounce"] else forward_event,
        ioloop=connection.ioloop,
    )
    await connection.async_send_message(result_message(message["command_id"]))


@websocket_command(
    {
        vol.Required("type"): "unsubscribe_event",
        vol.Required("subscription"): int,
    }
)
async def unsubscribe_event(connection: WebSocketHandler, message) -> None:
    """Unsubscribe to an event."""
    subscription = message["subscription"]
    if subscription in connection.subscriptions:
        connection.subscriptions.pop(subscription)()
        await connection.async_send_message(result_message(message["command_id"]))
        return

    await connection.async_send_message(
        error_message(
            message["command_id"],
            WS_ERROR_NOT_FOUND,
            f"Subscription with command_id {message['subscription']} not found.",
        )
    )


@websocket_command(
    {
        vol.Required("type"): "subscribe_states",
        vol.Exclusive("entity_id", "entity"): str,
        vol.Exclusive("entity_ids", "entity"): [str],
    }
)
async def subscribe_states(connection: WebSocketHandler, message) -> None:
    """Subscribe to state changes for one or multiple entities."""

    async def forward_state_change(event: Event[EventStateChangedData]) -> None:
        """Forward state_changed event to WebSocket connection."""
        if "entity_id" in message:
            if event.data.entity_id == message["entity_id"]:
                await connection.async_send_message(
                    subscription_result_message(message["command_id"], event)
                )
            return
        if "entity_ids" in message:
            if event.data.entity_id in message["entity_ids"]:
                await connection.async_send_message(
                    subscription_result_message(message["command_id"], event)
                )
            return
        await connection.async_send_message(
            subscription_result_message(message["command_id"], event)
        )

    connection.subscriptions[message["command_id"]] = connection.vis.listen_event(
        EVENT_STATE_CHANGED,
        forward_state_change,
        ioloop=connection.ioloop,
    )
    await connection.async_send_message(result_message(message["command_id"]))


@websocket_command(
    {
        vol.Required("type"): "unsubscribe_states",
        vol.Required("subscription"): int,
    }
)
async def unsubscribe_states(connection: WebSocketHandler, message) -> None:
    """Unsubscribe to state changes."""
    message["type"] = "unsubscribe_event"
    await unsubscribe_event(connection, message)


@websocket_command({vol.Required("type"): "get_cameras"})
async def get_cameras(connection: WebSocketHandler, message) -> None:
    """Get all registered cameras."""
    await connection.async_send_message(
        result_message(
            message["command_id"],
            connection.get_cameras(),
        ),
    )


@require_admin
@websocket_command({vol.Required("type"): "get_config"})
async def get_config(connection: WebSocketHandler, message) -> None:
    """Return config in text format."""

    def read_config() -> str:
        with open(CONFIG_PATH, encoding="utf-8") as config_file:
            return config_file.read()

    config = await connection.run_in_executor(read_config)

    await connection.async_send_message(
        result_message(
            message["command_id"],
            {"config": config},
        )
    )


@require_admin
@websocket_command({vol.Required("type"): "save_config", vol.Required("config"): str})
async def save_config(connection: WebSocketHandler, message) -> None:
    """Save config to file."""

    def _save_config():
        backup_config("config_editor")
        with open(CONFIG_PATH, "w", encoding="utf-8") as config_file:
            config_file.write(message["config"])

    try:
        await connection.run_in_executor(_save_config)
    except Exception as exception:  # pylint: disable=broad-except
        await connection.async_send_message(
            error_message(
                message["command_id"],
                WS_ERROR_SAVE_CONFIG_FAILED,
                str(exception),
            )
        )
        return

    await connection.async_send_message(
        result_message(
            message["command_id"],
        )
    )


@require_admin
@websocket_command({vol.Required("type"): "restart_viseron"})
async def restart_viseron(connection: WebSocketHandler, message) -> None:
    """Restart Viseron."""
    connection.vis.exit_code = RESTART_EXIT_CODE
    os.kill(os.getpid(), signal.SIGINT)
    await connection.async_send_message(
        result_message(
            message["command_id"],
        )
    )


@require_admin
@websocket_command({vol.Required("type"): "reload_config"})
async def handle_reload_config(connection: WebSocketHandler, message) -> None:
    """Reload configuration."""
    try:
        result = await connection.run_in_executor(reload_config, connection.vis)
    except Exception as exception:  # pylint: disable=broad-except # noqa: BLE001
        await connection.async_send_message(
            error_message(
                message["command_id"],
                WS_ERROR_RELOAD_CONFIG_FAILED,
                str(exception),
            )
        )
        return

    await connection.async_send_message(
        result_message(
            message["command_id"],
            {
                "success": result.success,
                "restart_required": result.restart_required,
            },
        )
    )


@websocket_command({vol.Required("type"): "get_entities"})
async def get_entities(connection: WebSocketHandler, message) -> None:
    """Get all registered entities."""
    entities = await connection.run_in_executor(connection.vis.get_entities)

    await connection.async_send_message(
        result_message(message["command_id"], entities),
    )


FORWARD_TIMESPANS_LOCK = asyncio.Lock()


@websocket_command(
    command="subscribe_timespans",
    schema={
        vol.Required("type"): "subscribe_timespans",
        vol.Required("camera_identifiers"): [str],
        vol.Required("date"): vol.Any(str, None),
        vol.Optional("debounce", default=5): vol.Any(float, int),
    },
)
async def subscribe_timespans(connection: WebSocketHandler, message) -> None:
    """Subscribe to cameras available timespans."""
    camera_identifiers: list[str] = message["camera_identifiers"]
    for camera_identifier in camera_identifiers:
        camera = connection.get_camera(camera_identifier)
        if camera is None:
            await connection.async_send_message(
                error_message(
                    message["command_id"],
                    WS_ERROR_NOT_FOUND,
                    f"Camera with identifier {camera_identifier} not found.",
                )
            )
            return

    # Convert local start of day to UTC
    if date := message.get("date"):
        time_from, time_to = daterange_to_utc(date, connection.utc_offset)
    else:
        time_from = datetime.datetime(1970, 1, 1, 0, 0, 0)
        time_to = datetime.datetime(2999, 12, 31, 23, 59, 59, 999999)

    def get_timespans() -> list[Timespan]:
        """Get available timespans."""
        return get_available_timespans(
            connection.get_session,
            camera_identifiers,
            time_from.timestamp(),
            time_to.timestamp(),
        )

    setattr(connection, "forward_timespans_last_call", 0.0)

    async def forward_timespans(
        _event: Event[EventFileCreated] | Event[EventFileDeleted] | None = None,
    ) -> None:
        """Forward timespans to WebSocket connection."""
        async with FORWARD_TIMESPANS_LOCK:
            if (
                time.time() - getattr(connection, "forward_timespans_last_call", 0.0)
                < message["debounce"]
            ):
                return

            timespans = await connection.run_in_executor(get_timespans)
            await connection.async_send_message(
                subscription_result_message(
                    message["command_id"], {"timespans": timespans}
                )
            )
            setattr(connection, "forward_timespans_last_call", time.time())

    subs = []
    for camera_identifier in camera_identifiers:
        subs.append(
            connection.vis.listen_event(
                EVENT_FILE_CREATED.format(
                    camera_identifier=camera_identifier,
                    category=TIER_CATEGORY_RECORDER,
                    subcategory=TIER_SUBCATEGORY_SEGMENTS,
                ),
                forward_timespans,
                ioloop=connection.ioloop,
            )
        )
        subs.append(
            connection.vis.listen_event(
                EVENT_FILE_DELETED.format(
                    camera_identifier=camera_identifier,
                    category=TIER_CATEGORY_RECORDER,
                    subcategory=TIER_SUBCATEGORY_SEGMENTS,
                ),
                forward_timespans,
                ioloop=connection.ioloop,
            )
        )

    def unsubscribe() -> None:
        """Unsubscribe."""
        for unsub in subs:
            unsub()

    connection.subscriptions[message["command_id"]] = unsubscribe
    await connection.async_send_message(result_message(message["command_id"]))
    await forward_timespans()


@websocket_command(
    {
        vol.Required("type"): "unsubscribe_timespans",
        vol.Required("subscription"): int,
    }
)
async def unsubscribe_timespans(connection: WebSocketHandler, message) -> None:
    """Unsubscribe to a cameras available timespans."""
    message["type"] = "unsubscribe_event"
    await unsubscribe_event(connection, message)


@websocket_command(
    {
        vol.Required("type"): "export_recording",
        vol.Required("camera_identifier"): str,
        vol.Required("recording_id"): int,
        vol.Optional("zoom_pan_transform", default=None): vol.Maybe(
            ZOOM_PAN_TRANSFORM_SCHEMA
        ),
        vol.Optional("export_destination", default="browser"): str,
    }
)
async def export_recording(connection: WebSocketHandler, message) -> None:
    """Export a recording."""
    camera = connection.get_camera(message["camera_identifier"])
    if camera is None:
        await connection.async_send_message(
            error_message(
                message["command_id"],
                WS_ERROR_NOT_FOUND,
                f"Camera with identifier {message['camera_identifier']} not found.",
            )
        )
        return

    def _result() -> dict[str, Any] | str:
        _cleanup_export_buffers()
        with connection.get_session() as session:
            try:
                recording = session.execute(
                    select(Recordings).where(Recordings.id == message["recording_id"])
                ).scalar_one()
            except NoResultFound:
                return subscription_error_message(
                    message["command_id"],
                    WS_ERROR_NOT_FOUND,
                    f"Recording with id {message['recording_id']} not found.",
                )

        files = get_recording_fragments(
            message["recording_id"],
            camera.recorder.lookback,
            connection.get_session,
        )
        fragments = [
            Fragment(file.filename, file.path, file.duration, file.orig_ctime)
            for file in files
        ]
        recording_mp4 = camera.fragmenter.concatenate_fragments(fragments)
        if not recording_mp4:
            return subscription_error_message(
                message["command_id"],
                WS_ERROR_NOT_FOUND,
                "No fragments found for recording.",
            )
        recording_mp4 = _apply_zoom_pan_transform(
            camera,
            recording_mp4,
            message["zoom_pan_transform"],
        )
        if not recording_mp4:
            return subscription_error_message(
                message["command_id"],
                WS_ERROR_NOT_FOUND,
                "Failed to apply zoom to recording.",
            )

        time_string = (recording.start_time + get_utc_offset()).strftime(
            "%Y-%m-%d-%H-%M-%S"
        )
        video_name = f"{camera.identifier}-{time_string}.{camera.extension}"
        export_result = _finalize_export(
            connection,
            message,
            recording_mp4,
            video_name,
            move_source=True,
        )
        if isinstance(export_result, str):
            return export_result

        return subscription_result_message(
            message["command_id"],
            export_result,
        )

    await connection.async_send_message(result_message(message["command_id"]))
    await connection.async_send_message(await connection.run_in_executor(_result))
    await connection.async_send_message(
        cancel_subscription_message(message["command_id"]),
    )


class EventTypeModelEnum(enum.Enum):
    """Enum for event type string and their corresponding DB model."""

    MOTION = Motion
    OBJECT = Objects
    FACE_RECOGNITION = PostProcessorResults
    LICENSE_PLATE_RECOGNITION = PostProcessorResults


@websocket_command(
    {
        vol.Required("type"): "export_snapshot",
        vol.Required("event_type"): str,
        vol.Required("camera_identifier"): str,
        vol.Required("snapshot_id"): int,
        vol.Optional("export_destination", default="browser"): str,
    }
)
async def export_snapshot(connection: WebSocketHandler, message) -> None:
    """Export a snapshot."""
    camera = connection.get_camera(message["camera_identifier"])
    if camera is None:
        await connection.async_send_message(
            error_message(
                message["command_id"],
                WS_ERROR_NOT_FOUND,
                f"Camera with identifier {message['camera_identifier']} not found.",
            )
        )
        return

    try:
        model = EventTypeModelEnum[message["event_type"].upper()].value
    except KeyError:
        await connection.async_send_message(
            error_message(
                message["command_id"],
                WS_ERROR_NOT_FOUND,
                f"Event type {message['event_type']} not found.",
            )
        )
        return

    def _result() -> dict[str, Any] | str:
        _cleanup_export_buffers()
        with connection.get_session() as session:
            try:
                event = session.execute(
                    select(model).where(model.id == message["snapshot_id"])
                ).scalar_one()
            except NoResultFound:
                return error_message(
                    message["command_id"],
                    WS_ERROR_NOT_FOUND,
                    f"Snapshot with id {message['snapshot_id']} not found.",
                )

        time_string = (event.created_at + get_utc_offset()).strftime(
            "%Y-%m-%d-%H-%M-%S"
        )
        filename = f"{camera.identifier}-{time_string}.jpg"
        export_result = _finalize_export(
            connection,
            message,
            event.snapshot_path,
            filename,
            move_source=False,
        )
        if isinstance(export_result, str):
            return export_result

        return subscription_result_message(
            message["command_id"],
            export_result,
        )

    await connection.async_send_message(result_message(message["command_id"]))
    await connection.async_send_message(await connection.run_in_executor(_result))
    await connection.async_send_message(
        cancel_subscription_message(message["command_id"]),
    )


@websocket_command(
    {
        vol.Required("type"): "export_timespan",
        vol.Required("camera_identifier"): str,
        vol.Required("start"): int,
        vol.Required("end"): int,
        vol.Optional("zoom_pan_transform", default=None): vol.Maybe(
            ZOOM_PAN_TRANSFORM_SCHEMA
        ),
        vol.Optional("export_destination", default="browser"): str,
    }
)
async def export_timespan(connection: WebSocketHandler, message) -> None:
    """Export a timespan."""
    camera = connection.get_camera(message["camera_identifier"])
    if camera is None:
        await connection.async_send_message(
            error_message(
                message["command_id"],
                WS_ERROR_NOT_FOUND,
                f"Camera with identifier {message['camera_identifier']} not found.",
            )
        )
        return

    def _result() -> dict[str, Any] | str:
        _cleanup_export_buffers()
        files = get_time_period_fragments(
            [camera.identifier],
            message["start"],
            message["end"],
            connection.get_session,
        )
        if not files:
            return subscription_error_message(
                message["command_id"],
                WS_ERROR_NOT_FOUND,
                "No fragments found for timespan.",
            )

        fragments = [
            Fragment(file.filename, file.path, file.duration, file.orig_ctime)
            for file in files
        ]
        timespan_video = camera.fragmenter.concatenate_fragments(fragments)
        if not timespan_video:
            return subscription_error_message(
                message["command_id"],
                WS_ERROR_NOT_FOUND,
                "Failed to concatenate fragments.",
            )
        timespan_video = _apply_zoom_pan_transform(
            camera,
            timespan_video,
            message["zoom_pan_transform"],
        )
        if not timespan_video:
            return subscription_error_message(
                message["command_id"],
                WS_ERROR_NOT_FOUND,
                "Failed to apply zoom to timespan.",
            )

        # fromtimestamp automatically converts to server timezone
        time_string = (datetime.datetime.fromtimestamp(message["start"])).strftime(
            "%Y-%m-%d-%H-%M-%S"
        )
        video_name = (
            f"{camera.identifier}-{time_string}.{os.path.splitext(timespan_video)[1]}"
        )
        export_result = _finalize_export(
            connection,
            message,
            timespan_video,
            video_name,
            move_source=True,
        )
        if isinstance(export_result, str):
            return export_result

        return subscription_result_message(
            message["command_id"],
            export_result,
        )

    await connection.async_send_message(result_message(message["command_id"]))
    await connection.async_send_message(await connection.run_in_executor(_result))
    await connection.async_send_message(
        cancel_subscription_message(message["command_id"])
    )


@websocket_command(
    {
        vol.Required("type"): "render_template",
        vol.Required("template"): str,
    }
)
async def handle_render_template(connection: WebSocketHandler, message) -> None:
    """Render a Jinja2 template."""
    template = message["template"]
    try:
        jinja2_template(template)
        rendered = await connection.run_in_executor(
            render_template, connection.vis, template
        )
    except Exception as exception:  # pylint: disable=broad-except
        LOGGER.debug("Failed to render template: %s", exception)
        await connection.async_send_message(
            error_message(
                message["command_id"],
                WS_ERROR_NOT_FOUND,
                f"Failed to render template: {exception}",
            )
        )
        return
    await connection.async_send_message(result_message(message["command_id"], rendered))


@websocket_command({vol.Required("type"): "get_setup_status"})
async def get_setup_status(connection: WebSocketHandler, message) -> None:
    """Get combined setup status for all components and domains."""
    status = await connection.run_in_executor(connection.vis.get_setup_status)
    await connection.async_send_message(
        result_message(message["command_id"], status),
    )
