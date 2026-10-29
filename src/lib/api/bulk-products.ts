import { readApiResponse } from "@/lib/api/http-client";
import type { BulkDeleteProductsResult } from "@/lib/validation/bulk-products";
export async function deleteProducts(productIds: string[]) {
  const response = await fetch("/api/products/batch-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds }),
  });
  const result = await readApiResponse<BulkDeleteProductsResult>(response);
  const requested = new Set(productIds);
  if (
    !Array.isArray(result?.deletedProductIds) ||
    result.deletedProductIds.length !== requested.size ||
    new Set(result.deletedProductIds).size !== requested.size ||
    result.deletedProductIds.some((id) => !requested.has(id))
  )
    throw new Error("無法確認刪除結果，請重新載入商品清單後再操作。");
  return result;
}
