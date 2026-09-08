import type { Product } from "@/lib/types";

/** 將原始商品 API 資料正規化為 UI 可直接使用的模型 */
export const adaptProduct = (raw: any): Product => {
  if (!raw) return {} as Product;

  const fallbackImage = `${process.env.BASE_PATH || ""}/images/not-found/miss.jpg`;
  const resolvedCover =
    raw.image_url ||
    raw.images?.find((img: any) => img?.isCover)?.url ||
    raw.images?.[0]?.url ||
    fallbackImage;

  return {
    id: raw.id || "",
    sku: raw.sku || "",
    name: raw.name || raw.title || "未命名商品",
    series: raw.series || "",
    brand: raw.brand || "",
    price: typeof raw.price === "number" ? raw.price : Number(raw.price) || 0,
    cost: typeof raw.cost === "number" ? raw.cost : Number(raw.cost) || 0,
    stock: typeof raw.stock === "number" ? raw.stock : Number(raw.stock) || 0,
    location_id: raw.location_id || null,
    owner_id: raw.owner_id || "",
    status: raw.status || "active",
    created_at: raw.created_at || new Date().toISOString(),
    description: raw.description || "",
    image_url: resolvedCover,
    location: raw.location ?? null,
  };
};

/** 將商品列表資料整批轉換 */
export const adaptProducts = (list: any[]): Product[] => {
  if (!Array.isArray(list)) return [];
  return list.map(adaptProduct);
};
