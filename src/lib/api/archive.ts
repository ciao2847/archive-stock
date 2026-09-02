import {
  FINANCIAL_ORDER_STATUSES,
  PRODUCT_STATUS_LABELS,
} from "@/constants";
import { DEFAULT_VALUES, toNumber } from "@/constants";
import { getSignedImageUrls } from "@/lib/product-images";
import type { AccountData, Product } from "@/lib/types";
import { archiveOrder } from "@/lib/api/orders";
import { createClient } from "@/utils/supabase/client";

type WorkRow = {
  title_zh: string | null;
};

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  country: string | null;
  source: string | null;
  stock: number;
  status: string;
  price: number | string | null;
  image_paths: string[] | null;
  poster_format: string | null;
  poster_size: string | null;
  poster_crafts: string[] | null;
  identifying_features: string | null;
  works: WorkRow | WorkRow[] | null;
  locations: { code: string | null } | { code: string | null }[] | null;
};

export type OrderItemRow = {
  quantity: number;
  scanned_quantity: number;
  products: { sku: string | null } | { sku: string | null }[] | null;
};

export type OrderRow = {
  id: string;
  order_no: string;
  payment_status: string;
  status: string;
  created_at: string;
  customers:
    | { name: string | null; nickname: string | null }
    | { name: string | null; nickname: string | null }[]
    | null;
  order_items: OrderItemRow[] | null;
};

const firstRelation = <T>(relation: T | T[] | null): T | null =>
  Array.isArray(relation) ? relation[0] ?? null : relation;

const getWorkTitle = (work: WorkRow | null) =>
  work?.title_zh || "未指定作品";

export async function fetchProductsApi(): Promise<Product[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id,sku,name,category,country,source,stock,status,price,image_paths,poster_format,poster_size,poster_crafts,identifying_features,works(title_zh),locations(code)",
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!data) throw new Error("商品資料沒有正確回傳，請重新整理後再試。");

  const rows = data as unknown as ProductRow[];
  const imagePaths = rows.flatMap((row) =>
    Array.isArray(row.image_paths) ? row.image_paths.slice(0, 2) : [],
  );
  const [{ data: costRows }, signedUrls] = await Promise.all([
    supabase.rpc("get_admin_product_costs"),
    getSignedImageUrls(supabase, imagePaths).catch(
      () => new Map<string, string>(),
    ),
  ]);
  const costMap = new Map<string, number>(
    costRows?.map((row: { product_id: string; cost: unknown }) => [
      String(row.product_id),
      toNumber(row.cost),
    ]) ?? [],
  );

  return rows.map((row) => {
    const imagePath = row.image_paths?.[0];
    const thumbnailPath = row.image_paths?.[1] || imagePath;
    const image = imagePath ? signedUrls.get(imagePath) : undefined;
    const thumbnail = thumbnailPath
      ? signedUrls.get(thumbnailPath) || image
      : image;

    return {
      id: row.sku,
      dbId: row.id,
      name: row.name,
      work: getWorkTitle(firstRelation(row.works)),
      category: row.category,
      country: row.country || "—",
      source: row.source || "—",
      format: row.poster_format || undefined,
      size: row.poster_size || undefined,
      crafts: row.poster_crafts ?? undefined,
      location: firstRelation(row.locations)?.code || "未指定",
      stock: row.stock,
      status: PRODUCT_STATUS_LABELS[row.status] || "在庫",
      price: toNumber(row.price),
      cost: costMap.get(row.id) ?? DEFAULT_VALUES.amount,
      feature: row.identifying_features || undefined,
      accent: "#5A87B1",
      image,
      thumbnail,
    };
  });
}

export async function fetchOrdersApi(): Promise<OrderRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id,order_no,payment_status,status,created_at,customers(name,nickname),order_items(quantity,scanned_quantity,products(sku))",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!data) throw new Error("訂單資料沒有正確回傳，請重新整理後再試。");

  return data as unknown as OrderRow[];
}

export async function fetchAccountApi(): Promise<AccountData> {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!user) {
    return { userName: "使用者", isAdmin: false, finance: null };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name,role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);

  const userName =
    profile?.display_name?.trim() || user.email?.split("@")[0] || "使用者";
  const isAdmin = profile?.role === "admin";
  if (!isAdmin) return { userName, isAdmin, finance: null };

  const [
    { data: costRows, error: costError },
    { data: salesRows, error: salesError },
  ] = await Promise.all([
    supabase.rpc("get_admin_product_costs"),
    supabase
      .from("orders")
      .select(
        "status,discount,shipping_income,platform_fee,seller_shipping_cost,order_items(quantity,unit_price)",
      ),
  ]);

  if (costError || salesError) {
    throw new Error(
      costError?.message || salesError?.message || "財務資料載入失敗",
    );
  }

  const cost = (costRows ?? []).reduce(
    (sum: number, row: { cost: unknown }) => sum + toNumber(row.cost),
    0,
  );
  const rows = (salesRows ?? []) as unknown as Array<{
    status: string;
    discount: unknown;
    shipping_income: unknown;
    platform_fee: unknown;
    seller_shipping_cost: unknown;
    order_items: Array<{ quantity: number; unit_price: unknown }> | null;
  }>;
  if (rows.some((row) => !Array.isArray(row.order_items))) {
    throw new Error("部分訂單缺少商品明細，財務資料無法計算。");
  }

  const revenue = rows
    .filter((row) => FINANCIAL_ORDER_STATUSES.has(row.status))
    .reduce((sum, row) => {
      const itemTotal = (row.order_items ?? []).reduce(
        (itemSum, item) =>
          itemSum + toNumber(item.unit_price) * item.quantity,
        0,
      );
      return (
        sum +
        itemTotal +
        toNumber(row.shipping_income) -
        toNumber(row.discount) -
        toNumber(row.platform_fee) -
        toNumber(row.seller_shipping_cost)
      );
    }, 0);

  return {
    userName,
    isAdmin,
    finance: { revenue, cost, profit: revenue - cost },
  };
}

export async function archiveOrderApi(orderId: string): Promise<void> {
  await archiveOrder(orderId);
}
