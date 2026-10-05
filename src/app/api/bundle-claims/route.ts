import { z } from "zod";

import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import {
  asUntypedSupabase,
  BUNDLE_CLAIM_ORDER_SELECT,
  createBundleClaimSignedUrlMap,
  mapBundleClaimOrder,
} from "@/lib/api/bundle-claims-server";
import {
  bundleClaimDraftSchema,
  bundleClaimQuerySchema,
  canAccessBundleClaimOwner,
  type BundleClaimFilter,
  type BundleClaimOrder,
} from "@/lib/bundle-claims";
import { createServiceClient } from "@/utils/supabase/service";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open"),
    ownerId: z.string().uuid(),
    orderId: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("revoke"),
    ownerId: z.string().uuid(),
    orderId: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("record_payment"),
    ownerId: z.string().uuid(),
    orderId: z.number().int().positive(),
    transferredAt: z.string().datetime({ offset: true }),
    payerAccountLastFive: z
      .union([z.literal(""), z.string().regex(/^\d{5}$/)])
      .default(""),
    note: z.string().trim().max(1000).default(""),
  }),
  z.object({
    action: z.literal("reverse_payment"),
    ownerId: z.string().uuid(),
    orderId: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("set_receiving"),
    ownerId: z.string().uuid(),
    orderId: z.number().int().positive(),
    checked: z.boolean(),
  }),
  z.object({
    action: z.literal("set_outbound"),
    ownerId: z.string().uuid(),
    orderId: z.number().int().positive(),
    checked: z.boolean(),
  }),
  z.object({
    action: z.literal("reorder_images"),
    ownerId: z.string().uuid(),
    orderId: z.number().int().positive(),
    imageIds: z.array(z.number().int().positive()).max(10),
  }),
]);

const deleteSchema = z.object({
  ownerId: z.string().uuid(),
  orderId: z.number().int().positive(),
});

function matchesFilter(order: BundleClaimOrder, filter: BundleClaimFilter) {
  if (filter === "all") return true;
  if (filter === "draft" || filter === "open") return order.status === filter;
  if (filter === "confirmed_unpaid") {
    return order.status === "confirmed" && !order.payment;
  }
  if (filter === "confirmed_paid") {
    return order.status === "confirmed" && Boolean(order.payment);
  }
  if (filter === "receiving_pending") {
    return order.status === "confirmed" && !order.receivingCheckedAt;
  }
  if (filter === "outbound_pending") {
    return (
      order.status === "confirmed" &&
      Boolean(order.receivingCheckedAt) &&
      !order.outboundCheckedAt
    );
  }
  if (filter === "complete") {
    return (
      order.status === "confirmed" &&
      Boolean(order.payment) &&
      Boolean(order.receivingCheckedAt) &&
      Boolean(order.outboundCheckedAt)
    );
  }
  return order.status === "cancelled" || order.status === "expired";
}

function matchesSearch(order: BundleClaimOrder, search: string) {
  const normalized = search.trim().toLocaleLowerCase("zh-TW");
  if (!normalized) return true;
  return [
    order.title,
    order.description,
    order.confirmationCode,
    order.customerHint,
    order.customerNickname,
    order.customerPhone,
    order.customerNotes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("zh-TW")
    .includes(normalized);
}

function mutationError(error: { message: string; code?: string }) {
  const known: Record<string, string> = {
    "bundle claim draft not found": "找不到可編輯的草稿",
    "bundle claim cannot be opened": "請先加入至少一張截圖並確認尚未過期",
    "bundle claim cannot be revoked": "只有等待確認中的連結可以撤銷",
    "bundle claim confirmation not found": "找不到已確認的訂單",
    "bundle claim requires full payment": "單張大禮包僅能登記全額付款",
    "bundle claim is already paid": "這筆訂單已經完成付款",
    "bundle claim payment not found": "這筆訂單尚未登記付款",
    "bundle claim outbound check is not available":
      "請先完成入庫核對，再進行出貨核對",
    "invalid bundle claim image order": "截圖排序資料已變更，請重新整理",
  };
  return apiFailure(known[error.message] ?? error.message, 400, error.code);
}

export async function GET(request: Request) {
  return withApiErrorHandling("GET /api/bundle-claims", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const parsed = bundleClaimQuerySchema.safeParse({
      ownerId: url.searchParams.get("ownerId"),
      orderId: url.searchParams.get("orderId") || undefined,
      search: url.searchParams.get("search") || "",
      filter: url.searchParams.get("filter") || "all",
    });
    if (!parsed.success) return apiFailure("查詢條件格式錯誤", 400);
    if (
      !canAccessBundleClaimOwner(
        auth.role,
        auth.inventoryOwnerId,
        parsed.data.ownerId,
      )
    ) {
      return apiFailure("無法查看這個庫藏的單張大禮包喊單", 403);
    }

    const supabase = asUntypedSupabase(auth.supabase);
    let query = supabase
      .from("bundle_claim_orders")
      .select(BUNDLE_CLAIM_ORDER_SELECT)
      .eq("owner_id", parsed.data.ownerId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(500);
    if (parsed.data.orderId) query = query.eq("id", parsed.data.orderId);

    const { data, error } = await query;
    if (error) {
      if (error.code === "42P01") {
        return apiFailure("單張大禮包喊單功能尚未啟用", 503);
      }
      return apiFailure(error.message, 400, error.code);
    }

    const signedUrls = await createBundleClaimSignedUrlMap(
      supabase,
      data ?? [],
    );
    const mapped = (data ?? []).map((row) =>
      mapBundleClaimOrder(row, signedUrls),
    );
    const orders = mapped.filter(
      (order) =>
        matchesFilter(order, parsed.data.filter) &&
        matchesSearch(order, parsed.data.search),
    );

    return apiSuccess({
      orders,
      selectedOrder: parsed.data.orderId ? orders[0] : undefined,
      total: orders.length,
    });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling("POST /api/bundle-claims", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const parsed = bundleClaimDraftSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return apiFailure(
        parsed.error.issues[0]?.message || "請確認草稿內容",
        400,
      );
    }
    const input = parsed.data;
    if (
      !canAccessBundleClaimOwner(
        auth.role,
        auth.inventoryOwnerId,
        input.ownerId,
      )
    ) {
      return apiFailure("無法在這個庫藏新增喊單", 403);
    }

    const { data, error } = await asUntypedSupabase(auth.supabase).rpc(
      "create_bundle_claim_order",
      {
        p_owner_id: input.ownerId,
        p_title: input.title,
        p_description: input.description,
        p_total_amount: input.totalAmount,
        p_customer_hint: input.customerHint,
        p_expires_at: input.expiresAt ?? null,
      },
    );
    if (error) return mutationError(error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return apiFailure("草稿建立失敗", 409);

    return apiSuccess(
      {
        orderId: Number(row.order_id),
        publicToken: String(row.public_token),
      },
      201,
    );
  });
}

export async function PUT(request: Request) {
  return withApiErrorHandling("PUT /api/bundle-claims", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const parsed = bundleClaimDraftSchema
      .extend({ orderId: z.number().int().positive() })
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiFailure(
        parsed.error.issues[0]?.message || "請確認草稿內容",
        400,
      );
    }
    const input = parsed.data;
    if (
      !canAccessBundleClaimOwner(
        auth.role,
        auth.inventoryOwnerId,
        input.ownerId,
      )
    ) {
      return apiFailure("無法編輯這個庫藏的喊單", 403);
    }

    const { error } = await asUntypedSupabase(auth.supabase).rpc(
      "update_bundle_claim_order_draft",
      {
        p_owner_id: input.ownerId,
        p_order_id: input.orderId,
        p_title: input.title,
        p_description: input.description,
        p_total_amount: input.totalAmount,
        p_customer_hint: input.customerHint,
        p_expires_at: input.expiresAt ?? null,
      },
    );
    if (error) return mutationError(error);
    return apiSuccess({ orderId: input.orderId, updated: true as const });
  });
}

export async function PATCH(request: Request) {
  return withApiErrorHandling("PATCH /api/bundle-claims", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const parsed = actionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return apiFailure("操作資料格式錯誤", 400);
    const input = parsed.data;
    if (
      !canAccessBundleClaimOwner(
        auth.role,
        auth.inventoryOwnerId,
        input.ownerId,
      )
    ) {
      return apiFailure("無法操作這個庫藏的喊單", 403);
    }

    const supabase = asUntypedSupabase(auth.supabase);
    let rpcName = "";
    let rpcInput: Record<string, unknown> = {
      p_owner_id: input.ownerId,
      p_order_id: input.orderId,
    };

    if (input.action === "open") rpcName = "open_bundle_claim_order";
    if (input.action === "revoke") rpcName = "revoke_bundle_claim_order";
    if (input.action === "reverse_payment") {
      rpcName = "delete_bundle_claim_payment";
    }
    if (input.action === "set_receiving") {
      rpcName = "set_bundle_claim_receiving_check";
      rpcInput = { ...rpcInput, p_checked: input.checked };
    }
    if (input.action === "set_outbound") {
      rpcName = "set_bundle_claim_outbound_check";
      rpcInput = { ...rpcInput, p_checked: input.checked };
    }
    if (input.action === "reorder_images") {
      rpcName = "reorder_bundle_claim_order_images";
      rpcInput = { ...rpcInput, p_image_ids: input.imageIds };
    }
    if (input.action === "record_payment") {
      const { data: order, error: orderError } = await supabase
        .from("bundle_claim_orders")
        .select("total_amount")
        .eq("id", input.orderId)
        .eq("owner_id", input.ownerId)
        .maybeSingle();
      if (orderError || !order) {
        return apiFailure("找不到已確認的訂單", 404, orderError?.code);
      }
      rpcName = "record_bundle_claim_payment";
      rpcInput = {
        ...rpcInput,
        p_amount: Number(order.total_amount),
        p_transferred_at: input.transferredAt,
        p_payer_account_last_five: input.payerAccountLastFive,
        p_note: input.note,
      };
    }

    const { error } = await supabase.rpc(rpcName, rpcInput);
    if (error) return mutationError(error);
    return apiSuccess({ orderId: input.orderId, action: input.action });
  });
}

export async function DELETE(request: Request) {
  return withApiErrorHandling("DELETE /api/bundle-claims", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const parsed = deleteSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return apiFailure("刪除資料格式錯誤", 400);
    if (
      !canAccessBundleClaimOwner(
        auth.role,
        auth.inventoryOwnerId,
        parsed.data.ownerId,
      )
    ) {
      return apiFailure("無法刪除這個庫藏的喊單", 403);
    }

    const supabase = asUntypedSupabase(auth.supabase);
    const { data: images, error: imageError } = await supabase
      .from("bundle_claim_order_images")
      .select("storage_path,bundle_claim_orders!inner(owner_id,status)")
      .eq("order_id", parsed.data.orderId)
      .eq("bundle_claim_orders.owner_id", parsed.data.ownerId)
      .eq("bundle_claim_orders.status", "draft");
    if (imageError) return apiFailure(imageError.message, 400, imageError.code);

    const { error } = await supabase.rpc("delete_bundle_claim_order_draft", {
      p_owner_id: parsed.data.ownerId,
      p_order_id: parsed.data.orderId,
    });
    if (error) return mutationError(error);

    const paths = (images ?? []).flatMap((image) =>
      typeof image.storage_path === "string" ? [image.storage_path] : [],
    );
    if (paths.length > 0) {
      const removal = await createServiceClient()
        .storage.from("bundle-claim-screenshots")
        .remove(paths);
      if (removal.error) {
        console.error("Bundle claim draft object cleanup failed", {
          orderId: parsed.data.orderId,
          code: removal.error.name,
        });
      }
    }

    return apiSuccess({ deleted: true as const, orderId: parsed.data.orderId });
  });
}
