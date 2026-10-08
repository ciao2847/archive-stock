import {
  periodSchema,
  periodCostSchema,
  type AccountingData,
  type PeriodCost,
  type Settlement,
} from "@/lib/accounting";
import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import { accountingFailure } from "@/lib/api/accounting-server";

export async function GET(request: Request) {
  return withApiErrorHandling("GET /api/accounting", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const parsed = periodSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) return apiFailure("請選擇完整的雙月帳期", 400);
    const { ownerId, start, end } = parsed.data;
    if (auth.role !== "admin" && ownerId !== auth.inventoryOwnerId)
      return apiFailure("無法查看其他庫藏的帳期", 403);
    const [costResult, previewResult, historyResult] = await Promise.all([
      auth.supabase
        .from("financial_period_costs")
        .select(
          "id,owner_id,period_start,period_end,amount,notes,revision,updated_at",
        )
        .eq("owner_id", ownerId)
        .eq("period_start", start)
        .maybeSingle(),
      auth.supabase.rpc("get_financial_period_preview", {
        p_owner_id: ownerId,
        p_start: start,
        p_end: end,
      }),
      auth.supabase
        .from("settlements")
        .select(
          "id,settlement_no,period_start,period_end,revenue,cost,profit,created_at,cost_source",
        )
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false }),
    ]);
    const error =
      costResult.error ?? previewResult.error ?? historyResult.error;
    if (error) return accountingFailure(error.message, error.code);
    const cost = costResult.data as PeriodCost | null;
    let revisions: AccountingData["revisions"] = [];
    if (cost) {
      const result = await auth.supabase
        .from("financial_period_cost_revisions")
        .select("revision,amount,notes,changed_at")
        .eq("cost_id", cost.id)
        .order("revision", { ascending: false });
      if (result.error)
        return accountingFailure(result.error.message, result.error.code);
      revisions = result.data ?? [];
    }
    return apiSuccess<AccountingData>({
      cost,
      preview: previewResult.data as unknown as AccountingData["preview"],
      history: historyResult.data as Settlement[],
      revisions,
    });
  });
}

export async function PUT(request: Request) {
  return withApiErrorHandling("PUT /api/accounting", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const parsed = periodCostSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return apiFailure(
        parsed.error.issues[0]?.message ?? "成本資料格式不正確",
        400,
      );
    const input = parsed.data;
    if (auth.role !== "admin" && input.ownerId !== auth.inventoryOwnerId)
      return apiFailure("無法修改其他庫藏的成本", 403);
    // Keep archived attachments intact when a previously saved total is corrected.
    // Clients can only submit the manual amount and notes, never new image paths.
    const existing = await auth.supabase
      .from("financial_period_costs")
      .select("calculator_path,evidence_paths")
      .eq("owner_id", input.ownerId)
      .eq("period_start", input.start)
      .maybeSingle();
    if (existing.error)
      return accountingFailure(existing.error.message, existing.error.code);
    const { data, error } = await auth.supabase.rpc(
      "confirm_financial_period_cost",
      {
        p_owner_id: input.ownerId,
        p_start: input.start,
        p_end: input.end,
        p_amount: input.amount,
        p_calculator_path: (existing.data?.calculator_path ??
          null) as unknown as string,
        p_evidence_paths: existing.data?.evidence_paths ?? [],
        p_notes: input.notes,
        p_expected_revision: input.expectedRevision,
      },
    );
    if (error) return accountingFailure(error.message, error.code);
    return apiSuccess({ cost: data });
  });
}
