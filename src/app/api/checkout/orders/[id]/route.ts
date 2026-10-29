import { z } from "zod";
import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import {
  stallOrderActionSchema,
  stallOrderEditSchema,
  stallOrderError,
} from "@/lib/stall-orders";

type Context = { params: Promise<{ id: string }> };
async function manage(
  request: Request,
  context: Context,
  action: "edit" | "cancel",
) {
  return withApiErrorHandling(`${action} stall order`, async () => {
    if (request.headers.get("sec-fetch-site") === "cross-site")
      return apiFailure("無法驗證操作來源", 403);
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const id = z
      .string()
      .uuid()
      .safeParse((await context.params).id);
    if (!id.success) return apiFailure("訂單編號格式錯誤", 400);
    const body = await request.json().catch(() => null);
    const parsed = (
      action === "edit" ? stallOrderEditSchema : stallOrderActionSchema
    ).safeParse(body);
    if (!parsed.success) return apiFailure("請確認商品件數、單價與備註", 400);
    if (auth.role !== "admin" && parsed.data.ownerId !== auth.inventoryOwnerId)
      return apiFailure("權限不足", 403);
    const edit = action === "edit" ? stallOrderEditSchema.parse(body) : null;
    const { data, error } = await auth.supabase.rpc("manage_stall_order", {
      p_owner_id: parsed.data.ownerId,
      p_order_id: id.data,
      p_expected_revision: parsed.data.revision,
      p_action: action,
      ...(edit
        ? {
            p_note: edit.note,
            p_items: edit.items.map((item) => ({
              product_id: item.productId,
              quantity: item.quantity,
              unit_price: item.unitPrice,
            })),
          }
        : {}),
    });
    if (error)
      return apiFailure(
        error.code === "PGRST202"
          ? "攤位訂單管理尚未就緒"
          : stallOrderError(error.message),
        error.code === "PGRST202"
          ? 503
          : error.message === "stall order not found"
            ? 404
            : 409,
      );
    return apiSuccess(data);
  });
}
export function PATCH(request: Request, context: Context) {
  return manage(request, context, "edit");
}
export function POST(request: Request, context: Context) {
  return manage(request, context, "cancel");
}
