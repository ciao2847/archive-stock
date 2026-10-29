import { useState } from "react";
import { Check, Copy, ImageIcon } from "lucide-react";
import type {
  PublicClaimForm,
  PublicClaimSubmissionResult,
} from "@/lib/claims";
import { ClaimPendingPayment } from "./ClaimPendingPayment";
import type { ClaimReceipt } from "@/lib/claim-receipt";
import { currency } from "./format";

export function ClaimOrderConfirmation({
  form,
  result,
  phone,
  selectedProducts,
  itemCount,
  subtotal,
  saved,
  onStartNewOrder,
}: {
  form: Pick<PublicClaimForm, "title" | "officialLineId" | "completionMessage">;
  result: PublicClaimSubmissionResult;
  phone: string;
  selectedProducts: ClaimReceipt["items"];
  itemCount: number;
  subtotal: number;
  saved: boolean;
  onStartNewOrder: () => void;
}) {
  const [confirmationCopied, setConfirmationCopied] = useState(false);
  async function copyConfirmationCode() {
    try {
      await navigator.clipboard.writeText(result.confirmationCode);
      setConfirmationCopied(true);
    } catch {
      window.prompt("複製確認編號", result.confirmationCode);
    }
  }

  return (
    <div className="mx-auto max-w-[480px] space-y-3 md:space-y-4">
      <section className="rounded-[14px] border border-[var(--claim-border)] bg-[var(--claim-surface)] px-4 py-5 text-center text-[var(--claim-surface-text)] shadow-[0_14px_40px_rgba(5,16,32,0.08)] md:px-6 md:py-6">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-[var(--claim-surface-muted)] md:text-[11px]">
          確認編號
        </span>
        <div className="mt-1.5 flex min-w-0 items-center justify-center gap-2">
          <strong className="min-w-0 break-all font-mono text-[21px] font-bold tracking-[0.04em] md:text-[25px] md:tracking-[0.06em]">
            {result.confirmationCode}
          </strong>
          <button
            type="button"
            className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-[var(--claim-border)] bg-[var(--claim-soft)] text-[var(--claim-primary)] transition hover:bg-[var(--claim-surface)]"
            onClick={() => void copyConfirmationCode()}
            aria-label={confirmationCopied ? "確認編號已複製" : "複製確認編號"}
            title={confirmationCopied ? "已複製" : "複製確認編號"}
          >
            {confirmationCopied ? (
              <Check size={15} aria-hidden="true" />
            ) : (
              <Copy size={15} aria-hidden="true" />
            )}
          </button>
        </div>
        <small className="mt-1.5 block text-[11px] leading-5 text-[var(--claim-surface-muted)] md:text-[12px]">
          建議截圖保留，方便之後與管理者核對
        </small>
      </section>

      <section className="overflow-hidden rounded-[14px] border border-[var(--claim-border)] bg-[var(--claim-surface)] text-[var(--claim-surface-text)] shadow-[0_14px_40px_rgba(5,16,32,0.08)]">
        <div className="px-4 pb-1 pt-4 md:px-5 md:pt-5">
          <h2 className="m-0 text-[11px] font-bold text-[var(--claim-surface-muted)] md:text-[12px]">
            本次訂購
          </h2>
        </div>
        <div className="divide-y divide-[var(--claim-border)] px-4 md:px-5">
          {selectedProducts.map(({ product, quantity }) => (
            <div
              key={product.id}
              className="flex items-center justify-between gap-3 py-3 md:gap-4 md:py-3.5"
            >
              <div className="flex min-w-0 items-center gap-3">
                {product.imageUrl ? (
                  <div className="size-11 shrink-0 overflow-hidden rounded-[9px] bg-[var(--claim-soft)] md:size-12">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="h-full w-full object-cover"
                      src={product.imageUrl}
                      alt={`${product.name} 商品圖片`}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                ) : (
                  <div className="grid size-11 shrink-0 place-items-center rounded-[9px] bg-[var(--claim-soft)] text-[var(--claim-soft-text)] md:size-12">
                    <ImageIcon
                      className="opacity-45"
                      size={19}
                      aria-hidden="true"
                    />
                  </div>
                )}
                <div className="min-w-0">
                  <strong className="block truncate text-[12px] md:text-[13px]">
                    {product.name}
                  </strong>
                  <span className="mt-0.5 block text-[11px] text-[var(--claim-surface-muted)]">
                    {currency.format(product.price)} × {quantity}
                  </span>
                </div>
              </div>
              <b className="shrink-0 text-[13px] text-[var(--claim-amount)] md:text-[14px]">
                {currency.format(product.price * quantity)}
              </b>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 bg-[var(--claim-primary)] px-4 py-3 text-white md:px-5">
          <span
            className="text-[12px] font-medium text-white"
            style={{ color: "#ffffff" }}
          >
            共 {itemCount} 件商品
          </span>
          <strong
            className="text-[18px] text-white md:text-[20px]"
            style={{ color: "#ffffff" }}
          >
            {currency.format(subtotal)}
          </strong>
        </div>
      </section>
      <ClaimPendingPayment
        form={form}
        result={result}
        phone={phone}
        subtotal={subtotal}
      />
      <p
        className="px-1 text-center text-[12px] leading-5 text-[var(--claim-page-text)]"
        role="status"
      >
        {saved
          ? "訂購資訊在此瀏覽器最長保留 7 天，切換 App 後回到原連結可繼續查看。"
          : "此瀏覽器無法保留訂購資訊，請先截圖保存確認編號與匯款帳號。"}
      </p>
      <button
        type="button"
        className="w-full rounded-[10px] border border-[var(--claim-border)] bg-[var(--claim-surface)] px-4 py-3 text-[13px] text-[var(--claim-surface-text)]"
        onClick={onStartNewOrder}
      >
        再填一筆訂購
      </button>
    </div>
  );
}
