import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { viseronAPI } from "lib/api/client";
import * as types from "lib/types";

async function imouse() {
  const response = await viseronAPI.get<types.IMouseResponse>("imouse");
  return response.data;
}

async function rescanImouseDevice(deviceId: string) {
  const response = await viseronAPI.post<types.IMouseCommandResponse>(
    `imouse/${deviceId}/rescan`,
  );
  return response.data;
}

async function sendImouseCommand({
  deviceId,
  cameraId,
  command,
  value,
}: {
  deviceId: string;
  cameraId: string;
  command: types.IMouseCommand;
  value?: number;
}) {
  const response = await viseronAPI.post<types.IMouseCommandResponse>(
    `imouse/${deviceId}/${cameraId}/command`,
    { command, value },
  );
  return response.data;
}

export const useIMouse = () =>
  useQuery({
    queryKey: ["imouse"],
    queryFn: imouse,
    refetchInterval: 30000,
  });

export const useRescanIMouseDevice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rescanImouseDevice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["imouse"] }),
  });
};

export const useSendIMouseCommand = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sendImouseCommand,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["imouse"] }),
  });
};
