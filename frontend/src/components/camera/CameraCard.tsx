import {
  Demo,
  IntrusionPrevention,
  Renew,
  Roadmap,
  SettingsAdjust,
  VideoChat,
  VideoOff,
} from "@carbon/icons-react";
import Image from "@jy95/material-ui-image";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePageVisibility } from "react-page-visibility";
import { Link } from "react-router-dom";

import { CameraNameOverlay } from "components/camera/CameraNameOverlay";
import { CameraUptime } from "components/camera/CameraUptime";
import { FailedCameraCard } from "components/camera/FailedCameraCard";
import { useAuthContext } from "context/AuthContext";
import { ViseronContext } from "context/ViseronContext";
import { useFirstRender } from "hooks/UseFirstRender";
import useOnScreen from "hooks/UseOnScreen";
import {
  useCamera,
  useCameraReconnect,
  useCameraStartStop,
} from "lib/api/camera";
import { BASE_PATH } from "lib/api/client";
import * as types from "lib/types";

type OnClick = (
  event: React.MouseEvent<HTMLButtonElement, MouseEvent>,
  camera: types.Camera,
) => void;

type FailedOnClick = (
  event: React.MouseEvent<HTMLButtonElement, MouseEvent>,
  camera: types.FailedCamera,
) => void;

interface SuccessCameraCardProps {
  camera: types.Camera;
  buttons?: boolean;
  compact?: boolean;
  onClick?: OnClick;
  border?: string;
}

interface CameraCardProps {
  camera_identifier: string;
  buttons?: boolean;
  compact?: boolean;
  onClick?: OnClick | FailedOnClick;
  border?: string;
}

const blankImage =
  "data:image/svg+xml;charset=utf8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E";

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

function statusColor(status: types.CameraRuntimeStatus) {
  return status.severity === "info" ? "default" : status.severity;
}

function cameraStatusDetail(camera: types.Camera) {
  const status = cameraStatus(camera);
  if (status.detail) {
    return status.detail;
  }
  if (status.last_frame_age !== null && status.state !== "connected") {
    return `Last frame ${Math.round(status.last_frame_age)}s ago`;
  }
  if (status.latest_segment_age !== null && status.state !== "connected") {
    return `Last segment ${Math.round(status.latest_segment_age)}s ago`;
  }
  return status.label;
}

function SuccessCameraCard({
  camera,
  buttons = true,
  compact = false,
  onClick,
  border,
}: SuccessCameraCardProps) {
  const { connected } = useContext(ViseronContext);
  const { auth, user } = useAuthContext();
  const theme = useTheme();
  const ref: any = useRef<HTMLDivElement>(undefined);
  const onScreen = useOnScreen<HTMLDivElement>(ref);
  const isVisible = usePageVisibility();
  const firstRender = useFirstRender();
  const livePolicy = camera.effective_policy?.live;
  const recordingPolicy = camera.effective_policy?.recording;
  const status = cameraStatus(camera);
  const liveBlocked = livePolicy?.allowed === false;
  const recordingBlocked = recordingPolicy?.allowed === false;
  const canManageCamera =
    !auth.enabled || user?.role === "admin" || user?.role === "write";

  const cameraStartStop = useCameraStartStop();
  const cameraReconnect = useCameraReconnect();

  const generateSnapshotURL = useCallback(
    (width = null) =>
      `${BASE_PATH}/api/v1/camera/${camera.identifier}/snapshot?rand=${(
        Math.random() + 1
      )
        .toString(36)
        .substring(7)}${width ? `&width=${Math.trunc(width)}` : ""}`,
    [camera.identifier],
  );
  const [snapshotURL, setSnapshotURL] = useState({
    // Show blank image on start
    url: blankImage,
    disableSpinner: false,
    disableTransition: false,
    loading: true,
  });
  const updateSnapshot = useRef<NodeJS.Timeout | null>(undefined);
  const updateImage = useCallback(() => {
    setSnapshotURL((prevSnapshotURL) => {
      if (prevSnapshotURL.loading && !firstRender) {
        // Dont load new image if we are still loading
        return prevSnapshotURL;
      }
      if (firstRender) {
        // Make sure we show the spinner on the first image fetched.
        return {
          url: generateSnapshotURL(
            ref.current ? ref.current.offsetWidth : null,
          ),
          disableSpinner: false,
          disableTransition: false,
          loading: true,
        };
      }
      return {
        ...prevSnapshotURL,
        url: generateSnapshotURL(ref.current ? ref.current.offsetWidth : null),
        loading: true,
      };
    });
  }, [firstRender, generateSnapshotURL]);

  useEffect(() => {
    // If element is on screen and browser is visible, start interval to fetch images
    if (
      onScreen &&
      isVisible &&
      connected &&
      camera.still_image.available &&
      !liveBlocked
    ) {
      updateImage();
      updateSnapshot.current = setInterval(
        () => {
          updateImage();
        },
        camera.still_image.refresh_interval
          ? camera.still_image.refresh_interval * 1000
          : 10000,
      );
      // If element is hidden or browser loses focus, stop updating images
    } else if (updateSnapshot.current) {
      clearInterval(updateSnapshot.current);
    }
    return () => {
      // Stop updating on unmount
      if (updateSnapshot.current) {
        clearInterval(updateSnapshot.current);
      }
    };
  }, [
    updateImage,
    isVisible,
    onScreen,
    connected,
    camera.still_image.available,
    camera.still_image.refresh_interval,
    liveBlocked,
  ]);

  return (
    <div
      ref={ref}
      style={{
        height: "100%",
      }}
    >
      <Card
        variant="outlined"
        sx={[
          {
            // Vertically space items evenly to accommodate different aspect ratios
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            height: "100%",
          },
          compact ? { position: "relative" } : null,
          border ? { border } : null,
        ]}
      >
        {compact ? (
          <CameraNameOverlay camera_identifier={camera.identifier} />
        ) : (
          <CardContent>
            <Stack alignItems="center" spacing={1}>
              <Typography variant="h5" align="center">
                {camera.name}
              </Typography>
              {status.state !== "connected" && (
                <Chip
                  size="small"
                  color={statusColor(status)}
                  label={status.label}
                />
              )}
            </Stack>
          </CardContent>
        )}
        <CardActionArea
          onClick={
            onClick ? (event) => (onClick as OnClick)(event, camera) : undefined
          }
          sx={onClick ? null : { pointerEvents: "none" }}
        >
          <CardMedia>
            {liveBlocked ? (
              <Box
                sx={{
                  aspectRatio:
                    camera.still_image.width / camera.still_image.height,
                  backgroundColor: theme.palette.background.default,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                  px: 2,
                }}
              >
                <VideoOff
                  size={48}
                  style={{
                    color: theme.palette.text.secondary,
                    opacity: 0.5,
                  }}
                />
                <Typography
                  variant="body2"
                  color="text.secondary"
                  align="center"
                >
                  {livePolicy?.reason || "Live view is blocked by schedule"}
                </Typography>
              </Box>
            ) : !camera.connected ? (
              <Box
                sx={{
                  aspectRatio:
                    camera.still_image.width / camera.still_image.height,
                  backgroundColor: theme.palette.background.default,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                  px: 2,
                }}
              >
                <VideoOff
                  size={48}
                  style={{
                    color: theme.palette.text.secondary,
                    opacity: 0.5,
                  }}
                />
                <Typography
                  variant="body2"
                  color="text.secondary"
                  align="center"
                >
                  {cameraStatusDetail(camera)}
                </Typography>
              </Box>
            ) : (
              <Image
                src={snapshotURL.url}
                disableSpinner={snapshotURL.disableSpinner}
                disableTransition={snapshotURL.disableTransition}
                animationDuration={1000}
                aspectRatio={
                  camera.still_image.width / camera.still_image.height
                }
                color={theme.palette.background.default}
                onLoad={() => {
                  setSnapshotURL((prevSnapshotURL) => ({
                    ...prevSnapshotURL,
                    disableSpinner: true,
                    disableTransition: true,
                    loading: false,
                  }));
                }}
                errorIcon={
                  camera.still_image.available ? (
                    <CircularProgress enableTrackSlot />
                  ) : null
                }
                onError={() => {
                  setSnapshotURL((prevSnapshotURL) => ({
                    ...prevSnapshotURL,
                    disableSpinner: false,
                    disableTransition: false,
                    loading: false,
                  }));
                }}
              />
            )}
          </CardMedia>
        </CardActionArea>
        {buttons && (
          <CardActions>
            <Stack
              direction="row"
              spacing={1}
              sx={{ width: "100%", alignItems: "center" }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Tooltip title={camera.is_on ? "Stop Camera" : "Start Camera"}>
                  <div data-testid="camera-toggle-button">
                    <Switch
                      checked={camera.is_on}
                      disabled={cameraStartStop.isPending}
                      onChange={() => {
                        if (cameraStartStop.isPending) {
                          return;
                        }
                        cameraStartStop.mutate({
                          camera,
                          action: camera.is_on ? "stop" : "start",
                        });
                      }}
                    />
                  </div>
                </Tooltip>
                <Tooltip title="Uptime Status">
                  <div style={{ cursor: "pointer" }}>
                    <CameraUptime
                      cameraIdentifier={camera.identifier}
                      isConnected={camera.connected}
                      compact
                    />
                  </div>
                </Tooltip>
                {status.state !== "connected" && (
                  <Tooltip title={cameraStatusDetail(camera)}>
                    <Chip
                      size="small"
                      color={statusColor(status)}
                      label={status.label}
                      sx={{ maxWidth: 180 }}
                    />
                  </Tooltip>
                )}
              </Stack>
              <Box sx={{ flexGrow: 1 }} />
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Tooltip title="Events">
                  <IconButton
                    component={Link}
                    to={`/events?camera=${camera.identifier}&tab=events`}
                  >
                    <IntrusionPrevention size={20} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Timeline">
                  <IconButton
                    component={Link}
                    to={`/events?camera=${camera.identifier}&tab=timeline`}
                  >
                    <Roadmap size={20} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Recordings">
                  <IconButton
                    component={Link}
                    to={`/recordings/${camera.identifier}`}
                    color={recordingBlocked ? "warning" : "default"}
                  >
                    <Demo size={20} />
                  </IconButton>
                </Tooltip>
                <Tooltip
                  title={
                    liveBlocked
                      ? livePolicy?.reason || "Live view is blocked by schedule"
                      : "Live View"
                  }
                >
                  <span>
                    <IconButton
                      component={Link}
                      to={`/live?camera=${camera.identifier}`}
                      disabled={liveBlocked}
                    >
                      <VideoChat size={20} />
                    </IconButton>
                  </span>
                </Tooltip>
                {canManageCamera && (
                  <Tooltip title="Reconnect Camera">
                    <span>
                      <IconButton
                        disabled={cameraReconnect.isPending}
                        onClick={() => cameraReconnect.mutate({ camera })}
                        color={status.state === "stale" ? "warning" : "default"}
                      >
                        <Renew size={20} />
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
                {(!auth.enabled || user?.role === "admin") && (
                  <Tooltip title="Camera Tuning">
                    <IconButton
                      component={Link}
                      to={`/cameras/${camera.identifier}`}
                      data-testid="camera-tuning-button"
                    >
                      <SettingsAdjust size={20} />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            </Stack>
          </CardActions>
        )}
      </Card>
    </div>
  );
}
export function CameraCard({
  camera_identifier,
  buttons = true,
  compact = false,
  onClick,
  border,
}: CameraCardProps) {
  const { connected } = useContext(ViseronContext);
  const cameraQuery = useCamera(camera_identifier, true, {
    enabled: connected,
  });
  if (!cameraQuery.data) {
    return null;
  }
  if (cameraQuery.data.failed) {
    return (
      <FailedCameraCard
        failedCamera={cameraQuery.data}
        compact={compact}
        onClick={(onClick as FailedOnClick) || undefined}
      />
    );
  }
  return (
    <SuccessCameraCard
      camera={cameraQuery.data}
      buttons={buttons}
      compact={compact}
      onClick={onClick as OnClick | undefined}
      border={border}
    />
  );
}
