import { useContext } from "react";

import { ViseronContext } from "context/ViseronContext";
import { getExportDestination } from "hooks/UseExportDestination";
import { useToast } from "hooks/UseToast";
import { useZoomPanExportTransform } from "hooks/UseZoomPanExportTransform";
import { exportRecording, exportSnapshot } from "lib/commands";
import * as types from "lib/types";

export const useExportEvent = () => {
  const viseron = useContext(ViseronContext);
  const toast = useToast();
  const getZoomPanTransform = useZoomPanExportTransform();

  const exportEvent = async (event: types.CameraEvent) => {
    if (!viseron.connection) {
      return event;
    }

    switch (event.type) {
      case "object":
      case "face_recognition":
      case "license_plate_recognition":
      case "motion":
        await exportSnapshot(
          viseron.connection,
          event.type,
          event.camera_identifier,
          event.id,
          getExportDestination(),
          toast,
        );
        return event;

      case "recording":
        await exportRecording(
          viseron.connection,
          event.camera_identifier,
          event.id,
          getZoomPanTransform(event.camera_identifier),
          getExportDestination(),
          toast,
        );
        return event;

      default:
        return event satisfies never;
    }
  };

  return exportEvent;
};
