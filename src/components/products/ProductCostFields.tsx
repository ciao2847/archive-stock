"use client";
import type { useProductCostDraft } from "@/hooks/useProductCostDraft";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
export function ProductCostFields({
  draft,
  stockIncrease = 0,
}: {
  draft: ReturnType<typeof useProductCostDraft>;
  stockIncrease?: number;
}) {
  if (draft.loading)
    return (
      <p className="text-sm text-muted" role="status">
        正在載入成本設定…
      </p>
    );
  if (draft.error)
    return (
      <div className="wide">
        <ErrorMessage>{draft.error}</ErrorMessage>
        <button type="button" className="outline" onClick={draft.reload}>
          重新載入成本設定
        </button>
      </div>
    );
  if (draft.mode !== "product_fifo") return null;
  const receiving = draft.editing && stockIncrease > 0;
  const editable = draft.batches.filter((batch) => !batch.locked);
  return (
    <>
      <label className="field">
        <span>{receiving ? "本次進貨每張成本（TWD）" : "每張成本（TWD）"}</span>
        <input
          type="number"
          min="0"
          max="9999999999.99"
          step="0.01"
          placeholder="請輸入每張海報的進貨成本"
          value={draft.cost}
          onChange={(event) => draft.setCost(event.target.value)}
        />
        <small>
          {receiving
            ? `套用至這次新增的 ${stockIncrease} 張海報，原有進貨批次成本保留。`
            : "與商品資料一起儲存；零成本請填 0，未填時無法結算。"}
        </small>
      </label>
      {draft.editing && !receiving && editable.length > 1 && (
        <label className="field">
          <span>成本套用範圍</span>
          <select
            value={draft.batchId}
            onChange={(event) => draft.selectBatch(event.target.value)}
          >
            <option value="">僅作為後續進貨的預設成本</option>
            {editable.map((batch) => (
              <option key={batch.id} value={batch.id}>
                第 {draft.batches.indexOf(batch) + 1} 批 · 剩餘{" "}
                {batch.remaining} 張
                {batch.unit_cost === null
                  ? " · 尚未填成本"
                  : ` · 原成本 ${batch.unit_cost}`}
              </option>
            ))}
          </select>
          <small>不同批次可分別修改；已結算批次已鎖定。</small>
        </label>
      )}
      {draft.editing && !receiving && editable.length === 0 && (
        <p className="text-sm text-muted">
          此成本用於後續進貨；已結算批次保留原成本。
        </p>
      )}
    </>
  );
}
