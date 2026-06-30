"""Recording schedule API handler."""

from __future__ import annotations

import logging
from http import HTTPStatus
from typing import Any

import voluptuous as vol

from viseron.components.webserver.api.handlers import BaseAPIHandler, require_auth
from viseron.components.webserver.auth import Role
from viseron.components.webserver.const import (
    CAMERA_PERMISSION_ADMIN_OVERRIDE,
    CAMERA_PERMISSION_MANAGE_SCHEDULE,
    CONFIG_AUTH,
    CONFIG_CAMERA_GROUPS,
    CONFIG_CAMERAS,
)
from viseron.helpers import utcnow

LOGGER = logging.getLogger(__name__)

SCHEDULE_SCHEMA = vol.Schema(
    {
        vol.Optional("rules", default=[]): [
            {
                vol.Required("id"): str,
                vol.Required("name"): str,
                vol.Optional("enabled", default=True): bool,
                vol.Optional("reason", default=None): vol.Maybe(str),
                vol.Optional("recording", default="ignore"): vol.In(
                    ["record", "block", "ignore"]
                ),
                vol.Optional("block_live", default=False): bool,
                vol.Optional("targets", default={}): {
                    vol.Optional("cameras", default=[]): [str],
                    vol.Optional("camera_groups", default=[]): [str],
                },
                vol.Optional("weekdays", default=[]): [
                    vol.All(vol.Coerce(int), vol.Range(min=0, max=6))
                ],
                vol.Optional("start_time", default="00:00"): str,
                vol.Optional("end_time", default="23:59"): str,
                vol.Optional("starts_at", default=None): vol.Maybe(str),
                vol.Optional("ends_at", default=None): vol.Maybe(str),
            }
        ],
        vol.Optional("overrides", default={}): dict,
        vol.Optional("metadata", default={}): dict,
    },
    extra=vol.ALLOW_EXTRA,
)


class RecordingScheduleAPIHandler(BaseAPIHandler):
    """Handler for NVR recording schedules."""

    routes = [
        {
            "requires_role": [Role.ADMIN, Role.READ, Role.WRITE],
            "path_pattern": r"/recording_schedule",
            "supported_methods": ["GET"],
            "method": "get_recording_schedule",
        },
        {
            "requires_role": [Role.ADMIN, Role.WRITE],
            "path_pattern": r"/recording_schedule",
            "supported_methods": ["PUT"],
            "method": "put_recording_schedule",
            "json_body_schema": SCHEDULE_SCHEMA,
        },
    ]

    @staticmethod
    def _camera_groups(auth_config: dict[str, Any]) -> list[dict[str, Any]]:
        groups = []
        for group_id, group in (auth_config.get(CONFIG_CAMERA_GROUPS) or {}).items():
            groups.append(
                {
                    "id": str(group_id),
                    "name": str(group.get("name") or group_id),
                    CONFIG_CAMERAS: list(group.get(CONFIG_CAMERAS) or []),
                }
            )
        return groups

    @staticmethod
    def _camera_group_lookup(auth_config: dict[str, Any]) -> dict[str, list[str]]:
        """Return configured camera groups as a lookup."""
        return {
            str(group_id): list((group or {}).get(CONFIG_CAMERAS) or [])
            for group_id, group in (auth_config.get(CONFIG_CAMERA_GROUPS) or {}).items()
        }

    @classmethod
    def _target_cameras(
        cls, auth_config: dict[str, Any], targets: dict[str, Any]
    ) -> set[str]:
        """Expand schedule targets to camera identifiers."""
        camera_group_lookup = cls._camera_group_lookup(auth_config)
        camera_identifiers = set(targets.get(CONFIG_CAMERAS) or [])
        for group_id in targets.get(CONFIG_CAMERA_GROUPS) or []:
            camera_identifiers.update(camera_group_lookup.get(group_id, []))
        return camera_identifiers

    @staticmethod
    def _rule_compare_data(rule: dict[str, Any]) -> dict[str, Any]:
        """Return stable data used to decide if a rule changed."""
        targets = rule.get("targets") or {}
        return {
            "name": rule.get("name"),
            "enabled": bool(rule.get("enabled", True)),
            "reason": rule.get("reason"),
            "recording": rule.get("recording"),
            "block_live": bool(rule.get("block_live", False)),
            "targets": {
                "cameras": sorted(targets.get(CONFIG_CAMERAS) or []),
                "camera_groups": sorted(targets.get(CONFIG_CAMERA_GROUPS) or []),
            },
            "weekdays": sorted(rule.get("weekdays") or []),
            "start_time": rule.get("start_time"),
            "end_time": rule.get("end_time"),
            "starts_at": rule.get("starts_at"),
            "ends_at": rule.get("ends_at"),
        }

    def _changed_schedule_cameras(
        self, schedule: dict[str, Any], auth_config: dict[str, Any]
    ) -> set[str]:
        """Return cameras touched by new, changed, or removed schedule rules."""
        current_rules = {
            rule.get("id"): rule
            for rule in self._webserver.camera_policy.policy.get("rules", [])
            if rule.get("id")
        }
        next_rules = {
            rule.get("id"): rule for rule in schedule.get("rules") or [] if rule.get("id")
        }
        changed_cameras: set[str] = set()

        for rule_id, next_rule in next_rules.items():
            current_rule = current_rules.get(rule_id)
            if current_rule and self._rule_compare_data(
                current_rule
            ) == self._rule_compare_data(next_rule):
                continue

            changed_cameras.update(
                self._target_cameras(auth_config, next_rule.get("targets") or {})
            )
            if current_rule:
                changed_cameras.update(
                    self._target_cameras(auth_config, current_rule.get("targets") or {})
                )

        for rule_id, current_rule in current_rules.items():
            if rule_id not in next_rules:
                changed_cameras.update(
                    self._target_cameras(auth_config, current_rule.get("targets") or {})
                )

        return changed_cameras

    def _missing_schedule_permissions(
        self, schedule: dict[str, Any], auth_config: dict[str, Any]
    ) -> list[str]:
        """Return cameras for which current user may not manage schedule rules."""
        return sorted(
            camera_identifier
            for camera_identifier in self._changed_schedule_cameras(
                schedule, auth_config
            )
            if not self.has_camera_permission(
                camera_identifier, CAMERA_PERMISSION_MANAGE_SCHEDULE
            )
        )

    def _missing_override_permissions(self, schedule: dict[str, Any]) -> list[str]:
        """Return cameras for which current user may not change admin override."""
        current_overrides = self._webserver.camera_policy.policy.get("overrides", {})
        next_overrides = schedule.get("overrides") or {}
        changed_cameras = set(current_overrides) | set(next_overrides)
        missing = [
            camera_identifier
            for camera_identifier in changed_cameras
            if current_overrides.get(camera_identifier) != next_overrides.get(
                camera_identifier
            )
            and not self.has_camera_permission(
                camera_identifier, CAMERA_PERMISSION_ADMIN_OVERRIDE
            )
        ]
        return sorted(missing)

    def _response(self) -> dict[str, Any]:
        cameras = self._get_cameras() or {}
        status = {
            identifier: self._webserver.camera_policy.camera_status(
                identifier,
                allow_override=True,
            )
            for identifier in cameras
        }
        auth_config = self._webserver.config.get(CONFIG_AUTH) or {}
        return {
            "config": self._webserver.camera_policy.policy,
            "status": status,
            "camera_groups": self._camera_groups(auth_config),
        }

    @require_auth
    async def get_recording_schedule(self) -> None:
        """Return configured and effective recording schedule."""
        await self.response_success(response=self._response())

    @require_auth
    async def put_recording_schedule(self) -> None:
        """Save recording schedule."""
        if not self.current_user or self.current_user.role not in {
            Role.ADMIN,
            Role.WRITE,
        }:
            self.response_error(HTTPStatus.FORBIDDEN, reason="Write role required")
            return

        schedule = dict(self.json_body)
        auth_config = self._webserver.config.get(CONFIG_AUTH) or {}
        missing_schedule_permissions = self._missing_schedule_permissions(
            schedule, auth_config
        )
        if missing_schedule_permissions:
            self.response_error(
                HTTPStatus.FORBIDDEN,
                reason=(
                    "Missing schedule permission for cameras: "
                    + ", ".join(missing_schedule_permissions)
                ),
            )
            return

        if self.current_user.role != Role.ADMIN:
            schedule["overrides"] = self._webserver.camera_policy.policy.get(
                "overrides", {}
            )
        else:
            missing_override_permissions = self._missing_override_permissions(schedule)
            if missing_override_permissions:
                self.response_error(
                    HTTPStatus.FORBIDDEN,
                    reason=(
                        "Missing admin override permission for cameras: "
                        + ", ".join(missing_override_permissions)
                    ),
                )
                return

        metadata = dict(schedule.get("metadata") or {})
        metadata.update(
            {
                "last_saved_at": utcnow().isoformat(),
                "last_saved_by": self.current_user.username,
                "last_saved_role": self.current_user.role.value,
            }
        )
        schedule["metadata"] = metadata

        try:
            await self.run_in_executor(
                self._webserver.camera_policy.replace,
                schedule,
            )
        except OSError as error:
            LOGGER.error("Failed to save recording schedule: %s", error, exc_info=True)
            self.response_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                reason=f"Failed to save recording schedule: {error}",
            )
            return

        await self.response_success(response=self._response())
