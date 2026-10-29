"use client";

import { Spinner } from "@/components/ui/Spinner";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

import { useEffect, useState } from "react";
import {
  Banknote,
  ReceiptText,
  TrendingUp,
  CheckCircle2,
  Circle,
  Download,
  LockKeyhole,
  Plus,
  Save,
  Trash2,
  WalletCards,
} from "lucide-react";
import { useDirtyBack } from "@/components/navigation/BackNavigation";
import { backDashboardPath } from "@/lib/dashboard-navigation";
import { createSettlement } from "@/lib/api/settlements";
import {
  downloadAccountingExcel,
  savePeriodDetails,
} from "@/lib/api/accounting";
import { type AccountingData, type getBimonthlyPeriod } from "@/lib/accounting";
import {
  allocateProfit,
  COST_CATEGORIES,
  periodDetailsSchema,
  percentToBasisPoints,
  sumCostEntries,
  type CostEntry,
  type ProfitShare,
} from "@/lib/accounting-details";
import styles from "../../../styles/components/settlement/PeriodAccountingEditor.module.scss";

type EntryDraft = Omit<CostEntry, "amount"> & { amount: string };
type ShareDraft = Omit<ProfitShare, "basisPoints"> & { percent: string };
const money = (amount: number) =>
  `NT$ ${amount.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;

export function PeriodAccountingEditor({
  ownerId,
  period,
  data,
  setBusy,
  onDirtyChange,
  onSaved,
}: {
  ownerId: string;
  period: ReturnType<typeof getBimonthlyPeriod>;
  data: AccountingData;
  setBusy: (value: boolean) => void;
  onDirtyChange: (value: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [initial] = useState(() => ({
    entries: (data.cost?.cost_entries?.length
      ? data.cost.cost_entries
      : data.cost && data.cost.amount > 0
        ? [
            {
              id: data.cost.id,
              date: period.start,
              category: "其他" as const,
              name: "歷史成本總額",
              amount: data.cost.amount,
              notes: data.cost.notes,
            },
          ]
        : []
    ).map((entry) => ({ ...entry, amount: String(entry.amount) })),
    shares: (data.cost?.share_rules ?? []).map((share) => ({
      id: share.id,
      name: share.name,
      percent: String(share.basisPoints / 100),
    })),
    notes: data.cost?.notes ?? "",
  }));
  const [entries, setEntries] = useState<EntryDraft[]>(initial.entries);
  const [shares, setShares] = useState<ShareDraft[]>(initial.shares);
  const [notes, setNotes] = useState(initial.notes);
  const [confirmed, setConfirmed] = useState(false);
  const [exportScope, setExportScope] = useState<"period" | "all">("period");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const locked = data.preview.settled || Boolean(data.preview.blocked_reason);
  const hasEdits =
    JSON.stringify({ entries, shares, notes }) !== JSON.stringify(initial);
  const dirty = !data.cost || hasEdits;
  useEffect(() => {
    onDirtyChange(hasEdits);
    return () => onDirtyChange(false);
  }, [hasEdits, onDirtyChange]);
  useDirtyBack({
    enabled: hasEdits,
    dirty: hasEdits,
    busy: working,
    onBack: () => {
      setEntries(initial.entries);
      setShares(initial.shares);
      setNotes(initial.notes);
      setConfirmed(false);
      backDashboardPath();
    },
  });
  const numericEntries = entries.map((entry) => ({
    ...entry,
    amount: entry.amount.trim() ? Number(entry.amount) : NaN,
  }));
  const numericShares = shares.map((share) => ({
    id: share.id,
    name: share.name,
    basisPoints: percentToBasisPoints(share.percent),
  }));
  const input = {
    ownerId,
    start: period.start,
    end: period.end,
    entries: numericEntries,
    shares: numericShares,
    notes,
    expectedRevision: data.cost?.revision ?? 0,
    confirmed: true as const,
  };
  const validation = periodDetailsSchema.safeParse(input);
  const total = sumCostEntries(
    numericEntries.filter((entry) => Number.isFinite(entry.amount)),
  );
  const profit = Math.round((data.preview.revenue - total) * 100) / 100;
  const ratio = shares.reduce(
    (sum, share) => sum + (Number(share.percent) || 0),
    0,
  );
  const allocations = validation.success
    ? allocateProfit(profit, validation.data.shares)
    : [];
  const changed = () => {
    setConfirmed(false);
    setSuccess("");
  };
  function updateEntry(id: string, patch: Partial<EntryDraft>) {
    changed();
    setEntries((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    );
  }
  function updateShare(id: string, patch: Partial<ShareDraft>) {
    changed();
    setShares((current) =>
      current.map((share) =>
        share.id === id ? { ...share, ...patch } : share,
      ),
    );
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
      throw new Error(
        validation.error?.issues[0]?.message ?? "請確認成本與分帳資料",
      );
    await savePeriodDetails(validation.data);
    await onSaved();
    setSuccess("成本與分帳已儲存");
  }
  async function settle() {
    if (!data.cost || dirty) throw new Error("請先儲存成本與分帳設定");
    if (
      !window.confirm(
        `本期營收 ${money(data.preview.revenue)}、成本 ${money(total)}、盈虧 ${money(profit)}。結算後將鎖定成本與分帳比例，確定結算？`,
      )
    )
      return;
    await createSettlement({ ownerId, start: period.start, end: period.end });
    await onSaved();
  }
  return (
    <div className={styles.workspace}>
      <div className={styles.summary}>
        {[
          {
            label: "本期營收",
            value: data.preview.revenue,
            icon: Banknote,
            tone: "revenue",
            caption: "已包裝／已出貨訂單",
          },
          {
            label: "成本合計",
            value: total,
            icon: ReceiptText,
            tone: "cost",
            caption: `共 ${entries.length} 筆成本明細`,
          },
          {
            label: locked ? "本期盈虧" : "預估盈虧",
            value: profit,
            icon: TrendingUp,
            tone: "profit",
            caption: "營收－成本",
          },
        ].map((item) => (
          <article className="card" key={item.label} data-tone={item.tone}>
            <div className={styles.summaryIcon}>
              <item.icon size={22} aria-hidden="true" />
            </div>
            <div className={styles.summaryText}>
              <span>{item.label}</span>
              <strong className={item.value < 0 ? "text-danger-strong" : ""}>
                {money(item.value)}
              </strong>
              <small>{item.caption}</small>
            </div>
          </article>
        ))}
      </div>
      <section
        className={`card ${styles.section} ${styles.detail}`}
        aria-label="帳期成本與分帳"
      >
        <header className={styles.header}>
          <div>
            <span className="eyebrow">{period.label}</span>
            <h2>成本與盈餘分帳</h2>
          </div>
          <div className={styles.exportControls}>
            <select
              aria-label="匯出範圍"
              value={exportScope}
              disabled={working}
              onChange={(event) =>
                setExportScope(event.target.value as "period" | "all")
              }
            >
              <option value="period">本期帳目</option>
              <option value="all">全部已存帳期</option>
            </select>
            <button
              type="button"
              className="outline"
              disabled={
                working ||
                dirty ||
                !data.cost ||
                Boolean(data.preview.blocked_reason)
              }
              onClick={() =>
                void run(() =>
                  downloadAccountingExcel({
                    ownerId,
                    start: period.start,
                    end: period.end,
                    scope: exportScope,
                  }),
                )
              }
            >
              <Download size={16} />
              匯出 Excel
            </button>
          </div>
        </header>
        {locked && (
          <p className={styles.lock}>
            <LockKeyhole size={16} />
            {data.preview.settled
              ? "已結算，成本與分帳比例已鎖定"
              : data.preview.blocked_reason}
          </p>
        )}
        <fieldset disabled={locked || working} className={styles.fieldset}>
          <div className={styles.heading}>
            <h3>成本明細 · {entries.length} 筆</h3>
            <button
              type="button"
              className="outline"
              disabled={entries.length >= 500}
              onClick={() => {
                changed();
                setEntries((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    date: period.start,
                    category: "商品購入",
                    name: "",
                    amount: "",
                    notes: "",
                  },
                ]);
              }}
            >
              <Plus size={16} />
              新增成本
            </button>
          </div>
          <div className={styles.entries}>
            {entries.map((entry, index) => (
              <article
                className={styles.entry}
                key={entry.id}
                aria-label={`成本第 ${index + 1} 筆`}
              >
                <label className="field">
                  <span>日期</span>
                  <input
                    type="date"
                    aria-label={`成本日期 ${index + 1}`}
                    min={period.start}
                    max={period.end}
                    value={entry.date}
                    onChange={(event) =>
                      updateEntry(entry.id, { date: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>分類</span>
                  <select
                    aria-label={`成本分類 ${index + 1}`}
                    value={entry.category}
                    onChange={(event) =>
                      updateEntry(entry.id, {
                        category: event.target.value as CostEntry["category"],
                        ...(!entry.name ? { name: event.target.value } : {}),
                      })
                    }
                  >
                    {COST_CATEGORIES.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <label className={`field ${styles.entryName}`}>
                  <span>成本項目</span>
                  <input
                    aria-label={`成本項目 ${index + 1}`}
                    value={entry.name}
                    maxLength={200}
                    placeholder="例如：韓國第一批國際運費"
                    onChange={(event) =>
                      updateEntry(entry.id, { name: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>金額（TWD）</span>
                  <input
                    aria-label={`成本金額 ${index + 1}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={entry.amount}
                    onChange={(event) =>
                      updateEntry(entry.id, { amount: event.target.value })
                    }
                  />
                </label>
                <div className={styles.entryNotesRow}>
                  <label className={`field ${styles.entryNotes}`}>
                    <span>備註（選填）</span>
                    <input
                      aria-label={`成本備註 ${index + 1}`}
                      value={entry.notes}
                      maxLength={1000}
                      onChange={(event) =>
                        updateEntry(entry.id, { notes: event.target.value })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className={`outline ${styles.remove}`}
                    aria-label={`移除成本 ${index + 1}`}
                    onClick={() => {
                      changed();
                      setEntries((current) =>
                        current.filter((row) => row.id !== entry.id),
                      );
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
            {!entries.length && <p className={styles.empty}>尚無成本明細</p>}
          </div>
          <div className={styles.total}>
            <span>成本合計</span>
            <strong>{money(total)}</strong>
          </div>
          <div className={styles.heading}>
            <div>
              <h3>盈餘分帳</h3>
              <span
                className={
                  shares.length && Math.round(ratio * 100) !== 10000
                    ? "text-danger-strong"
                    : "text-muted"
                }
              >
                比例合計 {Number(ratio.toFixed(2))}%
              </span>
            </div>
            <button
              type="button"
              className="outline"
              disabled={shares.length >= 20}
              onClick={() => {
                changed();
                setShares((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    name: "",
                    percent: current.length ? "" : "100",
                  },
                ]);
              }}
            >
              <Plus size={16} />
              新增對象
            </button>
          </div>
          <div className={styles.shares}>
            {shares.map((share, index) => (
              <article className={styles.share} key={share.id}>
                <label className="field">
                  <span>分帳對象</span>
                  <input
                    aria-label={`分帳對象 ${index + 1}`}
                    value={share.name}
                    maxLength={100}
                    onChange={(event) =>
                      updateShare(share.id, { name: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>比例（%）</span>
                  <input
                    aria-label={`分帳比例 ${index + 1}`}
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={share.percent}
                    onChange={(event) =>
                      updateShare(share.id, { percent: event.target.value })
                    }
                  />
                </label>
                <div className={styles.payout}>
                  <span>{profit < 0 ? "虧損分攤" : "分潤金額"}</span>
                  <strong>
                    {allocations.find((row) => row.id === share.id)
                      ? money(
                          allocations.find((row) => row.id === share.id)!
                            .amount,
                        )
                      : "待確認比例"}
                  </strong>
                </div>
                <button
                  type="button"
                  className={`outline ${styles.remove}`}
                  aria-label={`移除分帳對象 ${index + 1}`}
                  onClick={() => {
                    changed();
                    setShares((current) =>
                      current.filter((row) => row.id !== share.id),
                    );
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
            {!shares.length && <p className={styles.empty}>尚未設定分帳對象</p>}
          </div>
          {profit < 0 && (
            <p className="text-danger-strong">
              本期虧損 {money(-profit)}，依設定比例分攤。
            </p>
          )}
          <label className="field">
            <span>帳期備註（選填）</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(event) => {
                changed();
                setNotes(event.target.value);
              }}
            />
          </label>
          {!locked && (
            <div className={styles.save}>
              {dirty && !validation.success && (
                <p className="text-danger-strong" role="status">
                  {validation.error.issues[0]?.message}
                </p>
              )}
              <label className="accounting-confirmation">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                已核對成本明細與分帳比例
              </label>
              <button
                type="button"
                className="primary"
                disabled={!dirty || !confirmed || !validation.success}
                onClick={() => void run(save)}
              >
                <Save size={16} />
                儲存成本與分帳
              </button>
            </div>
          )}
        </fieldset>
        {working && (
          <p role="status" className={styles.lock}>
            <Spinner size={16} />
            處理中…
          </p>
        )}
        {error && (
          <ErrorMessage as="div" variant="panel">
            {error}
          </ErrorMessage>
        )}
        {success && <p role="status">{success}</p>}
        {data.revisions.length > 0 && (
          <details className={styles.revisions}>
            <summary>修改紀錄（{data.revisions.length} 版）</summary>
            {data.revisions.map((revision) => (
              <div key={revision.revision}>
                <strong>
                  第 {revision.revision} 版 · {money(revision.amount)}
                </strong>
                <span>
                  {new Date(revision.changed_at).toLocaleString("zh-TW", {
                    timeZone: "Asia/Taipei",
                  })}
                </span>
                {revision.cost_entries?.map((entry) => (
                  <p key={entry.id}>
                    {entry.date} · {entry.category} · {entry.name} ·{" "}
                    {money(entry.amount)}
                    {entry.notes ? ` · ${entry.notes}` : ""}
                  </p>
                ))}
                {revision.share_rules?.map((share) => (
                  <p key={share.id}>
                    {share.name} · {share.basisPoints / 100}%
                  </p>
                ))}
                {revision.notes && <p>{revision.notes}</p>}
              </div>
            ))}
          </details>
        )}
      </section>
      {!locked && (
        <section
          className={`card ${styles.section} ${styles.settlement}`}
          aria-label="本期結算"
        >
          <h2>本期結算</h2>
          <div className={styles.settlementAmount}>
            <span>{profit < 0 ? "應分攤虧損" : "可分配盈餘"}</span>
            <strong className={profit < 0 ? "text-danger-strong" : ""}>
              {money(Math.abs(profit))}
            </strong>
          </div>
          <div className={styles.checklist}>
            <h3>結算前檢查</h3>
            {[
              { label: "成本資料已核對", done: Boolean(data.cost) && !dirty },
              {
                label: shares.length ? "分帳比例合計 100%" : "不設定分帳",
                done: !shares.length || Math.round(ratio * 100) === 10000,
              },
              { label: "已儲存成本與分帳", done: Boolean(data.cost) && !dirty },
            ].map((check) => (
              <div key={check.label} data-complete={check.done}>
                {check.done ? (
                  <CheckCircle2 size={16} aria-hidden="true" />
                ) : (
                  <Circle size={16} aria-hidden="true" />
                )}
                <span>{check.label}</span>
              </div>
            ))}
          </div>
          {dirty && (
            <p className={styles.pending}>尚有未儲存的成本或分帳設定</p>
          )}
          <button
            type="button"
            className="primary"
            disabled={working || dirty || !data.cost}
            onClick={() => void run(settle)}
          >
            <WalletCards size={16} />
            確認結算
          </button>
        </section>
      )}
    </div>
  );
}
