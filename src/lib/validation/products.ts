import { z } from "zod";

import { buildPreorderProductName } from "@/lib/preorder-product-name";
import { COUNTRIES, LOCATION_CODE_PATTERN } from "@/constants";

const productBaseSchema = z.object({
  name: z.string().trim().min(1).max(300),
  preorderItemName: z.string().trim().max(200).optional(),
  category: z.string().trim().min(1).max(100),
  country: z.string().max(100),
  source: z.string().max(300),
  location: z.string().regex(LOCATION_CODE_PATTERN),
  stock: z.number().int().min(0).max(1000),
  price: z.number().nonnegative(),
  format: z.string().max(100),
  size: z.string().max(100),
  description: z
    .string()
    .max(2000, "功能描述最多 2,000 字元")
    .optional()
    .default(""),
  feature: z.string().max(2000),
});

export const createProductSchema = productBaseSchema
  .extend({
    work: z.string().trim().min(1).max(200).optional(),
    preorderOnly: z.boolean().optional().default(false),
    stock: z.number().int().min(0).max(1000),
    location: z.union([z.string().regex(LOCATION_CODE_PATTERN), z.literal("")]),
    imagePaths: z.array(z.string().min(1).max(1000)).max(2),
    crafts: z.array(z.string().max(100)).max(30),
  })
  .superRefine((product, context) => {
    validatePreorderNaming(product, context);
    if (!product.preorderOnly && !product.country.trim()) {
      context.addIssue({
        code: "custom",
        path: ["country"],
        message: "請選擇國家版本",
      });
    }
    if (!product.preorderOnly && product.imagePaths.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["imagePaths"],
        message: "請上傳商品圖片",
      });
    }
    if (product.preorderOnly && product.stock !== 0) {
      context.addIssue({
        code: "custom",
        path: ["stock"],
        message: "預購商品庫存必須為 0",
      });
    }
  });

export const updateProductSchema = productBaseSchema
  .extend({
    work: z.string().trim().min(1).max(300).optional(),
    crafts: z.array(z.string().max(100)).max(30).optional(),
    imagePaths: z.array(z.string().min(1).max(1000)).max(2).optional(),
    location: z.union([z.string().regex(LOCATION_CODE_PATTERN), z.literal("")]),
  })
  .superRefine(validatePreorderNaming);

function validatePreorderNaming(
  product: { work?: string; country: string; preorderItemName?: string },
  context: z.RefinementCtx,
) {
  if (product.preorderItemName === undefined) return;
  if (!product.work?.trim())
    context.addIssue({
      code: "custom",
      path: ["work"],
      message: "請填寫作品名稱",
    });
  if (!(COUNTRIES as readonly string[]).includes(product.country))
    context.addIssue({
      code: "custom",
      path: ["country"],
      message: "請選擇國家版本",
    });
  if (
    buildPreorderProductName(
      product.country,
      product.work ?? "",
      product.preorderItemName,
    ).length > 300
  )
    context.addIssue({
      code: "custom",
      path: ["name"],
      message: "組合後的商品名稱最多 300 字元",
    });
}

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
