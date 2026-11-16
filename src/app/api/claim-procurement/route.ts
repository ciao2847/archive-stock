import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  requireApiUser,
  apiSuccess,
  apiFailure,
  withApiErrorHandling,
} from "@/lib/api/server-auth";

const scope = {
  ownerId: z.string().uuid(),
  formId: z.coerce.number().int().positive(),
};
const querySchema = z.object({
  ...scope,
  roundId: z.string().uuid().optional(),
  historyPage: z.coerce.number().int().min(1).max(10000).default(1),
});
const closeSchema = z.object({
  ownerId: scope.ownerId,
  formId: z.number().int().positive(),
  roundId: z.string().uuid(),
  requestId: z.string().uuid(),
});
function rpcFailure(error: { code?: string; message: string }) {
  if (["PGRST202", "42P01", "PGRST205"].includes(error.code || ""))
    return apiFailure(
      "本次結單功能尚未安裝，請先套用最新的結單 migration。",
      503,
      error.code,
    );
  const status =
    error.code === "42501"
      ? 403
      : error.code === "P0002"
        ? 404
        : error.code === "22023" ||
            /已結單|已更新|過期|stale/i.test(error.message)
          ? 409
          : 400;
  return apiFailure(error.message, status, error.code);
}
export async function GET(request: Request) {
  return withApiErrorHandling("GET /api/claim-procurement", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const input = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!input.success) return apiFailure("請確認庫藏、表單與結單批次。", 400);
    if (auth.role !== "admin" && input.data.ownerId !== auth.inventoryOwnerId)
      return apiFailure("不可查看其他庫藏的結單。", 403);
    const { ownerId, formId, roundId, historyPage } = input.data;
    const { data, error } = await (auth.supabase as SupabaseClient).rpc(
      "get_claim_procurement",
      {
        p_owner_id: ownerId,
        p_form_id: formId,
        p_round_id: roundId ?? null,
        p_history_page: historyPage,
      },
    );
    if (error) return rpcFailure(error);
    return apiSuccess(data);
  });
}
export async function POST(request: Request) {
  return withApiErrorHandling("POST /api/claim-procurement", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return apiFailure("請從本站操作結單。", 403);
    const input = closeSchema.safeParse(await request.json().catch(() => null));
    if (!input.success)
      return apiFailure("結單資料格式不正確，請重新載入。", 400);
    if (auth.role !== "admin" && input.data.ownerId !== auth.inventoryOwnerId)
      return apiFailure("不可替其他庫藏結單。", 403);
    const { ownerId, formId, roundId, requestId } = input.data;
    const { data, error } = await (auth.supabase as SupabaseClient).rpc(
      "close_claim_procurement",
      {
        p_owner_id: ownerId,
        p_form_id: formId,
        p_round_id: roundId,
        p_request_id: requestId,
      },
    );
    if (error) return rpcFailure(error);
    return apiSuccess(data);
  });
}
