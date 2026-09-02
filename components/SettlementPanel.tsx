"use client";
import { useCallback, useEffect, useState } from "react";
import {
  CircleDollarSign,
  LoaderCircle,
  LockKeyhole,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { toNumber } from "@/lib/defaults";
import { ResponsiveTable, type TableColumn } from "./ResponsiveTable";
type Settlement = {
  id: string;
  settlement_no: string;
  period_start: string | null;
  period_end: string | null;
  revenue: number;
  cost: number;
  profit: number;
  created_at: string;
};
const SETTLEMENT_COLUMNS: TableColumn[] = [
  { key: "id", label: "結算編號" },
  { key: "period", label: "期間" },
  { key: "revenue", label: "銷售", className: "max-sm:hidden" },
  { key: "cost", label: "成本", className: "max-sm:hidden" },
  { key: "profit", label: "淨利" },
  {
    key: "createdAt",
    label: "結算時間",
    className: "max-sm:hidden",
  },
];
export function SettlementPanel() {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Settlement[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role !== "admin") {
      setLoading(false);
      return;
    }
    setAllowed(true);
    const { data, error: loadError } = await supabase
      .from("settlements")
      .select(
        "id,settlement_no,period_start,period_end,revenue,cost,profit,created_at",
      )
      .order("created_at", { ascending: false });
    if (loadError) setError(loadError.message);
    else
      setHistory(
        (data || []).map((row) => ({
          ...row,
          revenue: toNumber(row.revenue),
          cost: toNumber(row.cost),
          profit: toNumber(row.profit),
        })),
      );
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function settle() {
    setSaving(true);
    setError("");
    const { error: settleError } = await createClient().rpc(
      "create_financial_settlement",
      { p_start: start || null, p_end: end || null },
    );
    if (settleError)
      setError(
        settleError.message === "no unsettled financial data"
          ? "目前沒有尚未結算的收入或成本。"
          : settleError.message,
      );
    else await load();
    setSaving(false);
  }
  const totals = history.reduce(
    (sum, row) => ({
      revenue: sum.revenue + row.revenue,
      cost: sum.cost + row.cost,
      profit: sum.profit + row.profit,
    }),
    { revenue: 0, cost: 0, profit: 0 },
  );
  if (loading)
    return (
      <div className="card flex min-h-64 items-center justify-center gap-2 text-[var(--color-default)]">
        <LoaderCircle className="animate-spin" />
        載入結算資料…
      </div>
    );
  if (!allowed)
    return (
      <div className="card flex min-h-64 flex-col items-center justify-center gap-3 text-[var(--color-default)]">
        <LockKeyhole size={38} />
        <b>只有管理員可以查看財務結算</b>
      </div>
    );
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Summary
          icon={<CircleDollarSign />}
          label="累計銷售"
          value={totals.revenue}
        />
        <Summary icon={<TrendingDown />} label="累計成本" value={totals.cost} />
        <Summary
          icon={<TrendingUp />}
          label="累計淨利"
          value={totals.profit}
          negative={totals.profit < 0}
        />
      </section>
      <section className="card p-5">
        <div className="flex items-end gap-3 max-sm:flex-col max-sm:items-stretch">
          <label className="field flex-1">
            <span>開始日期</span>
            <input
              type="date"
              className="cursor-pointer"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              onClick={(e) => e.currentTarget.showPicker()}
            />
          </label>
          <label className="field flex-1">
            <span>結束日期</span>
            <input
              type="date"
              className="cursor-pointer"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              onClick={(e) => e.currentTarget.showPicker()}
            />
          </label>
          <button
            className="primary h-10 max-sm:w-full"
            onClick={() => void settle()}
            disabled={saving}
          >
            {saving ? (
              <LoaderCircle className="spin" />
            ) : (
              <WalletCards size={17} />
            )}
            確認結算
          </button>
        </div>
        <p className="mt-3 text-[12px] text-[var(--color-default)]">
          只會納入尚未結算的已包裝／已出貨訂單，以及尚未計入的批次成本。
        </p>
        {error && <div className="data-error mt-3">{error}</div>}
      </section>
      <ResponsiveTable
        columns={SETTLEMENT_COLUMNS}
        tableClassName="max-sm:!min-w-0 max-sm:[&_td]:px-2 max-sm:[&_th]:px-2"
        wrapperClassName="[&_thead_tr]:border-t [&_thead_tr]:border-t-[var(--color-line)] [&_thead_th:first-child]:!rounded-tl-none [&_thead_th:last-child]:!rounded-tr-none"
        header={
          <div className="card-head">
            <div>
              <h2>歷史結算紀錄</h2>
              <p>已保存的財務快照不會因日後改價而變動</p>
            </div>
          </div>
        }
        empty={
          history.length === 0 ? (
            <div className="empty">尚未建立結算紀錄</div>
          ) : undefined
        }
      >
            {history.map((row) => (
              <tr key={row.id}>
                <td>
                  <code>{row.settlement_no}</code>
                </td>
                <td>
                  {row.period_start || "不限"} ～ {row.period_end || "不限"}
                </td>
                <td className="max-sm:hidden">
                  NT$ {row.revenue.toLocaleString()}
                </td>
                <td className="max-sm:hidden">
                  NT$ {row.cost.toLocaleString()}
                </td>
                <td>
                  <b
                    className={
                      row.profit < 0
                        ? "text-red-700"
                        : "text-[var(--color-secondary-strong)]"
                    }
                  >
                    NT$ {row.profit.toLocaleString()}
                  </b>
                </td>
                <td className="max-sm:hidden">
                  {new Date(row.created_at).toLocaleString("zh-TW")}
                </td>
              </tr>
            ))}
      </ResponsiveTable>
    </div>
  );
}
function Summary({
  icon,
  label,
  value,
  negative = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  negative?: boolean;
}) {
  return (
    <article className="card flex items-center gap-4 p-5">
      <span className="grid h-11 w-11 place-items-center rounded-lg bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
        {icon}
      </span>
      <div>
        <small className="text-[var(--color-default)]">{label}</small>
        <strong
          className={`mt-1 block text-[20px] ${negative ? "text-red-700" : ""}`}
        >
          NT$ {value.toLocaleString()}
        </strong>
      </div>
    </article>
  );
}
