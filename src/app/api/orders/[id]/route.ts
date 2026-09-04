import { z } from "zod";
import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";

const updateOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerNickname: z.string().max(200),
  customerContact: z.string().max(500),
  paymentStatus: z.enum(["paid", "pending"]),
  notes: z.string().max(2000),
  salesChannel: z.enum([
    "direct",
    "shopee",
    "facebook",
    "instagram",
    "website",
    "other",
  ]),
  discount: z.number().nonnegative(),
  shippingIncome: z.number().nonnegative(),
  platformFee: z.number().nonnegative(),
  sellerShippingCost: z.number().nonnegative(),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        unitPrice: z.number().nonnegative(),
      }),
    )
    .min(1)
    .max(100),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsedId = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!parsedId.success) return apiFailure("訂單 ID 格式錯誤", 400);
  const parsed = updateOrderSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return apiFailure("訂單資料格式不正確", 400);

  const input = parsed.data;
  const { data, error } = await auth.supabase.rpc("update_order_details", {
    p_order_id: parsedId.data,
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
      id: item.id,
      unit_price: item.unitPrice,
    })),
  });
  if (error) return apiFailure(error.message, 400, error.code);
  return apiSuccess({ updated: Boolean(data) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(["admin"]);
  if (!auth.ok) return auth.response;

  const parsedId = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!parsedId.success) return apiFailure("訂單 ID 格式錯誤", 400);

  const { data, error } = await auth.supabase.rpc("force_delete_order", {
    p_order_id: parsedId.data,
  });
  if (error) {
    if (error.code === "PGRST202") {
      return apiFailure("永久刪除功能尚未安裝，請先執行最新 migration。", 503);
    }
    return apiFailure("永久刪除訂單失敗", 400);
  }

  return apiSuccess({ archived: Boolean(data) });
}
