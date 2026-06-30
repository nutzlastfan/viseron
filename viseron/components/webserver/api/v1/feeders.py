"""Feeders API handler."""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from http import HTTPStatus
from http.cookies import SimpleCookie
from typing import Any
from urllib import parse, request
from urllib.error import HTTPError, URLError

import voluptuous as vol
from ruamel.yaml import YAML, YAMLError

from viseron.components.webserver.api.handlers import BaseAPIHandler
from viseron.components.webserver.auth import Role
from viseron.const import CONFIG_PATH

LOGGER = logging.getLogger(__name__)

CONFIG_SITE = "site"
CONFIG_WEBSERVER = "webserver"
CONFIG_ROOMS = "rooms"
CONFIG_FEEDERS = "feeders"
CONFIG_READ_ONLY = "read_only"
DEFAULT_TIMEOUT = 2
MAX_FEEDER_WORKERS = 8

FEEDER_ID_SCHEMA = vol.All(str, vol.Match(r"^[A-Za-z0-9_]+$"))
SETTINGS_SCHEMA = vol.Schema(
    {
        vol.Required("mode"): bool,
        vol.Required("door"): bool,
    }
)
ANIMAL_SCHEMA = vol.Schema({vol.Required("tagid"): vol.All(str, vol.Length(min=1))})
LOCK_SCHEMA = vol.Schema(
    {
        vol.Required("day"): vol.All(vol.Coerce(int), vol.Range(min=0, max=7)),
        vol.Required("from_h"): vol.All(vol.Coerce(int), vol.Range(min=0, max=23)),
        vol.Required("from_m"): vol.All(vol.Coerce(int), vol.Range(min=0, max=59)),
        vol.Required("to_h"): vol.All(vol.Coerce(int), vol.Range(min=0, max=23)),
        vol.Required("to_m"): vol.All(vol.Coerce(int), vol.Range(min=0, max=59)),
    }
)

ACTION_LABELS = {
    1: "Fütterung gestartet",
    2: "Fütterung beendet",
    3: "Fütterung wegen falschem Tier beendet",
    4: "Futterautomat gesperrt",
    5: "Falsches Tier",
}


class FeederError(Exception):
    """Error communicating with a feeder."""


class FeederReadOnlyError(Exception):
    """Raised when feeders are configured as read-only."""


class FeedersAPIHandler(BaseAPIHandler):
    """Handler for API calls related to feeding stations."""

    routes = [
        {
            "path_pattern": r"/feeders",
            "supported_methods": ["GET"],
            "method": "get_feeding_stations",
        },
        {
            "path_pattern": r"/feeders/(?P<feeder_id>[A-Za-z0-9_]+)",
            "supported_methods": ["GET"],
            "method": "get_feeding_station",
        },
        {
            "path_pattern": r"/feeders/(?P<feeder_id>[A-Za-z0-9_]+)/protocol",
            "supported_methods": ["GET"],
            "method": "get_protocol",
        },
        {
            "requires_role": [Role.ADMIN, Role.WRITE],
            "path_pattern": r"/feeders/(?P<feeder_id>[A-Za-z0-9_]+)/settings",
            "supported_methods": ["POST"],
            "method": "set_settings",
            "json_body_schema": SETTINGS_SCHEMA,
        },
        {
            "requires_role": [Role.ADMIN, Role.WRITE],
            "path_pattern": r"/feeders/(?P<feeder_id>[A-Za-z0-9_]+)/animals",
            "supported_methods": ["POST"],
            "method": "add_animal",
            "json_body_schema": ANIMAL_SCHEMA,
        },
        {
            "requires_role": [Role.ADMIN, Role.WRITE],
            "path_pattern": (
                r"/feeders/(?P<feeder_id>[A-Za-z0-9_]+)/animals/"
                r"(?P<animal_id>[0-9]+)"
            ),
            "supported_methods": ["DELETE"],
            "method": "delete_animal",
        },
        {
            "requires_role": [Role.ADMIN, Role.WRITE],
            "path_pattern": r"/feeders/(?P<feeder_id>[A-Za-z0-9_]+)/locks",
            "supported_methods": ["POST"],
            "method": "add_lock",
            "json_body_schema": LOCK_SCHEMA,
        },
        {
            "requires_role": [Role.ADMIN, Role.WRITE],
            "path_pattern": (
                r"/feeders/(?P<feeder_id>[A-Za-z0-9_]+)/locks/"
                r"(?P<lock_id>[0-9]+)"
            ),
            "supported_methods": ["DELETE"],
            "method": "delete_lock",
        },
    ]

    @staticmethod
    def _yaml() -> YAML:
        """Return configured YAML parser."""
        yaml = YAML(typ="rt")
        yaml.preserve_quotes = True
        return yaml

    def _load_config(self) -> dict[str, Any]:
        """Load config.yaml."""
        with open(CONFIG_PATH, encoding="utf-8") as config_file:
            return self._yaml().load(config_file) or {}

    @staticmethod
    def _default_feeders() -> dict[str, dict[str, Any]]:
        """Return default feeder configuration."""
        return {}

    @staticmethod
    def _default_rooms() -> dict[str, dict[str, Any]]:
        """Return default room configuration."""
        return {}

    def _site_config(self) -> dict[str, Any]:
        """Return site integration config with defaults."""
        config = self._load_config()
        webserver_config = config.get(CONFIG_WEBSERVER) or {}
        site_config = webserver_config.get(CONFIG_SITE) or config.get(CONFIG_SITE) or {}
        return {
            CONFIG_FEEDERS: site_config.get(CONFIG_FEEDERS)
            or self._default_feeders(),
            CONFIG_ROOMS: site_config.get(CONFIG_ROOMS) or self._default_rooms(),
            CONFIG_READ_ONLY: bool(site_config.get(CONFIG_READ_ONLY, False)),
        }

    @staticmethod
    def _normalize_feeder_config(
        feeder_id: str, feeder_config: dict[str, Any]
    ) -> dict[str, Any]:
        """Return normalized feeder config."""
        normalized_config = dict(feeder_config)
        normalized_config["id"] = feeder_id
        normalized_config.setdefault("name", feeder_id)
        normalized_config.setdefault("port", 8080)
        normalized_config.setdefault(CONFIG_READ_ONLY, False)
        return normalized_config

    def _get_feeder_config(
        self, feeder_id: str, feeders_config: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Return feeder config."""
        feeders = feeders_config or self._site_config()[CONFIG_FEEDERS]
        if feeder_id not in feeders:
            raise KeyError(feeder_id)
        return self._normalize_feeder_config(feeder_id, feeders[feeder_id])

    def _room_camera_access(self, room: dict[str, Any]) -> bool:
        """Return if current user may access a room via assigned cameras."""
        if not self.current_user or self.current_user.assigned_cameras is None:
            return True
        assigned_cameras = set(self.current_user.assigned_cameras)
        return any(
            camera_id in assigned_cameras for camera_id in room.get("cameras") or []
        )

    def _feeder_access(self, feeder_id: str, site_config: dict[str, Any]) -> bool:
        """Return if current user may access a feeder."""
        if not self._webserver.auth or not self.current_user:
            return True
        if self.current_user.role == Role.ADMIN:
            return True
        if (
            self.current_user.assigned_cameras is None
            and self.current_user.assigned_feeders is None
        ):
            return True
        if (
            self.current_user.assigned_feeders is not None
            and feeder_id in self.current_user.assigned_feeders
        ):
            return True
        return any(
            feeder_id in (room.get("feeders") or []) and self._room_camera_access(room)
            for room in site_config[CONFIG_ROOMS].values()
        )

    def _accessible_feeder_ids(self, site_config: dict[str, Any]) -> set[str]:
        """Return feeder ids visible to current user."""
        return {
            feeder_id
            for feeder_id in site_config[CONFIG_FEEDERS]
            if self._feeder_access(feeder_id, site_config)
        }

    def _ensure_feeder_access(
        self, feeder_id: str, site_config: dict[str, Any]
    ) -> None:
        """Raise if current user may not access feeder."""
        if feeder_id not in site_config[CONFIG_FEEDERS]:
            raise KeyError(feeder_id)
        if not self._feeder_access(feeder_id, site_config):
            raise PermissionError(feeder_id)

    def _feeder_read_only(
        self, feeder_id: str, site_config: dict[str, Any]
    ) -> bool:
        """Return if a feeder is configured as read-only."""
        feeder_config = self._get_feeder_config(
            feeder_id, site_config[CONFIG_FEEDERS]
        )
        return bool(site_config[CONFIG_READ_ONLY] or feeder_config[CONFIG_READ_ONLY])

    def _ensure_feeder_write_access(
        self, feeder_id: str, site_config: dict[str, Any]
    ) -> None:
        """Raise if a feeder must not be changed."""
        self._ensure_feeder_access(feeder_id, site_config)
        if self._feeder_read_only(feeder_id, site_config):
            raise FeederReadOnlyError(feeder_id)

    @staticmethod
    def _base_url(feeder_config: dict[str, Any]) -> str:
        """Return feeder base URL."""
        return f"http://{feeder_config['host']}:{feeder_config['port']}"

    @staticmethod
    def _request_url(
        url: str,
        *,
        method: str = "GET",
        data: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, str, dict[str, str]]:
        """Call a feeder endpoint."""
        encoded_data = None
        if data is not None:
            encoded_data = parse.urlencode(data).encode()
        req = request.Request(
            url,
            data=encoded_data,
            headers=headers or {},
            method=method,
        )
        try:
            with request.urlopen(req, timeout=DEFAULT_TIMEOUT) as response:
                body = response.read().decode("utf-8", errors="replace")
                return response.status, body, dict(response.headers)
        except HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise FeederError(f"HTTP {error.code}: {body[:200]}") from error
        except (OSError, URLError) as error:
            raise FeederError(str(error)) from error

    def _post_feeder(
        self, feeder_config: dict[str, Any], endpoint: str, data: dict[str, Any] | None
    ) -> str:
        """POST to a feeder endpoint with its Django CSRF token."""
        base_url = self._base_url(feeder_config)
        _status, _body, headers = self._request_url(f"{base_url}/")
        cookie = SimpleCookie(headers.get("Set-Cookie", ""))
        csrf_token = cookie["csrftoken"].value if "csrftoken" in cookie else ""
        request_headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRFToken": csrf_token,
        }
        if csrf_token:
            request_headers["Cookie"] = f"csrftoken={csrf_token}"
        _status, body, _headers = self._request_url(
            f"{base_url}/{endpoint}",
            method="POST",
            data=data or {},
            headers=request_headers,
        )
        return body

    @staticmethod
    def _load_json_response(body: str) -> Any:
        """Load feeder JSON response."""
        return json.loads(body)

    @staticmethod
    def _offline_feeder_state(
        feeder_id: str, feeder_config: dict[str, Any], error: str
    ) -> dict[str, Any]:
        """Return an unavailable feeder state."""
        return {
            "id": feeder_id,
            "name": feeder_config["name"],
            "host": feeder_config["host"],
            "port": feeder_config["port"],
            "read_only": bool(feeder_config[CONFIG_READ_ONLY]),
            "available": False,
            "error": error,
            "settings": {"mode": None, "door": None},
            "animals": [],
            "locks": [],
            "protocol": [],
        }

    def _get_feeder_state(
        self, feeder_id: str, feeder_config: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Return feeder state."""
        if feeder_config is None:
            feeder_config = self._get_feeder_config(feeder_id)
        else:
            feeder_config = self._normalize_feeder_config(feeder_id, feeder_config)
        response = self._offline_feeder_state(feeder_id, feeder_config, "")
        response["error"] = None
        try:
            response["settings"] = self._load_json_response(
                self._post_feeder(feeder_config, "getsettings", None)
            )
            response["animals"] = [
                {"tagid": tagid, "id": animal_id}
                for tagid, animal_id in self._load_json_response(
                    self._post_feeder(feeder_config, "getanimals", None)
                )
            ]
            response["locks"] = [
                {
                    "day": day,
                    "from_time": from_time,
                    "to_time": to_time,
                    "id": lock_id,
                }
                for day, from_time, to_time, lock_id in self._load_json_response(
                    self._post_feeder(feeder_config, "getlocks", None)
                )
            ]
            response["protocol"] = self._protocol_response(
                self._load_json_response(
                    self._post_feeder(feeder_config, "getprotocol", None)
                )[:10]
            )
            response["available"] = True
        except (FeederError, json.JSONDecodeError, KeyError, ValueError) as error:
            response["error"] = str(error)
        return response

    def _get_feeder_states(
        self, site_config: dict[str, Any], accessible_feeder_ids: set[str]
    ) -> list[dict[str, Any]]:
        """Return feeder states without letting one slow feeder block all others."""
        feeder_items = [
            (
                feeder_id,
                {
                    **site_config[CONFIG_FEEDERS][feeder_id],
                    CONFIG_READ_ONLY: self._feeder_read_only(feeder_id, site_config),
                },
            )
            for feeder_id in site_config[CONFIG_FEEDERS]
            if feeder_id in accessible_feeder_ids
        ]
        if not feeder_items:
            return []

        states_by_id: dict[str, dict[str, Any]] = {}
        max_workers = min(MAX_FEEDER_WORKERS, len(feeder_items))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map = {
                executor.submit(self._get_feeder_state, feeder_id, feeder_config): (
                    feeder_id,
                    self._normalize_feeder_config(feeder_id, feeder_config),
                )
                for feeder_id, feeder_config in feeder_items
            }
            for future in as_completed(future_map):
                feeder_id, feeder_config = future_map[future]
                try:
                    states_by_id[feeder_id] = future.result()
                except Exception as error:  # pylint: disable=broad-except
                    LOGGER.error(
                        "Failed to load feeder %s: %s",
                        feeder_id,
                        error,
                        exc_info=True,
                    )
                    states_by_id[feeder_id] = self._offline_feeder_state(
                        feeder_id, feeder_config, str(error)
                    )

        return [states_by_id[feeder_id] for feeder_id, _config in feeder_items]

    @staticmethod
    def _protocol_response(protocol: list[list[Any]]) -> list[dict[str, Any]]:
        """Transform feeder protocol to objects."""
        return [
            {
                "timestamp": timestamp,
                "tagid": tagid,
                "action": action,
                "action_label": ACTION_LABELS.get(action, f"Aktion {action}"),
                "duration": duration,
            }
            for timestamp, tagid, action, duration in protocol
        ]

    async def get_feeding_stations(self) -> None:
        """Return configured rooms and feeding stations."""

        def _get_response() -> dict[str, Any]:
            site_config = self._site_config()
            accessible_feeder_ids = self._accessible_feeder_ids(site_config)
            feeders = self._get_feeder_states(site_config, accessible_feeder_ids)
            rooms = [
                {
                    "id": room_id,
                    "name": str(room.get("name") or room_id),
                    "cameras": self.filter_camera_identifiers(
                        list(room.get("cameras") or [])
                    ),
                    "feeders": [
                        feeder_id
                        for feeder_id in list(room.get("feeders") or [])
                        if feeder_id in accessible_feeder_ids
                    ],
                }
                for room_id, room in site_config[CONFIG_ROOMS].items()
                if any(
                    feeder_id in accessible_feeder_ids
                    for feeder_id in list(room.get("feeders") or [])
                )
            ]
            return {
                "rooms": rooms,
                "feeders": feeders,
                "read_only": bool(site_config[CONFIG_READ_ONLY]),
            }

        try:
            response = await self.run_in_executor(_get_response)
        except (OSError, YAMLError) as error:
            LOGGER.error("Failed to load feeders: %s", error, exc_info=True)
            self.response_error(HTTPStatus.INTERNAL_SERVER_ERROR, str(error))
            return

        await self.response_success(response=response)

    async def get_feeding_station(self, feeder_id: str) -> None:
        """Return a feeding station."""
        try:
            site_config = await self.run_in_executor(self._site_config)
            self._ensure_feeder_access(feeder_id, site_config)
            feeder_config = self._get_feeder_config(
                feeder_id, site_config[CONFIG_FEEDERS]
            )
            feeder_config[CONFIG_READ_ONLY] = self._feeder_read_only(
                feeder_id, site_config
            )
            response = await self.run_in_executor(
                self._get_feeder_state, feeder_id, feeder_config
            )
        except KeyError:
            self.response_error(HTTPStatus.NOT_FOUND, f"Feeder {feeder_id} not found")
            return
        except PermissionError:
            self.response_error(HTTPStatus.FORBIDDEN, "Insufficient permissions")
            return
        await self.response_success(response={"feeder": response})

    async def get_protocol(self, feeder_id: str) -> None:
        """Return feeding station protocol."""

        def _get_response() -> dict[str, Any]:
            site_config = self._site_config()
            self._ensure_feeder_access(feeder_id, site_config)
            feeder_config = self._get_feeder_config(feeder_id)
            protocol = self._load_json_response(
                self._post_feeder(feeder_config, "getprotocol", None)
            )
            return {"protocol": self._protocol_response(protocol)}

        try:
            response = await self.run_in_executor(_get_response)
        except KeyError:
            self.response_error(HTTPStatus.NOT_FOUND, f"Feeder {feeder_id} not found")
            return
        except PermissionError:
            self.response_error(HTTPStatus.FORBIDDEN, "Insufficient permissions")
            return
        except (FeederError, json.JSONDecodeError, ValueError) as error:
            self.response_error(HTTPStatus.BAD_GATEWAY, str(error))
            return
        await self.response_success(response=response)

    async def set_settings(self, feeder_id: str) -> None:
        """Set feeding station settings."""

        def _set_settings() -> dict[str, Any]:
            site_config = self._site_config()
            self._ensure_feeder_write_access(feeder_id, site_config)
            feeder_config = self._get_feeder_config(feeder_id)
            self._post_feeder(
                feeder_config,
                "setsettings",
                {
                    "mode": str(self.json_body["mode"]).lower(),
                    "door": str(self.json_body["door"]).lower(),
                },
            )
            return self._get_feeder_state(feeder_id)

        try:
            response = await self.run_in_executor(_set_settings)
        except KeyError:
            self.response_error(HTTPStatus.NOT_FOUND, f"Feeder {feeder_id} not found")
            return
        except PermissionError:
            self.response_error(HTTPStatus.FORBIDDEN, "Insufficient permissions")
            return
        except FeederReadOnlyError:
            self.response_error(
                HTTPStatus.FORBIDDEN,
                "Feeders are read-only until approved for write access",
            )
            return
        except (FeederError, json.JSONDecodeError, ValueError) as error:
            self.response_error(HTTPStatus.BAD_GATEWAY, str(error))
            return
        await self.response_success(response={"feeder": response})

    async def add_animal(self, feeder_id: str) -> None:
        """Add an animal tag to a feeding station."""

        def _add_animal() -> dict[str, Any]:
            site_config = self._site_config()
            self._ensure_feeder_write_access(feeder_id, site_config)
            feeder_config = self._get_feeder_config(feeder_id)
            self._post_feeder(
                feeder_config,
                "addanimal",
                {"tagid": self.json_body["tagid"].strip()},
            )
            return self._get_feeder_state(feeder_id)

        try:
            response = await self.run_in_executor(_add_animal)
        except KeyError:
            self.response_error(HTTPStatus.NOT_FOUND, f"Feeder {feeder_id} not found")
            return
        except PermissionError:
            self.response_error(HTTPStatus.FORBIDDEN, "Insufficient permissions")
            return
        except FeederReadOnlyError:
            self.response_error(
                HTTPStatus.FORBIDDEN,
                "Feeders are read-only until approved for write access",
            )
            return
        except (FeederError, json.JSONDecodeError, ValueError) as error:
            self.response_error(HTTPStatus.BAD_GATEWAY, str(error))
            return
        await self.response_success(response={"feeder": response})

    async def delete_animal(self, feeder_id: str, animal_id: str) -> None:
        """Delete an animal tag from a feeding station."""
        await self._delete_feeder_item(feeder_id, "deleteanimal", "id", animal_id)

    async def add_lock(self, feeder_id: str) -> None:
        """Add a feeding lock."""

        def _add_lock() -> dict[str, Any]:
            site_config = self._site_config()
            self._ensure_feeder_write_access(feeder_id, site_config)
            feeder_config = self._get_feeder_config(feeder_id)
            self._post_feeder(feeder_config, "addlock", self.json_body)
            return self._get_feeder_state(feeder_id)

        try:
            response = await self.run_in_executor(_add_lock)
        except KeyError:
            self.response_error(HTTPStatus.NOT_FOUND, f"Feeder {feeder_id} not found")
            return
        except PermissionError:
            self.response_error(HTTPStatus.FORBIDDEN, "Insufficient permissions")
            return
        except FeederReadOnlyError:
            self.response_error(
                HTTPStatus.FORBIDDEN,
                "Feeders are read-only until approved for write access",
            )
            return
        except (FeederError, json.JSONDecodeError, ValueError) as error:
            self.response_error(HTTPStatus.BAD_GATEWAY, str(error))
            return
        await self.response_success(response={"feeder": response})

    async def delete_lock(self, feeder_id: str, lock_id: str) -> None:
        """Delete a feeding lock."""
        await self._delete_feeder_item(feeder_id, "deletelock", "id", lock_id)

    async def _delete_feeder_item(
        self, feeder_id: str, endpoint: str, key: str, value: str
    ) -> None:
        """Delete an item on a feeding station."""

        def _delete_item() -> dict[str, Any]:
            site_config = self._site_config()
            self._ensure_feeder_write_access(feeder_id, site_config)
            feeder_config = self._get_feeder_config(feeder_id)
            self._post_feeder(feeder_config, endpoint, {key: value})
            return self._get_feeder_state(feeder_id)

        try:
            response = await self.run_in_executor(_delete_item)
        except KeyError:
            self.response_error(HTTPStatus.NOT_FOUND, f"Feeder {feeder_id} not found")
            return
        except PermissionError:
            self.response_error(HTTPStatus.FORBIDDEN, "Insufficient permissions")
            return
        except FeederReadOnlyError:
            self.response_error(
                HTTPStatus.FORBIDDEN,
                "Feeders are read-only until approved for write access",
            )
            return
        except (FeederError, json.JSONDecodeError, ValueError) as error:
            self.response_error(HTTPStatus.BAD_GATEWAY, str(error))
            return
        await self.response_success(response={"feeder": response})
