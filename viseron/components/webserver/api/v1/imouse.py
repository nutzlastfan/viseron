"""iMouse camera control API handler."""

from __future__ import annotations

import logging
import re
import warnings
from functools import partial
from http import HTTPStatus
from typing import Any

import httpx
import voluptuous as vol
from ruamel.yaml import YAML, YAMLError
from ruamel.yaml.error import ReusedAnchorWarning

from viseron.components.webserver.api.handlers import BaseAPIHandler
from viseron.components.webserver.auth import Role
from viseron.const import CONFIG_PATH

LOGGER = logging.getLogger(__name__)

CONFIG_IMOUSE = "imouse"
CONFIG_SITE = "site"
CONFIG_WEBSERVER = "webserver"
DEFAULT_DEVICE_CAMERA_PATTERN = (
    r"^(?P<device>.+)_(?P<side>left|right|links|rechts)$"
)
CAMERA_ID_PATTERN = re.compile(r"^cam[0-9]+$")
COMMANDS = [
    "focus_minus",
    "focus_plus",
    "focus_reset",
    "focus_auto",
    "ev_minus",
    "ev0",
    "ev_plus",
    "exposure_minus",
    "exposure_plus",
    "gain_minus",
    "gain_plus",
    "hdr_on",
    "hdr_off",
    "daylight",
    "nightlight",
]
PWM_COMMANDS = {"daylight", "nightlight"}
SIDE_TO_CAMERA = {
    "left": "cam0",
    "right": "cam1",
    "links": "cam0",
    "rechts": "cam1",
}
SIDE_LABEL = {
    "left": "left",
    "right": "right",
    "links": "left",
    "rechts": "right",
}


class IMouseRequestError(Exception):
    """Raised when an iMouse device request fails."""

    def __init__(self, status: HTTPStatus, reason: str) -> None:
        super().__init__(reason)
        self.status = status
        self.reason = reason


class ImouseAPIHandler(BaseAPIHandler):
    """Handler for iMouse camera control calls."""

    routes = [
        {
            "requires_role": [Role.ADMIN],
            "path_pattern": r"/imouse",
            "supported_methods": ["GET"],
            "method": "get_devices",
        },
        {
            "requires_role": [Role.ADMIN],
            "path_pattern": r"/imouse/(?P<device_id>[A-Za-z0-9_-]+)/rescan",
            "supported_methods": ["POST"],
            "method": "rescan_device",
        },
        {
            "requires_role": [Role.ADMIN],
            "path_pattern": (
                r"/imouse/(?P<device_id>[A-Za-z0-9_-]+)/"
                r"(?P<camera_id>cam[0-9]+)/command"
            ),
            "supported_methods": ["POST"],
            "method": "send_command",
            "json_body_schema": vol.Schema(
                {
                    vol.Required("command"): vol.In(COMMANDS),
                    vol.Optional("value"): vol.All(
                        vol.Coerce(float), vol.Range(min=0.0, max=1.0)
                    ),
                }
            ),
        },
    ]

    @staticmethod
    def _yaml() -> YAML:
        """Return configured YAML parser."""
        return YAML(typ="rt")

    @classmethod
    def _load_config(cls) -> dict[str, Any]:
        """Load configuration from the active config file."""
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", ReusedAnchorWarning)
                with open(CONFIG_PATH, encoding="utf-8") as config_file:
                    return cls._yaml().load(config_file) or {}
        except (OSError, YAMLError) as error:
            LOGGER.warning("Failed to load config for iMouse devices: %s", error)
            return {}

    @staticmethod
    def _format_identifier_label(identifier: str) -> str:
        """Return a readable identifier label."""
        return identifier.replace("_", " ").strip()

    @classmethod
    def _site_config(cls, config: dict[str, Any]) -> dict[str, Any]:
        """Return optional integration config."""
        webserver_config = config.get(CONFIG_WEBSERVER) or {}
        site_config = webserver_config.get(CONFIG_SITE) or {}
        return site_config if isinstance(site_config, dict) else {}

    @classmethod
    def _imouse_config(cls, config: dict[str, Any]) -> dict[str, Any]:
        """Return optional iMouse config."""
        imouse_config = cls._site_config(config).get(CONFIG_IMOUSE) or {}
        return imouse_config if isinstance(imouse_config, dict) else {}

    @classmethod
    def _device_camera_pattern(cls, imouse_config: dict[str, Any]) -> re.Pattern:
        """Return the configured camera-to-device pattern."""
        pattern = str(
            imouse_config.get("camera_pattern") or DEFAULT_DEVICE_CAMERA_PATTERN
        )
        try:
            return re.compile(pattern)
        except re.error:
            LOGGER.warning(
                "Invalid iMouse camera pattern %s; using default pattern",
                pattern,
                exc_info=True,
            )
            return re.compile(DEFAULT_DEVICE_CAMERA_PATTERN)

    @staticmethod
    def _side_config(imouse_config: dict[str, Any], side: str) -> dict[str, str]:
        """Return camera id and label for a matched side."""
        configured_side_map = imouse_config.get("side_map") or {}
        configured_side = (
            configured_side_map.get(side)
            if isinstance(configured_side_map, dict)
            else None
        )
        if isinstance(configured_side, dict):
            camera_id = str(configured_side.get("camera_id") or "")
            if CAMERA_ID_PATTERN.match(camera_id):
                return {
                    "camera_id": camera_id,
                    "label": str(configured_side.get("label") or side),
                }

        camera_id = SIDE_TO_CAMERA.get(side)
        if not camera_id:
            return {}
        return {
            "camera_id": camera_id,
            "label": SIDE_LABEL.get(side, side),
        }

    @classmethod
    def _device_name(cls, imouse_config: dict[str, Any], device_id: str) -> str:
        """Return a display name for a device."""
        template = imouse_config.get("device_name_template")
        if isinstance(template, str) and template:
            try:
                return template.format(
                    device=device_id,
                    label=cls._format_identifier_label(device_id),
                )
            except (IndexError, KeyError, ValueError):
                LOGGER.warning(
                    "Invalid iMouse device name template %s",
                    template,
                    exc_info=True,
                )
        return cls._format_identifier_label(device_id)

    @classmethod
    def _configured_devices(cls) -> list[dict[str, Any]]:
        """Return configured Raspberry/iMouse devices."""
        config = cls._load_config()
        camera_config_by_id = config.get("ffmpeg", {}).get("camera", {}) or {}
        imouse_config = cls._imouse_config(config)
        device_camera_pattern = cls._device_camera_pattern(imouse_config)
        devices: dict[str, dict[str, Any]] = {}
        for identifier, camera_config in camera_config_by_id.items():
            match = device_camera_pattern.match(str(identifier))
            if not match:
                continue

            groups = match.groupdict()
            device_id = groups.get("device")
            side = groups.get("side")
            if not device_id or not side:
                continue
            side_config = cls._side_config(imouse_config, side)
            if not side_config:
                continue

            host = str(camera_config.get("host") or "")
            if not host:
                continue

            device = devices.setdefault(
                device_id,
                {
                    "id": device_id,
                    "name": cls._device_name(imouse_config, device_id),
                    "host": host,
                    "cameras": [],
                },
            )
            device["host"] = host
            device["cameras"].append(
                {
                    "id": side_config["camera_id"],
                    "side": side_config["label"],
                    "camera_identifier": str(identifier),
                    "name": str(camera_config.get("name") or identifier),
                    "available": False,
                }
            )

        for device in devices.values():
            device["cameras"].sort(key=lambda item: item["id"])

        return sorted(
            devices.values(),
            key=lambda item: item["name"].lower(),
        )

    @classmethod
    def _device_by_id(cls, device_id: str) -> dict[str, Any] | None:
        """Return a configured iMouse device by id."""
        for device in cls._configured_devices():
            if device["id"] == device_id:
                return device
        return None

    @staticmethod
    def _request_device(
        host: str,
        path: str,
        *,
        method: str = "GET",
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Request an iMouse Flask device and return JSON-ish data."""
        url = f"http://{host}:5000{path}"
        try:
            with httpx.Client(timeout=2.0) as client:
                response = (
                    client.post(url, data=data)
                    if method == "POST"
                    else client.get(url)
                )
        except httpx.RequestError as error:
            raise IMouseRequestError(
                HTTPStatus.BAD_GATEWAY,
                f"iMouse device {host} is unreachable: {error}",
            ) from error

        if response.status_code >= 400:
            raise IMouseRequestError(
                HTTPStatus.BAD_GATEWAY,
                f"iMouse device {host} returned HTTP {response.status_code}",
            )

        try:
            payload = response.json()
        except ValueError:
            payload = {"success": True}

        if isinstance(payload, dict):
            return payload
        return {"data": payload}

    @classmethod
    def _device_status(cls, device: dict[str, Any]) -> dict[str, Any]:
        """Return a device with live iMouse camera status attached."""
        try:
            payload = cls._request_device(device["host"], "/api/cameras")
            available_cameras = set(payload.get("cameras") or [])
            reachable = True
            error = None
        except IMouseRequestError as err:
            available_cameras = set()
            reachable = False
            error = err.reason

        cameras = [
            {
                **camera,
                "available": camera["id"] in available_cameras,
            }
            for camera in device["cameras"]
        ]
        return {
            **device,
            "reachable": reachable,
            "error": error,
            "flask_cameras": sorted(available_cameras),
            "cameras": cameras,
        }

    async def get_devices(self) -> None:
        """Return configured iMouse devices and their current Flask status."""
        devices = await self.run_in_executor(self._configured_devices)
        statuses = [
            await self.run_in_executor(self._device_status, device)
            for device in devices
        ]
        await self.response_success(response={"devices": statuses})

    async def rescan_device(self, device_id: str) -> None:
        """Trigger an iMouse camera rescan on a device."""
        device = await self.run_in_executor(self._device_by_id, device_id)
        if not device:
            self.response_error(HTTPStatus.NOT_FOUND, "iMouse device not found")
            return

        try:
            payload = await self.run_in_executor(
                self._request_device, device["host"], "/api/rescan"
            )
        except IMouseRequestError as err:
            self.response_error(err.status, err.reason)
            return

        await self.response_success(
            response={
                "device_id": device_id,
                "host": device["host"],
                **payload,
            }
        )

    async def send_command(self, device_id: str, camera_id: str) -> None:
        """Proxy a whitelisted iMouse camera command."""
        device = await self.run_in_executor(self._device_by_id, device_id)
        if not device:
            self.response_error(HTTPStatus.NOT_FOUND, "iMouse device not found")
            return

        if not CAMERA_ID_PATTERN.match(camera_id):
            self.response_error(HTTPStatus.BAD_REQUEST, "Invalid iMouse camera id")
            return

        configured_camera_ids = {camera["id"] for camera in device["cameras"]}
        if camera_id not in configured_camera_ids:
            self.response_error(
                HTTPStatus.NOT_FOUND,
                f"Camera {camera_id} is not configured for {device_id}",
            )
            return

        command = self.json_body["command"]
        data = None
        if command in PWM_COMMANDS:
            if "value" not in self.json_body:
                self.response_error(
                    HTTPStatus.BAD_REQUEST,
                    f"Command {command} requires a PWM value",
                )
                return
            data = {"value": str(self.json_body["value"])}
        elif "value" in self.json_body:
            self.response_error(
                HTTPStatus.BAD_REQUEST,
                f"Command {command} does not accept a value",
            )
            return

        try:
            payload = await self.run_in_executor(
                partial(
                    self._request_device,
                    device["host"],
                    f"/{camera_id}/{command}",
                    method="POST",
                    data=data,
                )
            )
        except IMouseRequestError as err:
            self.response_error(err.status, err.reason)
            return

        await self.response_success(
            response={
                "device_id": device_id,
                "camera_id": camera_id,
                "command": command,
                **payload,
            }
        )
