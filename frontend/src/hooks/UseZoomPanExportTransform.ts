import { useCallback } from "react";

import { usePlayerSettingsStore } from "components/player/UsePlayerSettingsStore";
import { getZoomPanTransformKey } from "components/player/hooks/usePersistedZoomPan";
import { useAuthContext } from "context/AuthContext";

export const useZoomPanExportTransform = () => {
  const { user } = useAuthContext();
  const flipViewMap = usePlayerSettingsStore((state) => state.flipViewMap);
  const zoomPanTransformMap = usePlayerSettingsStore(
    (state) => state.zoomPanTransformMap,
  );

  return useCallback(
    (cameraIdentifier: string) => {
      const transform =
        zoomPanTransformMap[getZoomPanTransformKey(cameraIdentifier, user?.id)];
      if (!transform) {
        return undefined;
      }

      return {
        ...transform,
        flip: flipViewMap[cameraIdentifier] ?? false,
      };
    },
    [flipViewMap, user?.id, zoomPanTransformMap],
  );
};
