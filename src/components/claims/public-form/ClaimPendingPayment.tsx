import { useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Landmark,
  MessageCircle,
} from "lucide-react";
import {
  buildOfficialLineChatUrl,
  type PublicClaimForm,
  type PublicClaimSubmissionResult,
} from "@/lib/claims";
import { currency } from "./format";

export function ClaimPendingPayment({
  form,
  result,
  phone,
  subtotal,
}: {
  form: Pick<PublicClaimForm, "title" | "officialLineId" | "completionMessage">;
  result: PublicClaimSubmissionResult;
  phone: string;
  subtotal: number;
}) {
  const [transferAccountCopied, setTransferAccountCopied] = useState(false);
  const officialLineChatUrl = form.officialLineId
    ? buildOfficialLineChatUrl(
        form.officialLineId,
        `您好，我已完成「${form.title}」訂購，確認編號：${result.confirmationCode}，電話：${phone}，請協助核對，謝謝。\n\n我的末五碼：`,
      )
    : undefined;
  async function copyTransferAccount() {
    if (!result.transferAccount) return;
    try {
      await navigator.clipboard.writeText(result.transferAccount.account);
      setTransferAccountCopied(true);
    } catch {
      window.prompt("複製匯款帳號", result.transferAccount.account);
    }
  }

  return (
    <section className="rounded-[14px] border border-[var(--claim-border)] bg-[var(--claim-surface)] p-4 text-[var(--claim-surface-text)] shadow-[0_14px_40px_rgba(5,16,32,0.08)] md:p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--claim-soft)] text-[var(--claim-primary)]">
          <CheckCircle2 size={17} aria-hidden="true" />
        </span>
        <h1 className="m-0 text-[15px] font-bold md:text-[16px]">
          訂購成功！接下來還有一步
        </h1>
      </div>

      <p className="mb-0 mt-3 whitespace-pre-wrap text-[11px] font-medium leading-5 text-[var(--claim-surface-muted)] md:text-[12px]">
        {form.completionMessage}
      </p>

      {result.transferAccount && (
        <div className="mt-4 rounded-[10px] border border-[var(--claim-border)] bg-[var(--claim-soft)] p-3.5 md:p-4">
          <div className="flex items-center gap-2 text-[12px] font-bold md:text-[13px]">
            <Landmark
              size={16}
              className="text-[var(--claim-primary)]"
              aria-hidden="true"
            />
            匯款帳號
          </div>
          <dl className="mb-0 mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[11px] md:text-[12px]">
            <dt className="text-[var(--claim-surface-muted)]">銀行</dt>
            <dd className="m-0 font-semibold">
              {result.transferAccount.bankCode}{" "}
              {result.transferAccount.bankName}
              {result.transferAccount.bankBranch
                ? ` ${result.transferAccount.bankBranch}`
                : ""}
            </dd>
            <dt className="self-center text-[var(--claim-surface-muted)]">
              帳號
            </dt>
            <dd className="m-0 flex min-w-0 items-center gap-2">
              <strong className="min-w-0 break-all font-mono text-[15px] tracking-[0.04em] md:text-[16px]">
                {result.transferAccount.account}
              </strong>
              <button
                type="button"
                className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-[8px] border border-[var(--claim-border)] bg-[var(--claim-surface)] px-2.5 text-[11px] font-bold text-[var(--claim-primary)]"
                onClick={() => void copyTransferAccount()}
              >
                {transferAccountCopied ? (
                  <Check size={13} aria-hidden="true" />
                ) : (
                  <Copy size={13} aria-hidden="true" />
                )}
                {transferAccountCopied ? "已複製" : "複製"}
              </button>
            </dd>
          </dl>
        </div>
      )}

      <ol className="m-0 mt-3 grid list-none gap-2.5 p-0">
        <li className="flex items-center gap-2.5 text-[12px] font-medium md:text-[13px]">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--claim-primary)] text-[10px] font-bold text-[var(--claim-primary-text)]">
            1
          </span>
          <span>
            {result.transferAccount
              ? `依上方帳號完成匯款 ${currency.format(subtotal)}`
              : form.officialLineId
                ? `加入官方 LINE 好友（${form.officialLineId}）`
                : "依照管理者提供的方式聯繫結帳"}
          </span>
        </li>
        <li className="flex items-center gap-2.5 text-[12px] font-medium md:text-[13px]">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--claim-primary)] text-[10px] font-bold text-[var(--claim-primary-text)]">
            2
          </span>
          <span>
            {result.transferAccount && form.officialLineId
              ? `加入官方 LINE（${form.officialLineId}）並回傳帳號末五碼`
              : "完成匯款，訂單才算正式成立"}
          </span>
        </li>
      </ol>

      {officialLineChatUrl && (
        <>
          <a
            className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--claim-primary)] px-4 py-2.5 text-center text-[13px] font-bold text-[var(--claim-primary-text)] transition hover:bg-[var(--claim-primary-hover)] md:text-[14px]"
            href={officialLineChatUrl}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={18} aria-hidden="true" />
            前往官方 LINE 查看明細與結帳
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        </>
      )}
    </section>
  );
}
