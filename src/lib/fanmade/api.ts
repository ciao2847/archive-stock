import { readApiResponse } from "@/lib/api/http-client";
import type { FanmadeAction } from "./validation";
import type { FanmadeManagement, FanmadePage } from "./types";
export async function getFanmade(
  ownerId: string,
  page = 1,
  query = "",
  formId?: number,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ ownerId, page: String(page), query });
  if (formId) params.set("formId", String(formId));
  return readApiResponse<FanmadeManagement>(
    await fetch(`/api/fanmade?${params}`, { cache: "no-store", signal }),
  );
}
export async function manageFanmade(ownerId: string, input: FanmadeAction) {
  const response = await fetch("/api/fanmade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ownerId, ...input }),
  });
  return readApiResponse<{
    productIds?: string[];
    versions?: Record<string, string>;
    formId?: number;
    saved?: boolean;
  }>(response);
}
export async function getFanmadePage(
  token: string,
  ip: string,
  page = 1,
  query = "",
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ ip, page: String(page), query });
  return readApiResponse<FanmadePage>(
    await fetch(
      `/api/public/fanmade-forms/${encodeURIComponent(token)}?${params}`,
      { cache: "no-store", signal },
    ),
  );
}
export async function getFanmadeMedia(
  token: string,
  id: string,
  kind: "image" | "video",
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ productId: id, kind });
  return readApiResponse<{ url: string }>(
    await fetch(
      `/api/public/fanmade-forms/${encodeURIComponent(token)}/media?${params}`,
      { cache: "no-store", signal },
    ),
  );
}
