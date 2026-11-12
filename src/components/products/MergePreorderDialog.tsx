"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CloseButton } from "@/components/ui/CloseButton";
import { Spinner } from "@/components/ui/Spinner";
import { useDirtyBack } from "@/components/navigation/BackNavigation";
import { mergePreorderProduct } from "@/lib/api/product-merge";
import { productNameWithCountryFlag } from "@/lib/preorder-product-name";
import type { ProductMergePreview } from "@/lib/product-merge";
import type { Product } from "@/lib/types";
import styles from "../../../styles/components/products/MergePreorderDialog.module.scss";

export function MergePreorderDialog({
  source,
  products,
  ownerId,
  onClose,
  onMerged,
}: {
  source: Product;
  products: Product[];
  ownerId: string;
  onClose: () => void;
  onMerged: (result: ProductMergePreview) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const pending = useRef(false);
  const [search, setSearch] = useState("");
  const [targetId, setTargetId] = useState("");
  const [preview, setPreview] = useState<ProductMergePreview>();
  const [completed, setCompleted] = useState<ProductMergePreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useDirtyBack({ priority: 50, busy, onBack: onClose });
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const candidates = useMemo(
    () =>
      products.filter(
        (product) =>
          product.dbId &&
          product.dbId !== source.dbId &&
          product.ownerId === ownerId &&
          (product.hasInventoryHistory ||
            product.stock > 0 ||
            Boolean(product.primaryLocationCode) ||
            (product.location && product.location !== "未指定")) &&
          [product.id, product.name, product.work, product.country]
            .join(" ")
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      ),
    [products, source.dbId, ownerId, search],
  );

  async function refresh(result: ProductMergePreview) {
    try {
      await onMerged(result);
      onClose();
    } catch {
      setError(
        "合併已完成，但重新載入失敗。請重試載入或重新整理頁面；不需要再次合併。",
      );
    }
  }
  async function request(apply: boolean) {
    if (pending.current || !source.dbId || !targetId || (apply && !preview))
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await mergePreorderProduct({
        ownerId,
        sourceId: source.dbId,
        targetId,
        ...(apply ? { token: preview!.token } : {}),
      });
      if (apply) {
        setCompleted(result);
        await refresh(result);
      } else setPreview(result);
    } catch (caught) {
      setError(
        apply && caught instanceof TypeError
          ? "未能確認合併結果，請先重新整理查看商品狀態，再決定是否重試。"
          : caught instanceof Error
            ? caught.message
            : "無法完成操作，請重新預覽再試",
      );
      setPreview(undefined);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className={styles.header}>
        <h2 id={heading}>合併至庫存商品</h2>
        <CloseButton
          disabled={busy}
          onClick={onClose}
          aria-label="關閉商品合併"
        />
      </div>
      <div className={styles.body}>
        <p>
          預售商品：
          <b>
            {source.id} ·{" "}
            {productNameWithCountryFlag(source.name, source.country)}
          </b>
        </p>
        <p className={styles.note}>
          合併會套用到所有相關訂購頁與訂單。原成交名稱、數量、單價及付款紀錄保留，既有庫存數量不變。
        </p>
        {completed ? (
          <p role="status">合併已完成，重複的預售商品已停用。</p>
        ) : preview ? (
          <>
            <h3>確認合併內容</h3>
            <p>
              併入：
              <b>
                {preview.target.sku} ·{" "}
                {productNameWithCountryFlag(
                  preview.target.name,
                  products.find((product) => product.dbId === preview.target.id)
                    ?.country ?? "",
                )}
              </b>
            </p>
            <p>
              合併後庫存維持 <b>{preview.target.stock}</b> 件。
            </p>
            <p>
              影響 {preview.forms.length} 個訂購頁、{preview.submissionCount}{" "}
              筆訂購紀錄、{preview.fulfillmentCount} 張出貨訂單。
            </p>
            <ul className={styles.list}>
              {preview.forms.map((form) => (
                <li key={form.id}>
                  <b>{form.title}</b>：
                  {form.targetAlreadyListed
                    ? "已包含庫存商品，保留該商品原有的公開名稱、價格與上限，移除重複預售項目。"
                    : "將預售項目改為庫存商品，保留公開名稱、價格與上限。"}
                </li>
              ))}
            </ul>
            {preview.conflicts.length > 0 && (
              <div className={styles.error} role="alert">
                <p>
                  以下訂單同時包含兩個商品，暫時無法合併，避免更動原成交明細：
                </p>
                <ul>
                  {preview.conflicts.map((conflict) => (
                    <li key={`${conflict.kind}-${conflict.code}`}>
                      {conflict.code}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className={styles.note}>
              確認後，重複的預售商品會停用，之後統一使用庫存商品。
            </p>
          </>
        ) : (
          <>
            <label className={styles.search}>
              搜尋已入庫商品
              <input
                type="search"
                value={search}
                disabled={busy}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="輸入商品名稱、國家或編號"
              />
            </label>
            <fieldset className={styles.candidates} disabled={busy}>
              <legend>選擇同款庫存商品</legend>
              {candidates.length === 0 && (
                <p>沒有符合的已入庫商品，請調整搜尋條件。</p>
              )}
              {candidates.map((product) => (
                <label className={styles.candidate} key={product.dbId}>
                  <input
                    type="radio"
                    name="merge-target"
                    value={product.dbId}
                    checked={targetId === product.dbId}
                    onChange={() => {
                      setTargetId(product.dbId!);
                      setError("");
                    }}
                  />
                  <span>
                    <b>
                      {product.id} ·{" "}
                      {productNameWithCountryFlag(
                        product.name,
                        product.country,
                      )}
                    </b>
                    <small>
                      {product.country} · {product.size || "未指定尺寸"} · 庫存{" "}
                      {product.stock} · {product.location}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
          </>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
      <div className={styles.footer}>
        {completed ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={async () => {
              if (pending.current) return;
              pending.current = true;
              setBusy(true);
              try {
                await refresh(completed);
              } finally {
                pending.current = false;
                setBusy(false);
              }
            }}
          >
            重新載入
          </button>
        ) : (
          <>
            <button
              type="button"
              className="outline"
              disabled={busy}
              onClick={() => {
                if (preview) {
                  setPreview(undefined);
                  setError("");
                } else onClose();
              }}
            >
              {preview ? "重新選擇" : "取消"}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || !targetId || Boolean(preview?.conflicts.length)}
              onClick={() => void request(Boolean(preview))}
            >
              {busy && <Spinner size={16} />}
              {busy ? "處理中…" : preview ? "確認合併" : "預覽合併"}
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
