import { z } from "zod";
export const MAX_BULK_DELETE_PRODUCTS = 50;
export const bulkDeleteProductsSchema = z.object({
  productIds: z
    .array(z.string().uuid())
    .min(1)
    .max(MAX_BULK_DELETE_PRODUCTS)
    .refine((ids) => new Set(ids).size === ids.length, "請勿重複選取同一商品"),
});
export const bulkDeleteResultSchema = z.object({
  deletedProductIds: z.array(z.string().uuid()),
  imagePaths: z.array(z.string()),
});
export type BulkDeleteProductsResult = {
  deletedProductIds: string[];
  imageCleanupWarning?: string;
};
