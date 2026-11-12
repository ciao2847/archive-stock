"use client";
import type { useProductCostDraft } from "@/hooks/useProductCostDraft";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import styles from "../../../styles/components/products/ProductCostFields.module.scss";
export function ProductCostFields({
  draft,
}: {
  draft: ReturnType<typeof useProductCostDraft>;
}) {
  if (draft.loading)
    return (
      <p className="text-sm text-muted" role="status">
        正在載入成本設定…
      </p>
    );
  if (draft.error)
    return (
      <div>
        <ErrorMessage>{draft.error}</ErrorMessage>
        <button type="button" onClick={draft.reload}>
          重新載入成本設定
        </button>
      </div>
    );
  if (draft.mode !== "product_fifo") return null;
  const sources = [
    ...new Set(
      draft.rows
        .map((r) => r.sourceBatchId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  return (
    <section className={styles.editor} aria-label="進貨批次與總成本">
      <div className={styles.heading}>
        <div>
          <h3>進貨批次與總成本</h3>
          <p>每批填張數及整批總成本，系統自動平均。庫存由批次數量計算。</p>
        </div>
        <button type="button" className="outline" onClick={draft.add}>
          ＋新增進貨批次
        </button>
      </div>
      {!draft.rows.length && <p>尚未進貨可先不新增批次。</p>}
      {sources.map((id) => (
        <div key={id} className={styles.split}>
          <span>
            拆分原批次 {draft.originals.find((r) => r.id === id)?.quantity}{" "}
            張，拆分合計：
            {draft.rows
              .filter((r) => r.sourceBatchId === id)
              .reduce((n, r) => n + (Number(r.quantity) || 0), 0)}{" "}
            張
          </span>
          <button
            type="button"
            className="outline"
            onClick={() => draft.addSplitPart(id)}
          >
            新增拆分列
          </button>
          <button
            type="button"
            className="outline"
            onClick={() => draft.undoSplit(id)}
          >
            取消拆分
          </button>
        </div>
      ))}
      {draft.rows.map((row, index) => {
        const quantity = Number(row.quantity),
          total = row.totalCost.trim() ? Number(row.totalCost) : null;
        return (
          <article className={styles.batch} key={row.key}>
            <div className={styles.rowHead}>
              <strong>
                第 {index + 1} 批
                {row.sourceBatchId
                  ? " · 拆分"
                  : row.id
                    ? " · 既有庫存"
                    : " · 新進貨"}
              </strong>
              {row.id && !row.locked && quantity >= 2 ? (
                <button
                  type="button"
                  className="outline"
                  onClick={() => draft.split(row.key)}
                >
                  拆分批次
                </button>
              ) : !row.id && !row.sourceBatchId ? (
                <button
                  type="button"
                  className="outline"
                  onClick={() => draft.remove(row.key)}
                >
                  移除此批
                </button>
              ) : row.sourceBatchId &&
                draft.rows.filter(
                  (part) => part.sourceBatchId === row.sourceBatchId,
                ).length > 2 ? (
                <button
                  type="button"
                  className="outline"
                  onClick={() => draft.remove(row.key)}
                >
                  移除拆分列
                </button>
              ) : null}
            </div>
            <div className={styles.fields}>
              <label className="field">
                <span>第 {index + 1} 批進貨日期</span>
                <input
                  type="date"
                  value={row.date}
                  disabled={Boolean(row.id) || row.locked}
                  onChange={(e) =>
                    draft.update(row.key, { date: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>第 {index + 1} 批張數</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={row.quantity}
                  disabled={Boolean(row.id) || row.locked}
                  onChange={(e) =>
                    draft.update(row.key, { quantity: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>第 {index + 1} 批總成本（TWD）</span>
                <input
                  type="number"
                  min="0"
                  max="9999999999.99"
                  step="0.01"
                  value={row.totalCost}
                  disabled={row.locked}
                  placeholder="整批購入金額"
                  onChange={(e) =>
                    draft.update(row.key, { totalCost: e.target.value })
                  }
                />
              </label>
              <div className={styles.average}>
                <span>平均每張成本</span>
                <strong>
                  {total !== null && Number.isFinite(total) && quantity > 0
                    ? `NT$ ${(total / quantity).toLocaleString("zh-TW", { maximumFractionDigits: 6 })}`
                    : "待填"}
                </strong>
              </div>
            </div>
            <label className="field">
              <span>第 {index + 1} 批備註</span>
              <input
                value={row.notes}
                maxLength={1000}
                disabled={row.locked}
                onChange={(e) =>
                  draft.update(row.key, { notes: e.target.value })
                }
              />
            </label>
            {row.remaining !== undefined && (
              <small>
                剩餘 {row.remaining} 張
                {row.locked ? " · 已列入結算，成本鎖定" : ""}
              </small>
            )}
          </article>
        );
      })}
      <p className={styles.summary}>
        儲存後庫存：<strong>{draft.stock} 張</strong>
        。平均成本的小數尾差會隨實際售出數量分配，整批加總與輸入總成本一致。
      </p>
    </section>
  );
}
