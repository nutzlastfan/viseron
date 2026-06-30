import { useMutation, useQuery } from "@tanstack/react-query";

import { useToast } from "hooks/UseToast";
import queryClient, { viseronAPI } from "lib/api/client";
import * as types from "lib/types";

async function exportDestinations() {
  const response =
    await viseronAPI.get<types.ExportDestinationsResponse>(
      "/export_destinations",
    );
  return response.data;
}

export const useExportDestinations = () =>
  useQuery({
    queryKey: ["export_destinations"],
    queryFn: exportDestinations,
  });

async function saveExportDestinations(
  destinations: types.ExportDestinationConfig[],
) {
  const response = await viseronAPI.put<types.ExportDestinationsSaveResponse>(
    "/export_destinations",
    { destinations },
  );
  return response.data;
}

export const useSaveExportDestinations = () => {
  const toast = useToast();
  return useMutation<
    types.ExportDestinationsSaveResponse,
    types.APIErrorResponse,
    types.ExportDestinationConfig[]
  >({
    mutationFn: saveExportDestinations,
    onSuccess: async () => {
      toast.success("Export destinations saved");
      queryClient.invalidateQueries({ queryKey: ["export_destinations"] });
    },
    onError: async (error) => {
      toast.error(
        error.response && error.response.data.error
          ? `Error saving export destinations: ${error.response.data.error}`
          : `An error occurred: ${error.message}`,
      );
    },
  });
};
