"use client";

import { ErrorMessage } from "@/components/ui/ErrorMessage";

import { LoadingState } from "@/components/ui/LoadingState";

import { RefreshButton } from "@/components/ui/RefreshButton";

import { useEffect, useState, type ReactNode } from "react";
import { Pencil, RotateCcw, Search } from "lucide-react";
import { useNavigationState } from "@/components/navigation/BackNavigation";
import { Pagination } from "@/components/ui/Pagination";
import { SearchField } from "@/components/ui/SearchField";
import { readApiResponse } from "@/lib/api/http-client";
import type { StallOrder, StallOrderPage } from "@/lib/stall-orders";
import { formatTaipeiDateTime } from "@/lib/claims";
import { StallOrderEditor } from "./StallOrderEditor";
import styles from "../../../styles/components/checkout/StallOrderHistory.module.scss";

const money = (value: number) => `NT$ ${value.toLocaleString("zh-TW")}`;
export function StallOrderHistory({
  ownerId,
  refreshKey,
  onChanged,
  initialQuery = "",
  renderToolbar,
}: {
  ownerId: string;
  refreshKey: number;
  onChanged: () => void;
  initialQuery?: string;
  renderToolbar?: (search: ReactNode) => ReactNode;
}) {
  const [query, setQuery] = useNavigationState(
    `stall-history:${ownerId}:${initialQuery}:query`,
    initialQuery,
  );
  const [start, setStart] = useNavigationState(
    `stall-history:${ownerId}:${initialQuery}:start`,
    "",
  );
  const [end, setEnd] = useNavigationState(
    `stall-history:${ownerId}:${initialQuery}:end`,
    "",
  );
  const [status, setStatus] = useNavigationState(
    `stall-history:${ownerId}:${initialQuery}:status`,
    "all",
  );
  const [filters, setFilters] = useNavigationState(
    `stall-history:${ownerId}:${initialQuery}:filters`,
    {
      query: initialQuery,
      start: "",
      end: "",
      status: "all",
      page: 1,
    },
  );
  const [version, setVersion] = useState(0);
  const [data, setData] = useNavigationState<StallOrderPage | null>(
    `stall-history:${ownerId}:${initialQuery}:data`,
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<StallOrder | null>(null);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFilters((current) =>
        current.query === query.trim()
          ? current
          : { ...current, query: query.trim(), page: 1 },
      );
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query, setFilters]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(
          `/api/checkout/orders?${new URLSearchParams({ ownerId, ...filters, page: String(filters.page) })}`,
          { cache: "no-store", signal: controller.signal },
        );
        const result = await readApiResponse<StallOrderPage>(response);
        if (!controller.signal.aborted) {
          if (filters.page > 1 && result.orders.length === 0)
            setFilters((current) => ({
              ...current,
              page: Math.max(1, Math.ceil(result.total / result.pageSize)),
            }));
          else setData(result);
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "訂單讀取失敗");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [ownerId, filters, version, refreshKey, setFilters, setData]);
  async function cancel(order: StallOrder) {
    if (
      busyId ||
      loading ||
      !window.confirm(
        `確定撤銷 ${order.orderNo}（${money(order.total)}）？將退回庫存與商品碼，並從攤位營收扣除。原訂單紀錄會保留。`,
      )
    )
      return;
    setBusyId(order.id);
    setActionError("");
    setNotice("");
    try {
      const response = await fetch(`/api/checkout/orders/${order.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId, revision: order.revision }),
      });
      await readApiResponse(response);
      setNotice(`${order.orderNo} 已撤銷，庫存與商品碼已復原。`);
      onChanged();
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "撤銷失敗，請重新查找訂單確認目前狀態",
      );
    } finally {
      setBusyId(null);
      setVersion((value) => value + 1);
    }
  }
  const search = (
    <SearchField
      shortcut
      className="w-full"
      value={query}
      onChange={setQuery}
      label="訂單或商品"
      placeholder="訂單編號、商品編號或名稱"
      maxLength={100}
      onSearch={() =>
        setFilters({ query: query.trim(), start, end, status, page: 1 })
      }
    />
  );
  return (
    <>
      {renderToolbar ? (
        renderToolbar(search)
      ) : (
        <div className={styles.search}>{search}</div>
      )}
      <section
        id="stall-order-history"
        className={styles.card}
        aria-label="攤位訂單查找與管理"
        aria-busy={loading}
      >
        <div className={styles.historyHeader}>
          <form
            className={styles.filters}
            onSubmit={(event) => {
              event.preventDefault();
              setFilters({ query: query.trim(), start, end, status, page: 1 });
            }}
          >
            <label className="field">
              <span>開始日期</span>
              <input
                type="date"
                value={start}
                max={end || undefined}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
            <label className="field">
              <span>結束日期</span>
              <input
                type="date"
                value={end}
                min={start || undefined}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
            <label className="field">
              <span>訂單狀態</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">全部訂單</option>
                <option value="completed">已結帳</option>
                <option value="cancelled">已撤銷</option>
              </select>
            </label>
            <div className={styles.filterActions}>
              <button
                type="submit"
                className="primary"
                disabled={Boolean(busyId)}
              >
                <Search size={16} />
                查找訂單
              </button>
              <RefreshButton
                label="重新載入攤位訂單"
                loading={loading}
                onClick={() => setVersion((value) => value + 1)}
                disabled={Boolean(busyId)}
              />
            </div>
          </form>
        </div>
        <div className={styles.results}>
          {notice && (
            <p role="status" className={styles.notice}>
              {notice}
            </p>
          )}
          {(error || actionError) && (
            <ErrorMessage className={styles.error}>
              {error || actionError}
            </ErrorMessage>
          )}
          {loading && <LoadingState text="正在讀取訂單…" />}
          {!loading && !error && data?.orders.length === 0 && (
            <div className={styles.empty} role="status">
              <strong>找不到符合條件的攤位訂單</strong>
            </div>
          )}
          <div className={styles.list}>
            {data?.orders.map((order) => (
              <article
                key={order.id}
                className={styles.order}
                aria-label={`攤位訂單 ${order.orderNo}`}
              >
                <div className={styles.head}>
                  <div>
                    <b>{order.orderNo}</b>
                    <p suppressHydrationWarning>
                      {formatTaipeiDateTime(order.createdAt)}
                    </p>
                  </div>
                  <span
                    className={
                      order.status === "cancelled" ? "pill amber" : "pill green"
                    }
                  >
                    {order.status === "cancelled" ? "已撤銷" : "已結帳"}
                  </span>
                </div>
                <details>
                  <summary>
                    共{" "}
                    {order.items.reduce((sum, item) => sum + item.quantity, 0)}{" "}
                    件 · 查看商品明細
                  </summary>
                  <ul className={styles.items}>
                    {order.items.map((item) => (
                      <li key={item.id}>
                        <span>
                          <code>{item.sku}</code> {item.name} × {item.quantity}
                        </span>
                        <b>{money(item.unitPrice * item.quantity)}</b>
                      </li>
                    ))}
                  </ul>
                </details>
                {order.note && (
                  <p className={styles.text}>備註：{order.note}</p>
                )}
                <div className={styles.head}>
                  <strong className={styles.amount}>
                    {order.status === "cancelled" ? "原訂單金額 " : "訂單金額 "}
                    {money(order.total)}
                  </strong>
                  <div className={styles.actions}>
                    {order.settled && <span className="pill">已納入結算</span>}
                    {order.status === "packed" && !order.settled && (
                      <>
                        <button
                          type="button"
                          className="outline"
                          disabled={loading || Boolean(busyId)}
                          onClick={() => {
                            setEditing(order);
                            setNotice("");
                            setActionError("");
                          }}
                        >
                          <Pencil size={15} />
                          編輯訂單
                        </button>
                        <button
                          type="button"
                          className="outline"
                          disabled={loading || Boolean(busyId)}
                          onClick={() => void cancel(order)}
                        >
                          <RotateCcw size={15} />
                          {busyId === order.id ? "復原中…" : "撤銷並復原"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
        {data && (
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            disabled={loading}
            onPageChange={(page) =>
              setFilters((current) => ({ ...current, page }))
            }
          />
        )}
        {editing && (
          <StallOrderEditor
            key={editing.id}
            ownerId={ownerId}
            order={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setNotice("訂單已更新，金額、庫存與商品碼已同步調整。");
              setVersion((value) => value + 1);
              onChanged();
            }}
          />
        )}
      </section>
    </>
  );
}
