import { Add, Download, Save, Search, TrashCan } from "@carbon/icons-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";

import { ErrorMessage } from "components/error/ErrorMessage";
import { Loading } from "components/loading/Loading";
import { useTitle } from "hooks/UseTitle";
import {
  useCameraAccessReport,
  useCameraAccessConfig,
  useEffectiveCameraAccess,
  useSaveCameraAccessConfig,
} from "lib/api/cameraAccess";
import { useCamerasAll } from "lib/api/cameras";
import { useFeeders } from "lib/api/feeders";
import * as types from "lib/types";

const EMPTY_CONFIG: types.CameraAccessConfig = {
  camera_groups: [],
  ldap_camera_access: [],
  feeder_groups: [],
  ldap_feeder_access: [],
};

const SELECT_ALL_CAMERAS = "<select-all-cameras>";
const SELECT_ALL_FEEDERS = "<select-all-feeders>";

const CAMERA_PERMISSION_OPTIONS: {
  value: types.CameraPermission;
  label: string;
}[] = [
  { value: "view_live", label: "Live" },
  { value: "view_recordings", label: "Recordings" },
  { value: "manual_record", label: "Manual record" },
  { value: "delete_recordings", label: "Delete" },
  { value: "manage_schedule", label: "Schedule" },
  { value: "admin_override", label: "Override" },
];

const DEFAULT_CAMERA_RULE_PERMISSIONS: types.CameraPermission[] = [
  "view_live",
  "view_recordings",
];

const CAMERA_PERMISSION_LABELS = CAMERA_PERMISSION_OPTIONS.reduce<
  Record<types.CameraPermission, string>
>(
  (labels, permission) => ({
    ...labels,
    [permission.value]: permission.label,
  }),
  {} as Record<types.CameraPermission, string>,
);

type CameraOption = {
  id: string;
  name: string;
  failed: boolean;
};

type FeederOption = {
  id: string;
  name: string;
  available: boolean;
};

function selectedValues(value: string | string[]) {
  return typeof value === "string" ? value.split(",") : value;
}

function groupsToText(groups: string[]) {
  return groups.join("\n");
}

function textToGroups(value: string) {
  return value
    .split("\n")
    .map((group) => group.trim())
    .filter(Boolean);
}

function downloadText(filename: string, type: string, value: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvValue(value: unknown) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function reportToCsv(report: types.CameraAccessReportResponse) {
  const rows = [
    [
      "Rule",
      "AD groups",
      "Camera groups",
      "Direct cameras",
      "Expanded cameras",
      "Permissions",
      "Uses role default",
    ],
    ...report.rules.map((rule) => [
      String(rule.index + 1),
      rule.groups,
      rule.camera_groups,
      rule.cameras,
      rule.expanded_cameras,
      rule.permissions,
      rule.uses_role_default_permissions ? "yes" : "no",
    ]),
  ];
  return rows.map((row) => row.map(csvValue).join(",")).join("\n");
}

function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function permissionLabel(permission: types.CameraPermission) {
  return CAMERA_PERMISSION_LABELS[permission] || permission;
}

function cameraLabel(cameraId: string, cameras: CameraOption[]) {
  return cameras.find((camera) => camera.id === cameraId)?.name || cameraId;
}

function effectiveAccessToCsv(
  access: types.EffectiveCameraAccessResponse,
  cameras: CameraOption[],
) {
  const allPermissions = CAMERA_PERMISSION_OPTIONS.map(
    (permission) => permission.value,
  );
  const rows = [
    ["Camera", "Effective rights", "Matched rules", "Matched AD groups"],
  ];

  if (access.camera_permissions === null) {
    rows.push([
      "All cameras",
      allPermissions.map(permissionLabel).join("; "),
      "Admin role",
      access.groups.join("; "),
    ]);
  } else {
    Object.entries(access.camera_permissions)
      .sort(([leftCamera], [rightCamera]) =>
        cameraLabel(leftCamera, cameras).localeCompare(
          cameraLabel(rightCamera, cameras),
        ),
      )
      .forEach(([cameraId, permissions]) => {
        const matchedRules = access.matched_camera_rules.filter((rule) =>
          rule.expanded_cameras.includes(cameraId),
        );
        rows.push([
          cameraLabel(cameraId, cameras),
          permissions.map(permissionLabel).join("; "),
          matchedRules.map((rule) => `Rule ${rule.index + 1}`).join("; "),
          matchedRules
            .flatMap((rule) => rule.matched_groups || [])
            .filter((group, index, groups) => groups.indexOf(group) === index)
            .join("; "),
        ]);
      });
  }

  return rows.map((row) => row.map(csvValue).join(",")).join("\n");
}

function cameraGroupLabel(groupId: string, groups: types.CameraAccessGroup[]) {
  return groups.find((group) => group.id === groupId)?.name || groupId;
}

function ruleTargetLabels(
  rule: types.CameraAccessMatchedRule,
  cameraGroups: types.CameraAccessGroup[],
  cameras: CameraOption[],
) {
  const groupTargets = rule.camera_groups.map((groupId) =>
    cameraGroupLabel(groupId, cameraGroups),
  );
  const directTargets = rule.cameras.map((cameraId) =>
    cameraLabel(cameraId, cameras),
  );
  return [...groupTargets, ...directTargets].join(", ");
}

function feederLabel(feederId: string, feeders: FeederOption[]) {
  return feeders.find((feeder) => feeder.id === feederId)?.name || feederId;
}

function feederGroupLabel(groupId: string, groups: types.FeederAccessGroup[]) {
  return groups.find((group) => group.id === groupId)?.name || groupId;
}

function expandedCameraIds(
  rule: types.LDAPCameraAccessRule,
  groups: types.CameraAccessGroup[],
) {
  const cameraIds = new Set(rule.cameras);
  rule.camera_groups.forEach((groupId) => {
    groups
      .find((group) => group.id === groupId)
      ?.cameras.forEach((cameraId) => cameraIds.add(cameraId));
  });
  return Array.from(cameraIds).sort();
}

function PermissionChips({
  permissions,
}: {
  permissions: types.CameraPermission[];
}) {
  if (!permissions.length) {
    return <Chip size="small" label="Role default" variant="outlined" />;
  }
  return (
    <Stack direction="row" flexWrap="wrap" gap={0.75}>
      {permissions.map((permission) => (
        <Chip
          key={permission}
          size="small"
          label={permissionLabel(permission)}
          variant="outlined"
        />
      ))}
    </Stack>
  );
}

function SummaryTile({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        minWidth: { xs: "100%", sm: 150 },
        padding: 1.5,
      }}
    >
      <Typography color="text.secondary" variant="caption">
        {label}
      </Typography>
      <Typography variant="h6">{value}</Typography>
    </Box>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        padding: 2,
      }}
    >
      <Typography color="text.secondary" variant="body2">
        {text}
      </Typography>
    </Box>
  );
}

function nextGroupId(groups: types.CameraAccessGroup[]) {
  const existingIds = new Set(groups.map((group) => group.id));
  let index = groups.length + 1;
  let groupId = `camera_group_${index}`;
  while (existingIds.has(groupId)) {
    index += 1;
    groupId = `camera_group_${index}`;
  }
  return groupId;
}

function nextFeederGroupId(groups: types.FeederAccessGroup[]) {
  const existingIds = new Set(groups.map((group) => group.id));
  let index = groups.length + 1;
  let groupId = `feeder_group_${index}`;
  while (existingIds.has(groupId)) {
    index += 1;
    groupId = `feeder_group_${index}`;
  }
  return groupId;
}

function ruleKey() {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function CameraMultiSelect({
  label,
  value,
  cameras,
  onChange,
}: {
  label: string;
  value: string[];
  cameras: CameraOption[];
  onChange: (cameraIds: string[]) => void;
}) {
  const handleChange = (event: SelectChangeEvent<string[]>) => {
    const nextValue = selectedValues(event.target.value);
    if (nextValue.includes(SELECT_ALL_CAMERAS)) {
      onChange(
        value.length === cameras.length
          ? []
          : cameras.map((camera) => camera.id),
      );
      return;
    }
    onChange(nextValue);
  };

  return (
    <FormControl fullWidth>
      <InputLabel>{label}</InputLabel>
      <Select
        multiple
        label={label}
        value={value}
        onChange={handleChange}
        renderValue={(selected) =>
          (selected as string[])
            .map((cameraId) => cameras.find((camera) => camera.id === cameraId))
            .map((camera) => camera?.name || "")
            .filter(Boolean)
            .join(", ")
        }
      >
        <MenuItem value={SELECT_ALL_CAMERAS}>
          <Checkbox
            checked={value.length === cameras.length && cameras.length > 0}
          />
          <ListItemText primary="All cameras" />
        </MenuItem>
        {cameras.map((camera) => (
          <MenuItem key={camera.id} value={camera.id}>
            <Checkbox checked={value.includes(camera.id)} />
            <ListItemText
              primary={camera.name}
              secondary={camera.failed ? "Failed" : undefined}
            />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function FeederMultiSelect({
  label,
  value,
  feeders,
  onChange,
}: {
  label: string;
  value: string[];
  feeders: FeederOption[];
  onChange: (feederIds: string[]) => void;
}) {
  const handleChange = (event: SelectChangeEvent<string[]>) => {
    const nextValue = selectedValues(event.target.value);
    if (nextValue.includes(SELECT_ALL_FEEDERS)) {
      onChange(
        value.length === feeders.length
          ? []
          : feeders.map((feeder) => feeder.id),
      );
      return;
    }
    onChange(nextValue);
  };

  return (
    <FormControl fullWidth>
      <InputLabel>{label}</InputLabel>
      <Select
        multiple
        label={label}
        value={value}
        onChange={handleChange}
        renderValue={(selected) =>
          (selected as string[])
            .map((feederId) => feeders.find((feeder) => feeder.id === feederId))
            .map((feeder) => feeder?.name || "")
            .filter(Boolean)
            .join(", ")
        }
      >
        <MenuItem value={SELECT_ALL_FEEDERS}>
          <Checkbox
            checked={value.length === feeders.length && feeders.length > 0}
          />
          <ListItemText primary="All feeders" />
        </MenuItem>
        {feeders.map((feeder) => (
          <MenuItem key={feeder.id} value={feeder.id}>
            <Checkbox checked={value.includes(feeder.id)} />
            <ListItemText
              primary={feeder.name}
              secondary={feeder.available ? feeder.id : `${feeder.id} offline`}
            />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function CameraGroupMultiSelect({
  label,
  value,
  groups,
  onChange,
}: {
  label: string;
  value: string[];
  groups: types.CameraAccessGroup[];
  onChange: (groupIds: string[]) => void;
}) {
  return (
    <FormControl fullWidth>
      <InputLabel>{label}</InputLabel>
      <Select
        multiple
        label={label}
        value={value}
        onChange={(event) => onChange(selectedValues(event.target.value))}
        renderValue={(selected) =>
          (selected as string[])
            .map((groupId) => groups.find((group) => group.id === groupId))
            .map((group) => group?.name || "")
            .filter(Boolean)
            .join(", ")
        }
      >
        {groups.map((group) => (
          <MenuItem key={group.id} value={group.id}>
            <Checkbox checked={value.includes(group.id)} />
            <ListItemText primary={group.name} secondary={group.id} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function FeederGroupMultiSelect({
  label,
  value,
  groups,
  onChange,
}: {
  label: string;
  value: string[];
  groups: types.FeederAccessGroup[];
  onChange: (groupIds: string[]) => void;
}) {
  return (
    <FormControl fullWidth>
      <InputLabel>{label}</InputLabel>
      <Select
        multiple
        label={label}
        value={value}
        onChange={(event) => onChange(selectedValues(event.target.value))}
        renderValue={(selected) =>
          (selected as string[])
            .map((groupId) => groups.find((group) => group.id === groupId))
            .map((group) => group?.name || "")
            .filter(Boolean)
            .join(", ")
        }
      >
        {groups.map((group) => (
          <MenuItem key={group.id} value={group.id}>
            <Checkbox checked={value.includes(group.id)} />
            <ListItemText primary={group.name} secondary={group.id} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function CameraPermissionSelector({
  value,
  onChange,
}: {
  value: types.CameraPermission[];
  onChange: (permissions: types.CameraPermission[]) => void;
}) {
  const togglePermission = (permission: types.CameraPermission) => {
    onChange(
      value.includes(permission)
        ? value.filter((currentPermission) => currentPermission !== permission)
        : [...value, permission],
    );
  };

  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        Camera rights
      </Typography>
      <Stack direction="row" flexWrap="wrap" gap={1}>
        {CAMERA_PERMISSION_OPTIONS.map((permission) => (
          <FormControlLabel
            key={permission.value}
            control={
              <Checkbox
                checked={value.includes(permission.value)}
                onChange={() => togglePermission(permission.value)}
              />
            }
            label={permission.label}
          />
        ))}
        <Button size="small" onClick={() => onChange([])}>
          Role default
        </Button>
      </Stack>
    </Box>
  );
}

function CameraAccessForm({
  initialConfig,
}: {
  initialConfig: types.CameraAccessConfig;
}) {
  const saveCameraAccessConfig = useSaveCameraAccessConfig();
  const effectiveCameraAccess = useEffectiveCameraAccess();
  const cameraAccessReport = useCameraAccessReport();
  const camerasAll = useCamerasAll();
  const [activeTab, setActiveTab] = useState(0);
  const feeders = useFeeders({ enabled: activeTab === 3 });
  const [config, setConfig] = useState<types.CameraAccessConfig>(initialConfig);
  const [lookupUsername, setLookupUsername] = useState("");
  const [ruleKeys, setRuleKeys] = useState(() =>
    initialConfig.ldap_camera_access.map(() => ruleKey()),
  );
  const [feederRuleKeys, setFeederRuleKeys] = useState(() =>
    initialConfig.ldap_feeder_access.map(() => ruleKey()),
  );
  const [saveResult, setSaveResult] =
    useState<types.CameraAccessSaveResponse | null>(null);

  const cameraOptions = useMemo<CameraOption[]>(
    () =>
      Object.values(camerasAll.combinedData)
        .map((camera) => ({
          id: camera.identifier,
          name: camera.name || camera.identifier,
          failed: camera.failed,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [camerasAll.combinedData],
  );

  const feederOptions = useMemo<FeederOption[]>(
    () =>
      (feeders.data?.feeders || [])
        .map((feeder) => ({
          id: feeder.id,
          name: feeder.name || feeder.id,
          available: feeder.available,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [feeders.data?.feeders],
  );

  const cameraRuleCameraCount = useMemo(
    () =>
      config.ldap_camera_access.reduce(
        (count, rule) =>
          count + expandedCameraIds(rule, config.camera_groups).length,
        0,
      ),
    [config.camera_groups, config.ldap_camera_access],
  );

  const updateGroup = (
    index: number,
    update: Partial<types.CameraAccessGroup>,
  ) => {
    setConfig((currentConfig) => {
      const oldId = currentConfig.camera_groups[index].id;
      const nextGroups = currentConfig.camera_groups.map((group, groupIndex) =>
        groupIndex === index ? { ...group, ...update } : group,
      );
      const newId = nextGroups[index].id;
      const nextRules =
        oldId === newId
          ? currentConfig.ldap_camera_access
          : currentConfig.ldap_camera_access.map((rule) => ({
              ...rule,
              camera_groups: rule.camera_groups.map((groupId) =>
                groupId === oldId ? newId : groupId,
              ),
            }));
      return {
        ...currentConfig,
        camera_groups: nextGroups,
        ldap_camera_access: nextRules,
      };
    });
  };

  const addGroup = () => {
    setConfig((currentConfig) => ({
      ...currentConfig,
      camera_groups: [
        ...currentConfig.camera_groups,
        {
          id: nextGroupId(currentConfig.camera_groups),
          name: "Camera group",
          cameras: [],
        },
      ],
    }));
  };

  const removeGroup = (index: number) => {
    setConfig((currentConfig) => {
      const groupId = currentConfig.camera_groups[index].id;
      return {
        ...currentConfig,
        camera_groups: currentConfig.camera_groups.filter(
          (_group, groupIndex) => groupIndex !== index,
        ),
        ldap_camera_access: currentConfig.ldap_camera_access.map((rule) => ({
          ...rule,
          camera_groups: rule.camera_groups.filter((id) => id !== groupId),
        })),
      };
    });
  };

  const updateFeederGroup = (
    index: number,
    update: Partial<types.FeederAccessGroup>,
  ) => {
    setConfig((currentConfig) => {
      const oldId = currentConfig.feeder_groups[index].id;
      const nextGroups = currentConfig.feeder_groups.map((group, groupIndex) =>
        groupIndex === index ? { ...group, ...update } : group,
      );
      const newId = nextGroups[index].id;
      const nextRules =
        oldId === newId
          ? currentConfig.ldap_feeder_access
          : currentConfig.ldap_feeder_access.map((rule) => ({
              ...rule,
              feeder_groups: rule.feeder_groups.map((groupId) =>
                groupId === oldId ? newId : groupId,
              ),
            }));
      return {
        ...currentConfig,
        feeder_groups: nextGroups,
        ldap_feeder_access: nextRules,
      };
    });
  };

  const addFeederGroup = () => {
    setConfig((currentConfig) => ({
      ...currentConfig,
      feeder_groups: [
        ...currentConfig.feeder_groups,
        {
          id: nextFeederGroupId(currentConfig.feeder_groups),
          name: "Feeder group",
          feeders: [],
        },
      ],
    }));
  };

  const removeFeederGroup = (index: number) => {
    setConfig((currentConfig) => {
      const groupId = currentConfig.feeder_groups[index].id;
      return {
        ...currentConfig,
        feeder_groups: currentConfig.feeder_groups.filter(
          (_group, groupIndex) => groupIndex !== index,
        ),
        ldap_feeder_access: currentConfig.ldap_feeder_access.map((rule) => ({
          ...rule,
          feeder_groups: rule.feeder_groups.filter((id) => id !== groupId),
        })),
      };
    });
  };

  const updateRule = (
    index: number,
    update: Partial<types.LDAPCameraAccessRule>,
  ) => {
    setConfig((currentConfig) => ({
      ...currentConfig,
      ldap_camera_access: currentConfig.ldap_camera_access.map(
        (rule, ruleIndex) =>
          ruleIndex === index ? { ...rule, ...update } : rule,
      ),
    }));
  };

  const addRule = () => {
    setRuleKeys((currentRuleKeys) => [...currentRuleKeys, ruleKey()]);
    setConfig((currentConfig) => ({
      ...currentConfig,
      ldap_camera_access: [
        ...currentConfig.ldap_camera_access,
        {
          groups: [],
          camera_groups: [],
          cameras: [],
          permissions: DEFAULT_CAMERA_RULE_PERMISSIONS,
        },
      ],
    }));
  };

  const removeRule = (index: number) => {
    setRuleKeys((currentRuleKeys) =>
      currentRuleKeys.filter((_ruleKey, ruleIndex) => ruleIndex !== index),
    );
    setConfig((currentConfig) => ({
      ...currentConfig,
      ldap_camera_access: currentConfig.ldap_camera_access.filter(
        (_rule, ruleIndex) => ruleIndex !== index,
      ),
    }));
  };

  const updateFeederRule = (
    index: number,
    update: Partial<types.LDAPFeederAccessRule>,
  ) => {
    setConfig((currentConfig) => ({
      ...currentConfig,
      ldap_feeder_access: currentConfig.ldap_feeder_access.map(
        (rule, ruleIndex) =>
          ruleIndex === index ? { ...rule, ...update } : rule,
      ),
    }));
  };

  const addFeederRule = () => {
    setFeederRuleKeys((currentRuleKeys) => [...currentRuleKeys, ruleKey()]);
    setConfig((currentConfig) => ({
      ...currentConfig,
      ldap_feeder_access: [
        ...currentConfig.ldap_feeder_access,
        { groups: [], feeder_groups: [], feeders: [] },
      ],
    }));
  };

  const removeFeederRule = (index: number) => {
    setFeederRuleKeys((currentRuleKeys) =>
      currentRuleKeys.filter((_ruleKey, ruleIndex) => ruleIndex !== index),
    );
    setConfig((currentConfig) => ({
      ...currentConfig,
      ldap_feeder_access: currentConfig.ldap_feeder_access.filter(
        (_rule, ruleIndex) => ruleIndex !== index,
      ),
    }));
  };

  const handleSave = () => {
    saveCameraAccessConfig.mutate(config, {
      onSuccess: (data) => {
        setSaveResult(data);
      },
    });
  };

  const handleLookup = () => {
    const username = lookupUsername.trim();
    if (username) {
      effectiveCameraAccess.mutate(username);
    }
  };

  const exportEffectiveAccess = () => {
    if (!effectiveCameraAccess.data) {
      return;
    }
    downloadText(
      `camera-access-${effectiveCameraAccess.data.username}.json`,
      "application/json",
      JSON.stringify(effectiveCameraAccess.data, null, 2),
    );
  };

  const exportEffectiveAccessCsv = () => {
    if (!effectiveCameraAccess.data) {
      return;
    }
    downloadText(
      `camera-access-${effectiveCameraAccess.data.username}.csv`,
      "text/csv",
      effectiveAccessToCsv(effectiveCameraAccess.data, cameraOptions),
    );
  };

  const exportReport = async (format: "csv" | "json") => {
    const report = await cameraAccessReport.mutateAsync();
    if (format === "json") {
      downloadText(
        "camera-access-report.json",
        "application/json",
        JSON.stringify(report, null, 2),
      );
      return;
    }
    downloadText("camera-access-report.csv", "text/csv", reportToCsv(report));
  };

  return (
    <Container maxWidth="xl" sx={{ paddingX: { xs: 1, md: 2 }, paddingY: 1 }}>
      <Stack spacing={2}>
        <Paper sx={{ padding: { xs: 2, md: 2.5 } }}>
          <Stack spacing={2}>
            <Stack
              alignItems={{ xs: "stretch", md: "center" }}
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              spacing={2}
            >
              <Box>
                <Typography variant="h6">Camera Access</Typography>
              </Box>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                <Button
                  variant="outlined"
                  startIcon={<Download />}
                  disabled={cameraAccessReport.isPending}
                  onClick={() => exportReport("csv")}
                >
                  CSV
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<Download />}
                  disabled={cameraAccessReport.isPending}
                  onClick={() => exportReport("json")}
                >
                  Report
                </Button>
                <Button
                  variant="contained"
                  startIcon={<Save />}
                  disabled={saveCameraAccessConfig.isPending}
                  onClick={handleSave}
                >
                  Save
                </Button>
              </Stack>
            </Stack>

            <Stack direction="row" flexWrap="wrap" gap={1.5}>
              <SummaryTile label="Cameras" value={cameraOptions.length} />
              <SummaryTile
                label="Camera groups"
                value={config.camera_groups.length}
              />
              <SummaryTile
                label="Camera rules"
                value={config.ldap_camera_access.length}
              />
              <SummaryTile
                label="Rule targets"
                value={cameraRuleCameraCount}
              />
              <SummaryTile
                label="Feeders"
                value={feederOptions.length}
              />
            </Stack>
          </Stack>
        </Paper>

        {saveResult?.restart_required && (
          <Alert severity="warning">
            Restart Viseron to apply all camera access changes.
          </Alert>
        )}
        {saveResult && !saveResult.success && (
          <Alert severity="error">{saveResult.errors.join(", ")}</Alert>
        )}

        <Paper>
          <Tabs
            value={activeTab}
            onChange={(_event, nextTab) => setActiveTab(nextTab)}
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab label="Overview" />
            <Tab label="Camera groups" />
            <Tab label="Camera rules" />
            <Tab label="Feeders" />
          </Tabs>
        </Paper>

        {activeTab === 0 && (
          <Stack spacing={2}>
            <Paper sx={{ padding: 2 }}>
              <Stack spacing={2}>
                <Stack
                  alignItems={{ xs: "stretch", md: "center" }}
                  direction={{ xs: "column", md: "row" }}
                  spacing={2}
                >
                  <TextField
                    fullWidth
                    label="AD user"
                    value={lookupUsername}
                    onChange={(event) => setLookupUsername(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        handleLookup();
                      }
                    }}
                  />
                  <Button
                    variant="contained"
                    startIcon={<Search />}
                    disabled={effectiveCameraAccess.isPending}
                    onClick={handleLookup}
                  >
                    Test
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<Download />}
                    disabled={!effectiveCameraAccess.data}
                    onClick={exportEffectiveAccessCsv}
                  >
                    CSV
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<Download />}
                    disabled={!effectiveCameraAccess.data}
                    onClick={exportEffectiveAccess}
                  >
                    JSON
                  </Button>
                </Stack>

                {effectiveCameraAccess.isError && (
                  <Alert severity="error">
                    {effectiveCameraAccess.error?.response?.data.error ||
                      effectiveCameraAccess.error?.message}
                  </Alert>
                )}

                {effectiveCameraAccess.data && (
                  <Stack spacing={2}>
                    <Stack direction="row" flexWrap="wrap" gap={1}>
                      <Chip
                        label={effectiveCameraAccess.data.username}
                        color="primary"
                      />
                      <Chip
                        label={`Role: ${effectiveCameraAccess.data.role}`}
                        variant="outlined"
                      />
                      <Chip
                        label={pluralize(
                          effectiveCameraAccess.data.groups.length,
                          "LDAP group",
                          "LDAP groups",
                        )}
                        variant="outlined"
                      />
                      <Chip
                        label={pluralize(
                          effectiveCameraAccess.data.matched_camera_rules.length,
                          "matched rule",
                          "matched rules",
                        )}
                        variant="outlined"
                      />
                    </Stack>

                    <Box sx={{ overflowX: "auto" }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Camera</TableCell>
                            <TableCell>Effective rights</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {effectiveCameraAccess.data.camera_permissions === null && (
                            <TableRow>
                              <TableCell>All cameras</TableCell>
                              <TableCell>
                                <PermissionChips
                                  permissions={CAMERA_PERMISSION_OPTIONS.map(
                                    (permission) => permission.value,
                                  )}
                                />
                              </TableCell>
                            </TableRow>
                          )}
                          {Object.entries(
                            effectiveCameraAccess.data.camera_permissions || {},
                          ).map(([cameraId, permissions]) => (
                            <TableRow key={cameraId}>
                              <TableCell>
                                {cameraLabel(cameraId, cameraOptions)}
                              </TableCell>
                              <TableCell>
                                <PermissionChips permissions={permissions} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>

                    <Box sx={{ overflowX: "auto" }}>
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        Matched camera rules
                      </Typography>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Rule</TableCell>
                            <TableCell>Matched AD groups</TableCell>
                            <TableCell>Targets</TableCell>
                            <TableCell>Expanded cameras</TableCell>
                            <TableCell>Rights from rule</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {effectiveCameraAccess.data.matched_camera_rules.map(
                            (rule) => (
                              <TableRow key={rule.index}>
                                <TableCell>{rule.index + 1}</TableCell>
                                <TableCell>
                                  {(rule.matched_groups || []).join(", ")}
                                </TableCell>
                                <TableCell>
                                  {ruleTargetLabels(
                                    rule,
                                    config.camera_groups,
                                    cameraOptions,
                                  )}
                                </TableCell>
                                <TableCell>
                                  {rule.expanded_cameras
                                    .map((cameraId) =>
                                      cameraLabel(cameraId, cameraOptions),
                                    )
                                    .join(", ")}
                                </TableCell>
                                <TableCell>
                                  <PermissionChips permissions={rule.permissions} />
                                </TableCell>
                              </TableRow>
                            ),
                          )}
                        </TableBody>
                      </Table>
                      {effectiveCameraAccess.data.matched_camera_rules.length ===
                        0 && (
                        <EmptyState text="No camera access rules matched this user." />
                      )}
                    </Box>

                    <TextField
                      fullWidth
                      multiline
                      minRows={5}
                      label="LDAP groups"
                      value={effectiveCameraAccess.data.groups.join("\n")}
                      InputProps={{ readOnly: true }}
                    />
                  </Stack>
                )}
              </Stack>
            </Paper>

            <Paper sx={{ padding: 2 }}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle1">Camera rule overview</Typography>
                <Box sx={{ overflowX: "auto" }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Rule</TableCell>
                        <TableCell>AD groups</TableCell>
                        <TableCell>Targets</TableCell>
                        <TableCell>Rights</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {config.ldap_camera_access.map((rule, index) => (
                        <TableRow key={ruleKeys[index]}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>
                            {pluralize(rule.groups.length, "group", "groups")}
                          </TableCell>
                          <TableCell>
                            {pluralize(
                              expandedCameraIds(rule, config.camera_groups).length,
                              "camera",
                              "cameras",
                            )}
                          </TableCell>
                          <TableCell>
                            <PermissionChips permissions={rule.permissions ?? []} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
                {config.ldap_camera_access.length === 0 && (
                  <EmptyState text="No camera rules configured." />
                )}
              </Stack>
            </Paper>
          </Stack>
        )}

        {activeTab === 1 && (
          <Paper sx={{ padding: 2 }}>
            <Stack spacing={2}>
              <Stack direction="row" justifyContent="space-between" spacing={2}>
                <Typography variant="subtitle1">Camera groups</Typography>
                <Button variant="outlined" startIcon={<Add />} onClick={addGroup}>
                  Add group
                </Button>
              </Stack>
              {config.camera_groups.length === 0 && (
                <EmptyState text="No camera groups configured." />
              )}
              {config.camera_groups.map((group, index) => (
                <Paper key={group.id} variant="outlined" sx={{ padding: 2 }}>
                  <Stack spacing={2}>
                    <Stack
                      direction={{ xs: "column", md: "row" }}
                      spacing={2}
                    >
                      <TextField
                        fullWidth
                        required
                        label="ID"
                        value={group.id}
                        onChange={(event) =>
                          updateGroup(index, { id: event.target.value.trim() })
                        }
                      />
                      <TextField
                        fullWidth
                        label="Name"
                        value={group.name}
                        onChange={(event) =>
                          updateGroup(index, { name: event.target.value })
                        }
                      />
                      <Tooltip title="Delete group">
                        <span>
                          <IconButton
                            color="error"
                            onClick={() => removeGroup(index)}
                            sx={{ height: 56, width: 56 }}
                          >
                            <TrashCan />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                    <CameraMultiSelect
                      label="Cameras"
                      cameras={cameraOptions}
                      value={group.cameras}
                      onChange={(cameras) => updateGroup(index, { cameras })}
                    />
                    <Typography color="text.secondary" variant="caption">
                      {group.cameras
                        .map((cameraId) => cameraLabel(cameraId, cameraOptions))
                        .join(", ")}
                    </Typography>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Paper>
        )}

        {activeTab === 2 && (
          <Paper sx={{ padding: 2 }}>
            <Stack spacing={2}>
              <Stack direction="row" justifyContent="space-between" spacing={2}>
                <Typography variant="subtitle1">LDAP camera access</Typography>
                <Button variant="outlined" startIcon={<Add />} onClick={addRule}>
                  Add rule
                </Button>
              </Stack>
              {config.ldap_camera_access.length === 0 && (
                <EmptyState text="No LDAP camera access rules configured." />
              )}
              {config.ldap_camera_access.map((rule, index) => {
                const targets = expandedCameraIds(rule, config.camera_groups);
                return (
                  <Paper
                    key={ruleKeys[index]}
                    variant="outlined"
                    sx={{ padding: 2 }}
                  >
                    <Stack spacing={2}>
                      <Stack
                        alignItems={{ xs: "stretch", md: "center" }}
                        direction={{ xs: "column", md: "row" }}
                        justifyContent="space-between"
                        spacing={1}
                      >
                        <Stack direction="row" flexWrap="wrap" gap={1}>
                          <Chip label={`Rule ${index + 1}`} color="primary" />
                          <Chip
                            label={pluralize(rule.groups.length, "AD group", "AD groups")}
                            variant="outlined"
                          />
                          <Chip
                            label={pluralize(targets.length, "camera", "cameras")}
                            variant="outlined"
                          />
                        </Stack>
                        <Tooltip title="Delete rule">
                          <span>
                            <IconButton
                              color="error"
                              onClick={() => removeRule(index)}
                            >
                              <TrashCan />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                      <TextField
                        fullWidth
                        multiline
                        minRows={2}
                        label="AD groups"
                        value={groupsToText(rule.groups)}
                        onChange={(event) =>
                          updateRule(index, {
                            groups: textToGroups(event.target.value),
                          })
                        }
                      />
                      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                        <CameraGroupMultiSelect
                          label="Camera groups"
                          groups={config.camera_groups}
                          value={rule.camera_groups}
                          onChange={(cameraGroups) =>
                            updateRule(index, { camera_groups: cameraGroups })
                          }
                        />
                        <CameraMultiSelect
                          label="Direct cameras"
                          cameras={cameraOptions}
                          value={rule.cameras}
                          onChange={(cameras) => updateRule(index, { cameras })}
                        />
                      </Stack>
                      <Stack spacing={1}>
                        <CameraPermissionSelector
                          value={rule.permissions ?? []}
                          onChange={(permissions) =>
                            updateRule(index, { permissions })
                          }
                        />
                        <Typography color="text.secondary" variant="caption">
                          {[
                            ...rule.camera_groups.map((groupId) =>
                              cameraGroupLabel(groupId, config.camera_groups),
                            ),
                            ...rule.cameras.map((cameraId) =>
                              cameraLabel(cameraId, cameraOptions),
                            ),
                          ].join(", ")}
                        </Typography>
                      </Stack>
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          </Paper>
        )}

        {activeTab === 3 && (
          <Paper sx={{ padding: 2 }}>
            <Stack spacing={2.5}>
              <Stack direction="row" justifyContent="space-between" spacing={2}>
                <Typography variant="subtitle1">Feeder groups</Typography>
                <Button
                  variant="outlined"
                  startIcon={<Add />}
                  onClick={addFeederGroup}
                >
                  Add group
                </Button>
              </Stack>
              {config.feeder_groups.length === 0 && (
                <EmptyState text="No feeder groups configured." />
              )}
              {config.feeder_groups.map((group, index) => (
                <Paper key={group.id} variant="outlined" sx={{ padding: 2 }}>
                  <Stack spacing={2}>
                    <Stack
                      direction={{ xs: "column", md: "row" }}
                      spacing={2}
                    >
                      <TextField
                        fullWidth
                        required
                        label="ID"
                        value={group.id}
                        onChange={(event) =>
                          updateFeederGroup(index, {
                            id: event.target.value.trim(),
                          })
                        }
                      />
                      <TextField
                        fullWidth
                        label="Name"
                        value={group.name}
                        onChange={(event) =>
                          updateFeederGroup(index, { name: event.target.value })
                        }
                      />
                      <Tooltip title="Delete group">
                        <span>
                          <IconButton
                            color="error"
                            onClick={() => removeFeederGroup(index)}
                            sx={{ height: 56, width: 56 }}
                          >
                            <TrashCan />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                    <FeederMultiSelect
                      label="Feeders"
                      feeders={feederOptions}
                      value={group.feeders}
                      onChange={(nextFeeders) =>
                        updateFeederGroup(index, { feeders: nextFeeders })
                      }
                    />
                    <Typography color="text.secondary" variant="caption">
                      {group.feeders
                        .map((feederId) => feederLabel(feederId, feederOptions))
                        .join(", ")}
                    </Typography>
                  </Stack>
                </Paper>
              ))}

              <Divider />

              <Stack direction="row" justifyContent="space-between" spacing={2}>
                <Typography variant="subtitle1">LDAP feeder access</Typography>
                <Button
                  variant="outlined"
                  startIcon={<Add />}
                  onClick={addFeederRule}
                >
                  Add rule
                </Button>
              </Stack>
              {config.ldap_feeder_access.length === 0 && (
                <EmptyState text="No LDAP feeder access rules configured." />
              )}
              {config.ldap_feeder_access.map((rule, index) => (
                <Paper
                  key={feederRuleKeys[index]}
                  variant="outlined"
                  sx={{ padding: 2 }}
                >
                  <Stack spacing={2}>
                    <Stack
                      alignItems={{ xs: "stretch", md: "center" }}
                      direction={{ xs: "column", md: "row" }}
                      justifyContent="space-between"
                      spacing={1}
                    >
                      <Stack direction="row" flexWrap="wrap" gap={1}>
                        <Chip label={`Rule ${index + 1}`} color="primary" />
                        <Chip
                          label={pluralize(rule.groups.length, "AD group", "AD groups")}
                          variant="outlined"
                        />
                        <Chip
                          label={pluralize(
                            rule.feeder_groups.length + rule.feeders.length,
                            "target",
                            "targets",
                          )}
                          variant="outlined"
                        />
                      </Stack>
                      <Tooltip title="Delete rule">
                        <span>
                          <IconButton
                            color="error"
                            onClick={() => removeFeederRule(index)}
                          >
                            <TrashCan />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                    <TextField
                      fullWidth
                      multiline
                      minRows={2}
                      label="AD groups"
                      value={groupsToText(rule.groups)}
                      onChange={(event) =>
                        updateFeederRule(index, {
                          groups: textToGroups(event.target.value),
                        })
                      }
                    />
                    <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                      <FeederGroupMultiSelect
                        label="Feeder groups"
                        groups={config.feeder_groups}
                        value={rule.feeder_groups}
                        onChange={(feederGroups) =>
                          updateFeederRule(index, {
                            feeder_groups: feederGroups,
                          })
                        }
                      />
                      <FeederMultiSelect
                        label="Direct feeders"
                        feeders={feederOptions}
                        value={rule.feeders}
                        onChange={(nextFeeders) =>
                          updateFeederRule(index, { feeders: nextFeeders })
                        }
                      />
                    </Stack>
                    <Typography color="text.secondary" variant="caption">
                      {[
                        ...rule.feeder_groups.map((groupId) =>
                          feederGroupLabel(groupId, config.feeder_groups),
                        ),
                        ...rule.feeders.map((feederId) =>
                          feederLabel(feederId, feederOptions),
                        ),
                      ].join(", ")}
                    </Typography>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}

function CameraAccess() {
  useTitle("Camera Access");
  const cameraAccessConfig = useCameraAccessConfig();

  if (cameraAccessConfig.isLoading) {
    return <Loading text="Loading camera access" />;
  }

  if (cameraAccessConfig.isError || !cameraAccessConfig.data) {
    return (
      <ErrorMessage
        text="Error loading camera access"
        subtext={cameraAccessConfig.error?.message}
      />
    );
  }

  return (
    <CameraAccessForm
      initialConfig={{ ...EMPTY_CONFIG, ...cameraAccessConfig.data.config }}
    />
  );
}

export default CameraAccess;
