"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  ExternalLink,
  Info,
  Phone,
  RefreshCw,
  Settings2,
  ShoppingCart,
  Users,
} from "lucide-react";

import {
  CLAIM_PAYMENT_STATUS_LABELS,
  CLAIM_PAYMENT_STATUSES,
  formatTaipeiDateTime,
  type ClaimFormManagement,
  getClaimSubmissionTotal,
  getClaimSubmissionPaidAmount,
  getClaimSubmissionOutstandingAmount,
  type ClaimSubmission,
  type ClaimPaymentStatus,
} from "@/lib/claims";
import { AvailabilitySwitch } from "@/components/order-management/AvailabilitySwitch";
import { RemoveRecordButton } from "@/components/order-management/RemoveRecordButton";
import { CustomerList } from "@/components/order-management/CustomerList";
import { OrderContactDetails } from "@/components/order-management/OrderContactDetails";
import { OrderItems } from "@/components/order-management/OrderItems";
import { PaymentHistory } from "@/components/order-management/PaymentHistory";
import { PaymentSection } from "@/components/order-management/PaymentSection";
import {
  PaymentRecordEditor,
  type PaymentEditorValues,
} from "@/components/order-management/PaymentRecordEditor";
import type { Order } from "@/lib/types";

export interface ClaimSubmissionsViewProps {
  data: ClaimFormManagement;
  loading: boolean;
  orders: Order[];
  customerPhone: string;
  publicPath: string;
  isOpen: boolean;
  onToggleOpen: () => Promise<void>;
  onNavigateToSettings: () => void;
  onClearCustomerSearch: () => Promise<void>;
  searchControls?: ReactNode;
  onReload: (page?: number) => Promise<void>;
  onDeleteSubmission: (
    submissionId: number,
    formId: number,
    source: ClaimSubmission["source"],
    expectedUpdatedAt?: string,
  ) => Promise<void>;
  onUpdatePaymentStatus: (
    submissionId: number,
    formId: number,
    paymentStatus: ClaimPaymentStatus,
  ) => Promise<void>;
  onDownloadSummary: () => void;
  onRecordPayment: (input: {
    source: ClaimSubmission["source"];
    submissionId: number;
    amount: number;
    transferredAt: string;
    payerAccountLastFive: string;
    note: string;
  }) => Promise<void>;
  onNavigateToCustomerCheckout?: (phone: string) => void;
}

const PAYMENT_STATUS_ACTIVE_STYLES: Record<ClaimPaymentStatus, string> = {
  pending: "border-muted/50 bg-light text-dark",
  half_paid: "border-accent/40 bg-accent-soft text-accent-strong",
  paid: "border-success/35 bg-success-soft text-success",
};

export function ClaimSubmissionsView({
  data,
  loading,
  orders,
  customerPhone,
  publicPath,
  isOpen,
  onToggleOpen,
  onNavigateToSettings,
  onClearCustomerSearch,
  searchControls,
  onReload,
  onDeleteSubmission,
  onUpdatePaymentStatus,
  onDownloadSummary,
  onRecordPayment,
  onNavigateToCustomerCheckout,
}: ClaimSubmissionsViewProps) {
  const [view, setView] = useState<"customers" | "procurement">("customers");
  const [selection, setSelection] = useState<{
    scope: string;
    key: string;
  } | null>(null);
  const selectionScope = `${data.form?.id}:${customerPhone}:${data.pagination.page}`;
  const recordKey = (record: ClaimSubmission) =>
    `${record.source}:${record.id}`;
  const selected =
    data.submissions.find(
      (record) =>
        selection?.scope === selectionScope &&
        recordKey(record) === selection.key,
    ) ?? data.submissions[0];
  const [paymentEditor, setPaymentEditor] = useState<{
    key: string;
    scope: string;
    values: PaymentEditorValues;
  } | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const money = (value: number) =>
    `$${value.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
  async function saveSelectedPayment() {
    if (
      !selected ||
      !paymentEditor ||
      savingPayment ||
      loading ||
      paymentEditor.scope !== selectionScope ||
      paymentEditor.key !== recordKey(selected)
    )
      return;
    const amount = Number(paymentEditor.values.amount);
    const outstanding = getClaimSubmissionOutstandingAmount(selected);
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > outstanding ||
      (selected.source === "bundle" && Math.abs(amount - outstanding) > 0.001)
    ) {
      setPaymentError(
        selected.source === "bundle"
          ? "配單必須登記剩餘全額。"
          : "匯款金額須大於 0，且不可超過待付金額。",
      );
      return;
    }
    const transferredAt = new Date(paymentEditor.values.transferredAt);
    if (
      !Number.isFinite(transferredAt.getTime()) ||
      (paymentEditor.values.lastFive &&
        !/^\d{5}$/.test(paymentEditor.values.lastFive))
    ) {
      setPaymentError("請確認匯款時間與帳號末五碼。");
      return;
    }
    setSavingPayment(true);
    setPaymentError("");
    setPaymentMessage("");
    try {
      await onRecordPayment({
        source: selected.source,
        submissionId: selected.id,
        amount,
        transferredAt: transferredAt.toISOString(),
        payerAccountLastFive: paymentEditor.values.lastFive,
        note: paymentEditor.values.note.trim(),
      });
      setPaymentEditor(null);
      await onReload(data.pagination.page);
      setPaymentMessage("匯款紀錄已儲存。");
    } catch (error) {
      setPaymentError(
        error instanceof Error ? error.message : "匯款紀錄儲存失敗。",
      );
    } finally {
      setSavingPayment(false);
    }
  }
  const [copied, setCopied] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [updatingPaymentId, setUpdatingPaymentId] = useState<number | null>(
    null,
  );
  const [paymentError, setPaymentError] = useState("");
  const [paymentMessage, setPaymentMessage] = useState("");

  const matchingOrders = useMemo(() => {
    if (!customerPhone) return [];
    return orders.filter((order) =>
      order.customerContact.replace(/\D/g, "").includes(customerPhone),
    );
  }, [customerPhone, orders]);

  async function copyLink() {
    if (!publicPath) return;
    const url = `${window.location.origin}${publicPath}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("複製以下訂購連結", url);
    }
  }

  async function handleToggle() {
    if (toggling || loading) return;
    if (
      isOpen &&
      !window.confirm(
        `確定暫停「${data.form?.title || "訂購頁"}」接收訂購？既有訂購紀錄會保留。`,
      )
    )
      return;
    setToggling(true);
    try {
      await onToggleOpen();
    } finally {
      setToggling(false);
    }
  }

  async function handleDeleteSubmission(
    submission: ClaimFormManagement["submissions"][number],
  ) {
    if (
      loading ||
      savingPayment ||
      deletingId !== null ||
      updatingPaymentId !== null ||
      submission.payments.length > 0 ||
      submission.receivingCheckedAt ||
      submission.outboundCheckedAt
    )
      return;
    const confirmed = window.confirm(
      `確定要移除「${submission.nickname}」的這筆${submission.source === "bundle" ? "配單" : "訂購"}嗎？\n\n活動：${submission.formTitle}\n確認編號：${submission.confirmationCode}\n總額：${money(getClaimSubmissionTotal(submission))}\n\n移除後無法復原，商品統計與對帳資料也會同步更新。`,
    );
    if (!confirmed) return;

    setDeletingId(submission.id);
    setDeleteError("");
    setDeleteMessage("");
    try {
      await onDeleteSubmission(
        submission.id,
        submission.formId,
        submission.source,
        submission.updatedAt,
      );
      const nextPage =
        data.submissions.length === 1 && data.pagination.page > 1
          ? data.pagination.page - 1
          : data.pagination.page;
      await onReload(nextPage);
      setDeleteMessage(`已移除「${submission.nickname}」的訂購明細。`);
    } catch (deleteSubmissionError) {
      setDeleteError(
        deleteSubmissionError instanceof Error
          ? deleteSubmissionError.message
          : "訂購明細移除失敗，請稍後再試。",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function handlePaymentStatusChange(
    submission: ClaimFormManagement["submissions"][number],
    paymentStatus: ClaimPaymentStatus,
  ) {
    if (submission.paymentStatus === paymentStatus) return;

    setUpdatingPaymentId(submission.id);
    setPaymentError("");
    setPaymentMessage("");
    try {
      await onUpdatePaymentStatus(
        submission.id,
        submission.formId,
        paymentStatus,
      );
      await onReload(data.pagination.page);
      setPaymentMessage(
        `已將「${submission.nickname}」標記為${CLAIM_PAYMENT_STATUS_LABELS[paymentStatus]}。`,
      );
    } catch (updatePaymentError) {
      setPaymentError(
        updatePaymentError instanceof Error
          ? updatePaymentError.message
          : "付款狀態更新失敗，請稍後再試。",
      );
    } finally {
      setUpdatingPaymentId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      {/* Share and Quick Action Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[8px] border border-line bg-white p-5 shadow-sm">
        <div className="min-w-0">
          <span className="eyebrow">前台連結與狀態</span>
          <h3 className="mb-0 mt-0.5 text-[17px] font-bold text-dark">
            {data.form?.title || "未命名訂購頁"}
          </h3>
          {publicPath && (
            <p className="mb-0 mt-1 truncate font-mono text-[12px] text-muted">
              {publicPath}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {publicPath && (
            <>
              <button
                type="button"
                className="outline text-[13px]"
                onClick={() => void copyLink()}
              >
                {copied ? (
                  <Check size={15} className="text-success" />
                ) : (
                  <Clipboard size={15} />
                )}
                {copied ? "已複製連結" : "複製連結"}
              </button>
              <a
                className="outline inline-flex items-center gap-1.5 text-[13px] no-underline"
                href={publicPath}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} />
                預覽頁面
              </a>
            </>
          )}

          <AvailabilitySwitch
            label="接收訂購"
            enabled={isOpen}
            busy={toggling}
            disabled={loading}
            enabledText="接收中"
            description="暫停後不接受新訂購，既有訂購紀錄會保留。"
            onToggle={() => void handleToggle()}
          />

          <button
            type="button"
            className="primary text-[13px]"
            onClick={onNavigateToSettings}
          >
            <Settings2 size={16} />
            商品設定
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="訂購紀錄檢視" className="flex gap-2">
        {(
          [
            { key: "customers", label: "顧客清單" },
            { key: "procurement", label: "採購統計" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={view === tab.key}
            type="button"
            className={view === tab.key ? "primary" : "outline"}
            onClick={() => setView(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {view === "customers" && searchControls}

      {customerPhone && (
        <section className="rounded-[8px] border border-line bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-primary-soft text-primary">
                <Phone size={19} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <span className="eyebrow">顧客查詢結果</span>
                <h3 className="mb-0 mt-0.5 text-[17px] font-bold text-dark">
                  {customerPhone} 的訂購與訂單
                </h3>
                <p className="mb-0 mt-1 text-[12px] leading-5 text-muted">
                  找到 {data.pagination.total} 筆訂購、{matchingOrders.length}{" "}
                  筆正式訂單；訂購支援暱稱、電話與確認編號。
                </p>
              </div>
            </div>
            <button
              type="button"
              className="outline min-h-8 px-3 py-1 text-[12px]"
              disabled={loading}
              onClick={() => void onClearCustomerSearch()}
            >
              結束查詢
            </button>
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="m-0 text-[13px] font-bold text-dark">
                正式訂單 ({matchingOrders.length})
              </h4>
            </div>

            {matchingOrders.length ? (
              <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {matchingOrders.map((order) => (
                  <article
                    key={order.dbId}
                    className="rounded-[8px] border border-line bg-light/30 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="block truncate text-[13px] text-dark">
                          {order.customer}
                        </strong>
                        <code className="mt-0.5 block text-[10px] text-muted">
                          {order.id}
                        </code>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted">
                        {order.createdAt}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {order.items.map((item) => (
                        <span
                          key={item.orderItemId}
                          className="rounded-md bg-white px-2 py-1 text-[11px] text-default"
                        >
                          {item.name} × {item.quantity}
                        </span>
                      ))}
                    </div>
                    <p className="mb-0 mt-2 text-[11px] text-muted">
                      {order.payment} · {order.status}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mb-0 mt-2 rounded-[8px] bg-light px-3 py-3 text-[12px] text-muted">
                查無這支電話的正式訂單。
              </p>
            )}
          </div>
        </section>
      )}

      {view === "procurement" ? (
        <section className="min-w-0 rounded-[8px] border border-line bg-white p-4 shadow-sm sm:p-5 xl:p-6">
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="min-w-0">
              <span className="eyebrow inline-flex items-center gap-1.5">
                <ShoppingCart size={12} aria-hidden="true" />
                採購依據
              </span>
              <h3 className="mb-0 mt-1.5 text-[19px] font-bold tracking-[-0.02em] text-dark">
                各商品訂購合計
              </h3>
              <p className="mb-0 mt-1 text-[12px] leading-5 text-muted">
                訂購截止後，依買家登記總數向車頭或廠商批次下單
              </p>
            </div>
            <button
              type="button"
              className="outline min-h-10 w-full whitespace-nowrap px-4 text-[12px] lg:w-auto"
              disabled={!data.productTotals.length}
              onClick={onDownloadSummary}
            >
              <Download size={15} />
              下載採購 CSV
            </button>
          </div>

          <div className="mt-4 flex items-start gap-2.5 rounded-[8px] border border-primary/20 bg-primary-soft px-3.5 py-3 text-[12px] leading-5 text-primary-strong sm:px-4">
            <Info
              size={16}
              className="mt-0.5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <p className="m-0">
              <b>訂購階段不會變動庫存。</b>
              下方「建議叫貨數量」就是目前顧客需求；若要多買備品，請在實際採購時另外加量，到貨後再辦理入庫。
            </p>
          </div>

          {data.productTotals.length ? (
            <div className="mt-4 grid min-w-0 gap-3">
              {data.productTotals.map((product) => (
                <article
                  key={`${product.productId || product.sku}-${product.name}`}
                  className="min-w-0 rounded-[8px] border border-line bg-white p-4 transition-colors hover:border-primary/40 sm:p-5"
                >
                  <div className="min-w-0">
                    <b className="block break-words text-[15px] leading-5 text-dark">
                      {product.name}
                    </b>
                    <small className="mt-1 block break-all font-mono text-[11px] text-muted">
                      {product.sku}
                    </small>
                  </div>

                  <dl className="m-0 mt-4 grid grid-cols-2 gap-3">
                    <div className="min-w-0 rounded-[8px] bg-light/70 px-3 py-3 sm:px-4">
                      <dt className="text-[10px] font-medium tracking-[0.04em] text-muted">
                        訂購人數
                      </dt>
                      <dd className="m-0 mt-1 text-[16px] font-bold text-dark">
                        {product.customerCount} 人
                      </dd>
                    </div>
                    <div className="min-w-0 rounded-[8px] bg-accent-soft px-3 py-3 sm:px-4">
                      <dt className="text-[10px] font-semibold tracking-[0.04em] text-accent-strong">
                        建議叫貨數量
                      </dt>
                      <dd className="m-0 mt-1 text-[16px] font-bold text-accent-strong">
                        {product.quantity}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          ) : (
            <div className="mb-0 mt-5 rounded-[8px] bg-light px-4 py-10 text-center text-[13px] text-muted">
              目前尚未收到任何預購訂購，買家送單後此處將自動彙整採購數量。
            </div>
          )}
        </section>
      ) : (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)] lg:items-start">
          <section aria-label="訂購顧客清單" className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="m-0 text-[16px] text-dark">
                顧客清單 · {data.pagination.total} 筆
              </h3>
              <button
                type="button"
                className="icon-btn size-9"
                disabled={loading || savingPayment}
                onClick={() => void onReload(data.pagination.page)}
                aria-label="重新整理訂購紀錄"
              >
                <RefreshCw
                  size={16}
                  className={loading ? "animate-spin" : ""}
                />
              </button>
            </div>
            <CustomerList
              rows={data.submissions.map((record) => ({
                key: recordKey(record),
                name: record.nickname,
                amount: money(getClaimSubmissionTotal(record)),
                status:
                  record.payments.length > 0 &&
                  getClaimSubmissionOutstandingAmount(record) > 0
                    ? "部分付款"
                    : CLAIM_PAYMENT_STATUS_LABELS[record.paymentStatus],
                statusClassName:
                  PAYMENT_STATUS_ACTIVE_STYLES[record.paymentStatus],
                description: customerPhone ? record.formTitle : undefined,
              }))}
              selectedKey={selected && recordKey(selected)}
              disabled={
                loading ||
                savingPayment ||
                updatingPaymentId !== null ||
                deletingId !== null
              }
              onSelect={(key) => {
                setSelection({ scope: selectionScope, key });
                setPaymentEditor(null);
                setPaymentError("");
                setPaymentMessage("");
              }}
            />
            {!data.submissions.length && (
              <p className="py-8 text-center text-[13px] text-muted">
                目前沒有符合條件的訂購紀錄。
              </p>
            )}
            {data.pagination.totalPages > 1 && (
              <div className="mt-5 flex items-center justify-between gap-2 border-t border-line pt-4">
                <button
                  type="button"
                  className="outline shrink-0 text-[12px]"
                  disabled={loading || data.pagination.page <= 1}
                  onClick={() => void onReload(data.pagination.page - 1)}
                >
                  <ChevronLeft size={15} /> 上一頁
                </button>
                <span className="text-center text-[12px] text-muted">
                  第 {data.pagination.page} / {data.pagination.totalPages} 頁
                </span>
                <button
                  type="button"
                  className="outline shrink-0 text-[12px]"
                  disabled={
                    loading ||
                    data.pagination.page >= data.pagination.totalPages
                  }
                  onClick={() => void onReload(data.pagination.page + 1)}
                >
                  下一頁 <ChevronRight size={15} />
                </button>
              </div>
            )}
          </section>
          <section
            aria-label="訂購明細"
            className="min-w-0 rounded-[14px] border border-line bg-white p-5 lg:sticky lg:top-4 md:p-6"
          >
            {!selected ? (
              <p className="py-12 text-center text-[13px] text-muted">
                選擇顧客查看商品與付款資料
              </p>
            ) : (
              <>
                <OrderContactDetails
                  badge={
                    <span className="rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-bold text-primary">
                      {selected.paymentStatus === "half_paid" &&
                      selected.payments.length > 0
                        ? "部分付款"
                        : CLAIM_PAYMENT_STATUS_LABELS[selected.paymentStatus]}
                    </span>
                  }
                  name={selected.nickname}
                  phone={selected.phone}
                  notes={selected.notes}
                  metadata={
                    <>
                      <p className="m-0">活動：{selected.formTitle}</p>
                      <p className="m-0 font-mono">
                        確認編號：{selected.confirmationCode}
                      </p>
                      <p className="m-0">
                        確認時間：{formatTaipeiDateTime(selected.createdAt)}
                      </p>
                    </>
                  }
                  actions={
                    onNavigateToCustomerCheckout && (
                      <button
                        type="button"
                        className="outline min-h-8 text-[11px]"
                        onClick={() =>
                          onNavigateToCustomerCheckout(selected.phone)
                        }
                      >
                        <Users size={12} />
                        跨表單對帳
                      </button>
                    )
                  }
                />
                <OrderItems
                  items={selected.items.map((item) => ({
                    key: String(item.id),
                    name: item.name,
                    quantity: item.quantity,
                    amount: money(item.unitPrice * item.quantity),
                  }))}
                  total={money(getClaimSubmissionTotal(selected))}
                />
                <PaymentSection
                  summary={
                    <>
                      已付 {money(getClaimSubmissionPaidAmount(selected))} ·
                      待付{" "}
                      {money(getClaimSubmissionOutstandingAmount(selected))}
                    </>
                  }
                  actions={
                    getClaimSubmissionOutstandingAmount(selected) > 0 && (
                      <button
                        type="button"
                        className="primary min-h-9 text-[12px]"
                        disabled={
                          loading || savingPayment || updatingPaymentId !== null
                        }
                        onClick={() => {
                          const date = new Date();
                          setPaymentEditor({
                            key: recordKey(selected),
                            scope: selectionScope,
                            values: {
                              amount: String(
                                getClaimSubmissionOutstandingAmount(selected),
                              ),
                              transferredAt: new Date(
                                date.getTime() -
                                  date.getTimezoneOffset() * 60000,
                              )
                                .toISOString()
                                .slice(0, 16),
                              lastFive: "",
                              note: "",
                            },
                          });
                          setPaymentError("");
                        }}
                      >
                        登記匯款
                      </button>
                    )
                  }
                >
                  {selected.source === "claim" &&
                    selected.payments.length === 0 && (
                      <fieldset
                        disabled={
                          loading ||
                          savingPayment ||
                          updatingPaymentId !== null ||
                          selected.payments.length > 0
                        }
                        className="m-0 min-w-0 border-0 p-0"
                      >
                        <legend className="mb-2 text-[11px] text-muted">
                          快速付款狀態
                        </legend>
                        <div className="grid grid-cols-3 gap-2">
                          {CLAIM_PAYMENT_STATUSES.map((status) => (
                            <button
                              key={status}
                              type="button"
                              className={`min-h-9 min-w-0 rounded-[8px] border px-1 text-[11px] ${selected.paymentStatus === status ? PAYMENT_STATUS_ACTIVE_STYLES[status] : "border-line text-muted"}`}
                              aria-pressed={selected.paymentStatus === status}
                              onClick={() =>
                                void handlePaymentStatusChange(selected, status)
                              }
                            >
                              {CLAIM_PAYMENT_STATUS_LABELS[status]}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                    )}
                  <PaymentHistory
                    records={selected.payments.map((payment) => ({
                      key: String(payment.id),
                      amount: money(payment.amount),
                      transferredAt: formatTaipeiDateTime(
                        payment.transferredAt,
                      ),
                      lastFive: payment.payerAccountLastFive,
                      note: payment.note,
                    }))}
                  />
                  {selected.payments.length > 0 && (
                    <p className="mb-0 mt-2 text-[11px] text-muted">
                      已登記 {selected.payments.length}{" "}
                      筆匯款；付款狀態依紀錄計算。可至跨表單對帳查看或撤銷紀錄。
                    </p>
                  )}
                  {paymentEditor?.key === recordKey(selected) &&
                    paymentEditor.scope === selectionScope && (
                      <div className="mt-3">
                        <PaymentRecordEditor
                          values={paymentEditor.values}
                          onChange={(values) =>
                            setPaymentEditor({ ...paymentEditor, values })
                          }
                          amountReadOnly={selected.source === "bundle"}
                          maximumAmount={getClaimSubmissionOutstandingAmount(
                            selected,
                          )}
                          presets={
                            selected.source === "claim"
                              ? [
                                  {
                                    label: "剩餘全額",
                                    amount:
                                      getClaimSubmissionOutstandingAmount(
                                        selected,
                                      ),
                                  },
                                  {
                                    label: "剩餘一半",
                                    amount:
                                      Math.round(
                                        getClaimSubmissionOutstandingAmount(
                                          selected,
                                        ) * 50,
                                      ) / 100,
                                  },
                                ]
                              : undefined
                          }
                          saving={savingPayment}
                          onSubmit={() => void saveSelectedPayment()}
                          onCancel={() => setPaymentEditor(null)}
                        />
                      </div>
                    )}
                </PaymentSection>
                <div className="mt-4 border-t border-line pt-3">
                  <RemoveRecordButton
                    ariaLabel={`移除 ${selected.nickname} 的${selected.source === "bundle" ? "配單" : "訂購明細"}`}
                    busy={deletingId === selected.id}
                    disabled={
                      loading ||
                      savingPayment ||
                      deletingId !== null ||
                      updatingPaymentId !== null ||
                      selected.payments.length > 0 ||
                      Boolean(
                        selected.receivingCheckedAt ||
                          selected.outboundCheckedAt,
                      )
                    }
                    reason={
                      selected.payments.length > 0
                        ? "請先至跨表單對帳撤銷匯款紀錄，再移除這筆紀錄。"
                        : selected.receivingCheckedAt ||
                            selected.outboundCheckedAt
                          ? "請先至配單管理撤銷入出庫核對，再移除。"
                          : undefined
                    }
                    onClick={() => void handleDeleteSubmission(selected)}
                  />
                </div>
              </>
            )}
            {(deleteError || paymentError) && (
              <p role="alert" className="mt-3 text-[12px] text-danger">
                {deleteError || paymentError}
              </p>
            )}
            {(deleteMessage || paymentMessage) && (
              <p role="status" className="mt-3 text-[12px] text-success">
                {deleteMessage || paymentMessage}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
