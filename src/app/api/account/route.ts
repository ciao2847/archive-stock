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
      availableOwners: [{ id: auth.userId, name: userName }],
    });
  }

  const [
    { data: costs, error: costError },
    { data: sales, error: salesError },
    { data: owners, error: ownersError },
  ] = await Promise.all([
    auth.supabase.rpc("get_admin_product_costs"),
    auth.supabase
      .from("orders")
      .select(
        "status,discount,shipping_income,platform_fee,seller_shipping_cost,order_items(quantity,unit_price)",
      ),
    auth.supabase
      .from("profiles")
      .select("id,display_name")
      .order("display_name"),
  ]);
  if (costError || salesError || ownersError) {
    return apiFailure(
      costError?.message ||
        salesError?.message ||
        ownersError?.message ||
        "帳號資料載入失敗",
      400,
    );
  }

  const cost = (costs ?? []).reduce(
    (sum: number, row: { cost: unknown }) => sum + toNumber(row.cost),
    0,
  );
  const rows = (sales ?? []) as unknown as Array<{
    status: string;
    discount: unknown;
    shipping_income: unknown;
    platform_fee: unknown;
    seller_shipping_cost: unknown;
    order_items: Array<{ quantity: number; unit_price: unknown }> | null;
  }>;
  const revenue = rows
    .filter((row) => FINANCIAL_ORDER_STATUSES.has(row.status))
    .reduce(
      (sum, row) =>
        sum +
        (row.order_items ?? []).reduce(
          (itemSum, item) =>
            itemSum + toNumber(item.unit_price) * item.quantity,
          0,
        ) +
        toNumber(row.shipping_income) -
        toNumber(row.discount) -
        toNumber(row.platform_fee) -
        toNumber(row.seller_shipping_cost),
      0,
    );

  return apiSuccess<AccountData>({
    userId: auth.userId,
    userName,
    isAdmin: true,
    finance: { revenue, cost, profit: revenue - cost },
    availableOwners: (owners ?? []).map((owner) => ({
      id: owner.id,
      name: owner.display_name?.trim() || "未命名使用者",
    })),
  });
}
