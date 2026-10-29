"use client";

import { ErrorMessage } from "@/components/ui/ErrorMessage";

import { useEffect, useRef, useState } from "react";
import { CLAIM_TURNSTILE_ACTION } from "@/lib/turnstile-config";
import { loadTurnstile } from "@/lib/turnstile-client";

function errorMessage(code?: string) {
  if (
    ["110100", "110110", "110200", "400020", "400021", "400070"].includes(
      code ?? "",
    )
  )
    return `安全驗證設定異常，請聯絡表單管理者（${code}）。已填資料會保留。`;
  return `安全驗證暫時無法完成，請按「重新驗證」。已填資料會保留。${code ? `（${code}）` : ""}`;
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
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const failedRef = useRef(false);
  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setLoadError("");
    failedRef.current = false;
    onTokenChangeRef.current("");
    const fail = (code?: string) => {
      if (disposed) return;
      failedRef.current = true;
      setLoading(false);
      setLoadError(errorMessage(code));
      onTokenChangeRef.current("");
    };
    const initialize = async (retry = false) => {
      try {
        const api = await loadTurnstile();
        if (disposed || !containerRef.current) return;
        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: siteKey,
          action: CLAIM_TURNSTILE_ACTION,
          appearance: "always",
          execution: "render",
          language: "zh-TW",
          retry: "auto",
          "refresh-expired": "auto",
          "refresh-timeout": "auto",
          size: "flexible",
          theme: "light",
          "response-field": false,
          callback: (token) => {
            if (disposed) return;
            failedRef.current = false;
            setLoadError("");
            setLoading(false);
            onTokenChangeRef.current(token);
          },
          "error-callback": (code) => {
            fail(code);
            return true;
          },
          "expired-callback": () => {
            if (!disposed) onTokenChangeRef.current("");
          },
          "timeout-callback": () => {
            if (!disposed) onTokenChangeRef.current("");
          },
        });
        if (!disposed) setLoading(false);
      } catch {
        if (disposed) return;
        // One fresh SDK request handles a transient mobile network failure.
        // Later failures offer an explicit retry without reloading the form.
        if (!retry && !window.turnstile) {
          retryTimer = setTimeout(() => void initialize(true), 1500);
        } else fail();
      }
    };
    void initialize();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* The iframe may already have been removed. */
        }
      }
      widgetIdRef.current = null;
      onTokenChangeRef.current("");
    };
  }, [siteKey, attempt]);

  useEffect(() => {
    if (previousResetSignalRef.current === resetSignal) return;
    previousResetSignalRef.current = resetSignal;
    onTokenChangeRef.current("");
    setLoadError("");
    failedRef.current = false;
    try {
      if (widgetIdRef.current && window.turnstile)
        window.turnstile.reset(widgetIdRef.current);
      else setAttempt((current) => current + 1);
    } catch {
      setAttempt((current) => current + 1);
    }
  }, [resetSignal]);

  useEffect(() => {
    const retryFailed = () => {
      if (failedRef.current) setAttempt((current) => current + 1);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") retryFailed();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setAttempt((current) => current + 1);
    };
    window.addEventListener("online", retryFailed);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("online", retryFailed);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return (
    <div className="mt-5 min-w-0">
      <div
        ref={containerRef}
        className="min-h-[65px] w-full min-w-0 overflow-hidden"
        aria-label="Cloudflare 人機安全驗證"
      />
      {loading && (
        <p className="mb-0 mt-2 text-[13px] text-muted" role="status">
          正在載入安全驗證…
        </p>
      )}
      {loadError && (
        <div className="mt-2">
          <ErrorMessage className="mb-2 text-[13px] text-danger">
            {loadError}
          </ErrorMessage>
          <button
            type="button"
            className="outline min-h-11 text-[13px]"
            onClick={() => setAttempt((current) => current + 1)}
          >
            重新驗證
          </button>
        </div>
      )}
    </div>
  );
}
