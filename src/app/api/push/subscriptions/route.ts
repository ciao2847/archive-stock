import type { SupabaseClient } from "@supabase/supabase-js";
import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import { pushConfiguration } from "@/lib/push/server";
import {
  canReceiveInventory,
  endpointSchema,
  sameOrigin,
  subscriptionSchema,
} from "@/lib/push/validation";

export async function GET() {
  return withApiErrorHandling("GET push subscriptions", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const db = auth.supabase as unknown as SupabaseClient;
    const { data, error } = await db
      .from("web_push_subscriptions")
      .select("id,endpoint,inventory_ids")
      .eq("user_id", auth.userId);
    if (error) return apiFailure("通知設定尚未就緒，請稍後再試", 503);
    const config = pushConfiguration();
    return apiSuccess({
      configured: Boolean(config),
      publicKey: config?.publicKey || null,
      subscriptions: data || [],
    });
  });
}
export async function POST(request: Request) {
  return withApiErrorHandling("POST push subscription", async () => {
    if (!sameOrigin(request)) return apiFailure("無法驗證請求來源", 403);
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    if (!pushConfiguration()) return apiFailure("手機通知尚未設定完成", 503);
    const parsed = subscriptionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return apiFailure("通知訂閱資料不正確", 400);
    const input = parsed.data;
    if (
      !canReceiveInventory(auth.role, auth.inventoryOwnerId, input.inventoryIds)
    )
      return apiFailure("只能訂閱自己所屬庫藏", 403);
    const db = auth.supabase as unknown as SupabaseClient;
    const { data, error } = await db
      .from("web_push_subscriptions")
      .upsert(
        {
          user_id: auth.userId,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth_key: input.keys.auth,
          inventory_ids: input.inventoryIds,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      )
      .select("id")
      .single();
    if (error)
      return apiFailure(
        "通知無法儲存；若此手機曾用其他帳號開啟通知，請先關閉通知再重試",
        409,
      );
    return apiSuccess({ id: data.id });
  });
}
export async function DELETE(request: Request) {
  return withApiErrorHandling("DELETE push subscription", async () => {
    if (!sameOrigin(request)) return apiFailure("無法驗證請求來源", 403);
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const parsed = endpointSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return apiFailure("通知訂閱資料不正確", 400);
    const db = auth.supabase as unknown as SupabaseClient;
    const { error } = await db
      .from("web_push_subscriptions")
      .delete()
      .eq("endpoint", parsed.data.endpoint)
      .eq("user_id", auth.userId);
    if (error) return apiFailure("關閉通知失敗，請稍後再試", 400);
    return apiSuccess({ deleted: true });
  });
}
