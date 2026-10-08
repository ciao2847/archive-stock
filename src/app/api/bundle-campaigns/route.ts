import { z } from "zod";
import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import { asUntypedSupabase } from "@/lib/api/bundle-claims-server";
import {
  bundleClaimCampaignSchema,
  canAccessBundleClaimOwner,
  type BundleClaimCampaign,
} from "@/lib/bundle-claims";

const updateSchema = bundleClaimCampaignSchema
  .partial()
  .extend({ id: z.number().int().positive(), ownerId: z.string().uuid() });
const selectFields =
  "id,owner_id,title,description,public_token,enabled,created_at,updated_at";
function mapCampaign(row: Record<string, unknown>): BundleClaimCampaign {
  const counts = row.bundle_claim_orders as { count: number }[] | undefined;
  return {
    id: Number(row.id),
    ownerId: String(row.owner_id),
    title: String(row.title),
    description: String(row.description ?? ""),
    publicToken: String(row.public_token),
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(counts ? { orderCount: counts[0]?.count ?? 0 } : {}),
  };
}

export async function GET(request: Request) {
  return withApiErrorHandling("GET /api/bundle-campaigns", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const owner = z
      .string()
      .uuid()
      .safeParse(new URL(request.url).searchParams.get("ownerId"));
    if (!owner.success) return apiFailure("庫藏格式錯誤", 400);
    if (
      !canAccessBundleClaimOwner(auth.role, auth.inventoryOwnerId, owner.data)
    )
      return apiFailure("權限不足", 403);
    const { data, error } = await asUntypedSupabase(auth.supabase)
      .from("bundle_claim_campaigns")
      .select(`${selectFields},bundle_claim_orders(count)`)
      .eq("owner_id", owner.data)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error)
      return apiFailure("讀取活動列表失敗，請確認資料庫更新已完成", 503);
    return apiSuccess({
      campaigns: (data ?? []).map((row) =>
        mapCampaign(row as unknown as Record<string, unknown>),
      ),
    });
  });
}

async function save(request: Request, create: boolean) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const parsed = (
    create ? bundleClaimCampaignSchema.omit({ id: true }) : updateSchema
  ).safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return apiFailure(
      parsed.error.issues[0]?.message ?? "活動資料格式錯誤",
      400,
    );
  const input = parsed.data;
  if (
    !canAccessBundleClaimOwner(auth.role, auth.inventoryOwnerId, input.ownerId)
  )
    return apiFailure("權限不足", 403);
  const { data, error } = await asUntypedSupabase(auth.supabase).rpc(
    "save_bundle_claim_campaign",
    {
      p_owner_id: input.ownerId,
      p_campaign_id: "id" in input ? input.id : null,
      p_title: input.title ?? null,
      p_description: input.description ?? null,
      p_enabled: input.enabled ?? null,
    },
  );
  if (error)
    return apiFailure(
      error.message === "bundle campaign not found"
        ? "找不到活動"
        : "儲存活動失敗",
      400,
      error.code,
    );
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return apiFailure("找不到活動", 404);
  return apiSuccess({ campaign: mapCampaign(row) }, create ? 201 : 200);
}
export async function POST(request: Request) {
  return withApiErrorHandling("POST /api/bundle-campaigns", () =>
    save(request, true),
  );
}
export async function PATCH(request: Request) {
  return withApiErrorHandling("PATCH /api/bundle-campaigns", () =>
    save(request, false),
  );
}
