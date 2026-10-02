import "server-only";

import { QR_TOKEN_PATTERN } from "@/constants";
import { getClaimFormAssetPublicUrl } from "@/lib/claim-form-assets";
import {
  DEFAULT_CLAIM_FORM_THEME,
  normalizeClaimFormBannerPosition,
  normalizeHexColor,
} from "@/lib/claim-form-theme";
import type { PublicClaimForm, PublicClaimProduct } from "@/lib/claims";
import { createClient } from "@/utils/supabase/server";

type PublicClaimFormRow = {
  store_name: string;
  title: string;
  description: string | null;
  is_open: boolean;
  closes_at: string | null;
  banner_image_path: string | null;
  banner_position_x: number;
  banner_position_y: number;
  theme_primary_color: string;
  theme_background_color: string;
  theme_surface_color: string;
  theme_header_text_color: string;
  official_line_id: string | null;
  products: unknown;
};

const asOptionalString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : undefined;

const asNumber = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function buildPublicProductImageUrl(imagePath: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!supabaseUrl) return undefined;

  const encodedPath = imagePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${supabaseUrl}/storage/v1/object/public/product-images/${encodedPath}`;
}

function mapProducts(value: unknown): PublicClaimProduct[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.sku !== "string" ||
      typeof row.name !== "string" ||
      typeof row.category !== "string" ||
      typeof row.published_at !== "string"
    ) {
      return [];
    }
    const imagePath = asOptionalString(row.image_path);
    return [
      {
        id: row.id,
        sku: row.sku,
        name: row.name,
        work: asOptionalString(row.work) ?? "未分類作品",
        category: row.category,
        country: asOptionalString(row.country),
        source: asOptionalString(row.source),
        description: asOptionalString(row.description),
        price: asNumber(row.price),
        imageUrl: imagePath ? buildPublicProductImageUrl(imagePath) : undefined,
        format: asOptionalString(row.poster_format),
        size: asOptionalString(row.poster_size),
        crafts: Array.isArray(row.poster_crafts)
          ? row.poster_crafts.filter(
              (craft): craft is string => typeof craft === "string",
            )
          : [],
        releaseDate: asOptionalString(row.release_date),
        publishedAt: row.published_at,
        maxQuantity: Math.max(1, asNumber(row.max_quantity, 20)),
      },
    ];
  });
}

export async function fetchPublicClaimForm(
  token: string,
): Promise<PublicClaimForm | null> {
  if (!QR_TOKEN_PATTERN.test(token)) return null;

  const { data, error } = await (
    await createClient()
  ).rpc("get_public_claim_form", { p_token: token });
  if (error) throw new Error(error.message);

  const row = (data as PublicClaimFormRow[] | null)?.[0];
  if (!row) return null;

  return {
    storeName: row.store_name,
    officialLineId: asOptionalString(row.official_line_id),
    title: row.title,
    description: row.description || undefined,
    isOpen: row.is_open,
    closesAt: row.closes_at || undefined,
    bannerImageUrl: getClaimFormAssetPublicUrl(row.banner_image_path),
    bannerPosition: {
      x: normalizeClaimFormBannerPosition(row.banner_position_x),
      y: normalizeClaimFormBannerPosition(row.banner_position_y),
    },
    theme: {
      primaryColor: normalizeHexColor(
        row.theme_primary_color,
        DEFAULT_CLAIM_FORM_THEME.primaryColor,
      ),
      backgroundColor: normalizeHexColor(
        row.theme_background_color,
        DEFAULT_CLAIM_FORM_THEME.backgroundColor,
      ),
      surfaceColor: normalizeHexColor(
        row.theme_surface_color,
        DEFAULT_CLAIM_FORM_THEME.surfaceColor,
      ),
      headerTextColor: normalizeHexColor(
        row.theme_header_text_color,
        DEFAULT_CLAIM_FORM_THEME.headerTextColor,
      ),
    },
    products: mapProducts(row.products),
  };
}
