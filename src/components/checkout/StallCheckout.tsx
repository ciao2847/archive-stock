"use client";

import { ErrorMessage } from "@/components/ui/ErrorMessage";

import { useBackAction } from "@/components/navigation/BackNavigation";
import { useEffect, useId, useRef, useState } from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import {
  ShoppingCart,
  ShoppingBag,
  Camera,
  CameraOff,
  CheckCircle2,
  Keyboard,
  ScanLine,
  Trash2,
  XCircle,
} from "lucide-react";
import { readApiResponse } from "@/lib/api/http-client";
import { extractQrToken } from "@/lib/public-qr";

type CartItem = {
  token: string;
  productId: string;
  sku: string;
  name: string;
  listPrice: number;
  stock: number;
};
type Receipt = { orderId: string; orderNo: string; total: number };
const money = (amount: number) => `NT$ ${amount.toLocaleString("zh-TW")}`;

export function StallCheckout({
  ownerId,
  onCompleted,
  onBack,
}: {
  ownerId: string;
  onCompleted: () => void;
  onBack?: () => void;
}) {
  const productInputId = useId();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [input, setInput] = useState("");
  const [cash, setCash] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [scanSuccess, setScanSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const busyRef = useRef(false);
  const scanRef = useRef<(raw: string) => Promise<void>>(async () => {});
  const total =
    Math.round(cart.reduce((sum, item) => sum + item.listPrice, 0) * 100) / 100;
  const received = cash.trim() === "" ? total : Number(cash);
  const enoughCash = Number.isFinite(received) && received >= total;

  useBackAction({
    enabled: Boolean(onBack),
    disabled: busy,
    priority: 20,
    onBack: () => {
      if (busy) return;
      if (
        cart.length > 0 &&
        !window.confirm("尚有未結帳商品，返回會清空購物車，確定返回？")
      )
        return;
      setCameraOpen(false);
      onBack?.();
    },
  });
  async function scan(raw: string) {
    if (busyRef.current || !raw.trim()) return;
    setScanSuccess("");
    if (
      cart.some(
        (item) =>
          item.token.toLowerCase() === extractQrToken(raw).toLowerCase(),
      )
    ) {
      setMessage("這張商品碼已在購物車，請掃描下一件商品。");
      return;
    }
    if (cart.length >= 100) {
      setMessage("每筆最多 100 件，請先結帳。");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const query = new URLSearchParams({ ownerId, value: raw.trim() });
      cart.forEach((item) => query.append("excludeToken", item.token));
      const response = await fetch(`/api/checkout?${query}`, {
        cache: "no-store",
      });
      const item = await readApiResponse<CartItem>(response);
      if (
        cart.some(
          (entry) => entry.token.toLowerCase() === item.token.toLowerCase(),
        )
      )
        throw new Error(
          "這件商品已在購物車，請輸入商品編號加入下一件，或掃描其他商品碼。",
        );
      if (
        cart.filter((entry) => entry.productId === item.productId).length >=
        item.stock
      ) {
        throw new Error("購物車內此商品的件數已達目前庫存。");
      }
      setCart((current) => [...current, item]);
      setScanSuccess(`${item.name} · 定價 ${money(item.listPrice)}`);
      setInput("");
      setReceipt(null);
      setCash("");
      navigator.vibrate?.(100);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加入商品失敗");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    scanRef.current = scan;
  });
  useEffect(() => {
    if (!cameraOpen || !videoRef.current) return;
    let cancelled = false;
    let scanned = false;
    let controls: IScannerControls | undefined;
    const video = videoRef.current;
    const reader = new BrowserQRCodeReader();
    void reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        video,
        (result) => {
          if (!result || cancelled || scanned || busyRef.current) return;
          scanned = true;
          setCameraOpen(false);
          void scanRef.current(result.getText());
        },
      )
      .then((started) => {
        controls = started;
        if (cancelled || scanned) started.stop();
      })
      .catch(() => {
        if (cancelled) return;
        setMessage(
          "無法開啟相機，請允許相機權限並使用 HTTPS，或手動輸入商品編號。",
        );
        setCameraOpen(false);
      });
    return () => {
      cancelled = true;
      controls?.stop();
      (video.srcObject as MediaStream | null)
        ?.getTracks()
        .forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [cameraOpen]);

  async function checkout() {
    if (busyRef.current || !cart.length || !enoughCash) return;
    busyRef.current = true;
    setBusy(true);
    setCameraOpen(false);
    setMessage("");
    setScanSuccess("");
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerId,
          tokens: cart.map((item) => item.token),
          expectedTotal: total,
        }),
      });
      const result = await readApiResponse<Receipt>(response);
      setReceipt(result);
      setCart([]);
      setCash("");
      onCompleted();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "結帳失敗，購物車已保留，請重試。",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="packing stall-checkout" aria-label="攤位掃碼結帳">
      <div className="packing-top stall-checkout-top">
        <div>
          <span className="eyebrow">現場商品結帳</span>
          <h1>{receipt ? receipt.orderNo : "攤位結帳"}</h1>
        </div>
        <span className={receipt ? "pill green" : "pill amber"}>
          {receipt ? "結帳完成" : "結帳中"}
        </span>
      </div>
      {receipt && (
        <div role="status" className="stall-receipt">
          <CheckCircle2 size={20} />
          <div>
            <b>結帳完成 · {receipt.orderNo}</b>
            <p>已收款 {money(receipt.total)}，庫存已扣除。</p>
          </div>
        </div>
      )}
      <div className="packing-grid stall-checkout-grid">
        <section className="stall-scan-column" aria-label="商品掃碼區">
          <div className="stall-scan-summary">
            <div className="stall-scan-stats">
              <div>
                <small>結帳方式</small>
                <h2>掃碼或輸入商品編號</h2>
              </div>
              <div>
                <small>已加入商品</small>
                <h2>
                  <em>{cart.length}</em> 件
                </h2>
              </div>
            </div>
          </div>
          <div
            className={`scanner ${message ? "bad" : scanSuccess ? "ok" : ""} ${cameraOpen ? "camera-active" : ""}`}
          >
            {cameraOpen && (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="scanner-video"
                aria-label="商品掃碼相機"
                onLoadedData={() => setCameraReady(true)}
              />
            )}
            <div className="corners" aria-hidden="true">
              <ScanLine />
            </div>
            {cameraOpen ? (
              <div className="camera-status">
                <p>{cameraReady ? "掃描中…" : "正在開啟相機…"}</p>
                <button
                  type="button"
                  className="camera-close"
                  onClick={() => setCameraOpen(false)}
                >
                  <CameraOff />
                  關閉相機
                </button>
              </div>
            ) : message ? (
              <ErrorMessage className="feedback px-5 [&>svg]:mx-auto" as="div">
                <XCircle />
                <h2>操作未完成</h2>
                <p>{message}</p>
                <button
                  type="button"
                  className="scan-button"
                  disabled={busy}
                  onClick={() => {
                    setMessage("");
                    setCameraReady(false);
                    setCameraOpen(true);
                  }}
                >
                  <Camera />
                  繼續掃描
                </button>
              </ErrorMessage>
            ) : scanSuccess ? (
              <div className="feedback px-5 [&>svg]:mx-auto" role="status">
                <CheckCircle2 />
                <h2>已加入購物車</h2>
                <p>{scanSuccess}</p>
                <button
                  type="button"
                  className="scan-button"
                  disabled={busy}
                  onClick={() => {
                    setScanSuccess("");
                    setCameraReady(false);
                    setCameraOpen(true);
                  }}
                >
                  <Camera />
                  掃描下一件商品
                </button>
              </div>
            ) : (
              <div className="feedback px-5 [&>svg]:mx-auto">
                <Camera size={34} />
                <h2>掃描結帳商品</h2>
                <button
                  type="button"
                  className="scan-button"
                  disabled={busy}
                  onClick={() => {
                    setCameraReady(false);
                    setCameraOpen(true);
                  }}
                >
                  <Camera />
                  開啟相機掃描
                </button>
              </div>
            )}
          </div>
          <label
            htmlFor={productInputId}
            className="mb-2 mt-4 block text-[13px] font-semibold"
          >
            商品編號
          </label>
          <form
            className="manual"
            onSubmit={(event) => {
              event.preventDefault();
              setCameraOpen(false);
              void scan(input);
            }}
          >
            <Keyboard size={18} />
            <input
              id={productInputId}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="例如 A000038"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={2048}
              disabled={busy}
            />
            <button disabled={busy || !input.trim()}>
              {busy ? "核對中…" : "加入商品"}
            </button>
          </form>
        </section>
        <section className="packing-items stall-cart" aria-label="購物車與結帳">
          <div className="card-head">
            <div>
              <h2>購物車商品</h2>
            </div>
          </div>
          {!cart.length && (
            <div className="stall-cart-empty">
              <ShoppingCart size={34} />
              <p>購物車是空的</p>
            </div>
          )}
          <ul className="stall-cart-list">
            {cart.map((item) => (
              <li key={item.token} className="stall-cart-item">
                <div className="min-w-0 flex-1">
                  <code>{item.sku}</code>
                  <b className="block">{item.name}</b>
                </div>
                <span className="shrink-0">定價 {money(item.listPrice)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`移除 ${item.sku}`}
                  disabled={busy}
                  onClick={() => {
                    setCart((current) =>
                      current.filter((entry) => entry.token !== item.token),
                    );
                    setCash("");
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </li>
            ))}
          </ul>
          <div className="stall-payment">
            <div className="stall-total">
              <span>共 {cart.length} 件 · 應收總額</span>
              <strong>{money(total)}</strong>
            </div>
            <label className="field mt-4">
              <span>現金實收（選填）</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={cash}
                disabled={busy}
                onChange={(event) => setCash(event.target.value)}
                placeholder={String(total)}
              />
            </label>
            {cash !== "" && (
              <p aria-live="polite">
                {enoughCash
                  ? `找零 ${money(Math.round((received - total) * 100) / 100)}`
                  : "實收金額不足"}
              </p>
            )}
            <button
              type="button"
              className="primary stall-pay-button"
              disabled={busy || !cart.length || !enoughCash}
              onClick={() => void checkout()}
            >
              <ShoppingBag size={18} />
              {busy ? "處理中…" : `確認已收款並結帳 ${money(total)}`}
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
