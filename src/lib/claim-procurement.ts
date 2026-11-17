import { readApiResponse } from "@/lib/api/http-client";
import type { ClaimProductTotal } from "./claims";

export type ClaimProcurementLine = {
  productId: string | null;
  sku: string;
  name: string;
  ip: string;
  craft: string;
  quantity: number;
  customerCount: number;
  amount: number;
};
export type ClaimProcurementProductTotal = Omit<
  ClaimProductTotal,
  "productId"
> & {
  productId: string | null;
  ip: string;
  craft: string;
};
export type ClaimProcurementRound = {
  id: string;
  number: number;
  status: "open" | "closed";
  createdAt: string;
  closedAt: string | null;
  submissionCount: number;
  customerCount: number;
  itemCount: number;
  totalAmount: number;
  lines: ClaimProcurementLine[];
  productTotals?: ClaimProcurementProductTotal[];
};
export type ClaimProcurementHistory = {
  id: string;
  number: number;
  closedAt: string;
  submissionCount: number;
  itemCount: number;
  totalAmount: number;
};
export type ClaimProcurementData = {
  current: {
    id: string;
    number: number;
    submissionCount: number;
    paidSubmissionCount: number;
    unpaidSubmissionCount: number;
    itemCount: number;
    totalAmount: number;
    productTotals?: ClaimProcurementProductTotal[];
  };
  selected: ClaimProcurementRound;
  history: ClaimProcurementHistory[];
  historyHasMore: boolean;
};
export type CloseClaimProcurementInput = {
  ownerId: string;
  formId: number;
  roundId: string;
  requestId: string;
};
export type CloseClaimProcurementResult = {
  closedRoundId: string;
  nextRoundId: string;
};
export class ClaimProcurementError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ClaimProcurementError";
  }
}
async function readResponse<T>(response: Response) {
  try {
    return await readApiResponse<T>(response);
  } catch (cause) {
    throw new ClaimProcurementError(
      cause instanceof Error ? cause.message : "結單資料讀取失敗",
      response.status,
    );
  }
}
export async function fetchClaimProcurement(
  ownerId: string,
  formId: number,
  roundId?: string,
  historyPage = 1,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    ownerId,
    formId: String(formId),
    historyPage: String(historyPage),
  });
  if (roundId) query.set("roundId", roundId);
  return readResponse<ClaimProcurementData>(
    await fetch(`/api/claim-procurement?${query}`, {
      cache: "no-store",
      signal,
    }),
  );
}
export async function closeClaimProcurement(input: CloseClaimProcurementInput) {
  return readResponse<CloseClaimProcurementResult>(
    await fetch("/api/claim-procurement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}
function csvCell(value: string | number) {
  const text = String(value);
  const safe =
    typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/u.test(text)
      ? `'${text}`
      : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function buildClaimProcurementCsv(round: ClaimProcurementRound) {
  const rows: Array<Array<string | number>> = [
    ["IP", "商品", "工藝", "SKU", "叫貨數量", "訂購人數", "金額"],
    ...round.lines.map((line) => [
      line.ip,
      line.name,
      line.craft,
      line.sku,
      line.quantity,
      line.customerCount,
      line.amount,
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function buildPaidProcurementCsv(products: ClaimProductTotal[]) {
  const rows = [
    ["商品 ID", "商品名稱", "已付款數量"],
    ...products
      .filter((product) => product.paidQuantity > 0)
      .map((product) => [product.sku, product.name, product.paidQuantity]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
