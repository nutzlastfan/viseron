"""Camera access API handler."""

from __future__ import annotations

import re
from http import HTTPStatus
from typing import Any

import voluptuous as vol
from ruamel.yaml import YAML, YAMLError
from ruamel.yaml.comments import CommentedMap, CommentedSeq

from viseron.components.webserver.api.handlers import BaseAPIHandler, require_auth
from viseron.components.webserver.auth import AuthenticationFailedError, Role
from viseron.components.webserver.const import (
    CAMERA_PERMISSIONS,
    COMPONENT as WEBSERVER_COMPONENT,
    CONFIG_AUTH,
    CONFIG_CAMERA_GROUPS,
    CONFIG_CAMERAS,
    CONFIG_FEEDER_GROUPS,
    CONFIG_FEEDERS,
    CONFIG_GROUPS,
    CONFIG_LDAP_CAMERA_ACCESS,
    CONFIG_LDAP_FEEDER_ACCESS,
    CONFIG_PERMISSIONS,
)
from viseron.components.webserver.config_backup import backup_config
from viseron.const import CONFIG_PATH
from viseron.reload import reload_config

CAMERA_ACCESS_CONFIG_SCHEMA = vol.Schema(
    {
        vol.Required(CONFIG_CAMERA_GROUPS): [
            {
                vol.Required("id"): str,
                vol.Required("name"): str,
                vol.Required(CONFIG_CAMERAS): [str],
            }
        ],
        vol.Required(CONFIG_LDAP_CAMERA_ACCESS): [
            {
                vol.Required(CONFIG_GROUPS): [str],
                vol.Required(CONFIG_CAMERA_GROUPS): [str],
                vol.Required(CONFIG_CAMERAS): [str],
                vol.Optional(CONFIG_PERMISSIONS, default=[]): [
                    vol.In(CAMERA_PERMISSIONS)
                ],
            }
        ],
        vol.Required(CONFIG_FEEDER_GROUPS): [
            {
                vol.Required("id"): str,
                vol.Required("name"): str,
                vol.Required(CONFIG_FEEDERS): [str],
            }
        ],
        vol.Required(CONFIG_LDAP_FEEDER_ACCESS): [
            {
                vol.Required(CONFIG_GROUPS): [str],
                vol.Required(CONFIG_FEEDER_GROUPS): [str],
                vol.Required(CONFIG_FEEDERS): [str],
            }
        ],
    }
)

IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9_]+$")


class CameraaccessAPIHandler(BaseAPIHandler):
    """Handler for camera access settings."""

    routes = [
        {
            "requires_role": [Role.ADMIN],
            "path_pattern": r"/cameraaccess/effective",
            "supported_methods": ["GET"],
            "method": "get_effective_camera_access",
            "request_arguments_schema": vol.Schema({vol.Required("username"): str}),
        },
        {
            "requires_role": [Role.ADMIN],
            "path_pattern": r"/cameraaccess/report",
            "supported_methods": ["GET"],
            "method": "get_camera_access_report",
        },
        {
            "requires_role": [Role.ADMIN],
            "path_pattern": r"/cameraaccess",
            "supported_methods": ["GET"],
            "method": "get_camera_access_config",
        },
        {
            "requires_role": [Role.ADMIN],
            "path_pattern": r"/cameraaccess",
            "supported_methods": ["PUT"],
            "method": "save_camera_access_config",
            "json_body_schema": vol.Schema(
                {vol.Required("config"): CAMERA_ACCESS_CONFIG_SCHEMA}
            ),
        },
    ]

    def _yaml(self) -> YAML:
        """Return configured YAML parser."""
        yaml = YAML(typ="rt")
        yaml.preserve_quotes = True
        return yaml

    def _load_config(self) -> dict[str, Any]:
        """Load and parse config.yaml."""
        with open(CONFIG_PATH, encoding="utf-8") as config_file:
            return self._yaml().load(config_file) or {}

    def _save_config(self, config: dict[str, Any]) -> None:
        """Save config.yaml."""
        backup_config("camera_access")
        with open(CONFIG_PATH, "w", encoding="utf-8") as config_file:
            self._yaml().dump(config, config_file)

    @staticmethod
    def _auth_config(config: dict[str, Any]) -> dict[str, Any]:
        webserver_config = config.get(WEBSERVER_COMPONENT) or {}
        return webserver_config.get(CONFIG_AUTH) or {}

    @staticmethod
    def _sanitize_config(auth_config: dict[str, Any]) -> dict[str, Any]:
        camera_groups = []
        for group_id, group in (auth_config.get(CONFIG_CAMERA_GROUPS) or {}).items():
            camera_groups.append(
                {
                    "id": str(group_id),
                    "name": str(group.get("name") or group_id),
                    CONFIG_CAMERAS: list(group.get(CONFIG_CAMERAS) or []),
                }
            )
        feeder_groups = []
        for group_id, group in (auth_config.get(CONFIG_FEEDER_GROUPS) or {}).items():
            feeder_groups.append(
                {
                    "id": str(group_id),
                    "name": str(group.get("name") or group_id),
                    CONFIG_FEEDERS: list(group.get(CONFIG_FEEDERS) or []),
                }
            )

        return {
            CONFIG_CAMERA_GROUPS: camera_groups,
            CONFIG_LDAP_CAMERA_ACCESS: [
                {
                    CONFIG_GROUPS: list(rule.get(CONFIG_GROUPS) or []),
                    CONFIG_CAMERA_GROUPS: list(rule.get(CONFIG_CAMERA_GROUPS) or []),
                    CONFIG_CAMERAS: list(rule.get(CONFIG_CAMERAS) or []),
                    CONFIG_PERMISSIONS: list(rule.get(CONFIG_PERMISSIONS) or []),
                }
                for rule in auth_config.get(CONFIG_LDAP_CAMERA_ACCESS) or []
            ],
            CONFIG_FEEDER_GROUPS: feeder_groups,
            CONFIG_LDAP_FEEDER_ACCESS: [
                {
                    CONFIG_GROUPS: list(rule.get(CONFIG_GROUPS) or []),
                    CONFIG_FEEDER_GROUPS: list(rule.get(CONFIG_FEEDER_GROUPS) or []),
                    CONFIG_FEEDERS: list(rule.get(CONFIG_FEEDERS) or []),
                }
                for rule in auth_config.get(CONFIG_LDAP_FEEDER_ACCESS) or []
            ],
        }

    @staticmethod
    def _normalize_groups(
        config_groups: list[dict[str, Any]], item_key: str, group_kind: str
    ) -> tuple[CommentedMap, set[str]]:
        seen_group_ids: set[str] = set()
        groups = CommentedMap()

        for group in config_groups:
            group_id = group["id"].strip()
            if not IDENTIFIER_PATTERN.match(group_id):
                raise ValueError(
                    f"{group_kind} group id '{group_id}' must contain only letters, "
                    "numbers and underscores"
                )
            if group_id in seen_group_ids:
                raise ValueError(f"Duplicate {group_kind} group id '{group_id}'")
            seen_group_ids.add(group_id)

            normalized_group = CommentedMap()
            normalized_group["name"] = group["name"].strip() or group_id
            normalized_group[item_key] = CommentedSeq(
                list(dict.fromkeys(group[item_key]))
            )
            groups[group_id] = normalized_group

        return groups, seen_group_ids

    @staticmethod
    def _normalize_rules(
        config_rules: list[dict[str, Any]],
        group_key: str,
        item_key: str,
        seen_group_ids: set[str],
        group_kind: str,
        *,
        include_permissions: bool = False,
    ) -> CommentedSeq:
        rules = CommentedSeq()
        for rule in config_rules:
            missing_groups = [
                group_id for group_id in rule[group_key] if group_id not in seen_group_ids
            ]
            if missing_groups:
                raise ValueError(
                    f"LDAP access rule references unknown {group_kind} groups: "
                    + ", ".join(missing_groups)
                )

            normalized_rule = CommentedMap()
            normalized_rule[CONFIG_GROUPS] = CommentedSeq(
                [
                    group.strip()
                    for group in dict.fromkeys(rule[CONFIG_GROUPS])
                    if group.strip()
                ]
            )
            normalized_rule[group_key] = CommentedSeq(
                list(dict.fromkeys(rule[group_key]))
            )
            normalized_rule[item_key] = CommentedSeq(list(dict.fromkeys(rule[item_key])))
            if include_permissions:
                normalized_rule[CONFIG_PERMISSIONS] = CommentedSeq(
                    [
                        permission
                        for permission in dict.fromkeys(
                            rule.get(CONFIG_PERMISSIONS) or []
                        )
                        if permission in CAMERA_PERMISSIONS
                    ]
                )
            if normalized_rule[CONFIG_GROUPS]:
                rules.append(normalized_rule)
        return rules

    @classmethod
    def _normalize_config(cls, config: dict[str, Any]) -> dict[str, Any]:
        camera_groups, seen_camera_group_ids = cls._normalize_groups(
            config[CONFIG_CAMERA_GROUPS], CONFIG_CAMERAS, "Camera"
        )
        feeder_groups, seen_feeder_group_ids = cls._normalize_groups(
            config[CONFIG_FEEDER_GROUPS], CONFIG_FEEDERS, "Feeder"
        )

        return {
            CONFIG_CAMERA_GROUPS: camera_groups,
            CONFIG_LDAP_CAMERA_ACCESS: cls._normalize_rules(
                config[CONFIG_LDAP_CAMERA_ACCESS],
                CONFIG_CAMERA_GROUPS,
                CONFIG_CAMERAS,
                seen_camera_group_ids,
                "camera",
                include_permissions=True,
            ),
            CONFIG_FEEDER_GROUPS: feeder_groups,
            CONFIG_LDAP_FEEDER_ACCESS: cls._normalize_rules(
                config[CONFIG_LDAP_FEEDER_ACCESS],
                CONFIG_FEEDER_GROUPS,
                CONFIG_FEEDERS,
                seen_feeder_group_ids,
                "feeder",
            ),
        }

    @staticmethod
    def _camera_report(auth_config: dict[str, Any]) -> dict[str, Any]:
        """Return transparent camera access rule report."""
        camera_groups = auth_config.get(CONFIG_CAMERA_GROUPS) or {}
        rules = []
        for index, rule in enumerate(auth_config.get(CONFIG_LDAP_CAMERA_ACCESS) or []):
            expanded_cameras = set(rule.get(CONFIG_CAMERAS) or [])
            expanded_groups = []
            for group_id in rule.get(CONFIG_CAMERA_GROUPS) or []:
                group = camera_groups.get(group_id) or {}
                group_cameras = list(group.get(CONFIG_CAMERAS) or [])
                expanded_groups.append(
                    {
                        "id": str(group_id),
                        "name": str(group.get("name") or group_id),
                        CONFIG_CAMERAS: group_cameras,
                    }
                )
                expanded_cameras.update(group_cameras)
            rules.append(
                {
                    "index": index,
                    CONFIG_GROUPS: list(rule.get(CONFIG_GROUPS) or []),
                    CONFIG_CAMERA_GROUPS: list(rule.get(CONFIG_CAMERA_GROUPS) or []),
                    CONFIG_CAMERAS: list(rule.get(CONFIG_CAMERAS) or []),
                    CONFIG_PERMISSIONS: list(rule.get(CONFIG_PERMISSIONS) or []),
                    "expanded_groups": expanded_groups,
                    "expanded_cameras": sorted(expanded_cameras),
                    "uses_role_default_permissions": not bool(
                        rule.get(CONFIG_PERMISSIONS)
                    ),
                }
            )
        return {"rules": rules}

    @staticmethod
    def _write_camera_access_config(
        config: dict[str, Any], camera_access_config: dict[str, Any]
    ) -> None:
        webserver_config = config.setdefault(WEBSERVER_COMPONENT, CommentedMap())
        auth_config = webserver_config.setdefault(CONFIG_AUTH, CommentedMap())
        auth_config[CONFIG_CAMERA_GROUPS] = camera_access_config[CONFIG_CAMERA_GROUPS]
        auth_config[CONFIG_LDAP_CAMERA_ACCESS] = camera_access_config[
            CONFIG_LDAP_CAMERA_ACCESS
        ]
        auth_config[CONFIG_FEEDER_GROUPS] = camera_access_config[CONFIG_FEEDER_GROUPS]
        auth_config[CONFIG_LDAP_FEEDER_ACCESS] = camera_access_config[
            CONFIG_LDAP_FEEDER_ACCESS
        ]

    @require_auth
    async def get_camera_access_config(self) -> None:
        """Return camera access configuration."""
        config = await self.run_in_executor(self._load_config)
        await self.response_success(
            response={"config": self._sanitize_config(self._auth_config(config))}
        )

    @require_auth
    async def save_camera_access_config(self) -> None:
        """Save camera access configuration."""

        def _save() -> dict[str, Any]:
            config = self._load_config()
            camera_access_config = self._normalize_config(self.json_body["config"])
            self._write_camera_access_config(config, camera_access_config)
            self._save_config(config)
            result = reload_config(self._vis)
            return {
                "success": result.success,
                "restart_required": result.restart_required,
                "errors": [str(error) for error in result.errors],
            }

        try:
            result = await self.run_in_executor(_save)
        except (ValueError, YAMLError) as error:
            self.response_error(HTTPStatus.BAD_REQUEST, str(error))
            return

        await self.response_success(response=result)

    @require_auth
    async def get_effective_camera_access(self) -> None:
        """Return effective camera permissions for one LDAP user."""
        username = self.request_arguments["username"].strip()
        if not username:
            self.response_error(HTTPStatus.BAD_REQUEST, reason="Username is required")
            return

        try:
            result = await self.run_in_executor(self.auth.inspect_ldap_user, username)
        except AuthenticationFailedError as error:
            self.response_error(HTTPStatus.BAD_REQUEST, reason=str(error))
            return

        await self.response_success(response=result)

    @require_auth
    async def get_camera_access_report(self) -> None:
        """Return transparent camera access rule report."""
        config = await self.run_in_executor(self._load_config)
        await self.response_success(
            response=self._camera_report(self._auth_config(config))
        )
