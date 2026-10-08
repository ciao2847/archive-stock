import { z } from "zod";

import type {
  ClaimFormBannerPosition,
  ClaimFormTheme,
} from "@/lib/claim-form-theme";
import type { ClaimTransferAccount } from "@/lib/claims";

export const BUNDLE_CLAIM_STATUSES = [
  "draft",
  "open",
  "confirmed",
  "cancelled",
  "expired",
] as const;

export type BundleClaimStatus = (typeof BUNDLE_CLAIM_STATUSES)[number];

export const BUNDLE_CLAIM_STATUS_LABELS: Record<BundleClaimStatus, string> = {
  draft: "草稿",
  open: "等待顧客確認",
  confirmed: "已確認",
  cancelled: "已撤銷",
  expired: "已過期",
};

export const BUNDLE_CLAIM_IMAGE = {
  bucket: "bundle-claim-screenshots",
  acceptedTypes: ["image/jpeg", "image/png", "image/webp"],
  maxCount: 10,
  maxBytes: 8 * 1024 * 1024,
  maxMegabytes: 8,
  signedUrlTtlSeconds: 10 * 60,
} as const;

export const bundleClaimCampaignSchema = z.object({
  id: z.number().int().positive().optional(),
  ownerId: z.string().uuid(),
  title: z.string().trim().min(1, "請填寫活動名稱").max(120),
  description: z.string().trim().max(2000).default(""),
  enabled: z.boolean().default(false),
});

export type BundleClaimCampaign = {
  id: number;
  ownerId: string;
  title: string;
  description?: string;
  publicToken: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  orderCount?: number;
};

export const bundleClaimDraftSchema = z.object({
  ownerId: z.string().uuid(),
  orderId: z.number().int().positive().optional(),
  campaignId: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(1, "請填寫訂單名稱").max(120),
  description: z.string().trim().max(2000).default(""),
  totalAmount: z
    .number()
    .finite()
    .positive("總金額必須大於 0")
    .max(9_999_999_999.99)
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
      "總金額最多只能有兩位小數",
    ),
  customerHint: z
    .string({ error: "請填寫顧客群組暱稱／選項名稱" })
    .trim()
    .min(1, "請填寫顧客群組暱稱／選項名稱")
    .max(100),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional()
    .transform((value) => value || undefined),
});

export const bundleClaimConfirmationSchema = z.object({
  nickname: z.string().trim().min(1, "請輸入暱稱").max(100),
  phone: z.string().regex(/^09\d{8}$/, "請輸入 09 開頭的 10 位數手機號碼"),
  notes: z.string().trim().max(1000).default(""),
  consent: z.literal(true, { message: "請勾選確認訂單內容與金額" }),
  requestId: z.string().uuid(),
  turnstileToken: z.string().min(1).max(4096),
  website: z.literal("").optional(),
});

export const bundleClaimQuerySchema = z.object({
  ownerId: z.string().uuid(),
  orderId: z.coerce.number().int().positive().optional(),
  campaignId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(120).default(""),
  filter: z
    .enum([
      "all",
      "draft",
      "open",
      "confirmed_unpaid",
      "confirmed_paid",
      "receiving_pending",
      "outbound_pending",
      "complete",
      "unavailable",
    ])
    .default("all"),
});

export type BundleClaimFilter = z.infer<
  typeof bundleClaimQuerySchema
>["filter"];

export type BundleClaimImage = {
  id: number;
  sortOrder: number;
  mediaType: string;
  originalFilename: string;
  productName?: string;
  productAmount?: number;
  byteSize: number;
  url: string;
};

export type BundleClaimPayment = {
  id: number;
  amount: number;
  transferredAt: string;
  payerAccountLastFive?: string;
  note?: string;
  createdAt: string;
};

export type BundleClaimOrder = {
  id: number;
  ownerId: string;
  campaignId?: number | null;
  publicToken: string;
  confirmationCode: string;
  title: string;
  description?: string;
  totalAmount: number;
  customerHint?: string;
  status: BundleClaimStatus;
  expiresAt?: string;
  customerNickname?: string;
  customerPhone?: string;
  customerNotes?: string;
  confirmedAt?: string;
  receivingCheckedAt?: string;
  receivingCheckedBy?: string;
  outboundCheckedAt?: string;
  outboundCheckedBy?: string;
  createdAt: string;
  updatedAt: string;
  images: BundleClaimImage[];
  payment?: BundleClaimPayment;
};

export type BundleClaimManagement = {
  orders: BundleClaimOrder[];
  selectedOrder?: BundleClaimOrder;
  total: number;
};

export type SaveBundleClaimDraftInput = z.input<typeof bundleClaimDraftSchema>;

export type PublicBundleClaim = {
  state: "open" | "confirmed";
  storeName: string;
  officialLineId?: string;
  completionMessage: string;
  bannerImageUrl?: string;
  bannerPosition: ClaimFormBannerPosition;
  theme: ClaimFormTheme;
  title: string;
  description?: string;
  totalAmount: number;
  customerHint?: string;
  expiresAt?: string;
  images: BundleClaimImage[];
  confirmation?: {
    confirmationCode: string;
    submittedAt: string;
    transferAccount?: Omit<ClaimTransferAccount, "accountName">;
  };
};

export type PublicBundleClaimConfirmationResult = {
  state: "confirmed";
  confirmationCode: string;
  submittedAt: string;
};

export function deriveBundleClaimStatus(
  status: BundleClaimStatus,
  expiresAt?: string | null,
  now = new Date(),
): BundleClaimStatus {
  if (
    status === "open" &&
    expiresAt &&
    new Date(expiresAt).getTime() <= now.getTime()
  ) {
    return "expired";
  }
  return status;
}

export function normalizeTaiwanMobilePhone(value: string) {
  return value.replace(/\D/g, "").slice(0, 10);
}

export function formatBundleClaimMoney(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function validateBundleClaimImage(
  file: Pick<File, "type" | "size">,
): string | undefined {
  if (
    !BUNDLE_CLAIM_IMAGE.acceptedTypes.includes(
      file.type as (typeof BUNDLE_CLAIM_IMAGE.acceptedTypes)[number],
    )
  ) {
    return "請選擇 JPG、PNG 或 WebP 圖片";
  }
  if (file.size <= 0 || file.size > BUNDLE_CLAIM_IMAGE.maxBytes) {
    return `每張圖片不可超過 ${BUNDLE_CLAIM_IMAGE.maxMegabytes}MB`;
  }
}

export function canDeleteBundleClaim(status: BundleClaimStatus) {
  return status === "draft";
}

export function canAccessBundleClaimOwner(
  role: "admin" | "staff",
  inventoryOwnerId: string,
  requestedOwnerId: string,
) {
  return role === "admin" || inventoryOwnerId === requestedOwnerId;
}

export function canEditBundleClaimEvidence(status: BundleClaimStatus) {
  return status === "draft";
}

export function canRecordBundleClaimPayment(
  status: BundleClaimStatus,
  hasPayment: boolean,
) {
  return status === "confirmed" && !hasPayment;
}

export function canSetBundleClaimOutbound(
  status: BundleClaimStatus,
  receivingCheckedAt?: string,
) {
  return status === "confirmed" && Boolean(receivingCheckedAt);
}

export type PublicBundleMenuOption = {
  id: number;
  label: string;
  state: "open" | "confirmed";
  title: string;
  description?: string;
  totalAmount: number;
  expiresAt?: string;
  images: BundleClaimImage[];
};

export type PublicBundleMenu = Pick<
  PublicBundleClaim,
  | "storeName"
  | "officialLineId"
  | "completionMessage"
  | "bannerImageUrl"
  | "bannerPosition"
  | "theme"
> & {
  campaignTitle?: string;
  campaignDescription?: string;
  options: PublicBundleMenuOption[];
};

export type BundleMenuSettings = { token: string; enabled: boolean };

export const bundleMenuConfirmationSchema =
  bundleClaimConfirmationSchema.extend({
    orderId: z.number().int().positive(),
  });

export function toPublicBundleMenuOption(
  order: BundleClaimOrder,
): PublicBundleMenuOption | null {
  const state = deriveBundleClaimStatus(order.status, order.expiresAt);
  if (state !== "open" && state !== "confirmed") return null;
  return {
    id: order.id,
    label: order.customerHint?.trim() || order.title,
    state,
    title: order.title,
    description: order.description,
    totalAmount: order.totalAmount,
    expiresAt: order.expiresAt,
    images: order.images.map((image, index) => ({
      ...image,
      originalFilename: `核對截圖 ${index + 1}`,
    })),
  };
}

export const bundleProductSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1, "請填寫每項商品名稱").max(120),
  amount: bundleClaimDraftSchema.shape.totalAmount,
});

export function sumBundleProductAmounts(amounts: readonly number[]) {
  return (
    amounts.reduce((sum, amount) => sum + Math.round(amount * 100), 0) / 100
  );
}
