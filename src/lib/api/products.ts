import { API_ROUTES } from "@/constants";
import { readApiResponse } from "@/lib/api/http-client";

export type DeleteProductResult = {
  deleted: boolean;
  imageCleanupWarning?: string;
};

export async function deleteProduct(productId: string) {
  const response = await fetch(API_ROUTES.product(productId), {
    method: "DELETE",
  });
  return readApiResponse<DeleteProductResult>(response);
}
