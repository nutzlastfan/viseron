import { CircleFill, VideoOff } from "@carbon/icons-react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { SxProps, Theme } from "@mui/material/styles";

import { useCamera } from "lib/api/camera";
import * as types from "lib/types";

type CameraNameOverlayProps = {
  camera_identifier: string;
  extraStatusText?: string;
};

const overlayStyles: SxProps<Theme> = {
  position: "absolute",
  zIndex: 3,
  right: "0px",
  top: "0px",
  margin: "5px",
  fontSize: "0.7rem",
  pointerEvents: "none",
  userSelect: "none",
};

const cameraNameStyles: SxProps<Theme> = {
  textShadow: "rgba(0, 0, 0, 0.88) 0px 0px 4px",
  color: "white",
};

const unknownCameraStatus: types.CameraRuntimeStatus = {
  state: "stale",
  label: "Status unavailable",
  severity: "warning",
  detail: "Camera status is temporarily unavailable",
  live: {
    available: false,
    reachable: false,
    blocked: false,
    reason: null,
  },
  recording: {
    active: false,
    blocked: false,
    reason: null,
    state: "stale",
  },
  last_frame_age: null,
  latest_segment_age: null,
  stale_frame: {
    stale: true,
    threshold: 0,
    age: null,
  },
};

function cameraStatus(camera: types.Camera) {
  return camera.status ?? unknownCameraStatus;
}

function StatusIcon({ camera }: { camera: types.Camera }) {
  const status = cameraStatus(camera);
  const statusColor = {
    default: "white",
    info: "white",
    success: camera.is_recording ? "red" : "green",
    warning: "orange",
    error: "gray",
  }[status.severity];

  return camera.is_on ? (
    <CircleFill
      size={12}
      style={{
        color: statusColor,
        marginLeft: "4px",
      }}
    />
  ) : (
    <VideoOff
      size={12}
      style={{
        color: "white",
        marginLeft: "4px",
      }}
    />
  );
}

export function CameraNameOverlay({
  camera_identifier,
  extraStatusText,
}: CameraNameOverlayProps) {
  const cameraQuery = useCamera(camera_identifier);
  if (!cameraQuery.data) {
    return null;
  }
  const camera = cameraQuery.data;

  let statusText = null;
  if (camera.failed) {
    statusText = "Camera error";
  } else {
    const status = cameraStatus(camera);
    statusText = status.state === "connected" ? null : status.label;
  }

  return (
    <Box sx={overlayStyles}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        <Typography variant="uppercase" sx={cameraNameStyles}>
          {camera.name}
        </Typography>
        {!camera.failed && <StatusIcon camera={camera as types.Camera} />}
      </Box>
      {statusText && (
        <Typography
          variant="body2"
          sx={{ ...cameraNameStyles, fontSize: "0.7rem", textAlign: "right" }}
        >
          {statusText}
        </Typography>
      )}
      {extraStatusText && (
        <Typography
          variant="body2"
          sx={{ ...cameraNameStyles, fontSize: "0.7rem", textAlign: "right" }}
        >
          {extraStatusText}
        </Typography>
      )}
    </Box>
  );
}
