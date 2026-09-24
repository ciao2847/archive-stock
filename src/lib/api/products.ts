import { API_ROUTES } from "@/constants";
import { readApiResponse } from "@/lib/api/http-client";
import { PRODUCT_IMAGE_BUCKET } from "@/lib/product-images";
import { createClient } from "@/utils/supabase/client";
import type {
  CreateProductInput,
  UpdateProductInput,
} from "@/lib/validation/products";

export async function createProduct(
  input: CreateProductInput,
  ownerId: string,
) {
  const response = await fetch(API_ROUTES.getProducts, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, ownerId }),
  });
  return readApiResponse<{ productId: string }>(response);
}

export async function updateProduct(
  productId: string,
  input: UpdateProductInput,
) {
  const response = await fetch(API_ROUTES.getProduct(productId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ updated: boolean }>(response);
}

export async function uploadProductImages(main: Blob, thumbnail: Blob) {
  // Image bytes must bypass the Vercel function. A multipart request containing
  // the main image and thumbnail can exceed Vercel's request-size limit before
  // the route handler runs, which surfaces as a platform HTML 413 response.
  const supabase = createClient();
  const directory = crypto.randomUUID();
  const mainPath = `${directory}/main.webp`;
  const thumbnailPath = `${directory}/thumb.webp`;
  const bucket = supabase.storage.from(PRODUCT_IMAGE_BUCKET);

  const mainUpload = await bucket.upload(mainPath, main, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (mainUpload.error) {
    throw new Error(`主圖上傳失敗：${mainUpload.error.message}`);
  }

  const thumbnailUpload = await bucket.upload(thumbnailPath, thumbnail, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (thumbnailUpload.error) {
    await bucket.remove([mainPath]).catch(() => undefined);
    throw new Error(`縮圖上傳失敗：${thumbnailUpload.error.message}`);
  }

  return { paths: [mainUpload.data.path, thumbnailUpload.data.path] };
}

export async function removeProductImages(paths: string[]) {
  const response = await fetch(API_ROUTES.getProductImages, {
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
  const response = await fetch(API_ROUTES.getProduct(productId), {
    method: "DELETE",
  });
  return readApiResponse<DeleteProductResult>(response);
}
