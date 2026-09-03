import type { Status } from "@/lib/types";

export const API_ROUTES = {
  getPacking: "/api/packing",
  createOrder: "/api/orders",
  locations: "/api/locations",
  settlements: "/api/settlements",
  account: "/api/account",
  products: "/api/products",
  productImages: "/api/product-images",
  order: (id: string) => `/api/orders/${encodeURIComponent(id)}`,
  product: (id: string) => `/api/products/${encodeURIComponent(id)}`,
} as const;

export const UI_BREAKPOINTS = {
  mobile: 600,
  tablet: 992,
  compactDesktop: 1190,
  desktop: 1280,
} as const;

export const POSTER_CATEGORY = "海報";
export const PRODUCT_CATEGORIES = [
  "海報",
  "特典",
  "藝術卡",
  "吊飾",
  "盲盒",
  "其他周邊",
  "明信片",
] as const;
export const COUNTRIES = ["韓國", "日本", "台灣", "香港", "大陸"] as const;
export const POSTER_FORMATS = [
  "一般版",
  "IMAX",
  "Dolby Cinema",
  "4DX",
  "MX4D",
  "SCREENX",
  "2D",
  "3D",
  "其他特殊版本",
] as const;
export const POSTER_SIZES = ["A3", "A2", "B2", "B1", "27×40"] as const;
export const POSTER_CRAFTS = [
  "燙金",
  "局部亮面",
  "全部亮面",
  "局部雷射",
  "全部雷射",
  "亮銀龍",
  "霧面",
  "壓紋",
  "無工藝",
] as const;

export const PRODUCT_STATUS_LABELS: Record<string, Status> = {
  in_stock: "在庫",
  reserved: "已預留",
  packing: "待出貨",
  packed: "售罄",
  shipped: "已出貨",
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "待包貨",
  packing: "包貨中",
  packed: "已包裝",
  shipped: "已出貨",
  cancelled: "已取消",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: "已付款",
  pending: "待付款",
};

export const SALES_CHANNELS = [
  { value: "direct", label: "私訊／直接訂購" },
  { value: "shopee", label: "蝦皮" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "website", label: "官網" },
  { value: "other", label: "其他平台" },
] as const;

export const TERMINAL_ORDER_STATUSES = new Set(["已包裝", "已出貨", "已取消"]);
export const PACKING_ORDER_STATUSES = new Set(["待包貨", "包貨中"]);
export const FINANCIAL_ORDER_STATUSES = new Set(["packed", "shipped"]);

export const isOrderPackable = (status: string) =>
  !TERMINAL_ORDER_STATUSES.has(status);
export const isProductAvailable = (status: string, stock: number) =>
  status === "在庫" && stock > 0;

export const LOCATION_CODE_PATTERN = /^[A-Z]-\d{2}-\d{2}$/;
export const PRODUCT_SKU_PATTERN = /^A\d{6}$/i;
export const QR_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PACKING_SCAN_ERROR_MESSAGES: Record<string, string> = {
  invalid_scan_value: "請輸入 A000004 格式的商品 ID 或掃描 QR Code",
  invalid_sku: "找不到這個商品 ID",
  invalid_token: "QR Code 無效",
  token_used: "這張 QR Code 已經使用過",
  wrong_order: "此商品不屬於本訂單或已完成核對",
  no_active_label: "此商品沒有可使用的 QR 標籤",
};

export const IMAGE_UPLOAD = {
  acceptedTypes: ["image/jpeg", "image/png", "image/webp"],
  maxBytes: 10 * 1024 * 1024,
  maxMegabytes: 10,
} as const;

export const PRODUCT_IMAGE_BATCH_SIZE = 8;
export const PRODUCT_IMAGE_URL_TTL_SECONDS = 60 * 60;

export const DEFAULT_VALUES = {
  amount: 0,
  count: 0,
  productStock: 1,
  amountInput: "0",
} as const;

export function toNumber(
  value: unknown,
  fallback: number = DEFAULT_VALUES.amount,
) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
