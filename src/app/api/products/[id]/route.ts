import { z } from "zod";
import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import { updateProductSchema } from "@/lib/validation/products";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiErrorHandling("PATCH /api/products", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const parsedId = z
      .string()
      .uuid()
      .safeParse((await params).id);
    if (!parsedId.success) return apiFailure("商品 ID 格式錯誤", 400);
    const parsed = updateProductSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return apiFailure("商品資料格式不正確", 400);

    const input = parsed.data;
    if (input.preorderItemName !== undefined) {
      const { data, error } = await auth.supabase.rpc(
        "save_named_inventory_product",
        {
          p_product_id: parsedId.data,
          p_input: input,
        },
      );
      if (error) return apiFailure(error.message, 400, error.code);
      if (data !== parsedId.data)
        return apiFailure("商品未更新，請重新整理後再試", 409);
      return apiSuccess({ updated: true });
    }
    const { data, error } = await auth.supabase.rpc(
      "update_inventory_product",
      {
        p_product_id: parsedId.data,
        p_name: input.name,
        p_category: input.category,
        p_country: input.country,
        p_source: input.source,
        p_location: input.location,
        p_stock: input.stock,
        p_price: input.price,
        // Keep archived legacy costs untouched; new accounting ignores them.
        p_cost: null as unknown as number,
        p_poster_format: input.format,
        p_poster_size: input.size,
        p_description: input.description,
        p_identifying_features: input.feature,
        p_work: input.work,
        p_poster_crafts: input.crafts,
        p_image_paths: input.imagePaths,
      },
    );
    if (error) return apiFailure(error.message, 400, error.code);
    if (data !== true) return apiFailure("商品未更新，請重新整理後再試", 409);
    return apiSuccess({ updated: true });
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiErrorHandling("DELETE /api/products", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const parsedId = z
      .string()
      .uuid()
      .safeParse((await params).id);
    if (!parsedId.success) return apiFailure("商品 ID 格式錯誤", 400);

    const { data, error } = await auth.supabase.rpc(
      "delete_inventory_product",
      {
        p_product_id: parsedId.data,
      },
    );
    if (error) {
      if (error.code === "PGRST202") {
        return apiFailure(
          "商品刪除功能尚未安裝，請先執行最新 migration。",
          503,
        );
      }
      if (error.message === "product not found")
        return apiFailure("商品不存在或不屬於目前庫藏", 404);
      if (error.code === "42501")
        return apiFailure("目前帳號沒有此庫藏的商品刪除權限", 403);
      return apiFailure("商品刪除失敗，請重新整理後再試", 400);
    }

    const imagePaths = Array.isArray(data)
      ? data.filter((path): path is string => typeof path === "string")
      : [];
    let imageCleanupWarning: string | undefined;
    if (imagePaths.length) {
      const { error: storageError } = await auth.supabase.storage
        .from("product-images")
        .remove(imagePaths);
      if (storageError) imageCleanupWarning = "商品已刪除，但原圖片清除失敗。";
    }

    return apiSuccess({ deleted: true, imageCleanupWarning });
  });
}
