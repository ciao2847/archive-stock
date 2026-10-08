import { z } from "zod";
import { LOCATION_CODE_PATTERN } from "@/constants";
export const newProductSchema = z.object({
  name: z.string().trim().min(1, "請輸入商品名稱"),
  category: z.string(),
  country: z.string().trim().min(1, "請選擇國家版本"),
  source: z.string(),
  location: z.union([
    z.string().regex(LOCATION_CODE_PATTERN, "格式如 A-03-02"),
    z.literal(""),
  ]),
  stock: z.coerce.number().int().min(0).max(1000),
  price: z
    .union([z.number(), z.string().trim().min(1, "請填寫販售金額")])
    .transform(Number)
    .pipe(z.number().finite().min(0)),
  format: z.string().optional(),
  size: z.string().optional(),
  crafts: z.array(z.string()).optional(),
  description: z.string().max(2000, "功能描述最多 2,000 字元").optional(),
  feature: z.string().optional(),
});
export const preorderProductSchema = newProductSchema.extend({
  country: z.string(),
});
export type NewProductForm = z.input<typeof newProductSchema>;
