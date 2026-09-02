import { z } from "zod";
import {
  apiFailure,
  apiSuccess,
  requireApiUser,
} from "@/lib/api/server-auth";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(["admin"]);
  if (!auth.ok) return auth.response;

  const parsedId = z.string().uuid().safeParse((await params).id);
  if (!parsedId.success) return apiFailure("商品 ID 格式錯誤", 400);

  const { data, error } = await auth.supabase.rpc("delete_inventory_product", {
    p_product_id: parsedId.data,
  });
  if (error) {
    if (error.code === "PGRST202") {
      return apiFailure("商品刪除功能尚未安裝，請先執行最新 migration。", 503);
    }
    const message = error.message;
    if (message.includes("product has order history")) {
      return apiFailure("此商品已有訂單紀錄，不能永久刪除。", 409);
    }
    if (message.includes("product has packing history")) {
      return apiFailure("此商品已有包貨紀錄，不能永久刪除。", 409);
    }
    if (message.includes("product has settlement history")) {
      return apiFailure("此商品已有結算紀錄，不能永久刪除。", 409);
    }
    return apiFailure("商品刪除失敗", 400);
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
}
