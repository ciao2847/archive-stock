import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { type FormEvent, useState } from "react";
import { Check, Package } from "lucide-react";
import { TurnstileWidget } from "@/components/claims/TurnstileWidget";
import { submitPublicClaim } from "@/lib/api/claims";
import {
  sanitizeTaiwanMobilePhoneInput,
  TAIWAN_MOBILE_PHONE_ERROR,
  TAIWAN_MOBILE_PHONE_HTML_PATTERN,
  type PublicClaimForm,
  type PublicClaimSubmissionResult,
} from "@/lib/claims";
import type { SelectedClaimProduct } from "./types";
import { currency } from "./format";

function createRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export function ClaimContactForm({
  form,
  token,
  turnstileSiteKey,
  selectedProducts,
  itemCount,
  subtotal,
  submitting,
  onSubmittingChange,
  onSuccess,
}: {
  form: PublicClaimForm;
  token: string;
  turnstileSiteKey: string | null;
  selectedProducts: SelectedClaimProduct[];
  itemCount: number;
  subtotal: number;
  submitting: boolean;
  onSubmittingChange: (submitting: boolean) => void;
  onSuccess: (result: PublicClaimSubmissionResult, phone: string) => void;
}) {
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [error, setError] = useState("");
  const [requestId] = useState(createRequestId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !form.isOpen || !agreed || itemCount < 1) return;
    if (!turnstileSiteKey || !turnstileToken) {
      setError("請先完成人機驗證再送出。");
      return;
    }
    const confirmed = window.confirm(
      `請核對這 ${itemCount} 件商品，總額 ${currency.format(subtotal)}。送出後不能自行修改或取消，確定送出訂購嗎？`,
    );
    if (!confirmed) return;

    onSubmittingChange(true);
    setError("");
    try {
      const response = await submitPublicClaim(token, {
        nickname,
        phone,
        notes,
        website,
        requestId,
        turnstileToken,
        items: selectedProducts.map(({ product, quantity }) => ({
          productId: product.id,
          quantity,
        })),
      });
      onSuccess(response, phone);
    } catch (submitError) {
      setTurnstileToken("");
      setTurnstileResetSignal((current) => current + 1);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "訂購送出失敗，請稍後再試",
      );
    } finally {
      onSubmittingChange(false);
    }
  }

  return (
    <section
      id="order-contact"
      aria-label="訂購聯絡資料"
      className="min-w-0 scroll-mt-5 self-start rounded-[14px] border border-[var(--claim-border)] bg-[var(--claim-surface)] p-4 text-[var(--claim-surface-text)] lg:sticky lg:top-5 md:p-5"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[var(--claim-soft)] text-[var(--claim-primary)]">
          <Package size={19} />
        </span>
        <div>
          <span className="text-[11px] font-semibold text-[var(--claim-primary)]">
            最後一步
          </span>
          <h2 className="m-0 text-[16px] font-bold">確認聯絡資料</h2>
        </div>
      </div>

      <form className="mt-4" onSubmit={submit}>
        <fieldset disabled={submitting} className="m-0 min-w-0 border-0 p-0">
          <div className="grid gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-semibold">
                群組暱稱 <em className="not-italic text-danger">*</em>
              </span>
              <input
                className="min-h-11 w-full min-w-0 rounded-[8px] border border-[var(--claim-border)] bg-white px-3 text-[14px] text-dark focus:border-[var(--claim-primary)] focus:ring-2 focus:ring-[var(--claim-soft)]"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                maxLength={100}
                autoComplete="nickname"
                placeholder="例：小明／Peter"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-semibold">
                手機號碼 <em className="not-italic text-danger">*</em>
              </span>
              <input
                className="min-h-11 w-full min-w-0 rounded-[8px] border border-[var(--claim-border)] bg-white px-3 text-[14px] text-dark focus:border-[var(--claim-primary)] focus:ring-2 focus:ring-[var(--claim-soft)]"
                value={phone}
                onChange={(event) =>
                  setPhone(sanitizeTaiwanMobilePhoneInput(event.target.value))
                }
                onInput={(event) => event.currentTarget.setCustomValidity("")}
                onInvalid={(event) =>
                  event.currentTarget.setCustomValidity(
                    TAIWAN_MOBILE_PHONE_ERROR,
                  )
                }
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                minLength={10}
                maxLength={10}
                pattern={TAIWAN_MOBILE_PHONE_HTML_PATTERN}
                placeholder="例：0912345678"
                required
              />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-[12px] font-semibold">
              備註（選填）
            </span>
            <textarea
              className="min-h-20 w-full resize-y rounded-[8px] border border-[var(--claim-border)] bg-white px-3 py-2.5 text-[14px] text-dark focus:border-[var(--claim-primary)] focus:ring-2 focus:ring-[var(--claim-soft)]"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={1000}
              placeholder="有需要管理者留意的事情，可以寫在這裡"
            />
          </label>
          <label className="sr-only" aria-hidden="true">
            Website
            <input
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </label>
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[8px] bg-[var(--claim-soft)] px-3.5 py-3.5 text-[var(--claim-soft-text)]">
            <input
              className="mt-0.5 size-4"
              style={{ accentColor: form.theme.primaryColor }}
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              required
            />
            <span className="text-[12px] leading-5 opacity-75">
              我已核對商品、規格、數量與總額，了解送出後不能自行修改或取消，並同意提供聯絡資料供管理者核對。
            </span>
          </label>
          {turnstileSiteKey ? (
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              resetSignal={turnstileResetSignal}
              onTokenChange={setTurnstileToken}
            />
          ) : (
            <ErrorMessage className="mb-0 mt-4 rounded-[8px] bg-danger-soft px-4 py-3 text-[13px] text-danger">
              安全驗證尚未完成設定，目前暫停接收訂購，請聯絡表單管理者。
            </ErrorMessage>
          )}
          {error && (
            <ErrorMessage className="mb-0 mt-4 rounded-[8px] bg-danger-soft px-4 py-3 text-[13px] text-danger">
              {error}
            </ErrorMessage>
          )}
          <button
            className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[8px] border-0 bg-[var(--claim-primary)] px-4 text-[14px] font-semibold text-[var(--claim-primary-text)] hover:bg-[var(--claim-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={
              submitting ||
              !form.isOpen ||
              itemCount === 0 ||
              !agreed ||
              !turnstileSiteKey ||
              !turnstileToken
            }
          >
            {submitting ? "正在送出…" : "確認訂購"}
            {!submitting && <Check size={19} aria-hidden="true" />}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
