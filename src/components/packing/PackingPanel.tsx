"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import {
  ArrowLeft,
  Camera,
  CameraOff,
  Check,
  CheckCircle2,
  Keyboard,
  PackageCheck,
  ScanLine,
  XCircle,
} from "lucide-react";
import { PACKING_SCAN_ERROR_MESSAGES } from "@/constants";
import type { Product } from "@/lib/types";
import {
  completePackingPackage,
  fetchPackingPackage,
  scanPackingPackage,
  startPackingPackage,
  type PackingCompletion,
  type PackingPackage,
} from "@/lib/api/packing";
import type { PackingCustomer } from "./PackingQueue";
import { DataState } from "@/components/ui/DataState";

type Feedback = "ok" | "bad" | null;

/** 以客人為單位的合併包貨面板。 */
export function PackingPanel({
  onBack,
  customer,
  products,
  onCompleted,
  packerName,
}: {
  onBack: () => void;
  customer: PackingCustomer;
  products: Product[];
  onCompleted?: () => void;
  packerName: string;
}) {
  const [packageData, setPackageData] = useState<PackingPackage | null>(null);
  const [completion, setCompletion] = useState<PackingCompletion | null>(null);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [done, setDone] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraStarting, setCameraStarting] = useState(false);
  const [progressLoading, setProgressLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const scanLockedRef = useRef(false);
  const verifyingRef = useRef(false);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream)
        .getTracks()
        .forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraOpen(false);
    setCameraStarting(false);
  }, []);

  const loadPackage = useCallback(async () => {
    setProgressLoading(true);
    setCameraError("");
    try {
      const created = await startPackingPackage(customer.ownerId, customer.key);
      setPackageData(created);
    } catch (error) {
      setCameraError(
        error instanceof Error
          ? error.message
          : "建立包貨工作失敗，請重新整理後再試。",
      );
    } finally {
      setProgressLoading(false);
    }
  }, [customer.key, customer.ownerId]);

  const refreshPackage = useCallback(async (packageId: string) => {
    try {
      const refreshed = await fetchPackingPackage(packageId);
      setPackageData(refreshed);
    } catch (error) {
      setCameraError(
        error instanceof Error
          ? error.message
          : "讀取包貨進度失敗，請稍後再試。",
      );
    }
  }, []);

  const scan = useCallback(
    async (raw: string) => {
      if (verifyingRef.current || !packageData) return;

      const value = raw.trim();
      if (!value) {
        setFeedback("bad");
        setFeedbackMessage("請輸入商品 ID 或掃描 QR Code");
        navigator.vibrate?.([200, 100, 200]);
        return;
      }

      verifyingRef.current = true;
      setIsVerifying(true);
      setInput("");
      setCameraError("");

      try {
        const { result, method } = await scanPackingPackage(
          packageData.id,
          value,
        );

        if (result.valid && result.sku) {
          await refreshPackage(packageData.id);
          setFeedback("ok");
          setFeedbackMessage(
            method === "manual_sku"
              ? `已人工核對，加入 ${result.orderNo ?? "此客人"}`
              : `已加入 ${result.orderNo ?? "此客人"} 的合併包裹`,
          );
          navigator.vibrate?.(100);
          return;
        }

        setFeedback("bad");
        setFeedbackMessage(
          PACKING_SCAN_ERROR_MESSAGES[result.reason] || "此商品無法核對",
        );
        navigator.vibrate?.([200, 100, 200]);
      } catch (error) {
        setFeedback("bad");
        setFeedbackMessage(
          error instanceof Error ? error.message : "核對失敗，請稍後再試",
        );
        navigator.vibrate?.([200, 100, 200]);
      } finally {
        verifyingRef.current = false;
        setIsVerifying(false);
      }
    },
    [packageData, refreshPackage],
  );

  async function completePacking() {
    if (!packageData || packageData.scannedCount < 1 || isCompleting) return;
    const confirmed = window.confirm(
      `確定要完成本次包裝嗎？\n\n將完成已掃描的 ${packageData.scannedCount} 件商品；尚未到貨的品項會保留在原訂單。`,
    );
    if (!confirmed) return;

    setIsCompleting(true);
    stopCamera();
    try {
      const result = await completePackingPackage(packageData.id);
      setCompletion(result);
      setDone(true);
      onCompleted?.();
    } catch (error) {
      setCameraError(
        error instanceof Error ? error.message : "完成包裝失敗，請稍後再試",
      );
    } finally {
      setIsCompleting(false);
    }
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "此瀏覽器不支援相機，請使用 Safari 或 Chrome 開啟 HTTPS 網站。",
      );
      return;
    }
    setCameraError("");
    setCameraStarting(true);
    setCameraOpen(true);
    scanLockedRef.current = false;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    if (!videoRef.current) {
      setCameraError("相機畫面初始化失敗");
      setCameraStarting(false);
      return;
    }
    try {
      const reader = new BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 150,
      });
      controlsRef.current = await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        videoRef.current,
        (result) => {
          if (!result || scanLockedRef.current) return;
          scanLockedRef.current = true;
          const value = result.getText();
          stopCamera();
          void scan(value);
        },
      );
      setCameraStarting(false);
    } catch (error) {
      stopCamera();
      const name = error instanceof DOMException ? error.name : "";
      setCameraError(
        name === "NotAllowedError"
          ? "相機權限被拒絕。請到瀏覽器網站設定允許相機後再試。"
          : name === "NotFoundError"
            ? "找不到可使用的相機。"
            : "無法開啟相機，請確認權限或改用手動輸入。",
      );
    }
  }

  useEffect(() => {
    setPackageData(null);
    setCompletion(null);
    setDone(false);
    void loadPackage();
  }, [loadPackage]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => {
      setFeedback(null);
      setFeedbackMessage("");
    }, 2200);
    return () => clearTimeout(timer);
  }, [feedback]);

  if (done && completion)
    return (
      <div className="packing-success">
        <span>
          <CheckCircle2 />
        </span>
        <h1>合併包裝完成</h1>
        <p>
          {completion.packageNo} 已包裝 {completion.itemCount} 件商品，涵蓋{" "}
          {completion.orderCount} 筆訂單。
        </p>
        <div>
          <b>收件人</b>
          <span>{packageData?.customerName || customer.name}</span>
          <b>本次完成訂單</b>
          <span>
            {completion.fullyPackedOrderCount} / {completion.orderCount} 筆
          </span>
          <b>包貨人</b>
          <span>{packerName}</span>
        </div>
        <p className="complete-help">
          尚未到貨的品項仍保留在原訂單，之後可以再建立下一個包裹。
        </p>
        <button className="primary" onClick={onBack}>
          回到總覽
        </button>
      </div>
    );

  const packageItems =
    packageData?.orders.flatMap((order) =>
      order.items.map((item) => ({ ...item, orderNo: order.orderNo })),
    ) ?? [];
  const packageOrders = packageData?.orders ?? [];
  const productById = new Map(
    products
      .filter((product) => product.dbId)
      .map((product) => [product.dbId as string, product]),
  );
  const customerName = packageData?.customerName || customer.name;
  const scannedCount = packageData?.scannedCount ?? 0;

  return (
    <div className="packing">
      <div className="packing-top">
        <button
          className="icon-btn"
          onClick={() => {
            stopCamera();
            onBack();
          }}
        >
          <ArrowLeft />
        </button>
        <div>
          <span className="eyebrow">依客人合併包貨</span>
          <h1>{packageData?.packageNo || "建立包裝工作"}</h1>
        </div>
        <span className="pill amber">包貨中</span>
      </div>
      <div className="packing-grid">
        <section>
          <div className="customer">
            <div>
              <small>收件人</small>
              <h2>{customerName}</h2>
              <small>{customer.orders.length} 筆訂單可合併</small>
            </div>
            <div>
              <small>本次包裝</small>
              <h2>
                <em>{scannedCount}</em> 件
              </h2>
            </div>
          </div>
          <div
            className={`scanner ${feedback || ""} ${cameraOpen ? "camera-active" : ""}`}
          >
            {cameraOpen && (
              <video
                ref={videoRef}
                className="scanner-video"
                autoPlay
                muted
                playsInline
              />
            )}
            <div className="corners">
              <ScanLine />
            </div>
            {feedback === "ok" ? (
              <div className="feedback">
                <CheckCircle2 />
                <h2>商品正確</h2>
                <p>{feedbackMessage || "已加入合併包裹"}</p>
              </div>
            ) : feedback === "bad" ? (
              <div className="feedback">
                <XCircle />
                <h2>商品錯誤</h2>
                <p>{feedbackMessage || "此商品不屬於這位客人或已完成核對"}</p>
              </div>
            ) : cameraOpen ? (
              <div className="camera-status">
                <p>
                  {cameraStarting ? "正在開啟相機…" : "請將 QR Code 放入框內"}
                </p>
                <button className="camera-close" onClick={stopCamera}>
                  <CameraOff />
                  關閉相機
                </button>
              </div>
            ) : (
              <>
                <Camera size={34} />
                <h2>掃描已到貨商品</h2>
                <p>掃到的商品會自動歸入最早的未出貨訂單</p>
                <button
                  className="scan-button"
                  onClick={startCamera}
                  disabled={cameraStarting || progressLoading || !packageData}
                >
                  <Camera />
                  {progressLoading ? "正在建立包貨工作…" : "開啟相機掃描"}
                </button>
              </>
            )}
          </div>
          {cameraError && (
            <div className="camera-error">
              <XCircle />
              {cameraError}
            </div>
          )}
          <div className="manual">
            <Keyboard size={18} />
            <input
              placeholder="輸入商品 ID，例如 A000004"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !isVerifying) {
                  stopCamera();
                  void scan(input);
                }
              }}
              disabled={isVerifying || progressLoading || !packageData}
            />
            <button
              disabled={
                isVerifying || progressLoading || !input.trim() || !packageData
              }
              onClick={() => {
                stopCamera();
                void scan(input);
              }}
            >
              {isVerifying ? "核對中…" : "確認"}
            </button>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            只要商品已到貨就能先包裝，不需要等同一張訂單全部到齊。
          </p>
        </section>
        <section className="packing-items">
          <div className="card-head">
            <div>
              <h2>客人訂單商品</h2>
              <p>已出貨數量會保留，未到貨品項下次再處理</p>
            </div>
          </div>
          <DataState
            loading={progressLoading}
            isEmpty={packageItems.length === 0}
            loadingText="正在讀取客人訂單…"
            emptyText="這位客人目前沒有可包裝的商品"
            className="compact-empty"
          >
            {packageOrders.map((order) => (
              <div className="packing-order-group" key={order.orderId}>
                <div className="packing-order-divider">
                  <span>{order.orderNo}</span>
                  <small>{order.status}</small>
                </div>
                {order.items.map((item) => {
                  const product = productById.get(item.productId);
                  const outstanding = Math.max(
                    item.quantity - item.packedQuantity,
                    0,
                  );
                  const checked = item.packageQuantity > 0;
                  return (
                    <div
                      className={`pack-item ${checked ? "checked" : ""}`}
                      key={item.orderItemId}
                    >
                      <span className="check">
                        {checked ? <Check /> : null}
                      </span>
                      <span
                        className="thumb"
                        style={{
                          background:
                            product?.accent || "var(--color-primary-soft)",
                        }}
                      >
                        {product?.work?.[0] || item.name?.[0] || "品"}
                      </span>
                      <div>
                        <code>{item.sku}</code>
                        <b>{item.name || product?.work || "商品"}</b>
                        <small>
                          已出貨 {item.packedQuantity} · 本次{" "}
                          {item.packageQuantity} · 尚缺{" "}
                          {Math.max(outstanding - item.packageQuantity, 0)}
                        </small>
                      </div>
                      {item.packageQuantity > 0 ? (
                        <span className="done-label">
                          本次 {item.packageQuantity}
                        </span>
                      ) : item.packedQuantity >= item.quantity ? (
                        <span className="done-label">已完成</span>
                      ) : (
                        <span className="wait-label">等待到貨</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </DataState>
          <button
            className="complete"
            disabled={progressLoading || scannedCount < 1 || isCompleting}
            onClick={() => void completePacking()}
          >
            <PackageCheck />
            {isCompleting ? "正在完成包裝…" : "完成本次包裝"}
          </button>
          <p className="complete-help">
            {progressLoading
              ? "正在讀取包貨進度"
              : scannedCount > 0
                ? `可先完成這 ${scannedCount} 件，未到貨品項會留在原訂單`
                : "先掃描已到貨商品，再完成本次包裝"}
          </p>
        </section>
      </div>
    </div>
  );
}
