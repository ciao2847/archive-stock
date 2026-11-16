import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import {
  apiFailure,
  apiSuccess,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import { publicFanmadePageSchema } from "@/lib/fanmade/validation";
import { fanmadeMediaUrl } from "@/lib/fanmade/media";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return withApiErrorHandling("GET public fanmade page", async () => {
    const token = z
      .string()
      .uuid()
      .safeParse((await params).token);
    const input = publicFanmadePageSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!token.success || !input.success)
      return apiFailure("查詢格式錯誤", 400);
    const { data, error } = await (
      (await createClient()) as SupabaseClient
    ).rpc("get_fanmade_page", {
      p_token: token.data,
      p_ip: input.data.ip,
      p_page: input.data.page,
      p_query: input.data.query,
    });
    if (error) return apiFailure("商品讀取失敗，請稍後重試", 503);
    if (!data) return apiFailure("找不到訂購頁", 404);
    return apiSuccess({
      ...data,
      products: data.products.map((p: Record<string, unknown>) => ({
        ...p,
        isEnabled: Number(p.maxQuantity) > 0,
        crafts: [p.craft],
        publishedAt: "",
        imageUrl: fanmadeMediaUrl("product-images", p.thumbnailPath as string),
        videoPosterUrl: fanmadeMediaUrl(
          "fanmade-video-playback",
          p.posterPath as string,
        ),
      })),
    });
  });
}
