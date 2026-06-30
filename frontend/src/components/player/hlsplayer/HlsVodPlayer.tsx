import { useTheme } from "@mui/material/styles";
import Hls from "hls.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useShallow } from "zustand/react/shallow";

import { useHlsStore } from "components/events/utils";
import { CustomControls } from "components/player/CustomControls";
import { usePlayerSettingsStore } from "components/player/UsePlayerSettingsStore";
import { ZoomPanOverlay } from "components/player/ZoomPanOverlay";
import { HlsErrorOverlay } from "components/player/hlsplayer/HlsErrorOverlay";
import { useFullscreen } from "components/player/hlsplayer/useFullscreen";
import { useHlsPlayerControls } from "components/player/hlsplayer/useHlsPlayerControls";
import {
  cleanupHlsInstance,
  createHlsInstance,
  setupHlsErrorHandling,
} from "components/player/hlsplayer/utils";
import { usePersistedZoomPan } from "components/player/hooks/usePersistedZoomPan";
import { useZoomPan } from "components/player/hooks/useZoomPan";
import { useAuthContext } from "context/AuthContext";
import { BLANK_IMAGE } from "lib/helpers";
import { useCanHover } from "lib/hooks/useCanHover";
import * as types from "lib/types";

const useLoadSourceOnPlay = (
  hlsRef: React.MutableRefObject<Hls | null>,
  hlsClientIdRef: React.MutableRefObject<string>,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  camera: types.Camera | types.FailedCamera,
  recording: types.Recording | null,
) => {
  const [playPressed, setPlayPressed] = useState(false);

  useEffect(() => {
    if (!recording) {
      return () => {};
    }
    const video = videoRef.current;
    if (!video) return () => {};

    const handlePlay = () => {
      if (!hlsRef.current) {
        return;
      }
      hlsClientIdRef.current = uuidv4();
      hlsRef.current.loadSource(recording.hls_url);
      setPlayPressed(true);
    };

    video.addEventListener("play", handlePlay, { once: true });
    return () => video.removeEventListener("play", handlePlay);
  }, [hlsRef, hlsClientIdRef, videoRef, camera, recording]);

  return { playPressed };
};

const initializePlayer = (
  hlsRef: React.MutableRefObject<Hls | null>,
  hlsClientIdRef: React.MutableRefObject<string>,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  auth: types.AuthEnabledResponse,
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
        auth,
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
) => {
  const { auth } = useAuthContext();
  const { addHlsRef, removeHlsRef, setHlsRefsError } = useHlsStore(
    useShallow((state) => ({
      addHlsRef: state.addHlsRef,
      removeHlsRef: state.removeHlsRef,
      setHlsRefsError: state.setHlsRefsError,
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
        auth,
        setHlsRefsError,
        delayedInitializationTimeoutRef,
        delayedRecoveryTimeoutRef,
      );
    }
  }, [hlsRef, hlsClientIdRef, videoRef, auth, setHlsRefsError]);

  useEffect(() => {
    if (Hls.isSupported()) {
      addHlsRef(hlsRef);
      initializePlayer(
        hlsRef,
        hlsClientIdRef,
        videoRef,
        auth,
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
  return {
    reInitPlayer,
  };
};

interface HlsVodPlayerProps {
  camera: types.Camera | types.FailedCamera;
  recording?: types.Recording | null;
  poster?: string;
  loop?: boolean;
}

export function HlsVodPlayer({
  camera,
  recording = null,
  poster = BLANK_IMAGE,
  loop = false,
}: HlsVodPlayerProps) {
  const theme = useTheme();
  const canHover = useCanHover();
  const hlsRef = useRef<Hls | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsClientIdRef = useRef<string>(uuidv4());
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

  const {
    handlePlayPause,
    handleJumpBackward,
    handleJumpForward,
    handleVolumeChange,
    handleMuteToggle,
    handleMouseEnter,
    handleMouseMove,
    handleMouseLeave,
    handleTouchStart,
    controlsVisible,
    isHovering,
    isPlaying,
    isMuted,
  } = useHlsPlayerControls(videoRef);

  const { isFullscreen, isFullscreenSupported, toggleFullscreen } =
    useFullscreen(videoRef, containerRef);

  useInitializePlayer(hlsRef, hlsClientIdRef, videoRef);
  const { playPressed } = useLoadSourceOnPlay(
    hlsRef,
    hlsClientIdRef,
    videoRef,
    camera,
    recording,
  );

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

  const aspectRatio = fallbackAspectRatio;
  const isZoomPanDisabled = Boolean(hlsRefError);
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

  return (
    <div
      ref={containerRef}
      data-testid="hls-vod-player"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        aspectRatio,
        overflow: "hidden",
        cursor: isZoomPanDisabled ? "default" : cursor,
      }}
      onMouseEnter={canHover ? handleMouseEnter : undefined}
      onMouseMove={canHover ? handleMouseMove : undefined}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
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
          poster={poster}
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
          loop={loop}
          playsInline
          muted
        />
      </div>

      <CustomControls
        isPlaying={isPlaying}
        onPlayPause={handlePlayPause}
        onJumpBackward={handleJumpBackward}
        onJumpForward={handleJumpForward}
        isVisible={controlsVisible || isHovering}
        hasStarted={playPressed}
        onVolumeChange={handleVolumeChange}
        isMuted={isMuted}
        onMuteToggle={handleMuteToggle}
        videoRef={videoRef}
        showProgressBar={!!recording}
        isFullscreen={isFullscreen}
        onFullscreenToggle={toggleFullscreen}
        isFullscreenSupported={isFullscreenSupported}
      />

      {hlsRef.current && <HlsErrorOverlay error={hlsRefError} />}
      <ZoomPanOverlay
        scale={scale}
        translateX={translateX}
        translateY={translateY}
        isVisible={!isZoomPanDisabled && (controlsVisible || isHovering)}
      />
    </div>
  );
}

export default HlsVodPlayer;
