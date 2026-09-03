import { z } from "zod";
import { SALES_CHANNELS } from "@/constants";
import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.supabase
    .from("orders")
    .select(
      "id,order_no,payment_status,status,created_at,customers(name,nickname),order_items(quantity,scanned_quantity,products(sku))",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) return apiFailure(error.message, 400, error.code);
  return apiSuccess(data ?? []);
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
