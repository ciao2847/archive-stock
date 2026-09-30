"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

import { CLAIM_TURNSTILE_ACTION } from "@/lib/turnstile-config";

type TurnstileRenderOptions = {
  sitekey: string;
  action: string;
  appearance: "always";
  execution: "render";
  language: string;
  retry: "auto";
  size: "flexible";
  theme: "light";
  "response-field": false;
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function TurnstileWidget({
  siteKey,
  resetSignal,
  onTokenChange,
}: {
  siteKey: string;
  resetSignal: number;
  onTokenChange: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const previousResetSignalRef = useRef(resetSignal);
  const onTokenChangeRef = useRef(onTokenChange);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile || widgetIdRef.current) {
      return;
    }

    try {
      setLoadError("");
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action: CLAIM_TURNSTILE_ACTION,
        appearance: "always",
        execution: "render",
        language: "zh-TW",
        retry: "auto",
        size: "flexible",
        theme: "light",
        "response-field": false,
        callback: (token) => onTokenChangeRef.current(token),
        "error-callback": () => {
          onTokenChangeRef.current("");
          setLoadError("安全驗證載入失敗，請重新整理後再試。");
        },
        "expired-callback": () => onTokenChangeRef.current(""),
        "timeout-callback": () => onTokenChangeRef.current(""),
      });
    } catch {
      setLoadError("安全驗證載入失敗，請重新整理後再試。");
      onTokenChangeRef.current("");
    }
  }, [siteKey]);

  useEffect(() => {
    renderWidget();
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
      onTokenChangeRef.current("");
    };
  }, [renderWidget]);

  useEffect(() => {
    if (previousResetSignalRef.current === resetSignal) return;
    previousResetSignalRef.current = resetSignal;
    onTokenChangeRef.current("");
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    } else {
      renderWidget();
    }
  }, [renderWidget, resetSignal]);

  return (
    <div className="mt-5 min-w-0">
      <Script
        id="cloudflare-turnstile-script"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={renderWidget}
        onError={() => {
          onTokenChangeRef.current("");
          setLoadError("安全驗證載入失敗，請重新整理後再試。");
        }}
      />
      <div
        ref={containerRef}
        className="min-h-[65px] w-full min-w-0 overflow-hidden"
        aria-label="Cloudflare 人機安全驗證"
      />
      {loadError && (
        <p className="mb-0 mt-2 text-[13px] text-danger" role="alert">
          {loadError}
        </p>
      )}
    </div>
  );
}
