import { useContext } from "react";

import { ViseronContext } from "context/ViseronContext";
import { getExportDestination } from "hooks/UseExportDestination";
import { useToast } from "hooks/UseToast";
import { useZoomPanExportTransform } from "hooks/UseZoomPanExportTransform";
import { exportRecording } from "lib/commands";
import type { ExportDestination } from "lib/types";

export const useExportRecording = () => {
  const viseron = useContext(ViseronContext);
  const toast = useToast();
  const getZoomPanTransform = useZoomPanExportTransform();

  const exportRecordingCallback = async (
    cameraIdentifier: string,
    recordingId: number,
    exportDestination: ExportDestination = getExportDestination(),
  ) => {
    if (!viseron.connection) {
      return;
    }

    await exportRecording(
      viseron.connection,
      cameraIdentifier,
      recordingId,
      getZoomPanTransform(cameraIdentifier),
      exportDestination,
      toast,
    );
  };

  return exportRecordingCallback;
};
