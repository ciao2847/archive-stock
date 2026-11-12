import { readApiResponse } from "@/lib/api/http-client";
import type { ProductMergePreview } from "@/lib/product-merge";

export async function mergePreorderProduct(input: {
  ownerId: string;
  sourceId: string;
  targetId: string;
  token?: string;
}) {
  const response = await fetch(
    `${process.env.BASE_PATH || ""}/api/products/merge`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return readApiResponse<ProductMergePreview>(response);
}
