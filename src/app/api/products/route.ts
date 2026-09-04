import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";
import { createProductSchema } from "@/lib/validation/products";
import { DEFAULT_VALUES, PRODUCT_STATUS_LABELS, toNumber } from "@/constants";
import { getSignedImageUrls } from "@/lib/product-images";
import type { Product } from "@/lib/types";

type ProductRow = {
  id: string;
  owner_id: string;
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
  owner:
    | { display_name: string | null }
    | { display_name: string | null }[]
    | null;
  works: { title_zh: string | null } | { title_zh: string | null }[] | null;
  locations: { code: string | null } | { code: string | null }[] | null;
};

const firstRelation = <T>(relation: T | T[] | null): T | null =>
  Array.isArray(relation) ? (relation[0] ?? null) : relation;

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("products")
    .select(
      "id,owner_id,sku,name,category,country,source,stock,status,price,image_paths,poster_format,poster_size,poster_crafts,identifying_features,works(title_zh),locations(code),owner:profiles!products_owner_id_fkey(display_name)",
    )
    .order("created_at", { ascending: false });
  if (error) return apiFailure(error.message, 400, error.code);

  const rows = (data ?? []) as unknown as ProductRow[];
  const imagePaths = rows.flatMap((row) => row.image_paths?.slice(0, 2) ?? []);
  const [{ data: costRows }, signedUrls] = await Promise.all([
    auth.role === "admin"
      ? auth.supabase.rpc("get_admin_product_costs")
      : Promise.resolve({ data: null }),
    getSignedImageUrls(auth.supabase, imagePaths).catch(
      () => new Map<string, string>(),
    ),
  ]);
  const costMap = new Map<string, number>(
    costRows?.map((row: { product_id: string; cost: unknown }) => [
      String(row.product_id),
      toNumber(row.cost),
    ]) ?? [],
  );

  const products: Product[] = rows.map((row) => {
    const imagePath = row.image_paths?.[0];
    const thumbnailPath = row.image_paths?.[1] || imagePath;
    const image = imagePath ? signedUrls.get(imagePath) : undefined;
    return {
      id: row.sku,
      dbId: row.id,
      name: row.name,
      ownerId: row.owner_id,
      ownerName: firstRelation(row.owner)?.display_name || "未命名使用者",
      work: firstRelation(row.works)?.title_zh || "未指定作品",
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
      thumbnail: thumbnailPath ? signedUrls.get(thumbnailPath) || image : image,
    };
  });
  return apiSuccess(products);
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = createProductSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return apiFailure("商品資料格式不正確", 400);
  if (parsed.data.cost > 0 && auth.role !== "admin") {
    return apiFailure("只有管理員可以設定商品成本", 403);
  }

  const input = parsed.data;
  const { data, error } = await auth.supabase.rpc("create_inventory_product", {
    p_name: input.name,
    p_work: input.work,
    p_category: input.category,
    p_country: input.country,
    p_source: input.source,
    p_location: input.location,
    p_stock: input.stock,
    p_price: input.price,
    p_cost: input.cost,
    p_image_paths: input.imagePaths,
    p_poster_format: input.format,
    p_poster_size: input.size,
    p_poster_crafts: input.crafts,
    p_identifying_features: input.feature,
  });
  if (error) return apiFailure(error.message, 400, error.code);
  return apiSuccess({ productId: String(data) }, 201);
}
