"use client";

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Save,
  WalletCards,
} from "lucide-react";
import {
  ResponsiveTable,
  type TableColumn,
} from "@/components/ui/ResponsiveTable";
import { createSettlement } from "@/lib/api/settlements";
import { getAccounting, savePeriodCost } from "@/lib/api/accounting";
import {
  getBimonthlyPeriod,
  getCurrentPeriod,
  periodCostSchema,
  type AccountingData,
} from "@/lib/accounting";

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
  const period = getBimonthlyPeriod(year, month);
  const queryClient = useQueryClient();
  const queryKey = ["accounting", ownerId, period.start, period.end];
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: ({ signal }) => getAccounting({ ownerId, ...period }, signal),
    staleTime: 0,
    retry: false,
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
                if (value >= 2000 && value <= 2100) setYear(value);
              }}
            />
          </label>
          <label className="field">
            <span>雙月帳期</span>
            <select
              value={month}
              disabled={busy}
              onChange={(event) => setMonth(Number(event.target.value))}
            >
              {[1, 3, 5, 7, 9, 11].map((value) => (
                <option key={value} value={value}>
                  {value}–{value + 1} 月
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="outline accounting-reload"
            disabled={busy || isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw size={16} />
            重新載入
          </button>
        </div>
        <p className="accounting-period-description text-default">
          {period.start} ～ {period.end}
          。購入成本全部歸入本期，包含尚未售出的商品。
        </p>
      </section>
      {isPending ? (
        <div className="card flex min-h-40 items-center justify-center gap-2">
          <LoaderCircle className="animate-spin" />
          載入帳期…
        </div>
      ) : error ? (
        <div className="data-error" role="alert">
          {error.message}
        </div>
      ) : (
        data && (
          <PeriodEditor
            key={`${ownerId}:${period.start}:${data.cost?.revision ?? 0}:${data.preview.settled}`}
            ownerId={ownerId}
            period={period}
            data={data}
            setBusy={setBusy}
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
                  if (row.period_start) {
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

function PeriodEditor({
  ownerId,
  period,
  data,
  setBusy,
  onSaved,
}: {
  ownerId: string;
  period: ReturnType<typeof getBimonthlyPeriod>;
  data: AccountingData;
  setBusy: (busy: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(
    data.cost ? String(data.cost.amount) : "",
  );
  const [notes, setNotes] = useState(data.cost?.notes ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const locked = data.preview.settled || Boolean(data.preview.blocked_reason);
  const dirty =
    !data.cost ||
    amount !== String(data.cost.amount) ||
    notes !== data.cost.notes;
  const input = {
    ownerId,
    start: period.start,
    end: period.end,
    amount: amount.trim() ? Number(amount) : NaN,
    notes,
    expectedRevision: data.cost?.revision ?? 0,
    confirmed: true as const,
  };
  const validation = periodCostSchema.safeParse(input);
  function changed() {
    setConfirmed(false);
    setSuccess("");
  }
  async function run(action: () => Promise<void>) {
    setWorking(true);
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "處理失敗");
    } finally {
      setWorking(false);
      setBusy(false);
    }
  }
  async function save() {
    if (!confirmed || !validation.success)
      throw new Error("請確認本期成本總額後再儲存");
    await savePeriodCost(validation.data);
    setConfirmed(false);
    await onSaved();
    setSuccess("本期成本已確認儲存");
  }
  async function settle() {
    if (!data.cost || dirty) throw new Error("請先儲存本期成本");
    await createSettlement({ ownerId, start: period.start, end: period.end });
    await onSaved();
  }
  return (
    <>
      <section className="accounting-summary-grid">
        <Summary
          label={data.preview.settled ? "海報總營收（已結算）" : "海報總營收"}
          value={data.preview.revenue}
        />
        <Summary label="已確認成本" value={data.cost?.amount} />
        <Summary
          label={data.preview.settled ? "本期結餘（已結算）" : "預估結餘"}
          value={
            data.cost ? data.preview.revenue - data.cost.amount : undefined
          }
        />
      </section>
      <section className="card accounting-cost">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="accounting-title">{period.label}成本總額</h2>
            <p className="accounting-description text-default">
              每期只有一筆總額，重新儲存會更新，不會重複累加。
              {data.cost ? ` 已保存第 ${data.cost.revision} 版。` : ""}
            </p>
          </div>
          {locked && (
            <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-sm">
              <LockKeyhole size={17} />
              {data.preview.settled ? "已結算" : "歷史結算重疊"}
            </span>
          )}
        </div>
        {data.preview.blocked_reason && (
          <div className="data-error">{data.preview.blocked_reason}</div>
        )}
        <fieldset
          disabled={locked || working}
          className="accounting-cost-fields"
        >
          <label className="field">
            <span>本期成本總額（台幣）</span>
            <input
              type="number"
              min="0"
              step="0.01"
              max="999999999999.99"
              value={amount}
              placeholder="手動填入這兩個月的成本總額"
              onChange={(event) => {
                changed();
                setAmount(event.target.value);
              }}
            />
            <small className="text-default">
              包含本期購入款、運費、平台費與其他支出。外幣支出請換算為實際台幣付款金額。
            </small>
          </label>
          <label className="field">
            <span>備註</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(event) => {
                changed();
                setNotes(event.target.value);
              }}
              placeholder="例如：包含韓國購入及國際運費"
            />
          </label>
          {!locked && (
            <>
              <label className="accounting-confirmation">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                我已核對金額，確認這是本期完整的台幣成本總額。
              </label>
              <button
                type="button"
                className="primary accounting-action"
                disabled={!confirmed || !validation.success || !dirty}
                onClick={() => void run(save)}
              >
                <Save size={17} />
                確認並儲存成本
              </button>
            </>
          )}
        </fieldset>
        {working && (
          <p className="flex items-center gap-2 text-sm" role="status">
            <LoaderCircle className="animate-spin" size={17} />
            正在處理，請稍候…
          </p>
        )}
        {error && (
          <div className="data-error" role="alert">
            {error}
          </div>
        )}
        {success && (
          <p className="text-sm text-secondary-strong" role="status">
            {success}
          </p>
        )}
        {data.revisions.length > 0 && (
          <details className="rounded-xl border border-line p-4">
            <summary className="cursor-pointer text-sm font-semibold">
              成本修改紀錄（{data.revisions.length} 版）
            </summary>
            <div className="mt-3 space-y-3">
              {data.revisions.map((revision) => (
                <div
                  className="border-t border-line pt-3 text-sm"
                  key={revision.revision}
                >
                  <p>
                    第 {revision.revision} 版 · {money(revision.amount)} ·{" "}
                    {new Date(revision.changed_at).toLocaleString("zh-TW", {
                      timeZone: "Asia/Taipei",
                    })}
                  </p>
                  {revision.notes && (
                    <p className="mt-1 whitespace-pre-wrap text-default">
                      {revision.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </section>
      {!locked && (
        <section className="card accounting-settle">
          <h2 className="accounting-title">{period.label}結算</h2>
          <dl className="accounting-breakdown">
            <div>
              <dt>海報總營收</dt>
              <dd>{money(data.preview.revenue)}</dd>
            </div>
            <div>
              <dt>手動填寫總成本</dt>
              <dd>{data.cost ? money(data.cost.amount) : "尚未填寫"}</dd>
            </div>
            <div className="accounting-balance">
              <dt>本期結餘</dt>
              <dd
                className={
                  data.cost && data.preview.revenue - data.cost.amount < 0
                    ? "text-danger-strong"
                    : "text-secondary-strong"
                }
              >
                {data.cost
                  ? money(data.preview.revenue - data.cost.amount)
                  : "待確認成本"}
              </dd>
            </div>
          </dl>
          {dirty && <p className="text-sm text-default">請先儲存本期成本。</p>}
          <button
            type="button"
            className="primary accounting-action"
            disabled={working || dirty || !data.cost}
            onClick={() => void run(settle)}
          >
            <WalletCards size={17} />
            確認結算
          </button>
        </section>
      )}
    </>
  );
}
function Summary({ label, value }: { label: ReactNode; value?: number }) {
  return (
    <article className="card accounting-summary">
      <small className="text-default">{label}</small>
      <strong
        className={`accounting-summary-value ${value !== undefined && value < 0 ? "text-danger-strong" : ""}`}
      >
        {value === undefined ? "待確認成本" : money(value)}
      </strong>
    </article>
  );
}
