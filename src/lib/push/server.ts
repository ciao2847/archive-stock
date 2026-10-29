import "server-only";
import webpush from "web-push";
import { createHash, timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/utils/supabase/service";
import { isPushEndpoint } from "./validation";

export function pushConfiguration() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject =
    process.env.VAPID_SUBJECT?.trim() || "https://archive-stock.vercel.app";
  return publicKey && privateKey ? { publicKey, privateKey, subject } : null;
}
export function authorizedDispatcher(request: Request) {
  const expected = process.env.PUSH_CRON_SECRET;
  if (!expected) return false;
  const supplied = request.headers.get("authorization") || "";
  return timingSafeEqual(
    createHash("sha256").update(supplied).digest(),
    createHash("sha256").update(`Bearer ${expected}`).digest(),
  );
}
export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};
export async function sendPush(
  subscription: { endpoint: string; p256dh: string; auth_key: string },
  payload: PushPayload,
) {
  const config = pushConfiguration();
  if (!config) throw new Error("PUSH_NOT_CONFIGURED");
  if (!isPushEndpoint(subscription.endpoint))
    throw new Error("PUSH_ENDPOINT_INVALID");
  return webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
    },
    JSON.stringify(payload),
    {
      vapidDetails: config,
      TTL: 60 * 60,
      urgency: "high",
      timeout: 8000,
    },
  );
}
export function pushErrorStatus(error: unknown) {
  return error && typeof error === "object" && "statusCode" in error
    ? Number(error.statusCode)
    : 0;
}
export type OrderPushEvent = {
  id: string;
  inventory_id: string;
  kind: "claim" | "bundle";
  source_id: number;
};
export async function loadPushOrder(event: OrderPushEvent) {
  const db = createServiceClient();
  const { data: inventory, error: inventoryError } = await db
    .from("inventory_databases")
    .select("name")
    .eq("id", event.inventory_id)
    .maybeSingle();
  if (inventoryError) throw new Error("INVENTORY_READ_FAILED");
  if (!inventory) return null;
  if (event.kind === "claim") {
    const { data, error } = await db
      .from("claim_submissions")
      .select(
        "id,form_id,confirmation_code,nickname,created_at,payment_status,claim_submission_items(product_name,quantity,unit_price)",
      )
      .eq("id", event.source_id)
      .maybeSingle();
    if (error) throw new Error("ORDER_READ_FAILED");
    if (!data) return null;
    const { data: form, error: formError } = await db
      .from("claim_forms")
      .select("owner_id,title")
      .eq("id", data.form_id)
      .eq("owner_id", event.inventory_id)
      .maybeSingle();
    if (formError) throw new Error("FORM_READ_FAILED");
    if (!form) return null;
    const items = (data.claim_submission_items || []) as Array<{
      product_name: string;
      quantity: number;
      unit_price: number;
    }>;
    return {
      inventory: inventory.name as string,
      title: form.title as string,
      nickname: data.nickname as string,
      code: data.confirmation_code as string,
      createdAt: data.created_at as string,
      paymentStatus: data.payment_status as string,
      items: items.map((item) => ({
        name: item.product_name,
        quantity: item.quantity,
        price: Number(item.unit_price),
      })),
      total: items.reduce(
        (sum, item) => sum + item.quantity * Number(item.unit_price),
        0,
      ),
      count: items.reduce((sum, item) => sum + item.quantity, 0),
    };
  }
  const { data, error } = await db
    .from("bundle_claim_orders")
    .select(
      "title,customer_nickname,confirmation_code,confirmed_at,total_amount,status,bundle_claim_order_images(product_name,product_amount,sort_order)",
    )
    .eq("id", event.source_id)
    .eq("owner_id", event.inventory_id)
    .maybeSingle();
  if (error) throw new Error("ORDER_READ_FAILED");
  if (!data || data.status !== "confirmed") return null;
  const images = (data.bundle_claim_order_images || []) as Array<{
    product_name: string | null;
    product_amount: number | null;
    sort_order: number;
  }>;
  const items = images.length
    ? [...images]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((image, index) => ({
          name: image.product_name || `商品 ${index + 1}`,
          quantity: 1,
          price:
            image.product_amount == null ? null : Number(image.product_amount),
        }))
    : [
        {
          name: data.title as string,
          quantity: 1,
          price: Number(data.total_amount),
        },
      ];
  return {
    inventory: inventory.name as string,
    title: data.title as string,
    nickname: data.customer_nickname as string,
    code: data.confirmation_code as string,
    createdAt: data.confirmed_at as string,
    paymentStatus: "請至配單管理核對",
    items,
    total: Number(data.total_amount),
    count: items.length,
  };
}
type Job = {
  delivery_id: string;
  lease_token: string;
  event_id: string;
  inventory_id: string;
  kind: "claim" | "bundle";
  source_id: number;
  endpoint: string;
  p256dh: string;
  auth_key: string;
};
export async function dispatchOrderPushes() {
  if (!pushConfiguration()) throw new Error("PUSH_NOT_CONFIGURED");
  const db = createServiceClient();
  const { data, error } = await db.rpc("claim_order_push_deliveries", {
    p_limit: 15,
  });
  if (error) throw new Error("PUSH_QUEUE_UNAVAILABLE");
  const jobs = (data || []) as Job[];
  let delivered = 0;
  // Bound concurrency and provider timeouts to stay within the worker lease.
  for (let offset = 0; offset < jobs.length; offset += 5) {
    await Promise.all(
      jobs.slice(offset, offset + 5).map(async (job) => {
        let result = "retry",
          errorCode: string | null = null;
        try {
          const order = await loadPushOrder({
            id: job.event_id,
            inventory_id: job.inventory_id,
            kind: job.kind,
            source_id: job.source_id,
          });
          if (!order) result = "skipped";
          else {
            await sendPush(job, {
              title: `${order.inventory}｜${job.kind === "claim" ? "收到新訂購" : "配單已確認"}`,
              body: `收到一筆${job.kind === "claim" ? "訂購" : "配單確認"}，共 ${order.count} 件，金額 $${order.total.toLocaleString("zh-TW")}。點擊查看明細。`,
              url: `/notifications/${job.event_id}`,
              tag: `order-${job.event_id}`,
            });
            result = "sent";
            delivered++;
          }
        } catch (error) {
          const status = pushErrorStatus(error);
          errorCode = status ? `PUSH_HTTP_${status}` : "PUSH_DELIVERY_ERROR";
          if (status === 404 || status === 410) {
            await db
              .from("web_push_subscriptions")
              .delete()
              .eq("endpoint", job.endpoint);
            result = "skipped";
          } else if (status === 400 || status === 413) result = "failed";
        }
        const { error: finishError } = await db.rpc(
          "finish_order_push_delivery",
          {
            p_id: job.delivery_id,
            p_lease: job.lease_token,
            p_result: result,
            p_error: errorCode,
          },
        );
        if (finishError)
          console.error("Push delivery acknowledgement deferred", {
            code: finishError.code,
          });
      }),
    );
  }
  return { processed: jobs.length, delivered };
}
