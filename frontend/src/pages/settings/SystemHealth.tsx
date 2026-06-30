import { Renew } from "@carbon/icons-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useMemo } from "react";

import { ErrorMessage } from "components/error/ErrorMessage";
import { Loading } from "components/loading/Loading";
import { useTitle } from "hooks/UseTitle";
import { useSystemHealth } from "lib/api/systemHealth";
import * as types from "lib/types";

function formatBytes(bytes: number | null | undefined) {
  if (!bytes) {
    return "0 B";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatAge(seconds: number | null) {
  if (seconds === null) {
    return "n/a";
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  }
  return `${Math.round(seconds / 3600)}h`;
}

function StatBox({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warning" | "error" | "success";
}) {
  const colorMap = {
    default: "text.primary",
    warning: "warning.main",
    error: "error.main",
    success: "success.main",
  };
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 150 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" sx={{ color: colorMap[tone] }}>
        {value}
      </Typography>
    </Paper>
  );
}

function cameraTone(camera: types.SystemHealthCamera) {
  if (camera.failed || !camera.connected) {
    return "error";
  }
  if (camera.stale_frame || !camera.ffmpeg.count) {
    return "warning";
  }
  return "success";
}

function cameraStatusLabel(camera: types.SystemHealthCamera) {
  if (camera.failed) {
    return "failed";
  }
  if (camera.stale_frame) {
    return "stale frames";
  }
  if (camera.connected) {
    return "connected";
  }
  return "offline";
}

function storageTone(storage: types.SystemHealthStorage) {
  if (
    storage.warning_level === "error" ||
    storage.warning_level === "critical" ||
    !storage.exists ||
    !storage.writable
  ) {
    return "error";
  }
  if (storage.warning_level === "warning") {
    return "warning";
  }
  return "success";
}

function SystemHealth() {
  useTitle("System Health");
  const health = useSystemHealth();

  const problemCameras = useMemo(
    () =>
      (health.data?.cameras || []).filter(
        (camera) =>
          camera.failed ||
          !camera.connected ||
          camera.stale_frame ||
          !camera.ffmpeg.count ||
          camera.error,
      ),
    [health.data?.cameras],
  );

  const busyCameras = useMemo(
    () =>
      [...(health.data?.cameras || [])]
        .sort((a, b) => b.ffmpeg.cpu_percent - a.ffmpeg.cpu_percent)
        .slice(0, 20),
    [health.data?.cameras],
  );

  const storageProblems = useMemo(
    () =>
      (health.data?.storage || []).filter(
        (storage) => storage.warning || !storage.exists || !storage.writable,
      ),
    [health.data?.storage],
  );

  if (health.isLoading) {
    return <Loading text="Loading System Health" />;
  }

  if (health.isError) {
    return (
      <ErrorMessage
        text="Could not load system health"
        subtext={health.error.message}
      />
    );
  }

  const data = health.data;
  if (!data) {
    return <ErrorMessage text="No system health data available" />;
  }

  const memoryPercent =
    data.system.memory.total > 0
      ? Math.round((data.system.memory.used / data.system.memory.total) * 100)
      : 0;
  const load = data.system.load_average || [];
  const loadTone =
    data.system.cpu_count && load[0] > data.system.cpu_count
      ? "warning"
      : "default";

  return (
    <Container maxWidth={false} sx={{ py: 2, px: { xs: 1, md: 2 } }}>
      <Box
        sx={{
          alignItems: "center",
          display: "flex",
          gap: 2,
          justifyContent: "space-between",
          mb: 2,
        }}
      >
        <Box>
          <Typography variant="h5">System Health</Typography>
          <Typography variant="body2" color="text.secondary">
            Last updated {new Date(data.generated_at * 1000).toLocaleString()}
          </Typography>
        </Box>
        <Button
          startIcon={<Renew size={16} />}
          variant="outlined"
          onClick={() => health.refetch()}
        >
          Refresh
        </Button>
      </Box>

      <Stack direction="row" flexWrap="wrap" gap={1.5} sx={{ mb: 2 }}>
        <StatBox
          label="Load"
          value={load.length ? load.map((value) => value.toFixed(1)).join(" / ") : "n/a"}
          tone={loadTone}
        />
        <StatBox
          label="CPU cores"
          value={data.system.cpu_count || "n/a"}
        />
        <StatBox
          label="Memory"
          value={`${memoryPercent}%`}
          tone={memoryPercent > 90 ? "error" : memoryPercent > 80 ? "warning" : "default"}
        />
        <StatBox
          label="ffmpeg CPU"
          value={`${data.ffmpeg.total_cpu_percent.toFixed(0)}%`}
        />
        <StatBox
          label="ffmpeg processes"
          value={data.ffmpeg.process_count}
        />
        <StatBox
          label="Cameras"
          value={`${data.summary.connected_cameras}/${data.summary.camera_count}`}
          tone={
            data.summary.offline_cameras || data.summary.stale_cameras
              ? "warning"
              : "success"
          }
        />
        <StatBox
          label="Stale frames"
          value={data.summary.stale_cameras}
          tone={data.summary.stale_cameras ? "warning" : "success"}
        />
        <StatBox
          label="Recording"
          value={data.summary.recording_cameras}
        />
        <StatBox
          label="Open files"
          value={`${data.system.nofile.soft}`}
          tone={data.system.nofile.soft < 8192 ? "warning" : "success"}
        />
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Storage
        </Typography>
        {storageProblems.length > 0 && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            {storageProblems.length} storage path
            {storageProblems.length === 1 ? "" : "s"} need attention.
          </Alert>
        )}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Path</TableCell>
              <TableCell>Mount</TableCell>
              <TableCell align="right">Used</TableCell>
              <TableCell align="right">Free</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell width={220}>Usage</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.storage.map((storage) => (
              <TableRow key={storage.path}>
                <TableCell>
                  <Typography variant="body2">{storage.path}</Typography>
                  {storage.warning && (
                    <Typography variant="caption" color="error">
                      {storage.warning}
                    </Typography>
                  )}
                  {storage.write_error && (
                    <Typography variant="caption" color="error" display="block">
                      {storage.write_error}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {storage.is_mount ? "mount" : "nested"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {[storage.fstype, storage.device].filter(Boolean).join(" / ") ||
                      "n/a"}
                  </Typography>
                </TableCell>
                <TableCell align="right">{formatBytes(storage.used)}</TableCell>
                <TableCell align="right">{formatBytes(storage.free)}</TableCell>
                <TableCell align="right">{formatBytes(storage.total)}</TableCell>
                <TableCell>
                  {storage.exists && storage.percent_used !== null ? (
                    <Box sx={{ alignItems: "center", display: "flex", gap: 1 }}>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(storage.percent_used, 100)}
                        color={
                          storage.percent_used >= 95
                            ? "error"
                            : storage.percent_used >= 85
                              ? "warning"
                              : "primary"
                        }
                        sx={{ flex: 1 }}
                      />
                      <Typography variant="body2">
                        {storage.percent_used.toFixed(1)}%
                      </Typography>
                    </Box>
                  ) : (
                    <Chip size="small" color="error" label="missing" />
                  )}
                </TableCell>
                <TableCell>
                  <Stack direction="row" flexWrap="wrap" gap={0.5}>
                    <Chip
                      size="small"
                      color={storageTone(storage)}
                      label={
                        storage.exists && storage.writable
                          ? storage.warning_level || "ok"
                          : "problem"
                      }
                    />
                    <Chip
                      size="small"
                      color={storage.writable ? "success" : "error"}
                      label={storage.writable ? "writable" : "read-only"}
                    />
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {problemCameras.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {problemCameras.length} camera
          {problemCameras.length === 1 ? "" : "s"} need attention.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Camera Problems
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Camera</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>ffmpeg</TableCell>
              <TableCell>Latest HLS</TableCell>
              <TableCell>Error</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {problemCameras.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>No camera problems detected</TableCell>
              </TableRow>
            ) : (
              problemCameras.map((camera) => (
                <TableRow key={camera.identifier}>
                  <TableCell>
                    <Typography variant="body2">{camera.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {camera.identifier}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={cameraTone(camera)}
                      label={cameraStatusLabel(camera)}
                    />
                    {camera.status?.detail && (
                      <Typography variant="caption" color="text.secondary">
                        {camera.status.detail}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{camera.ffmpeg.count}</TableCell>
                  <TableCell>{formatAge(camera.latest_temp_segment_age)}</TableCell>
                  <TableCell>{camera.error || ""}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Top Camera Process Load
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Camera</TableCell>
              <TableCell align="right">CPU</TableCell>
              <TableCell align="right">RSS</TableCell>
              <TableCell align="right">Processes</TableCell>
              <TableCell align="right">Resolution</TableCell>
              <TableCell align="right">Recording</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {busyCameras.map((camera) => (
              <TableRow key={camera.identifier}>
                <TableCell>
                  <Typography variant="body2">{camera.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {camera.identifier}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {camera.ffmpeg.cpu_percent.toFixed(1)}%
                </TableCell>
                <TableCell align="right">{formatBytes(camera.ffmpeg.rss)}</TableCell>
                <TableCell align="right">{camera.ffmpeg.count}</TableCell>
                <TableCell align="right">
                  {camera.width && camera.height
                    ? `${camera.width}x${camera.height}`
                    : "n/a"}
                </TableCell>
                <TableCell align="right">
                  {camera.is_recording ? "yes" : "no"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Container>
  );
}

export default SystemHealth;
