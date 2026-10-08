import { z } from "zod";

import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import {
  canAccessBundleClaimOwner,
  type BundleMenuSettings,
} from "@/lib/bundle-claims";
import { createServiceClient } from "@/utils/supabase/service";

const ownerSchema = z.string().uuid();
const updateSchema = z.object({ ownerId: ownerSchema, enabled: z.boolean() });

export async function GET(request: Request) {
  return withApiErrorHandling("GET /api/bundle-menu", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const owner = ownerSchema.safeParse(
      new URL(request.url).searchParams.get("ownerId"),
    );
    if (!owner.success) return apiFailure("庫藏格式錯誤", 400);
    if (
      !canAccessBundleClaimOwner(auth.role, auth.inventoryOwnerId, owner.data)
    )
      return apiFailure("權限不足", 403);
    const { data, error } = await createServiceClient()
      .from("inventory_databases")
      .select("bundle_menu_token,bundle_menu_enabled")
      .eq("id", owner.data)
      .maybeSingle();
    if (error)
      return apiFailure("共同選單尚未啟用，請確認資料庫更新已完成。", 503);
    if (!data) return apiFailure("找不到庫藏", 404);
    return apiSuccess<BundleMenuSettings>({
      token: data.bundle_menu_token,
      enabled: data.bundle_menu_enabled,
    });
  });
}

export async function PATCH(request: Request) {
  return withApiErrorHandling("PATCH /api/bundle-menu", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const parsed = updateSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return apiFailure("共同選單設定格式錯誤", 400);
    if (
      !canAccessBundleClaimOwner(
        auth.role,
        auth.inventoryOwnerId,
        parsed.data.ownerId,
      )
    )
      return apiFailure("權限不足", 403);
    const { data, error } = await createServiceClient()
      .from("inventory_databases")
      .update({ bundle_menu_enabled: parsed.data.enabled })
      .eq("id", parsed.data.ownerId)
      .select("bundle_menu_token,bundle_menu_enabled")
      .maybeSingle();
    if (error) return apiFailure("共同選單設定失敗，請稍後再試。", 400);
    if (!data) return apiFailure("找不到庫藏", 404);
    return apiSuccess<BundleMenuSettings>({
      token: data.bundle_menu_token,
      enabled: data.bundle_menu_enabled,
    });
  });
}
