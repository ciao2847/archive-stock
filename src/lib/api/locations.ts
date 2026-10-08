import { API_ROUTES } from "@/constants";
import { readApiResponse } from "@/lib/api/http-client";

export async function createLocation(input: {
  code: string;
  description: string;
  ownerId: string;
}) {
  const response = await fetch(API_ROUTES.getLocations, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ id: string; code: string }>(response);
}

export async function getStorage(ownerId: string, signal?: AbortSignal) {
  return readApiResponse<import("@/lib/location-storage").StorageData>(
    await fetch(`/api/locations?${new URLSearchParams({ ownerId })}`, {
      signal,
      cache: "no-store",
    }),
  );
}
export async function manageStorage(
  ownerId: string,
  input: import("@/lib/location-storage").StorageAction,
) {
  return readApiResponse(
    await fetch("/api/locations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId, ...input }),
    }),
  );
}
