"use client";

import { useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  LoaderCircle,
  Phone,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";

import {
  CLAIM_PAYMENT_STATUS_LABELS,
  CLAIM_PAYMENT_STATUSES,
  formatCustomerClaimLineSummary,
  formatTaipeiDateTime,
  groupClaimSubmissionsByCustomer,
  type ClaimPaymentStatus,
  type ClaimSubmission,
  type CustomerClaimGroup,
} from "@/lib/claims";

export interface ClaimCustomersViewProps {
  submissions: ClaimSubmission[];
  loading: boolean;
  inventoryName: string;
  officialLineId?: string;
  onUpdatePaymentStatus: (
    submissionIds: number[],
    paymentStatus: ClaimPaymentStatus,
  ) => Promise<void>;
  onReload: () => Promise<void>;
  initialSearchQuery?: string;
}

const PAYMENT_STATUS_ACTIVE_STYLES: Record<ClaimPaymentStatus, string> = {
  pending: "border-muted/50 bg-light text-dark",
  half_paid: "border-accent/40 bg-accent-soft text-accent-strong",
  paid: "border-success/35 bg-success-soft text-success",
};

export function ClaimCustomersView({
  submissions,
  loading,
  inventoryName,
  officialLineId,
  onUpdatePaymentStatus,
  onReload,
  initialSearchQuery = "",
}: ClaimCustomersViewProps) {
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [statusFilter, setStatusFilter] = useState<
    "unsettled" | "paid" | "all"
  >("unsettled");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [updatingSubmissionId, setUpdatingSubmissionId] = useState<
    number | null
  >(null);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");

  const allGroups = useMemo(
    () => groupClaimSubmissionsByCustomer(submissions),
    [submissions],
  );

  const stats = useMemo(() => {
    let unsettledCustomerCount = 0;
    let unsettledAmount = 0;
    let paidCustomerCount = 0;
    let totalItems = 0;

    for (const group of allGroups) {
      totalItems += group.totalQuantity;
      if (group.status === "paid") {
        paidCustomerCount++;
      } else {
        unsettledCustomerCount++;
        unsettledAmount += group.unsettledAmount;
      }
    }

    return {
      totalCustomers: allGroups.length,
      unsettledCustomerCount,
      unsettledAmount,
      paidCustomerCount,
      totalItems,
    };
  }, [allGroups]);

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return allGroups.filter((group) => {
      // Status filter
      if (statusFilter === "unsettled" && group.status === "paid") return false;
      if (statusFilter === "paid" && group.status !== "paid") return false;

      // Text search filter
      if (!query) return true;
      const cleanPhone = group.phone.replace(/\D/g, "");
      const cleanQuery = query.replace(/\D/g, "");
      const matchPhone =
        cleanQuery && cleanPhone.includes(cleanQuery);
      const matchNickname = group.nickname.toLowerCase().includes(query);
      const matchFormOrItem = group.submissions.some(
        (sub) =>
          sub.formTitle.toLowerCase().includes(query) ||
          sub.items.some((item) => item.name.toLowerCase().includes(query)),
      );

      return matchPhone || matchNickname || matchFormOrItem;
    });
  }, [allGroups, searchQuery, statusFilter]);

  function toggleCollapse(key: string) {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleCopyLineSummary(group: CustomerClaimGroup) {
    const text = formatCustomerClaimLineSummary({
      storeName: inventoryName,
      group,
      officialLineId,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(group.customerKey);
      setActionMessage(`已複製「${group.nickname}」的 LINE 喊單對帳單！`);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      window.prompt("請複製以下對帳文字：", text);
    }
  }

  async function handleBatchUpdateCustomerStatus(
    group: CustomerClaimGroup,
    nextStatus: ClaimPaymentStatus,
  ) {
    const ids = group.submissions.map((s) => s.id);
    if (!ids.length) return;

    setUpdatingKey(group.customerKey);
    setActionError("");
    setActionMessage("");
    try {
      await onUpdatePaymentStatus(ids, nextStatus);
      await onReload();
      setActionMessage(
        `已將「${group.nickname}」的所有喊單標記為「${CLAIM_PAYMENT_STATUS_LABELS[nextStatus]}」。`,
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "更新付款狀態失敗，請稍後再試。",
      );
    } finally {
      setUpdatingKey(null);
    }
  }

  async function handleSingleSubmissionStatusChange(
    submission: ClaimSubmission,
    nextStatus: ClaimPaymentStatus,
  ) {
    if (submission.paymentStatus === nextStatus) return;

    setUpdatingSubmissionId(submission.id);
    setActionError("");
    setActionMessage("");
    try {
      await onUpdatePaymentStatus([submission.id], nextStatus);
      await onReload();
      setActionMessage(
        `已將「${submission.nickname}」在「${submission.formTitle}」的喊單標記為「${CLAIM_PAYMENT_STATUS_LABELS[nextStatus]}」。`,
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "更新付款狀態失敗，請稍後再試。",
      );
    } finally {
      setUpdatingSubmissionId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      {/* Overview & Stats Banner */}
      <section className="min-w-0 rounded-[8px] border border-line bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="eyebrow inline-flex items-center gap-1.5">
              <Users size={12} aria-hidden="true" />
              全庫藏跨表單歸戶
            </span>
            <h3 className="mb-0 mt-1 text-[20px] font-bold tracking-[-0.02em] text-dark">
              顧客對帳與待結帳總覽
            </h3>
            <p className="mb-0 mt-1 text-[13px] leading-5 text-muted">
              自動彙整相同顧客在各 IP
              喊單頁的全部商品；直接查看誰尚未結帳、買了哪些、總金額多少，告別跨記事本手動找人的繁瑣！
            </p>
          </div>

          <button
            type="button"
            className="icon-btn size-10 shrink-0"
            onClick={() => void onReload()}
            disabled={loading || updatingKey !== null}
            aria-label="重新整理顧客對帳資料"
            title="重新整理"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Stats Cards */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4">
          <div className="rounded-[8px] border border-accent/25 bg-accent-soft p-3.5 sm:p-4">
            <span className="text-[11px] font-semibold tracking-[0.02em] text-accent-strong">
              待結帳顧客
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <strong className="text-[20px] font-bold text-accent-strong sm:text-[24px]">
                {stats.unsettledCustomerCount}
              </strong>
              <span className="text-[12px] text-accent-strong/80">人</span>
            </div>
          </div>

          <div className="rounded-[8px] border border-line bg-light/70 p-3.5 sm:p-4">
            <span className="text-[11px] font-medium tracking-[0.02em] text-muted">
              待收取金額總計
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <strong className="text-[20px] font-bold text-dark sm:text-[24px]">
                ${stats.unsettledAmount.toLocaleString()}
              </strong>
              <span className="text-[12px] text-muted">元</span>
            </div>
          </div>

          <div className="col-span-2 rounded-[8px] border border-success/25 bg-success-soft p-3.5 sm:col-span-1 sm:p-4">
            <span className="text-[11px] font-semibold tracking-[0.02em] text-success">
              已結清顧客
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <strong className="text-[20px] font-bold text-success sm:text-[24px]">
                {stats.paidCustomerCount}
              </strong>
              <span className="text-[12px] text-success/80">人</span>
            </div>
          </div>
        </div>
      </section>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-[8px] border border-line bg-light/50 p-1">
          <button
            type="button"
            className={`min-h-8 rounded-[6px] px-3 text-[12px] font-semibold transition ${
              statusFilter === "unsettled"
                ? "bg-white text-dark shadow-sm"
                : "text-muted hover:text-dark"
            }`}
            onClick={() => setStatusFilter("unsettled")}
          >
            尚未結帳 ({stats.unsettledCustomerCount})
          </button>
          <button
            type="button"
            className={`min-h-8 rounded-[6px] px-3 text-[12px] font-semibold transition ${
              statusFilter === "paid"
                ? "bg-white text-dark shadow-sm"
                : "text-muted hover:text-dark"
            }`}
            onClick={() => setStatusFilter("paid")}
          >
            已結清 ({stats.paidCustomerCount})
          </button>
          <button
            type="button"
            className={`min-h-8 rounded-[6px] px-3 text-[12px] font-semibold transition ${
              statusFilter === "all"
                ? "bg-white text-dark shadow-sm"
                : "text-muted hover:text-dark"
            }`}
            onClick={() => setStatusFilter("all")}
          >
            全部顧客 ({stats.totalCustomers})
          </button>
        </div>

        <div className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            className="min-h-9 w-full rounded-[8px] border border-line bg-white pl-9 pr-3 text-[13px] outline-none transition focus:border-primary"
            placeholder="搜尋顧客電話、暱稱或商品…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {actionError && (
        <p
          className="mb-0 rounded-[8px] bg-danger-soft px-4 py-2.5 text-[12px] font-medium text-danger"
          role="alert"
        >
          {actionError}
        </p>
      )}
      {actionMessage && (
        <p
          className="mb-0 rounded-[8px] bg-success-soft px-4 py-2.5 text-[12px] font-medium text-success"
          role="status"
        >
          {actionMessage}
        </p>
      )}

      {/* Customer Groups List */}
      {filteredGroups.length > 0 ? (
        <div className="space-y-4">
          {filteredGroups.map((group) => {
            const isCollapsed = collapsedKeys.has(group.customerKey);
            const isUpdating = updatingKey === group.customerKey;
            const isCopied = copiedKey === group.customerKey;
            const isPaid = group.status === "paid";
            const isHalf = group.status === "half_paid";

            return (
              <article
                key={group.customerKey}
                className="overflow-hidden rounded-[8px] border border-line bg-white shadow-sm transition hover:border-primary/40"
              >
                {/* Customer Card Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 bg-light/35 p-4 sm:px-5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2.5 sm:gap-3">
                    <strong className="text-[16px] text-dark">
                      {group.nickname}
                    </strong>
                    <a
                      className="inline-flex items-center gap-1 rounded-[6px] bg-white px-2 py-0.5 font-mono text-[12px] font-semibold text-primary no-underline border border-line/70 hover:underline"
                      href={`tel:${group.phone}`}
                      title="撥打電話"
                    >
                      <Phone size={11} aria-hidden="true" />
                      {group.phone}
                    </a>
                    <span
                      className={`rounded-[6px] px-2 py-0.5 text-[11px] font-bold ${
                        isPaid
                          ? "bg-success-soft text-success"
                          : isHalf
                            ? "bg-accent-soft text-accent-strong"
                            : "bg-light border border-line text-muted"
                      }`}
                    >
                      {CLAIM_PAYMENT_STATUS_LABELS[group.status]}
                    </span>
                  </div>

                  {/* Summary figures */}
                  <div className="flex flex-wrap items-center gap-3 text-[13px]">
                    <span className="text-muted">
                      共 {group.submissions.length} 筆喊單 ·{" "}
                      {group.totalQuantity} 件
                    </span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-[11px] text-muted">
                        {isPaid ? "總額" : "待付款"}：
                      </span>
                      <strong
                        className={`text-[17px] font-bold ${
                          isPaid ? "text-dark" : "text-accent-strong"
                        }`}
                      >
                        $
                        {(isPaid
                          ? group.totalAmount
                          : group.unsettledAmount
                        ).toLocaleString()}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Submissions Detail List */}
                {!isCollapsed && (
                  <div className="p-4 sm:p-5 space-y-3">
                    {group.submissions.map((sub) => {
                      const isSubUpdating = updatingSubmissionId === sub.id;
                      const subTotal = sub.items.reduce(
                        (sum, item) => sum + item.quantity * item.unitPrice,
                        0,
                      );

                      return (
                        <div
                          key={sub.id}
                          className="rounded-[8px] border border-line/70 bg-light/20 p-3.5 transition-colors"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="rounded-[6px] bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary-strong">
                                {sub.formTitle}
                              </span>
                              <span className="font-mono text-[10px] text-muted">
                                #{sub.confirmationCode}
                              </span>
                              <span className="text-[11px] font-bold text-dark">
                                ${subTotal.toLocaleString()}
                              </span>
                              <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                                <Clock3 size={11} aria-hidden="true" />
                                {formatTaipeiDateTime(sub.createdAt)}
                              </span>
                            </div>

                            {/* Sub item payment status buttons */}
                            <div className="flex items-center gap-1">
                              {CLAIM_PAYMENT_STATUSES.map((status) => {
                                const isActive = sub.paymentStatus === status;
                                return (
                                  <button
                                    key={status}
                                    type="button"
                                    className={`rounded-[6px] border px-2 py-0.5 text-[10px] font-semibold transition ${
                                      isActive
                                        ? PAYMENT_STATUS_ACTIVE_STYLES[status]
                                        : "border-line bg-white text-muted hover:text-dark"
                                    }`}
                                    disabled={loading || isSubUpdating}
                                    onClick={() =>
                                      void handleSingleSubmissionStatusChange(
                                        sub,
                                        status,
                                      )
                                    }
                                  >
                                    {isSubUpdating && isActive ? (
                                      <LoaderCircle
                                        size={10}
                                        className="inline animate-spin mr-1"
                                      />
                                    ) : null}
                                    {CLAIM_PAYMENT_STATUS_LABELS[status]}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Items breakdown */}
                          <div className="mt-2.5 space-y-1.5 border-t border-line/50 pt-2.5">
                            {sub.items.map((item) => (
                              <div
                                key={item.id}
                                className="flex items-center justify-between text-[12px]"
                              >
                                <span className="text-dark">
                                  {item.name} × {item.quantity}
                                </span>
                                <span className="font-mono font-medium text-muted">
                                  ${(item.unitPrice * item.quantity).toLocaleString()}
                                </span>
                              </div>
                            ))}
                          </div>

                          {sub.notes && (
                            <p className="mb-0 mt-2 rounded-[6px] bg-white px-2.5 py-1 text-[11px] text-muted">
                              備註：{sub.notes}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Card Actions Footer */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-white px-4 py-3 sm:px-5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-dark"
                    onClick={() => toggleCollapse(group.customerKey)}
                  >
                    {isCollapsed ? (
                      <>
                        <ChevronDown size={14} />
                        展開喊單明細 ({group.submissions.length})
                      </>
                    ) : (
                      <>
                        <ChevronUp size={14} />
                        收起明細
                      </>
                    )}
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="outline min-h-8 text-[12px]"
                      onClick={() => void handleCopyLineSummary(group)}
                    >
                      {isCopied ? (
                        <>
                          <Check size={14} className="text-success" />
                          已複製對帳單
                        </>
                      ) : (
                        <>
                          <Copy size={14} />
                          複製 LINE 對帳單
                        </>
                      )}
                    </button>

                    {!isPaid ? (
                      <button
                        type="button"
                        className="primary min-h-8 text-[12px]"
                        disabled={loading || isUpdating}
                        onClick={() =>
                          void handleBatchUpdateCustomerStatus(group, "paid")
                        }
                      >
                        {isUpdating ? (
                          <LoaderCircle size={14} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={14} />
                        )}
                        整單標記為已結清
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="outline min-h-8 text-[12px] text-muted"
                        disabled={loading || isUpdating}
                        onClick={() =>
                          void handleBatchUpdateCustomerStatus(
                            group,
                            "pending",
                          )
                        }
                      >
                        {isUpdating ? (
                          <LoaderCircle size={14} className="animate-spin" />
                        ) : null}
                        重設為未匯款
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-[8px] border border-line bg-white px-4 py-12 text-center shadow-sm">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-light text-muted">
            <Users size={22} aria-hidden="true" />
          </div>
          <h4 className="mb-0 mt-3 text-[15px] font-bold text-dark">
            {searchQuery
              ? "查無符合條件的顧客"
              : statusFilter === "unsettled"
                ? "所有顧客款項皆已結清！"
                : "目前尚無任何顧客喊單紀錄"}
          </h4>
          <p className="mx-auto mb-0 mt-1 max-w-[360px] text-[12px] text-muted">
            {searchQuery
              ? "請嘗試更換電話、暱稱或商品名稱再次搜尋。"
              : statusFilter === "unsettled"
                ? "太棒了！目前庫藏中沒有待處理的匯款與欠款。"
                : "買家在任何公開喊單頁登記後，將自動在此處以顧客為單位歸戶。"}
          </p>
          {searchQuery && (
            <button
              type="button"
              className="outline mt-4 min-h-8 text-[12px]"
              onClick={() => setSearchQuery("")}
            >
              清除搜尋條件
            </button>
          )}
        </div>
      )}
    </div>
  );
}
