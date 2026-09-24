import { readApiResponse } from "@/lib/api/http-client";
import { API_ROUTES } from "@/constants";
import type {
  ClaimFormManagement,
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

export async function submitPublicClaim(
  token: string,
  input: {
    nickname: string;
    phone: string;
    notes: string;
    requestId: string;
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
