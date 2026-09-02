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
import { Product, Order } from "@/lib/types";
import {
  PACKING_SCAN_ERROR_MESSAGES,
  PRODUCT_SKU_PATTERN,
  QR_TOKEN_PATTERN,
} from "@/lib/config";
import { createClient } from "@/utils/supabase/client";
import { DataState } from "./DataState";
import { extractQrToken } from "@/lib/public-qr";

type PackingScanResult = {
  valid: boolean;
  reason: string;
  sku: string | null;
};

/** 掃碼出貨面板。 */
export function PackingPanel({
  onBack,
  order,
  products,
  onCompleted,
  packerName,
}: {
  onBack: () => void;
  order: Order;
  products: Product[];
  onCompleted?: () => void;
  packerName: string;
}) {
  const [scanned, setScanned] = useState<string[]>(() => [...order.packedIds]);
  const scannedRef = useRef<string[]>([...order.packedIds]);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<"ok" | "bad" | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
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

  const loadScanProgress = useCallback(async () => {
    setProgressLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("order_items")
      .select("quantity,scanned_quantity,products(sku)")
      .eq("order_id", order.dbId);

    if (error) {
      setCameraError(`讀取核對進度失敗：${error.message}`);
      setProgressLoading(false);
      return;
    }

    const restored = data?.flatMap((item: any) =>
      Array.from(
        {
          length: Math.min(item.scanned_quantity, item.quantity),
        },
        () => item.products?.sku,
      ).filter(Boolean),
    );
    if (!restored) {
      setCameraError("讀取核對進度失敗，請重新整理後再試。");
      setProgressLoading(false);
      return;
    }

    scannedRef.current = restored;
    setScanned(restored);
    setProgressLoading(false);
  }, [order.dbId]);

  const scan = useCallback(
    async (raw: string) => {
      if (verifyingRef.current) return;

      const value = extractQrToken(raw);
      const isQrToken = QR_TOKEN_PATTERN.test(value);
      const isProductSku = PRODUCT_SKU_PATTERN.test(value);
      if (!isQrToken && !isProductSku) {
        setFeedback("bad");
        setFeedbackMessage("請輸入 A000004 格式的商品 ID 或掃描 QR Code");
        navigator.vibrate?.([200, 100, 200]);
        return;
      }

      verifyingRef.current = true;
      setIsVerifying(true);
      setInput("");
      setCameraError("");

      try {
        const supabase = createClient();
        const response = isProductSku
          ? await supabase.rpc("consume_product_sku", {
              p_sku: value.toUpperCase(),
              p_order_id: order.dbId,
            })
          : await supabase.rpc("consume_product_qr", {
              p_token: value,
              p_order_id: order.dbId,
            });
        const result = response.data?.[0] as PackingScanResult | undefined;

        if (!response.error && result?.valid && result.sku) {
          const next = [...scannedRef.current, result.sku];
          scannedRef.current = next;
          setScanned(next);
          setFeedback("ok");
          setFeedbackMessage(
            isProductSku ? "已使用商品 ID 人工核對" : "已加入本訂單",
          );
          navigator.vibrate?.(100);
          return;
        }

        setFeedback("bad");
        setFeedbackMessage(
          response.error
            ? `核對失敗：${response.error.message}`
            : PACKING_SCAN_ERROR_MESSAGES[result?.reason || ""] ||
                "此商品無法核對",
        );
        navigator.vibrate?.([200, 100, 200]);
      } finally {
        verifyingRef.current = false;
        setIsVerifying(false);
      }
    },
    [order.dbId],
  );

  async function completePacking() {
    stopCamera();
    const supabase = createClient();
    const { error } = await supabase.rpc("complete_order_packing", {
      p_order_id: order.dbId,
    });
    if (error) {
      setCameraError(
        error.code === "PGRST202"
          ? "完成包裝功能尚未安裝，請先執行 complete-order-packing-migration.sql。"
          : `完成包裝失敗：${error.message}`,
      );
      return;
    }
    setDone(true);
    onCompleted?.();
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
    const cached = [...order.packedIds];
    scannedRef.current = cached;
    setScanned(cached);
    void loadScanProgress();
  }, [loadScanProgress, order.packedIds]);
  useEffect(() => () => stopCamera(), [stopCamera]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => {
      setFeedback(null);
      setFeedbackMessage("");
    }, 2200);
    return () => clearTimeout(timer);
  }, [feedback]);

  if (done)
    return (
      <div className="packing-success">
        <span>
          <CheckCircle2 />
        </span>
        <h1>包裝核對完成</h1>
        <p>
          {order.id} 的 {order.itemIds.length} 件商品已全部掃描正確。
        </p>
        <div>
          <b>包貨人</b>
          <span>{packerName}</span>
          <b>完成時間</b>
          <span>剛剛</span>
        </div>
        <button className="primary" onClick={onBack}>
          回到總覽
        </button>
      </div>
    );

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
          <span className="eyebrow">掃碼出貨</span>
          <h1>{order.id}</h1>
        </div>
        <span className="pill amber">包貨中</span>
      </div>
      <div className="packing-grid">
        <section>
          <div className="customer">
            <div>
              <small>收件人</small>
              <h2>{order.customer}</h2>
            </div>
            <div>
              <small>完成進度</small>
              <h2>
                <em>{scanned.length}</em> / {order.itemIds.length}
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
                <p>{feedbackMessage || "已加入本訂單"}</p>
              </div>
            ) : feedback === "bad" ? (
              <div className="feedback">
                <XCircle />
                <h2>商品錯誤</h2>
                <p>{feedbackMessage || "此商品不屬於本訂單或已掃描"}</p>
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
                <h2>掃描下一件商品</h2>
                <p>將商品 QR Code 對準鏡頭</p>
                <button
                  className="scan-button"
                  onClick={startCamera}
                  disabled={cameraStarting || progressLoading}
                >
                  <Camera />
                  {progressLoading ? "正在讀取進度…" : "開啟相機掃描"}
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
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isVerifying) {
                  stopCamera();
                  void scan(input);
                }
              }}
              disabled={isVerifying || progressLoading}
            />
            <button
              disabled={isVerifying || progressLoading || !input.trim()}
              onClick={() => {
                stopCamera();
                void scan(input);
              }}
            >
              {isVerifying ? "核對中…" : "確認"}
            </button>
          </div>
          <p className="mt-2 text-[12px] text-[#6B7280]">
            手動輸入會記錄為人工核對，並使其中一張未使用標籤失效。
          </p>
        </section>
        <section className="packing-items">
          <div className="card-head">
            <div>
              <h2>訂單商品</h2>
              <p>請逐件掃描，全部正確才能完成</p>
            </div>
          </div>
          <DataState
            loading={progressLoading}
            isEmpty={order.itemIds.length === 0 || products.length === 0}
            loadingText="正在讀取訂單商品…"
            emptyText="這筆訂單沒有可包裝的商品"
            className="compact-empty"
          >
            {order.itemIds.map((id, index) => {
            const product = products.find((item) => item.id === id)!;
            const occurrence = order.itemIds
              .slice(0, index + 1)
              .filter((item) => item === id).length;
            const checked =
              scanned.filter((item) => item === id).length >= occurrence;
            return (
              <div
                className={`pack-item ${checked ? "checked" : ""}`}
                key={`${id}-${index}`}
              >
                <span className="check">{checked ? <Check /> : null}</span>
                <span className="thumb" style={{ background: product.accent }}>
                  {product.work[0]}
                </span>
                <div>
                  <code>{id}</code>
                  <b>{product.work}</b>
                  <small>
                    {product.format} · {product.size} · {product.location}
                  </small>
                </div>
                {checked ? (
                  <span className="done-label">已核對</span>
                ) : (
                  <span className="wait-label">等待掃描</span>
                )}
              </div>
            );
            })}
          </DataState>
          <button
            className="complete"
            disabled={
              progressLoading || scanned.length !== order.itemIds.length
            }
            onClick={() => void completePacking()}
          >
            <PackageCheck />
            完成包裝
          </button>
          <p className="complete-help">
            {progressLoading
              ? "正在讀取已核對進度"
              : scanned.length === order.itemIds.length
                ? "全部正確，可以完成包裝"
                : "需掃描全部商品後才能完成"}
          </p>
        </section>
      </div>
    </div>
  );
}
