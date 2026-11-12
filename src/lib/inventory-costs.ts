import { z } from "zod";
export const accountingModeSchema = z.enum(["period_total", "product_fifo"]);
export type AccountingMode = z.infer<typeof accountingModeSchema>;
export const unitCostSchema = z
  .number()
  .finite()
  .min(0)
  .max(9_999_999_999.99)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.001,
    "成本最多兩位小數",
  );
export const batchCostSchema = z
  .object({
    batchId: z.string().uuid(),
    unitCost: unitCostSchema,
    notes: z.string().trim().max(1000),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type CostBatch = {
  id: string;
  quantity: number;
  remaining: number;
  written_off: number;
  unit_cost: number | null;
  received_at: string;
  notes: string;
  revision: number;
  locked: boolean;
};
export type ProductBatchCosts = {
  mode: AccountingMode;
  unitCost?: number | null;
  batches: CostBatch[];
};
export type ProductCostDetail = {
  batchId: string;
  orderId: string;
  orderNo: string;
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitCost: number | null;
  cost: number | null;
  receivedAt: string;
};
export type MissingProductCost = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
};
