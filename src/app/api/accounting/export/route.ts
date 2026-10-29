import { periodSchema } from "@/lib/accounting";
import { type AccountingReport } from "@/lib/accounting-details";
import {
  buildAccountingWorkbook,
  buildCombinedAccountingWorkbook,
} from "@/lib/accounting-excel";
import { accountingFailure } from "@/lib/api/accounting-server";
import {
  apiFailure,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return withApiErrorHandling("GET /api/accounting/export", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const parsed = periodSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) return apiFailure("請選擇完整的雙月帳期", 400);
    const { ownerId, start, end } = parsed.data;
    if (auth.role !== "admin" && ownerId !== auth.inventoryOwnerId)
      return apiFailure("無法匯出其他庫藏的帳目", 403);
    const scope = new URL(request.url).searchParams.get("scope") ?? "period";
    if (!["period", "all"].includes(scope))
      return apiFailure("匯出範圍不正確", 400);
    const periods: Array<{ start: string; end: string }> = [];
    if (scope === "all") {
      const result = await auth.supabase.rpc("get_financial_report_periods", {
        p_owner_id: ownerId,
      });
      if (result.error)
        return accountingFailure(result.error.message, result.error.code);
      periods.push(
        ...(result.data as unknown as Array<{ start: string; end: string }>),
      );
      if (!periods.length) return apiFailure("尚無已儲存的帳期可匯出", 409);
    } else periods.push({ start, end });
    const reports: AccountingReport[] = [];
    for (const period of periods) {
      const { data, error } = await auth.supabase.rpc(
        "get_financial_period_report",
        { p_owner_id: ownerId, p_start: period.start, p_end: period.end },
      );
      if (error) return accountingFailure(error.message, error.code);
      const report = data as unknown as AccountingReport;
      if (!report.cost) return apiFailure("請先儲存本期成本再匯出", 409);
      if (report.preview.blocked_reason)
        return apiFailure(report.preview.blocked_reason, 409);
      const revenueCents = report.orders.reduce(
        (sum, order) => sum + Math.round(order.revenue * 100),
        0,
      );
      if (revenueCents !== Math.round(report.preview.revenue * 100))
        return apiFailure("訂單正在更新，請重新匯出以確認最新金額", 409);
      reports.push(report);
    }
    const workbook =
      scope === "all"
        ? await buildCombinedAccountingWorkbook(reports)
        : await buildAccountingWorkbook(reports[0]);
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${scope === "all" ? "accounting-all-periods" : `accounting-${start}-${end}`}.xlsx"`,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  });
}
