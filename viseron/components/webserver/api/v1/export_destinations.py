"""Export destination API handler."""

from __future__ import annotations

import re
from http import HTTPStatus
from typing import Any

import voluptuous as vol
from ruamel.yaml import YAML

from viseron.components.webserver.api.handlers import BaseAPIHandler, require_auth
from viseron.components.webserver.auth import Role
from viseron.components.webserver.config_backup import backup_config
from viseron.const import CONFIG_PATH
from viseron.reload import reload_config

DEFAULT_EXPORT_DESTINATION_ID = "browser"
DEFAULT_EXPORT_DESTINATIONS: dict[str, dict[str, Any]] = {}

DESTINATION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")

EXPORT_DESTINATIONS_SCHEMA = vol.Schema(
    {
        vol.Required("destinations"): [
            {
                vol.Required("id"): vol.All(str, vol.Match(DESTINATION_ID_PATTERN)),
                vol.Required("name"): vol.All(str, vol.Length(min=1)),
                vol.Required("path"): vol.All(str, vol.Length(min=1)),
                vol.Optional("enabled", default=True): bool,
            }
        ]
    }
)


class ExportDestinationsAPIHandler(BaseAPIHandler):
    """Handler for server-side export destinations."""

    routes = [
        {
            "requires_role": [Role.ADMIN, Role.WRITE, Role.READ],
            "path_pattern": r"/export_destinations",
            "supported_methods": ["GET"],
            "method": "get_export_destinations",
        },
        {
            "requires_role": [Role.ADMIN],
            "path_pattern": r"/export_destinations",
            "supported_methods": ["PUT"],
            "method": "put_export_destinations",
            "json_body_schema": EXPORT_DESTINATIONS_SCHEMA,
        },
    ]

    def _yaml(self) -> YAML:
        yaml = YAML(typ="rt")
        yaml.preserve_quotes = True
        return yaml

    def _load_config(self) -> dict[str, Any]:
        with open(CONFIG_PATH, encoding="utf-8") as config_file:
            return self._yaml().load(config_file) or {}

    def _save_config(self, config: dict[str, Any]) -> None:
        backup_config("export_destinations")
        with open(CONFIG_PATH, "w", encoding="utf-8") as config_file:
            self._yaml().dump(config, config_file)

    @staticmethod
    def _destinations_from_config(config: dict[str, Any]) -> dict[str, dict[str, Any]]:
        webserver_config = config.get("webserver") or {}
        site_config = webserver_config.get("site") or {}
        destinations = site_config.get("export_destinations")
        if isinstance(destinations, dict) and destinations:
            return destinations
        return DEFAULT_EXPORT_DESTINATIONS

    @staticmethod
    def _as_response(destinations: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        response = []
        for destination_id, destination in destinations.items():
            if not isinstance(destination, dict):
                continue
            response.append(
                {
                    "id": str(destination_id),
                    "name": str(destination.get("name") or destination_id),
                    "path": str(destination.get("path") or ""),
                    "enabled": bool(destination.get("enabled", True)),
                }
            )
        return sorted(response, key=lambda item: item["name"].lower())

    @require_auth([Role.ADMIN, Role.WRITE, Role.READ])
    async def get_export_destinations(self) -> None:
        """Get configured export destinations."""
        config = self._load_config()
        destinations = self._as_response(self._destinations_from_config(config))
        self.response_success(
            response={
                "destinations": destinations,
                "default_destination": DEFAULT_EXPORT_DESTINATION_ID,
            }
        )

    @require_auth([Role.ADMIN])
    async def put_export_destinations(self) -> None:
        """Save configured export destinations."""
        destinations = {}
        for destination in self.json_body["destinations"]:
            destinations[destination["id"]] = {
                "name": destination["name"],
                "path": destination["path"],
                "enabled": bool(destination.get("enabled", True)),
            }

        config = self._load_config()
        webserver_config = config.setdefault("webserver", {})
        site_config = webserver_config.setdefault("site", {})
        site_config["export_destinations"] = destinations
        self._save_config(config)

        if not reload_config(self._vis, self._vis.config_path):
            self.response_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                reason="Export destinations saved, but config reload failed",
            )
            return

        self.response_success(
            response={
                "saved": True,
                "destinations": self._as_response(destinations),
            }
        )
