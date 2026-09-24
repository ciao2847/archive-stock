import { QR_TOKEN_PATTERN } from "@/constants";

export type PublicPurchaseChannel = "shopee" | "line";
export type PublicPurchaseDestination =
  | PublicPurchaseChannel
  | "myship"
  | "custom";

const DEFAULT_PUBLIC_PURCHASE_LINKS: Record<PublicPurchaseChannel, string> = {
  shopee: "https://tw.shp.ee/8EZvPcbd",
  line: "https://line.me/ti/p/~@xhs4077g",
};

export const PUBLIC_PURCHASE_LINKS: Record<PublicPurchaseChannel, string> = {
  shopee:
    process.env.NEXT_PUBLIC_SHOPEE_STORE_URL?.trim() ||
    DEFAULT_PUBLIC_PURCHASE_LINKS.shopee,
  line:
    process.env.NEXT_PUBLIC_OFFICIAL_LINE_URL?.trim() ||
    DEFAULT_PUBLIC_PURCHASE_LINKS.line,
};

export function resolvePublicPurchaseChannel(
  salesChannel?: string | null,
): PublicPurchaseChannel {
  return salesChannel?.trim().toLowerCase() === "shopee" ? "shopee" : "line";
}

export function resolvePublicPurchaseDestination(
  configuredUrl: string | null | undefined,
  channel: PublicPurchaseChannel,
): { kind: PublicPurchaseDestination; url: string } {
  const url = configuredUrl?.trim() || PUBLIC_PURCHASE_LINKS[channel];
  if (!configuredUrl?.trim()) return { kind: channel, url };

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === "myship.7-11.com.tw") return { kind: "myship", url };
    if (hostname === "line.me" || hostname.endsWith(".line.me")) {
      return { kind: "line", url };
    }
    if (
      hostname === "shp.ee" ||
      hostname.endsWith(".shp.ee") ||
      hostname.includes("shopee")
    ) {
      return { kind: "shopee", url };
    }
  } catch {
    // The database/API validates HTTPS URLs; keep a generic presentation if a
    // legacy value cannot be classified.
  }

  return { kind: "custom", url };
}

export function buildPublicQrUrl(token: string, origin: string) {
  return new URL(`/qr/${encodeURIComponent(token)}`, origin).toString();
}

export function extractQrToken(rawValue: string) {
  const legacyValue = rawValue.trim().replace(/^AS1:/i, "");
  if (QR_TOKEN_PATTERN.test(legacyValue)) return legacyValue;

  try {
    const url = new URL(rawValue.trim());
    const token = url.pathname.match(/\/qr\/([^/]+)\/?$/i)?.[1];
    return token ? decodeURIComponent(token) : legacyValue;
  } catch {
    return legacyValue;
  }
}
