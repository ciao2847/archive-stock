"use client";

import { useRef, useState } from "react";
import { resetPrintLabels } from "@/lib/api/print-labels";

export function PrintLabelResetPanel({
  inventoryId,
  inventoryName,
}: {
  inventoryId: string;
  inventoryName: string;
}) {
  const [sku, setSku] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  return (
    <section className="card p-6">
      <span className="eyebrow">列印測試</span>
      <h2 className="mb-1 mt-2">還原已列印標籤</h2>
      <p className="mb-4 mt-0 text-muted">
        目前庫藏：{inventoryName || "尚未選擇"}。輸入商品
        ID，將已列印標籤還原為可列印，方便再次測試。
        已使用或失效的標籤不會還原，商品網址與庫存數量維持原樣。
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current || !inventoryId || !sku.trim()) return;
          pending.current = true;
          setBusy(true);
          setMessage("");
          setError("");
          try {
            const result = await resetPrintLabels(inventoryId, sku.trim());
            setMessage(
              result.resetCount
                ? `${result.sku} · ${result.productName}：已還原 ${result.resetCount} 張標籤，可重新進行單張或批量列印。`
                : `${result.sku}：沒有可還原的已列印標籤。`,
            );
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "標籤還原失敗");
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <label className="grid w-full max-w-[360px] gap-2">
          <span>商品 ID</span>
          <input
            className="w-full rounded-lg border border-line bg-white p-3"
            value={sku}
            onChange={(event) => {
              setSku(event.target.value);
              setMessage("");
              setError("");
            }}
            placeholder="例如 A000038"
            maxLength={100}
            required
            disabled={busy}
          />
        </label>
        <button
          className="outline"
          type="submit"
          disabled={busy || !inventoryId || !sku.trim()}
        >
          {busy ? "還原中…" : "還原為可列印"}
        </button>
      </form>
      {message && (
        <p className="mb-0 mt-3" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="mb-0 mt-3 text-rust" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
