"use client";

import { CloseButton } from "@/components/ui/CloseButton";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

import { useDirtyBack } from "@/components/navigation/BackNavigation";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { readApiResponse } from "@/lib/api/http-client";
import {
  stallOrderEditSchema,
  type StallOrder,
  type StallOrderItem,
} from "@/lib/stall-orders";
import styles from "../../../styles/components/checkout/StallOrderHistory.module.scss";

const money = (value: number) => `NT$ ${value.toLocaleString("zh-TW")}`;
export function StallOrderEditor({
  order,
  ownerId,
  onClose,
  onSaved,
}: {
  order: StallOrder;
  ownerId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState(() =>
    order.items.map((item) => ({ ...item })),
  );
  const [note, setNote] = useState(order.note);
  const [sku, setSku] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total =
    items.reduce(
      (sum, item) => sum + Math.round(item.unitPrice * 100) * item.quantity,
      0,
    ) / 100;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  function update(productId: string, changes: Partial<StallOrderItem>) {
    setItems((current) =>
      current.map((item) =>
        item.productId === productId ? { ...item, ...changes } : item,
      ),
    );
  }
  async function addProduct() {
    if (busy || !sku.trim()) return;
    setBusy(true);
    setError("");
    try {
      const code = sku.trim().toUpperCase();
      const existing = items.find((item) => item.sku === code);
      if (existing) {
        update(existing.productId, { quantity: existing.quantity + 1 });
      } else {
        const response = await fetch(
          `/api/checkout?${new URLSearchParams({ ownerId, value: code })}`,
          { cache: "no-store" },
        );
        const product = await readApiResponse<{
          productId: string;
          sku: string;
          name: string;
          listPrice: number;
          stock: number;
        }>(response);
        setItems((current) => [
          ...current,
          {
            id: product.productId,
            productId: product.productId,
            sku: product.sku,
            name: product.name,
            quantity: 1,
            unitPrice: product.listPrice,
            stock: product.stock,
          },
        ]);
      }
      setSku("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "商品加入失敗");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (busy) return;
    const parsed = stallOrderEditSchema.safeParse({
      ownerId,
      revision: order.revision,
      note,
      items,
    });
    if (!parsed.success) {
      setError("請確認商品數量與單價，最多 100 件，單價最多兩位小數。");
      return;
    }
    if (
      !window.confirm(
        `確定儲存 ${order.orderNo} 的修改嗎？訂單金額：${money(order.total)} → ${money(total)}。庫存與商品碼會一併調整。`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/checkout/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      await readApiResponse(response);
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "修改失敗，請重新查找訂單確認目前狀態",
      );
    } finally {
      setBusy(false);
    }
  }
  const { requestBack, markChanged } = useDirtyBack({
    onBack: onClose,
    hideButton: true,
    busy: busy,
    dirty:
      note !== order.note ||
      JSON.stringify(items) !== JSON.stringify(order.items),
  });
  return (
    <dialog
      ref={dialog}
      className={styles.editor}
      aria-labelledby="stall-order-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        requestBack();
      }}
    >
      <div className={styles.editorHead}>
        <div>
          <span className="eyebrow">編輯攤位訂單</span>
          <h2 id="stall-order-editor-title">{order.orderNo}</h2>
        </div>
        <CloseButton
          aria-label="關閉訂單編輯"
          disabled={busy}
          onClick={requestBack}
          size={20}
        />
      </div>
      <form
        onChangeCapture={markChanged}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className={styles.editorBody}>
          <fieldset disabled={busy} className={styles.fields}>
            <div className={styles.skuAdd}>
              <label className="field">
                <span>加入商品編號</span>
                <input
                  value={sku}
                  onChange={(event) => setSku(event.target.value)}
                  placeholder="例如 A000038"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void addProduct();
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="outline"
                disabled={!sku.trim()}
                onClick={() => void addProduct()}
              >
                <Plus size={16} />
                加入
              </button>
            </div>
            {items.length === 0 && (
              <p>請加入至少一件商品，或關閉編輯後撤銷訂單。</p>
            )}
            {items.map((item) => (
              <div key={item.productId} className={styles.itemEditor}>
                <div className={styles.head}>
                  <div>
                    <code>{item.sku}</code>
                    <b className={styles.productName}>{item.name}</b>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`移除 ${item.sku}`}
                    onClick={() =>
                      setItems((current) =>
                        current.filter(
                          (entry) => entry.productId !== item.productId,
                        ),
                      )
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                <div className={styles.row}>
                  <label className="field">
                    <span>數量 {item.sku}</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={item.quantity}
                      onChange={(event) =>
                        update(item.productId, {
                          quantity: Number(event.target.value),
                        })
                      }
                      required
                    />
                  </label>
                  <label className="field">
                    <span>單價 {item.sku}</span>
                    <input
                      type="number"
                      min={0}
                      max={99999999.99}
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(event) =>
                        update(item.productId, {
                          unitPrice: Number(event.target.value),
                        })
                      }
                      required
                    />
                  </label>
                </div>
              </div>
            ))}
            <label className="field">
              <span>訂單備註</span>
              <textarea
                value={note}
                maxLength={2000}
                rows={3}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </fieldset>
          {error && (
            <ErrorMessage className={styles.error}>{error}</ErrorMessage>
          )}
        </div>
        <div className={styles.editorFoot}>
          <strong>修改後總額 {money(total)}</strong>
          <div className={styles.actions}>
            <button
              type="button"
              className="outline"
              disabled={busy}
              onClick={requestBack}
            >
              取消
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || !items.length}
            >
              {busy ? "處理中…" : "儲存修改"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
