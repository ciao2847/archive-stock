import { API_ROUTES } from "@/constants";
import { readApiResponse } from "@/lib/api/http-client";
import {
  BUNDLE_CLAIM_IMAGE,
  validateBundleClaimImage,
  type BundleClaimFilter,
  type BundleClaimImage,
  type BundleClaimManagement,
  type BundleClaimCampaign,
  type PublicBundleClaim,
  type PublicBundleClaimConfirmationResult,
  type SaveBundleClaimDraftInput,
} from "@/lib/bundle-claims";
import { createClient } from "@/utils/supabase/client";

export async function fetchBundleCampaigns(
  ownerId: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ ownerId });
  const response = await fetch(`${API_ROUTES.getBundleCampaigns}?${query}`, {
    cache: "no-store",
    signal,
  });
  return readApiResponse<{ campaigns: BundleClaimCampaign[] }>(response);
}

export async function createBundleCampaign(input: {
  ownerId: string;
  title: string;
  description?: string;
  enabled?: boolean;
}) {
  const response = await fetch(API_ROUTES.getBundleCampaigns, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ campaign: BundleClaimCampaign }>(response);
}

export async function updateBundleCampaign(input: {
  id: number;
  ownerId: string;
  title?: string;
  description?: string;
  enabled?: boolean;
}) {
  const response = await fetch(API_ROUTES.getBundleCampaigns, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ campaign: BundleClaimCampaign }>(response);
}

export async function fetchBundleClaims(input: {
  ownerId: string;
  orderId?: number;
  campaignId?: number;
  search?: string;
  filter?: BundleClaimFilter;
  signal?: AbortSignal;
}) {
  const query = new URLSearchParams({ ownerId: input.ownerId });
  if (input.orderId) query.set("orderId", String(input.orderId));
  if (input.campaignId) query.set("campaignId", String(input.campaignId));
  if (input.search) query.set("search", input.search);
  if (input.filter && input.filter !== "all") {
    query.set("filter", input.filter);
  }
  const response = await fetch(`${API_ROUTES.getBundleClaims}?${query}`, {
    cache: "no-store",
    signal: input.signal,
  });
  return readApiResponse<BundleClaimManagement>(response);
}

export async function createBundleClaimDraft(input: SaveBundleClaimDraftInput) {
  const response = await fetch(API_ROUTES.getBundleClaims, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ orderId: number; publicToken: string }>(response);
}

export async function updateBundleClaimDraft(
  input: SaveBundleClaimDraftInput & { orderId: number },
) {
  const response = await fetch(API_ROUTES.getBundleClaims, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ orderId: number; updated: true }>(response);
}

export async function performBundleClaimAction(input: Record<string, unknown>) {
  const response = await fetch(API_ROUTES.getBundleClaims, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ orderId: number; action: string }>(response);
}

export async function deleteBundleClaimOrder(input: {
  ownerId: string;
  orderId: number;
  expectedUpdatedAt?: string;
}) {
  const response = await fetch(API_ROUTES.getBundleClaims, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ deleted: true; orderId: number }>(response);
}

export const deleteBundleClaimDraft = deleteBundleClaimOrder;

function extensionForType(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  return "webp";
}

export async function uploadBundleClaimImage(input: {
  ownerId: string;
  orderId: number;
  file: File;
}) {
  const validationError = validateBundleClaimImage(input.file);
  if (validationError) throw new Error(validationError);

  const filename = `${crypto.randomUUID()}.${extensionForType(input.file.type)}`;
  const storagePath = `${input.ownerId}/${input.orderId}/${filename}`;
  const supabase = createClient();
  const { error: uploadError } = await supabase.storage
    .from(BUNDLE_CLAIM_IMAGE.bucket)
    .upload(storagePath, input.file, {
      contentType: input.file.type,
      cacheControl: "3600",
      upsert: false,
    });
  if (uploadError) {
    throw new Error(`截圖上傳失敗：${uploadError.message}`);
  }

  try {
    const response = await fetch(
      API_ROUTES.getBundleClaimImages(input.orderId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerId: input.ownerId,
          storagePath,
          originalFilename: input.file.name || filename,
        }),
      },
    );
    return await readApiResponse<BundleClaimImage>(response);
  } catch (error) {
    await supabase.storage
      .from(BUNDLE_CLAIM_IMAGE.bucket)
      .remove([storagePath]);
    throw error;
  }
}

export async function removeBundleClaimImage(input: {
  ownerId: string;
  orderId: number;
  imageId: number;
}) {
  const response = await fetch(API_ROUTES.getBundleClaimImages(input.orderId), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId: input.ownerId, imageId: input.imageId }),
  });
  return readApiResponse<{ deleted: true; imageId: number }>(response);
}

export async function fetchPublicBundleClaim(token: string) {
  const response = await fetch(API_ROUTES.getPublicBundleClaim(token), {
    cache: "no-store",
  });
  return readApiResponse<PublicBundleClaim>(response);
}

export async function submitPublicBundleClaim(
  token: string,
  input: {
    nickname: string;
    phone: string;
    notes: string;
    consent: true;
    requestId: string;
    turnstileToken: string;
    website: string;
  },
) {
  const response = await fetch(API_ROUTES.getPublicBundleClaim(token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<PublicBundleClaimConfirmationResult>(response);
}

export async function fetchBundleMenuSettings(
  ownerId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/bundle-menu?${new URLSearchParams({ ownerId })}`,
    { cache: "no-store", signal },
  );
  return readApiResponse<import("@/lib/bundle-claims").BundleMenuSettings>(
    response,
  );
}

export async function setBundleMenuEnabled(ownerId: string, enabled: boolean) {
  const response = await fetch("/api/bundle-menu", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId, enabled }),
  });
  return readApiResponse<import("@/lib/bundle-claims").BundleMenuSettings>(
    response,
  );
}

export async function fetchPublicBundleMenu(
  token: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/public/bundle-menus/${encodeURIComponent(token)}`,
    { cache: "no-store", signal },
  );
  return readApiResponse<import("@/lib/bundle-claims").PublicBundleMenu>(
    response,
  );
}

export async function submitPublicBundleMenu(
  token: string,
  input: Parameters<typeof submitPublicBundleClaim>[1] & { orderId: number },
) {
  const response = await fetch(
    `/api/public/bundle-menus/${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return readApiResponse<PublicBundleClaim>(response);
}
