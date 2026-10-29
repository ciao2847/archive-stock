"use client";

import { ErrorMessage } from "@/components/ui/ErrorMessage";

import { RefreshButton } from "@/components/ui/RefreshButton";

import { useEffect, useState } from "react";
import { readApiResponse } from "@/lib/api/http-client";
import type { StallSales } from "@/lib/stall-sales";

export function StallSalesSummary({ ownerId }: { ownerId: string }) {
  const [sales, setSales] = useState<StallSales | null>(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let controller: AbortController | undefined;
    let disposed = false;
    async function refresh() {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      setLoading(true);
      try {
        const response = await fetch(
          `/api/checkout/summary?${new URLSearchParams({ ownerId })}`,
          { cache: "no-store", signal: current.signal },
        );
        const result = await readApiResponse<StallSales>(response);
        if (disposed || current.signal.aborted) return;
        setSales(result);
        setError("");
      } catch (cause) {
        if (disposed || current.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "營收更新失敗");
      } finally {
        if (!disposed && !current.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [ownerId, refreshKey]);

  return (
    <section
      className="stall-daily-sales"
      aria-label="今日攤位營收"
      aria-busy={loading}
    >
      <div className="stall-daily-heading">
        <div>
          <h2>今日攤位營收</h2>
          <p>
            {sales
              ? `${sales.date} · 台灣時間`
              : "以台灣時間計算今日已收款訂單"}
          </p>
        </div>
        <RefreshButton
          label="更新今日營收"
          loading={loading}
          onClick={() => setRefreshKey((key) => key + 1)}
        />
      </div>
      <div className="stall-daily-values" aria-live="polite">
        <div>
          <small>已收款營收</small>
          <strong>
            {sales
              ? `NT$ ${sales.revenue.toLocaleString("zh-TW")}`
              : loading
                ? "讀取中…"
                : "—"}
          </strong>
        </div>
        <div>
          <small>成交筆數</small>
          <b>{sales ? `${sales.orderCount} 筆` : "—"}</b>
        </div>
        <div>
          <small>售出件數</small>
          <b>{sales ? `${sales.itemCount} 件` : "—"}</b>
        </div>
      </div>
      {error && (
        <ErrorMessage className="camera-error">
          {error}，請重新更新。{sales && "目前顯示上次成功更新的數字。"}
        </ErrorMessage>
      )}
      <p className="stall-daily-note">
        僅計入本庫藏已收款的攤位訂單，刪除或取消的訂單不計入。
      </p>
    </section>
  );
}
