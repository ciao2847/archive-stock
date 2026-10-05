import { API_ROUTES } from "@/constants";
import { readApiResponse } from "@/lib/api/http-client";
import {
  BUNDLE_CLAIM_IMAGE,
  validateBundleClaimImage,
  type BundleClaimFilter,
  type BundleClaimImage,
  type BundleClaimManagement,
  type PublicBundleClaim,
  type PublicBundleClaimConfirmationResult,
  type SaveBundleClaimDraftInput,
} from "@/lib/bundle-claims";
import { createClient } from "@/utils/supabase/client";

export async function fetchBundleClaims(input: {
  ownerId: string;
  orderId?: number;
  search?: string;
  filter?: BundleClaimFilter;
  signal?: AbortSignal;
}) {
  const query = new URLSearchParams({ ownerId: input.ownerId });
  if (input.orderId) query.set("orderId", String(input.orderId));
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

export async function deleteBundleClaimDraft(input: {
  ownerId: string;
  orderId: number;
}) {
  const response = await fetch(API_ROUTES.getBundleClaims, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ deleted: true; orderId: number }>(response);
}

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
