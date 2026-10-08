import type {
  ClaimFormBannerPosition,
  ClaimFormTheme,
} from "@/lib/claim-form-theme";

export const TAIWAN_MOBILE_PHONE_PATTERN = /^09\d{8}$/;
export const TAIWAN_MOBILE_PHONE_HTML_PATTERN = "09[0-9]{8}";
export const TAIWAN_MOBILE_PHONE_ERROR =
  "請輸入 09 開頭的 10 位數手機號碼（僅限數字）。";
export const OFFICIAL_LINE_ID_PATTERN = /^@[A-Za-z0-9._-]{1,99}$/;

export function sanitizeTaiwanMobilePhoneInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 10);
}

export function normalizeOfficialLineId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  return OFFICIAL_LINE_ID_PATTERN.test(normalized) ? normalized : "";
}

export function buildOfficialLineChatUrl(lineId: string, message: string) {
  const normalized = normalizeOfficialLineId(lineId);
  if (!normalized) return undefined;
  return `https://line.me/R/oaMessage/${encodeURIComponent(normalized)}/?${encodeURIComponent(message)}`;
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
  isEnabled: boolean;
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
  officialLineId?: string;
  completionMessage: string;
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
  transferAccount?: ClaimTransferAccount;
};

export type ClaimTransferAccount = {
  bankCode: string;
  bankName: string;
  bankBranch?: string;
  account: string;
  accountName: string;
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

export type ClaimSubmissionPayment = {
  id: number;
  amount: number;
  transferredAt: string;
  payerAccountLastFive?: string;
  note?: string;
  createdAt: string;
};

export const CLAIM_PAYMENT_STATUSES = ["pending", "half_paid", "paid"] as const;

export type ClaimPaymentStatus = (typeof CLAIM_PAYMENT_STATUSES)[number];

export const CLAIM_PAYMENT_STATUS_LABELS: Record<ClaimPaymentStatus, string> = {
  pending: "未匯款",
  half_paid: "已付一半",
  paid: "已付全額",
};

export type ClaimSubmission = {
  updatedAt?: string;
  receivingCheckedAt?: string;
  outboundCheckedAt?: string;
  source: "claim" | "bundle";
  id: number;
  formId: number;
  formTitle: string;
  confirmationCode: string;
  nickname: string;
  phone: string;
  notes?: string;
  paymentStatus: ClaimPaymentStatus;
  createdAt: string;
  items: ClaimSubmissionItem[];
  payments: ClaimSubmissionPayment[];
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
  isEnabled: boolean;
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
  officialLineId?: string;
  transferAccount?: ClaimTransferAccount;
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

export type CustomerClaimGroup = {
  customerKey: string;
  phone: string;
  nickname: string;
  submissions: ClaimSubmission[];
  totalQuantity: number;
  totalAmount: number;
  unsettledAmount: number;
  status: ClaimPaymentStatus;
  latestCreatedAt: string;
};

export function getClaimSubmissionTotal(submission: ClaimSubmission) {
  return submission.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
}

export function getClaimSubmissionPaidAmount(submission: ClaimSubmission) {
  if (submission.payments.length > 0) {
    return submission.payments.reduce(
      (sum, payment) => sum + payment.amount,
      0,
    );
  }

  const total = getClaimSubmissionTotal(submission);
  if (submission.paymentStatus === "paid") return total;
  if (submission.paymentStatus === "half_paid") return Math.round(total / 2);
  return 0;
}

export function getClaimSubmissionOutstandingAmount(
  submission: ClaimSubmission,
) {
  return Math.max(
    getClaimSubmissionTotal(submission) -
      getClaimSubmissionPaidAmount(submission),
    0,
  );
}

export function groupClaimSubmissionsByCustomer(
  submissions: ClaimSubmission[],
): CustomerClaimGroup[] {
  const groups = new Map<string, CustomerClaimGroup>();

  for (const submission of submissions) {
    const key =
      submission.phone || submission.nickname || String(submission.id);
    const existing = groups.get(key);

    const submissionAmount = getClaimSubmissionTotal(submission);
    const submissionQuantity = submission.items.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );

    const submissionUnsettled = getClaimSubmissionOutstandingAmount(submission);

    if (existing) {
      existing.submissions.push(submission);
      existing.totalQuantity += submissionQuantity;
      existing.totalAmount += submissionAmount;
      existing.unsettledAmount += submissionUnsettled;
      if (new Date(submission.createdAt) > new Date(existing.latestCreatedAt)) {
        existing.latestCreatedAt = submission.createdAt;
        existing.nickname = submission.nickname;
      }
    } else {
      groups.set(key, {
        customerKey: key,
        phone: submission.phone,
        nickname: submission.nickname,
        submissions: [submission],
        totalQuantity: submissionQuantity,
        totalAmount: submissionAmount,
        unsettledAmount: submissionUnsettled,
        status: submission.paymentStatus,
        latestCreatedAt: submission.createdAt,
      });
    }
  }

  for (const group of groups.values()) {
    const allPaid = group.submissions.every(
      (submission) => getClaimSubmissionOutstandingAmount(submission) === 0,
    );
    const allPending = group.submissions.every(
      (submission) => getClaimSubmissionPaidAmount(submission) === 0,
    );
    if (allPaid) {
      group.status = "paid";
    } else if (allPending) {
      group.status = "pending";
    } else {
      group.status = "half_paid";
    }
  }

  return Array.from(groups.values()).sort(
    (a, b) =>
      new Date(b.latestCreatedAt).getTime() -
      new Date(a.latestCreatedAt).getTime(),
  );
}

export function formatCustomerClaimLineSummary({
  storeName,
  group,
  officialLineId,
  transferAccount,
}: {
  storeName: string;
  group: CustomerClaimGroup;
  officialLineId?: string;
  transferAccount?: ClaimTransferAccount;
}): string {
  const lines: string[] = [
    `【${storeName} 預購訂購對帳單】`,
    `顧客：${group.nickname}`,
    `電話：${group.phone}`,
    "",
    "訂購明細：",
  ];

  const formMap = new Map<string, ClaimSubmissionItem[]>();
  for (const sub of group.submissions) {
    const list = formMap.get(sub.formTitle) || [];
    list.push(...sub.items);
    formMap.set(sub.formTitle, list);
  }

  for (const [formTitle, items] of formMap.entries()) {
    lines.push(`• ${formTitle}`);
    for (const item of items) {
      lines.push(
        `  - ${item.name} × ${item.quantity} ($${(item.unitPrice * item.quantity).toLocaleString()})`,
      );
    }
  }

  lines.push("----------------------");
  lines.push(`共 ${group.totalQuantity} 件商品`);
  lines.push(`總計金額：$${group.totalAmount.toLocaleString()} 元`);
  const paidAmount = Math.max(group.totalAmount - group.unsettledAmount, 0);
  if (paidAmount > 0) {
    lines.push(`已收金額：$${paidAmount.toLocaleString()} 元`);
  }
  if (group.status === "half_paid") {
    lines.push(
      `待付餘額：$${group.unsettledAmount.toLocaleString()} 元（已付部分款項）`,
    );
  } else if (group.status === "pending") {
    lines.push(`待付金額：$${group.unsettledAmount.toLocaleString()} 元`);
  } else {
    lines.push("款項狀態：已結清");
  }

  if (officialLineId) {
    lines.push("");
    lines.push(
      `官方 LINE：${officialLineId.startsWith("@") ? officialLineId : `@${officialLineId}`}`,
    );
  }
  if (transferAccount) {
    lines.push("");
    lines.push(
      `匯款銀行：${transferAccount.bankCode} ${transferAccount.bankName}${transferAccount.bankBranch ? ` ${transferAccount.bankBranch}` : ""}`,
    );
    lines.push(`匯款帳號：${transferAccount.account}`);
  }
  lines.push("匯款完成後請回傳帳號末五碼，謝謝您！");

  return lines.join("\n");
}
