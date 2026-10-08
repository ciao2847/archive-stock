import "server-only";

import type { PublicBundleMenu } from "@/lib/bundle-claims";
import { getClaimFormAssetPublicUrl } from "@/lib/claim-form-assets";
import {
  DEFAULT_CLAIM_FORM_BANNER_POSITION,
  getDefaultClaimFormTheme,
  normalizeClaimFormBannerPosition,
  normalizeHexColor,
} from "@/lib/claim-form-theme";

export const BUNDLE_PUBLIC_INVENTORY_SELECT =
  "name,official_line_id,claim_completion_message,claim_banner_image_path,claim_banner_position_x,claim_banner_position_y,claim_theme_primary_color,claim_theme_background_color,claim_theme_surface_color,claim_theme_header_text_color";

function optional(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function mapBundlePublicSettings(
  inventory: Record<string, unknown>,
): Omit<PublicBundleMenu, "options"> {
  const storeName = optional(inventory.name) ?? "庫藏 Archive Stock";
  const officialLineId = optional(inventory.official_line_id);
  const fallback = getDefaultClaimFormTheme(storeName);
  return {
    storeName,
    officialLineId,
    completionMessage:
      optional(inventory.claim_completion_message) ??
      (officialLineId
        ? `配單確認完成請加官方 LINE ${officialLineId}，完成匯款才算訂購完成。`
        : "配單確認完成請聯繫管理者，完成匯款才算訂購完成。"),
    bannerImageUrl: getClaimFormAssetPublicUrl(
      optional(inventory.claim_banner_image_path),
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
        fallback.primaryColor,
      ),
      backgroundColor: normalizeHexColor(
        String(inventory.claim_theme_background_color ?? ""),
        fallback.backgroundColor,
      ),
      surfaceColor: normalizeHexColor(
        String(inventory.claim_theme_surface_color ?? ""),
        fallback.surfaceColor,
      ),
      headerTextColor: normalizeHexColor(
        String(inventory.claim_theme_header_text_color ?? ""),
        fallback.headerTextColor,
      ),
    },
  };
}
