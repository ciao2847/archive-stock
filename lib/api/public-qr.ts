import "server-only";

import { QR_TOKEN_PATTERN } from "@/lib/config";
import { createClient } from "@/utils/supabase/server";

export type PublicRecommendation = {
  sku: string;
  name: string;
  imageUrl?: string;
};

export type PublicQrLanding = {
  orderNo: string | null;
  qrStatus: string;
  orderStatus: string | null;
  salesChannel: string | null;
  recommendations: PublicRecommendation[];
};

type PublicQrLandingRow = {
  order_no: string | null;
  qr_status: string;
  order_status: string | null;
  sales_channel: string | null;
  recommendations: unknown;
};

function mapRecommendations(value: unknown): PublicRecommendation[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.sku !== "string" || typeof row.name !== "string") {
      return [];
    }
    const imagePath =
      typeof row.image_path === "string" ? row.image_path : undefined;
    return [
      {
        sku: row.sku,
        name: row.name,
        imageUrl: imagePath ? buildPublicProductImageUrl(imagePath) : undefined,
      },
    ];
  });
}

function buildPublicProductImageUrl(imagePath: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!supabaseUrl) return undefined;

  const encodedPath = imagePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${supabaseUrl}/storage/v1/object/public/product-images/${encodedPath}`;
}

export async function fetchPublicQrLanding(
  token: string,
  fallbackChannel?: string,
): Promise<PublicQrLanding | null> {
  if (!QR_TOKEN_PATTERN.test(token)) return null;

  const { data, error } = await (await createClient()).rpc(
    "get_public_qr_landing",
    { p_token: token, p_channel: fallbackChannel || null },
  );
  if (error) throw new Error(error.message);

  const row = (data as PublicQrLandingRow[] | null)?.[0];
  if (!row) return null;

  return {
    orderNo: row.order_no,
    qrStatus: row.qr_status,
    orderStatus: row.order_status,
    salesChannel: row.sales_channel,
    recommendations: mapRecommendations(row.recommendations),
  };
}
