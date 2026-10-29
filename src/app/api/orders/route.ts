import { z } from "zod";
import { SALES_CHANNELS } from "@/constants";
import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";
import { getOrderSource } from "@/lib/order-source";

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const rows: Array<{
    id: string;
    created_at: string;
    notes: string | null;
    [key: string]: unknown;
  }> = [];
  let cursor: string | undefined;
  let fulfillmentColumns = true;
  // Load every visible order so source filtering and search also find older sales.
  for (;;) {
    let query = auth.supabase
      .from("orders")
      .select(
        fulfillmentColumns
          ? "id,owner_id,order_no,notes,claim_submission_id,bundle_claim_order_id,payment_status,status,created_at,customers(name,nickname,contact),order_items(id,quantity,scanned_quantity,packed_quantity,unit_price,products(id,sku,name))"
          : "id,owner_id,order_no,notes,payment_status,status,created_at,customers(name,nickname,contact),order_items(id,quantity,scanned_quantity,packed_quantity,unit_price,products(id,sku,name))",
      )
      .is("deleted_at", null)
      .order("id")
      .limit(500);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (
      error &&
      fulfillmentColumns &&
      (error.code === "42703" || error.code === "PGRST204")
    ) {
      fulfillmentColumns = false;
      continue;
    }
    if (error) return apiFailure("讀取訂單失敗，請稍後再試", 400, error.code);
    if (!data?.length) break;
    // Both selections return the same cursor fields; the fallback omits only source links.
    const pageRows = data as unknown as typeof rows;
    rows.push(...pageRows);
    if (data.length < 500) break;
    cursor = pageRows[pageRows.length - 1].id;
  }
  rows.sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
  return apiSuccess(
    rows.map(({ notes, ...order }) => ({
      ...order,
      source: order.claim_submission_id
        ? "claim"
        : order.bundle_claim_order_id
          ? "bundle"
          : getOrderSource(notes),
    })),
  );
}

const salesChannels = SALES_CHANNELS.map((channel) => channel.value);
const orderSchema = z.object({
  customerName: z.string().trim().min(1).max(100),
  customerNickname: z.string().trim().max(100),
  customerContact: z.string().trim().max(200),
  paymentStatus: z.enum(["paid", "pending"]),
  notes: z.string().trim().max(2000),
  salesChannel: z
    .string()
    .refine((value) => salesChannels.includes(value as never)),
  discount: z.number().finite().nonnegative(),
  shippingIncome: z.number().finite().nonnegative(),
  platformFee: z.number().finite().nonnegative(),
  sellerShippingCost: z.number().finite().nonnegative(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(999),
        unitPrice: z.number().finite().nonnegative(),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = orderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiFailure("訂單資料格式錯誤", 400);

  const input = parsed.data;
  const { data, error } = await auth.supabase.rpc("create_order_with_items", {
    p_customer_name: input.customerName,
    p_customer_nickname: input.customerNickname,
    p_customer_contact: input.customerContact,
    p_payment_status: input.paymentStatus,
    p_notes: input.notes,
    p_sales_channel: input.salesChannel,
    p_discount: input.discount,
    p_shipping_income: input.shippingIncome,
    p_platform_fee: input.platformFee,
    p_seller_shipping_cost: input.sellerShippingCost,
    p_items: input.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: item.unitPrice,
    })),
  });

  if (error) {
    if (error.code === "PGRST202") {
      return apiFailure("建立訂單功能尚未安裝，請先執行最新 migration。", 503);
    }
    const knownErrors: Record<string, string> = {
      "product not found": "找不到其中一項商品。",
      "product is not available": "其中一項商品已無法訂購，請重新整理後再試。",
      "duplicate products are not allowed": "訂單內有重複商品。",
    };
    return apiFailure(knownErrors[error.message] || "建立訂單失敗", 400);
  }

  return apiSuccess({ orderId: String(data) }, 201);
}
