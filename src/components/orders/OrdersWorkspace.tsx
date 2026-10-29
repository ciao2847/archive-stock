"use client";

import { ErrorMessage } from "@/components/ui/ErrorMessage";

import { RefreshButton } from "@/components/ui/RefreshButton";

import { useBackAction } from "@/components/navigation/BackNavigation";
import { pushDashboardPath } from "@/lib/dashboard-navigation";
import { useEffect, useState, type ReactNode } from "react";
import { fetchAllClaimSubmissions } from "@/lib/api/claims";
import type { ClaimSubmission } from "@/lib/claims";
import { ClaimOrderResults } from "./ClaimOrderResults";
import { filterClaimOrders } from "@/lib/order-search";
import styles from "../../../styles/components/orders/OrdersWorkspace.module.scss";
import { useSearchParams } from "next/navigation";
import { SearchField } from "@/components/ui/SearchField";
import { DataState } from "@/components/ui/DataState";
import { StallOrderHistory } from "@/components/checkout/StallOrderHistory";
import {
  getOrdersPath,
  getOrderSourceFilter,
  type OrderSourceFilter,
} from "@/lib/order-source";
import type { Order } from "@/lib/types";
import { OrderTable } from "./OrderTable";

const sources: Array<{ value: OrderSourceFilter; label: string }> = [
  { value: "all", label: "全部訂單" },
  { value: "general", label: "一般訂單" },
  { value: "stall", label: "攤位訂單" },
  { value: "claim", label: "預售訂購" },
  { value: "bundle", label: "配單" },
];

export function OrdersWorkspace({
  ownerId,
  orders,
  loading,
  query,
  onQueryChange,
  onChanged,
  onEditAmount,
  onDelete,
  onPack,
  customerReconciliation,
  renderClaimManagement,
}: {
  customerReconciliation?: ReactNode;
  renderClaimManagement?: (
    rows: ClaimSubmission[],
    onReload: () => Promise<void>,
  ) => ReactNode;
  ownerId: string;
  orders: Order[];
  loading: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onChanged: () => void;
  onEditAmount?: (order: Order) => void;
  onDelete?: (order: Order) => void | Promise<void>;
  onPack: (order: Order) => void;
}) {
  const params = useSearchParams();
  const reconciliation = params.get("tab") === "customers";
  useBackAction({
    enabled: reconciliation && Boolean(customerReconciliation),
    onBack: () => pushDashboardPath("/orders"),
  });
  const source = getOrderSourceFilter(params.get("source"));
  const initialQuery = (params.get("order") ?? "").slice(0, 100);
  const [claimData, setClaimData] = useState<{
    ownerId: string;
    rows: ClaimSubmission[];
  }>();
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [claimsError, setClaimsError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setClaimsLoading(true);
    setClaimsError("");
    fetchAllClaimSubmissions(ownerId)
      .then((result) => {
        if (active) setClaimData({ ownerId, rows: result.submissions });
      })
      .catch((error: unknown) => {
        if (active)
          setClaimsError(
            error instanceof Error ? error.message : "訂購資料讀取失敗",
          );
      })
      .finally(() => {
        if (active) setClaimsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ownerId, refresh]);
  const claimRows = filterClaimOrders(
    claimData?.ownerId === ownerId ? claimData.rows : [],
    source,
    query,
  );
  const showClaims =
    source === "all" || source === "claim" || source === "bundle";
  const showRegular = source === "all" || source === "general";
  const filtered = orders.filter(
    (order) =>
      !order.claimSubmissionId &&
      !order.bundleClaimOrderId &&
      (source !== "general" || order.source !== "stall"),
  );
  function selectSource(next: OrderSourceFilter, orderNo?: string) {
    const path = getOrdersPath(next, orderNo);
    if (window.location.pathname + window.location.search !== path)
      pushDashboardPath(path);
  }
  function renderToolbar(search: ReactNode) {
    return (
      <div className={styles.toolbar}>
        <div role="group" aria-label="訂單來源" className={styles.sources}>
          {sources.map((item) => (
            <button
              key={item.value}
              type="button"
              className={source === item.value ? "primary" : "outline"}
              aria-pressed={source === item.value}
              onClick={() => selectSource(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {search}
      </div>
    );
  }
  return (
    <section aria-label="訂單來源與管理">
      {reconciliation && customerReconciliation ? (
        customerReconciliation
      ) : source === "stall" ? (
        <StallOrderHistory
          key={`${ownerId}:${initialQuery}`}
          ownerId={ownerId}
          initialQuery={initialQuery}
          renderToolbar={renderToolbar}
          refreshKey={0}
          onChanged={onChanged}
        />
      ) : (
        <>
          {renderToolbar(
            <SearchField
              shortcut
              className="w-full"
              value={query}
              onChange={onQueryChange}
              label="搜尋訂單"
              placeholder="搜尋訂單編號、客人、電話或商品…"
            />,
          )}
          {showClaims && claimsError && (
            <ErrorMessage className="mb-4 text-danger" as="div">
              {claimsError}{" "}
              <RefreshButton
                label="重新讀取訂購資料"
                loading={claimsLoading}
                onClick={() => setRefresh((value) => value + 1)}
              />
            </ErrorMessage>
          )}
          <DataState
            loading={loading || (showClaims && claimsLoading)}
            isEmpty={
              (!showRegular || filtered.length === 0) &&
              (!showClaims || claimRows.length === 0) &&
              !claimsError
            }
            loadingText="正在讀取訂單…"
            emptyText={
              query.trim()
                ? `找不到符合「${query.trim()}」的訂單`
                : "目前沒有符合來源的訂單"
            }
          >
            {showRegular && filtered.length > 0 && (
              <OrderTable
                orders={filtered}
                onPack={onPack}
                onEditAmount={onEditAmount}
                onDelete={onDelete}
                onManageStall={(order) => selectSource("stall", order.id)}
              />
            )}
            {showClaims &&
              (renderClaimManagement ? (
                renderClaimManagement(claimRows, async () => {
                  const result = await fetchAllClaimSubmissions(ownerId);
                  setClaimData({ ownerId, rows: result.submissions });
                  onChanged();
                })
              ) : (
                <ClaimOrderResults submissions={claimRows} />
              ))}
          </DataState>
        </>
      )}
    </section>
  );
}
