"use client";
import { useEffect, useState } from "react";
import {
  getInventoryAccountingMode,
  getProductBatchCosts,
} from "@/lib/api/inventory-costs";
import {
  unitCostSchema,
  type AccountingMode,
  type CostBatch,
  type ProductBatchCosts,
} from "@/lib/inventory-costs";
export function useProductCostDraft(ownerId: string, productId?: string) {
  const contextKey = `${ownerId}:${productId ?? ""}`;
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({
    contextKey,
    mode: null as AccountingMode | null,
    cost: "",
    initialCost: "",
    defaultCost: "",
    batches: [] as CostBatch[],
    batchId: "",
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
        const batches = data.batches;
        const editable = batches.filter((batch) => !batch.locked);
        const selected = editable.length === 1 ? editable[0] : undefined;
        const defaultCost = data.unitCost;
        const value =
          selected?.unit_cost ??
          defaultCost ??
          [...batches].reverse().find((batch) => batch.unit_cost !== null)
            ?.unit_cost;
        setState({
          contextKey,
          mode: data.mode,
          cost: value == null ? "" : String(value),
          initialCost: value == null ? "" : String(value),
          defaultCost: defaultCost == null ? "" : String(defaultCost),
          batches,
          batchId: selected?.id ?? "",
          loading: false,
          error: "",
        });
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setState((current) => ({
            ...current,
            loading: false,
            error:
              caught instanceof Error ? caught.message : "成本資料載入失敗",
          }));
      });
    return () => controller.abort();
  }, [ownerId, productId, retry, contextKey]);
  function selectBatch(batchId: string) {
    const selected = state.batches.find((batch) => batch.id === batchId);
    setState((current) => ({
      ...current,
      batchId,
      cost:
        selected?.unit_cost != null
          ? String(selected.unit_cost)
          : batchId
            ? ""
            : current.defaultCost,
    }));
  }
  function input(stockIncrease = 0) {
    if (state.loading || state.contextKey !== contextKey)
      throw new Error("請稍候，正在載入成本設定");
    if (state.error || !state.mode)
      throw new Error("請重新載入成本設定後再儲存");
    if (state.mode !== "product_fifo") return {};
    if (!state.cost.trim()) {
      if (state.initialCost) throw new Error("成本不可清空；零成本請填 0");
      return {};
    }
    const parsed = unitCostSchema.safeParse(Number(state.cost));
    if (!parsed.success)
      throw new Error("請填寫有效的每張成本，最多兩位小數；零成本請填 0");
    const batch =
      stockIncrease <= 0
        ? state.batches.find((item) => item.id === state.batchId)
        : undefined;
    return {
      unitCost: parsed.data,
      ...(batch
        ? { costBatchId: batch.id, expectedCostRevision: batch.revision }
        : {}),
    };
  }
  return {
    ...state,
    loading: state.loading || state.contextKey !== contextKey,
    editing: Boolean(productId),
    setCost: (cost: string) => setState((current) => ({ ...current, cost })),
    selectBatch,
    reload: () => {
      setState((current) => ({ ...current, loading: true, error: "" }));
      setRetry((current) => current + 1);
    },
    input,
  };
}
