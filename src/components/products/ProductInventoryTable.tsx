"use client";

import { CloseButton } from "@/components/ui/CloseButton";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { Spinner } from "@/components/ui/Spinner";
import { Pagination } from "@/components/ui/Pagination";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useBackAction } from "@/components/navigation/BackNavigation";
import type { Product } from "@/lib/types";
import { deleteProducts } from "@/lib/api/bulk-products";
import {
  MAX_BULK_DELETE_PRODUCTS,
  type BulkDeleteProductsResult,
} from "@/lib/validation/bulk-products";
import { ProductTable } from "./ProductTable";
import styles from "../../../styles/components/products/ProductInventoryTable.module.scss";

const PRODUCT_PAGE_SIZE = 20;

/** Print and delete selections are independent. The dashboard keys this table
 * by inventory and search, so hidden search results never stay selected. */
export function ProductInventoryTable({
  items,
  selecting,
  onSelectingChange,
  onSelect,
  printSelectionMode,
  printSelectedIds,
  onPrintToggle,
  onChanged,
  onDeleted,
}: {
  items: Product[];
  selecting: boolean;
  onSelectingChange: (selecting: boolean) => void;
  onSelect: (product: Product) => void;
  printSelectionMode: boolean;
  printSelectedIds: Set<string>;
  onPrintToggle: (productId: string) => void;
  onChanged: () => Promise<void>;
  onDeleted: (result: BulkDeleteProductsResult, refreshError?: string) => void;
}) {
  const [requestedPage, setRequestedPage] = useState(1);
  const page = Math.min(
    requestedPage,
    Math.max(1, Math.ceil(items.length / PRODUCT_PAGE_SIZE)),
  );
  const pageItems = items.slice(
    (page - 1) * PRODUCT_PAGE_SIZE,
    page * PRODUCT_PAGE_SIZE,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [review, setReview] = useState<Product[] | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const candidates = items.filter((product) => Boolean(product.dbId));
  const chosen = candidates.filter((product) => selectedIds.has(product.dbId!));
  const toggle = (id: string) =>
    setSelectedIds((current) => {
      const available = new Set(candidates.map((product) => product.dbId!));
      const next = new Set(
        [...current].filter((value) => available.has(value)),
      );
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_BULK_DELETE_PRODUCTS) next.add(id);
      return next;
    });
  async function confirmDelete() {
    if (busyRef.current || !review?.length) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    let result: BulkDeleteProductsResult | null = null;
    try {
      result = await deleteProducts(review.map((product) => product.dbId!));
      onDeleted(result);
      setSelectedIds(new Set());
      onSelectingChange(false);
      setReview(null);
      await onChanged();
    } catch (cause) {
      if (result) onDeleted(result, "商品已刪除，清單更新失敗，請重新載入。");
      else
        setError(
          cause instanceof TypeError
            ? "連線中斷，無法確認刪除結果。請關閉視窗並重新載入商品清單後再操作。"
            : cause instanceof Error
              ? cause.message
              : "批量刪除未完成，請重新載入清單後再試。",
        );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {!printSelectionMode && selecting && (
        <div className={styles.actions}>
          <div className={styles.selection}>
            <button
              type="button"
              className="outline"
              onClick={() =>
                setSelectedIds(
                  chosen.length
                    ? new Set()
                    : new Set(
                        candidates
                          .slice(0, MAX_BULK_DELETE_PRODUCTS)
                          .map((product) => product.dbId!),
                      ),
                )
              }
            >
              {chosen.length
                ? "取消全選"
                : candidates.length > MAX_BULK_DELETE_PRODUCTS
                  ? `選取前 ${MAX_BULK_DELETE_PRODUCTS} 項`
                  : "全選目前結果"}
            </button>
            <span role="status">
              已選擇 {chosen.length} 項／每批最多 {MAX_BULK_DELETE_PRODUCTS} 項
            </span>
          </div>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={!chosen.length || busy}
            onClick={() => {
              setError("");
              setReview([...chosen]);
            }}
          >
            <Trash2 size={16} />
            刪除所選 {chosen.length} 項
          </button>
        </div>
      )}
      <ProductTable
        items={pageItems}
        onSelect={
          printSelectionMode
            ? undefined
            : selecting
              ? (product) => {
                  if (product.dbId) toggle(product.dbId);
                }
              : onSelect
        }
        selectionMode={printSelectionMode || selecting}
        selectionLabel={printSelectionMode ? "批量列印" : "批量刪除"}
        selectedIds={
          printSelectionMode
            ? printSelectedIds
            : new Set(chosen.map((product) => product.dbId!))
        }
        selectionLimit={
          printSelectionMode ? undefined : MAX_BULK_DELETE_PRODUCTS
        }
        onToggle={printSelectionMode ? onPrintToggle : toggle}
      />
      <Pagination
        page={page}
        pageSize={PRODUCT_PAGE_SIZE}
        showTopBorder={false}
        total={items.length}
        disabled={busy}
        onPageChange={setRequestedPage}
      />
      {review && (
        <DeleteConfirmation
          products={review}
          busy={busy}
          error={error}
          onClose={() => {
            if (!busyRef.current) setReview(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </>
  );
}

function DeleteConfirmation({
  products,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  products: Product[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState("");
  useBackAction({
    priority: 100,
    disabled: busy,
    hideButton: true,
    onBack: onClose,
  });
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="bulk-product-delete-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className={styles.header}>
        <h2 id="bulk-product-delete-title">
          確認批量刪除 {products.length} 項商品
        </h2>
        <CloseButton
          aria-label="關閉批量刪除"
          disabled={busy}
          onClick={onClose}
          size={20}
        />
      </div>
      <div className={styles.body}>
        <p>
          以下商品將永久刪除。引用這些商品的完整訂單、包貨、QR
          與結算紀錄也會一併刪除，無法復原。
        </p>
        <ul aria-label="待刪除商品清單">
          {products.map((product) => (
            <li key={product.dbId}>
              <strong>
                {product.id} · {product.name}
              </strong>
              <small>
                {product.ownerName} · 庫存 {product.stock} 件
              </small>
            </li>
          ))}
        </ul>
        <label className={styles.confirmation}>
          請輸入「刪除」確認
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={busy}
            autoComplete="off"
            maxLength={10}
            placeholder="刪除"
          />
        </label>
        {error && <ErrorMessage className={styles.error}>{error}</ErrorMessage>}
      </div>
      <div className={styles.footer}>
        <button
          type="button"
          className="outline"
          disabled={busy}
          onClick={onClose}
        >
          取消
        </button>
        <button
          type="button"
          className={styles.dangerButton}
          disabled={busy || confirmation.trim() !== "刪除"}
          onClick={() => {
            if (confirmation.trim() !== "刪除") return;
            setConfirmation("");
            onConfirm();
          }}
        >
          {busy ? (
            <>
              <Spinner size={16} />
              刪除中…
            </>
          ) : (
            <>
              <Trash2 size={16} />
              永久刪除 {products.length} 項
            </>
          )}
        </button>
      </div>
    </dialog>
  );
}
