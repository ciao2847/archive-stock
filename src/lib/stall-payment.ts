import { z } from "zod";

export const STALL_PAYMENT_METHODS = {
  cash: "現金",
  transfer: "轉帳",
  line_pay: "LINE Pay",
  card: "信用卡",
  other: "其他",
} as const;
export type StallPaymentMethod = keyof typeof STALL_PAYMENT_METHODS;
export const stallPaymentMethodSchema = z.enum([
  "cash",
  "transfer",
  "line_pay",
  "card",
  "other",
]);
export const stallDiscountSchema = z
  .number()
  .finite()
  .min(0)
  .max(99999999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001);
export function stallPaymentLabel(value?: string) {
  return STALL_PAYMENT_METHODS[value as StallPaymentMethod] ?? "未記錄";
}
