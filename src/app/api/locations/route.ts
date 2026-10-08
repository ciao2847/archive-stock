import { storageActionSchema } from "@/lib/location-storage";
import { getSignedImageUrls } from "@/lib/product-images";
import { z } from "zod";

import { LOCATION_CODE_PATTERN } from "@/constants";
import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";

const locationSchema = z.object({
  code: z.string().regex(LOCATION_CODE_PATTERN),
  description: z.string().max(500).optional().default(""),
  ownerId: z.string().uuid(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = locationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return apiFailure("庫位資料格式不正確", 400);
  if (auth.role !== "admin" && parsed.data.ownerId !== auth.inventoryOwnerId) {
    return apiFailure("不可替其他使用者建立庫位", 403);
  }

  const code = parsed.data.code.toUpperCase();
  const [cabinet, shelf, bin] = code.split("-");
  const { data, error } = await auth.supabase
    .from("locations")
    .insert({
      owner_id: parsed.data.ownerId,
      code,
      cabinet,
      shelf: Number(shelf),
      bin: Number(bin),
      description: parsed.data.description.trim() || null,
    })
    .select("id,code")
    .single();

  if (error) {
    return apiFailure(
      error.code === "23505" ? "這個庫位已經存在" : error.message,
      error.code === "23505" ? 409 : 400,
      error.code,
    );
  }
  return apiSuccess(data, 201);
}

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const owner = z
    .string()
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("ownerId"));
  if (!owner.success) return apiFailure("請選擇庫藏", 400);
  if (auth.role !== "admin" && owner.data !== auth.inventoryOwnerId)
    return apiFailure("無法存取其他庫藏", 403);
  const db = auth.supabase as import("@supabase/supabase-js").SupabaseClient;
  const results = await Promise.all([
    db
      .from("storage_cabinets")
      .select("id,name,code,rows,columns")
      .eq("owner_id", owner.data)
      .order("created_at"),
    db
      .from("locations")
      .select("id,code,cabinet_id,display_name,shelf,bin")
      .eq("owner_id", owner.data)
      .order("shelf")
      .order("bin"),
    db
      .from("products")
      .select("id,name,country,price,stock,image_paths")
      .eq("owner_id", owner.data)
      .order("created_at", { ascending: false }),
    db
      .from("product_location_stocks")
      .select("product_id,location_id,quantity")
      .eq("owner_id", owner.data),
  ]);
  const error = results.find((result) => result.error)?.error;
  if (error)
    return apiFailure(
      "庫位管理尚未安裝或讀取失敗，請確認 cabinet_location_management 遷移已套用",
      503,
      error.code,
    );
  const products = results[2].data as Array<{
    id: string;
    name: string;
    country: string | null;
    price: number;
    stock: number;
    image_paths: string[] | null;
  }>;
  const allocations = results[3].data as Array<{
    product_id: string;
    location_id: string;
    quantity: number;
  }>;
  const urls = await getSignedImageUrls(
    auth.supabase,
    products.flatMap((p) => p.image_paths?.slice(0, 1) ?? []),
  ).catch(() => new Map<string, string>());
  return apiSuccess({
    cabinets: results[0].data,
    slots: results[1].data,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      country: p.country,
      price: Number(p.price),
      stock: p.stock,
      image: p.image_paths?.[0] ? urls.get(p.image_paths[0]) : undefined,
      allocations: allocations
        .filter((a) => a.product_id === p.id)
        .map((a) => ({ location_id: a.location_id, quantity: a.quantity })),
    })),
  });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  const owner = z.string().uuid().safeParse(body?.ownerId);
  const input = storageActionSchema.safeParse(body);
  if (!owner.success || !input.success)
    return apiFailure("請檢查名稱、格數與數量", 400);
  if (auth.role !== "admin" && owner.data !== auth.inventoryOwnerId)
    return apiFailure("無法修改其他庫藏", 403);
  const db = auth.supabase as import("@supabase/supabase-js").SupabaseClient;
  const { data, error } = await db.rpc("manage_location_storage", {
    p_owner_id: owner.data,
    p_action: input.data.action,
    p_input: input.data,
  });
  if (error)
    return apiFailure(
      storageErrors[error.message] ?? "庫位更新失敗，請重新載入後再試",
      409,
      error.code,
    );
  return apiSuccess(data);
}

const storageErrors: Record<string, string> = {
  "occupied slot": "格位仍有海報或歷史紀錄，請先搬移；有歷史紀錄的格位請保留",
  "quantity exceeds unassigned stock": "可放入數量已變更，請重新載入",
  "quantity exceeds source stock": "來源格位數量已變更，請重新載入",
  "owner access required": "無法存取其他庫藏",
  "invalid cabinet size": "櫃子格數需為 1 至 99 排、每排 1 至 99 格",
  "no cabinet code available": "櫃子數量已達上限",
};
