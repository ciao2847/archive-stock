"use client";

import { Spinner } from "@/components/ui/Spinner";

import { LoadingState } from "@/components/ui/LoadingState";
import { useEffect, useState } from "react";
import { Bell, BellOff, Check, Send } from "lucide-react";

type Device = { id: string; endpoint: string; inventory_ids: string[] };
type Settings = {
  configured: boolean;
  publicKey: string | null;
  subscriptions: Device[];
};
async function pushRequest(path: string, method = "GET", body?: unknown) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok || !result.success)
    throw new Error(result.error || "通知設定無法讀取");
  return result.data;
}
function applicationKey(value: string) {
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}
export function PushNotificationSettings({
  inventories,
  isAdmin,
}: {
  inventories: Array<{ id: string; name: string }>;
  isAdmin: boolean;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [supported, setSupported] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const active = Boolean(
    subscription &&
      settings?.subscriptions.some(
        (device) => device.endpoint === subscription.endpoint,
      ),
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ios =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const canPush =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      if (cancelled) return;
      setNeedsInstall(ios && !standalone);
      setSupported(canPush);
      if ("Notification" in window) setPermission(Notification.permission);
      try {
        const data: Settings = await pushRequest("/api/push/subscriptions");
        let sub: PushSubscription | null = null;
        if (canPush && !(ios && !standalone)) {
          const registration = await navigator.serviceWorker.register(
            "/sw.js",
            { scope: "/", updateViaCache: "none" },
          );
          sub = await registration.pushManager.getSubscription();
        }
        if (cancelled) return;
        setSettings(data);
        setSubscription(sub);
        const device = data.subscriptions.find(
          (item) => item.endpoint === sub?.endpoint,
        );
        const permitted = inventories.map((item) => item.id);
        const saved = device?.inventory_ids.filter((id) =>
          permitted.includes(id),
        );
        setSelected(saved?.length ? saved : permitted);
      } catch (error) {
        if (!cancelled)
          setMessage(
            error instanceof Error ? error.message : "通知設定讀取失敗",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inventories]);
  async function enable() {
    if (!settings?.publicKey || busy) return;
    setBusy(true);
    setMessage("");
    try {
      // Permission is requested only as a direct result of tapping this button.
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted")
        throw new Error(
          "尚未允許通知。請到手機或瀏覽器的網站通知設定開啟權限。",
        );
      await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const sub =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationKey(settings.publicKey),
        }));
      setSubscription(sub);
      const json = sub.toJSON();
      try {
        await pushRequest("/api/push/subscriptions", "POST", {
          endpoint: sub.endpoint,
          keys: json.keys,
          inventoryIds: selected,
        });
      } catch (error) {
        if (!existing) {
          await sub.unsubscribe();
          setSubscription(null);
        }
        throw error;
      }
      setSettings(await pushRequest("/api/push/subscriptions"));
      setMessage("已開啟這台裝置的新訂購通知。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "開啟通知失敗");
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    if (busy || !subscription) return;
    setBusy(true);
    setMessage("");
    try {
      await pushRequest("/api/push/subscriptions", "DELETE", {
        endpoint: subscription.endpoint,
      });
      await subscription.unsubscribe();
      setSubscription(null);
      setSettings(await pushRequest("/api/push/subscriptions"));
      setMessage("已關閉這台裝置的通知，其他裝置不受影響。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "關閉通知失敗");
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    if (!subscription || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await pushRequest("/api/push/test", "POST", {
        endpoint: subscription.endpoint,
      });
      setMessage("測試通知已送出，請查看手機通知中心。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "測試通知失敗");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card col-[1/-1] p-5 sm:p-6" aria-label="手機通知設定">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
          <Bell size={21} />
        </span>
        <div>
          <span className="eyebrow">新訂購提醒</span>
          <h2 className="mb-1 mt-1 text-[19px]">手機通知</h2>
          <p className="m-0 text-[13px] leading-6 text-muted">
            接收新訂購與配單確認通知。
          </p>
        </div>
      </div>
      {loading ? (
        <LoadingState text="正在讀取通知設定…" className="mt-4" />
      ) : (
        <>
          {needsInstall ? (
            <div className="mt-4 rounded-lg bg-primary-soft p-4 text-sm leading-7">
              iPhone／iPad 請先在 Safari
              開啟本站，按「分享」→「加入主畫面」，再從主畫面圖示開啟庫藏並允許通知。
            </div>
          ) : !supported ? (
            <p className="mt-4 text-sm text-muted">
              此瀏覽器尚不支援手機通知，請使用更新版本的 Safari、Chrome 或
              Firefox。
            </p>
          ) : (
            <>
              {!settings?.configured ? (
                <p className="mt-4 text-sm text-muted">
                  通知服務尚未就緒，請稍後再試。
                </p>
              ) : (
                <>
                  <p className="mt-4 flex items-center gap-2 text-sm">
                    {active ? (
                      <>
                        <Check size={16} className="text-green" />
                        這台裝置已開啟通知
                      </>
                    ) : (
                      <>
                        <BellOff size={16} />
                        這台裝置尚未開啟通知
                      </>
                    )}
                  </p>
                  {permission === "denied" && (
                    <p className="text-sm text-muted">
                      通知權限已被封鎖。請先到手機或瀏覽器設定允許此網站發送通知。
                    </p>
                  )}
                  {isAdmin ? (
                    <fieldset className="mt-4 border-0 p-0" disabled={busy}>
                      <legend className="mb-2 text-[13px] font-semibold">
                        接收哪些庫藏的通知
                      </legend>
                      <div className="flex flex-wrap gap-3">
                        {inventories.map((inventory) => (
                          <label
                            key={inventory.id}
                            className="flex items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={selected.includes(inventory.id)}
                              onChange={(event) =>
                                setSelected((current) =>
                                  event.target.checked
                                    ? [...current, inventory.id]
                                    : current.filter(
                                        (id) => id !== inventory.id,
                                      ),
                                )
                              }
                            />
                            {inventory.name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <p className="text-sm text-muted">
                      只接收自己所屬庫藏的訂購通知。
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void enable()}
                      disabled={
                        busy || !selected.length || permission === "denied"
                      }
                    >
                      {busy ? <Spinner size={16} /> : <Bell size={16} />}{" "}
                      {active ? "儲存通知設定" : "開啟手機通知"}
                    </button>
                    {active && (
                      <button
                        type="button"
                        className="outline"
                        onClick={() => void test()}
                        disabled={busy}
                      >
                        <Send size={16} />
                        傳送測試通知
                      </button>
                    )}
                    {subscription && (
                      <button
                        type="button"
                        className="outline"
                        onClick={() => void disable()}
                        disabled={busy}
                      >
                        <BellOff size={16} />
                        關閉這台裝置通知
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
      {message && (
        <p
          className="mb-0 mt-4 rounded-lg bg-light p-3 text-[13px] leading-6"
          role="status"
        >
          {message}
        </p>
      )}
    </section>
  );
}
