import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BUNDLE_CLAIM_IMAGE,
  BUNDLE_CLAIM_STATUSES,
  deriveBundleClaimStatus,
  type BundleClaimImage,
  type BundleClaimOrder,
  type BundleClaimPayment,
  type BundleClaimStatus,
} from "@/lib/bundle-claims";

export const BUNDLE_CLAIM_ORDER_SELECT = `
  id,
  owner_id,
  public_token,
  confirmation_code,
  title,
  description,
  total_amount,
  customer_hint,
  status,
  expires_at,
  customer_nickname,
  customer_phone,
  customer_notes,
  confirmed_at,
  receiving_checked_at,
  receiving_checked_by,
  outbound_checked_at,
  outbound_checked_by,
  created_at,
  updated_at,
  bundle_claim_order_images (
    id,
    storage_path,
    sort_order,
    media_type,
    original_filename,
    byte_size
  ),
  bundle_claim_payments (
    id,
    amount,
    transferred_at,
    payer_account_last_five,
    note,
    created_at
  )
`;

export function asUntypedSupabase(client: unknown) {
  return client as SupabaseClient;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberOf(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusOf(value: unknown): BundleClaimStatus {
  return typeof value === "string" &&
    (BUNDLE_CLAIM_STATUSES as readonly string[]).includes(value)
    ? (value as BundleClaimStatus)
    : "draft";
}

export function getBundleClaimImageRows(row: unknown) {
  const order = recordOf(row);
  const images = order.bundle_claim_order_images;
  if (!Array.isArray(images)) return [];
  return images
    .map(recordOf)
    .filter((image) => typeof image.storage_path === "string")
    .sort((a, b) => numberOf(a.sort_order) - numberOf(b.sort_order));
}

export async function createBundleClaimSignedUrlMap(
  client: SupabaseClient,
  rows: readonly unknown[],
) {
  const paths = rows.flatMap((row) =>
    getBundleClaimImageRows(row).flatMap((image) =>
      typeof image.storage_path === "string" ? [image.storage_path] : [],
    ),
  );
  if (paths.length === 0) return new Map<string, string>();

  const uniquePaths = [...new Set(paths)];
  const { data, error } = await client.storage
    .from(BUNDLE_CLAIM_IMAGE.bucket)
    .createSignedUrls(uniquePaths, BUNDLE_CLAIM_IMAGE.signedUrlTtlSeconds);
  if (error) throw new Error(error.message);

  const urlMap = new Map<string, string>();
  data?.forEach((item, index) => {
    const path = "path" in item && item.path ? item.path : uniquePaths[index];
    if (item.signedUrl && path) urlMap.set(path, item.signedUrl);
  });
  return urlMap;
}

export function mapBundleClaimOrder(
  value: unknown,
  signedUrls = new Map<string, string>(),
): BundleClaimOrder {
  const row = recordOf(value);
  const rawStatus = statusOf(row.status);
  const expiresAt = optionalString(row.expires_at);
  const images: BundleClaimImage[] = getBundleClaimImageRows(row).map(
    (image) => {
      const path = String(image.storage_path);
      return {
        id: numberOf(image.id),
        sortOrder: numberOf(image.sort_order),
        mediaType: String(image.media_type ?? ""),
        originalFilename: String(image.original_filename ?? "圖片"),
        byteSize: numberOf(image.byte_size),
        url: signedUrls.get(path) ?? "",
      };
    },
  );

  const paymentRows = Array.isArray(row.bundle_claim_payments)
    ? row.bundle_claim_payments
    : row.bundle_claim_payments && typeof row.bundle_claim_payments === "object"
      ? [row.bundle_claim_payments]
      : [];
  const paymentRow = paymentRows[0] ? recordOf(paymentRows[0]) : undefined;
  const payment: BundleClaimPayment | undefined = paymentRow
    ? {
        id: numberOf(paymentRow.id),
        amount: numberOf(paymentRow.amount),
        transferredAt: String(paymentRow.transferred_at ?? ""),
        payerAccountLastFive: optionalString(
          paymentRow.payer_account_last_five,
        ),
        note: optionalString(paymentRow.note),
        createdAt: String(paymentRow.created_at ?? ""),
      }
    : undefined;

  return {
    id: numberOf(row.id),
    ownerId: String(row.owner_id ?? ""),
    publicToken: String(row.public_token ?? ""),
    confirmationCode: String(row.confirmation_code ?? ""),
    title: String(row.title ?? ""),
    description: optionalString(row.description),
    totalAmount: numberOf(row.total_amount),
    customerHint: optionalString(row.customer_hint),
    status: deriveBundleClaimStatus(rawStatus, expiresAt),
    expiresAt,
    customerNickname: optionalString(row.customer_nickname),
    customerPhone: optionalString(row.customer_phone),
    customerNotes: optionalString(row.customer_notes),
    confirmedAt: optionalString(row.confirmed_at),
    receivingCheckedAt: optionalString(row.receiving_checked_at),
    receivingCheckedBy: optionalString(row.receiving_checked_by),
    outboundCheckedAt: optionalString(row.outbound_checked_at),
    outboundCheckedBy: optionalString(row.outbound_checked_by),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    images,
    payment,
  };
}
