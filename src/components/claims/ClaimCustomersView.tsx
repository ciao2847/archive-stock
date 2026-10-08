"use client";

import { useMemo, useState } from "react";
import { RemoveRecordButton } from "@/components/order-management/RemoveRecordButton";
import { PaymentRecordEditor } from "@/components/order-management/PaymentRecordEditor";
import {
  Banknote,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  LoaderCircle,
  Phone,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from "lucide-react";

import {
  CLAIM_PAYMENT_STATUS_LABELS,
  formatCustomerClaimLineSummary,
  formatTaipeiDateTime,
  getClaimSubmissionOutstandingAmount,
  getClaimSubmissionPaidAmount,
  getClaimSubmissionTotal,
  groupClaimSubmissionsByCustomer,
  type ClaimSubmission,
  type ClaimTransferAccount,
  type CustomerClaimGroup,
} from "@/lib/claims";

export interface ClaimCustomersViewProps {
  submissions: ClaimSubmission[];
  loading: boolean;
  inventoryName: string;
  officialLineId?: string;
  transferAccount?: ClaimTransferAccount;
  onRecordPayment: (input: {
    source: ClaimSubmission["source"];
    submissionId: number;
    amount: number;
    transferredAt: string;
    payerAccountLastFive: string;
    note: string;
  }) => Promise<void>;
  onDeletePayment: (
    paymentId: number,
    submission: ClaimSubmission,
  ) => Promise<void>;
  onDeleteSubmission: (
    submissionId: number,
    formId: number,
    source: ClaimSubmission["source"],
    expectedUpdatedAt?: string,
  ) => Promise<void>;
  onReload: () => Promise<void>;
  initialSearchQuery?: string;
}

function localDateTimeInputValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ClaimCustomersView({
  submissions,
  loading,
  inventoryName,
  officialLineId,
  transferAccount,
  onRecordPayment,
  onDeletePayment,
  onDeleteSubmission,
  onReload,
  initialSearchQuery = "",
}: ClaimCustomersViewProps) {
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [statusFilter, setStatusFilter] = useState<
    "unsettled" | "paid" | "all"
  >("unsettled");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [deletingSubmissionKey, setDeletingSubmissionKey] = useState<
    string | null
  >(null);
  const [paymentEditorSubmissionKey, setPaymentEditorSubmissionKey] = useState<
    string | null
  >(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentTransferredAt, setPaymentTransferredAt] = useState(
    localDateTimeInputValue,
  );
  const [paymentLastFive, setPaymentLastFive] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<number | null>(
    null,
  );
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");

  const submissionKey = (submission: ClaimSubmission) =>
    `${submission.source}:${submission.id}`;

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
      const matchPhone = cleanQuery && cleanPhone.includes(cleanQuery);
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
      transferAccount,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(group.customerKey);
      setActionMessage(`已複製「${group.nickname}」的 LINE 訂購對帳單！`);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      window.prompt("請複製以下對帳文字：", text);
    }
  }

  function openPaymentEditor(submission: ClaimSubmission) {
    setPaymentEditorSubmissionKey(submissionKey(submission));
    setPaymentAmount(String(getClaimSubmissionOutstandingAmount(submission)));
    setPaymentTransferredAt(localDateTimeInputValue());
    setPaymentLastFive("");
    setPaymentNote("");
    setActionError("");
  }

  async function handleRecordPayment(submission: ClaimSubmission) {
    const amount = Number(paymentAmount);
    const outstanding = getClaimSubmissionOutstandingAmount(submission);
    if (
      submission.source === "bundle" &&
      Math.abs(amount - outstanding) > 0.001
    ) {
      setActionError(`配單只能登記全額 $${outstanding.toLocaleString()}。`);
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding) {
      setActionError(
        `匯款金額須大於 0，且不可超過待付餘額 $${outstanding.toLocaleString()}。`,
      );
      return;
    }
    if (paymentLastFive && !/^\d{5}$/.test(paymentLastFive)) {
      setActionError("帳號末五碼須為 5 位數字，或留空。");
      return;
    }

    setSavingPayment(true);
    setActionError("");
    setActionMessage("");
    try {
      await onRecordPayment({
        source: submission.source,
        submissionId: submission.id,
        amount,
        transferredAt: new Date(paymentTransferredAt).toISOString(),
        payerAccountLastFive: paymentLastFive,
        note: paymentNote.trim(),
      });
      await onReload();
      setPaymentEditorSubmissionKey(null);
      setActionMessage(
        `已登記「${submission.nickname}」匯款 $${amount.toLocaleString()}。`,
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "匯款紀錄新增失敗，請稍後再試。",
      );
    } finally {
      setSavingPayment(false);
    }
  }

  async function handleDeletePayment(
    submission: ClaimSubmission,
    paymentId: number,
    amount: number,
  ) {
    if (
      !window.confirm(
        `確定要刪除這筆 $${amount.toLocaleString()} 的匯款紀錄嗎？`,
      )
    ) {
      return;
    }
    setDeletingPaymentId(paymentId);
    setActionError("");
    setActionMessage("");
    try {
      await onDeletePayment(paymentId, submission);
      await onReload();
      setActionMessage("匯款紀錄已刪除，待付餘額已重新計算。");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "匯款紀錄刪除失敗，請稍後再試。",
      );
    } finally {
      setDeletingPaymentId(null);
    }
  }

  async function handleDeleteSubmission(submission: ClaimSubmission) {
    if (
      loading ||
      savingPayment ||
      deletingSubmissionKey !== null ||
      deletingPaymentId !== null ||
      submission.payments.length > 0 ||
      submission.receivingCheckedAt ||
      submission.outboundCheckedAt
    )
      return;
    const confirmed = window.confirm(
      `確定要刪除「${submission.nickname}」在「${submission.formTitle}」的這筆${submission.source === "bundle" ? "配單" : "訂購"}嗎？\n\n確認編號：${submission.confirmationCode}\n總額：$${getClaimSubmissionTotal(submission).toLocaleString()}\n刪除後無法復原，商品統計與對帳資料也會同步更新。`,
    );
    if (!confirmed) return;

    setDeletingSubmissionKey(submissionKey(submission));
    setActionError("");
    setActionMessage("");
    try {
      await onDeleteSubmission(
        submission.id,
        submission.formId,
        submission.source,
        submission.updatedAt,
      );
      await onReload();
      setActionMessage(
        `已刪除「${submission.nickname}」在「${submission.formTitle}」的訂購明細。`,
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "訂購明細刪除失敗，請稍後再試。",
      );
    } finally {
      setDeletingSubmissionKey(null);
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
              訂購頁的全部商品；直接查看誰尚未結帳、買了哪些、總金額多少，告別跨記事本手動找人的繁瑣！
            </p>
          </div>

          <button
            type="button"
            className="icon-btn size-10 shrink-0"
            onClick={() => void onReload()}
            disabled={loading || savingPayment || deletingPaymentId !== null}
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
                      共 {group.submissions.length} 筆訂購 ·{" "}
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
                      const subKey = submissionKey(sub);
                      const isSubDeleting = deletingSubmissionKey === subKey;
                      const subTotal = getClaimSubmissionTotal(sub);
                      const subPaid = getClaimSubmissionPaidAmount(sub);
                      const subOutstanding =
                        getClaimSubmissionOutstandingAmount(sub);
                      const isPaymentEditorOpen =
                        paymentEditorSubmissionKey === subKey;

                      return (
                        <div
                          key={subKey}
                          className="rounded-[8px] border border-line/70 bg-light/20 p-3.5 transition-colors"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="rounded-[6px] bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary-strong">
                                {sub.formTitle}
                              </span>
                              <span className="rounded-[6px] border border-line bg-white px-2 py-0.5 text-[10px] font-bold text-muted">
                                {sub.source === "bundle" ? "配單" : "商品訂購"}
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

                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`rounded-[6px] px-2 py-1 text-[10px] font-bold ${
                                  subOutstanding === 0
                                    ? "bg-success-soft text-success"
                                    : subPaid > 0
                                      ? "bg-accent-soft text-accent-strong"
                                      : "border border-line bg-white text-muted"
                                }`}
                              >
                                {subOutstanding === 0
                                  ? "已付全額"
                                  : subPaid > 0
                                    ? "部分匯款"
                                    : "未匯款"}
                              </span>
                              {subOutstanding > 0 && (
                                <button
                                  type="button"
                                  className="inline-flex min-h-7 items-center gap-1 rounded-[6px] bg-primary px-2.5 py-1 text-[10px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                                  disabled={
                                    loading ||
                                    savingPayment ||
                                    deletingPaymentId !== null ||
                                    deletingSubmissionKey !== null
                                  }
                                  onClick={() => openPaymentEditor(sub)}
                                >
                                  <Banknote size={12} aria-hidden="true" />
                                  登記匯款
                                </button>
                              )}
                              <RemoveRecordButton
                                ariaLabel={`移除 ${sub.nickname} 的${sub.source === "bundle" ? "配單" : "訂購明細"}`}
                                busy={isSubDeleting}
                                disabled={
                                  loading ||
                                  savingPayment ||
                                  deletingPaymentId !== null ||
                                  deletingSubmissionKey !== null ||
                                  sub.payments.length > 0 ||
                                  Boolean(
                                    sub.receivingCheckedAt ||
                                      sub.outboundCheckedAt,
                                  )
                                }
                                reason={
                                  sub.payments.length > 0
                                    ? "請先撤銷匯款紀錄再移除。"
                                    : sub.receivingCheckedAt ||
                                        sub.outboundCheckedAt
                                      ? "請先至配單管理撤銷入出庫核對，再移除。"
                                      : undefined
                                }
                                onClick={() => void handleDeleteSubmission(sub)}
                              />
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
                                  $
                                  {(
                                    item.unitPrice * item.quantity
                                  ).toLocaleString()}
                                </span>
                              </div>
                            ))}
                          </div>

                          {sub.notes && (
                            <p className="mb-0 mt-2 rounded-[6px] bg-white px-2.5 py-1 text-[11px] text-muted">
                              備註：{sub.notes}
                            </p>
                          )}

                          <div className="mt-3 grid grid-cols-3 gap-2 rounded-[6px] border border-line/60 bg-white p-2.5 text-center">
                            <div>
                              <span className="block text-[10px] text-muted">
                                訂單金額
                              </span>
                              <b className="mt-0.5 block text-[12px] text-dark">
                                ${subTotal.toLocaleString()}
                              </b>
                            </div>
                            <div>
                              <span className="block text-[10px] text-muted">
                                已收金額
                              </span>
                              <b className="mt-0.5 block text-[12px] text-success">
                                ${subPaid.toLocaleString()}
                              </b>
                            </div>
                            <div>
                              <span className="block text-[10px] text-muted">
                                待付餘額
                              </span>
                              <b className="mt-0.5 block text-[12px] text-accent-strong">
                                ${subOutstanding.toLocaleString()}
                              </b>
                            </div>
                          </div>

                          {sub.payments.length > 0 && (
                            <div className="mt-3">
                              <h5 className="m-0 text-[11px] font-bold text-dark">
                                匯款紀錄（{sub.payments.length}）
                              </h5>
                              <div className="mt-2 space-y-1.5">
                                {sub.payments.map((payment) => (
                                  <div
                                    key={payment.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-success/20 bg-success-soft/40 px-2.5 py-2"
                                  >
                                    <div className="min-w-0 text-[11px]">
                                      <b className="mr-2 text-success">
                                        ${payment.amount.toLocaleString()}
                                      </b>
                                      <span className="text-muted">
                                        {formatTaipeiDateTime(
                                          payment.transferredAt,
                                        )}
                                      </span>
                                      {payment.payerAccountLastFive && (
                                        <span className="ml-2 text-dark">
                                          末五碼 {payment.payerAccountLastFive}
                                        </span>
                                      )}
                                      {payment.note && (
                                        <span className="mt-1 block break-words text-muted">
                                          {payment.note}
                                        </span>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      className="icon-btn size-7 shrink-0 text-danger"
                                      disabled={
                                        deletingPaymentId !== null ||
                                        savingPayment
                                      }
                                      onClick={() =>
                                        void handleDeletePayment(
                                          sub,
                                          payment.id,
                                          payment.amount,
                                        )
                                      }
                                      aria-label="刪除匯款紀錄"
                                      title="刪除匯款紀錄"
                                    >
                                      {deletingPaymentId === payment.id ? (
                                        <LoaderCircle
                                          size={12}
                                          className="animate-spin"
                                        />
                                      ) : (
                                        <Trash2 size={12} />
                                      )}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {sub.payments.length === 0 && subPaid > 0 && (
                            <p className="mb-0 mt-2 text-[10px] leading-4 text-muted">
                              此筆為舊版快速付款狀態，尚無逐筆匯款日期與末五碼紀錄。
                            </p>
                          )}

                          {isPaymentEditorOpen && (
                            <div className="mt-3">
                              <PaymentRecordEditor
                                values={{
                                  amount: paymentAmount,
                                  transferredAt: paymentTransferredAt,
                                  lastFive: paymentLastFive,
                                  note: paymentNote,
                                }}
                                onChange={(values) => {
                                  setPaymentAmount(values.amount);
                                  setPaymentTransferredAt(values.transferredAt);
                                  setPaymentLastFive(values.lastFive);
                                  setPaymentNote(values.note);
                                }}
                                amountReadOnly={sub.source === "bundle"}
                                maximumAmount={subOutstanding}
                                presets={[
                                  { label: "剩餘全額", amount: subOutstanding },
                                  ...(sub.source === "claim"
                                    ? [
                                        {
                                          label: "剩餘一半",
                                          amount:
                                            Math.round(subOutstanding * 50) /
                                            100,
                                        },
                                      ]
                                    : []),
                                ]}
                                saving={savingPayment}
                                onSubmit={() => void handleRecordPayment(sub)}
                                onCancel={() =>
                                  setPaymentEditorSubmissionKey(null)
                                }
                              />
                            </div>
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
                        展開訂購明細 ({group.submissions.length})
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
                : "目前尚無任何顧客訂購紀錄"}
          </h4>
          <p className="mx-auto mb-0 mt-1 max-w-[360px] text-[12px] text-muted">
            {searchQuery
              ? "請嘗試更換電話、暱稱或商品名稱再次搜尋。"
              : statusFilter === "unsettled"
                ? "太棒了！目前庫藏中沒有待處理的匯款與欠款。"
                : "買家在任何公開訂購頁登記後，將自動在此處以顧客為單位歸戶。"}
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
