import { z } from "zod";
import { MAX_PERIOD_AMOUNT, moneySchema, periodSchema } from "./accounting";

export const COST_CATEGORIES = [
  "商品購入",
  "國際運費",
  "國內運費",
  "平台費",
  "包材",
  "其他",
] as const;
export const costEntrySchema = z
  .object({
    id: z.string().uuid(),
    date: z.iso.date({ error: "請選擇有效的成本日期" }),
    category: z.enum(COST_CATEGORIES, { error: "請選擇成本分類" }),
    name: z.string().trim().min(1, "請填寫成本項目").max(200),
    amount: z.number({ error: "請填寫有效的成本金額" }).pipe(moneySchema),
    notes: z.string().trim().max(1000),
  })
  .strict();
export const profitShareSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1, "請填寫分帳對象").max(100),
    basisPoints: z.number().int().min(1, "分帳比例須大於 0%").max(10000),
  })
  .strict();
export type CostEntry = z.infer<typeof costEntrySchema>;
export type ProfitShare = z.infer<typeof profitShareSchema>;
export function sumCostEntries(entries: Pick<CostEntry, "amount">[]) {
  return (
    entries.reduce((total, row) => total + Math.round(row.amount * 100), 0) /
    100
  );
}
export const periodDetailsSchema = periodSchema
  .safeExtend({
    entries: z.array(costEntrySchema).max(500),
    shares: z.array(profitShareSchema).max(20),
    notes: z.string().trim().max(2000),
    expectedRevision: z.number().int().nonnegative(),
    confirmed: z.literal(true),
  })
  .strict()
  .superRefine((value, context) => {
    if (sumCostEntries(value.entries) > MAX_PERIOD_AMOUNT)
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "成本總額超過上限",
      });
    value.entries.forEach((entry, index) => {
      if (entry.date < value.start || entry.date > value.end)
        context.addIssue({
          code: "custom",
          path: ["entries", index, "date"],
          message: "成本日期須在本期內",
        });
    });
    for (const key of ["entries", "shares"] as const) {
      if (new Set(value[key].map((row) => row.id)).size !== value[key].length)
        context.addIssue({
          code: "custom",
          path: [key],
          message: "項目不可重複",
        });
    }
    if (
      value.shares.length &&
      value.shares.reduce((sum, row) => sum + row.basisPoints, 0) !== 10000
    )
      context.addIssue({
        code: "custom",
        path: ["shares"],
        message: "分帳比例合計須為 100%",
      });
    if (
      new Set(value.shares.map((row) => row.name)).size !== value.shares.length
    )
      context.addIssue({
        code: "custom",
        path: ["shares"],
        message: "分帳對象名稱不可重複",
      });
  });
export type PeriodDetailsInput = z.infer<typeof periodDetailsSchema>;

// Largest remainder allocation in cents, with stable row order as the tie-breaker.
// Allocate the absolute cents first, then restore the sign for shared losses.
export function allocateProfit(profit: number, shares: ProfitShare[]) {
  if (!shares.length) return [];
  if (shares.reduce((sum, row) => sum + row.basisPoints, 0) !== 10000)
    return [];
  const sign = profit < 0 ? -1 : 1;
  const cents = BigInt(Math.abs(Math.round(profit * 100)));
  const rows = shares.map((share, index) => ({
    ...share,
    index,
    cents: (cents * BigInt(share.basisPoints)) / BigInt(10000),
    remainder: (cents * BigInt(share.basisPoints)) % BigInt(10000),
  }));
  let remaining = cents - rows.reduce((sum, row) => sum + row.cents, BigInt(0));
  for (const row of [...rows].sort(
    (a, b) => Number(b.remainder - a.remainder) || a.index - b.index,
  )) {
    if (remaining <= BigInt(0)) break;
    row.cents += BigInt(1);
    remaining -= BigInt(1);
  }
  return rows.map(({ id, name, basisPoints, cents }) => ({
    id,
    name,
    basisPoints,
    amount: cents === BigInt(0) ? 0 : (sign * Number(cents)) / 100,
  }));
}
export type AccountingReport = {
  period: { start: string; end: string };
  cost: import("./accounting").PeriodCost | null;
  preview: import("./accounting").AccountingData["preview"];
  settlementNo: string | null;
  orders: Array<{
    orderId: string;
    orderNo: string;
    date: string;
    customer: string;
    status: string;
    revenue: number;
    discount: number;
    items: Array<{
      sku: string;
      name: string;
      quantity: number;
      unitPrice: number;
    }>;
  }>;
};

export function percentToBasisPoints(value: string) {
  const percent = value.trim() ? Number(value) : NaN;
  const points = Math.round(percent * 100);
  return Number.isFinite(percent) && Math.abs(percent * 100 - points) < 0.000001
    ? points
    : NaN;
}
