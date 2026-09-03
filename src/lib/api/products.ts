import { API_ROUTES } from "@/constants";
import { readApiResponse } from "@/lib/api/http-client";
import type {
  CreateProductInput,
  UpdateProductInput,
} from "@/lib/validation/products";

export async function createProduct(input: CreateProductInput) {
  const response = await fetch(API_ROUTES.products, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ productId: string }>(response);
}

export async function updateProduct(
  productId: string,
  input: UpdateProductInput,
) {
  const response = await fetch(API_ROUTES.product(productId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ updated: boolean }>(response);
}

export async function uploadProductImages(main: Blob, thumbnail: Blob) {
  const form = new FormData();
  form.append("main", main, "main.webp");
  form.append("thumbnail", thumbnail, "thumb.webp");
  const response = await fetch(API_ROUTES.productImages, {
    method: "POST",
    body: form,
  });
  return readApiResponse<{ paths: string[] }>(response);
}

export async function removeProductImages(paths: string[]) {
  const response = await fetch(API_ROUTES.productImages, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  return readApiResponse<{ removed: boolean }>(response);
}

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
