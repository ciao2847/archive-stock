import type { Product, Status } from "@/lib/types";

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null;

const asString = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const asStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;

const statusLabels: Record<string, Status> = {
  in_stock: "在庫",
  active: "在庫",
  reserved: "已預留",
  packing: "待出貨",
  packed: "售罄",
  shipped: "已出貨",
};

function resolveImage(raw: RecordValue, fallback: string) {
  const direct = raw.image ?? raw.image_url;
  if (typeof direct === "string" && direct) return direct;

  const images = Array.isArray(raw.images) ? raw.images : [];
  const cover = images.find(
    (image): image is RecordValue =>
      isRecord(image) &&
      image.isCover === true &&
      typeof image.url === "string",
  );
  if (cover) return cover.url as string;
  const first = images.find(
    (image): image is RecordValue =>
      isRecord(image) && typeof image.url === "string",
  );
  return first ? (first.url as string) : fallback;
}

function resolveStatus(value: unknown): Status {
  if (typeof value !== "string") return "在庫";
  if (
    value === "在庫" ||
    value === "已預留" ||
    value === "待出貨" ||
    value === "售罄" ||
    value === "已出貨"
  ) {
    return value;
  }
  return statusLabels[value] || "在庫";
}

/** 將原始商品 API 資料正規化為 UI 可直接使用的模型。 */
export const adaptProduct = (raw: unknown): Product => {
  const fallbackImage = `${process.env.BASE_PATH || ""}/images/not-found/miss.jpg`;
  const data = isRecord(raw) ? raw : {};
  const image = resolveImage(data, fallbackImage);
  const id = asString(data.id ?? data.sku);

  return {
    id,
    dbId: typeof data.dbId === "string" ? data.dbId : undefined,
    name: asString(data.name ?? data.title, "未命名商品"),
    ownerName: asString(data.ownerName, "未命名使用者"),
    ownerId: asString(data.ownerId ?? data.owner_id),
    work: asString(data.work ?? data.series, "未指定作品"),
    category: asString(data.category),
    country: asString(data.country, "—"),
    source: asString(data.source, "—"),
    format: asString(data.format || data.poster_format) || undefined,
    size: asString(data.size || data.poster_size) || undefined,
    crafts: asStringArray(data.crafts ?? data.poster_crafts),
    location: asString(data.location, "未指定"),
    stock: asNumber(data.stock),
    status: resolveStatus(data.status),
    price: asNumber(data.price),
    cost: asNumber(data.cost),
    feature: asString(data.feature ?? data.identifying_features) || undefined,
    description: asString(data.description) || undefined,
    accent: asString(data.accent, "#5A87B1"),
    image,
    thumbnail: asString(data.thumbnail) || image,
  };
};

/** 將商品列表資料整批轉換。 */
export const adaptProducts = (list: unknown): Product[] => {
  if (!Array.isArray(list)) return [];
  return list.map(adaptProduct);
};
