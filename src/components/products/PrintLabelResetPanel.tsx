"use client";

import { useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { Product } from "@/lib/types";
import { resetPrintLabels } from "@/lib/api/print-labels";
import { Pagination } from "@/components/ui/Pagination";
import { ProductTable } from "./ProductTable";

const PAGE_SIZE = 20;
const MAX_PRODUCTS = 500;

export function PrintLabelResetPanel({
  items,
  inventoryId,
  inventoryName,
}: {
  items: Product[];
  inventoryId: string;
  inventoryName: string;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [requestedPage, setRequestedPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const candidates = items.flatMap((product) =>
    product.dbId ? [product.dbId] : [],
  );
  const chosen = candidates.filter((id) => selectedIds.has(id));
  const chosenIds = new Set(chosen);
  const page = Math.min(
    requestedPage,
    Math.max(1, Math.ceil(items.length / PAGE_SIZE)),
  );

  return (
    <div id="product-print-reset">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="outline"
            disabled={busy || !candidates.length}
            onClick={() => {
              setSelectedIds(
                chosen.length
                  ? new Set()
                  : new Set(candidates.slice(0, MAX_PRODUCTS)),
              );
              setMessage("");
              setError("");
            }}
          >
            {chosen.length
              ? "取消全選"
              : candidates.length > MAX_PRODUCTS
                ? "選取前 500 項"
                : "全選目前結果"}
          </button>
          <span className="text-[12px] text-muted" role="status">
            已選擇 {chosen.length} 項／每批最多 {MAX_PRODUCTS} 項
          </span>
        </div>
        <button
          type="button"
          className="primary"
          disabled={busy || !inventoryId || !chosen.length}
          onClick={async () => {
            if (pending.current || !chosen.length) return;
            pending.current = true;
            setBusy(true);
            setMessage("");
            setError("");
            try {
              const result = await resetPrintLabels(inventoryId, chosen);
              setMessage(
                result.resetCount
                  ? `${inventoryName}：已還原 ${result.productCount} 項商品的 ${result.resetCount} 張標籤，可重新進行單張或批量列印。`
                  : "所選商品沒有可還原的已列印標籤。",
              );
              setSelectedIds(new Set());
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "標籤還原失敗");
            } finally {
              pending.current = false;
              setBusy(false);
            }
          }}
        >
          <RotateCcw size={17} />
          {busy ? "還原中…" : `還原所選 ${chosen.length} 項商品標籤`}
        </button>
      </div>
      <p className="mb-3 text-[12px] text-muted">
        勾選商品後一次還原已列印標籤。已使用或失效的標籤不會還原。
      </p>
      {message && (
        <p className="mb-3" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="mb-3 text-rust" role="alert">
          {error}
        </p>
      )}
      <ProductTable
        items={items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        selectionMode
        selectionLabel="還原已列印標籤"
        selectedIds={chosenIds}
        selectionLimit={MAX_PRODUCTS}
        selectionDisabled={busy}
        onToggle={(id) => {
          if (pending.current) return;
          setSelectedIds((current) => {
            const next = new Set(
              candidates.filter((candidate) => current.has(candidate)),
            );
            if (next.has(id)) next.delete(id);
            else if (next.size < MAX_PRODUCTS) next.add(id);
            return next;
          });
          setMessage("");
          setError("");
        }}
      />
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={items.length}
        showTopBorder={false}
        disabled={busy}
        onPageChange={setRequestedPage}
      />
    </div>
  );
}
