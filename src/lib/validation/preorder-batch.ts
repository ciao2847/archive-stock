import { z } from "zod";
import { COUNTRIES, POSTER_FORMATS } from "@/constants";
import {
  buildPreorderProductName,
  cleanPreorderNamePart,
} from "@/lib/preorder-product-name";
import { MAX_PREORDER_BATCH, preorderRowKey } from "@/lib/preorder-import";

const namePart = z
  .string()
  .trim()
  .transform(cleanPreorderNamePart)
  .pipe(z.string().max(200));
export const preorderBatchItemSchema = z
  .object({
    work: namePart.pipe(z.string().min(1, "請填寫作品名稱")),
    country: z.enum(COUNTRIES),
    itemName: namePart,
    price: z
      .number()
      .finite()
      .min(0)
      .max(9_999_999_999.99)
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
        "售價最多兩位小數",
      ),
    size: z.string().trim().max(100),
    format: z
      .string()
      .trim()
      .max(100)
      .refine(
        (value) =>
          !value || (POSTER_FORMATS as readonly string[]).includes(value),
        "請選擇版本",
      ),
  })
  .superRefine((item, context) => {
    if (
      buildPreorderProductName(item.country, item.work, item.itemName).length >
      300
    )
      context.addIssue({
        code: "custom",
        message: "組合後商品名稱最多 300 字元",
        path: ["work"],
      });
  });
export const preorderBatchSchema = z
  .object({
    ownerId: z.string().uuid(),
    requestId: z.string().uuid(),
    items: z.array(preorderBatchItemSchema).min(1).max(MAX_PREORDER_BATCH),
  })
  .superRefine(({ items }, context) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (items.length > 1 && !item.itemName)
        context.addIssue({
          code: "custom",
          message: "多品表單請填寫品項名稱",
          path: ["items", index, "itemName"],
        });
      const key = preorderRowKey(item);
      if (seen.has(key))
        context.addIssue({
          code: "custom",
          message: "同一批有重複的商品與規格",
          path: ["items", index],
        });
      seen.add(key);
    });
  });
export type PreorderBatchItem = z.infer<typeof preorderBatchItemSchema>;
export type PreorderBatchInput = z.infer<typeof preorderBatchSchema>;
