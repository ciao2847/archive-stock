import { z } from "zod";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  });
export const stallOrderSearchSchema = z
  .object({
    ownerId: z.string().uuid(),
    query: z.string().trim().max(100).default(""),
    start: z.union([dateSchema, z.literal("")]).default(""),
    end: z.union([dateSchema, z.literal("")]).default(""),
    status: z.enum(["all", "completed", "cancelled"]).default("all"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .refine((input) => !input.start || !input.end || input.start <= input.end);
export const stallOrderActionSchema = z.object({
  ownerId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
});
export const stallOrderEditSchema = stallOrderActionSchema
  .extend({
    note: z.string().trim().max(2000),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.number().int().min(1).max(100),
          unitPrice: z
            .number()
            .finite()
            .min(0)
            .max(99999999.99)
            .refine(
              (value) =>
                Math.abs(value * 100 - Math.round(value * 100)) < 0.00001,
            ),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine(
    (input) =>
      new Set(input.items.map((item) => item.productId)).size ===
        input.items.length &&
      input.items.reduce((sum, item) => sum + item.quantity, 0) <= 100,
  );

export type StallOrderItem = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  stock: number;
};
export type StallOrder = {
  id: string;
  orderNo: string;
  createdAt: string;
  status: string;
  revision: number;
  note: string;
  settled: boolean;
  total: number;
  items: StallOrderItem[];
};
export type StallOrderPage = {
  orders: StallOrder[];
  total: number;
  page: number;
  pageSize: number;
};

export function stallOrderError(message: string) {
  const messages: Record<string, string> = {
    "stall order not found": "找不到這筆攤位訂單，或無權存取。",
    "owner access required": "只能操作所屬庫藏的訂單。",
    "stall order changed": "這筆訂單已被更新，請重新查找後再編輯。",
    "stall order is locked": "這筆訂單目前無法修改或撤銷。",
    "settled order cannot be changed":
      "這筆訂單已納入財務結算，無法修改或撤銷。",
    "stall product not found": "商品不存在或不屬於這個庫藏。",
    "product is not available": "可用庫存不足或商品已被預留，請重新核對數量。",
    "checkout label unavailable": "可用商品碼不足，請重新核對數量。",
    "stall order units mismatch": "訂單件數與商品碼不一致，請聯絡管理者核對。",
    "invalid stall items": "請確認商品、件數與單價，每筆最多 100 件。",
  };
  return messages[message] || "訂單操作失敗，請重新查找確認目前狀態後再試。";
}
