import { readApiResponse } from "@/lib/api/http-client";
import { API_ROUTES } from "@/constants";
import { CLAIM_FORM_ASSET_BUCKET } from "@/lib/claim-form-assets";
import { createClient } from "@/utils/supabase/client";
import type {
  ClaimFormManagement,
  ClaimPaymentStatus,
  ClaimSubmission,
  PublicClaimSubmissionResult,
  SaveClaimFormInput,
} from "@/lib/claims";

export async function fetchClaimFormManagement(
  ownerId: string,
  formId?: number,
  page = 1,
  customerPhone?: string,
) {
  const query = new URLSearchParams({ ownerId, page: String(page) });
  if (formId) query.set("formId", String(formId));
  if (customerPhone) query.set("customerPhone", customerPhone);
  const response = await fetch(`${API_ROUTES.getClaimForms}?${query}`, {
    cache: "no-store",
  });
  return readApiResponse<ClaimFormManagement>(response);
}

export async function saveClaimForm(input: SaveClaimFormInput) {
  const response = await fetch(API_ROUTES.getClaimForms, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ formId: number; publicToken: string }>(response);
}

export async function uploadClaimFormBanner(
  image: Blob,
  inventoryOwnerId: string,
) {
  const path = `${inventoryOwnerId}/${crypto.randomUUID()}.webp`;
  const { data, error } = await createClient()
    .storage.from(CLAIM_FORM_ASSET_BUCKET)
    .upload(path, image, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false,
    });
  if (error) throw new Error(`橫幅圖片上傳失敗：${error.message}`);
  return data.path;
}

export async function removeClaimFormBanner(path: string) {
  const { error } = await createClient()
    .storage.from(CLAIM_FORM_ASSET_BUCKET)
    .remove([path]);
  if (error) throw new Error(`橫幅圖片移除失敗：${error.message}`);
}

export async function deleteClaimSubmission(input: {
  ownerId: string;
  formId: number;
  submissionId: number;
}) {
  const response = await fetch(API_ROUTES.getClaimForms, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ deleted: true; submissionId: number }>(response);
}

export async function updateClaimSubmissionPaymentStatus(input: {
  ownerId: string;
  formId?: number;
  submissionId?: number;
  submissionIds?: number[];
  paymentStatus: ClaimPaymentStatus;
}) {
  const response = await fetch(API_ROUTES.getClaimForms, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{
    submissionIds: number[];
    paymentStatus: ClaimPaymentStatus;
  }>(response);
}

export async function recordClaimSubmissionPayment(input: {
  ownerId: string;
  submissionId: number;
  amount: number;
  transferredAt: string;
  payerAccountLastFive: string;
  note: string;
}) {
  const response = await fetch(API_ROUTES.getClaimPayments, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{
    paymentId: number;
    paymentStatus: ClaimPaymentStatus;
    totalPaid: number;
    outstandingAmount: number;
  }>(response);
}

export async function deleteClaimSubmissionPayment(input: {
  ownerId: string;
  paymentId: number;
}) {
  const response = await fetch(API_ROUTES.getClaimPayments, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{
    submissionId: number;
    paymentStatus: ClaimPaymentStatus;
    totalPaid: number;
    outstandingAmount: number;
  }>(response);
}

export async function fetchInventoryAllClaimSubmissions(ownerId: string) {
  const query = new URLSearchParams({ ownerId, scope: "all" });
  const response = await fetch(`${API_ROUTES.getClaimForms}?${query}`, {
    cache: "no-store",
  });
  return readApiResponse<{ submissions: ClaimSubmission[] }>(response);
}

export const fetchAllClaimSubmissions = fetchInventoryAllClaimSubmissions;

export async function deleteClaimForm(input: {
  ownerId: string;
  formId: number;
}) {
  const response = await fetch(API_ROUTES.getClaimForms, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{
    deleted: true;
    formId: number;
    bannerImagePath?: string | null;
  }>(response);
}

export async function submitPublicClaim(
  token: string,
  input: {
    nickname: string;
    phone: string;
    notes: string;
    requestId: string;
    turnstileToken: string;
    website: string;
    items: Array<{ productId: string; quantity: number }>;
  },
) {
  const response = await fetch(API_ROUTES.getPublicClaimForm(token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<PublicClaimSubmissionResult>(response);
}
