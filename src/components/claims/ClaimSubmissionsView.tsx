"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Clipboard,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  LoaderCircle,
  Phone,
  RefreshCw,
  Settings2,
  ShoppingCart,
  Trash2,
  Users,
} from "lucide-react";

import { formatTaipeiDateTime, type ClaimFormManagement } from "@/lib/claims";
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
  onReload: (page?: number) => Promise<void>;
  onDeleteSubmission: (submissionId: number, formId: number) => Promise<void>;
  onDownloadSummary: () => void;
}

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
  onReload,
  onDeleteSubmission,
  onDownloadSummary,
}: ClaimSubmissionsViewProps) {
  const [copied, setCopied] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");

  const matchingOrders = useMemo(() => {
    if (!customerPhone) return [];
    return orders.filter(
      (order) => order.customerContact.replace(/\D/g, "") === customerPhone,
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
      window.prompt("複製以下喊單連結", url);
    }
  }

  async function handleToggle() {
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
    const confirmed = window.confirm(
      `確定要移除「${submission.nickname}」的這筆喊單嗎？\n\n刪除後無法復原，商品統計與採購數量也會同步扣除。`,
    );
    if (!confirmed) return;

    setDeletingId(submission.id);
    setDeleteError("");
    setDeleteMessage("");
    try {
      await onDeleteSubmission(submission.id, submission.formId);
      const nextPage =
        data.submissions.length === 1 && data.pagination.page > 1
          ? data.pagination.page - 1
          : data.pagination.page;
      await onReload(nextPage);
      setDeleteMessage(`已移除「${submission.nickname}」的喊單明細。`);
    } catch (deleteSubmissionError) {
      setDeleteError(
        deleteSubmissionError instanceof Error
          ? deleteSubmissionError.message
          : "喊單明細移除失敗，請稍後再試。",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      {/* Share and Quick Action Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[8px] border border-line bg-white p-5 shadow-sm">
        <div className="min-w-0">
          <span className="eyebrow">前台連結與狀態</span>
          <h3 className="mb-0 mt-0.5 text-[17px] font-bold text-dark">
            {data.form?.title || "未命名喊單頁"}
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

          <button
            type="button"
            className="outline text-[13px]"
            disabled={toggling}
            onClick={() => void handleToggle()}
          >
            {isOpen ? <EyeOff size={15} /> : <Eye size={15} />}
            {isOpen ? "暫停接收喊單" : "開放接受喊單"}
          </button>

          <button
            type="button"
            className="primary text-[13px]"
            onClick={onNavigateToSettings}
          >
            <Settings2 size={16} />
            設定外觀與商品
          </button>
        </div>
      </div>

      {customerPhone && (
        <section className="rounded-[8px] border border-line bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-primary-soft text-primary">
                <Phone size={19} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <span className="eyebrow">顧客電話查詢結果</span>
                <h3 className="mb-0 mt-0.5 text-[17px] font-bold text-dark">
                  {customerPhone} 的喊單與訂單
                </h3>
                <p className="mb-0 mt-1 text-[12px] leading-5 text-muted">
                  找到 {data.pagination.total} 筆喊單、{matchingOrders.length}{" "}
                  筆正式訂單；電話是主要查詢依據。
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

      <div className="grid min-w-0 gap-5 md:grid-cols-2">
        {/* Left: 預購採購數量 (截止後叫貨依據) */}
        <section className="min-w-0 rounded-[8px] border border-line bg-white p-4 shadow-sm sm:p-5 xl:p-6">
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="min-w-0">
              <span className="eyebrow inline-flex items-center gap-1.5">
                <ShoppingCart size={12} aria-hidden="true" />
                採購依據
              </span>
              <h3 className="mb-0 mt-1.5 text-[19px] font-bold tracking-[-0.02em] text-dark">
                各商品喊單合計
              </h3>
              <p className="mb-0 mt-1 text-[12px] leading-5 text-muted">
                喊單截止後，依買家登記總數向車頭或廠商批次下單
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
              <b>喊單階段不會變動庫存。</b>
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
                        喊單人數
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
              目前尚未收到任何預購喊單，買家送單後此處將自動彙整採購數量。
            </div>
          )}
        </section>

        {/* Right: 誰喊了什麼 (顧客明細) */}
        <section className="min-w-0 rounded-[8px] border border-line bg-white p-4 shadow-sm sm:p-5 xl:p-6">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="eyebrow inline-flex items-center gap-1.5">
                <Users size={12} aria-hidden="true" />
                顧客明細
              </span>
              <h3 className="mb-0 mt-1.5 break-words text-[19px] font-bold tracking-[-0.02em] text-dark">
                {customerPhone
                  ? `${customerPhone} 的喊單 (${data.pagination.total} 筆)`
                  : `誰喊了什麼 (${data.pagination.total} 筆)`}
              </h3>
              <p className="mb-0 mt-1 text-[12px] leading-5 text-muted">
                {customerPhone
                  ? "顯示此庫藏所有 IP 的喊單；電話是主要依據，暱稱僅供辨識"
                  : "顧客送出的電話、暱稱與個別商品品項"}
              </p>
            </div>
            <button
              type="button"
              className="icon-btn size-10 shrink-0"
              onClick={() => void onReload(data.pagination.page)}
              aria-label="重新整理喊單紀錄"
              title="重新整理"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          {deleteError && (
            <p
              className="mb-0 mt-4 rounded-[8px] bg-danger-soft px-3 py-2 text-[12px] text-danger"
              role="alert"
            >
              {deleteError}
            </p>
          )}
          {deleteMessage && (
            <p
              className="mb-0 mt-4 rounded-[8px] bg-success-soft px-3 py-2 text-[12px] text-success"
              role="status"
            >
              {deleteMessage}
            </p>
          )}

          {data.submissions.length ? (
            <div className="mt-4 space-y-3">
              {data.submissions.map((submission) => (
                <article
                  key={submission.id}
                  className="min-w-0 rounded-[8px] border border-line bg-white p-4 transition-colors hover:border-primary/50"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <strong className="break-words text-[15px] text-dark">
                        {submission.nickname}
                      </strong>
                      <span className="break-all font-mono text-[10px] text-muted">
                        {submission.confirmationCode}
                      </span>
                      {customerPhone && (
                        <span className="rounded-[8px] bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary-strong">
                          {submission.formTitle}
                        </span>
                      )}
                    </div>

                    <a
                      className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary no-underline hover:underline"
                      href={`tel:${submission.phone}`}
                    >
                      <Phone size={13} aria-hidden="true" />
                      {submission.phone}
                    </a>

                    <div className="mt-1 flex items-center gap-1.5 text-muted">
                      <Clock3
                        size={12}
                        className="shrink-0"
                        aria-hidden="true"
                      />
                      <time className="text-[11px]">
                        {formatTaipeiDateTime(submission.createdAt)}
                      </time>
                    </div>
                  </div>

                  <div className="mt-3 flex min-w-0 flex-wrap items-end justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                      {submission.items.map((item) => (
                        <span
                          key={item.id}
                          className="max-w-full break-words rounded-[8px] bg-primary-soft px-2.5 py-1 text-[12px] font-semibold text-primary-strong"
                        >
                          {item.name} × {item.quantity}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="outline min-h-8 shrink-0 px-2.5 py-1 text-[12px] text-danger hover:border-danger hover:bg-danger-soft"
                      disabled={loading || deletingId !== null}
                      onClick={() => void handleDeleteSubmission(submission)}
                      aria-label={`移除 ${submission.nickname} 的喊單明細`}
                    >
                      {deletingId === submission.id ? (
                        <LoaderCircle size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                      {deletingId === submission.id ? "移除中" : "移除"}
                    </button>
                  </div>

                  {submission.notes && (
                    <p className="mb-0 mt-3 border-t border-line/60 pt-2.5 text-[12px] leading-5 text-muted">
                      備註：{submission.notes}
                    </p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="mb-0 mt-5 rounded-[8px] bg-light px-4 py-10 text-center text-[13px] text-muted">
              {customerPhone
                ? `查無電話 ${customerPhone} 的喊單紀錄。`
                : "目前還沒有顧客喊單記錄。"}
            </div>
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
                  loading || data.pagination.page >= data.pagination.totalPages
                }
                onClick={() => void onReload(data.pagination.page + 1)}
              >
                下一頁 <ChevronRight size={15} />
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
