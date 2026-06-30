import { Add, Save, TrashCan } from "@carbon/icons-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";
import { useMemo, useRef, useState } from "react";

import { useAuthContext } from "context/AuthContext";
import { useCameras } from "lib/api/cameras";
import {
  useRecordingSchedule,
  useUpdateRecordingSchedule,
} from "lib/api/recordingSchedule";
import * as types from "lib/types";

const WEEKDAYS = [
  { value: 0, label: "Mon" },
  { value: 1, label: "Tue" },
  { value: 2, label: "Wed" },
  { value: 3, label: "Thu" },
  { value: 4, label: "Fri" },
  { value: 5, label: "Sat" },
  { value: 6, label: "Sun" },
];

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const CSV_COLUMNS = [
  "target_type",
  "target_id",
  "target_name",
  "rule_id",
  "enabled",
  "recording",
  "block_live",
  "weekdays",
  "start_time",
  "end_time",
  "valid_from",
  "valid_until",
  "name",
  "status_message",
  "notes",
  "help_recording",
  "help_block_live",
];

const RECORDING_HELP =
  "record=automatic recording; block=recording blocked; ignore=no recording change";

const LIVE_HELP =
  "TRUE blocks live view during this window; FALSE leaves live view allowed";

const EMPTY_CONFIG: types.RecordingScheduleConfig = {
  rules: [],
  overrides: {},
  metadata: {},
};

type TargetType = "camera" | "group";

type Target = {
  type: TargetType;
  id: string;
  label: string;
  cameraIds: string[];
};

type CameraOption = {
  id: string;
  name: string;
};

type ScheduleWindowPatch = Pick<
  types.RecordingScheduleRule,
  | "weekdays"
  | "start_time"
  | "end_time"
  | "starts_at"
  | "ends_at"
  | "recording"
  | "block_live"
  | "reason"
>;

type RuleConflict = {
  rule: types.RecordingScheduleRule;
  cameras: string[];
  weekdays: number[];
};

type CsvRow = Record<string, string>;

const newId = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const selectValue = (value: SelectChangeEvent<string[]>["target"]["value"]) =>
  typeof value === "string" ? value.split(",") : value;

const targetKey = (target: Target) => `${target.type}:${target.id}`;

const toLocalInput = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const fromLocalInput = (value: string) =>
  value ? new Date(value).toISOString() : null;

const toLocalCsvDate = (value?: string | null) => {
  const inputValue = toLocalInput(value ?? null);
  return inputValue ? inputValue.replace("T", " ") : "";
};

const fromCsvDate = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const germanDate = trimmed.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/,
  );
  if (germanDate) {
    const [, day, month, year, hour = "0", minute = "0"] = germanDate;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
    ).toISOString();
  }

  const normalized = trimmed.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date.toISOString();
};

const timeToMinutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return 0;
  return hour * 60 + minute;
};

const normalizeTime = (value: string) => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid time: ${value}`);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const hourInRule = (rule: types.RecordingScheduleRule, hour: number) => {
  const start = timeToMinutes(rule.start_time);
  const end = timeToMinutes(rule.end_time);
  const minute = hour * 60 + 30;

  if (start <= end) {
    return minute >= start && minute <= end;
  }
  return minute >= start || minute <= end;
};

const minuteInRule = (rule: types.RecordingScheduleRule, minute: number) => {
  const start = timeToMinutes(rule.start_time);
  const end = timeToMinutes(rule.end_time);

  if (start <= end) {
    return minute >= start && minute <= end;
  }
  return minute >= start || minute <= end;
};

const ruleTargetsTarget = (
  rule: types.RecordingScheduleRule,
  target: Target,
) => {
  if (target.type === "camera") {
    return rule.targets.cameras.includes(target.id);
  }
  return rule.targets.camera_groups.includes(target.id);
};

const targetPatch = (target: Target) =>
  target.type === "camera"
    ? { cameras: [target.id], camera_groups: [] }
    : { cameras: [], camera_groups: [target.id] };

const ruleTargetKeys = (rule: types.RecordingScheduleRule) => [
  ...rule.targets.camera_groups.map((groupId) => `group:${groupId}`),
  ...rule.targets.cameras.map((cameraId) => `camera:${cameraId}`),
];

const allWeekdays = () => WEEKDAYS.map((day) => day.value);

const formatWeekdays = (weekdays: number[]) => {
  const days = weekdays.length ? weekdays : allWeekdays();
  if (days.length === WEEKDAYS.length) return "Every day";
  return days
    .map((day) => WEEKDAYS.find((weekday) => weekday.value === day)?.label)
    .filter(Boolean)
    .join(", ");
};

function csvWeekdays(weekdays: number[]) {
  return (weekdays.length ? weekdays : allWeekdays())
    .map((day) => WEEKDAYS.find((weekday) => weekday.value === day)?.label)
    .filter(Boolean)
    .join(",");
}

function parseWeekdays(value: string) {
  const trimmed = value.trim();
  if (
    !trimmed ||
    /^(all|every day|daily|alle|taeglich|täglich)$/i.test(trimmed)
  ) {
    return allWeekdays();
  }

  const aliases: Record<string, number> = {
    "0": 0,
    mon: 0,
    monday: 0,
    mo: 0,
    montag: 0,
    "1": 1,
    tue: 1,
    tuesday: 1,
    di: 1,
    dienstag: 1,
    "2": 2,
    wed: 2,
    wednesday: 2,
    mi: 2,
    mittwoch: 2,
    "3": 3,
    thu: 3,
    thursday: 3,
    do: 3,
    donnerstag: 3,
    "4": 4,
    fri: 4,
    friday: 4,
    fr: 4,
    freitag: 4,
    "5": 5,
    sat: 5,
    saturday: 5,
    sa: 5,
    samstag: 5,
    "6": 6,
    sun: 6,
    sunday: 6,
    so: 6,
    sonntag: 6,
  };

  const days = trimmed
    .split(/[,\s]+/)
    .map((part) => aliases[part.trim().toLowerCase()])
    .filter((day): day is number => day !== undefined);

  if (!days.length) throw new Error(`Invalid weekdays: ${value}`);
  return Array.from(new Set(days)).sort();
}

function parseBoolean(value: string, fallback = false) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (
    ["1", "true", "yes", "y", "ja", "j", "on", "enabled"].includes(normalized)
  ) {
    return true;
  }
  if (
    ["0", "false", "no", "n", "nein", "off", "disabled"].includes(normalized)
  ) {
    return false;
  }
  throw new Error(`Invalid boolean: ${value}`);
}

function parseRecordingMode(value: string) {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    ["record", "automatic recording", "aufnahme", "aufzeichnen"].includes(
      normalized,
    )
  ) {
    return "record";
  }
  if (
    [
      "block",
      "block recording",
      "recording blocked",
      "aufnahme sperren",
      "aufzeichnung sperren",
    ].includes(normalized)
  ) {
    return "block";
  }
  if (
    [
      "ignore",
      "no recording change",
      "do not change recording",
      "keine aenderung",
      "keine änderung",
    ].includes(normalized)
  ) {
    return "ignore";
  }
  throw new Error(`Invalid recording mode: ${value}`);
}

const csvEscape = (value: string | number | boolean | null | undefined) => {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[;"\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

const csvEncode = (rows: CsvRow[]) => {
  const lines = [
    CSV_COLUMNS.join(";"),
    ...rows.map((row) =>
      CSV_COLUMNS.map((column) => csvEscape(row[column] ?? "")).join(";"),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
};

const parseCsv = (text: string) => {
  const cleanText = text.replace(/^\uFEFF/, "");
  const delimiter =
    (cleanText.split("\n")[0].match(/;/g) ?? []).length >=
    (cleanText.split("\n")[0].match(/,/g) ?? []).length
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < cleanText.length; index += 1) {
    const char = cleanText[index];
    const next = cleanText[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }

  const header =
    rows.shift()?.map((column) => column.trim().toLowerCase()) ?? [];
  return rows
    .filter((items) => items.some((item) => item.trim()))
    .map((items) =>
      header.reduce<CsvRow>((result, column, index) => {
        result[column] = items[index] ?? "";
        return result;
      }, {}),
    );
};

const downloadCsv = (filename: string, rows: CsvRow[]) => {
  const blob = new Blob([csvEncode(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

function cameraLabel(cameraId: string, cameras: Record<string, types.Camera>) {
  return cameras[cameraId]?.name || cameraId;
}

const ruleRows = (
  rule: types.RecordingScheduleRule,
  cameraGroups: types.CameraAccessGroup[],
  cameras: Record<string, types.Camera>,
) => {
  const rows: CsvRow[] = [];
  rule.targets.camera_groups.forEach((groupId) => {
    const group = cameraGroups.find((item) => item.id === groupId);
    rows.push({
      target_type: "group",
      target_id: groupId,
      target_name: group?.name || groupId,
      rule_id: rule.id,
      enabled: rule.enabled ? "TRUE" : "FALSE",
      recording: rule.recording,
      block_live: rule.block_live ? "TRUE" : "FALSE",
      weekdays: csvWeekdays(rule.weekdays),
      start_time: rule.start_time,
      end_time: rule.end_time,
      valid_from: toLocalCsvDate(rule.starts_at),
      valid_until: toLocalCsvDate(rule.ends_at),
      name: rule.name,
      status_message: rule.reason ?? "",
      notes: "",
      help_recording: RECORDING_HELP,
      help_block_live: LIVE_HELP,
    });
  });
  rule.targets.cameras.forEach((cameraId) => {
    rows.push({
      target_type: "camera",
      target_id: cameraId,
      target_name: cameraLabel(cameraId, cameras),
      rule_id: rule.id,
      enabled: rule.enabled ? "TRUE" : "FALSE",
      recording: rule.recording,
      block_live: rule.block_live ? "TRUE" : "FALSE",
      weekdays: csvWeekdays(rule.weekdays),
      start_time: rule.start_time,
      end_time: rule.end_time,
      valid_from: toLocalCsvDate(rule.starts_at),
      valid_until: toLocalCsvDate(rule.ends_at),
      name: rule.name,
      status_message: rule.reason ?? "",
      notes: "",
      help_recording: RECORDING_HELP,
      help_block_live: LIVE_HELP,
    });
  });
  return rows;
};

const templateRow = (target: Target): CsvRow => ({
  target_type: target.type,
  target_id: target.id,
  target_name: target.label,
  rule_id: "",
  enabled: "TRUE",
  recording: "record",
  block_live: "FALSE",
  weekdays: "Mon,Tue,Wed,Thu,Fri",
  start_time: "08:00",
  end_time: "16:00",
  valid_from: "",
  valid_until: "",
  name: `${target.label} recording window`,
  status_message: "Scheduled recording",
  notes:
    "Edit one row per recording/live rule. Import replaces rules for targets present in this file.",
  help_recording: RECORDING_HELP,
  help_block_live: LIVE_HELP,
});

const ruleFromCsvRow = (
  row: CsvRow,
  rowNumber: number,
  targets: Target[],
  usedIds: Set<string>,
) => {
  const targetType = row.target_type.trim().toLowerCase();
  const targetId = row.target_id.trim();
  if (targetType !== "camera" && targetType !== "group") {
    throw new Error(`Row ${rowNumber}: target_type must be camera or group`);
  }
  const target = targets.find(
    (item) => item.type === targetType && item.id === targetId,
  );
  if (!target) {
    throw new Error(
      `Row ${rowNumber}: unknown ${targetType} target ${targetId}`,
    );
  }

  const csvId = row.rule_id.trim();
  const id = csvId && !usedIds.has(csvId) ? csvId : newId("csv_schedule");
  usedIds.add(id);

  return {
    rule: {
      id,
      name: row.name.trim() || `${target.label} recording window`,
      enabled: parseBoolean(row.enabled, true),
      reason: row.status_message.trim() || null,
      recording: parseRecordingMode(row.recording),
      block_live: parseBoolean(row.block_live, false),
      targets: targetPatch(target),
      weekdays: parseWeekdays(row.weekdays),
      start_time: normalizeTime(row.start_time || "00:00"),
      end_time: normalizeTime(row.end_time || "23:59"),
      starts_at: fromCsvDate(row.valid_from || ""),
      ends_at: fromCsvDate(row.valid_until || ""),
    } satisfies types.RecordingScheduleRule,
    targetKey: targetKey(target),
  };
};

const groupCameraIds = (
  groupId: string,
  cameraGroups: types.CameraAccessGroup[],
) => cameraGroups.find((group) => group.id === groupId)?.cameras ?? [];

const ruleCameraIds = (
  rule: types.RecordingScheduleRule,
  cameraGroups: types.CameraAccessGroup[],
) => {
  const cameraIds = new Set(rule.targets.cameras);
  rule.targets.camera_groups.forEach((groupId) => {
    groupCameraIds(groupId, cameraGroups).forEach((cameraId) =>
      cameraIds.add(cameraId),
    );
  });
  return Array.from(cameraIds).sort();
};

const ruleTargetSummary = (
  rule: types.RecordingScheduleRule,
  cameraGroups: types.CameraAccessGroup[],
  cameras: Record<string, types.Camera>,
) => {
  const groups = rule.targets.camera_groups.map(
    (groupId) =>
      cameraGroups.find((group) => group.id === groupId)?.name || groupId,
  );
  const cameraNames = rule.targets.cameras.map((cameraId) =>
    cameraLabel(cameraId, cameras),
  );
  return [...groups, ...cameraNames].join(", ") || "No targets";
};

const normalizedWeekdays = (rule: types.RecordingScheduleRule) =>
  rule.weekdays.length ? rule.weekdays : allWeekdays();

const timeRanges = (rule: types.RecordingScheduleRule) => {
  const start = timeToMinutes(rule.start_time);
  const end = timeToMinutes(rule.end_time);
  if (start <= end) return [[start, end]];
  return [
    [start, 24 * 60],
    [0, end],
  ];
};

const rangesOverlap = (left: number[][], right: number[][]) =>
  left.some(([leftStart, leftEnd]) =>
    right.some(
      ([rightStart, rightEnd]) =>
        leftStart <= rightEnd && rightStart <= leftEnd,
    ),
  );

const ruleHasScheduleEffect = (rule: types.RecordingScheduleRule) =>
  rule.recording !== "ignore" || rule.block_live;

const conflictingRules = (
  rule: types.RecordingScheduleRule,
  rules: types.RecordingScheduleRule[],
  cameraGroups: types.CameraAccessGroup[],
) => {
  if (!rule.enabled || !ruleHasScheduleEffect(rule)) return [];

  const cameras = ruleCameraIds(rule, cameraGroups);
  const weekdays = normalizedWeekdays(rule);
  const ranges = timeRanges(rule);

  return rules
    .filter(
      (otherRule) =>
        otherRule.id !== rule.id &&
        otherRule.enabled &&
        ruleHasScheduleEffect(otherRule),
    )
    .map<RuleConflict | null>((otherRule) => {
      const sharedCameras = ruleCameraIds(otherRule, cameraGroups).filter(
        (cameraId) => cameras.includes(cameraId),
      );
      const sharedWeekdays = normalizedWeekdays(otherRule).filter((weekday) =>
        weekdays.includes(weekday),
      );
      if (
        sharedCameras.length === 0 ||
        sharedWeekdays.length === 0 ||
        !rangesOverlap(ranges, timeRanges(otherRule))
      ) {
        return null;
      }
      return {
        rule: otherRule,
        cameras: sharedCameras,
        weekdays: sharedWeekdays,
      };
    })
    .filter((conflict): conflict is RuleConflict => Boolean(conflict));
};

const ruleActiveNow = (rule: types.RecordingScheduleRule) => {
  if (!rule.enabled) return { active: false, reason: "Disabled" };
  const now = new Date();
  const startsAt = rule.starts_at ? new Date(rule.starts_at) : null;
  const endsAt = rule.ends_at ? new Date(rule.ends_at) : null;
  if (startsAt && now < startsAt) {
    return {
      active: false,
      reason: `Starts ${formatDateTime(rule.starts_at)}`,
    };
  }
  if (endsAt && now > endsAt) {
    return { active: false, reason: `Ended ${formatDateTime(rule.ends_at)}` };
  }
  if (rule.weekdays.length && !rule.weekdays.includes((now.getDay() + 6) % 7)) {
    return { active: false, reason: "Outside selected weekdays" };
  }
  if (!minuteInRule(rule, now.getHours() * 60 + now.getMinutes())) {
    return { active: false, reason: "Outside time window" };
  }
  if (rule.recording === "block") {
    return {
      active: true,
      reason: rule.reason || "Recording blocked by schedule",
    };
  }
  if (rule.recording === "record") {
    return {
      active: true,
      reason: rule.reason || "Scheduled recording active",
    };
  }
  if (rule.block_live) {
    return {
      active: true,
      reason: rule.reason || "Live view blocked by schedule",
    };
  }
  return { active: true, reason: "Window active without recording change" };
};

const decisionLabel = (
  kind: "recording" | "live",
  decision: types.RecordingScheduleDecision,
) => {
  if (kind === "recording" && decision.scheduled_recording) {
    return decision.reason || "Scheduled recording active";
  }
  if (decision.override_active) return "Admin override active";
  if (decision.allowed) {
    return kind === "recording" ? "Recording allowed" : "Live allowed";
  }
  return (
    decision.reason ||
    (kind === "recording" ? "Recording blocked" : "Live blocked")
  );
};

const ruleColor = (theme: Theme, rule?: types.RecordingScheduleRule) => {
  if (!rule) return theme.palette.action.disabledBackground;
  if (rule.recording === "record") return theme.palette.primary.main;
  if (rule.recording === "block") return theme.palette.error.main;
  if (rule.block_live) return theme.palette.warning.main;
  return theme.palette.success.main;
};

function modeLabel(rule: types.RecordingScheduleRule) {
  if (rule.recording === "record") return "Record";
  if (rule.recording === "block") return "Block recording";
  if (rule.block_live) return "Block live";
  return "No recording change";
}

function statusChip(
  kind: "recording" | "live",
  status: types.RecordingScheduleDecision | undefined,
) {
  if (!status) {
    return <Chip size="small" label={`${kind} unknown`} />;
  }
  if (kind === "recording" && status.scheduled_recording) {
    return <Chip size="small" color="primary" label="Recording by schedule" />;
  }
  if (status.override_active) {
    return <Chip size="small" color="warning" label="Admin override active" />;
  }
  if (status.allowed) {
    return (
      <Chip
        size="small"
        color="success"
        label={kind === "recording" ? "Recording allowed" : "Live allowed"}
      />
    );
  }
  return (
    <Chip
      size="small"
      color="error"
      label={
        status.reason ||
        (kind === "recording" ? "Recording blocked" : "Live blocked")
      }
    />
  );
}

function TargetStatus({
  target,
  status,
  cameras,
}: {
  target: Target;
  status: Record<string, types.RecordingScheduleStatus>;
  cameras: Record<string, types.Camera>;
}) {
  const cameraStatuses = target.cameraIds
    .map((cameraId) => ({
      id: cameraId,
      name: cameras[cameraId]?.name || cameraId,
      status: status[cameraId],
    }))
    .filter((item) => item.status);

  const blockedRecording = cameraStatuses.filter(
    (item) => item.status.recording.allowed === false,
  );
  const blockedLive = cameraStatuses.filter(
    (item) => item.status.live.allowed === false,
  );
  const scheduledRecording = cameraStatuses.filter(
    (item) => item.status.recording.scheduled_recording,
  );

  if (target.type === "camera") {
    const cameraStatus = status[target.id];
    return (
      <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
        {statusChip("recording", cameraStatus?.recording)}
        {statusChip("live", cameraStatus?.live)}
      </Stack>
    );
  }

  return (
    <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
      <Chip
        size="small"
        color={blockedRecording.length ? "error" : "success"}
        label={
          blockedRecording.length
            ? `${blockedRecording.length} recording blocked`
            : "Recording allowed for group"
        }
      />
      <Chip
        size="small"
        color={blockedLive.length ? "error" : "success"}
        label={
          blockedLive.length
            ? `${blockedLive.length} live blocked`
            : "Live allowed for group"
        }
      />
      {scheduledRecording.length > 0 && (
        <Chip
          size="small"
          color="primary"
          label={`${scheduledRecording.length} scheduled recording`}
        />
      )}
    </Stack>
  );
}

function TargetStatusDetails({
  target,
  status,
  cameras,
}: {
  target: Target;
  status: Record<string, types.RecordingScheduleStatus>;
  cameras: Record<string, types.Camera>;
}) {
  const rows = target.cameraIds
    .map((cameraId) => ({
      cameraId,
      status: status[cameraId],
    }))
    .filter((row) => row.status)
    .slice(0, 8);

  if (rows.length === 0) return null;

  return (
    <Stack spacing={0.75}>
      <Typography variant="subtitle2">Current effective status</Typography>
      {rows.map((row) => (
        <Typography key={row.cameraId} variant="body2" color="text.secondary">
          {cameraLabel(row.cameraId, cameras)}:{" "}
          {decisionLabel("recording", row.status.recording)};{" "}
          {decisionLabel("live", row.status.live)}
        </Typography>
      ))}
      {target.cameraIds.length > rows.length && (
        <Typography variant="caption" color="text.secondary">
          Showing {rows.length} of {target.cameraIds.length} cameras.
        </Typography>
      )}
    </Stack>
  );
}

function RuleNowPreview({ rule }: { rule: types.RecordingScheduleRule }) {
  const preview = ruleActiveNow(rule);
  return (
    <Alert severity={preview.active ? "success" : "info"} sx={{ py: 0.5 }}>
      Now: {preview.active ? "active" : "inactive"} - {preview.reason}
    </Alert>
  );
}

function RuleConflicts({
  conflicts,
  cameraGroups,
  cameras,
}: {
  conflicts: RuleConflict[];
  cameraGroups: types.CameraAccessGroup[];
  cameras: Record<string, types.Camera>;
}) {
  if (conflicts.length === 0) return null;

  return (
    <Alert severity="warning">
      <Stack spacing={0.5}>
        <Typography variant="body2">
          {conflicts.length} overlapping window
          {conflicts.length === 1 ? "" : "s"} for shared cameras.
        </Typography>
        {conflicts.slice(0, 4).map((conflict) => (
          <Typography key={conflict.rule.id} variant="caption">
            {conflict.rule.name}: {modeLabel(conflict.rule)} on{" "}
            {formatWeekdays(conflict.weekdays)} for{" "}
            {conflict.cameras
              .slice(0, 4)
              .map((cameraId) => cameraLabel(cameraId, cameras))
              .join(", ")}
            {conflict.cameras.length > 4 ? " ..." : ""} via{" "}
            {ruleTargetSummary(conflict.rule, cameraGroups, cameras)}
          </Typography>
        ))}
      </Stack>
    </Alert>
  );
}

function AuditSummary({
  metadata,
}: {
  metadata?: types.RecordingScheduleMetadata;
}) {
  if (!metadata?.last_saved_at && !metadata?.last_saved_by) return null;

  return (
    <Alert severity="info">
      Last saved
      {metadata.last_saved_by ? ` by ${metadata.last_saved_by}` : ""}
      {metadata.last_saved_role ? ` (${metadata.last_saved_role})` : ""}
      {metadata.last_saved_at
        ? ` at ${formatDateTime(metadata.last_saved_at)}`
        : ""}
    </Alert>
  );
}

function WeekGrid({ rules }: { rules: types.RecordingScheduleRule[] }) {
  const theme = useTheme();

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "52px repeat(24, minmax(28px, 1fr))",
          minWidth: 820,
          border: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box sx={{ borderRight: `1px solid ${theme.palette.divider}` }} />
        {HOURS.map((hour) => (
          <Box
            key={hour}
            sx={{
              px: 0.25,
              py: 0.5,
              textAlign: "center",
              fontSize: 11,
              color: "text.secondary",
              borderRight: `1px solid ${theme.palette.divider}`,
            }}
          >
            {hour}
          </Box>
        ))}
        {WEEKDAYS.map((day) => (
          <Box key={day.value} sx={{ display: "contents" }}>
            <Box
              sx={{
                px: 1,
                py: 0.75,
                fontSize: 12,
                borderTop: `1px solid ${theme.palette.divider}`,
                borderRight: `1px solid ${theme.palette.divider}`,
              }}
            >
              {day.label}
            </Box>
            {HOURS.map((hour) => {
              const activeRule = rules.find(
                (rule) =>
                  rule.enabled &&
                  rule.weekdays.includes(day.value) &&
                  hourInRule(rule, hour),
              );
              return (
                <Box
                  key={`${day.value}-${hour}`}
                  title={
                    activeRule
                      ? `${activeRule.name}: ${modeLabel(activeRule)}`
                      : ""
                  }
                  sx={{
                    height: 28,
                    borderTop: `1px solid ${theme.palette.divider}`,
                    borderRight: `1px solid ${theme.palette.divider}`,
                    backgroundColor: activeRule
                      ? alpha(ruleColor(theme, activeRule), 0.78)
                      : "transparent",
                  }}
                />
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function Legend() {
  const theme = useTheme();
  const items = [
    { label: "Automatic recording", color: theme.palette.primary.main },
    { label: "Recording blocked", color: theme.palette.error.main },
    { label: "Live blocked", color: theme.palette.warning.main },
    { label: "No rule", color: theme.palette.action.disabledBackground },
  ];

  return (
    <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", rowGap: 1 }}>
      {items.map((item) => (
        <Stack
          key={item.label}
          direction="row"
          spacing={0.75}
          alignItems="center"
        >
          <Box
            sx={{
              width: 14,
              height: 14,
              borderRadius: 0.5,
              backgroundColor: item.color,
            }}
          />
          <Typography variant="caption" color="text.secondary">
            {item.label}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function WeekdaySelect({
  value,
  onChange,
}: {
  value: number[];
  onChange: (weekdays: number[]) => void;
}) {
  return (
    <FormControl fullWidth>
      <InputLabel>Days</InputLabel>
      <Select
        multiple
        value={value.map(String)}
        label="Days"
        onChange={(event) =>
          onChange(selectValue(event.target.value).map(Number))
        }
        renderValue={(selected) =>
          (selected as string[])
            .map((day) =>
              WEEKDAYS.find((weekday) => weekday.value === Number(day)),
            )
            .map((day) => day?.label)
            .filter(Boolean)
            .join(", ")
        }
      >
        {WEEKDAYS.map((weekday) => (
          <MenuItem key={weekday.value} value={String(weekday.value)}>
            <Checkbox checked={value.includes(weekday.value)} />
            {weekday.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function AdminOverride({
  target,
  config,
  onToggle,
  disabled,
}: {
  target: Target;
  config: types.RecordingScheduleConfig;
  onToggle: (action: types.RecordingScheduleAction, enabled: boolean) => void;
  disabled: boolean;
}) {
  const targetOverrides = target.cameraIds.map((cameraId) => ({
    cameraId,
    override: config.overrides[cameraId] ?? {},
  }));
  const recordingEnabled =
    targetOverrides.length > 0 &&
    targetOverrides.every((item) => item.override.recording);
  const liveEnabled =
    targetOverrides.length > 0 &&
    targetOverrides.every((item) => item.override.live);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
        >
          <Box>
            <Typography variant="subtitle1">Admin override</Typography>
            <Typography variant="body2" color="text.secondary">
              Immediate override for the selected target.
            </Typography>
          </Box>
          <Stack direction="row" spacing={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={recordingEnabled}
                  disabled={disabled || target.cameraIds.length === 0}
                  onChange={(event) =>
                    onToggle("recording", event.target.checked)
                  }
                />
              }
              label="Recording"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={liveEnabled}
                  disabled={disabled || target.cameraIds.length === 0}
                  onChange={(event) => onToggle("live", event.target.checked)}
                />
              }
              label="Live"
            />
          </Stack>
        </Stack>
      </Stack>
    </Paper>
  );
}

function RecordingScheduleEditor({
  initialConfig,
  status,
  cameraGroups,
  cameras,
  canSave,
  isAdmin,
}: {
  initialConfig: types.RecordingScheduleConfig;
  status: Record<string, types.RecordingScheduleStatus>;
  cameraGroups: types.CameraAccessGroup[];
  cameras: Record<string, types.Camera>;
  canSave: boolean;
  isAdmin: boolean;
}) {
  const updateSchedule = useUpdateRecordingSchedule();
  const [config, setConfig] =
    useState<types.RecordingScheduleConfig>(initialConfig);
  const [copiedWindow, setCopiedWindow] = useState<ScheduleWindowPatch | null>(
    null,
  );
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const cameraOptions = useMemo<CameraOption[]>(
    () =>
      Object.values(cameras)
        .map((camera) => ({
          id: camera.identifier,
          name: camera.name || camera.identifier,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [cameras],
  );

  const targets = useMemo<Target[]>(
    () => [
      ...cameraGroups.map((group) => ({
        type: "group" as const,
        id: group.id,
        label: group.name || group.id,
        cameraIds: group.cameras,
      })),
      ...cameraOptions.map((camera) => ({
        type: "camera" as const,
        id: camera.id,
        label: camera.name,
        cameraIds: [camera.id],
      })),
    ],
    [cameraGroups, cameraOptions],
  );

  const [selectedTargetKey, setSelectedTargetKey] = useState(
    targets[0] ? targetKey(targets[0]) : "",
  );
  const selectedTarget =
    targets.find((target) => targetKey(target) === selectedTargetKey) ??
    targets[0];

  const targetRules = useMemo(
    () =>
      selectedTarget
        ? config.rules.filter((rule) => ruleTargetsTarget(rule, selectedTarget))
        : [],
    [config.rules, selectedTarget],
  );

  const updateRule = (
    ruleId: string,
    patch: Partial<types.RecordingScheduleRule>,
  ) => {
    setConfig((current) => ({
      ...current,
      rules: current.rules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...patch } : rule,
      ),
    }));
  };

  const copyWindow = (rule: types.RecordingScheduleRule) => {
    setCopiedWindow({
      weekdays: [...rule.weekdays],
      start_time: rule.start_time,
      end_time: rule.end_time,
      starts_at: rule.starts_at,
      ends_at: rule.ends_at,
      recording: rule.recording,
      block_live: rule.block_live,
      reason: rule.reason,
    });
  };

  const pasteWindow = (ruleId: string) => {
    if (!copiedWindow) return;
    updateRule(ruleId, {
      ...copiedWindow,
      weekdays: [...copiedWindow.weekdays],
    });
  };

  const addRule = () => {
    if (!selectedTarget) return;
    setConfig((current) => ({
      ...current,
      rules: [
        ...current.rules,
        {
          id: newId("schedule"),
          name: `${selectedTarget.label} weekdays`,
          enabled: true,
          reason: "Scheduled recording",
          recording: "record",
          block_live: false,
          targets: targetPatch(selectedTarget),
          weekdays: [0, 1, 2, 3, 4],
          start_time: "08:00",
          end_time: "16:00",
          starts_at: null,
          ends_at: null,
        },
      ],
    }));
  };

  const exportRules = (scope: "all" | "selected") => {
    const rules =
      scope === "selected" && selectedTarget
        ? config.rules.filter((rule) => ruleTargetsTarget(rule, selectedTarget))
        : config.rules;
    const rows = rules.flatMap((rule) => ruleRows(rule, cameraGroups, cameras));
    downloadCsv(
      `viseron-recording-schedule-${scope}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`,
      rows.length ? rows : [selectedTarget ? templateRow(selectedTarget) : {}],
    );
  };

  const exportTemplate = () => {
    const rows = selectedTarget
      ? [templateRow(selectedTarget)]
      : targets.map((target) => templateRow(target));
    downloadCsv("viseron-recording-schedule-template.csv", rows);
  };

  const importCsv = async (file: File) => {
    setImportError(null);
    setImportMessage(null);

    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) throw new Error("The CSV file has no schedule rows.");

      const usedIds = new Set(config.rules.map((rule) => rule.id));
      const imported = rows.map((row, index) =>
        ruleFromCsvRow(row, index + 2, targets, usedIds),
      );
      const importedTargetKeys = new Set(
        imported.map((item) => item.targetKey),
      );

      setConfig((current) => ({
        ...current,
        rules: [
          ...current.rules.filter(
            (rule) =>
              !ruleTargetKeys(rule).some((key) => importedTargetKeys.has(key)),
          ),
          ...imported.map((item) => item.rule),
        ],
      }));
      setImportMessage(
        `Imported ${imported.length} windows for ${importedTargetKeys.size} target(s). Review, then Save.`,
      );
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  };

  const save = () => {
    updateSchedule.mutate(config);
  };

  const toggleOverride = (
    target: Target,
    action: types.RecordingScheduleAction,
    enabled: boolean,
  ) => {
    const nextConfig = {
      ...config,
      overrides: { ...config.overrides },
    };
    target.cameraIds.forEach((cameraId) => {
      nextConfig.overrides[cameraId] = {
        ...(nextConfig.overrides[cameraId] ?? {}),
        [action]: enabled,
      };
    });
    setConfig(nextConfig);
    updateSchedule.mutate(nextConfig);
  };

  return (
    <Container maxWidth={false} sx={{ py: 2 }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1}
          sx={{ alignItems: { md: "center" }, justifyContent: "space-between" }}
        >
          <Box>
            <Typography variant="h5">Recording Schedule</Typography>
            <Typography color="text.secondary" variant="body2">
              NVR calendar for camera and group based recording windows
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<Save size={18} />}
            disabled={!canSave || updateSchedule.isPending}
            onClick={save}
          >
            Save
          </Button>
        </Stack>

        {!canSave && (
          <Alert severity="warning">
            Your user can view the schedule but cannot save changes.
          </Alert>
        )}

        <AuditSummary metadata={config.metadata} />

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1}
              justifyContent="space-between"
              alignItems={{ md: "center" }}
            >
              <Box>
                <Typography variant="h6">Excel import/export</Typography>
                <Typography variant="body2" color="text.secondary">
                  CSV UTF-8 with semicolon separator. One row is one
                  recording/live window for one camera or one camera group.
                </Typography>
              </Box>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button variant="outlined" onClick={() => exportRules("all")}>
                  Export all
                </Button>
                <Button
                  variant="outlined"
                  disabled={!selectedTarget}
                  onClick={() => exportRules("selected")}
                >
                  Export selected
                </Button>
                <Button variant="outlined" onClick={exportTemplate}>
                  Template
                </Button>
                <Button
                  variant="outlined"
                  disabled={!canSave}
                  onClick={() => importInputRef.current?.click()}
                >
                  Import CSV
                </Button>
              </Stack>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Use <strong>record</strong> for automatic recording,{" "}
              <strong>block</strong> to block recording, <strong>ignore</strong>{" "}
              to leave recording unchanged. Set <strong>block_live</strong> to{" "}
              <strong>TRUE</strong> only when live viewing should be blocked in
              that time window.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Import replaces schedule windows only for targets listed in the
              file. Other camera/group schedules stay unchanged until you press
              Save.
            </Typography>
            {importMessage && <Alert severity="success">{importMessage}</Alert>}
            {importError && <Alert severity="error">{importError}</Alert>}
            <input
              ref={importInputRef}
              hidden
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  importCsv(file);
                }
                event.target.value = "";
              }}
            />
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <FormControl sx={{ minWidth: { md: 360 }, flex: 1 }}>
                <InputLabel>Target</InputLabel>
                <Select
                  label="Target"
                  value={selectedTarget ? targetKey(selectedTarget) : ""}
                  onChange={(event) => setSelectedTargetKey(event.target.value)}
                >
                  {targets.map((target) => (
                    <MenuItem key={targetKey(target)} value={targetKey(target)}>
                      {target.type === "group" ? "Group" : "Camera"}:{" "}
                      {target.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {selectedTarget && (
                <Box sx={{ alignSelf: { md: "center" } }}>
                  <TargetStatus
                    target={selectedTarget}
                    status={status}
                    cameras={cameras}
                  />
                </Box>
              )}
            </Stack>
            {selectedTarget?.type === "group" && (
              <Typography variant="body2" color="text.secondary">
                This group currently targets {selectedTarget.cameraIds.length}{" "}
                cameras.
              </Typography>
            )}
            {selectedTarget && (
              <TargetStatusDetails
                target={selectedTarget}
                status={status}
                cameras={cameras}
              />
            )}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1}
              justifyContent="space-between"
            >
              <Box>
                <Typography variant="h6">Weekly calendar</Typography>
                <Typography variant="body2" color="text.secondary">
                  Select a target above, then define the active windows below.
                </Typography>
              </Box>
              <Button
                variant="outlined"
                startIcon={<Add size={18} />}
                disabled={!selectedTarget}
                onClick={addRule}
              >
                Add window
              </Button>
            </Stack>
            <Legend />
            <WeekGrid rules={targetRules} />
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="h6">Schedule windows</Typography>
              <Chip size="small" label={`${targetRules.length} windows`} />
            </Stack>

            {targetRules.length === 0 && (
              <Alert severity="info">
                No recording windows are configured for this target.
              </Alert>
            )}

            {targetRules.map((rule) => {
              const conflicts = conflictingRules(
                rule,
                config.rules,
                cameraGroups,
              );
              return (
                <Paper key={rule.id} variant="outlined" sx={{ p: 2 }}>
                  <Stack spacing={2}>
                    <Stack
                      direction={{ xs: "column", md: "row" }}
                      spacing={1.5}
                      alignItems={{ md: "center" }}
                    >
                      <FormControlLabel
                        control={
                          <Switch
                            checked={rule.enabled}
                            onChange={(event) =>
                              updateRule(rule.id, {
                                enabled: event.target.checked,
                              })
                            }
                          />
                        }
                        label="Enabled"
                      />
                      <TextField
                        label="Name"
                        value={rule.name}
                        sx={{ flex: 1, minWidth: 220 }}
                        onChange={(event) =>
                          updateRule(rule.id, { name: event.target.value })
                        }
                      />
                      <FormControl sx={{ minWidth: 230 }}>
                        <InputLabel>Recording mode</InputLabel>
                        <Select
                          label="Recording mode"
                          value={rule.recording}
                          onChange={(event) =>
                            updateRule(rule.id, {
                              recording: event.target
                                .value as types.RecordingScheduleRecordingMode,
                            })
                          }
                        >
                          <MenuItem value="record">
                            Automatic recording
                          </MenuItem>
                          <MenuItem value="block">Block recording</MenuItem>
                          <MenuItem value="ignore">
                            Do not change recording
                          </MenuItem>
                        </Select>
                      </FormControl>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={rule.block_live}
                            onChange={(event) =>
                              updateRule(rule.id, {
                                block_live: event.target.checked,
                              })
                            }
                          />
                        }
                        label="Block live"
                      />
                    </Stack>

                    <RuleNowPreview rule={rule} />
                    <RuleConflicts
                      conflicts={conflicts}
                      cameraGroups={cameraGroups}
                      cameras={cameras}
                    />

                    <Stack
                      direction={{ xs: "column", md: "row" }}
                      spacing={1.5}
                    >
                      <WeekdaySelect
                        value={rule.weekdays}
                        onChange={(weekdays) =>
                          updateRule(rule.id, { weekdays })
                        }
                      />
                      <TextField
                        label="From"
                        type="time"
                        value={rule.start_time}
                        onChange={(event) =>
                          updateRule(rule.id, {
                            start_time: event.target.value,
                          })
                        }
                      />
                      <TextField
                        label="To"
                        type="time"
                        value={rule.end_time}
                        onChange={(event) =>
                          updateRule(rule.id, { end_time: event.target.value })
                        }
                      />
                    </Stack>

                    <Stack
                      direction={{ xs: "column", md: "row" }}
                      spacing={1.5}
                    >
                      <TextField
                        label="Valid from"
                        type="datetime-local"
                        value={toLocalInput(rule.starts_at)}
                        InputLabelProps={{ shrink: true }}
                        sx={{ minWidth: 220 }}
                        onChange={(event) =>
                          updateRule(rule.id, {
                            starts_at: fromLocalInput(event.target.value),
                          })
                        }
                      />
                      <TextField
                        label="Valid until"
                        type="datetime-local"
                        value={toLocalInput(rule.ends_at)}
                        InputLabelProps={{ shrink: true }}
                        sx={{ minWidth: 220 }}
                        onChange={(event) =>
                          updateRule(rule.id, {
                            ends_at: fromLocalInput(event.target.value),
                          })
                        }
                      />
                      <TextField
                        label="Status message"
                        value={rule.reason ?? ""}
                        sx={{ flex: 1 }}
                        onChange={(event) =>
                          updateRule(rule.id, { reason: event.target.value })
                        }
                      />
                      <Button
                        variant="outlined"
                        onClick={() => copyWindow(rule)}
                      >
                        Copy
                      </Button>
                      <Button
                        variant="outlined"
                        disabled={!copiedWindow}
                        onClick={() => pasteWindow(rule.id)}
                      >
                        Paste
                      </Button>
                      <Button
                        color="error"
                        startIcon={<TrashCan size={18} />}
                        onClick={() =>
                          setConfig((current) => ({
                            ...current,
                            rules: current.rules.filter(
                              (item) => item.id !== rule.id,
                            ),
                          }))
                        }
                      >
                        Delete
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        </Paper>

        {isAdmin && selectedTarget && (
          <>
            <Divider />
            <AdminOverride
              target={selectedTarget}
              config={config}
              onToggle={(action, enabled) =>
                toggleOverride(selectedTarget, action, enabled)
              }
              disabled={!canSave || updateSchedule.isPending}
            />
          </>
        )}
      </Stack>
    </Container>
  );
}

function RecordingSchedule() {
  const scheduleQuery = useRecordingSchedule();
  const camerasQuery = useCameras({});
  const { auth, user } = useAuthContext();

  if (scheduleQuery.isPending || camerasQuery.isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const canSave =
    !auth.enabled || user?.role === "admin" || user?.role === "write";
  const isAdmin = !auth.enabled || user?.role === "admin";
  const initialConfig = scheduleQuery.data?.config ?? EMPTY_CONFIG;

  return (
    <RecordingScheduleEditor
      key={JSON.stringify(initialConfig)}
      initialConfig={initialConfig}
      status={scheduleQuery.data?.status ?? {}}
      cameraGroups={scheduleQuery.data?.camera_groups ?? []}
      cameras={camerasQuery.data ?? {}}
      canSave={canSave}
      isAdmin={isAdmin}
    />
  );
}

export default RecordingSchedule;
