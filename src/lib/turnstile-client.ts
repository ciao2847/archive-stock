import { CLAIM_TURNSTILE_ACTION } from "./turnstile-config";

export type TurnstileRenderOptions = {
  sitekey: string;
  action: typeof CLAIM_TURNSTILE_ACTION;
  appearance: "always";
  execution: "render";
  language: string;
  retry: "auto";
  "refresh-expired": "auto";
  "refresh-timeout": "auto";
  size: "flexible";
  theme: "light";
  "response-field": false;
  callback: (token: string) => void;
  "error-callback": (code?: string) => boolean;
  "expired-callback": () => void;
  "timeout-callback": () => void;
};
export type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}
const SCRIPT_ID = "cloudflare-turnstile-script";
const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

/** Share the SDK across forms, but allow the same URL to be fetched again after
 * a failed load. next/script caches its rejected load and cannot do that. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.getElementById(
      SCRIPT_ID,
    ) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const cleanup = () => {
      clearTimeout(timer);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
    };
    const failed = () => {
      cleanup();
      script.remove();
      reject(new Error("安全驗證連線失敗，請重試驗證。"));
    };
    const loaded = () => {
      if (!window.turnstile) return failed();
      cleanup();
      resolve(window.turnstile);
    };
    const timer = window.setTimeout(failed, 15_000);
    script.addEventListener("load", loaded);
    script.addEventListener("error", failed);
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  // Only an in-flight request is shared. A failed attempt must not poison
  // retries; after success window.turnstile is the source of truth.
  void loading.then(
    () => {
      loading = null;
    },
    () => {
      loading = null;
    },
  );
  return loading;
}
