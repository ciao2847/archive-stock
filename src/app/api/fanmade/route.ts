import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  requireApiUser,
  apiFailure,
  apiSuccess,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import { fanmadeActionSchema } from "@/lib/fanmade/validation";
const ownerSchema = z.string().uuid();
const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  query: z.string().max(100).default(""),
  formId: z.coerce.number().int().positive().optional(),
});
export async function GET(request: Request) {
  return withApiErrorHandling("GET /api/fanmade", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const owner = ownerSchema.safeParse(params.ownerId),
      input = querySchema.safeParse(params);
    if (!owner.success || !input.success)
      return apiFailure("請確認庫藏與查詢條件", 400);
    if (auth.role !== "admin" && owner.data !== auth.inventoryOwnerId)
      return apiFailure("不可存取其他庫藏", 403);
    const { data, error } = await (auth.supabase as SupabaseClient).rpc(
      "get_fanmade_catalog",
      {
        p_owner_id: owner.data,
        p_page: input.data.page,
        p_query: input.data.query,
        p_form_id: input.data.formId ?? null,
      },
    );
    if (error)
      return apiFailure(
        error.code === "PGRST202"
          ? "請先套用飯製商品群組 migration"
          : error.message,
        error.code === "PGRST202" ? 503 : 400,
      );
    return apiSuccess(data);
  });
}
export async function POST(request: Request) {
  return withApiErrorHandling("POST /api/fanmade", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return apiFailure("請從本站操作", 403);
    const body = await request.json().catch(() => null);
    const owner = ownerSchema.safeParse(body?.ownerId),
      input = fanmadeActionSchema.safeParse(body);
    if (!owner.success || !input.success)
      return apiFailure(
        input.success
          ? "庫藏格式錯誤"
          : input.error.issues[0]?.message || "資料格式錯誤",
        400,
      );
    if (auth.role !== "admin" && owner.data !== auth.inventoryOwnerId)
      return apiFailure("不可修改其他庫藏", 403);
    const { action, ...payload } = input.data;
    const { data, error } = await (auth.supabase as SupabaseClient).rpc(
      "manage_fanmade",
      { p_owner_id: owner.data, p_action: action, p_input: payload },
    );
    if (error)
      return apiFailure(
        error.code === "PGRST202"
          ? "商品多工藝分組尚未安裝，請先套用最新的 fanmade_catalog_groups migration"
          : error.message,
        error.code === "PGRST202" ? 503 : error.code === "22023" ? 409 : 400,
      );
    return apiSuccess(data);
  });
}
