import { z } from "zod";
import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";
import { getTaipeiDay, sumStallSales } from "@/lib/stall-sales";

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const ownerId = z
    .string()
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("ownerId"));
  if (!ownerId.success) return apiFailure("請選擇庫藏", 400);
  if (auth.role !== "admin" && ownerId.data !== auth.inventoryOwnerId)
    return apiFailure("權限不足", 403);
  const day = getTaipeiDay();
  let cursor: string | undefined;
  const totals = { revenue: 0, orderCount: 0, itemCount: 0 };
  // Page by ID so a busy day cannot be silently truncated by the Data API's row limit.
  for (;;) {
    let query = auth.supabase
      .from("orders")
      .select("id,order_items(quantity,unit_price)")
      .eq("owner_id", ownerId.data)
      .eq("notes", "攤位掃碼結帳")
      .eq("payment_status", "paid")
      .in("status", ["packed", "shipped"])
      .is("deleted_at", null)
      .gte("created_at", day.start)
      .lt("created_at", day.end)
      .order("id")
      .limit(500);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) return apiFailure("讀取今日攤位營收失敗", 400, error.code);
    if (!data?.length) break;
    const page = sumStallSales(data);
    totals.revenue = Math.round((totals.revenue + page.revenue) * 100) / 100;
    totals.orderCount += page.orderCount;
    totals.itemCount += page.itemCount;
    cursor = data[data.length - 1].id;
  }
  return apiSuccess({ date: day.date, ...totals });
}
