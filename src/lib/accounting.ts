import { z } from "zod";

export const MAX_PERIOD_AMOUNT = 999_999_999_999.99;

export function getBimonthlyPeriod(year: number, month: number) {
  const firstMonth = Math.floor((month - 1) / 2) * 2 + 1;
  const start = `${year}-${String(firstMonth).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, firstMonth + 1, 0)).getUTCDate();
  const end = `${year}-${String(firstMonth + 1).padStart(2, "0")}-${lastDay}`;
  return { start, end, label: `${year} 年 ${firstMonth}–${firstMonth + 1} 月` };
}

export function getCurrentPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  return getBimonthlyPeriod(
    Number(parts.find((part) => part.type === "year")?.value),
    Number(parts.find((part) => part.type === "month")?.value),
  );
}

export function isBimonthlyPeriod(start: string, end: string) {
  if (!/^\d{4}-\d{2}-01$/.test(start)) return false;
  const [year, month] = start.split("-").map(Number);
  return (
    year >= 2000 &&
    year <= 2100 &&
    month >= 1 &&
    month <= 11 &&
    month % 2 === 1 &&
    getBimonthlyPeriod(year, month).end === end
  );
}

export const periodSchema = z
  .object({
    ownerId: z.string().uuid(),
    start: z.iso.date(),
    end: z.iso.date(),
  })
  .refine(({ start, end }) => isBimonthlyPeriod(start, end), {
    message: "請選擇完整的雙月帳期",
    path: ["end"],
  });

export const moneySchema = z
  .number()
  .finite()
  .nonnegative()
  .max(MAX_PERIOD_AMOUNT)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.01,
    "金額最多兩位小數",
  );

export const periodCostSchema = periodSchema
  .safeExtend({
    amount: moneySchema,
    notes: z.string().trim().max(2000),
    expectedRevision: z.number().int().nonnegative(),
    confirmed: z.literal(true),
  })
  .strict();

export type PeriodCostInput = z.infer<typeof periodCostSchema>;
export type PeriodCost = {
  id: string;
  owner_id: string;
  period_start: string;
  period_end: string;
  amount: number;
  notes: string;
  revision: number;
  updated_at: string;
};
export type Settlement = {
  id: string;
  settlement_no: string;
  period_start: string | null;
  period_end: string | null;
  revenue: number;
  cost: number;
  profit: number;
  created_at: string;
  cost_source: "legacy_product" | "period_total";
};
export type AccountingData = {
  cost: PeriodCost | null;
  preview: {
    revenue: number;
    order_count: number;
    settled: boolean;
    blocked_reason: string | null;
  };
  history: Settlement[];
  revisions: Array<{
    revision: number;
    amount: number;
    notes: string;
    changed_at: string;
  }>;
};

export function orderGrossRevenue(order: {
  discount: number;
  shipping_income: number;
  order_items: Array<{ quantity: number; unit_price: number }>;
}) {
  return (
    Math.round(
      (order.order_items.reduce(
        (total, item) => total + item.quantity * item.unit_price,
        0,
      ) -
        order.discount) *
        100,
    ) / 100
  );
}

export function buildFinanceOverview(
  ownerIds: string[],
  costs: Array<
    Pick<PeriodCost, "owner_id" | "period_start" | "period_end" | "amount">
  >,
  snapshots: Array<
    Pick<Settlement, "period_start" | "revenue" | "cost" | "profit"> & {
      owner_id: string;
    }
  >,
  orders: Array<
    Parameters<typeof orderGrossRevenue>[0] & {
      owner_id: string;
      status: string;
      packed_at: string | null;
      created_at: string;
      settlement_orders: Array<{ order_id: string }>;
    }
  >,
) {
  const result: Record<
    string,
    { revenue: number; cost: number; profit: number }
  > = {};
  for (const id of ownerIds) result[id] = { revenue: 0, cost: 0, profit: 0 };
  for (const period of costs) {
    const total = result[period.owner_id];
    if (!total) continue;
    const snapshot = snapshots.find(
      (row) =>
        row.owner_id === period.owner_id &&
        row.period_start === period.period_start,
    );
    total.cost += snapshot?.cost ?? period.amount;
    if (snapshot) total.revenue += snapshot.revenue;
    else
      for (const order of orders) {
        if (
          order.owner_id !== period.owner_id ||
          !["packed", "shipped"].includes(order.status) ||
          order.settlement_orders.length
        )
          continue;
        const date = new Date(
          new Date(order.packed_at ?? order.created_at).getTime() +
            8 * 3600 * 1000,
        )
          .toISOString()
          .slice(0, 10);
        if (date >= period.period_start && date <= period.period_end)
          total.revenue += orderGrossRevenue(order);
      }
  }
  for (const total of Object.values(result)) {
    total.cost = Math.round(total.cost * 100) / 100;
    total.revenue = Math.round(total.revenue * 100) / 100;
    total.profit = Math.round((total.revenue - total.cost) * 100) / 100;
  }
  return result;
}
