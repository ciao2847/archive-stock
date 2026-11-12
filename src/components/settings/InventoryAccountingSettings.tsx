"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getInventoryAccountingMode,
  setInventoryAccountingMode,
} from "@/lib/api/inventory-costs";
import type { AccountingMode } from "@/lib/inventory-costs";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
export function InventoryAccountingSettings({
  ownerId,
  name,
}: {
  ownerId: string;
  name: string;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["inventory-accounting-mode", ownerId],
    queryFn: ({ signal }) => getInventoryAccountingMode(ownerId, signal),
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(mode: AccountingMode) {
    if (mode === query.data?.mode) return;
    if (
      !window.confirm(
        `將「${name}」改為${mode === "product_fifo" ? "依售出商品的批次成本結算" : "帳期成本結算"}？${mode === "product_fifo" ? "現有庫存與未結算銷售將建立期初批次，請補齊成本。已有批次紀錄後無法切回。" : ""}`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await setInventoryAccountingMode(ownerId, mode);
      await Promise.all([
        query.refetch(),
        queryClient.invalidateQueries({ queryKey: ["accounting"] }),
        queryClient.invalidateQueries({ queryKey: ["product-batch-costs"] }),
        queryClient.invalidateQueries({ queryKey: ["account"] }),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新失敗");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card p-6" aria-label="庫藏結算方式">
      <h3 className="mb-3">{name} 的結算方式</h3>
      {query.isPending ? (
        <p>正在讀取結算設定…</p>
      ) : query.error ? (
        <ErrorMessage>{query.error.message}</ErrorMessage>
      ) : (
        <label className="field">
          <span>成本計算方式</span>
          <select
            value={query.data.mode}
            disabled={busy}
            onChange={(e) => void change(e.target.value as AccountingMode)}
          >
            <option value="period_total">
              帳期成本：會計頁逐筆輸入本期成本
            </option>
            <option value="product_fifo">
              商品成本：先進先出批次成本＋額外費用
            </option>
          </select>
        </label>
      )}
      <p className="mt-3 text-sm text-muted">
        商品成本模式只扣本期售出商品的成本，未售出庫存保留至後續銷售。已結算帳目維持當時的計算方式。
      </p>
      {busy && <p role="status">更新中…</p>}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </section>
  );
}
