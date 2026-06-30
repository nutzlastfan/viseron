import { useQuery } from "@tanstack/react-query";

import { viseronAPI } from "lib/api/client";
import * as types from "lib/types";

async function systemHealth() {
  const response =
    await viseronAPI.get<types.SystemHealthResponse>("system_health");
  return response.data;
}

export const useSystemHealth = () =>
  useQuery({
    queryKey: ["system_health"],
    queryFn: systemHealth,
    refetchInterval: 10000,
  });
