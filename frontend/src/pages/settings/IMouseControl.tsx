import { Renew, SendAlt } from "@carbon/icons-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";

import { ErrorMessage } from "components/error/ErrorMessage";
import { Loading } from "components/loading/Loading";
import { useTitle } from "hooks/UseTitle";
import {
  useIMouse,
  useRescanIMouseDevice,
  useSendIMouseCommand,
} from "lib/api/imouse";
import * as types from "lib/types";

const COMMAND_GROUPS: {
  label: string;
  commands: { label: string; command: types.IMouseCommand }[];
}[] = [
  {
    label: "Focus",
    commands: [
      { label: "Focus -", command: "focus_minus" },
      { label: "Focus +", command: "focus_plus" },
      { label: "Reset", command: "focus_reset" },
      { label: "Auto", command: "focus_auto" },
    ],
  },
  {
    label: "EV",
    commands: [
      { label: "EV -", command: "ev_minus" },
      { label: "EV 0", command: "ev0" },
      { label: "EV +", command: "ev_plus" },
    ],
  },
  {
    label: "Exposure",
    commands: [
      { label: "Exposure -", command: "exposure_minus" },
      { label: "Exposure +", command: "exposure_plus" },
    ],
  },
  {
    label: "Gain",
    commands: [
      { label: "Gain -", command: "gain_minus" },
      { label: "Gain +", command: "gain_plus" },
    ],
  },
  {
    label: "HDR",
    commands: [
      { label: "HDR on", command: "hdr_on" },
      { label: "HDR off", command: "hdr_off" },
    ],
  },
];

const pwmKey = (
  device: types.IMouseDevice,
  camera: types.IMouseCamera,
  type: "daylight" | "nightlight",
) => `${device.id}:${camera.id}:${type}`;

function DeviceCameraControls({
  device,
  camera,
  disabled,
}: {
  device: types.IMouseDevice;
  camera: types.IMouseCamera;
  disabled: boolean;
}) {
  const sendCommand = useSendIMouseCommand();
  const [pwmValues, setPwmValues] = useState<Record<string, number>>({});
  const daylightValue = pwmValues[pwmKey(device, camera, "daylight")] ?? 0;
  const nightlightValue = pwmValues[pwmKey(device, camera, "nightlight")] ?? 1;
  const commandPending = sendCommand.isPending;

  const runCommand = (command: types.IMouseCommand, value?: number) => {
    sendCommand.mutate({
      deviceId: device.id,
      cameraId: camera.id,
      command,
      value,
    });
  };

  const updatePwm = (type: "daylight" | "nightlight", value: number) => {
    setPwmValues((current) => ({
      ...current,
      [pwmKey(device, camera, type)]: value,
    }));
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack spacing={1.25}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ justifyContent: "space-between", alignItems: "flex-start" }}
        >
          <Box>
            <Typography variant="subtitle2">{camera.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {camera.side} / {camera.id}
            </Typography>
          </Box>
          <Chip
            size="small"
            color={camera.available ? "success" : "warning"}
            label={camera.available ? "available" : "not detected"}
          />
        </Stack>

        {COMMAND_GROUPS.map((group) => (
          <Stack key={group.label} spacing={0.5}>
            <Typography variant="caption" color="text.secondary">
              {group.label}
            </Typography>
            <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", gap: 0.75 }}>
              {group.commands.map((item) => (
                <Button
                  key={item.command}
                  size="small"
                  variant="outlined"
                  disabled={disabled || commandPending || !camera.available}
                  onClick={() => runCommand(item.command)}
                  startIcon={<SendAlt size={16} />}
                >
                  {item.label}
                </Button>
              ))}
            </Stack>
          </Stack>
        ))}

        <Divider />

        {(["daylight", "nightlight"] as const).map((type) => {
          const value = type === "daylight" ? daylightValue : nightlightValue;
          return (
            <Stack key={type} spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                {type === "daylight" ? "Daylight" : "Nightlight"} PWM
              </Typography>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                <Slider
                  min={0}
                  max={1}
                  step={0.1}
                  value={value}
                  valueLabelDisplay="auto"
                  disabled={disabled || commandPending || !camera.available}
                  onChange={(_, nextValue) => {
                    updatePwm(type, Array.isArray(nextValue) ? nextValue[0] : nextValue);
                  }}
                  sx={{ minWidth: 160 }}
                />
                <Button
                  size="small"
                  variant="contained"
                  disabled={disabled || commandPending || !camera.available}
                  onClick={() => runCommand(type, value)}
                >
                  Set
                </Button>
              </Stack>
            </Stack>
          );
        })}

        {sendCommand.isError && (
          <Alert severity="error">
            {sendCommand.error?.message || "Command failed"}
          </Alert>
        )}
        {sendCommand.isSuccess && (
          <Alert severity="success">
            {sendCommand.data?.message ||
              sendCommand.data?.msg ||
              `Command ${sendCommand.data?.command || ""} sent`}
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}

function IMouseDeviceCard({ device }: { device: types.IMouseDevice }) {
  const rescan = useRescanIMouseDevice();
  const sortedCameras = useMemo(
    () => [...device.cameras].sort((left, right) => left.id.localeCompare(right.id)),
    [device.cameras],
  );

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1}
          sx={{ justifyContent: "space-between", alignItems: "flex-start" }}
        >
          <Box>
            <Typography variant="h6">{device.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {device.host}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Chip
              size="small"
              color={device.reachable ? "success" : "error"}
              label={device.reachable ? "online" : "offline"}
            />
            <Button
              size="small"
              variant="outlined"
              disabled={!device.reachable || rescan.isPending}
              onClick={() => rescan.mutate(device.id)}
              startIcon={<Renew size={16} />}
            >
              Rescan
            </Button>
          </Stack>
        </Stack>

        {device.error && <Alert severity="error">{device.error}</Alert>}
        {rescan.isError && (
          <Alert severity="error">
            {rescan.error?.message || "Rescan failed"}
          </Alert>
        )}
        {rescan.isSuccess && (
          <Alert severity="success">
            {rescan.data.message || "Camera scan complete"}
          </Alert>
        )}

        <Stack
          direction={{ xs: "column", lg: "row" }}
          spacing={1}
          sx={{ alignItems: "stretch" }}
        >
          {sortedCameras.map((camera) => (
            <Box key={camera.id} sx={{ flex: 1, minWidth: 0 }}>
              <DeviceCameraControls
                device={device}
                camera={camera}
                disabled={!device.reachable}
              />
            </Box>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}

function IMouseControl() {
  useTitle("iMouse Control");
  const imouse = useIMouse();

  if (imouse.isPending) {
    return <Loading text="Loading iMouse devices" />;
  }

  if (imouse.isError) {
    return <ErrorMessage text={imouse.error.message} />;
  }

  return (
    <Container maxWidth={false} sx={{ paddingX: { xs: 1, md: 2 }, py: 1 }}>
      <Stack spacing={1.5}>
        {imouse.data.devices.length === 0 ? (
          <Alert severity="info">No iMouse Raspberry cameras are configured.</Alert>
        ) : (
          imouse.data.devices.map((device) => (
            <IMouseDeviceCard key={device.id} device={device} />
          ))
        )}
      </Stack>
    </Container>
  );
}

export default IMouseControl;
