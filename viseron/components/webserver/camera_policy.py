"""NVR recording schedule and live blocking handling."""

from __future__ import annotations

import datetime
import json
import os
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Literal

from viseron.components.webserver.const import CONFIG_CAMERA_GROUPS, CONFIG_CAMERAS
from viseron.const import STORAGE_PATH
from viseron.helpers import utcnow

PolicyAction = Literal["recording", "live"]
RecordingMode = Literal["record", "block", "ignore"]

POLICY_PATH = f"{STORAGE_PATH}/recording_schedule.json"
LEGACY_POLICY_PATH = f"{STORAGE_PATH}/camera_policies.json"

DEFAULT_SCHEDULE: dict[str, Any] = {
    "rules": [],
    "overrides": {},
    "metadata": {},
}


@dataclass
class PolicyDecision:
    """Decision for a recording schedule check."""

    allowed: bool
    reason: str | None = None
    rule_id: str | None = None
    rule_name: str | None = None
    override_active: bool = False
    scheduled_recording: bool = False

    def as_dict(self) -> dict[str, Any]:
        """Return policy decision as dict."""
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "rule_id": self.rule_id,
            "rule_name": self.rule_name,
            "override_active": self.override_active,
            "override_until": None,
            "scheduled_recording": self.scheduled_recording,
        }


def _parse_time(value: str) -> datetime.time | None:
    try:
        hour, minute = value.split(":", 1)
        return datetime.time(hour=int(hour), minute=int(minute))
    except (AttributeError, TypeError, ValueError):
        return None


def _parse_datetime(value: str | None) -> datetime.datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed.astimezone(datetime.timezone.utc).replace(tzinfo=None)


def _now_local() -> datetime.datetime:
    return datetime.datetime.now().astimezone()


class CameraPolicyStore:
    """Persist and evaluate NVR recording schedules."""

    def __init__(
        self,
        auth_config: dict[str, Any] | None = None,
        path: str = POLICY_PATH,
    ) -> None:
        self._path = path
        self._camera_groups = self._normalize_camera_groups(auth_config or {})
        self._policy = self._load()

    @staticmethod
    def _normalize_camera_groups(auth_config: dict[str, Any]) -> dict[str, list[str]]:
        groups: dict[str, list[str]] = {}
        for group_id, group in (auth_config.get(CONFIG_CAMERA_GROUPS) or {}).items():
            groups[str(group_id)] = list(group.get(CONFIG_CAMERAS) or [])
        return groups

    def update_camera_groups(self, auth_config: dict[str, Any]) -> None:
        """Update existing camera group lookup."""
        self._camera_groups = self._normalize_camera_groups(auth_config)

    def _load(self) -> dict[str, Any]:
        if os.path.exists(self._path):
            with open(self._path, encoding="utf-8") as policy_file:
                return self._normalize(json.load(policy_file))

        if os.path.exists(LEGACY_POLICY_PATH):
            with open(LEGACY_POLICY_PATH, encoding="utf-8") as policy_file:
                return self._normalize(json.load(policy_file))

        return deepcopy(DEFAULT_SCHEDULE)

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        with open(self._path, "w", encoding="utf-8") as policy_file:
            json.dump(self._policy, policy_file, indent=2, sort_keys=True)

    @staticmethod
    def _normalize_rule(rule: dict[str, Any]) -> dict[str, Any] | None:
        if not isinstance(rule, dict) or not rule.get("id"):
            return None

        targets = rule.get("targets", {}) or {}
        recording = rule.get("recording")
        if recording not in {"record", "block", "ignore"}:
            blocks = rule.get("blocks", [])
            recording = "block" if "recording" in blocks else "ignore"

        return {
            "id": str(rule["id"]),
            "name": str(rule.get("name") or "Recording schedule"),
            "enabled": bool(rule.get("enabled", True)),
            "reason": rule.get("reason"),
            "recording": recording,
            "block_live": bool(rule.get("block_live", "live" in rule.get("blocks", []))),
            "targets": {
                "cameras": list(targets.get("cameras") or []),
                "camera_groups": list(
                    targets.get("camera_groups") or targets.get("groups") or []
                ),
            },
            "weekdays": [int(day) for day in rule.get("weekdays", [])],
            "start_time": rule.get("start_time", "00:00"),
            "end_time": rule.get("end_time", "23:59"),
            "starts_at": rule.get("starts_at"),
            "ends_at": rule.get("ends_at"),
        }

    @staticmethod
    def _normalize_overrides(overrides: dict[str, Any]) -> dict[str, Any]:
        normalized: dict[str, Any] = {}
        for camera_identifier, camera_override in (overrides or {}).items():
            if not isinstance(camera_override, dict):
                continue
            normalized[str(camera_identifier)] = {
                "recording": bool(
                    camera_override.get("recording", {}).get("enabled")
                    if isinstance(camera_override.get("recording"), dict)
                    else camera_override.get("recording", False)
                ),
                "live": bool(
                    camera_override.get("live", {}).get("enabled")
                    if isinstance(camera_override.get("live"), dict)
                    else camera_override.get("live", False)
                ),
            }
        return normalized

    @classmethod
    def _normalize(cls, policy: dict[str, Any]) -> dict[str, Any]:
        normalized = deepcopy(DEFAULT_SCHEDULE)
        if isinstance(policy, dict):
            normalized.update(policy)

        rules = []
        for rule in normalized.get("rules", []):
            normalized_rule = cls._normalize_rule(rule)
            if normalized_rule:
                rules.append(normalized_rule)

        normalized["rules"] = rules
        normalized["overrides"] = cls._normalize_overrides(
            normalized.get("overrides", {}) or {}
        )
        return normalized

    @property
    def policy(self) -> dict[str, Any]:
        """Return configured recording schedule."""
        return deepcopy(self._policy)

    def replace(self, policy: dict[str, Any]) -> dict[str, Any]:
        """Replace configured recording schedule."""
        self._policy = self._normalize(policy)
        self._save()
        return self.policy

    def _camera_groups_for_camera(self, camera_identifier: str) -> list[str]:
        return [
            group_id
            for group_id, cameras in self._camera_groups.items()
            if camera_identifier in cameras
        ]

    def _rule_targets_camera(self, rule: dict[str, Any], camera_identifier: str) -> bool:
        targets = rule.get("targets", {}) or {}
        camera_groups = self._camera_groups_for_camera(camera_identifier)
        return (
            camera_identifier in targets.get("cameras", [])
            or any(
                group in targets.get("camera_groups", []) for group in camera_groups
            )
        )

    @staticmethod
    def _rule_date_window_applies(rule: dict[str, Any]) -> bool:
        starts_at = _parse_datetime(rule.get("starts_at"))
        ends_at = _parse_datetime(rule.get("ends_at"))
        now_utc = utcnow().replace(tzinfo=None)
        if starts_at and now_utc < starts_at:
            return False
        if ends_at and now_utc > ends_at:
            return False
        return True

    @staticmethod
    def _rule_applies_now(rule: dict[str, Any], now: datetime.datetime) -> bool:
        if not rule.get("enabled", True):
            return False

        if not CameraPolicyStore._rule_date_window_applies(rule):
            return False

        weekdays = rule.get("weekdays", [])
        if weekdays and now.weekday() not in weekdays:
            return False

        start_time = _parse_time(rule.get("start_time", "00:00"))
        end_time = _parse_time(rule.get("end_time", "23:59"))
        if not start_time or not end_time:
            return False

        current_time = now.time()
        if start_time <= end_time:
            return start_time <= current_time <= end_time
        return current_time >= start_time or current_time <= end_time

    def _override_active(self, camera_identifier: str, action: PolicyAction) -> bool:
        camera_override = self._policy.get("overrides", {}).get(camera_identifier, {})
        return bool(camera_override.get(action))

    def _targeted_rules(self, camera_identifier: str) -> list[dict[str, Any]]:
        return [
            rule
            for rule in self._policy["rules"]
            if rule.get("enabled", True)
            and self._rule_date_window_applies(rule)
            and self._rule_targets_camera(rule, camera_identifier)
        ]

    def decision(
        self, camera_identifier: str, action: PolicyAction, *, allow_override: bool
    ) -> PolicyDecision:
        """Return if an action is currently allowed for a camera."""
        if allow_override and self._override_active(camera_identifier, action):
            return PolicyDecision(
                allowed=True,
                reason="Admin override active",
                override_active=True,
            )

        now = _now_local()
        targeted_rules = self._targeted_rules(camera_identifier)

        if action == "live":
            for rule in targeted_rules:
                if rule.get("block_live") and self._rule_applies_now(rule, now):
                    return PolicyDecision(
                        allowed=False,
                        reason=rule.get("reason") or "Live view blocked by schedule",
                        rule_id=rule.get("id"),
                        rule_name=rule.get("name"),
                    )
            return PolicyDecision(allowed=True)

        active_record_rules = []
        has_record_schedule = False
        for rule in targeted_rules:
            recording_mode: RecordingMode = rule.get("recording", "ignore")
            if recording_mode == "ignore":
                continue
            if recording_mode == "record":
                has_record_schedule = True
            if not self._rule_applies_now(rule, now):
                continue
            if recording_mode == "block":
                return PolicyDecision(
                    allowed=False,
                    reason=rule.get("reason") or "Recording blocked by schedule",
                    rule_id=rule.get("id"),
                    rule_name=rule.get("name"),
                )
            if recording_mode == "record":
                active_record_rules.append(rule)

        if active_record_rules:
            rule = active_record_rules[0]
            return PolicyDecision(
                allowed=True,
                reason=rule.get("reason") or "Scheduled recording active",
                rule_id=rule.get("id"),
                rule_name=rule.get("name"),
                scheduled_recording=True,
            )

        if has_record_schedule:
            return PolicyDecision(
                allowed=False,
                reason="Outside recording schedule",
            )

        return PolicyDecision(allowed=True)

    def camera_status(
        self, camera_identifier: str, *, allow_override: bool
    ) -> dict[str, Any]:
        """Return effective recording schedule status for a camera."""
        recording = self.decision(
            camera_identifier, "recording", allow_override=allow_override
        )
        live = self.decision(camera_identifier, "live", allow_override=allow_override)
        return {
            "recording": recording.as_dict(),
            "live": live.as_dict(),
        }
