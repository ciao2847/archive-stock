"use client";

import { ErrorMessage } from "@/components/ui/ErrorMessage";

import { useEffect, useState } from "react";
import type { ClaimSubmission } from "@/lib/claims";
import { getClaimSubmissionTotal } from "@/lib/claims";
import type { Order, Product } from "@/lib/types";
import { readApiResponse } from "@/lib/api/http-client";
import { isOrderPackable } from "@/constants";

type Mapping = { productId: string; quantity: string; unitPrice: string };

export function FulfillmentActions({
  ownerId,
  submission,
  products,
  order,
  onPack,
  onReload,
}: {
  ownerId: string;
  submission: ClaimSubmission;
  products: Product[];
  order?: Order;
  onPack?: (order: Order) => void;
  onReload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Mapping[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lookup, setLookup] = useState<{ key: string; state: string } | null>(
    null,
  );
  const lookupKey = `${ownerId}:${submission.source}:${submission.id}`;
  useEffect(() => {
    if (order) return;
    let active = true;
    const params = new URLSearchParams({
      ownerId,
      source: submission.source,
      submissionId: String(submission.id),
    });
    fetch(`/api/order-fulfillment?${params}`, { cache: "no-store" })
      .then((response) => readApiResponse<{ state: string }>(response))
      .then((result) => {
        if (active) setLookup({ key: lookupKey, state: result.state });
      })
      .catch(() => {
        if (active) setLookup({ key: lookupKey, state: "error" });
      });
    return () => {
      active = false;
    };
  }, [ownerId, submission.source, submission.id, order, lookupKey]);
  const lookupState = lookup?.key === lookupKey ? lookup.state : "loading";
  const unavailable = !order && lookupState === "unavailable";
  const statusLabel =
    order?.items.length || (order && !isOrderPackable(order.status))
      ? order?.status
      : !order
        ? ({
            unavailable: "包貨功能尚未啟用",
            missing_order: "待建立正式訂單",
            missing_products:
              submission.source === "bundle"
                ? "待對應出貨商品"
                : "缺少出貨商品",
            ready: "待重新整理訂單",
            error: "暫時無法確認",
            loading: "正在確認包貨資料",
          }[lookupState] ?? "暫時無法確認")
        : submission.source === "bundle"
          ? "待對應出貨商品"
          : "缺少出貨商品";
  const ready = Boolean(order?.items.length);
  const locked =
    Boolean(
      order?.items.some(
        (item) => item.packedQuantity > 0 || item.scannedQuantity > 0,
      ),
    ) || Boolean(order && !isOrderPackable(order.status));
  const total = getClaimSubmissionTotal(submission);
  const mappedTotal = rows.reduce(
    (sum, row) => sum + Number(row.quantity) * Number(row.unitPrice),
    0,
  );
  const availableProducts = products.filter(
    (product) => product.ownerId === ownerId,
  );
  function openMapping() {
    setRows(
      order?.items.length
        ? order.items.map((item) => ({
            productId: item.productId,
            quantity: String(item.quantity),
            unitPrice: String(item.unitPrice),
          }))
        : [{ productId: "", quantity: "1", unitPrice: String(total) }],
    );
    setError("");
    setEditing(true);
  }
  async function save() {
    if (saving) return;
    if (
      rows.some(
        (row) =>
          !row.productId ||
          !row.quantity ||
          !row.unitPrice ||
          !Number.isInteger(Number(row.quantity)) ||
          Number(row.quantity) < 1 ||
          Number(row.quantity) > 999 ||
          !Number.isFinite(Number(row.unitPrice)) ||
          Number(row.unitPrice) < 0,
      ) ||
      new Set(rows.map((row) => row.productId)).size !== rows.length ||
      Math.abs(mappedTotal - total) > 0.001
    ) {
      setError(
        "請選擇不重複的商品、整數數量與單價；商品合計須等於配單原總額。",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      await readApiResponse(
        await fetch("/api/order-fulfillment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerId,
            bundleOrderId: submission.id,
            items: rows.map((row) => ({
              productId: row.productId,
              quantity: Number(row.quantity),
              unitPrice: Number(row.unitPrice),
            })),
          }),
        }),
      );
      await onReload();
      setEditing(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "商品對應儲存失敗。");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      aria-label="包貨進度"
      className="mt-4 rounded-[10px] border border-line bg-light p-4 text-[13px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <strong>
            包貨狀態：
            {statusLabel}
          </strong>
          {order && ready && (
            <p className="mb-0 mt-1">
              已包{" "}
              {order.items.reduce((sum, item) => sum + item.packedQuantity, 0)}
              ／{order.items.reduce((sum, item) => sum + item.quantity, 0)} 件
            </p>
          )}
        </div>
        {ready && order && isOrderPackable(order.status) && (
          <button
            type="button"
            className="primary"
            disabled={!onPack || saving}
            onClick={() => onPack?.(order)}
          >
            開始包貨
          </button>
        )}
        {submission.source === "bundle" &&
          !locked &&
          !unavailable &&
          (Boolean(order) ||
            lookupState === "missing_products" ||
            lookupState === "ready") && (
            <button
              type="button"
              className="outline"
              disabled={saving}
              onClick={openMapping}
            >
              {ready ? "調整出貨商品" : "對應出貨商品"}
            </button>
          )}
      </div>
      {!ready && !locked && (
        <p className="mb-0 mt-2 text-muted">
          {unavailable
            ? "目前連線的資料庫尚未安裝訂購包貨功能，因此尚不能開始包貨。現有訂購與商品資料不受影響。"
            : !order && lookupState === "loading"
              ? "正在確認這筆訂購的正式訂單與包貨資料。"
              : !order && lookupState === "missing_order"
                ? "這筆訂購尚未產生正式訂單，需要補建訂購與正式訂單的關聯。"
                : !order && lookupState === "ready"
                  ? "正式訂單已存在，請重新整理訂單管理後開始包貨。"
                  : !order && lookupState === "error"
                    ? "包貨資料讀取失敗，請重新整理後再試。"
                    : submission.source === "bundle"
                      ? "先將配單對應到實際庫存商品及數量，即可使用一般訂單的掃描包貨流程。"
                      : "正式訂單已建立，但缺少可包貨的商品，請確認原訂購商品是否仍存在。"}
        </p>
      )}
      {ready && (
        <p className="mb-0 mt-2 text-muted">
          已到貨的商品可先包裝；未到貨品項會保留在原訂單。
        </p>
      )}
      {editing && (
        <form
          aria-label="配單出貨商品對應"
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {rows.map((row, index) => (
            <div
              key={index}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px_110px_auto]"
            >
              <label className="min-w-0">
                商品 {index + 1}
                <select
                  aria-label={`商品 ${index + 1}`}
                  className="w-full"
                  disabled={saving}
                  value={row.productId}
                  onChange={(event) =>
                    setRows(
                      rows.map((item, i) =>
                        i === index
                          ? { ...item, productId: event.target.value }
                          : item,
                      ),
                    )
                  }
                >
                  <option value="">選擇商品</option>
                  {availableProducts.map((product) => (
                    <option key={product.dbId} value={product.dbId}>
                      {product.id} · {product.name} · 庫存 {product.stock}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                數量 {index + 1}
                <input
                  className="w-full"
                  type="number"
                  min="1"
                  max="999"
                  step="1"
                  required
                  disabled={saving}
                  value={row.quantity}
                  onChange={(event) =>
                    setRows(
                      rows.map((item, i) =>
                        i === index
                          ? { ...item, quantity: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label>
                單價 {index + 1}
                <input
                  className="w-full"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  disabled={saving}
                  value={row.unitPrice}
                  onChange={(event) =>
                    setRows(
                      rows.map((item, i) =>
                        i === index
                          ? { ...item, unitPrice: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="outline self-end"
                disabled={saving || rows.length === 1}
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
              >
                移除
              </button>
            </div>
          ))}
          <p>
            商品合計 ${mappedTotal.toLocaleString()}／配單原總額 $
            {total.toLocaleString()}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="outline"
              disabled={saving || rows.length >= 100}
              onClick={() =>
                setRows([
                  ...rows,
                  { productId: "", quantity: "1", unitPrice: "0" },
                ])
              }
            >
              新增商品
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? "儲存中…" : "儲存商品對應"}
            </button>
            <button
              type="button"
              className="outline"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              取消
            </button>
          </div>
        </form>
      )}
      {error && (
        <ErrorMessage className="mb-0 mt-3 text-danger">{error}</ErrorMessage>
      )}
    </section>
  );
}
