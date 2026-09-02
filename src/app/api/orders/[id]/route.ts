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
  if (!parsedId.success) return apiFailure("訂單 ID 格式錯誤", 400);

  const { data, error } = await auth.supabase.rpc("archive_order", {
    p_order_id: parsedId.data,
  });
  if (error) {
    if (error.code === "PGRST202") {
      return apiFailure("封存訂單功能尚未安裝，請先執行最新 migration。", 503);
    }
    return apiFailure("封存訂單失敗", 400);
  }

  return apiSuccess({ archived: Boolean(data) });
}
