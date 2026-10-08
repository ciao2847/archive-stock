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
  ClaimPaymentStatus,
  ClaimProductTotal,
  ClaimSubmission,
  ClaimSubmissionPayment,
  ClaimTransferAccount,
} from "@/lib/claims";
import { asUntypedSupabase } from "@/lib/api/bundle-claims-server";
import {
  CLAIM_PAYMENT_STATUSES,
  TAIWAN_MOBILE_PHONE_PATTERN,
} from "@/lib/claims";

import { claimCustomerSearchFilter } from "@/lib/claim-search";

const PAGE_SIZE = 50;
const CLAIM_FORM_BANNER_PATH_PATTERN =
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$/;

const querySchema = z.object({
  ownerId: z.string().uuid(),
  formId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  customerPhone: z.string().regex(TAIWAN_MOBILE_PHONE_PATTERN).optional(),
  customerSearch: z.string().trim().min(1).max(100).optional(),
  scope: z.enum(["form", "all"]).optional(),
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
  isEnabled: z.boolean(),
});

const saveSchema = z.object({
  formId: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((v) => v || undefined),
  ownerId: z.string().uuid(),
  title: z.string().trim().min(1, "請填寫 IP 名稱／訂購標題").max(120),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => v ?? ""),
  isOpen: z.boolean(),
  closesAt: z
    .string()
    .datetime({ offset: true })
    .nullish()
    .transform((v) => v || undefined),
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

const paymentStatusSchema = z
  .object({
    ownerId: z.string().uuid(),
    formId: z.number().int().positive().optional(),
    submissionId: z.number().int().positive().optional(),
    submissionIds: z.array(z.number().int().positive()).min(1).optional(),
    paymentStatus: z.enum(CLAIM_PAYMENT_STATUSES),
  })
  .refine(
    (data) =>
      data.submissionId !== undefined ||
      (data.submissionIds !== undefined && data.submissionIds.length > 0),
    { message: "請指定要更新的訂購編號" },
  );

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

function claimPaymentStatusOf(value: unknown): ClaimPaymentStatus {
  return typeof value === "string" &&
    (CLAIM_PAYMENT_STATUSES as readonly string[]).includes(value)
    ? (value as ClaimPaymentStatus)
    : "pending";
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

function mapSubmissionPayments(value: unknown): ClaimSubmissionPayment[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const row = recordOf(item);
      if (!row.id || typeof row.transferred_at !== "string") return [];
      return [
        {
          id: numberOf(row.id),
          amount: numberOf(row.amount),
          transferredAt: row.transferred_at,
          payerAccountLastFive:
            typeof row.payer_account_last_five === "string"
              ? row.payer_account_last_five
              : undefined,
          note: typeof row.note === "string" ? row.note : undefined,
          createdAt:
            typeof row.created_at === "string"
              ? row.created_at
              : row.transferred_at,
        },
      ];
    })
    .sort(
      (a, b) =>
        new Date(b.transferredAt).getTime() -
        new Date(a.transferredAt).getTime(),
    );
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
      customerSearch: url.searchParams.get("customerSearch") || undefined,
      scope: url.searchParams.get("scope") || undefined,
    });
    if (!parsed.success) return apiFailure("訂購查詢參數格式錯誤", 400);

    const { ownerId, formId, page, customerPhone, customerSearch, scope } =
      parsed.data;
    if (!canAccessOwner(auth.role, auth.inventoryOwnerId, ownerId)) {
      return apiFailure("無法查看這個庫藏的訂購", 403);
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
            "name,official_line_id,claim_banner_image_path,claim_banner_position_x,claim_banner_position_y,claim_theme_primary_color,claim_theme_background_color,claim_theme_surface_color,claim_theme_header_text_color,claim_transfer_enabled,claim_bank_code,claim_bank_name,claim_bank_branch,claim_bank_account,claim_bank_account_name",
          )
          .eq("id", ownerId)
          .maybeSingle(),
      ]);
    if (formError) return apiFailure(formError.message, 400, formError.code);

    const form = formId
      ? forms?.find((candidate) => candidate.id === formId)
      : forms?.[0];
    if (formId && !form) return apiFailure("找不到這個 IP 訂購連結", 404);

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
    const transferAccount: ClaimTransferAccount =
      inventoryData?.claim_transfer_enabled &&
      inventoryData.claim_bank_code &&
      inventoryData.claim_bank_name &&
      inventoryData.claim_bank_account
        ? {
            bankCode: inventoryData.claim_bank_code,
            bankName: inventoryData.claim_bank_name,
            bankBranch: inventoryData.claim_bank_branch || undefined,
            account: inventoryData.claim_bank_account,
            accountName: inventoryData.claim_bank_account_name || "",
          }
        : {
            bankCode: "824",
            bankName: "連線商業銀行 (LINE Bank)",
            account: "111022318292",
            accountName: "",
          };

    if (scope === "all") {
      const formIds = mappedForms.map((candidate) => candidate.id);
      const normalPromise = formIds.length
        ? auth.supabase
            .from("claim_submissions")
            .select(
              "id,form_id,confirmation_code,nickname,phone,notes,payment_status,created_at,claim_submission_items(id,product_id,product_sku,product_name,quantity,unit_price),claim_submission_payments(id,amount,transferred_at,payer_account_last_five,note,created_at)",
            )
            .in("form_id", formIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null });
      const bundlePromise = asUntypedSupabase(auth.supabase)
        .from("bundle_claim_orders")
        .select(
          "id,confirmation_code,title,total_amount,customer_nickname,customer_phone,customer_notes,confirmed_at,updated_at,receiving_checked_at,outbound_checked_at,bundle_claim_payments(id,amount,transferred_at,payer_account_last_five,note,created_at)",
        )
        .eq("owner_id", ownerId)
        .eq("status", "confirmed")
        .order("confirmed_at", { ascending: false });
      const [normalResult, bundleResult] = await Promise.all([
        normalPromise,
        bundlePromise,
      ]);
      const { data: submissions, error: submissionsError } = normalResult;

      if (submissionsError) {
        return apiFailure(submissionsError.message, 400, submissionsError.code);
      }
      if (bundleResult.error) {
        return apiFailure(
          bundleResult.error.message,
          400,
          bundleResult.error.code,
        );
      }

      const formTitleById = new Map(
        mappedForms.map((candidate) => [candidate.id, candidate.title]),
      );
      const mappedSubmissions: ClaimSubmission[] = (submissions ?? []).map(
        (submission) => ({
          source: "claim",
          id: submission.id,
          formId: submission.form_id,
          formTitle: formTitleById.get(submission.form_id) || "未命名訂購頁",
          confirmationCode: submission.confirmation_code,
          nickname: submission.nickname,
          phone: submission.phone,
          notes: submission.notes || undefined,
          paymentStatus: claimPaymentStatusOf(submission.payment_status),
          createdAt: submission.created_at,
          items: (submission.claim_submission_items ?? []).map((item) => ({
            id: item.id,
            productId: item.product_id || undefined,
            sku: item.product_sku,
            name: item.product_name,
            quantity: item.quantity,
            unitPrice: numberOf(item.unit_price),
          })),
          payments: mapSubmissionPayments(submission.claim_submission_payments),
        }),
      );

      const mappedBundleSubmissions: ClaimSubmission[] = (
        bundleResult.data ?? []
      ).map((raw) => {
        const submission = recordOf(raw);
        const rawPayments = submission.bundle_claim_payments;
        const payments = mapSubmissionPayments(
          Array.isArray(rawPayments)
            ? rawPayments
            : rawPayments && typeof rawPayments === "object"
              ? [rawPayments]
              : [],
        );
        return {
          source: "bundle",
          updatedAt:
            typeof submission.updated_at === "string"
              ? submission.updated_at
              : undefined,
          receivingCheckedAt:
            typeof submission.receiving_checked_at === "string"
              ? submission.receiving_checked_at
              : undefined,
          outboundCheckedAt:
            typeof submission.outbound_checked_at === "string"
              ? submission.outbound_checked_at
              : undefined,
          id: numberOf(submission.id),
          formId: 0,
          formTitle: "配單確認",
          confirmationCode: String(submission.confirmation_code ?? ""),
          nickname: String(submission.customer_nickname ?? ""),
          phone: String(submission.customer_phone ?? ""),
          notes:
            typeof submission.customer_notes === "string"
              ? submission.customer_notes
              : undefined,
          paymentStatus: payments.length > 0 ? "paid" : "pending",
          createdAt: String(submission.confirmed_at ?? ""),
          items: [
            {
              id: numberOf(submission.id),
              sku: "BUNDLE",
              name: String(submission.title ?? "配單"),
              quantity: 1,
              unitPrice: numberOf(submission.total_amount),
            },
          ],
          payments,
        };
      });

      return apiSuccess({
        submissions: [...mappedSubmissions, ...mappedBundleSubmissions].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
      });
    }

    const emptyResult: ClaimFormManagement = {
      forms: mappedForms,
      form: null,
      officialLineId: inventoryData?.official_line_id || undefined,
      transferAccount,
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
            "product_id,display_name,unit_price,max_quantity_per_customer,is_enabled",
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
        "id,form_id,confirmation_code,nickname,phone,notes,payment_status,created_at,claim_submission_items(id,product_id,product_sku,product_name,quantity,unit_price),claim_submission_payments(id,amount,transferred_at,payer_account_last_five,note,created_at)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });

    if (customerSearch || customerPhone) {
      submissionsQuery = submissionsQuery.in(
        "form_id",
        mappedForms.map((candidate) => candidate.id),
      );
      submissionsQuery = customerSearch
        ? submissionsQuery.or(claimCustomerSearchFilter(customerSearch))
        : submissionsQuery.eq("phone_normalized", customerPhone!);
    } else {
      submissionsQuery = submissionsQuery.eq("form_id", form.id);
    }

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
        source: "claim",
        id: submission.id,
        formId: submission.form_id,
        formTitle: formTitleById.get(submission.form_id) || "未命名訂購頁",
        confirmationCode: submission.confirmation_code,
        nickname: submission.nickname,
        phone: submission.phone,
        notes: submission.notes || undefined,
        paymentStatus: claimPaymentStatusOf(submission.payment_status),
        createdAt: submission.created_at,
        items: (submission.claim_submission_items ?? []).map((item) => ({
          id: item.id,
          productId: item.product_id || undefined,
          sku: item.product_sku,
          name: item.product_name,
          quantity: item.quantity,
          unitPrice: numberOf(item.unit_price),
        })),
        payments: mapSubmissionPayments(submission.claim_submission_payments),
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
          isEnabled: listing.is_enabled,
        })),
      },
      officialLineId: inventoryData?.official_line_id || undefined,
      transferAccount,
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
    if (!parsed.success) return apiFailure("訂購設定格式錯誤", 400);

    const input = parsed.data;
    if (!canAccessOwner(auth.role, auth.inventoryOwnerId, input.ownerId)) {
      return apiFailure("無法管理這個庫藏的訂購", 403);
    }
    if (
      input.bannerImagePath &&
      !input.bannerImagePath.startsWith(`${input.ownerId}/`)
    ) {
      return apiFailure("橫幅圖片不屬於這個庫藏", 400);
    }

    const { data, error } = await auth.supabase.rpc("configure_claim_form", {
      // Postgres accepts NULL here for a new form; generated RPC types cannot
      // represent nullable function arguments.
      p_form_id: input.formId ?? (null as never),
      p_owner_id: input.ownerId,
      p_title: input.title,
      p_description: input.description,
      p_is_open: input.isOpen,
      p_closes_at: input.closesAt ?? (null as never),
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
        is_enabled: product.isEnabled,
      })),
    });
    if (error) {
      if (error.code === "PGRST202") {
        return apiFailure("訂購功能尚未安裝，請先執行最新 migration。", 503);
      }
      const messages: Record<string, string> = {
        "claim form title already exists": "這個 IP 已經有訂購連結。",
        "claim form not found": "找不到這個 IP 訂購連結。",
        "claim form product is not available": "部分商品不屬於目前庫藏。",
        "invalid claim form product": "請確認商品名稱、金額與數量上限。",
        "invalid claim form products": "訂購商品設定格式錯誤。",
        "invalid claim form banner image": "請重新選擇橫幅背景圖片。",
        "invalid claim form banner position": "請重新調整橫幅圖片位置。",
        "invalid claim form theme": "請確認表單色系設定。",
        "owner access required": "無法管理這個庫藏的訂購。",
      };
      return apiFailure(
        messages[error.message] || error.message,
        400,
        error.code,
      );
    }

    const row = data?.[0];
    if (!row) return apiFailure("訂購設定未儲存，請稍後再試", 409);
    return apiSuccess({
      formId: row.form_id,
      publicToken: row.public_token,
    });
  });
}

export async function PATCH(request: Request) {
  return withApiErrorHandling("PATCH /api/claim-forms", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const parsed = paymentStatusSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return apiFailure("付款狀態格式錯誤", 400);

    const input = parsed.data;
    if (!canAccessOwner(auth.role, auth.inventoryOwnerId, input.ownerId)) {
      return apiFailure("無法修改其他庫藏的付款狀態", 403);
    }

    const ids =
      input.submissionIds ?? (input.submissionId ? [input.submissionId] : []);

    let updateQuery = auth.supabase
      .from("claim_submissions")
      .update({ payment_status: input.paymentStatus })
      .in("id", ids);

    if (input.formId) {
      updateQuery = updateQuery.eq("form_id", input.formId);
    }

    const { data, error } = await updateQuery.select("id,payment_status");

    if (error) {
      return apiFailure(
        error.code === "42501"
          ? "你沒有修改這筆訂購付款狀態的權限。"
          : error.message,
        error.code === "42501" ? 403 : 400,
        error.code,
      );
    }
    if (!data || !data.length) {
      return apiFailure("找不到這筆訂購，請重新整理後再試。", 404);
    }

    return apiSuccess({
      submissionIds: data.map((d) => d.id),
      paymentStatus: claimPaymentStatusOf(data[0].payment_status),
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
    if (!parsed.success) return apiFailure("訂購明細刪除格式錯誤", 400);

    const input = parsed.data;
    if (!canAccessOwner(auth.role, auth.inventoryOwnerId, input.ownerId)) {
      return apiFailure("無法管理這個庫藏的訂購", 403);
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
        if (error.code === "23503") {
          return apiFailure(
            "這筆訂購已有匯款紀錄，請先刪除匯款紀錄後再刪除訂購。",
            409,
            error.code,
          );
        }
        const messages: Record<string, { message: string; status: number }> = {
          "admin access required": {
            message: "無法移除這個庫藏的顧客訂購明細。",
            status: 403,
          },
          "employee access required": {
            message: "請先登入庫藏帳號。",
            status: 403,
          },
          "owner access required": {
            message: "無法移除其他庫藏的顧客訂購明細。",
            status: 403,
          },
          "claim submission not found": {
            message: "找不到這筆訂購明細，可能已被其他使用者移除。",
            status: 404,
          },
          "invalid claim submission target": {
            message: "訂購明細刪除目標格式錯誤。",
            status: 400,
          },
        };
        const mapped = messages[error.message];
        return apiFailure(
          mapped?.message || "訂購明細移除失敗，請重新整理後再試。",
          mapped?.status || 400,
          error.code,
        );
      }

      if (data !== true) {
        return apiFailure("訂購明細未移除，請重新整理後再試。", 409);
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
      if (error.code === "23503") {
        return apiFailure(
          "這個 IP 仍有匯款紀錄，請先刪除相關匯款紀錄後再移除。",
          409,
          error.code,
        );
      }
      const messages: Record<string, { message: string; status: number }> = {
        "admin access required": {
          message: "無法移除這個庫藏的 IP 訂購頁。",
          status: 403,
        },
        "employee access required": {
          message: "請先登入庫藏帳號。",
          status: 403,
        },
        "owner access required": {
          message: "無法移除其他庫藏的 IP 訂購頁。",
          status: 403,
        },
        "claim form not found": {
          message: "找不到這個 IP 訂購頁，可能已被移除。",
          status: 404,
        },
        "invalid claim form target": {
          message: "訂購頁刪除目標格式錯誤。",
          status: 400,
        },
      };
      const mapped = messages[error.message];
      return apiFailure(
        mapped?.message || "IP 訂購頁移除失敗，請重新整理後再試。",
        mapped?.status || 400,
        error.code,
      );
    }

    if (data !== true) {
      return apiFailure("IP 訂購頁未移除，請重新整理後再試。", 409);
    }

    return apiSuccess({
      deleted: true,
      formId: input.formId,
      bannerImagePath: null,
    });
  });
}
