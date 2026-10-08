"use client";

import { type CSSProperties, type FormEvent, useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  ImageIcon,
  Landmark,
  MessageCircle,
  Minus,
  Package,
  Plus,
  ShoppingBag,
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
  const [transferAccountCopied, setTransferAccountCopied] = useState(false);
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
  const amountColor = surfaceText === "#FFFFFF" ? "#F0C775" : "#B7791F";
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
    "--claim-amount": amountColor,
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
    if (submitting) return;
    const quantity = Math.max(0, Math.min(maximum, Math.trunc(value || 0)));
    setQuantities((current) => ({ ...current, [productId]: quantity }));
  }

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
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (submitError) {
      setTurnstileToken("");
      setTurnstileResetSignal((current) => current + 1);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "訂購送出失敗，請稍後再試",
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

  async function copyTransferAccount() {
    if (!result?.transferAccount) return;
    try {
      await navigator.clipboard.writeText(result.transferAccount.account);
      setTransferAccountCopied(true);
    } catch {
      window.prompt("複製匯款帳號", result.transferAccount.account);
    }
  }

  if (result) {
    const officialLineChatUrl = form.officialLineId
      ? buildOfficialLineChatUrl(
          form.officialLineId,
          `您好，我已完成「${form.title}」訂購，確認編號：${result.confirmationCode}，電話：${phone}，請協助核對，謝謝。`,
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
            <div className="flex items-center justify-between gap-3 bg-[var(--claim-primary)] px-4 py-3 text-[var(--claim-primary-text)] md:px-5">
              <span className="text-[12px] font-medium opacity-85">
                共 {itemCount} 件商品
              </span>
              <strong className="text-[18px] text-[#F0C775] md:text-[20px]">
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
      className="min-h-screen bg-[var(--claim-background)] pb-28 text-[var(--claim-page-text)] lg:pb-12"
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
        <div className="relative z-10 mx-auto flex min-h-[170px] max-w-[1040px] flex-col justify-between gap-6 px-4 py-5 md:min-h-[200px] md:px-8 md:py-8">
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
              {form.isOpen ? "訂購開放中" : "訂購已截止"}
            </span>
            <span className="rounded-full bg-[#fff4d8] px-3 py-1 text-[11px] font-semibold text-[#7a5a13] md:text-[12px]">
              預購／現貨訂購
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
          <ol
            aria-label="訂購流程"
            className="m-0 flex list-none flex-wrap items-center gap-2 p-0"
          >
            {["選擇商品", "核對與填資料", "完成訂購"].map((label, index) => (
              <li key={label} className="flex items-center gap-2">
                {index > 0 && (
                  <span aria-hidden="true" className="opacity-50">
                    →
                  </span>
                )}
                <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-2 text-[11px] font-semibold">
                  <span className="grid size-4 place-items-center rounded-full bg-white/20 text-[10px]">
                    {index + 1}
                  </span>
                  {label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="mx-auto max-w-[1040px] px-4 pt-5 md:px-8 md:pt-8">
        {!form.isOpen && (
          <section className="mb-4 rounded-[14px] border border-[var(--claim-border)] bg-[var(--claim-surface)] p-4 text-[var(--claim-surface-text)]">
            <h2 className="m-0 text-[16px]">這次訂購已經截止</h2>
            <p className="mb-0 mt-2 text-[13px] text-[var(--claim-surface-muted)]">
              商品仍可查看，目前不能送出訂購。後續消息請留意群組公告。
            </p>
          </section>
        )}
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.85fr)_minmax(300px,1fr)] md:gap-5">
          <section
            aria-label="商品與訂購總額"
            className="min-w-0 self-start overflow-hidden rounded-[14px] border border-[var(--claim-border)] bg-[var(--claim-surface)] text-[var(--claim-surface-text)]"
          >
            <div className="p-4 md:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="m-0 flex items-center gap-2 text-[15px] font-bold">
                  <ShoppingBag
                    size={17}
                    className="text-[var(--claim-primary)]"
                  />
                  選擇商品
                </h2>
                <span className="text-[11px] text-[var(--claim-surface-muted)]">
                  共 {form.products.length} 項 · {availableProductCount} 項可選
                </span>
              </div>
              {form.products.length === 0 ? (
                <div className="py-10 text-center">
                  <ShoppingBag size={32} className="mx-auto opacity-60" />
                  <h3 className="mb-0 mt-3 text-[17px]">商品即將上架</h3>
                  <p className="mb-0 mt-2 text-[12px] text-[var(--claim-surface-muted)]">
                    管理者更新後，重新整理即可查看商品。
                  </p>
                </div>
              ) : (
                <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
                  {form.products.map((product) => {
                    const quantity = product.isEnabled
                      ? (quantities[product.id] ?? 0)
                      : 0;
                    return (
                      <article
                        key={product.id}
                        className="min-w-0"
                        aria-label={product.name}
                      >
                        {product.imageUrl ? (
                          <button
                            type="button"
                            className={`group block aspect-square w-full overflow-hidden rounded-[9px] border border-[var(--claim-border)] bg-[var(--claim-soft)] p-0 ${product.isEnabled ? "" : "opacity-55 grayscale"}`}
                            aria-label={`放大查看 ${product.name} 圖片`}
                            onClick={() =>
                              setLightboxImage({
                                src: product.imageUrl!,
                                alt: `${product.name} 商品圖片`,
                                label: `${product.name} (${currency.format(product.price)})`,
                              })
                            }
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={product.imageUrl}
                              alt={`${product.name} 商品圖片`}
                              className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                              loading="lazy"
                              decoding="async"
                            />
                          </button>
                        ) : (
                          <div className="grid aspect-square w-full place-items-center rounded-[9px] border border-[var(--claim-border)] bg-[var(--claim-soft)]">
                            <ImageIcon size={28} className="opacity-45" />
                          </div>
                        )}
                        <h3
                          className="mb-0 mt-2 break-words text-[12px] font-bold leading-5"
                          style={{ color: surfaceText }}
                        >
                          {product.name}
                        </h3>
                        <span className="block text-[11px] text-[var(--claim-surface-muted)]">
                          {product.category}
                          {product.size ? ` · ${product.size}` : ""}
                        </span>
                        <strong
                          style={{ color: "#D6A84B" }}
                          className="mt-0.5 block text-[13px]"
                        >
                          {currency.format(product.price)}
                        </strong>
                        {product.isEnabled ? (
                          <div className="mt-2 flex min-w-0 items-center justify-between rounded-[8px] border border-[var(--claim-border)]">
                            <button
                              type="button"
                              aria-label={`減少${product.name}數量`}
                              className="grid min-h-11 w-9 shrink-0 place-items-center rounded-[8px] hover:bg-[var(--claim-soft)] disabled:opacity-30"
                              onClick={() =>
                                setQuantity(
                                  product.id,
                                  quantity - 1,
                                  product.maxQuantity,
                                )
                              }
                              disabled={
                                !form.isOpen || submitting || quantity === 0
                              }
                            >
                              <Minus size={14} />
                            </button>
                            <input
                              type="number"
                              aria-label={`${product.name}數量`}
                              className="h-11 w-9 min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-center text-[13px] font-semibold [&::-webkit-inner-spin-button]:appearance-none"
                              min={0}
                              max={product.maxQuantity}
                              value={quantity}
                              onChange={(event) =>
                                setQuantity(
                                  product.id,
                                  Number(event.target.value),
                                  product.maxQuantity,
                                )
                              }
                              disabled={!form.isOpen || submitting}
                            />
                            <button
                              type="button"
                              aria-label={`增加${product.name}數量`}
                              className="grid min-h-11 w-9 shrink-0 place-items-center rounded-[8px] bg-[var(--claim-primary)] text-[var(--claim-primary-text)] disabled:opacity-30"
                              onClick={() =>
                                setQuantity(
                                  product.id,
                                  quantity + 1,
                                  product.maxQuantity,
                                )
                              }
                              disabled={
                                !form.isOpen ||
                                submitting ||
                                quantity >= product.maxQuantity
                              }
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        ) : (
                          <span className="mt-2 block rounded-[8px] bg-[var(--claim-soft)] px-2 py-3 text-center text-[11px] text-[var(--claim-surface-muted)]">
                            已停止訂購
                          </span>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
              {selectedProducts.length > 0 && (
                <div className="mt-4 border-t border-[var(--claim-border)] pt-3">
                  <h3 className="m-0 text-[12px] font-semibold">已選商品</h3>
                  <ul className="mb-0 mt-2 list-none space-y-2 p-0 text-[12px]">
                    {selectedProducts.map(({ product, quantity }) => (
                      <li
                        key={product.id}
                        className="flex items-start justify-between gap-3"
                      >
                        <span className="min-w-0 break-words">
                          {product.name} × {quantity}
                        </span>
                        <span className="shrink-0">
                          {currency.format(product.price * quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div
              aria-label="訂購總額"
              className="flex min-h-16 items-center justify-between gap-3 bg-[var(--claim-primary)] px-4 py-3 text-[var(--claim-primary-text)] md:px-5"
            >
              <span className="text-[13px] font-semibold">
                共 {itemCount} 件
              </span>
              <strong
                className="text-[21px] font-bold md:text-[24px]"
                style={{ color: "#D6A84B" }}
              >
                {currency.format(subtotal)}
              </strong>
            </div>
          </section>
          {form.isOpen && availableProductCount > 0 && (
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
              {itemCount === 0 && (
                <p className="mb-0 mt-3 text-[12px] leading-5 text-[var(--claim-surface-muted)]">
                  請先選擇商品，核對總額後填寫資料並送出。
                </p>
              )}
              <form className="mt-4" onSubmit={submit}>
                <fieldset
                  disabled={submitting}
                  className="m-0 min-w-0 border-0 p-0"
                >
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
                    <p
                      className="mb-0 mt-4 rounded-[8px] bg-danger-soft px-4 py-3 text-[13px] text-danger"
                      role="alert"
                    >
                      安全驗證尚未完成設定，目前暫停接收訂購，請聯絡表單管理者。
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
          )}
        </div>
      </div>
      {form.isOpen && availableProductCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--claim-border)] bg-[var(--claim-surface)] px-4 py-3 text-[var(--claim-surface-text)] lg:hidden">
          <div className="mx-auto flex max-w-[1040px] items-center justify-between gap-3">
            <div>
              <span className="block text-[11px]">已選 {itemCount} 件</span>
              <strong style={{ color: "#D6A84B" }} className="text-[20px]">
                {currency.format(subtotal)}
              </strong>
            </div>
            <button
              type="button"
              className="min-h-11 rounded-[8px] bg-[var(--claim-primary)] px-4 text-[13px] font-semibold text-[var(--claim-primary-text)] disabled:opacity-40"
              disabled={itemCount === 0 || submitting}
              onClick={() =>
                document
                  .getElementById("order-contact")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              填寫聯絡資料
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
