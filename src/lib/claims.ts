import type {
  ClaimFormBannerPosition,
  ClaimFormTheme,
} from "@/lib/claim-form-theme";

export const TAIWAN_MOBILE_PHONE_PATTERN = /^09\d{8}$/;
export const TAIWAN_MOBILE_PHONE_HTML_PATTERN = "09[0-9]{8}";
export const TAIWAN_MOBILE_PHONE_ERROR =
  "請輸入 09 開頭的 10 位數手機號碼（僅限數字）。";

export function sanitizeTaiwanMobilePhoneInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 10);
}

export function formatTaipeiDateTime(dateInput?: string | Date | null): string {
  if (!dateInput) return "";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return "";

  // Asia/Taipei is UTC+8 with no daylight saving time
  const taipei = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = taipei.getUTCFullYear();
  const month = String(taipei.getUTCMonth() + 1).padStart(2, "0");
  const day = String(taipei.getUTCDate()).padStart(2, "0");
  const hour = String(taipei.getUTCHours()).padStart(2, "0");
  const minute = String(taipei.getUTCMinutes()).padStart(2, "0");

  return `${year}/${month}/${day} ${hour}:${minute}`;
}

export type PublicClaimProduct = {
  id: string;
  sku: string;
  name: string;
  work: string;
  category: string;
  country?: string;
  source?: string;
  description?: string;
  price: number;
  imageUrl?: string;
  format?: string;
  size?: string;
  crafts: string[];
  releaseDate?: string;
  publishedAt: string;
  maxQuantity: number;
};

export type PublicClaimForm = {
  storeName: string;
  title: string;
  description?: string;
  isOpen: boolean;
  closesAt?: string;
  bannerImageUrl?: string;
  bannerPosition: ClaimFormBannerPosition;
  theme: ClaimFormTheme;
  products: PublicClaimProduct[];
};

export type PublicClaimSubmissionResult = {
  confirmationCode: string;
  submittedAt: string;
};

export type ClaimProductTotal = {
  productId?: string;
  sku: string;
  name: string;
  quantity: number;
  customerCount: number;
};

export type ClaimSubmissionItem = {
  id: number;
  productId?: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

export type ClaimSubmission = {
  id: number;
  formId: number;
  formTitle: string;
  confirmationCode: string;
  nickname: string;
  phone: string;
  notes?: string;
  createdAt: string;
  items: ClaimSubmissionItem[];
};

export type ClaimFormSettings = {
  id: number;
  publicToken: string;
  title: string;
  description: string;
  isOpen: boolean;
  closesAt?: string;
  bannerImagePath?: string;
  bannerImageUrl?: string;
  bannerPosition: ClaimFormBannerPosition;
  theme: ClaimFormTheme;
  products: ClaimFormProductSettings[];
};

export type ClaimFormListItem = {
  id: number;
  publicToken: string;
  title: string;
  isOpen: boolean;
  closesAt?: string;
};

export type ClaimFormProductSettings = {
  productId: string;
  name: string;
  price: number;
  maxQuantity: number;
};

export type ClaimFormAppearance = {
  bannerImagePath?: string;
  bannerImageUrl?: string;
  bannerPosition: ClaimFormBannerPosition;
  theme: ClaimFormTheme;
};

export type ClaimFormManagement = {
  forms: ClaimFormListItem[];
  form: ClaimFormSettings | null;
  appearance?: ClaimFormAppearance;
  summary: {
    submissionCount: number;
    customerCount: number;
    itemCount: number;
    estimatedTotal: number;
  };
  productTotals: ClaimProductTotal[];
  submissions: ClaimSubmission[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type SaveClaimFormInput = {
  formId?: number;
  ownerId: string;
  title: string;
  description: string;
  isOpen: boolean;
  closesAt?: string;
  bannerImagePath: string;
  bannerPosition: ClaimFormBannerPosition;
  theme: ClaimFormTheme;
  products: ClaimFormProductSettings[];
};
