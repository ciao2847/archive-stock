"use client";

import { ErrorMessage } from "@/components/ui/ErrorMessage";

import { LoadingState } from "@/components/ui/LoadingState";

import { RefreshButton } from "@/components/ui/RefreshButton";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import {
  ResponsiveTable,
  type TableColumn,
} from "@/components/ui/ResponsiveTable";
import { PeriodAccountingEditor } from "./PeriodAccountingEditor";
import { getAccounting } from "@/lib/api/accounting";
import { getBimonthlyPeriod, getCurrentPeriod } from "@/lib/accounting";

const money = (amount: number) =>
  `NT$ ${amount.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
const COLUMNS: TableColumn[] = [
  { key: "id", label: "結算編號" },
  { key: "period", label: "帳期" },
  { key: "revenue", label: "營收", className: "max-sm:hidden" },
  { key: "cost", label: "成本", className: "max-sm:hidden" },
  { key: "profit", label: "結餘" },
  { key: "source", label: "成本來源", className: "max-sm:hidden" },
];

export function SettlementPanel({ ownerId }: { ownerId: string }) {
  return <AccountingWorkspace key={ownerId} ownerId={ownerId} />;
}

function AccountingWorkspace({ ownerId }: { ownerId: string }) {
  const current = getCurrentPeriod();
  const [year, setYear] = useState(Number(current.start.slice(0, 4)));
  const [month, setMonth] = useState(Number(current.start.slice(5, 7)));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const canLeave = () =>
    !dirty || window.confirm("有尚未儲存的成本或分帳設定，確定放棄修改？");
  const period = getBimonthlyPeriod(year, month);
  const queryClient = useQueryClient();
  const queryKey = ["accounting", ownerId, period.start, period.end];
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: ({ signal }) => getAccounting({ ownerId, ...period }, signal),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["account"] }),
      queryClient.invalidateQueries({ queryKey }),
    ]);
  }
  return (
    <div className="accounting-cost-fields">
      <section className="card accounting-period">
        <div className="accounting-period-fields">
          <label className="field">
            <span>年份</span>
            <input
              type="number"
              min="2000"
              max="2100"
              value={year}
              disabled={busy}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (value >= 2000 && value <= 2100 && canLeave())
                  setYear(value);
              }}
            />
          </label>
          <label className="field">
            <span>雙月帳期</span>
            <select
              aria-label="雙月帳期"
              value={month}
              disabled={busy}
              onChange={(event) => {
                if (canLeave()) setMonth(Number(event.target.value));
              }}
            >
              {[1, 3, 5, 7, 9, 11].map((value) => (
                <option key={value} value={value}>
                  {value}–{value + 1} 月
                </option>
              ))}
            </select>
          </label>
          <RefreshButton
            label="重新載入"
            loading={isFetching}
            onClick={() => {
              if (canLeave()) void refetch();
            }}
            disabled={busy}
            className="accounting-reload"
          />
        </div>
        <p className="accounting-period-description text-default">
          <CalendarDays size={15} aria-hidden="true" />
          <span>
            {period.start} ～ {period.end}
          </span>
        </p>
      </section>
      {isPending ? (
        <LoadingState text="正在讀取帳期…" />
      ) : error ? (
        <ErrorMessage as="div" variant="panel">
          {error.message}
        </ErrorMessage>
      ) : (
        data && (
          <PeriodAccountingEditor
            key={`${ownerId}:${period.start}:${data.cost?.revision ?? 0}:${data.preview.settled}`}
            ownerId={ownerId}
            period={period}
            data={data}
            setBusy={setBusy}
            onDirtyChange={setDirty}
            onSaved={refresh}
          />
        )
      )}
      <ResponsiveTable
        columns={COLUMNS}
        tableClassName="max-sm:!min-w-0 max-sm:[&_td]:px-2 max-sm:[&_th]:px-2"
        header={
          <div className="card-head">
            <div>
              <h2>歷史結算紀錄</h2>
              <p>每兩個月的結算紀錄，確認後鎖定。舊制紀錄保留供回查。</p>
            </div>
          </div>
        }
        empty={
          data && data.history.length === 0 ? (
            <div className="empty">尚未建立結算紀錄</div>
          ) : undefined
        }
      >
        {(data?.history ?? []).map((row) => (
          <tr key={row.id}>
            <td>
              <code className="break-all text-xs">{row.settlement_no}</code>
            </td>
            <td>
              <button
                type="button"
                className="text-primary underline"
                disabled={busy || row.cost_source !== "period_total"}
                onClick={() => {
                  if (row.period_start && canLeave()) {
                    setYear(Number(row.period_start.slice(0, 4)));
                    setMonth(Number(row.period_start.slice(5, 7)));
                  }
                }}
              >
                <span className="max-sm:hidden">
                  {row.period_start || "不限"} ～ {row.period_end || "不限"}
                </span>
                <span className="sm:hidden">
                  {row.cost_source === "period_total" && row.period_start ? (
                    `${row.period_start.slice(0, 4)}/${Number(row.period_start.slice(5, 7))}–${Number(row.period_start.slice(5, 7)) + 1} 月`
                  ) : (
                    <>
                      {row.period_start || "不限"}
                      <br />～{row.period_end || "不限"}
                    </>
                  )}
                </span>
              </button>
            </td>
            <td className="max-sm:hidden">{money(row.revenue)}</td>
            <td className="max-sm:hidden">{money(row.cost)}</td>
            <td>
              <b
                className={
                  row.profit < 0
                    ? "text-danger-strong"
                    : "text-secondary-strong"
                }
              >
                {money(row.profit)}
              </b>
            </td>
            <td className="max-sm:hidden">
              {row.cost_source === "period_total" ? "帳期總額" : "舊制批次成本"}
            </td>
          </tr>
        ))}
      </ResponsiveTable>
    </div>
  );
}
