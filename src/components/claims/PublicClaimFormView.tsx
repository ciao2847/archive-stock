"use client";

import { type CSSProperties, type FormEvent, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  ImageIcon,
  MessageCircle,
  Minus,
  Package,
  Plus,
  ShoppingBag,
  Tag,
} from "lucide-react";

import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { TurnstileWidget } from "@/components/claims/TurnstileWidget";
import { submitPublicClaim } from "@/lib/api/claims";
import { blendHexColors, getContrastColor } from "@/lib/claim-form-theme";
import {
  buildOfficialLineChatUrl,
  formatTaipeiDateTime,
  sanitizeTaiwanMobilePhoneInput,
  TAIWAN_MOBILE_PHONE_ERROR,
  TAIWAN_MOBILE_PHONE_HTML_PATTERN,
  type PublicClaimForm,
  type PublicClaimSubmissionResult,
} from "@/lib/claims";

const currency = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

type ClaimThemeStyle = CSSProperties & Record<`--${string}`, string | number>;

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

export function PublicClaimFormView({
  form,
  token,
  turnstileSiteKey,
}: {
  form: PublicClaimForm;
  token: string;
  turnstileSiteKey: string | null;
}) {
  const [step, setStep] = useState<"products" | "details" | "success">(
    "products",
  );
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PublicClaimSubmissionResult | null>(
    null,
  );
  const [confirmationCopied, setConfirmationCopied] = useState(false);
  const [requestId] = useState(createRequestId);
  const [lightboxImage, setLightboxImage] = useState<{
    src: string;
    alt: string;
    label?: string;
  } | null>(null);

  const primaryText = getContrastColor(form.theme.primaryColor);
  const pageText = getContrastColor(form.theme.backgroundColor);
  const surfaceText = getContrastColor(form.theme.surfaceColor);
  const primaryHover = blendHexColors(form.theme.primaryColor, "#000000", 0.16);
  const softColor = blendHexColors(
    form.theme.surfaceColor,
    form.theme.primaryColor,
    0.13,
  );
  const softText = getContrastColor(softColor);
  const borderColor = blendHexColors(
    form.theme.surfaceColor,
    form.theme.primaryColor,
    0.28,
  );
  const surfaceMuted = blendHexColors(
    form.theme.surfaceColor,
    surfaceText,
    0.64,
  );
  const themeStyle: ClaimThemeStyle = {
    "--claim-primary": form.theme.primaryColor,
    "--claim-primary-hover": primaryHover,
    "--claim-primary-text": primaryText,
    "--claim-background": form.theme.backgroundColor,
    "--claim-page-text": pageText,
    "--claim-surface": form.theme.surfaceColor,
    "--claim-surface-text": surfaceText,
    "--claim-surface-muted": surfaceMuted,
    "--claim-soft": softColor,
    "--claim-soft-text": softText,
    "--claim-border": borderColor,
    "--app-shadow-sm": "none",
    "--app-shadow-md": "none",
    "--app-shadow-lg": "none",
    "--color-accent": "transparent",
  };
  const heroStyle: CSSProperties = {
    backgroundColor: form.theme.primaryColor,
    backgroundImage: form.bannerImageUrl
      ? `linear-gradient(rgba(5, 16, 32, 0.28), rgba(5, 16, 32, 0.28)), url(${JSON.stringify(form.bannerImageUrl)})`
      : undefined,
    backgroundPosition: `${form.bannerPosition.x}% ${form.bannerPosition.y}%`,
    backgroundSize: "cover",
    color: form.theme.headerTextColor,
  };

  const selectedProducts = useMemo(
    () =>
      form.products
        .filter(
          (product) => product.isEnabled && (quantities[product.id] ?? 0) > 0,
        )
        .map((product) => ({
          product,
          quantity: quantities[product.id] ?? 0,
        })),
    [form.products, quantities],
  );
  const availableProductCount = useMemo(
    () => form.products.filter((product) => product.isEnabled).length,
    [form.products],
  );
  const itemCount = selectedProducts.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const subtotal = selectedProducts.reduce(
    (total, item) => total + item.product.price * item.quantity,
    0,
  );

  function setQuantity(productId: string, value: number, maximum: number) {
    const quantity = Math.max(0, Math.min(maximum, Math.trunc(value || 0)));
    setQuantities((current) => ({ ...current, [productId]: quantity }));
  }

  function continueToDetails() {
    if (itemCount === 0) return;
    setStep("details");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agreed || itemCount < 1) return;
    if (!turnstileSiteKey || !turnstileToken) {
      setError("請先完成人機驗證再送出。");
      return;
    }
    const confirmed = window.confirm(
      `喊單送出後就不能自行取消囉！這 ${itemCount} 件商品會列入管理者的採購數量。\n\n確定要送出嗎？`,
    );
    if (!confirmed) return;

    setSubmitting(true);
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
      setResult(response);
      setStep("success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (submitError) {
      setTurnstileToken("");
      setTurnstileResetSignal((current) => current + 1);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "喊單送出失敗，請稍後再試",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function copyConfirmationCode() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.confirmationCode);
      setConfirmationCopied(true);
    } catch {
      window.prompt("複製確認編號", result.confirmationCode);
    }
  }

  if (step === "success" && result) {
    const officialLineChatUrl = form.officialLineId
      ? buildOfficialLineChatUrl(
          form.officialLineId,
          `您好，我已完成「${form.title}」喊單，確認編號：${result.confirmationCode}，電話：${phone}，請協助核對，謝謝。`,
        )
      : undefined;

    return (
      <main
        className="min-h-screen bg-[var(--claim-background)] px-4 py-5 text-[var(--claim-page-text)] md:py-10"
        style={themeStyle}
      >
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
                aria-label={
                  confirmationCopied ? "確認編號已複製" : "複製確認編號"
                }
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
                本次喊單
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
                  <b className="shrink-0 text-[13px] text-[var(--claim-primary)] md:text-[14px]">
                    {currency.format(product.price * quantity)}
                  </b>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 bg-[var(--claim-primary)] px-4 py-3 text-[var(--claim-primary-text)] md:px-5">
              <span className="text-[12px] font-medium opacity-85">
                共 {itemCount} 件商品
              </span>
              <strong className="text-[18px] md:text-[20px]">
                {currency.format(subtotal)}
              </strong>
            </div>
          </section>

          <section className="rounded-[14px] border border-[var(--claim-border)] bg-[var(--claim-surface)] p-4 text-[var(--claim-surface-text)] shadow-[0_14px_40px_rgba(5,16,32,0.08)] md:p-5">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--claim-soft)] text-[var(--claim-primary)]">
                <CheckCircle2 size={17} aria-hidden="true" />
              </span>
              <h1 className="m-0 text-[15px] font-bold md:text-[16px]">
                喊單成功！接下來還有一步
              </h1>
            </div>

            <p className="mb-0 mt-3 whitespace-pre-wrap text-[11px] font-medium leading-5 text-[var(--claim-surface-muted)] md:text-[12px]">
              {form.completionMessage}
            </p>

            <ol className="m-0 mt-3 grid list-none gap-2.5 p-0">
              <li className="flex items-center gap-2.5 text-[12px] font-medium md:text-[13px]">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--claim-primary)] text-[10px] font-bold text-[var(--claim-primary-text)]">
                  1
                </span>
                <span>
                  {form.officialLineId
                    ? `加入官方 LINE 好友（${form.officialLineId}）`
                    : "依照管理者提供的方式聯繫結帳"}
                </span>
              </li>
              <li className="flex items-center gap-2.5 text-[12px] font-medium md:text-[13px]">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--claim-primary)] text-[10px] font-bold text-[var(--claim-primary-text)]">
                  2
                </span>
                <span>完成匯款，訂單才算正式成立</span>
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
                <small className="mt-2.5 block text-center text-[10px] leading-5 text-[var(--claim-surface-muted)] md:text-[11px]">
                  加入後送出預填訊息，或於對話框輸入手機號碼即可查詢明細
                </small>
              </>
            )}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen bg-[var(--claim-background)] pb-28 text-[var(--claim-page-text)] xl:pb-12"
      style={themeStyle}
    >
      <section
        className="relative w-full overflow-hidden bg-cover shadow-[0_10px_30px_rgba(5,16,32,0.12)]"
        style={heroStyle}
      >
        {!form.bannerImageUrl && (
          <>
            <div
              className="absolute -right-10 -top-16 size-40 rounded-full opacity-25 md:size-48"
              style={{ backgroundColor: form.theme.surfaceColor }}
            />
            <div
              className="absolute -bottom-24 right-20 size-40 rounded-full opacity-15 md:size-44"
              style={{ backgroundColor: form.theme.surfaceColor }}
            />
          </>
        )}
        <div className="relative z-10 mx-auto flex min-h-[190px] max-w-[1120px] flex-col justify-between gap-6 px-4 py-5 md:min-h-[240px] md:px-8 md:py-8">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full border border-white/30 px-3 py-1 text-[11px] font-semibold md:text-[12px]"
              style={{
                backgroundColor: form.theme.surfaceColor,
                color: surfaceText,
              }}
            >
              {form.storeName}
            </span>
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold md:text-[12px] ${form.isOpen ? "bg-[#dff3e7] text-[#17653b]" : "bg-[#d8e2ea] text-[#5e7182]"}`}
            >
              {form.isOpen ? "喊單開放中" : "喊單已截止"}
            </span>
            <span className="rounded-full bg-[#fff4d8] px-3 py-1 text-[11px] font-semibold text-[#7a5a13] md:text-[12px]">
              預購登記
            </span>
          </div>
          <div className="max-w-[720px]">
            <h1
              className="m-0 max-w-[680px] text-[24px] font-bold leading-tight md:text-[32px]"
              style={{ color: form.theme.headerTextColor }}
            >
              {form.title}
            </h1>
            {form.description && (
              <p
                className="mb-0 mt-2 line-clamp-3 whitespace-pre-wrap text-[12px] leading-5 opacity-80 md:mt-3 md:max-w-[620px] md:text-[14px] md:leading-6"
                style={{ color: form.theme.headerTextColor }}
              >
                {form.description}
              </p>
            )}
            {form.closesAt && (
              <p
                className="mb-0 mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold md:mt-3 md:text-[12px]"
                style={{ color: "#D6A84B" }}
                suppressHydrationWarning
              >
                <Clock
                  size={14}
                  className="shrink-0 opacity-90"
                  aria-hidden="true"
                />
                <span>截止時間：{formatTaipeiDateTime(form.closesAt)}</span>
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1120px] px-4 md:px-8">
        {step === "details" ? (
          <section className="mx-auto mt-6 max-w-[720px] md:mt-8">
            <button
              type="button"
              className="inline-flex items-center gap-2 border-0 bg-transparent p-0 text-[14px] font-semibold text-inherit opacity-75 hover:opacity-100"
              onClick={() => setStep("products")}
            >
              <ArrowLeft size={17} aria-hidden="true" />
              返回商品清單
            </button>

            <div className="mt-4 flex items-center gap-3 md:gap-3.5">
              <span className="grid size-10 md:size-11 shrink-0 place-items-center rounded-full bg-[var(--claim-soft)] text-[var(--claim-primary)]">
                <Package size={20} aria-hidden="true" />
              </span>
              <div>
                <span className="text-[12px] font-semibold text-[var(--claim-primary)]">
                  最後一步
                </span>
                <h2 className="mb-0 mt-0.5 text-[18px] md:text-[20px] font-bold text-[var(--claim-page-text)]">
                  確認喊單與聯絡資料
                </h2>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-[14px] border border-[var(--claim-border)] bg-[var(--claim-surface)] text-[var(--claim-surface-text)]">
              <div className="divide-y divide-[var(--claim-border)]">
                {selectedProducts.map(({ product, quantity }) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between gap-3 p-3.5 md:p-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {product.imageUrl ? (
                        <button
                          type="button"
                          className="group relative grid size-12 shrink-0 cursor-zoom-in place-items-center overflow-hidden rounded-[8px] border-0 bg-[var(--claim-soft)] p-0 text-[var(--claim-soft-text)] transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--claim-primary)] md:size-13"
                          onClick={() =>
                            setLightboxImage({
                              src: product.imageUrl!,
                              alt: `${product.name} 商品圖片`,
                              label: `${product.name} (${currency.format(product.price)})`,
                            })
                          }
                          aria-label={`放大查看 ${product.name} 圖片`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                            src={product.imageUrl}
                            alt={`${product.name} 商品圖片`}
                            loading="lazy"
                            decoding="async"
                          />
                        </button>
                      ) : (
                        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-[var(--claim-soft)] text-[var(--claim-soft-text)] md:size-13">
                          <ImageIcon
                            className="opacity-45"
                            size={20}
                            aria-hidden="true"
                          />
                        </div>
                      )}
                      <div className="min-w-0">
                        <strong className="block truncate text-[14px] md:text-[15px] font-bold text-[var(--claim-surface-text)]">
                          {product.name}
                        </strong>
                        <span className="mt-0.5 block text-[12px] md:text-[13px] text-[var(--claim-surface-muted)]">
                          {currency.format(product.price)} × {quantity}
                        </span>
                      </div>
                    </div>
                    <b className="shrink-0 text-[15px] md:text-[16px] font-bold text-[var(--claim-primary)]">
                      {currency.format(product.price * quantity)}
                    </b>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-[var(--claim-border)] bg-white px-4 py-3 md:px-5 md:py-3.5">
                <span className="text-[13px] font-semibold text-[var(--claim-surface-text)] md:text-[14px]">
                  共 {itemCount} 件
                </span>
                <strong
                  className="text-[18px] font-bold md:text-[20px]"
                  style={{ color: "#D6A84B" }}
                >
                  {currency.format(subtotal)}
                </strong>
              </div>
            </div>

            <div className="mt-4 rounded-[14px] border border-[var(--claim-border)] bg-[var(--claim-surface)] p-5 text-[var(--claim-surface-text)] md:p-7">
              <form onSubmit={submit}>
                <div className="grid gap-5 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-[13px] font-semibold">
                      群組暱稱 <em className="not-italic text-danger">*</em>
                    </span>
                    <input
                      className="min-h-12 w-full rounded-[8px] border border-[var(--claim-border)] bg-white px-4 text-[15px] text-dark focus:border-[var(--claim-primary)] focus:ring-2 focus:ring-[var(--claim-soft)]"
                      value={nickname}
                      onChange={(event) => setNickname(event.target.value)}
                      maxLength={100}
                      autoComplete="nickname"
                      placeholder="例：小明／Peter"
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[13px] font-semibold">
                      電話號碼 <em className="not-italic text-danger">*</em>
                    </span>
                    <input
                      className="min-h-12 w-full rounded-[8px] border border-[var(--claim-border)] bg-white px-4 text-[15px] text-dark focus:border-[var(--claim-primary)] focus:ring-2 focus:ring-[var(--claim-soft)]"
                      value={phone}
                      onChange={(event) =>
                        setPhone(
                          sanitizeTaiwanMobilePhoneInput(event.target.value),
                        )
                      }
                      onInput={(event) =>
                        event.currentTarget.setCustomValidity("")
                      }
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
                <label className="mt-5 block">
                  <span className="mb-2 block text-[13px] font-semibold">
                    備註（選填）
                  </span>
                  <textarea
                    className="min-h-24 w-full resize-y rounded-[8px] border border-[var(--claim-border)] bg-white px-4 py-3 text-[15px] text-dark focus:border-[var(--claim-primary)] focus:ring-2 focus:ring-[var(--claim-soft)]"
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
                <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-[8px] bg-[var(--claim-soft)] px-4 py-4 text-[var(--claim-soft-text)]">
                  <input
                    className="mt-0.5 size-4"
                    style={{ accentColor: form.theme.primaryColor }}
                    type="checkbox"
                    checked={agreed}
                    onChange={(event) => setAgreed(event.target.checked)}
                    required
                  />
                  <span className="text-[13px] leading-6 opacity-75">
                    我已確認品項與數量，了解送出後會列入預購採購數量且不能自行取消，並同意提供電話與群組暱稱供管理者核對。
                  </span>
                </label>
                {turnstileSiteKey ? (
                  <TurnstileWidget
                    siteKey={turnstileSiteKey}
                    resetSignal={turnstileResetSignal}
                    onTokenChange={setTurnstileToken}
                  />
                ) : (
                  <p
                    className="mb-0 mt-4 rounded-[8px] bg-danger-soft px-4 py-3 text-[13px] text-danger"
                    role="alert"
                  >
                    安全驗證尚未完成設定，目前暫停接收喊單，請聯絡表單管理者。
                  </p>
                )}
                {error && (
                  <p
                    className="mb-0 mt-4 rounded-[8px] bg-danger-soft px-4 py-3 text-[13px] text-danger"
                    role="alert"
                  >
                    {error}
                  </p>
                )}
                <button
                  className="mt-6 inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-[8px] border-0 bg-[var(--claim-primary)] px-5 text-[15px] font-semibold text-[var(--claim-primary-text)] hover:bg-[var(--claim-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                  type="submit"
                  disabled={
                    submitting ||
                    !agreed ||
                    !turnstileSiteKey ||
                    !turnstileToken
                  }
                >
                  {submitting ? "正在送出…" : "確認送出喊單"}
                  {!submitting && <Check size={19} aria-hidden="true" />}
                </button>
              </form>
            </div>
          </section>
        ) : (
          <>
            {!form.isOpen && (
              <section className="mt-7 flex items-start gap-3 rounded-[8px] border border-[var(--claim-border)] bg-[var(--claim-surface)] px-5 py-4 text-[var(--claim-surface-text)] md:mt-9">
                <ShoppingBag className="mt-0.5 shrink-0 opacity-60" size={21} />
                <div>
                  <h2 className="m-0 text-[16px]">這次喊單已經截止</h2>
                  <p className="mb-0 mt-1 text-[13px] leading-6 opacity-65">
                    商品仍可查看，但目前不能再送出。後續消息請留意群組公告。
                  </p>
                </div>
              </section>
            )}

            {form.products.length === 0 ? (
              <section className="mt-6 rounded-[8px] border border-[var(--claim-border)] bg-[var(--claim-surface)] px-6 py-12 text-center text-[var(--claim-surface-text)]">
                <ShoppingBag className="mx-auto opacity-60" size={34} />
                <h2 className="mb-0 mt-4 text-[20px]">商品即將上架</h2>
                <p className="mb-0 mt-2 text-[14px] opacity-65">
                  管理者更新後，重新整理這個頁面就會看到最新商品。
                </p>
              </section>
            ) : (
              <div className="mt-5 xl:grid xl:grid-cols-[minmax(0,1fr)_290px] xl:items-start xl:gap-6">
                <section>
                  <div className="mb-3.5 flex items-center gap-2 text-[13px] font-semibold text-[var(--claim-page-text)] opacity-80 md:mb-4 md:text-[14px]">
                    <Tag
                      className="text-[var(--claim-primary)]"
                      size={16}
                      aria-hidden="true"
                    />
                    {`共 ${form.products.length} 項商品 · ${availableProductCount} 項開放喊單`}
                  </div>
                  <div className="grid gap-3 min-[560px]:grid-cols-2 md:gap-3.5">
                    {form.products.map((product) => {
                      const quantity = product.isEnabled
                        ? (quantities[product.id] ?? 0)
                        : 0;
                      return (
                        <article
                          key={product.id}
                          className="flex min-h-[82px] min-w-0 items-center gap-3 rounded-[12px] border p-3 transition-colors md:min-h-[90px] md:gap-3.5 md:p-3.5"
                          style={{
                            backgroundColor: product.isEnabled
                              ? form.theme.surfaceColor
                              : softColor,
                            borderColor:
                              product.isEnabled && quantity > 0
                                ? form.theme.primaryColor
                                : borderColor,
                            color: surfaceText,
                          }}
                        >
                          {product.imageUrl ? (
                            <button
                              type="button"
                              className={`group relative grid size-[52px] shrink-0 cursor-zoom-in place-items-center overflow-hidden rounded-[10px] border-0 bg-[var(--claim-soft)] p-0 text-[var(--claim-soft-text)] transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--claim-primary)] md:size-[58px] ${
                                product.isEnabled ? "" : "grayscale opacity-50"
                              }`}
                              onClick={() =>
                                setLightboxImage({
                                  src: product.imageUrl!,
                                  alt: `${product.name} 商品圖片`,
                                  label: `${product.name} (${currency.format(product.price)})`,
                                })
                              }
                              aria-label={`放大查看 ${product.name} 圖片`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                                src={product.imageUrl}
                                alt={`${product.name} 商品圖片`}
                                loading="lazy"
                                decoding="async"
                              />
                            </button>
                          ) : (
                            <div
                              className={`grid size-[52px] shrink-0 place-items-center overflow-hidden rounded-[10px] bg-[var(--claim-soft)] text-[var(--claim-soft-text)] md:size-[58px] ${
                                product.isEnabled ? "" : "opacity-50"
                              }`}
                            >
                              <ImageIcon
                                className="opacity-45"
                                size={22}
                                aria-hidden="true"
                              />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div
                              className={product.isEnabled ? "" : "opacity-55"}
                            >
                              <div className="flex min-w-0 items-center gap-1.5 md:gap-2">
                                <span className="shrink-0 rounded-[5px] bg-[var(--claim-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--claim-primary)] md:text-[11px]">
                                  {product.category}
                                  {product.size ? ` · ${product.size}` : ""}
                                </span>
                                <h3
                                  className="m-0 min-w-0 truncate text-[13px] font-bold leading-5 md:text-[14px]"
                                  style={{ color: surfaceText }}
                                  title={product.name}
                                >
                                  {product.name}
                                </h3>
                              </div>
                              <strong className="mt-1 block text-[15px] font-bold text-[var(--claim-primary)] md:text-[16px]">
                                {currency.format(product.price)}
                              </strong>
                            </div>
                          </div>
                          {product.isEnabled ? (
                            <div className="flex w-[96px] shrink-0 items-center justify-between rounded-full border border-[var(--claim-border)] bg-[var(--claim-surface)] p-1 md:w-[104px]">
                              <button
                                type="button"
                                className="grid size-6 place-items-center rounded-full border-0 bg-transparent text-inherit hover:bg-[var(--claim-soft)] disabled:opacity-25 md:size-7"
                                onClick={() =>
                                  setQuantity(
                                    product.id,
                                    quantity - 1,
                                    product.maxQuantity,
                                  )
                                }
                                disabled={!form.isOpen || quantity === 0}
                                aria-label={`減少${product.name}數量`}
                              >
                                <Minus size={13} aria-hidden="true" />
                              </button>
                              <input
                                className="h-6 w-6 appearance-none border-0 bg-transparent p-0 text-center text-[13px] font-bold outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none md:w-7 md:text-[14px]"
                                type="number"
                                min="0"
                                max={product.maxQuantity}
                                value={quantity}
                                onChange={(event) =>
                                  setQuantity(
                                    product.id,
                                    Number(event.target.value),
                                    product.maxQuantity,
                                  )
                                }
                                disabled={!form.isOpen}
                                aria-label={`${product.name}數量`}
                              />
                              <button
                                type="button"
                                className="grid size-6 place-items-center rounded-full border-0 bg-[var(--claim-primary)] text-[var(--claim-primary-text)] hover:bg-[var(--claim-primary-hover)] disabled:opacity-30 md:size-7"
                                onClick={() =>
                                  setQuantity(
                                    product.id,
                                    quantity + 1,
                                    product.maxQuantity,
                                  )
                                }
                                disabled={
                                  !form.isOpen ||
                                  quantity >= product.maxQuantity
                                }
                                aria-label={`增加${product.name}數量`}
                              >
                                <Plus
                                  size={13}
                                  strokeWidth={2.5}
                                  aria-hidden="true"
                                />
                              </button>
                            </div>
                          ) : (
                            <span className="shrink-0 whitespace-nowrap rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-[11px] font-bold text-slate-600">
                              已截止喊單
                            </span>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>

                <aside className="sticky top-6 hidden rounded-[12px] border border-[var(--claim-border)] bg-[var(--claim-surface)] p-5 text-[var(--claim-surface-text)] shadow-[0_14px_42px_rgba(5,16,32,0.08)] xl:block">
                  <h2
                    className="m-0 text-[15px]"
                    style={{ color: surfaceText }}
                  >
                    您的喊單清單
                  </h2>
                  {selectedProducts.length === 0 ? (
                    <div className="grid min-h-36 place-items-center text-center text-[var(--claim-surface-muted)]">
                      <div>
                        <ShoppingBag
                          className="mx-auto opacity-55"
                          size={27}
                          aria-hidden="true"
                        />
                        <span className="mt-2 block text-[12px]">
                          尚未選擇商品
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 max-h-56 space-y-3 overflow-y-auto pr-1">
                      {selectedProducts.map(({ product, quantity }) => (
                        <div
                          key={product.id}
                          className="flex items-start justify-between gap-3 border-b border-[var(--claim-border)] pb-3 last:border-b-0"
                        >
                          <div className="min-w-0">
                            <strong className="block truncate text-[12px]">
                              {product.name}
                            </strong>
                            <span className="mt-0.5 block text-[11px] text-[var(--claim-surface-muted)]">
                              {currency.format(product.price)} × {quantity}
                            </span>
                          </div>
                          <b className="shrink-0 text-[12px]">
                            {currency.format(product.price * quantity)}
                          </b>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 flex items-center justify-between border-t border-[var(--claim-border)] pt-4">
                    <span className="text-[12px] text-[var(--claim-surface-muted)]">
                      總計
                    </span>
                    <strong className="text-[19px]">
                      {currency.format(subtotal)}
                    </strong>
                  </div>
                  <button
                    type="button"
                    className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] border-0 bg-[var(--claim-primary)] px-4 text-[13px] font-semibold text-[var(--claim-primary-text)] hover:bg-[var(--claim-primary-hover)] disabled:opacity-40"
                    disabled={itemCount === 0 || !form.isOpen}
                    onClick={continueToDetails}
                  >
                    填寫聯絡資料
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </aside>
              </div>
            )}
          </>
        )}
      </div>

      {step === "products" && form.isOpen && availableProductCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--claim-border)] bg-[var(--claim-surface)]/95 px-4 py-3 text-[var(--claim-surface-text)] shadow-[0_-10px_35px_rgba(5,16,32,0.14)] backdrop-blur-md md:px-8 md:py-4 xl:hidden">
          <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="block text-[11px] md:text-[12px] font-medium text-[var(--claim-surface-muted)]">
                {itemCount > 0 ? `已選 ${itemCount} 件商品` : "尚未選擇商品"}
              </span>
              <strong className="mt-0.5 block text-[20px] md:text-[24px] font-bold tracking-tight text-[var(--claim-surface-text)]">
                {currency.format(subtotal)}
              </strong>
            </div>
            <button
              type="button"
              className="inline-flex min-h-11 md:min-h-12 shrink-0 items-center justify-center gap-1.5 md:gap-2 rounded-[10px] md:rounded-[12px] border-0 bg-[var(--claim-primary)] px-5 md:px-6 text-[14px] md:text-[15px] font-bold text-[var(--claim-primary-text)] hover:bg-[var(--claim-primary-hover)] disabled:opacity-40 disabled:cursor-not-allowed md:min-w-[180px] transition-all"
              disabled={itemCount === 0}
              onClick={continueToDetails}
            >
              填寫聯絡資料
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          label={lightboxImage.label}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </main>
  );
}
