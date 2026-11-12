"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getProductBatchCosts, saveBatchCost } from "@/lib/api/inventory-costs";
import { batchCostSchema, type CostBatch } from "@/lib/inventory-costs";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import styles from "../../../styles/components/products/ProductBatchCosts.module.scss";
export function ProductBatchCosts({ productId }: { productId: string }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const query = useQuery({
    queryKey: ["product-batch-costs", productId],
    queryFn: ({ signal }) => getProductBatchCosts(productId, signal),
    retry: false,
  });
  if (query.isPending) return <p className={styles.panel}>正在讀取批次成本…</p>;
  if (query.error)
    return (
      <div className={styles.panel}>
        <ErrorMessage>{query.error.message}</ErrorMessage>
        <button
          type="button"
          className="outline"
          onClick={() => void query.refetch()}
        >
          重新載入批次成本
        </button>
      </div>
    );
  if (query.data.mode !== "product_fifo") return null;
  async function refresh() {
    setNotice("批次成本已儲存");
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["product-batch-costs", productId],
      }),
      queryClient.invalidateQueries({ queryKey: ["accounting"] }),
      queryClient.invalidateQueries({ queryKey: ["account"] }),
    ]);
  }
  return (
    <section className={styles.panel} aria-label="商品批次成本">
      <h3>進貨批次與成本</h3>
      {notice && <p role="status">{notice}</p>}
      <p>
        可在「新增／編輯商品」分批輸入張數與整批總成本，系統自動計算平均每張成本。這裡也可調整各批次總成本。
      </p>
      <p>
        已包含在批次總成本的運費，結算時不需再列入額外費用。期初庫存有不同進貨成本時，可在編輯商品中拆分批次。
      </p>
      {!query.data.batches.length && <p>尚無進貨批次；有庫存後會自動建立。</p>}
      {query.data.batches.map((batch, index) => (
        <BatchEditor
          key={`${batch.id}:${batch.revision}`}
          batch={batch}
          index={index + 1}
          onSaved={refresh}
        />
      ))}
    </section>
  );
}
function BatchEditor({
  batch,
  index,
  onSaved,
}: {
  batch: CostBatch;
  index: number;
  onSaved: () => Promise<void>;
}) {
  const [cost, setCost] = useState(
    batch.total_cost === null ||
      (batch.total_cost === undefined && batch.unit_cost === null)
      ? ""
      : String(
          batch.total_cost ??
            Math.round(batch.unit_cost! * batch.quantity * 100) / 100,
        ),
  );
  const [notes, setNotes] = useState(batch.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  async function save() {
    const parsed = batchCostSchema.safeParse({
      batchId: batch.id,
      totalCost: cost.trim() ? Number(cost) : NaN,
      notes,
      expectedRevision: batch.revision,
    });
    if (!parsed.success) {
      setError("請填寫有效的整批總成本，最多兩位小數；零成本請填 0");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess(false);
    try {
      await saveBatchCost(parsed.data);
      await onSaved();
      setSuccess(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "成本儲存失敗");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={styles.batch}>
      <strong>
        第 {index} 批 ·{" "}
        {new Date(batch.received_at).toLocaleDateString("zh-TW", {
          timeZone: "Asia/Taipei",
        })}
      </strong>
      <p>
        進貨 {batch.quantity} 件 · 剩餘 {batch.remaining} 件
        {batch.written_off > 0 ? ` · 庫存調整減少 ${batch.written_off} 件` : ""}
      </p>
      {batch.unit_cost === null && (
        <p className="text-danger-strong">尚未填寫成本，相關銷售無法結算</p>
      )}
      <label className="field">
        <span>第 {index} 批總成本（TWD）</span>
        <input
          type="number"
          min="0"
          max="9999999999.99"
          step="0.01"
          value={cost}
          placeholder="尚未填寫"
          disabled={batch.locked || busy}
          onChange={(e) => {
            setCost(e.target.value);
            setSuccess(false);
          }}
        />
      </label>
      <p>
        平均每張成本：
        {cost.trim()
          ? `NT$ ${(Number(cost) / batch.quantity).toLocaleString("zh-TW", { maximumFractionDigits: 6 })}`
          : "待填"}
      </p>
      <label className="field">
        <span>第 {index} 批成本備註</span>
        <textarea
          value={notes}
          maxLength={1000}
          disabled={batch.locked || busy}
          onChange={(e) => {
            setNotes(e.target.value);
            setSuccess(false);
          }}
        />
      </label>
      {batch.locked ? (
        <p>已有銷售列入結算，此批成本已鎖定。</p>
      ) : (
        <button
          type="button"
          className="outline"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "儲存中…" : "儲存本批成本"}
        </button>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {success && <p role="status">批次成本已儲存</p>}
    </article>
  );
}
