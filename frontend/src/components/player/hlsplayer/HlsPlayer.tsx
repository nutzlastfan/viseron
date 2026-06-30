import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { useTheme } from "@mui/material/styles";
import Hls, { LevelLoadedData } from "hls.js";
import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { useShallow } from "zustand/react/shallow";

import {
  findFragmentByTimestamp,
  getSeekTarget,
  useHlsStore,
  useReferencePlayerStore,
} from "components/events/utils";
import { usePlayerSettingsStore } from "components/player/UsePlayerSettingsStore";
import { ZoomPanOverlay } from "components/player/ZoomPanOverlay";
import { HlsErrorOverlay } from "components/player/hlsplayer/HlsErrorOverlay";
import {
  cleanupHlsInstance,
  createHlsInstance,
  setupHlsErrorHandling,
} from "components/player/hlsplayer/utils";
import { usePersistedZoomPan } from "components/player/hooks/usePersistedZoomPan";
import { useZoomPan } from "components/player/hooks/useZoomPan";
import { useAuthContext } from "context/AuthContext";
import { ViseronContext } from "context/ViseronContext";
import { useFirstRender } from "hooks/UseFirstRender";
import { BASE_PATH } from "lib/api/client";
import { BLANK_IMAGE } from "lib/helpers";
import {
  getDateStringFromDayjs,
  getDayjsFromUnixTimestamp,
} from "lib/helpers/dates";
import * as types from "lib/types";

const loadSource = (
  hlsRef: React.MutableRefObject<Hls | null>,
  hlsClientIdRef: React.MutableRefObject<string>,
  playingDate: number,
  camera: types.Camera | types.FailedCamera,
) => {
  if (!hlsRef.current) {
    return;
  }
  // Subtract 1 hour from playingDate.
  // This is to allow clicking on the timeline and then seek backwards a bit to get some
  // context before the requested timestamp
  const startTimestamp = playingDate - 3600;

  const source =
    `${BASE_PATH}/api/v1/hls/${camera.identifier}/index.m3u8` +
    `?start_timestamp=${startTimestamp}` +
    `&date=${getDateStringFromDayjs(getDayjsFromUnixTimestamp(playingDate))}`;
  hlsClientIdRef.current = uuidv4();
  hlsRef.current.loadSource(source);
};

const onLevelLoaded = (
  data: LevelLoadedData,
  hlsRef: React.MutableRefObject<Hls | null>,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  initialProgramDateTime: React.MutableRefObject<number | null>,
  playingDateRef: React.MutableRefObject<number>,
) => {
  const playingDateMillis = playingDateRef.current * 1000;
  const fragments = data.details.fragments;
  if (!hlsRef.current || !videoRef.current) {
    return;
  }

  if (fragments.length > 0) {
    initialProgramDateTime.current = fragments[0].programDateTime!;
  }

  // Seek to the requested timestamp
  const fragment = findFragmentByTimestamp(fragments, playingDateMillis);
  if (fragment) {
    const seekTarget = getSeekTarget(fragment, playingDateMillis);
    videoRef.current.currentTime = seekTarget;
    videoRef.current.play().catch(() => {
      // Ignore play errors
    });
  } else {
    videoRef.current.pause();
  }
};

const onManifestParsed = (
  hlsRef: React.MutableRefObject<Hls | null>,
  videoRef: React.RefObject<HTMLVideoElement | null>,
) => {
  if (!hlsRef.current || !videoRef.current) {
    return;
  }

  videoRef.current.muted = true;
  hlsRef.current.startLoad(0);
};

const onMediaAttached = (
  hlsRef: React.MutableRefObject<Hls | null>,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  initialProgramDateTime: React.MutableRefObject<number | null>,
  playingDateRef: React.MutableRefObject<number>,
) => {
  hlsRef.current!.once(Hls.Events.MANIFEST_PARSED, () => {
    onManifestParsed(hlsRef, videoRef);
  });

  hlsRef.current!.once(
    Hls.Events.LEVEL_LOADED,
    (event: any, data: LevelLoadedData) => {
      onLevelLoaded(
        data,
        hlsRef,
        videoRef,
        initialProgramDateTime,
        playingDateRef,
      );
    },
  );
};

const initializePlayer = (
  hlsRef: React.MutableRefObject<Hls | null>,
  hlsClientIdRef: React.MutableRefObject<string>,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  initialProgramDateTime: React.MutableRefObject<number | null>,
  auth: types.AuthEnabledResponse,
  camera: types.Camera | types.FailedCamera,
  playingDateRef: React.MutableRefObject<number>,
  setHlsRefsError: (
    hlsRef: React.MutableRefObject<Hls | null>,
    error: string | null,
  ) => void,
  delayedInitializationTimeoutRef: React.MutableRefObject<
    NodeJS.Timeout | undefined
  >,
  delayedRecoveryTimeoutRef: React.MutableRefObject<NodeJS.Timeout | undefined>,
) => {
  // Destroy the previous hls instance if it exists
  if (hlsRef.current) {
    hlsRef.current.destroy();
    hlsRef.current = null;
  }

  // Create a new hls instance using shared factory
  hlsRef.current = createHlsInstance(auth, hlsClientIdRef);

  if (videoRef.current) {
    hlsRef.current.attachMedia(videoRef.current);
  }

  // Load the source and start the hls instance
  loadSource(hlsRef, hlsClientIdRef, playingDateRef.current, camera);

  // Handle MEDIA_ATTACHED event
  hlsRef.current.on(Hls.Events.MEDIA_ATTACHED, () => {
    onMediaAttached(hlsRef, videoRef, initialProgramDateTime, playingDateRef);
  });

  // Setup error handling using shared utility
  setupHlsErrorHandling(hlsRef.current, {
    hlsRef,
    setHlsRefsError,
    delayedInitializationTimeoutRef,
    delayedRecoveryTimeoutRef,
    onReinitialize: () => {
      initializePlayer(
        hlsRef,
        hlsClientIdRef,
        videoRef,
        initialProgramDateTime,
        auth,
        camera,
        playingDateRef,
        setHlsRefsError,
        delayedInitializationTimeoutRef,
        delayedRecoveryTimeoutRef,
      );
    },
  });
};

const useInitializePlayer = (
  hlsRef: React.MutableRefObject<Hls | null>,
  hlsClientIdRef: React.MutableRefObject<string>,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  initialProgramDateTime: React.MutableRefObject<number | null>,
  camera: types.Camera | types.FailedCamera,
) => {
  const { auth } = useAuthContext();
  const { connected } = useContext(ViseronContext);
  const { addHlsRef, removeHlsRef, setHlsRefsError } = useHlsStore(
    useShallow((state) => ({
      addHlsRef: state.addHlsRef,
      removeHlsRef: state.removeHlsRef,
      setHlsRefsError: state.setHlsRefsError,
    })),
  );
  const { playingDateRef } = useReferencePlayerStore(
    useShallow((state) => ({
      playingDateRef: state.playingDateRef,
    })),
  );
  const delayedInitializationTimeoutRef = useRef<NodeJS.Timeout>(undefined);
  const delayedRecoveryTimeoutRef = useRef<NodeJS.Timeout>(undefined);

  const reInitPlayer = useCallback(() => {
    if (Hls.isSupported()) {
      initializePlayer(
        hlsRef,
        hlsClientIdRef,
        videoRef,
        initialProgramDateTime,
        auth,
        camera,
        playingDateRef,
        setHlsRefsError,
        delayedInitializationTimeoutRef,
        delayedRecoveryTimeoutRef,
      );
    }
  }, [
    auth,
    camera,
    hlsClientIdRef,
    hlsRef,
    initialProgramDateTime,
    playingDateRef,
    setHlsRefsError,
    videoRef,
    delayedInitializationTimeoutRef,
    delayedRecoveryTimeoutRef,
  ]);

  useEffect(() => {
    if (Hls.isSupported()) {
      addHlsRef(hlsRef);
      initializePlayer(
        hlsRef,
        hlsClientIdRef,
        videoRef,
        initialProgramDateTime,
        auth,
        camera,
        playingDateRef,
        setHlsRefsError,
        delayedInitializationTimeoutRef,
        delayedRecoveryTimeoutRef,
      );
    }
    return () => {
      cleanupHlsInstance(
        hlsRef,
        removeHlsRef,
        delayedInitializationTimeoutRef,
        delayedRecoveryTimeoutRef,
      );
    };
    // Must disable this warning since we dont want to ever run this twice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause the player when the connection is lost
  useEffect(() => {
    if (!connected && hlsRef.current) {
      hlsRef.current.stopLoad();
    } else if (connected && hlsRef.current) {
      hlsRef.current.startLoad();
    }
  }, [connected, hlsRef]);

  return {
    reInitPlayer,
  };
};

// Seek to the requestedTimestamp if it is within the seekable range
const useSeekToTimestamp = (
  hlsRef: React.MutableRefObject<Hls | null>,
  hlsClientIdRef: React.MutableRefObject<string>,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  initialProgramDateTime: React.MutableRefObject<number | null>,
  camera: types.Camera | types.FailedCamera,
  reInitPlayer: () => void,
) => {
  // Avoid running on first render to not call loadSource twice
  const firstRender = useFirstRender();
  const { requestedTimestamp } = useReferencePlayerStore(
    useShallow((state) => ({
      requestedTimestamp: state.requestedTimestamp,
    })),
  );

  useEffect(() => {
    if (
      !hlsRef.current ||
      !videoRef.current ||
      !hlsRef.current.media ||
      firstRender
    ) {
      return;
    }

    const requestedTimestampMillis = requestedTimestamp * 1000;
    // Set seek target timestamp
    const currentLevel = hlsRef.current.levels[hlsRef.current.currentLevel];
    if (!currentLevel || !currentLevel.details) {
      return;
    }

    const fragments = currentLevel.details.fragments;
    if (!fragments || fragments.length === 0) {
      return;
    }
    const fragment = findFragmentByTimestamp(
      fragments,
      requestedTimestampMillis,
    );

    if (fragment) {
      const seekTarget = getSeekTarget(fragment, requestedTimestampMillis);
      videoRef.current.currentTime = seekTarget;
      videoRef.current.play().catch(() => {
        // Ignore play errors
      });
    } else {
      // If the fragment is not found, reinitialize the player to load the correct source
      reInitPlayer();
    }
  }, [
    camera,
    firstRender,
    hlsClientIdRef,
    hlsRef,
    initialProgramDateTime,
    reInitPlayer,
    requestedTimestamp,
    videoRef,
  ]);
};

interface HlsPlayerProps {
  camera: types.Camera | types.FailedCamera;
}

export function HlsPlayer({ camera }: HlsPlayerProps) {
  const theme = useTheme();
  const hlsRef = useRef<Hls | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsClientIdRef = useRef<string>(uuidv4());
  const initialProgramDateTime = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isHovering, setIsHovering] = useState(false);
  const fallbackAspectRatio = camera.mainstream.width / camera.mainstream.height;
  const [contentAspectRatio, setContentAspectRatio] =
    useState(fallbackAspectRatio);
  const flipView = usePlayerSettingsStore(
    (state) => state.flipViewMap[camera.identifier] ?? false,
  );
  const { persistedTransform, onTransformChange } = usePersistedZoomPan(
    camera.identifier,
  );

  const { hlsRefError } = useHlsStore(
    useShallow((state) => ({
      hlsRefError: state.hlsRefsError.get(hlsRef),
    })),
  );

  const { reInitPlayer } = useInitializePlayer(
    hlsRef,
    hlsClientIdRef,
    videoRef,
    initialProgramDateTime,
    camera,
  );
  useSeekToTimestamp(
    hlsRef,
    hlsClientIdRef,
    videoRef,
    initialProgramDateTime,
    camera,
    reInitPlayer,
  );

  const isZoomPanDisabled = Boolean(isLoading || hlsRefError);
  const {
    transformStyle,
    handleMouseDown,
    resetTransform,
    scale,
    translateX,
    translateY,
    cursor,
  } = useZoomPan(containerRef, {
    minScale: 1.0,
    maxScale: 5,
    zoomSpeed: 0.2,
    disabled: isZoomPanDisabled,
    contentAspectRatio,
    persistedTransform,
    onTransformChange,
  });

  const updateContentAspectRatio = useCallback(() => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      return;
    }
    setContentAspectRatio(video.videoWidth / video.videoHeight);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return undefined;
    }

    video.addEventListener("loadedmetadata", updateContentAspectRatio);
    video.addEventListener("loadeddata", updateContentAspectRatio);
    video.addEventListener("resize", updateContentAspectRatio);
    updateContentAspectRatio();

    return () => {
      video.removeEventListener("loadedmetadata", updateContentAspectRatio);
      video.removeEventListener("loadeddata", updateContentAspectRatio);
      video.removeEventListener("resize", updateContentAspectRatio);
    };
  }, [updateContentAspectRatio]);

  // Handle loading state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return () => {};

    const handleLoadStart = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);
    const handleLoadedData = () => setIsLoading(false);
    const handleError = () => setIsLoading(false);

    video.addEventListener("loadstart", handleLoadStart);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("error", handleError);

    return () => {
      video.removeEventListener("loadstart", handleLoadStart);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("error", handleError);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        overflow: "hidden",
        cursor: isZoomPanDisabled ? "default" : cursor,
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onMouseDown={isZoomPanDisabled ? undefined : handleMouseDown}
      onDoubleClick={isZoomPanDisabled ? undefined : resetTransform}
      role="button"
      tabIndex={0}
      aria-label={
        isZoomPanDisabled
          ? "Video player"
          : "Video player - scroll to zoom, drag to pan, double-click to reset"
      }
      onKeyDown={
        isZoomPanDisabled
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                resetTransform();
              }
            }
      }
    >
      {/* Always render video-element */}
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          overflow: "hidden",
          ...(!isZoomPanDisabled ? transformStyle : {}),
        }}
      >
        <video
          ref={videoRef}
          poster={BLANK_IMAGE}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            backgroundColor: theme.palette.background.default,
            pointerEvents: "none",
            transform: flipView ? "rotate(180deg)" : "none",
            transition: "transform 0.3s ease-in-out",
          }}
          controls={false}
          playsInline
          muted
        />
      </div>

      {/* Show loading indicator and when camera is connected */}
      {isLoading && (
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0, 0, 0, 0.3)",
            zIndex: 1,
            pointerEvents: "none",
          }}
        >
          <CircularProgress enableTrackSlot />
        </Box>
      )}

      {/* Show error overlay */}
      {hlsRef.current && <HlsErrorOverlay error={hlsRefError} />}
      <ZoomPanOverlay
        scale={scale}
        translateX={translateX}
        translateY={translateY}
        isVisible={!isZoomPanDisabled && isHovering}
      />
    </div>
  );
}

export default HlsPlayer;
