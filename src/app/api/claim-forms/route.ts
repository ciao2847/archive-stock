import { z } from "zod";

import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import { getClaimFormAssetPublicUrl } from "@/lib/claim-form-assets";
import {
  DEFAULT_CLAIM_FORM_BANNER_POSITION,
  getDefaultClaimFormTheme,
  HEX_COLOR_PATTERN,
} from "@/lib/claim-form-theme";
import type {
  ClaimFormAppearance,
  ClaimFormManagement,
  ClaimProductTotal,
  ClaimSubmission,
} from "@/lib/claims";
import { TAIWAN_MOBILE_PHONE_PATTERN } from "@/lib/claims";

const PAGE_SIZE = 50;
const CLAIM_FORM_BANNER_PATH_PATTERN =
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$/;

const querySchema = z.object({
  ownerId: z.string().uuid(),
  formId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  customerPhone: z.string().regex(TAIWAN_MOBILE_PHONE_PATTERN).optional(),
});

const claimProductSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().trim().min(1).max(300),
  price: z
    .number()
    .finite()
    .min(0)
    .max(9_999_999_999.99)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7),
  maxQuantity: z.number().int().min(1).max(99),
});

const saveSchema = z.object({
  formId: z.number().int().positive().nullish().transform((v) => v || undefined),
  ownerId: z.string().uuid(),
  title: z.string().trim().min(1, "請填寫 IP 名稱／喊單標題").max(120),
  description: z.string().trim().max(2000).nullish().transform((v) => v ?? ""),
  isOpen: z.boolean(),
  closesAt: z.string().datetime({ offset: true }).nullish().transform((v) => v || undefined),
  bannerImagePath: z
    .union([
      z.literal(""),
      z.string().max(500).regex(CLAIM_FORM_BANNER_PATH_PATTERN),
    ])
    .nullish()
    .transform((v) => v ?? ""),
  theme: z.object({
    primaryColor: z.string().regex(HEX_COLOR_PATTERN),
    backgroundColor: z.string().regex(HEX_COLOR_PATTERN),
    surfaceColor: z.string().regex(HEX_COLOR_PATTERN),
    headerTextColor: z.string().regex(HEX_COLOR_PATTERN),
  }),
  bannerPosition: z.object({
    x: z.number().int().min(0).max(100),
    y: z.number().int().min(0).max(100),
  }),
  products: z
    .array(claimProductSchema)
    .max(200)
    .default([])
    .refine(
      (products) =>
        new Set(products.map((product) => product.productId)).size ===
        products.length,
    ),
});

const deleteSchema = z.object({
  ownerId: z.string().uuid(),
  formId: z.number().int().positive(),
  submissionId: z.number().int().positive().optional(),
});

function canAccessOwner(
  role: "admin" | "staff",
  inventoryOwnerId: string,
  ownerId: string,
) {
  return role === "admin" || inventoryOwnerId === ownerId;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function numberOf(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapProductTotals(value: unknown): ClaimProductTotal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = recordOf(item);
    if (typeof row.sku !== "string" || typeof row.name !== "string") return [];
    return [
      {
        productId:
          typeof row.product_id === "string" ? row.product_id : undefined,
        sku: row.sku,
        name: row.name,
        quantity: numberOf(row.quantity),
        customerCount: numberOf(row.customer_count),
      },
    ];
  });
}

export async function GET(request: Request) {
  return withApiErrorHandling("GET /api/claim-forms", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      ownerId: url.searchParams.get("ownerId"),
      formId: url.searchParams.get("formId") || undefined,
      page: url.searchParams.get("page") || 1,
      customerPhone: url.searchParams.get("customerPhone") || undefined,
    });
    if (!parsed.success) return apiFailure("喊單查詢參數格式錯誤", 400);

    const { ownerId, formId, page, customerPhone } = parsed.data;
    if (!canAccessOwner(auth.role, auth.inventoryOwnerId, ownerId)) {
      return apiFailure("無法查看這個庫藏的喊單", 403);
    }

    const [{ data: forms, error: formError }, { data: inventoryData }] =
      await Promise.all([
        auth.supabase
          .from("claim_forms")
          .select(
            "id,public_token,title,description,is_open,closes_at,banner_image_path,banner_position_x,banner_position_y,theme_primary_color,theme_background_color,theme_surface_color,theme_header_text_color,created_at",
          )
          .eq("owner_id", ownerId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }),
        auth.supabase
          .from("inventory_databases")
          .select(
            "name,claim_banner_image_path,claim_banner_position_x,claim_banner_position_y,claim_theme_primary_color,claim_theme_background_color,claim_theme_surface_color,claim_theme_header_text_color",
          )
          .eq("id", ownerId)
          .maybeSingle(),
      ]);
    if (formError) return apiFailure(formError.message, 400, formError.code);

    const form = formId
      ? forms?.find((candidate) => candidate.id === formId)
      : forms?.[0];
    if (formId && !form) return apiFailure("找不到這個 IP 喊單連結", 404);

    const defaultTheme = getDefaultClaimFormTheme(inventoryData?.name || "");
    const unifiedBannerPath =
      inventoryData?.claim_banner_image_path ||
      forms?.[0]?.banner_image_path ||
      undefined;
    const unifiedAppearance: ClaimFormAppearance = {
      bannerImagePath: unifiedBannerPath,
      bannerImageUrl: getClaimFormAssetPublicUrl(unifiedBannerPath),
      bannerPosition: {
        x:
          inventoryData?.claim_banner_position_x ??
          forms?.[0]?.banner_position_x ??
          DEFAULT_CLAIM_FORM_BANNER_POSITION.x,
        y:
          inventoryData?.claim_banner_position_y ??
          forms?.[0]?.banner_position_y ??
          DEFAULT_CLAIM_FORM_BANNER_POSITION.y,
      },
      theme: {
        primaryColor:
          inventoryData?.claim_theme_primary_color ??
          forms?.[0]?.theme_primary_color ??
          defaultTheme.primaryColor,
        backgroundColor:
          inventoryData?.claim_theme_background_color ??
          forms?.[0]?.theme_background_color ??
          defaultTheme.backgroundColor,
        surfaceColor:
          inventoryData?.claim_theme_surface_color ??
          forms?.[0]?.theme_surface_color ??
          defaultTheme.surfaceColor,
        headerTextColor:
          inventoryData?.claim_theme_header_text_color ??
          forms?.[0]?.theme_header_text_color ??
          defaultTheme.headerTextColor,
      },
    };

    const mappedForms = (forms ?? []).map((candidate) => ({
      id: candidate.id,
      publicToken: candidate.public_token,
      title: candidate.title,
      isOpen: candidate.is_open,
      closesAt: candidate.closes_at || undefined,
    }));

    const emptyResult: ClaimFormManagement = {
      forms: mappedForms,
      form: null,
      appearance: unifiedAppearance,
      summary: {
        submissionCount: 0,
        customerCount: 0,
        itemCount: 0,
        estimatedTotal: 0,
      },
      productTotals: [],
      submissions: [],
      pagination: { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 },
    };
    if (!form) return apiSuccess(emptyResult);

    const [{ data: listings, error: listingError }, summaryResult] =
      await Promise.all([
        auth.supabase
          .from("claim_form_products")
          .select(
            "product_id,display_name,unit_price,max_quantity_per_customer",
          )
          .eq("form_id", form.id)
          .order("sort_order"),
        auth.supabase.rpc("get_claim_form_summary", { p_form_id: form.id }),
      ]);
    if (listingError) {
      return apiFailure(listingError.message, 400, listingError.code);
    }
    if (summaryResult.error) {
      return apiFailure(
        summaryResult.error.message,
        400,
        summaryResult.error.code,
      );
    }

    const offset = (page - 1) * PAGE_SIZE;
    let submissionsQuery = auth.supabase
      .from("claim_submissions")
      .select(
        "id,form_id,confirmation_code,nickname,phone,notes,created_at,claim_submission_items(id,product_id,product_sku,product_name,quantity,unit_price)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });

    submissionsQuery = customerPhone
      ? submissionsQuery
          .in(
            "form_id",
            mappedForms.map((candidate) => candidate.id),
          )
          .eq("phone_normalized", customerPhone)
      : submissionsQuery.eq("form_id", form.id);

    const {
      data: submissions,
      error: submissionsError,
      count,
    } = await submissionsQuery.range(offset, offset + PAGE_SIZE - 1);
    if (submissionsError) {
      return apiFailure(submissionsError.message, 400, submissionsError.code);
    }

    const summary = recordOf(summaryResult.data);
    const formTitleById = new Map(
      mappedForms.map((candidate) => [candidate.id, candidate.title]),
    );
    const mappedSubmissions: ClaimSubmission[] = (submissions ?? []).map(
      (submission) => ({
        id: submission.id,
        formId: submission.form_id,
        formTitle: formTitleById.get(submission.form_id) || "未命名喊單頁",
        confirmationCode: submission.confirmation_code,
        nickname: submission.nickname,
        phone: submission.phone,
        notes: submission.notes || undefined,
        createdAt: submission.created_at,
        items: (submission.claim_submission_items ?? []).map((item) => ({
          id: item.id,
          productId: item.product_id || undefined,
          sku: item.product_sku,
          name: item.product_name,
          quantity: item.quantity,
          unitPrice: numberOf(item.unit_price),
        })),
      }),
    );
    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return apiSuccess<ClaimFormManagement>({
      forms: mappedForms,
      form: {
        id: form.id,
        publicToken: form.public_token,
        title: form.title,
        description: form.description || "",
        isOpen: form.is_open,
        closesAt: form.closes_at || undefined,
        bannerImagePath: unifiedAppearance.bannerImagePath,
        bannerImageUrl: unifiedAppearance.bannerImageUrl,
        bannerPosition: unifiedAppearance.bannerPosition,
        theme: unifiedAppearance.theme,
        products: (listings ?? []).map((listing) => ({
          productId: listing.product_id,
          name: listing.display_name,
          price: numberOf(listing.unit_price),
          maxQuantity: listing.max_quantity_per_customer,
        })),
      },
      appearance: unifiedAppearance,
      summary: {
        submissionCount: numberOf(summary.submission_count),
        customerCount: numberOf(summary.customer_count),
        itemCount: numberOf(summary.item_count),
        estimatedTotal: numberOf(summary.estimated_total),
      },
      productTotals: mapProductTotals(summary.product_totals),
      submissions: mappedSubmissions,
      pagination: { page, pageSize: PAGE_SIZE, total, totalPages },
    });
  });
}

export async function PUT(request: Request) {
  return withApiErrorHandling("PUT /api/claim-forms", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const parsed = saveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiFailure("喊單設定格式錯誤", 400);

    const input = parsed.data;
    if (!canAccessOwner(auth.role, auth.inventoryOwnerId, input.ownerId)) {
      return apiFailure("無法管理這個庫藏的喊單", 403);
    }
    if (
      input.bannerImagePath &&
      !input.bannerImagePath.startsWith(`${input.ownerId}/`)
    ) {
      return apiFailure("橫幅圖片不屬於這個庫藏", 400);
    }

    const { data, error } = await auth.supabase.rpc("configure_claim_form", {
      p_form_id: input.formId || null,
      p_owner_id: input.ownerId,
      p_title: input.title,
      p_description: input.description,
      p_is_open: input.isOpen,
      p_closes_at: input.closesAt || null,
      p_banner_image_path: input.bannerImagePath,
      p_banner_position_x: input.bannerPosition.x,
      p_banner_position_y: input.bannerPosition.y,
      p_theme_primary_color: input.theme.primaryColor,
      p_theme_background_color: input.theme.backgroundColor,
      p_theme_surface_color: input.theme.surfaceColor,
      p_theme_header_text_color: input.theme.headerTextColor,
      p_products: input.products.map((product) => ({
        product_id: product.productId,
        name: product.name,
        price: product.price,
        max_quantity: product.maxQuantity,
      })),
    });
    if (error) {
      if (error.code === "PGRST202") {
        return apiFailure("喊單功能尚未安裝，請先執行最新 migration。", 503);
      }
      const messages: Record<string, string> = {
        "claim form title already exists": "這個 IP 已經有喊單連結。",
        "claim form not found": "找不到這個 IP 喊單連結。",
        "claim form product is not available": "部分商品不屬於目前庫藏。",
        "invalid claim form product": "請確認商品名稱、金額與數量上限。",
        "invalid claim form products": "喊單商品設定格式錯誤。",
        "invalid claim form banner image": "請重新選擇橫幅背景圖片。",
        "invalid claim form banner position": "請重新調整橫幅圖片位置。",
        "invalid claim form theme": "請確認表單色系設定。",
        "owner access required": "無法管理這個庫藏的喊單。",
      };
      return apiFailure(
        messages[error.message] || error.message,
        400,
        error.code,
      );
    }

    const row = data?.[0];
    if (!row) return apiFailure("喊單設定未儲存，請稍後再試", 409);
    return apiSuccess({
      formId: row.form_id,
      publicToken: row.public_token,
    });
  });
}

export async function DELETE(request: Request) {
  return withApiErrorHandling("DELETE /api/claim-forms", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const parsed = deleteSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return apiFailure("喊單明細刪除格式錯誤", 400);

    const input = parsed.data;
    if (!canAccessOwner(auth.role, auth.inventoryOwnerId, input.ownerId)) {
      return apiFailure("無法管理這個庫藏的喊單", 403);
    }

    if (input.submissionId) {
      const { data, error } = await auth.supabase.rpc(
        "delete_claim_submission",
        {
          p_submission_id: input.submissionId,
          p_form_id: input.formId,
          p_owner_id: input.ownerId,
        },
      );
      if (error) {
        if (error.code === "PGRST202") {
          return apiFailure("移除功能尚未安裝，請先執行最新 migration。", 503);
        }
        const messages: Record<string, { message: string; status: number }> = {
          "admin access required": {
            message: "無法移除這個庫藏的顧客喊單明細。",
            status: 403,
          },
          "employee access required": {
            message: "請先登入庫藏帳號。",
            status: 403,
          },
          "owner access required": {
            message: "無法移除其他庫藏的顧客喊單明細。",
            status: 403,
          },
          "claim submission not found": {
            message: "找不到這筆喊單明細，可能已被其他使用者移除。",
            status: 404,
          },
          "invalid claim submission target": {
            message: "喊單明細刪除目標格式錯誤。",
            status: 400,
          },
        };
        const mapped = messages[error.message];
        return apiFailure(
          mapped?.message || "喊單明細移除失敗，請重新整理後再試。",
          mapped?.status || 400,
          error.code,
        );
      }

      if (data !== true) {
        return apiFailure("喊單明細未移除，請重新整理後再試。", 409);
      }

      return apiSuccess({ deleted: true, submissionId: input.submissionId });
    }

    // Delete entire claim form
    const { data, error } = await auth.supabase.rpc("delete_claim_form", {
      p_form_id: input.formId,
      p_owner_id: input.ownerId,
    });
    if (error) {
      if (error.code === "PGRST202") {
        return apiFailure("移除功能尚未安裝，請先執行最新 migration。", 503);
      }
      const messages: Record<string, { message: string; status: number }> = {
        "admin access required": {
          message: "無法移除這個庫藏的 IP 喊單頁。",
          status: 403,
        },
        "employee access required": {
          message: "請先登入庫藏帳號。",
          status: 403,
        },
        "owner access required": {
          message: "無法移除其他庫藏的 IP 喊單頁。",
          status: 403,
        },
        "claim form not found": {
          message: "找不到這個 IP 喊單頁，可能已被移除。",
          status: 404,
        },
        "invalid claim form target": {
          message: "喊單頁刪除目標格式錯誤。",
          status: 400,
        },
      };
      const mapped = messages[error.message];
      return apiFailure(
        mapped?.message || "IP 喊單頁移除失敗，請重新整理後再試。",
        mapped?.status || 400,
        error.code,
      );
    }

    if (data !== true) {
      return apiFailure("IP 喊單頁未移除，請重新整理後再試。", 409);
    }

    return apiSuccess({
      deleted: true,
      formId: input.formId,
      bannerImagePath: null,
    });
  });
}
