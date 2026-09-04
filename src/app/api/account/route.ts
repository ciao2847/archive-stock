import { FINANCIAL_ORDER_STATUSES, toNumber } from "@/constants";
import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";
import type { AccountData } from "@/lib/types";

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const { data: profile, error: profileError } = await auth.supabase
    .from("profiles")
    .select("display_name")
    .eq("id", auth.userId)
    .maybeSingle();
  if (profileError)
    return apiFailure(profileError.message, 400, profileError.code);

  const {
    data: { user },
  } = await auth.supabase.auth.getUser();
  const userName =
    profile?.display_name?.trim() || user?.email?.split("@")[0] || "使用者";
  if (auth.role !== "admin") {
    return apiSuccess<AccountData>({
      userId: auth.userId,
      userName,
      isAdmin: false,
      finance: null,
      financeByOwner: {},
      availableOwners: [{ id: auth.userId, name: userName }],
    });
  }

  const [
    { data: costs, error: costError },
    { data: sales, error: salesError },
    { data: owners, error: ownersError },
    { data: productOwners, error: productOwnersError },
  ] = await Promise.all([
    auth.supabase.rpc("get_admin_product_costs"),
    auth.supabase
      .from("orders")
      .select(
        "owner_id,status,discount,shipping_income,platform_fee,seller_shipping_cost,order_items(quantity,unit_price)",
      ),
    auth.supabase
      .from("profiles")
      .select("id,display_name")
      .order("display_name"),
    auth.supabase.from("products").select("id,owner_id"),
  ]);
  if (costError || salesError || ownersError || productOwnersError) {
    return apiFailure(
      costError?.message ||
        salesError?.message ||
        ownersError?.message ||
        productOwnersError?.message ||
        "帳號資料載入失敗",
      400,
    );
  }

  const productOwnerMap = new Map(
    (productOwners ?? []).map((product) => [product.id, product.owner_id]),
  );
  const financeByOwner: AccountData["financeByOwner"] = {};
  for (const owner of owners ?? []) {
    financeByOwner[owner.id] = { revenue: 0, cost: 0, profit: 0 };
  }
  for (const row of costs ?? []) {
    const ownerId = productOwnerMap.get(String(row.product_id));
    if (ownerId && financeByOwner[ownerId]) {
      financeByOwner[ownerId].cost += toNumber(row.cost);
    }
  }
  const rows = (sales ?? []) as unknown as Array<{
    status: string;
    owner_id: string;
    discount: unknown;
    shipping_income: unknown;
    platform_fee: unknown;
    seller_shipping_cost: unknown;
    order_items: Array<{ quantity: number; unit_price: unknown }> | null;
  }>;
  for (const row of rows.filter((item) =>
    FINANCIAL_ORDER_STATUSES.has(item.status),
  )) {
    const finance = financeByOwner[row.owner_id];
    if (!finance) continue;
    finance.revenue +=
      (row.order_items ?? []).reduce(
        (sum, item) => sum + toNumber(item.unit_price) * item.quantity,
        0,
      ) +
      toNumber(row.shipping_income) -
      toNumber(row.discount) -
      toNumber(row.platform_fee) -
      toNumber(row.seller_shipping_cost);
  }
  for (const value of Object.values(financeByOwner)) {
    value.profit = value.revenue - value.cost;
  }
  const finance = Object.values(financeByOwner).reduce(
    (sum, value) => ({
      revenue: sum.revenue + value.revenue,
      cost: sum.cost + value.cost,
      profit: sum.profit + value.profit,
    }),
    { revenue: 0, cost: 0, profit: 0 },
  );

  return apiSuccess<AccountData>({
    userId: auth.userId,
    userName,
    isAdmin: true,
    finance,
    financeByOwner,
    availableOwners: (owners ?? []).map((owner) => ({
      id: owner.id,
      name: owner.display_name?.trim() || "未命名使用者",
    })),
  });
}
