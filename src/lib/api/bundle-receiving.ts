import type { SupabaseClient } from "@supabase/supabase-js";
import { BUNDLE_CLAIM_IMAGE } from "@/lib/bundle-claims";
import { PRODUCT_IMAGE_BUCKET } from "@/lib/product-images";

// Prepare immutable copies before entering the database transaction. Stable
// paths let concurrent requests and retries reuse them without overwriting.
export async function prepareBundleReceivingImages(
  client: SupabaseClient,
  ownerId: string,
  orderId: number,
) {
  const { data: order, error } = await client
    .from("bundle_claim_orders")
    .select(
      "status,total_amount,bundle_fulfillment_items(product_id),bundle_claim_order_images(id,storage_path,product_name,product_amount,received_product_id)",
    )
    .eq("owner_id", ownerId)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order || order.status !== "confirmed")
    throw new Error("找不到已確認的訂單");
  if (order.bundle_fulfillment_items.length) return;

  const images = order.bundle_claim_order_images as Array<{
    id: number;
    storage_path: string;
    product_name: string | null;
    product_amount: number | string | null;
    received_product_id: string | null;
  }>;
  if (
    !images.length ||
    images.some(
      (image) =>
        !image.product_name?.trim() ||
        image.product_amount === null ||
        !Number.isFinite(Number(image.product_amount)) ||
        Number(image.product_amount) <= 0,
    )
  )
    throw new Error("請先補齊配單的商品名稱與單價，再完成入庫核對");
  const totalCents = images.reduce(
    (total, image) => total + Math.round(Number(image.product_amount) * 100),
    0,
  );
  if (totalCents !== Math.round(Number(order.total_amount) * 100))
    throw new Error("商品明細合計與配單總額不符，請先確認商品金額");

  for (const image of images) {
    if (image.received_product_id) continue;
    const destination = `${ownerId}/bundle-receiving/${orderId}/${image.id}`;
    const { error: copyError } = await client.storage
      .from(BUNDLE_CLAIM_IMAGE.bucket)
      .copy(image.storage_path, destination, {
        destinationBucket: PRODUCT_IMAGE_BUCKET,
      });
    // A previous attempt can have prepared this object already. Keep it for
    // retry; deleting it on RPC failure could break another successful request.
    if (copyError && String(copyError.statusCode) !== "409")
      throw new Error("商品圖片複製失敗，尚未完成入庫，請重試");
  }
}
