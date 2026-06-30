import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import Grow from "@mui/material/Grow";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";

import { CameraCard } from "components/camera/CameraCard";
import { FailedCameraCard } from "components/camera/FailedCameraCard";
import { NoCamerasConfigured } from "components/camera/NoCamerasConfigured";
import { Loading } from "components/loading/Loading";
import { useHasCamerasConfigured } from "hooks/UseHasCamerasConfigured";
import { useTitle } from "hooks/UseTitle";
import { useCameras, useCamerasFailed } from "lib/api/cameras";
import { useRecordingSchedule } from "lib/api/recordingSchedule";
import { objHasValues } from "lib/helpers";
import * as types from "lib/types";

type CameraSide = "left" | "right";
type CameraFilter = string;

type CameraPairInfo = {
  pairId: string;
  label: string;
  side: CameraSide;
};

type CameraPair = {
  pairId: string;
  label: string;
  left?: string;
  right?: string;
};

type CameraFilterOption = {
  id: string;
  label: string;
  cameraIds: string[];
};

const FILTER_ALL = "all";
const FILTER_PAIRS = "pairs";
const FILTER_LEFT = "side:left";
const FILTER_RIGHT = "side:right";

function formatIdentifierLabel(identifier: string) {
  return identifier
    .replaceAll("_", " ")
    .trim();
}

function getCameraPairInfo(identifier: string): CameraPairInfo | null {
  const sideMatch = identifier.match(
    /^(?<base>.+?)_(?<side>links|rechts|left|right)$/i,
  );
  if (sideMatch?.groups) {
    const side = ["links", "left"].includes(
      sideMatch.groups.side.toLowerCase(),
    )
      ? "left"
      : "right";
    return {
      pairId: sideMatch.groups.base,
      label: formatIdentifierLabel(sideMatch.groups.base),
      side,
    };
  }

  return null;
}

function buildCameraPairs(cameraIdentifiers: string[]) {
  const pairs = new Map<string, CameraPair>();
  cameraIdentifiers.forEach((identifier) => {
    const info = getCameraPairInfo(identifier);
    if (!info) {
      return;
    }
    const pair = pairs.get(info.pairId) || {
      pairId: info.pairId,
      label: info.label,
    };
    pair[info.side] = identifier;
    pairs.set(info.pairId, pair);
  });
  return [...pairs.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

function cameraIdsForPair(pair: CameraPair) {
  return [pair.left, pair.right].filter(Boolean) as string[];
}

function cameraIdsForSide(pairs: CameraPair[], side: CameraSide) {
  return pairs
    .map((pair) => pair[side])
    .filter((cameraId): cameraId is string => Boolean(cameraId))
    .sort();
}

function filterCameraIdentifiers(
  cameraIdentifiers: string[],
  cameraFilter: CameraFilter,
  pairs: CameraPair[],
  groupOptions: CameraFilterOption[],
) {
  if (cameraFilter === FILTER_ALL || cameraFilter === FILTER_PAIRS) {
    return cameraIdentifiers;
  }
  if (cameraFilter === FILTER_LEFT) {
    return cameraIdsForSide(pairs, "left");
  }
  if (cameraFilter === FILTER_RIGHT) {
    return cameraIdsForSide(pairs, "right");
  }
  return (
    groupOptions.find((option) => option.id === cameraFilter)?.cameraIds ??
    cameraIdentifiers
  );
}

function uniqueExistingCameraIds(cameraIds: string[], allCameraIds: Set<string>) {
  return Array.from(
    new Set(cameraIds.filter((cameraId) => allCameraIds.has(cameraId))),
  ).sort();
}

function buildCameraGroupOptions(
  allCameraIdentifiers: string[],
  cameraGroups: types.CameraAccessGroup[],
) {
  const allCameraIds = new Set(allCameraIdentifiers);
  return cameraGroups
    .map((group) => ({
      id: `group:${group.id}`,
      label: group.name || group.id,
      cameraIds: uniqueExistingCameraIds(group.cameras, allCameraIds),
    }))
    .filter((group) => group.cameraIds.length > 0);
}

function pairedAndStandaloneCameraIds(cameraIdentifiers: string[]) {
  const pairs = buildCameraPairs(cameraIdentifiers);
  const pairedCameraIds = new Set(pairs.flatMap(cameraIdsForPair));
  const standaloneCameraIds = cameraIdentifiers.filter(
    (cameraIdentifier) => !pairedCameraIds.has(cameraIdentifier),
  );
  return { pairs, standaloneCameraIds };
}

function CameraGridItem({
  cameraIdentifier,
  failedCameras,
}: {
  cameraIdentifier: string;
  failedCameras?: types.FailedCameras;
}) {
  const failedCamera = failedCameras?.[cameraIdentifier];
  return (
    <Grow in appear key={cameraIdentifier}>
      <Grid
        key={cameraIdentifier}
        size={{
          xs: 12,
          sm: 12,
          md: 6,
          lg: 6,
          xl: 4,
        }}
      >
        {failedCamera ? (
          <FailedCameraCard failedCamera={failedCamera} />
        ) : (
          <CameraCard camera_identifier={cameraIdentifier} compact />
        )}
      </Grid>
    </Grow>
  );
}

function CameraPairCard({
  pair,
  failedCameras,
}: {
  pair: CameraPair;
  failedCameras?: types.FailedCameras;
}) {
  return (
    <Grid
      key={pair.pairId}
      size={{
        xs: 12,
        lg: 6,
      }}
    >
      <Stack
        spacing={1}
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          height: "100%",
          p: 1,
        }}
      >
        <Typography
          variant="subtitle2"
          color="text.secondary"
          sx={{ lineHeight: 1.2 }}
        >
          {pair.label}
        </Typography>
        <Grid container direction="row" spacing={1}>
          {(["left", "right"] as const).map((side) => {
            const cameraIdentifier = pair[side];
            if (!cameraIdentifier) return null;
            return (
              <Grid key={side} size={{ xs: 12, md: 6 }}>
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    {side === "left" ? "Left" : "Right"}
                  </Typography>
                  {failedCameras?.[cameraIdentifier] ? (
                    <FailedCameraCard
                      failedCamera={failedCameras[cameraIdentifier]}
                    />
                  ) : (
                    <CameraCard camera_identifier={cameraIdentifier} compact />
                  )}
                </Stack>
              </Grid>
            );
          })}
        </Grid>
      </Stack>
    </Grid>
  );
}

function Cameras() {
  useTitle("Cameras");
  const cameras = useCameras({});
  const failedCameras = useCamerasFailed({});
  const recordingSchedule = useRecordingSchedule();
  const hasCamerasConfigured = useHasCamerasConfigured();
  const [cameraFilter, setCameraFilter] = useState<CameraFilter>(FILTER_ALL);
  const allCameraIdentifiers = useMemo(
    () =>
      [
        ...Object.keys(failedCameras.data || {}),
        ...Object.keys(cameras.data || {}),
      ].sort(),
    [cameras.data, failedCameras.data],
  );
  const cameraPairs = useMemo(
    () => buildCameraPairs(allCameraIdentifiers),
    [allCameraIdentifiers],
  );
  const groupOptions = useMemo(
    () =>
      buildCameraGroupOptions(
        allCameraIdentifiers,
        recordingSchedule.data?.camera_groups ?? [],
      ),
    [allCameraIdentifiers, recordingSchedule.data?.camera_groups],
  );
  const visibleCameraIdentifiers = filterCameraIdentifiers(
    allCameraIdentifiers,
    cameraFilter,
    cameraPairs,
    groupOptions,
  );
  const selectedGroup = groupOptions.find((option) => option.id === cameraFilter);
  const shouldRenderPairs = cameraFilter === FILTER_PAIRS || Boolean(selectedGroup);
  const { pairs: visiblePairs, standaloneCameraIds } = pairedAndStandaloneCameraIds(
    visibleCameraIdentifiers,
  );
  const hasPairedCameras = cameraPairs.length > 0;
  const hasFilterOptions = hasPairedCameras || groupOptions.length > 0;

  if (cameras.isPending || failedCameras.isPending) {
    return <Loading text="Loading Cameras" />;
  }

  if (
    !(
      objHasValues<typeof cameras.data>(cameras.data) ||
      objHasValues<typeof failedCameras.data>(failedCameras.data)
    )
  ) {
    return hasCamerasConfigured ? (
      <Loading text="Waiting for cameras to register" />
    ) : (
      <NoCamerasConfigured />
    );
  }

  return (
    <Container sx={{ paddingX: { xs: 1, md: 2 }, paddingY: 0.5 }}>
      <Stack spacing={1}>
        {hasFilterOptions && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={cameraFilter}
            onChange={(_, value: CameraFilter | null) => {
              if (value) {
                setCameraFilter(value);
              }
            }}
            sx={{
              alignSelf: "flex-start",
              flexWrap: "wrap",
              gap: 0.5,
              "& .MuiToggleButtonGroup-grouped": {
                borderRadius: 1,
                border: 1,
                borderColor: "divider",
                mx: 0,
              },
            }}
          >
            <ToggleButton value={FILTER_ALL}>All</ToggleButton>
            {hasPairedCameras && (
              <ToggleButton value={FILTER_PAIRS}>Pairs</ToggleButton>
            )}
            {hasPairedCameras && (
              <ToggleButton value={FILTER_LEFT}>Left</ToggleButton>
            )}
            {hasPairedCameras && (
              <ToggleButton value={FILTER_RIGHT}>Right</ToggleButton>
            )}
            {groupOptions.map((group) => (
              <ToggleButton key={group.id} value={group.id}>
                {group.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}

        {shouldRenderPairs ? (
          <Grid container direction="row" spacing={1}>
            {visiblePairs.map((pair) => (
              <CameraPairCard
                key={pair.pairId}
                pair={pair}
                failedCameras={failedCameras.data}
              />
            ))}
            {standaloneCameraIds.map((cameraIdentifier) => (
              <CameraGridItem
                key={cameraIdentifier}
                cameraIdentifier={cameraIdentifier}
                failedCameras={failedCameras.data}
              />
            ))}
          </Grid>
        ) : (
          <Grid container direction="row" spacing={1}>
            {visibleCameraIdentifiers.map((cameraIdentifier) => (
              <CameraGridItem
                key={cameraIdentifier}
                cameraIdentifier={cameraIdentifier}
                failedCameras={failedCameras.data}
              />
            ))}
          </Grid>
        )}
      </Stack>
    </Container>
  );
}

export default Cameras;
