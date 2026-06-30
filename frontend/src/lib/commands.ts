import { Id } from "react-toastify";

import { useToast } from "hooks/UseToast";
import { downloadFile } from "lib/api/download";
import { getCameraNameFromQueryCache } from "lib/helpers";
import * as messages from "lib/messages";
import * as types from "lib/types";
import { Connection } from "lib/websockets";

export const getCameras = async (
  connection: Connection,
): Promise<types.Cameras> => {
  const response = await connection.sendMessagePromise(messages.getCameras());
  return response;
};

export const getConfig = async (connection: Connection): Promise<string> => {
  const response = await connection.sendMessagePromise(messages.getConfig());
  return response.config;
};

export const saveConfig = (
  connection: Connection,
  config: string,
): Promise<
  | types.WebSocketResultResponse["result"]
  | types.WebSocketResultErrorResponse["error"]
> => connection.sendMessagePromise(messages.saveConfig(config));

export const restartViseron = async (connection: Connection): Promise<void> => {
  await connection.sendMessagePromise(messages.restartViseron());
};

interface ReloadConfigResult {
  success: boolean;
  restart_required: boolean;
}

export const reloadConfig = async (
  connection: Connection,
): Promise<ReloadConfigResult> => {
  const response = await connection.sendMessagePromise(messages.reloadConfig());
  return response;
};

export const getEntities = async (
  connection: Connection,
): Promise<types.Entities> =>
  connection.sendMessagePromise(messages.getEntities());

export const subscribeStates = async (
  connection: Connection,
  stateCallback: (stateChangedEvent: types.StateChangedEvent) => void,
  entity_id?: string,
  entity_ids?: string[],
  resubscribe = true,
) => {
  const storedStateCallback = stateCallback;
  const subscription = await connection.subscribeStates(
    storedStateCallback,
    entity_id,
    entity_ids,
    resubscribe,
  );
  return subscription;
};

export const subscribeEvent = async <T = types.Event>(
  connection: Connection,
  event: string,
  eventCallback: (event: T) => void,
  debounce?: number,
) => {
  const subscription = await connection.subscribeEvent(
    event,
    eventCallback,
    true,
    debounce,
  );
  return subscription;
};

export const subscribeTimespans = async (
  connection: Connection,
  camera_identifiers: string[],
  date: string | null,
  timespanCallback: (message: types.HlsAvailableTimespans) => void,
  debounce?: number,
) => {
  const subscription = await connection.subscribeTimespans(
    timespanCallback,
    camera_identifiers,
    date,
    debounce,
    true,
  );
  return subscription;
};

const exportErrorCallback = (
  message: types.WebSocketSubscriptionErrorResponse,
  toast: ReturnType<typeof useToast>,
  toastId: Id,
  cameraName: string,
) => {
  toast.update(toastId, {
    type: "error",
    render: `${cameraName}: Preparation of download failed: ${message.error.message}`,
    autoClose: 5000,
  });
};

const handleExport = async (
  camera_identifier: string,
  toast: ReturnType<typeof useToast>,
  exportDestination: types.ExportDestination,
  exportFn: (
    successCallback: (message: types.DownloadFileResponse) => Promise<void>,
    errorCallback: (message: types.WebSocketSubscriptionErrorResponse) => void,
  ) => Promise<void>,
) => {
  const cameraName = getCameraNameFromQueryCache(camera_identifier);
  const toastId = toast.info(
    `${cameraName}: Preparing ${
      exportDestination === "browser" ? "download" : "server export"
    }...`,
    {
      autoClose: false,
    },
  );

  const handleSuccess = async (message: types.DownloadFileResponse) => {
    if (message.destination && message.destination !== "browser") {
      toast.update(toastId, {
        type: "success",
        render: `${cameraName}: Export copied to ${
          message.destination_name || message.destination
        } (${message.filename})`,
        autoClose: 8000,
      });
      return;
    }
    if (!message.token) {
      toast.update(toastId, {
        type: "error",
        render: `${cameraName}: Export did not return a download token.`,
        autoClose: 5000,
      });
      return;
    }
    await downloadFile(message, toastId, cameraName);
  };

  await exportFn(
    handleSuccess,
    (message) => exportErrorCallback(message, toast, toastId, cameraName),
  );
};

export const exportRecording = async (
  connection: Connection,
  camera_identifier: string,
  recording_id: number,
  zoom_pan_transform: types.ZoomPanTransform | undefined,
  exportDestination: types.ExportDestination,
  toast: ReturnType<typeof useToast>,
) => {
  await handleExport(
    camera_identifier,
    toast,
    exportDestination,
    (success, error) =>
      connection.exportRecording(
        camera_identifier,
        recording_id,
        zoom_pan_transform,
        exportDestination,
        success,
        error,
      ),
  );
};

export const exportSnapshot = async (
  connection: Connection,
  event_type: string,
  camera_identifier: string,
  snapshot_id: number,
  exportDestination: types.ExportDestination,
  toast: ReturnType<typeof useToast>,
) => {
  await handleExport(
    camera_identifier,
    toast,
    exportDestination,
    (success, error) =>
      connection.exportSnapshot(
        event_type,
        camera_identifier,
        snapshot_id,
        exportDestination,
        success,
        error,
      ),
  );
};

export const exportTimespan = async (
  connection: Connection,
  camera_identifiers: string[],
  start: number,
  end: number,
  getZoomPanTransform:
    | ((camera_identifier: string) => types.ZoomPanTransform | undefined)
    | undefined,
  exportDestination: types.ExportDestination,
  toast: ReturnType<typeof useToast>,
) => {
  for (const camera_identifier of camera_identifiers) {
    // eslint-disable-next-line no-await-in-loop
    await handleExport(
      camera_identifier,
      toast,
      exportDestination,
      (success, error) =>
        connection.exportTimespan(
          camera_identifier,
          start,
          end,
          getZoomPanTransform?.(camera_identifier),
          exportDestination,
          success,
          error,
        ),
    );
  }
};

export const renderTemplate = async (
  connection: Connection,
  template: string,
): Promise<string> =>
  connection.sendMessagePromise(messages.renderTemplate(template));

export const getSetupStatus = async (
  connection: Connection,
): Promise<types.SetupStatusResponse> => {
  const response = await connection.sendMessagePromise(
    messages.getSetupStatus(),
  );
  return response;
};
