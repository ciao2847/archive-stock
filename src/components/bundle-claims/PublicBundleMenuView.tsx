"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { PublicBundleClaimView } from "@/components/bundle-claims/PublicBundleClaimView";
import { fetchPublicBundleMenu } from "@/lib/api/bundle-claims";
import {
  type PublicBundleClaim,
  type PublicBundleMenu,
} from "@/lib/bundle-claims";
import { getContrastColor } from "@/lib/claim-form-theme";

export function PublicBundleMenuView({
  menu: initialMenu,
  token,
  turnstileSiteKey,
}: {
  menu: PublicBundleMenu;
  token: string;
  turnstileSiteKey: string | null;
}) {
  const [menu, setMenu] = useState<PublicBundleMenu | null>(initialMenu);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<PublicBundleClaim | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const selected = menu?.options.find(
    (option) => option.id === selectedId && option.state === "open",
  );

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!signal?.aborted) setRefreshing(true);
      try {
        const next = await fetchPublicBundleMenu(token, signal);
        if (!signal?.aborted) {
          setMenu(next);
          setError("");
        }
      } catch (failure) {
        if (!signal?.aborted) {
          setMenu(null);
          setError(
            failure instanceof Error
              ? failure.message
              : "共同選單讀取失敗，請稍後再試。",
          );
        }
      } finally {
        if (!signal?.aborted) setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    const revalidate = () => {
      if (!busy && document.visibilityState === "visible")
        void refresh(controller.signal);
    };
    const timer = window.setInterval(revalidate, 60_000);
    window.addEventListener("focus", revalidate);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", revalidate);
    };
  }, [busy, refresh]);

  function choose(id: number | null) {
    setSubmissionError("");
    setSelectedId(id);
  }

  function confirmed(claim: PublicBundleClaim) {
    setReceipt(claim);
    setBusy(false);
    setSelectedId(null);
    void refresh();
  }

  if (receipt) {
    return (
      <PublicBundleClaimView
        key="receipt"
        claim={receipt}
        token={token}
        turnstileSiteKey={turnstileSiteKey}
      />
    );
  }

  const appearance = menu ?? initialMenu;
  return (
    <div
      className="min-h-screen overflow-x-hidden"
      style={{
        backgroundColor: appearance.theme.backgroundColor,
        color: getContrastColor(appearance.theme.backgroundColor),
      }}
    >
      <section
        aria-label="共同選單介紹"
        className="px-4 py-6 md:px-8 md:py-8"
        style={{
          backgroundColor: appearance.theme.primaryColor,
          color: appearance.theme.headerTextColor,
          backgroundImage: appearance.bannerImageUrl
            ? `linear-gradient(rgba(5,16,32,.35),rgba(5,16,32,.35)),url(${JSON.stringify(appearance.bannerImageUrl)})`
            : undefined,
          backgroundSize: "cover",
          backgroundPosition: `${appearance.bannerPosition.x}% ${appearance.bannerPosition.y}%`,
        }}
      >
        <div className="mx-auto max-w-[976px]">
          <span className="text-[12px] font-semibold">
            {appearance.storeName}
          </span>
          <h1
            style={{ color: appearance.theme.headerTextColor }}
            className="mb-0 mt-2 text-[25px] font-bold md:text-[28px]"
          >
            {appearance.campaignTitle || "配單確認"}
          </h1>
          {appearance.campaignDescription && (
            <p className="mb-0 mt-2 whitespace-pre-wrap text-[13px] opacity-85">
              {appearance.campaignDescription}
            </p>
          )}
          <ol
            aria-label="配單流程"
            className="mb-0 mt-5 flex list-none flex-wrap items-center gap-2 p-0"
          >
            {["選自己的專屬配單", "核對與填資料", "完成配單確認"].map(
              (step, index) => (
                <li key={step} className="flex items-center gap-2">
                  {index > 0 && (
                    <span aria-hidden="true" className="opacity-50">
                      →
                    </span>
                  )}
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-2 text-[11px] font-semibold">
                    <span className="grid size-4 place-items-center rounded-full bg-white/20 text-[10px]">
                      {index + 1}
                    </span>
                    {step}
                  </span>
                </li>
              ),
            )}
          </ol>
        </div>
      </section>

      <section
        className="mx-auto max-w-[1040px] px-4 pt-5 md:px-8 md:pt-8"
        aria-label="選擇專屬配單"
      >
        <div
          className="rounded-[14px] border border-black/10 p-4 md:p-5"
          style={{
            backgroundColor: appearance.theme.surfaceColor,
            color: getContrastColor(appearance.theme.surfaceColor),
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 flex items-center gap-2 text-[17px] font-bold">
              <span
                className="grid size-7 shrink-0 place-items-center rounded-full text-[13px]"
                style={{
                  backgroundColor: appearance.theme.primaryColor,
                  color: getContrastColor(appearance.theme.primaryColor),
                }}
              >
                1
              </span>
              第一步：選自己的群組暱稱
            </h2>
            <button
              type="button"
              disabled={busy || refreshing}
              onClick={() => void refresh()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-[8px] border border-current/20 px-3 text-[12px] disabled:opacity-50"
            >
              <RefreshCw
                size={14}
                className={refreshing ? "animate-spin" : ""}
              />
              更新選單
            </button>
          </div>
          {error && (
            <p role="alert" className="mb-0 mt-3 text-[13px] text-danger">
              {error}
            </p>
          )}
          {!selected && submissionError && (
            <p role="alert" className="mb-0 mt-3 text-[13px] text-danger">
              {submissionError}
            </p>
          )}
          {menu && (
            <>
              <p className="mb-0 mt-3 text-[12px] leading-6 opacity-75">
                每份都已配好，請選擇自己的暱稱。金額與數量不可修改；已確認的選項不能重複確認。
              </p>
              <p className="mb-0 mt-4 text-[12px] opacity-65">
                <span className="font-semibold">規格：</span>{" "}
                點選你的暱稱，灰色代表已被選走
              </p>
              <div
                role="group"
                aria-label="姓名選項"
                className="mt-2 flex flex-wrap gap-2"
              >
                {menu.options.map((option) => {
                  const active = selected?.id === option.id;
                  const unavailable = option.state === "confirmed";
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-label={option.label}
                      aria-pressed={active}
                      data-bundle-order-id={option.id}
                      disabled={busy || unavailable}
                      onClick={() => choose(option.id)}
                      className="inline-flex min-h-11 max-w-full items-center justify-center gap-1.5 rounded-[8px] border px-4 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55"
                      style={{
                        backgroundColor: unavailable
                          ? "#e5e7eb"
                          : active
                            ? appearance.theme.primaryColor
                            : appearance.theme.surfaceColor,
                        color: unavailable
                          ? "#6b7280"
                          : active
                            ? getContrastColor(appearance.theme.primaryColor)
                            : getContrastColor(appearance.theme.surfaceColor),
                        borderColor: active
                          ? appearance.theme.primaryColor
                          : "#cbd5e1",
                      }}
                    >
                      {active && <Check size={14} aria-hidden="true" />}
                      <span
                        className={
                          unavailable
                            ? "break-words line-through"
                            : "break-words"
                        }
                      >
                        {option.label}
                        {unavailable && " 已確認"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {menu.options.length === 0 ? (
                <p className="mb-0 mt-5 text-[13px]">
                  目前沒有已開放的配單，請稍後再看或聯絡管理者。
                </p>
              ) : selected ? (
                <p className="mb-0 mt-3 text-[13px]">
                  已選擇 {selected.label} 的專屬配單，請往下核對內容。
                </p>
              ) : null}
            </>
          )}
        </div>
      </section>

      {selected && menu ? (
        <PublicBundleClaimView
          key={selected.id}
          token={token}
          turnstileSiteKey={turnstileSiteKey}
          claim={{
            ...menu,
            state: "open",
            title: selected.title,
            description: selected.description,
            totalAmount: selected.totalAmount,
            customerHint: selected.label,
            expiresAt: selected.expiresAt,
            images: selected.images,
          }}
          menuContext={{
            orderId: selected.id,
            nickname: selected.label,
            onConfirmed: confirmed,
            onRefresh: refresh,
            onSubmittingChange: setBusy,
            onRejected: setSubmissionError,
          }}
        />
      ) : (
        <p className="mx-auto mb-0 max-w-[1040px] px-4 py-8 text-center text-[13px] md:px-8">
          {menu
            ? "選擇自己的配單後，才能填寫聯絡資料並送出。"
            : "請更新選單或向管理者確認最新連結。"}
        </p>
      )}
    </div>
  );
}
