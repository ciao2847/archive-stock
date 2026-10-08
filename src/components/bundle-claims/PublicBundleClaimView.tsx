"use client";

import { type CSSProperties, type FormEvent, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Images,
  Landmark,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";

import { TurnstileWidget } from "@/components/claims/TurnstileWidget";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import {
  submitPublicBundleClaim,
  submitPublicBundleMenu,
} from "@/lib/api/bundle-claims";
import {
  formatBundleClaimMoney,
  normalizeTaiwanMobilePhone,
  type PublicBundleClaim,
} from "@/lib/bundle-claims";
import { blendHexColors, getContrastColor } from "@/lib/claim-form-theme";
import {
  buildOfficialLineChatUrl,
  formatTaipeiDateTime,
  TAIWAN_MOBILE_PHONE_HTML_PATTERN,
} from "@/lib/claims";

type ThemeStyle = CSSProperties & Record<`--${string}`, string | number>;

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

export function PublicBundleClaimView({
  claim,
  token,
  turnstileSiteKey,
  menuContext,
}: {
  claim: PublicBundleClaim;
  token: string;
  turnstileSiteKey: string | null;
  menuContext?: {
    orderId: number;
    nickname: string;
    onConfirmed: (claim: PublicBundleClaim) => void;
    onRefresh: () => Promise<void>;
    onSubmittingChange: (busy: boolean) => void;
    onRejected: (message: string) => void;
  };
}) {
  const [nickname, setNickname] = useState(
    menuContext?.nickname.slice(0, 100) ?? "",
  );
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [consent, setConsent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<
    "confirmation" | "account" | "message" | null
  >(null);
  const [requestId] = useState(createRequestId);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const primaryText = getContrastColor(claim.theme.primaryColor);
  const surfaceText = getContrastColor(claim.theme.surfaceColor);
  const pageText = getContrastColor(claim.theme.backgroundColor);
  const primaryHover = blendHexColors(
    claim.theme.primaryColor,
    "#000000",
    0.16,
  );
  const softColor = blendHexColors(
    claim.theme.surfaceColor,
    claim.theme.primaryColor,
    0.12,
  );
  const borderColor = blendHexColors(
    claim.theme.surfaceColor,
    claim.theme.primaryColor,
    0.27,
  );
  const mutedColor = blendHexColors(
    claim.theme.surfaceColor,
    surfaceText,
    0.62,
  );
  const themeStyle: ThemeStyle = {
    "--bundle-primary": claim.theme.primaryColor,
    "--bundle-primary-hover": primaryHover,
    "--bundle-primary-text": primaryText,
    "--bundle-background": claim.theme.backgroundColor,
    "--bundle-page-text": pageText,
    "--bundle-surface": claim.theme.surfaceColor,
    "--bundle-surface-text": surfaceText,
    "--bundle-muted": mutedColor,
    "--bundle-soft": softColor,
    "--bundle-border": borderColor,
    "--bundle-gold": "#D6A84B",
  };
  const heroStyle: CSSProperties = {
    backgroundColor: claim.theme.primaryColor,
    backgroundImage: claim.bannerImageUrl
      ? `linear-gradient(rgba(5, 16, 32, 0.3), rgba(5, 16, 32, 0.3)), url(${JSON.stringify(claim.bannerImageUrl)})`
      : undefined,
    backgroundPosition: `${claim.bannerPosition.x}% ${claim.bannerPosition.y}%`,
    backgroundSize: "cover",
    color: claim.theme.headerTextColor,
  };

  const lightboxImage = useMemo(() => {
    if (lightboxIndex === null) return null;
    const image = claim.images[lightboxIndex];
    if (!image?.url) return null;
    return {
      src: image.url,
      alt: `${claim.title} 核對商品 ${lightboxIndex + 1}`,
      label: `核對商品 ${lightboxIndex + 1}／${claim.images.length}`,
    };
  }, [claim.images, claim.title, lightboxIndex]);

  async function copyText(
    value: string,
    kind: "confirmation" | "account" | "message",
  ) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      window.prompt("請複製以下內容", value);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent) return;
    if (!turnstileSiteKey || !turnstileToken) {
      setError("請先完成人機驗證再送出。");
      return;
    }
    if (
      !window.confirm(
        `請再次確認固定總額為 ${formatBundleClaimMoney(claim.totalAmount)}。送出後不能自行修改或取消，確定送出嗎？`,
      )
    ) {
      return;
    }

    setSubmitting(true);
    menuContext?.onSubmittingChange(true);
    setError("");
    try {
      const input = {
        nickname,
        phone,
        notes,
        consent: true,
        requestId,
        turnstileToken,
        website,
      } as const;
      if (menuContext) {
        const confirmed = await submitPublicBundleMenu(token, {
          ...input,
          orderId: menuContext.orderId,
        });
        menuContext.onConfirmed(confirmed);
      } else {
        await submitPublicBundleClaim(token, input);
        window.location.reload();
      }
    } catch (submitError) {
      setTurnstileToken("");
      setTurnstileResetSignal((current) => current + 1);
      const message =
        submitError instanceof Error
          ? submitError.message
          : "送出失敗，請稍後再試。";
      setError(message);
      menuContext?.onRejected(message);
      setSubmitting(false);
      menuContext?.onSubmittingChange(false);
      if (menuContext) await menuContext.onRefresh();
    }
  }

  if (claim.state === "confirmed" && claim.confirmation) {
    const confirmation = claim.confirmation;
    const lineMessage = `您好，我已完成「${claim.title}」配單確認，確認編號：${confirmation.confirmationCode}，請協助核對，謝謝。`;
    const lineUrl = claim.officialLineId
      ? buildOfficialLineChatUrl(claim.officialLineId, lineMessage)
      : undefined;

    return (
      <main
        className="min-h-screen overflow-x-hidden bg-[var(--bundle-background)] px-4 py-5 text-[var(--bundle-page-text)] md:py-10"
        style={themeStyle}
      >
        <div className="mx-auto max-w-[480px] space-y-3 md:space-y-4">
          <section className="rounded-[14px] border border-[var(--bundle-border)] bg-[var(--bundle-surface)] px-4 py-5 text-center text-[var(--bundle-surface-text)] md:px-6 md:py-6">
            <span className="text-[10px] font-semibold tracking-[0.14em] text-[var(--bundle-muted)] md:text-[11px]">
              確認編號
            </span>
            <div className="mt-1.5 flex min-w-0 items-center justify-center gap-2">
              <strong className="min-w-0 break-all font-mono text-[21px] font-bold tracking-[0.04em] md:text-[25px]">
                {confirmation.confirmationCode}
              </strong>
              <button
                type="button"
                className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-[var(--bundle-border)] bg-[var(--bundle-soft)] text-[var(--bundle-primary)]"
                onClick={() =>
                  void copyText(confirmation.confirmationCode, "confirmation")
                }
                aria-label="複製確認編號"
              >
                {copied === "confirmation" ? (
                  <Check size={15} />
                ) : (
                  <Copy size={15} />
                )}
              </button>
            </div>
            <small className="mt-1.5 block text-[11px] leading-5 text-[var(--bundle-muted)]">
              建議截圖保留，方便之後與管理者核對
            </small>
          </section>

          <section className="overflow-hidden rounded-[14px] border border-[var(--bundle-border)] bg-[var(--bundle-surface)] text-[var(--bundle-surface-text)]">
            <div className="px-4 pb-1 pt-4 md:px-5 md:pt-5">
              <h2 className="m-0 text-[11px] font-bold text-[var(--bundle-muted)] md:text-[12px]">
                本次配單
              </h2>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-3.5 md:px-5">
              <div className="flex min-w-0 items-center gap-3">
                {claim.images[0]?.url ? (
                  <button
                    type="button"
                    className="size-12 shrink-0 overflow-hidden rounded-[9px] border-0 bg-[var(--bundle-soft)] p-0"
                    onClick={() => setLightboxIndex(0)}
                    aria-label="放大核對商品"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={claim.images[0].url}
                      alt="核對商品"
                      className="h-full w-full object-cover"
                    />
                  </button>
                ) : (
                  <span className="grid size-12 shrink-0 place-items-center rounded-[9px] bg-[var(--bundle-soft)] text-[var(--bundle-primary)]">
                    <Images size={20} />
                  </span>
                )}
                <div className="min-w-0">
                  <strong className="block truncate text-[13px] md:text-[14px]">
                    {claim.title}
                  </strong>
                  <span className="mt-0.5 block text-[11px] text-[var(--bundle-muted)]">
                    固定總額 × 1
                  </span>
                </div>
              </div>
              <strong
                style={{ color: "var(--bundle-gold)" }}
                className="shrink-0 text-[14px] text-[color:var(--bundle-gold)] md:text-[15px]"
              >
                {formatBundleClaimMoney(claim.totalAmount)}
              </strong>
            </div>
            <div className="flex items-center justify-between gap-3 bg-[var(--bundle-primary)] px-4 py-3 text-[var(--bundle-primary-text)] md:px-5">
              <span className="text-[12px] font-medium opacity-85">
                共 1 份商品
              </span>
              <strong
                style={{ color: "var(--bundle-gold)" }}
                className="text-[18px] text-[color:var(--bundle-gold)] md:text-[20px]"
              >
                {formatBundleClaimMoney(claim.totalAmount)}
              </strong>
            </div>
          </section>

          <section className="rounded-[14px] border border-[var(--bundle-border)] bg-[var(--bundle-surface)] p-4 text-[var(--bundle-surface-text)] md:p-5">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--bundle-soft)] text-[var(--bundle-primary)]">
                <CheckCircle2 size={17} />
              </span>
              <h1 className="m-0 text-[15px] font-bold md:text-[16px]">
                配單確認成功！接下來還有一步
              </h1>
            </div>
            <p className="mb-0 mt-3 whitespace-pre-wrap text-[12px] font-medium leading-6 text-[var(--bundle-muted)]">
              {claim.completionMessage}
            </p>

            {confirmation.transferAccount && (
              <div className="mt-4 rounded-[10px] border border-[var(--bundle-border)] bg-[var(--bundle-soft)] p-3.5">
                <div className="flex items-center gap-2 text-[12px] font-bold">
                  <Landmark
                    size={16}
                    className="text-[var(--bundle-primary)]"
                  />
                  匯款帳號
                </div>
                <dl className="mb-0 mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-[11px] md:text-[12px]">
                  <dt className="text-[var(--bundle-muted)]">銀行</dt>
                  <dd className="m-0 min-w-0 font-semibold">
                    ({confirmation.transferAccount.bankCode}){" "}
                    {confirmation.transferAccount.bankName}
                    {confirmation.transferAccount.bankBranch
                      ? ` ${confirmation.transferAccount.bankBranch}`
                      : ""}
                  </dd>
                  <dt className="self-center text-[var(--bundle-muted)]">
                    帳號
                  </dt>
                  <dd className="m-0 flex min-w-0 flex-wrap items-center gap-2">
                    <strong className="min-w-0 break-all font-mono text-[15px] tracking-[0.03em]">
                      {confirmation.transferAccount.account}
                    </strong>
                    <button
                      type="button"
                      className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-[8px] border border-[var(--bundle-border)] bg-[var(--bundle-surface)] px-2.5 text-[11px] font-bold text-[var(--bundle-primary)]"
                      onClick={() =>
                        void copyText(
                          confirmation.transferAccount!.account,
                          "account",
                        )
                      }
                    >
                      {copied === "account" ? (
                        <Check size={13} />
                      ) : (
                        <Copy size={13} />
                      )}
                      {copied === "account" ? "已複製" : "複製"}
                    </button>
                  </dd>
                </dl>
              </div>
            )}

            <ol className="m-0 mt-4 grid list-none gap-2.5 p-0">
              <li className="flex items-center gap-2.5 text-[12px] font-medium md:text-[13px]">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--bundle-primary)] text-[10px] font-bold text-[var(--bundle-primary-text)]">
                  1
                </span>
                {claim.officialLineId
                  ? `加入官方 LINE 好友（${claim.officialLineId}）`
                  : "依照管理者提供的方式聯繫結帳"}
              </li>
              <li className="flex items-center gap-2.5 text-[12px] font-medium md:text-[13px]">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--bundle-primary)] text-[10px] font-bold text-[var(--bundle-primary-text)]">
                  2
                </span>
                完成全額匯款，訂單才算正式成立
              </li>
            </ol>

            {lineUrl && (
              <>
                <a
                  className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--bundle-primary)] px-4 py-2.5 text-center text-[13px] font-bold text-[var(--bundle-primary-text)] transition hover:bg-[var(--bundle-primary-hover)] md:text-[14px]"
                  href={lineUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle size={18} />
                  前往官方 LINE 查看明細與結帳
                  <ExternalLink size={14} />
                </a>
                <div className="mt-4 rounded-[10px] border border-[var(--bundle-border)] bg-[var(--bundle-soft)] p-3.5 text-center">
                  <h2 className="m-0 text-[13px] font-bold">用手機掃碼聯絡</h2>
                  <p className="mb-0 mt-1 text-[11px] leading-5 text-[var(--bundle-muted)]">
                    使用電腦時，可用手機 LINE 掃描下方 QR
                    Code，開啟官方帳號並送出預填訊息。
                  </p>
                  <div className="mx-auto mt-3 w-fit max-w-full overflow-hidden rounded-[8px] bg-white">
                    <QRCodeSVG
                      value={lineUrl}
                      size={224}
                      level="M"
                      marginSize={4}
                      bgColor="#ffffff"
                      fgColor="#000000"
                      role="img"
                      aria-label="LINE 聯絡 QR Code"
                      title="使用手機 LINE 掃碼聯絡管理者"
                      style={{ maxWidth: "100%", height: "auto" }}
                    />
                  </div>
                  <p className="mb-0 mt-2 text-[12px] font-semibold">
                    {claim.officialLineId}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="複製核對訊息"
                  className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--bundle-border)] bg-[var(--bundle-surface)] px-4 text-[13px] font-bold text-[var(--bundle-primary)]"
                  onClick={() => void copyText(lineMessage, "message")}
                >
                  {copied === "message" ? (
                    <Check size={16} />
                  ) : (
                    <Copy size={16} />
                  )}
                  <span aria-live="polite">
                    {copied === "message" ? "核對訊息已複製" : "複製核對訊息"}
                  </span>
                </button>
                <p className="mb-0 mt-2 text-center text-[11px] leading-5 text-[var(--bundle-muted)]">
                  已加入官方帳號的客人，也可將核對訊息貼到電腦版 LINE
                  對話中，再按送出。
                </p>
              </>
            )}
            <small className="mt-2.5 block text-center text-[10px] leading-5 text-[var(--bundle-muted)] md:text-[11px]">
              確認時間：{formatTaipeiDateTime(confirmation.submittedAt)}
            </small>
          </section>
        </div>
        {lightboxImage && (
          <ImageLightbox
            src={lightboxImage.src}
            alt={lightboxImage.alt}
            label={lightboxImage.label}
            onClose={() => setLightboxIndex(null)}
          />
        )}
      </main>
    );
  }

  return (
    <main
      className="min-h-screen overflow-x-hidden bg-[var(--bundle-background)] pb-12 text-[var(--bundle-page-text)]"
      style={themeStyle}
    >
      {!menuContext && (
        <section className="relative w-full overflow-hidden" style={heroStyle}>
          <div className="relative z-10 mx-auto flex min-h-[180px] max-w-[1040px] flex-col justify-between gap-5 px-4 py-5 md:min-h-[230px] md:px-8 md:py-8">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full border border-white/30 px-3 py-1 text-[11px] font-semibold"
                style={{
                  backgroundColor: claim.theme.surfaceColor,
                  color: surfaceText,
                }}
              >
                {claim.storeName}
              </span>
              <span className="rounded-full bg-[#dff3e7] px-3 py-1 text-[11px] font-semibold text-[#17653b]">
                等待確認
              </span>
            </div>
            <div className="max-w-[720px]">
              <span className="text-[11px] font-semibold tracking-[0.12em] opacity-80">
                配單確認
              </span>
              <h1 className="m-0 mt-1 text-[24px] font-bold leading-tight md:text-[32px]">
                {claim.title}
              </h1>
              {claim.expiresAt && (
                <p className="mb-0 mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#F0C775] md:text-[12px]">
                  <Clock3 size={14} />
                  請於 {formatTaipeiDateTime(claim.expiresAt)} 前完成確認
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="mx-auto grid max-w-[1040px] gap-4 px-4 pt-5 lg:grid-cols-[minmax(0,1.85fr)_minmax(300px,1fr)] md:gap-5 md:px-8 md:pt-8">
        <section className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-[14px] border border-[var(--bundle-border)] bg-[var(--bundle-surface)] text-[var(--bundle-surface-text)]">
            <div className="p-4 md:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Images size={17} className="text-[var(--bundle-primary)]" />
                  <h2 className="m-0 text-[14px] font-bold md:text-[15px]">
                    核對商品
                  </h2>
                </div>
                <span className="text-[11px] text-[var(--bundle-muted)]">
                  共 {claim.images.length} 件
                </span>
              </div>
              <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-3">
                {claim.images.map((image, index) => (
                  <div key={image.id} className="min-w-0">
                    <button
                      type="button"
                      className="group relative block aspect-square w-full min-w-0 overflow-hidden rounded-[9px] border border-[var(--bundle-border)] bg-[var(--bundle-soft)] p-0"
                      onClick={() => setLightboxIndex(index)}
                      aria-label={`放大核對商品 ${index + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.url}
                        alt={`${claim.title} 圖片 ${index + 1}`}
                        className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                        loading={index > 2 ? "lazy" : "eager"}
                        decoding="async"
                      />
                      <span className="absolute bottom-2 right-2 grid size-6 place-items-center rounded-[7px] bg-black/65 text-[10px] font-bold text-white">
                        {index + 1}
                      </span>
                    </button>
                    <p className="mb-0 mt-2 break-words text-[12px] font-semibold leading-5">
                      {image.productName || claim.title}
                    </p>
                    {image.productAmount !== undefined ? (
                      <span
                        style={{ color: "var(--bundle-gold)" }}
                        className="block text-[12px] font-bold"
                      >
                        {formatBundleClaimMoney(image.productAmount)}
                      </span>
                    ) : (
                      <span className="block text-[11px] text-[var(--bundle-muted)]">
                        金額已含於總額
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {claim.images.some(
                (image) =>
                  !image.productName || image.productAmount === undefined,
              ) && (
                <div className="mt-4 border-t border-[var(--bundle-border)] pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[11px] font-medium text-[var(--bundle-muted)]">
                        品項
                      </span>
                      <h3 className="m-0 mt-0.5 break-words text-[16px] font-bold md:text-[18px]">
                        {claim.title}
                      </h3>
                    </div>
                  </div>

                  {claim.description && (
                    <p className="mb-0 mt-3 whitespace-pre-wrap break-words rounded-[8px] bg-[var(--bundle-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--bundle-muted)]">
                      {claim.description}
                    </p>
                  )}
                </div>
              )}
              {claim.images.every(
                (image) =>
                  image.productName && image.productAmount !== undefined,
              ) &&
                claim.description && (
                  <p className="mb-0 mt-3 whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--bundle-muted)]">
                    {claim.description}
                  </p>
                )}
            </div>
            <div
              aria-label="配單總額"
              className="flex min-h-16 items-center justify-between gap-3 bg-[var(--bundle-primary)] px-4 py-3 text-[var(--bundle-primary-text)] md:px-5"
            >
              <span className="min-w-0 break-words text-[13px] font-semibold">
                {claim.customerHint || claim.title}
                <span className="ml-1 font-normal opacity-80">
                  （共 {claim.images.length} 件）
                </span>
              </span>
              <strong
                style={{ color: "var(--bundle-gold)" }}
                className="shrink-0 text-[21px] font-bold text-[color:var(--bundle-gold)] md:text-[24px]"
              >
                {formatBundleClaimMoney(claim.totalAmount)}
              </strong>
            </div>
          </div>
        </section>

        <section className="min-w-0 self-start rounded-[14px] border border-[var(--bundle-border)] bg-[var(--bundle-surface)] p-4 text-[var(--bundle-surface-text)] lg:sticky lg:top-5 md:p-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[var(--bundle-soft)] text-[var(--bundle-primary)]">
              <ShieldCheck size={19} />
            </span>
            <div>
              <span className="text-[11px] font-semibold text-[var(--bundle-primary)]">
                最後一步
              </span>
              <h2 className="m-0 text-[16px] font-bold">確認聯絡資料</h2>
            </div>
          </div>

          <form className="mt-4" onSubmit={submit}>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-semibold">
                群組暱稱 <em className="not-italic text-danger">*</em>
              </span>
              <input
                className="min-h-11 w-full min-w-0 rounded-[8px] border border-[var(--bundle-border)] bg-white px-3 text-[14px] text-dark outline-none focus:border-[var(--bundle-primary)] focus:ring-2 focus:ring-[var(--bundle-soft)]"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                maxLength={100}
                autoComplete="nickname"
                placeholder="例：小明／Peter"
                required
              />
            </label>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[12px] font-semibold">
                手機號碼 <em className="not-italic text-danger">*</em>
              </span>
              <input
                className="min-h-11 w-full min-w-0 rounded-[8px] border border-[var(--bundle-border)] bg-white px-3 text-[14px] text-dark outline-none focus:border-[var(--bundle-primary)] focus:ring-2 focus:ring-[var(--bundle-soft)]"
                value={phone}
                onChange={(event) =>
                  setPhone(normalizeTaiwanMobilePhone(event.target.value))
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
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[12px] font-semibold">
                備註（選填）
              </span>
              <textarea
                className="min-h-20 w-full min-w-0 resize-y rounded-[8px] border border-[var(--bundle-border)] bg-white px-3 py-2.5 text-[14px] text-dark outline-none focus:border-[var(--bundle-primary)] focus:ring-2 focus:ring-[var(--bundle-soft)]"
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
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[8px] bg-[var(--bundle-soft)] px-3.5 py-3.5">
              <input
                className="mt-0.5 size-4 shrink-0"
                style={{ accentColor: claim.theme.primaryColor }}
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                required
              />
              <span className="text-[12px] leading-5 text-[var(--bundle-muted)]">
                我已核對商品、品項名稱與固定總額，了解送出後不能自行修改或取消，並同意提供聯絡資料供管理者核對。
              </span>
            </label>
            {turnstileSiteKey ? (
              <TurnstileWidget
                siteKey={turnstileSiteKey}
                resetSignal={turnstileResetSignal}
                onTokenChange={setTurnstileToken}
              />
            ) : (
              <p className="mb-0 mt-4 rounded-[8px] bg-danger-soft px-4 py-3 text-[13px] text-danger">
                安全驗證尚未完成設定，目前暫停接收配單確認。
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
              type="submit"
              className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[8px] border-0 bg-[var(--bundle-primary)] px-4 text-[14px] font-bold text-[var(--bundle-primary-text)] transition hover:bg-[var(--bundle-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                submitting || !consent || !turnstileSiteKey || !turnstileToken
              }
            >
              {submitting ? "正在送出…" : "確認配單"}
              {!submitting && <Check size={18} />}
            </button>
            <p className="mb-0 mt-3 text-center text-[10px] leading-5 text-[var(--bundle-muted)]">
              本頁金額由管理者確認後建立，顧客無法修改金額或數量。
            </p>
          </form>
        </section>
      </div>

      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          label={lightboxImage.label}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </main>
  );
}
