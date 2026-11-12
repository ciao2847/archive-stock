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
const unitBatchCostSchema = z
  .object({
    batchId: z.string().uuid(),
    unitCost: unitCostSchema,
    notes: z.string().trim().max(1000),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export const batchCostSchema = z.union([
  unitBatchCostSchema,
  z
    .object({
      batchId: z.string().uuid(),
      totalCost: unitCostSchema.nullable(),
      notes: z.string().trim().max(1000),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
]);
export type CostBatch = {
  id: string;
  quantity: number;
  remaining: number;
  written_off: number;
  unit_cost: number | null;
  total_cost?: number | null;
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

export const costBatchInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    sourceBatchId: z.string().uuid().optional(),
    expectedRevision: z.number().int().positive().optional(),
    quantity: z.number().int().min(1).max(1_000_000),
    totalCost: unitCostSchema.nullable(),
    date: z.iso.date(),
    notes: z.string().max(1000),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.id && value.sourceBatchId) ||
      Boolean(value.id || value.sourceBatchId) !==
        (value.expectedRevision !== undefined)
    )
      context.addIssue({ code: "custom", message: "請重新載入批次資料" });
  });
export type CostBatchInput = z.infer<typeof costBatchInputSchema>;
