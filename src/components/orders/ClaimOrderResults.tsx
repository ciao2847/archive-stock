"use client";

import { pushDashboardPath } from "@/lib/dashboard-navigation";
import {
  formatTaipeiDateTime,
  getClaimSubmissionTotal,
  getClaimSubmissionPaidAmount,
  getClaimSubmissionOutstandingAmount,
  type ClaimSubmission,
} from "@/lib/claims";
import { OrderItems } from "@/components/order-management/OrderItems";
import { PaymentHistory } from "@/components/order-management/PaymentHistory";

const money = (amount: number) => `$${amount.toLocaleString("zh-TW")}`;

export function ClaimOrderResults({
  submissions,
}: {
  submissions: ClaimSubmission[];
}) {
  if (!submissions.length) return null;
  return (
    <section aria-label="配單與預售訂購" className="mt-5 space-y-3">
      <h3 className="text-[15px] font-bold">
        配單與預售訂購（{submissions.length}）
      </h3>
      {submissions.map((row) => {
        const outstanding = getClaimSubmissionOutstandingAmount(row);
        const paid = getClaimSubmissionPaidAmount(row);
        return (
          <article
            key={`${row.source}:${row.id}`}
            className="rounded-[12px] border border-line bg-white p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="pill">
                  {row.source === "bundle" ? "配單" : "預售訂購"}
                </span>
                <strong className="ml-2 break-all">
                  {row.confirmationCode}
                </strong>
                <p className="my-2 text-[13px]">
                  {row.nickname} · {row.phone}
                </p>
                <p className="m-0 text-[12px] text-muted">
                  {row.formTitle} · {formatTaipeiDateTime(row.createdAt)}
                </p>
              </div>
              <div className="text-[13px]">
                <strong>{money(getClaimSubmissionTotal(row))}</strong>
                <p className="my-1">
                  已收 {money(paid)} · 待付 {money(outstanding)}
                </p>
                <span>
                  {outstanding <= 0
                    ? "已付清"
                    : paid > 0
                      ? "部分付款"
                      : "未付款"}
                </span>
              </div>
              <button
                type="button"
                className="outline"
                onClick={() =>
                  pushDashboardPath(
                    `/orders?tab=customers&customer=${encodeURIComponent(row.phone || row.confirmationCode)}`,
                  )
                }
              >
                查看顧客對帳
              </button>
            </div>
            <details className="mt-3 text-[13px]">
              <summary className="cursor-pointer">查看訂購明細</summary>
              <OrderItems
                items={row.items.map((item) => ({
                  key: String(item.id),
                  name: item.name,
                  quantity: item.quantity,
                  amount: money(item.quantity * item.unitPrice),
                  description: item.sku,
                }))}
                total={money(getClaimSubmissionTotal(row))}
              />
              {row.notes && (
                <p className="whitespace-pre-wrap break-words">
                  備註：{row.notes}
                </p>
              )}
              <PaymentHistory
                records={row.payments.map((payment) => ({
                  key: String(payment.id),
                  amount: money(payment.amount),
                  transferredAt: formatTaipeiDateTime(payment.transferredAt),
                  lastFive: payment.payerAccountLastFive,
                  note: payment.note,
                }))}
              />
            </details>
          </article>
        );
      })}
    </section>
  );
}
