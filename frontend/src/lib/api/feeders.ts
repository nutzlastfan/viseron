import { useMutation, useQuery } from "@tanstack/react-query";

import { useToast } from "hooks/UseToast";
import queryClient, { viseronAPI } from "lib/api/client";
import * as types from "lib/types";

type FeederSettingsPayload = {
  feederId: string;
  settings: types.FeederSettings;
};

type AddAnimalPayload = {
  feederId: string;
  tagid: string;
};

type DeleteAnimalPayload = {
  feederId: string;
  animalId: number;
};

type AddLockPayload = {
  feederId: string;
  day: number;
  from_h: number;
  from_m: number;
  to_h: number;
  to_m: number;
};

type DeleteLockPayload = {
  feederId: string;
  lockId: number;
};

const feedersQueryKey = ["feeders"];

async function getFeeders() {
  const response = await viseronAPI.get<types.FeedersResponse>("/feeders");
  return response.data;
}

export const useFeeders = ({ enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: feedersQueryKey,
    queryFn: getFeeders,
    refetchInterval: 10000,
    enabled,
    retry: false,
  });

async function setFeederSettings({
  feederId,
  settings,
}: FeederSettingsPayload) {
  const response = await viseronAPI.post<types.FeederResponse>(
    `/feeders/${feederId}/settings`,
    settings,
  );
  return response.data;
}

async function addFeederAnimal({ feederId, tagid }: AddAnimalPayload) {
  const response = await viseronAPI.post<types.FeederResponse>(
    `/feeders/${feederId}/animals`,
    { tagid },
  );
  return response.data;
}

async function deleteFeederAnimal({ feederId, animalId }: DeleteAnimalPayload) {
  const response = await viseronAPI.delete<types.FeederResponse>(
    `/feeders/${feederId}/animals/${animalId}`,
  );
  return response.data;
}

async function addFeederLock({ feederId, ...lock }: AddLockPayload) {
  const response = await viseronAPI.post<types.FeederResponse>(
    `/feeders/${feederId}/locks`,
    lock,
  );
  return response.data;
}

async function deleteFeederLock({ feederId, lockId }: DeleteLockPayload) {
  const response = await viseronAPI.delete<types.FeederResponse>(
    `/feeders/${feederId}/locks/${lockId}`,
  );
  return response.data;
}

const mutationError = (error: types.APIErrorResponse) =>
  error.response?.data.error || error.message;

export const useSetFeederSettings = () => {
  const toast = useToast();
  return useMutation<
    types.FeederResponse,
    types.APIErrorResponse,
    FeederSettingsPayload
  >({
    mutationFn: setFeederSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedersQueryKey });
    },
    onError: (error) =>
      toast.error(`Error saving feeder: ${mutationError(error)}`),
  });
};

export const useAddFeederAnimal = () => {
  const toast = useToast();
  return useMutation<
    types.FeederResponse,
    types.APIErrorResponse,
    AddAnimalPayload
  >({
    mutationFn: addFeederAnimal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedersQueryKey });
    },
    onError: (error) =>
      toast.error(`Error adding animal: ${mutationError(error)}`),
  });
};

export const useDeleteFeederAnimal = () => {
  const toast = useToast();
  return useMutation<
    types.FeederResponse,
    types.APIErrorResponse,
    DeleteAnimalPayload
  >({
    mutationFn: deleteFeederAnimal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedersQueryKey });
    },
    onError: (error) =>
      toast.error(`Error deleting animal: ${mutationError(error)}`),
  });
};

export const useAddFeederLock = () => {
  const toast = useToast();
  return useMutation<
    types.FeederResponse,
    types.APIErrorResponse,
    AddLockPayload
  >({
    mutationFn: addFeederLock,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedersQueryKey });
    },
    onError: (error) =>
      toast.error(`Error adding lock: ${mutationError(error)}`),
  });
};

export const useDeleteFeederLock = () => {
  const toast = useToast();
  return useMutation<
    types.FeederResponse,
    types.APIErrorResponse,
    DeleteLockPayload
  >({
    mutationFn: deleteFeederLock,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedersQueryKey });
    },
    onError: (error) =>
      toast.error(`Error deleting lock: ${mutationError(error)}`),
  });
};
