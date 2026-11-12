"use client";
import { useEffect, useState } from "react";
import {
  getInventoryAccountingMode,
  getProductBatchCosts,
} from "@/lib/api/inventory-costs";
import {
  costBatchInputSchema,
  type AccountingMode,
  type CostBatch,
  type ProductBatchCosts,
} from "@/lib/inventory-costs";
export type BatchDraft = {
  key: string;
  id?: string;
  sourceBatchId?: string;
  expectedRevision?: number;
  quantity: string;
  totalCost: string;
  date: string;
  notes: string;
  remaining?: number;
  locked: boolean;
};
const dateOf = (value = new Date()) =>
  value.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
const blank = (quantity = 1): BatchDraft => ({
  key: crypto.randomUUID(),
  quantity: String(quantity),
  totalCost: "",
  date: dateOf(),
  notes: "",
  locked: false,
});
function fromBatch(batch: CostBatch): BatchDraft {
  const total =
    batch.total_cost === undefined
      ? batch.unit_cost === null
        ? null
        : Math.round(batch.unit_cost * batch.quantity * 100) / 100
      : batch.total_cost;
  return {
    key: batch.id,
    id: batch.id,
    expectedRevision: batch.revision,
    quantity: String(batch.quantity),
    totalCost: total === null ? "" : String(total),
    date: dateOf(new Date(batch.received_at)),
    notes: batch.notes,
    remaining: batch.remaining,
    locked: batch.locked,
  };
}
export function useProductCostDraft(
  ownerId: string,
  productId?: string,
  initialStock = 0,
) {
  const contextKey = `${ownerId}:${productId ?? ""}`;
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({
    contextKey,
    mode: null as AccountingMode | null,
    rows: [] as BatchDraft[],
    originals: [] as BatchDraft[],
    initialStock,
    loading: true,
    error: "",
  });
  useEffect(() => {
    const controller = new AbortController();
    const request: Promise<ProductBatchCosts> = productId
      ? getProductBatchCosts(productId, controller.signal)
      : getInventoryAccountingMode(ownerId, controller.signal).then((data) => ({
          ...data,
          batches: [],
        }));
    void request
      .then((data) => {
        if (controller.signal.aborted) return;
        const originals = data.batches.map(fromBatch);
        const rows = productId
          ? originals
          : initialStock > 0
            ? [blank(initialStock)]
            : [];
        setState({
          contextKey,
          mode: data.mode,
          rows,
          originals,
          initialStock: productId
            ? data.batches.reduce((sum, b) => sum + b.remaining, 0)
            : 0,
          loading: false,
          error: "",
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : "成本資料載入失敗",
          }));
      });
    return () => controller.abort();
  }, [ownerId, productId, retry, contextKey, initialStock]);
  const stock =
    state.initialStock +
    state.rows
      .filter((r) => !r.id && !r.sourceBatchId)
      .reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  function update(key: string, patch: Partial<BatchDraft>) {
    setState((current) => ({
      ...current,
      rows: current.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    }));
  }
  function split(key: string) {
    const row = state.rows.find((r) => r.key === key);
    if (!row?.id || row.locked || Number(row.quantity) < 2) return;
    const n = Math.floor(Number(row.quantity) / 2),
      total = row.totalCost.trim() ? Number(row.totalCost) : null;
    const first =
      total === null
        ? ""
        : String(Math.round(((total * n) / Number(row.quantity)) * 100) / 100);
    const second =
      total === null
        ? ""
        : String(Math.round((total - Number(first)) * 100) / 100);
    const parts = [
      {
        ...blank(n),
        sourceBatchId: row.id,
        expectedRevision: row.expectedRevision,
        date: row.date,
        totalCost: first,
        notes: row.notes,
      },
      {
        ...blank(Number(row.quantity) - n),
        sourceBatchId: row.id,
        expectedRevision: row.expectedRevision,
        date: row.date,
        totalCost: second,
        notes: row.notes,
      },
    ];
    setState((current) => ({
      ...current,
      rows: current.rows.flatMap((r) => (r.key === key ? parts : [r])),
    }));
  }
  function input() {
    if (state.loading || state.contextKey !== contextKey || state.error)
      throw new Error("請先載入完整的批次成本資料");
    if (state.mode !== "product_fifo") return {};
    const costBatches = state.rows.map((row, index) => {
      const parsed = costBatchInputSchema.safeParse({
        ...(row.id ? { id: row.id } : {}),
        ...(row.sourceBatchId ? { sourceBatchId: row.sourceBatchId } : {}),
        ...(row.expectedRevision
          ? { expectedRevision: row.expectedRevision }
          : {}),
        quantity: Number(row.quantity),
        totalCost: row.totalCost.trim() ? Number(row.totalCost) : null,
        date: row.date,
        notes: row.notes,
      });
      if (!parsed.success)
        throw new Error(`第 ${index + 1} 批：請確認張數、總成本及日期`);
      return parsed.data;
    });
    for (const source of state.originals) {
      const parts = costBatches.filter((r) => r.sourceBatchId === source.id);
      if (
        parts.length &&
        parts.reduce((sum, r) => sum + r.quantity, 0) !==
          Number(source.quantity)
      )
        throw new Error("拆分後的張數合計必須等於原批次張數");
    }
    return { costBatches };
  }
  return {
    ...state,
    editing: Boolean(productId),
    loading: state.loading || state.contextKey !== contextKey,
    stock,
    input,
    update,
    split,
    add: () =>
      setState((current) => ({ ...current, rows: [...current.rows, blank()] })),
    remove: (key: string) =>
      setState((current) => ({
        ...current,
        rows: current.rows.filter(
          (r) =>
            r.key !== key ||
            r.id ||
            (r.sourceBatchId &&
              current.rows.filter(
                (part) => part.sourceBatchId === r.sourceBatchId,
              ).length <= 2),
        ),
      })),
    addSplitPart: (sourceBatchId: string) => {
      const source = state.originals.find((r) => r.id === sourceBatchId);
      if (source)
        setState((current) => ({
          ...current,
          rows: [
            ...current.rows,
            {
              ...blank(),
              sourceBatchId,
              expectedRevision: source.expectedRevision,
              date: source.date,
            },
          ],
        }));
    },
    undoSplit: (sourceBatchId: string) =>
      setState((current) => ({
        ...current,
        rows: [
          ...current.rows.filter((r) => r.sourceBatchId !== sourceBatchId),
          ...current.originals.filter((r) => r.id === sourceBatchId),
        ],
      })),
    reload: () => {
      setState((current) => ({ ...current, loading: true, error: "" }));
      setRetry((n) => n + 1);
    },
  };
}
