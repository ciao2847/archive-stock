import "server-only";

import { QR_TOKEN_PATTERN } from "@/constants";
import {
  BUNDLE_CLAIM_ORDER_SELECT,
  createBundleClaimSignedUrlMap,
  mapBundleClaimOrder,
} from "@/lib/api/bundle-claims-server";
import type { PublicBundleClaim } from "@/lib/bundle-claims";
import { getClaimFormAssetPublicUrl } from "@/lib/claim-form-assets";
import {
  DEFAULT_CLAIM_FORM_BANNER_POSITION,
  getDefaultClaimFormTheme,
  normalizeClaimFormBannerPosition,
  normalizeHexColor,
} from "@/lib/claim-form-theme";
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
      "name,official_line_id,claim_completion_message,claim_banner_image_path,claim_banner_position_x,claim_banner_position_y,claim_theme_primary_color,claim_theme_background_color,claim_theme_surface_color,claim_theme_header_text_color,claim_transfer_enabled,claim_bank_code,claim_bank_name,claim_bank_branch,claim_bank_account",
    )
    .eq("id", order.ownerId)
    .maybeSingle();
  if (inventoryError) throw new Error(inventoryError.message);
  if (!inventory) return null;

  const storeName = optionalString(inventory.name) ?? "庫藏 Archive Stock";
  const officialLineId = optionalString(inventory.official_line_id);
  const completionMessage =
    optionalString(inventory.claim_completion_message) ??
    (officialLineId
      ? `喊單完畢請加官方 LINE ${officialLineId}，完成匯款才算訂購完成。`
      : "喊單完畢請聯繫管理者，完成匯款才算訂購完成。");
  const fallbackTheme = getDefaultClaimFormTheme(storeName);
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
    storeName,
    officialLineId,
    completionMessage,
    bannerImageUrl: getClaimFormAssetPublicUrl(
      optionalString(inventory.claim_banner_image_path),
    ),
    bannerPosition: {
      x: normalizeClaimFormBannerPosition(
        Number(inventory.claim_banner_position_x),
        DEFAULT_CLAIM_FORM_BANNER_POSITION.x,
      ),
      y: normalizeClaimFormBannerPosition(
        Number(inventory.claim_banner_position_y),
        DEFAULT_CLAIM_FORM_BANNER_POSITION.y,
      ),
    },
    theme: {
      primaryColor: normalizeHexColor(
        String(inventory.claim_theme_primary_color ?? ""),
        fallbackTheme.primaryColor,
      ),
      backgroundColor: normalizeHexColor(
        String(inventory.claim_theme_background_color ?? ""),
        fallbackTheme.backgroundColor,
      ),
      surfaceColor: normalizeHexColor(
        String(inventory.claim_theme_surface_color ?? ""),
        fallbackTheme.surfaceColor,
      ),
      headerTextColor: normalizeHexColor(
        String(inventory.claim_theme_header_text_color ?? ""),
        fallbackTheme.headerTextColor,
      ),
    },
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
