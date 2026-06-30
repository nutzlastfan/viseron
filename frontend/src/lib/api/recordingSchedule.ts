import { useMutation, useQuery } from "@tanstack/react-query";

import { useToast } from "hooks/UseToast";
import queryClient, { viseronAPI } from "lib/api/client";
import * as types from "lib/types";

async function recordingSchedule() {
  const response = await viseronAPI.get<types.RecordingScheduleResponse>(
    "recording_schedule",
  );
  return response.data;
}

export const useRecordingSchedule = () =>
  useQuery({
    queryKey: ["recording_schedule"],
    queryFn: async () => recordingSchedule(),
    refetchInterval: 30000,
  });

async function updateRecordingSchedule(payload: types.RecordingScheduleConfig) {
  const response = await viseronAPI.put<types.RecordingScheduleResponse>(
    "recording_schedule",
    payload,
  );
  return response.data;
}

export const useUpdateRecordingSchedule = () => {
  const toast = useToast();
  return useMutation<
    types.RecordingScheduleResponse,
    types.APIErrorResponse,
    types.RecordingScheduleConfig
  >({
    mutationFn: updateRecordingSchedule,
    onSuccess: async () => {
      toast.success("Recording schedule saved");
      await queryClient.invalidateQueries({ queryKey: ["recording_schedule"] });
      await queryClient.invalidateQueries({ queryKey: ["cameras"] });
    },
    onError: async (error) => {
      toast.error(
        error.response && error.response.data.error
          ? `Error saving recording schedule: ${error.response.data.error}`
          : `An error occurred: ${error.message}`,
      );
    },
  });
};
