import { z } from "zod";
import { LOCATION_CODE_PATTERN } from "@/constants";
export const newProductSchema = z.object({
  name: z.string().min(1, "請輸入商品名稱"),
  work: z.string().min(1, "請輸入作品名稱"),
  category: z.string(),
  country: z.string(),
  source: z.string(),
  location: z.string().regex(LOCATION_CODE_PATTERN, "格式如 A-03-02"),
  stock: z.coerce.number().min(1),
  price: z.coerce.number().min(0),
  cost: z.coerce.number().min(0),
  format: z.string().optional(),
  size: z.string().optional(),
  crafts: z.array(z.string()).optional(),
  description: z.string().max(2000, "功能描述最多 2,000 字元").optional(),
  feature: z.string().optional(),
});
export type NewProductForm = z.input<typeof newProductSchema>;
