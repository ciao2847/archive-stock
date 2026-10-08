import { toNumber } from "@/constants";
import { buildFinanceOverview } from "@/lib/accounting";
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
    const { data: inventory, error: inventoryError } = await auth.supabase
      .from("inventory_databases")
      .select(
        "id,name,qr_destination_url,qr_shopee_destination_url,qr_other_destination_url,official_line_id,claim_completion_message,claim_transfer_enabled,claim_bank_code,claim_bank_name,claim_bank_branch,claim_bank_account,claim_bank_account_name",
      )
      .eq("id", auth.inventoryOwnerId)
      .maybeSingle();
    if (inventoryError)
      return apiFailure(inventoryError.message, 400, inventoryError.code);
    const inventoryName = inventory?.name?.trim() || "我的庫藏";
    return apiSuccess<AccountData>({
      userId: auth.userId,
      inventoryOwnerId: auth.inventoryOwnerId,
      userName,
      isAdmin: false,
      finance: null,
      financeByOwner: {},
      availableOwners: [{ id: auth.inventoryOwnerId, name: inventoryName }],
      inventoryDatabases: [
        {
          id: auth.inventoryOwnerId,
          name: inventoryName,
          ownerIds: [auth.userId],
          qrShopeeDestinationUrl:
            inventory?.qr_destination_url ??
            inventory?.qr_shopee_destination_url ??
            "",
          qrOtherDestinationUrl:
            inventory?.qr_destination_url ??
            inventory?.qr_other_destination_url ??
            "",
          officialLineId: inventory?.official_line_id ?? "",
          claimCompletionMessage: inventory?.claim_completion_message ?? "",
          claimTransferEnabled: inventory?.claim_transfer_enabled ?? false,
          claimBankCode: inventory?.claim_bank_code ?? "",
          claimBankName: inventory?.claim_bank_name ?? "",
          claimBankBranch: inventory?.claim_bank_branch ?? "",
          claimBankAccount: inventory?.claim_bank_account ?? "",
          claimBankAccountName: inventory?.claim_bank_account_name ?? "",
        },
      ],
      availableUsers: [],
    });
  }

  const [
    { data: costs, error: costError },
    { data: sales, error: salesError },
    { data: owners, error: ownersError },
    { data: snapshots, error: snapshotError },
    { data: inventories, error: inventoriesError },
    { data: memberships, error: membershipsError },
  ] = await Promise.all([
    auth.supabase
      .from("financial_period_costs")
      .select("owner_id,period_start,period_end,amount"),
    auth.supabase
      .from("orders")
      .select(
        "owner_id,status,packed_at,created_at,discount,shipping_income,order_items(quantity,unit_price),settlement_orders(order_id)",
      )
      .is("deleted_at", null),
    auth.supabase
      .from("profiles")
      .select("id,display_name,inventory_owner_id")
      .order("display_name"),
    auth.supabase
      .from("settlements")
      .select("owner_id,period_start,revenue,cost,profit")
      .eq("cost_source", "period_total"),
    auth.supabase
      .from("inventory_databases")
      .select(
        "id,name,qr_destination_url,qr_shopee_destination_url,qr_other_destination_url,official_line_id,claim_completion_message,claim_transfer_enabled,claim_bank_code,claim_bank_name,claim_bank_branch,claim_bank_account,claim_bank_account_name",
      )
      .order("name"),
    auth.supabase
      .from("inventory_database_members")
      .select("inventory_id,user_id,is_owner"),
  ]);
  if (
    costError ||
    salesError ||
    ownersError ||
    snapshotError ||
    inventoriesError ||
    membershipsError
  ) {
    return apiFailure(
      costError?.message ||
        salesError?.message ||
        ownersError?.message ||
        snapshotError?.message ||
        inventoriesError?.message ||
        membershipsError?.message ||
        "帳號資料載入失敗",
      400,
    );
  }

  const canonicalOwners = inventories ?? [];
  const financeByOwner = buildFinanceOverview(
    canonicalOwners.map((owner) => owner.id),
    costs ?? [],
    (snapshots ?? []).map((row) => ({ ...row, profit: toNumber(row.profit) })),
    (sales ?? []).map((row) => ({
      ...row,
      discount: toNumber(row.discount),
      shipping_income: toNumber(row.shipping_income),
      order_items: (row.order_items ?? []).map((item) => ({
        ...item,
        unit_price: toNumber(item.unit_price),
      })),
      settlement_orders: row.settlement_orders
        ? Array.isArray(row.settlement_orders)
          ? row.settlement_orders
          : [row.settlement_orders]
        : [],
    })),
  );
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
    inventoryOwnerId: auth.inventoryOwnerId,
    userName,
    isAdmin: true,
    finance,
    financeByOwner,
    availableOwners: canonicalOwners.map((owner) => ({
      id: owner.id,
      name: owner.name?.trim() || "未命名庫藏",
    })),
    inventoryDatabases: canonicalOwners.map((inventory) => ({
      id: inventory.id,
      name: inventory.name,
      qrShopeeDestinationUrl:
        inventory.qr_destination_url ??
        inventory.qr_shopee_destination_url ??
        "",
      qrOtherDestinationUrl:
        inventory.qr_destination_url ??
        inventory.qr_other_destination_url ??
        "",
      officialLineId: inventory.official_line_id ?? "",
      claimCompletionMessage: inventory.claim_completion_message ?? "",
      claimTransferEnabled: inventory.claim_transfer_enabled ?? false,
      claimBankCode: inventory.claim_bank_code ?? "",
      claimBankName: inventory.claim_bank_name ?? "",
      claimBankBranch: inventory.claim_bank_branch ?? "",
      claimBankAccount: inventory.claim_bank_account ?? "",
      claimBankAccountName: inventory.claim_bank_account_name ?? "",
      ownerIds: (memberships ?? [])
        .filter(
          (membership) =>
            membership.inventory_id === inventory.id && membership.is_owner,
        )
        .map((membership) => membership.user_id),
    })),
    availableUsers: (owners ?? []).map((owner) => ({
      id: owner.id,
      name: owner.display_name?.trim() || "未命名使用者",
    })),
  });
}
