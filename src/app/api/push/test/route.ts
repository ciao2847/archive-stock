import type { SupabaseClient } from "@supabase/supabase-js";
import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import { endpointSchema, sameOrigin } from "@/lib/push/validation";
import { sendPush, pushErrorStatus } from "@/lib/push/server";
export async function POST(request: Request) {
  return withApiErrorHandling("POST push test", async () => {
    if (!sameOrigin(request)) return apiFailure("無法驗證請求來源", 403);
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const parsed = endpointSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return apiFailure("請先開啟這台手機的通知", 400);
    const db = auth.supabase as unknown as SupabaseClient;
    const { data, error } = await db
      .from("web_push_subscriptions")
      .select("endpoint,p256dh,auth_key")
      .eq("user_id", auth.userId)
      .eq("endpoint", parsed.data.endpoint)
      .maybeSingle();
    if (error || !data) return apiFailure("請先開啟這台手機的通知", 404);
    try {
      await sendPush(data, {
        title: "庫藏｜手機通知已連線",
        body: "這是一則測試通知。客人訂購或確認配單後，您會在這裡收到提醒。",
        url: "/settings",
        tag: "archive-push-test",
      });
      return apiSuccess({ sent: true });
    } catch (error) {
      const status = pushErrorStatus(error);
      if (status === 404 || status === 410)
        await db
          .from("web_push_subscriptions")
          .delete()
          .eq("endpoint", data.endpoint)
          .eq("user_id", auth.userId);
      return apiFailure(
        "測試通知未送出，請確認手機通知權限，或關閉通知後重新開啟",
        502,
      );
    }
  });
}
