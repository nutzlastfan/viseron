import { useContext } from "react";

import { ViseronContext } from "context/ViseronContext";
import {
  getExportDestination,
  type ExportDestination,
} from "hooks/UseExportDestination";
import { useToast } from "hooks/UseToast";
import { useZoomPanExportTransform } from "hooks/UseZoomPanExportTransform";
import { exportTimespan } from "lib/commands";

export const useExportTimespan = () => {
  const viseron = useContext(ViseronContext);
  const toast = useToast();
  const getZoomPanTransform = useZoomPanExportTransform();

  const exportTimespanCallback = async (
    camera_identifiers: string[],
    start: number,
    end: number,
    exportDestination: ExportDestination = getExportDestination(),
  ) => {
    if (!viseron.connection) {
      return;
    }

    await exportTimespan(
      viseron.connection,
      camera_identifiers,
      start,
      end,
      getZoomPanTransform,
      exportDestination,
      toast,
    );
  };

  return exportTimespanCallback;
};
