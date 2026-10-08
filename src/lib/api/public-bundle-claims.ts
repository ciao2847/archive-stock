import "server-only";

import { QR_TOKEN_PATTERN } from "@/constants";
import {
  BUNDLE_CLAIM_ORDER_SELECT,
  createBundleClaimSignedUrlMap,
  mapBundleClaimOrder,
} from "@/lib/api/bundle-claims-server";
import type { PublicBundleClaim } from "@/lib/bundle-claims";
import {
  BUNDLE_PUBLIC_INVENTORY_SELECT,
  mapBundlePublicSettings,
} from "@/lib/api/bundle-public-settings";
import { createServiceClient } from "@/utils/supabase/service";

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function fetchPublicBundleClaim(
  token: string,
): Promise<PublicBundleClaim | null> {
  if (!QR_TOKEN_PATTERN.test(token)) return null;

  const supabase = createServiceClient();
  const { data: row, error } = await supabase
    .from("bundle_claim_orders")
    .select(BUNDLE_CLAIM_ORDER_SELECT)
    .eq("public_token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;

  const urlMap = await createBundleClaimSignedUrlMap(supabase, [row]);
  const order = mapBundleClaimOrder(row, urlMap);
  if (order.status !== "open" && order.status !== "confirmed") return null;

  const { data: inventory, error: inventoryError } = await supabase
    .from("inventory_databases")
    .select(
      `${BUNDLE_PUBLIC_INVENTORY_SELECT},claim_transfer_enabled,claim_bank_code,claim_bank_name,claim_bank_branch,claim_bank_account`,
    )
    .eq("id", order.ownerId)
    .maybeSingle();
  if (inventoryError) throw new Error(inventoryError.message);
  if (!inventory) return null;

  const transferAccount =
    order.status === "confirmed" &&
    inventory.claim_transfer_enabled &&
    optionalString(inventory.claim_bank_code) &&
    optionalString(inventory.claim_bank_name) &&
    optionalString(inventory.claim_bank_account)
      ? {
          bankCode: String(inventory.claim_bank_code),
          bankName: String(inventory.claim_bank_name),
          bankBranch: optionalString(inventory.claim_bank_branch),
          account: String(inventory.claim_bank_account),
        }
      : undefined;

  return {
    state: order.status,
    ...mapBundlePublicSettings(inventory),
    title: order.title,
    description: order.description,
    totalAmount: order.totalAmount,
    customerHint: order.customerHint,
    expiresAt: order.expiresAt,
    images: order.images,
    confirmation:
      order.status === "confirmed" && order.confirmedAt
        ? {
            confirmationCode: order.confirmationCode,
            submittedAt: order.confirmedAt,
            transferAccount,
          }
        : undefined,
  };
}
