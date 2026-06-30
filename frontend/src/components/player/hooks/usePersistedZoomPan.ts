import { useCallback, useMemo } from "react";

import { usePlayerSettingsStore } from "components/player/UsePlayerSettingsStore";
import { useAuthContext } from "context/AuthContext";
import { ZoomPanTransform } from "lib/types";

const SHARED_USER_KEY = "shared";

export const getZoomPanTransformKey = (
  cameraIdentifier: string,
  userId?: string | null,
) => `${userId ?? SHARED_USER_KEY}:${cameraIdentifier}`;

export const usePersistedZoomPan = (cameraIdentifier: string) => {
  const { user } = useAuthContext();
  const key = useMemo(
    () => getZoomPanTransformKey(cameraIdentifier, user?.id),
    [cameraIdentifier, user?.id],
  );
  const transform = usePlayerSettingsStore(
    (state) => state.zoomPanTransformMap[key],
  );
  const setZoomPanTransform = usePlayerSettingsStore(
    (state) => state.setZoomPanTransform,
  );
  const resetZoomPanTransform = usePlayerSettingsStore(
    (state) => state.resetZoomPanTransform,
  );

  const handleTransformChange = useCallback(
    (value: ZoomPanTransform) => {
      if (value.scale <= 1) {
        resetZoomPanTransform(key);
        return;
      }
      setZoomPanTransform(key, value);
    },
    [key, resetZoomPanTransform, setZoomPanTransform],
  );

  return {
    persistedTransform: transform,
    onTransformChange: handleTransformChange,
  };
};
