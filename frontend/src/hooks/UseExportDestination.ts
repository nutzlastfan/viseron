import { useEffect, useState } from "react";

import type { ExportDestination } from "lib/types";
import { useExportDestinations } from "lib/api/exportDestinations";

export type { ExportDestination };

const STORAGE_KEY = "viseron.exportDestination";

export const EXPORT_DESTINATIONS: {
  value: ExportDestination;
  label: string;
}[] = [
  { value: "browser", label: "Browser download" },
];

export function getExportDestination(): ExportDestination {
  return window.localStorage.getItem(STORAGE_KEY) || "browser";
}

export function useExportDestination() {
  const [destination, setDestinationState] =
    useState<ExportDestination>(getExportDestination);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, destination);
  }, [destination]);

  return [destination, setDestinationState] as const;
}

export function useExportDestinationOptions() {
  const query = useExportDestinations();
  const serverDestinations =
    query.data?.destinations
      .filter((destination) => destination.enabled)
      .map((destination) => ({
        value: destination.id,
        label: destination.name,
      })) ?? [];

  return {
    ...query,
    options: [...EXPORT_DESTINATIONS, ...serverDestinations],
  };
}
