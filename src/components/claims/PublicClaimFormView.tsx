"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  ImageIcon,
  Minus,
  PackageCheck,
  Plus,
  ShoppingBag,
} from "lucide-react";

import { submitPublicClaim } from "@/lib/api/claims";
import {
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

const dateTime = new Intl.DateTimeFormat("zh-TW", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Taipei",
});

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
}: {
  form: PublicClaimForm;
  token: string;
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PublicClaimSubmissionResult | null>(
    null,
  );
  const [requestId] = useState(createRequestId);

  const selectedProducts = useMemo(
    () =>
      form.products
        .filter((product) => (quantities[product.id] ?? 0) > 0)
        .map((product) => ({
          product,
          quantity: quantities[product.id] ?? 0,
        })),
    [form.products, quantities],
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agreed || itemCount < 1) return;
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
        items: selectedProducts.map(({ product, quantity }) => ({
          productId: product.id,
          quantity,
        })),
      });
      setResult(response);
      setStep("success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "喊單送出失敗，請稍後再試",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "success" && result) {
    return (
      <main className="min-h-screen bg-[#f3f7fb] px-3 py-4 text-dark md:px-4 md:py-12">
        <div className="mx-auto max-w-[720px]">
          <section className="overflow-hidden rounded-[8px] border border-[#d5e1eb] bg-white shadow-[0_18px_55px_rgba(72,111,145,0.1)] md:rounded-[8px] md:shadow-[0_24px_80px_rgba(72,111,145,0.1)]">
            <div className="bg-[#5a87b1] px-4 py-6 text-center text-white md:px-10 md:py-10">
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-white/20 text-white md:size-16">
                <CheckCircle2 className="size-7 md:size-9" aria-hidden="true" />
              </span>
              <h1 className="mb-0 mt-3 text-[22px] text-white md:mt-5 md:text-[26px]">
                喊單完成
              </h1>
              <p className="mb-0 mt-1.5 text-[13px] text-white/75 md:mt-2 md:text-[14px]">
                {form.storeName} 已收到你的預購需求
              </p>
            </div>
            <div className="px-4 py-5 md:px-9 md:py-9">
              <div className="rounded-[8px] bg-[#eef4f9] px-3 py-3 text-center md:rounded-[8px] md:px-5 md:py-5">
                <span className="text-[11px] font-semibold tracking-[0.12em] text-muted md:text-[12px] md:tracking-[0.14em]">
                  確認編號
                </span>
                <strong className="mt-1.5 block font-mono text-[19px] tracking-[0.04em] md:mt-2 md:text-[25px] md:tracking-[0.06em]">
                  {result.confirmationCode}
                </strong>
                <small className="mt-1 block text-[11px] text-muted md:mt-2 md:text-[12px]">
                  建議截圖保留，方便之後與管理者核對
                </small>
              </div>
              <div className="mt-5 md:mt-7">
                <h2 className="m-0 text-[15px] md:text-[17px]">本次喊單</h2>
                <div className="mt-2 divide-y divide-line rounded-[8px] border border-line px-3 md:mt-3 md:rounded-[8px] md:px-4">
                  {selectedProducts.map(({ product, quantity }) => (
                    <div
                      key={product.id}
                      className="flex items-start justify-between gap-3 py-3 md:gap-4 md:py-4"
                    >
                      <div className="min-w-0">
                        <strong className="block truncate text-[13px] md:text-[14px]">
                          {product.name}
                        </strong>
                        <span className="mt-0.5 block text-[11px] text-muted md:mt-1 md:text-[12px]">
                          {currency.format(product.price)}
                        </span>
                      </div>
                      <b className="shrink-0 text-[13px] md:text-[14px]">
                        × {quantity}
                      </b>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-line pt-4 md:mt-5 md:pt-5">
                <span className="text-[13px] text-muted md:text-[14px]">
                  共 {itemCount} 件商品
                </span>
                <strong className="text-[18px] md:text-[20px]">
                  {currency.format(subtotal)}
                </strong>
              </div>
              <p className="mb-0 mt-4 rounded-[8px] bg-primary-soft px-3 py-2.5 text-[12px] leading-5 text-primary-strong md:mt-6 md:rounded-[8px] md:px-4 md:py-3 md:text-[13px] md:leading-6">
                這是預購需求登記，管理者會依喊單總數採購；目前尚未付款或保留現貨，最終到貨與付款方式請依群組通知為準。
              </p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f3f7fb] pb-32 text-dark">
      <div className="mx-auto max-w-[1120px] px-4 pt-6 md:px-8 md:pt-10">
        <section className="relative overflow-hidden rounded-[8px] border border-[#cadce9] bg-[#e4eff7] px-4 py-4 text-[#263f55] shadow-[0_12px_36px_rgba(72,111,145,0.1)] md:rounded-[8px] md:px-8 md:py-7">
          <div className="absolute -right-10 -top-16 size-40 rounded-full bg-[#b8d3e6]/65 md:size-48" />
          <div className="absolute -bottom-24 right-20 size-40 rounded-full bg-[#c7e2de]/70 md:size-44" />
          <div className="relative max-w-[720px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-[8px] border border-white/80 bg-white/75 px-2.5 py-1 text-[11px] font-semibold text-[#355b79] md:text-[12px]">
                {form.storeName}
              </span>
              <span
                className={`rounded-[8px] px-2.5 py-1 text-[11px] font-semibold md:text-[12px] ${form.isOpen ? "bg-[#dff3e7] text-[#17653b]" : "bg-[#d8e2ea] text-[#5e7182]"}`}
              >
                {form.isOpen ? "喊單開放中" : "喊單已截止"}
              </span>
              <span className="rounded-[8px] bg-[#fff4d8] px-2.5 py-1 text-[11px] font-semibold text-[#7a5a13] md:text-[12px]">
                預購登記
              </span>
            </div>
            <h1 className="mb-0 mt-3 max-w-[680px] text-[22px] leading-tight text-[#20384d] md:mt-4 md:text-[30px]">
              {form.title}
            </h1>
            {form.description && (
              <p className="mb-0 mt-2 whitespace-pre-wrap text-[13px] leading-5 text-[#526b80] md:mt-3 md:text-[14px] md:leading-6">
                {form.description}
              </p>
            )}
            {form.closesAt && (
              <p className="mb-0 mt-2.5 text-[11px] font-semibold text-[#47749a] md:mt-3 md:text-[12px]">
                截止時間：{dateTime.format(new Date(form.closesAt))}
              </p>
            )}
            <p className="mb-0 mt-2.5 flex items-start gap-1.5 text-[11px] font-medium leading-5 text-[#355b79] md:text-[12px]">
              <ShoppingBag
                className="mt-0.5 shrink-0"
                size={14}
                aria-hidden="true"
              />
              此頁先登記需求，截止後才統一採購，不會占用或扣除現貨庫存。
            </p>
          </div>
        </section>

        {step === "details" ? (
          <section className="mx-auto mt-7 max-w-[760px] md:mt-9">
            <button
              type="button"
              className="inline-flex items-center gap-2 border-0 bg-transparent p-0 text-[14px] font-semibold text-muted hover:text-dark"
              onClick={() => setStep("products")}
            >
              <ArrowLeft size={17} aria-hidden="true" />
              返回商品清單
            </button>
            <div className="mt-4 rounded-[8px] border border-[#d5e1eb] bg-white p-5 shadow-[0_14px_50px_rgba(72,111,145,0.08)] md:p-8">
              <div className="flex items-start gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                  <PackageCheck size={23} aria-hidden="true" />
                </span>
                <div>
                  <span className="text-[12px] font-semibold tracking-[0.12em] text-primary">
                    最後一步
                  </span>
                  <h2 className="mb-0 mt-1 text-[22px]">確認喊單與聯絡資料</h2>
                  <p className="mb-0 mt-2 text-[14px] leading-6 text-muted">
                    這是預購需求登記，送出後會列入採購數量。電話號碼是主要查詢依據；若暱稱寫錯，管理者仍可用電話找到紀錄。
                  </p>
                </div>
              </div>

              <div className="mt-7 divide-y divide-line rounded-[8px] border border-line px-4">
                {selectedProducts.map(({ product, quantity }) => (
                  <div
                    key={product.id}
                    className="flex items-start justify-between gap-4 py-4"
                  >
                    <div className="min-w-0">
                      <strong className="block text-[14px]">
                        {product.name}
                      </strong>
                      <span className="mt-1 block text-[12px] text-muted">
                        {currency.format(product.price)}
                      </span>
                    </div>
                    <b className="shrink-0">× {quantity}</b>
                  </div>
                ))}
                <div className="flex items-center justify-between py-4">
                  <span className="text-muted">共 {itemCount} 件</span>
                  <strong className="text-[19px]">
                    {currency.format(subtotal)}
                  </strong>
                </div>
              </div>

              <form className="mt-7" onSubmit={submit}>
                <div className="grid gap-5 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-[13px] font-semibold">
                      群組暱稱 <em className="not-italic text-danger">*</em>
                    </span>
                    <input
                      className="min-h-12 w-full rounded-[8px] border border-line bg-white px-4 text-[15px] focus:border-primary focus:ring-2 focus:ring-primary-soft"
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
                      className="min-h-12 w-full rounded-[8px] border border-line bg-white px-4 text-[15px] focus:border-primary focus:ring-2 focus:ring-primary-soft"
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
                      aria-describedby="claim-phone-format"
                      required
                    />
                    <small
                      id="claim-phone-format"
                      className="mt-1.5 block text-[11px] leading-5 text-muted"
                    >
                      請輸入 09 開頭的 10
                      位數手機號碼，只能使用數字；之後會用這支電話查詢你的紀錄。
                    </small>
                  </label>
                </div>
                <label className="mt-5 block">
                  <span className="mb-2 block text-[13px] font-semibold">
                    備註（選填）
                  </span>
                  <textarea
                    className="min-h-24 w-full resize-y rounded-[8px] border border-line bg-white px-4 py-3 text-[15px] focus:border-primary focus:ring-2 focus:ring-primary-soft"
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
                <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-[8px] bg-[#eef4f9] px-4 py-4">
                  <input
                    className="mt-0.5 size-4 accent-[#5a87b1]"
                    type="checkbox"
                    checked={agreed}
                    onChange={(event) => setAgreed(event.target.checked)}
                    required
                  />
                  <span className="text-[13px] leading-6 text-muted">
                    我已確認品項與數量，了解送出後會列入預購採購數量且不能自行取消，並同意提供電話與群組暱稱供管理者核對。
                  </span>
                </label>
                {error && (
                  <p
                    className="mb-0 mt-4 rounded-[8px] bg-danger-soft px-4 py-3 text-[13px] text-danger"
                    role="alert"
                  >
                    {error}
                  </p>
                )}
                <button
                  className="mt-6 inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-[8px] border-0 bg-[#5a87b1] px-5 text-[15px] font-semibold text-white hover:bg-[#47749a] disabled:cursor-not-allowed disabled:opacity-50"
                  type="submit"
                  disabled={submitting || !agreed}
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
              <section className="mt-7 flex items-start gap-3 rounded-[8px] border border-[#d5e1eb] bg-white px-5 py-4 md:mt-9">
                <ShoppingBag className="mt-0.5 shrink-0 text-muted" size={21} />
                <div>
                  <h2 className="m-0 text-[16px]">這次喊單已經截止</h2>
                  <p className="mb-0 mt-1 text-[13px] leading-6 text-muted">
                    商品仍可查看，但目前不能再送出。後續消息請留意群組公告。
                  </p>
                </div>
              </section>
            )}

            {form.products.length === 0 ? (
              <section className="mt-6 rounded-[8px] border border-[#d5e1eb] bg-white px-6 py-12 text-center">
                <ShoppingBag className="mx-auto text-muted" size={34} />
                <h2 className="mb-0 mt-4 text-[20px]">商品即將上架</h2>
                <p className="mb-0 mt-2 text-[14px] text-muted">
                  管理者更新後，重新整理這個頁面就會看到最新商品。
                </p>
              </section>
            ) : (
              <section className="mt-4 grid grid-cols-2 gap-2 md:mt-6 md:grid-cols-4 md:gap-4">
                {form.products.map((product) => {
                  const quantity = quantities[product.id] ?? 0;
                  return (
                    <article
                      key={product.id}
                      className={`overflow-hidden rounded-[8px] border bg-white transition-colors md:rounded-[8px] ${quantity > 0 ? "border-[#5a87b1]" : "border-[#d5e1eb]"}`}
                    >
                      <div className="aspect-[3/2] overflow-hidden bg-[#edf3f7]">
                        {product.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className="h-full w-full object-cover"
                            src={product.imageUrl}
                            alt={`${product.name} 商品圖片`}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="grid h-full place-items-center text-muted">
                            <ImageIcon size={34} aria-hidden="true" />
                          </span>
                        )}
                      </div>
                      <div className="p-2.5 md:p-3">
                        <span className="block truncate text-[10px] font-semibold text-[#4d7699] md:text-[11px]">
                          {product.category}
                        </span>
                        <h3
                          className="mb-0 mt-1 truncate text-[13px] leading-[18px] md:text-[15px] md:leading-5"
                          title={product.name}
                        >
                          {product.name}
                        </h3>
                        <div className="mt-2 flex min-w-0 items-center justify-between gap-1.5">
                          <strong className="min-w-0 truncate text-[13px] md:text-[15px]">
                            {currency.format(product.price)}
                          </strong>
                          <div className="flex w-[88px] shrink-0 items-center justify-between rounded-[8px] border border-[#cedce7] bg-white p-0.5 md:w-[96px] md:rounded-[8px]">
                            <button
                              type="button"
                              className="grid size-7 place-items-center rounded-[8px] border-0 bg-transparent text-dark hover:bg-light disabled:text-muted"
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
                              className="h-7 w-7 border-0 bg-transparent p-0 text-center text-[12px] font-semibold outline-none"
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
                              className="grid size-7 place-items-center rounded-[8px] border-0 bg-[#e4eff7] text-[#4d7699] hover:bg-[#5a87b1] hover:text-white disabled:text-muted"
                              onClick={() =>
                                setQuantity(
                                  product.id,
                                  quantity + 1,
                                  product.maxQuantity,
                                )
                              }
                              disabled={
                                !form.isOpen || quantity >= product.maxQuantity
                              }
                              aria-label={`增加${product.name}數量`}
                            >
                              <Plus size={13} aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
            )}
          </>
        )}
      </div>

      {step === "products" && form.isOpen && form.products.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#d5e1eb] bg-white/95 px-4 py-3 shadow-[0_-10px_35px_rgba(72,111,145,0.1)] backdrop-blur md:px-8 md:py-4">
          <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="block text-[12px] text-muted">
                {itemCount > 0 ? `已選 ${itemCount} 件商品` : "尚未選擇商品"}
              </span>
              <strong className="mt-0.5 block text-[18px]">
                {currency.format(subtotal)}
              </strong>
            </div>
            <button
              type="button"
              className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-[8px] border-0 bg-[#5a87b1] px-5 font-semibold text-white hover:bg-[#47749a] disabled:opacity-40 md:min-w-[190px]"
              disabled={itemCount === 0}
              onClick={() => {
                setStep("details");
                setError("");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              填寫聯絡資料
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
