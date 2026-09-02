"use client";

import { useEffect, useState } from "react";
import {
  X,
  MapPin,
  Printer,
  Pencil,
  ShieldCheck,
  ZoomIn,
  Trash2,
  LoaderCircle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Product } from "@/lib/types";
import { deleteProduct as deleteProductApi } from "@/lib/api/products";
import { ImageLightbox } from "./ImageLightbox";
import { createClient } from "@/utils/supabase/client";
import { EditProduct } from "./EditProduct";
import { DataState } from "./DataState";
import { buildPublicQrUrl } from "@/lib/public-qr";

export function ProductPanel({
  product: p,
  onClose,
  onUpdated,
}: {
  product: Product;
  onClose: () => void;
  onUpdated: () => void | Promise<void>;
}) {
  const [preview, setPreview] = useState(false);
  const [editing, setEditing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      setIsAdmin(data?.role === "admin");
    })();
  }, []);

  async function deleteProduct() {
    if (!p.dbId || deleting) return;
    if (
      !window.confirm(
        `確定永久刪除 ${p.id}「${p.name}」？\n\n商品資料、庫存與未使用的 QR Code 都會刪除，這個動作無法復原。`,
      )
    )
      return;

    setDeleting(true);
    try {
      const result = await deleteProductApi(p.dbId);
      await onUpdated();
      onClose();
      window.alert(
        result.imageCleanupWarning || `${p.id} 已成功刪除。`,
      );
    } catch (error) {
      setDeleting(false);
      window.alert(error instanceof Error ? error.message : "商品刪除失敗");
    }
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">商品資料</span>
            <h2>{p.id}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>
        <button
          type="button"
          className={`relative m-6 grid h-[185px] w-[calc(100%-48px)] place-items-center rounded-[9px] border-0 text-[30px] tracking-[0.15em] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1875)] ${p.image ? "cursor-zoom-in overflow-hidden p-0" : ""}`}
          style={{ background: `linear-gradient(145deg,${p.accent},#1C2A3A)` }}
          onClick={() => p.image && setPreview(true)}
        >
          {p.image ? (
            <>
              <ProductImage src={p.image} alt={`${p.work} 商品主圖`} />
              <span className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-black/65 px-3 py-2 text-[12px] tracking-normal text-white">
                <ZoomIn size={15} />
                點擊放大
              </span>
            </>
          ) : (
            <span>{p.work}</span>
          )}
        </button>
        <div className="flex items-start justify-between px-7">
          <div>
            <span className="pill green">{p.status}</span>
            <h2 className="mb-1 mt-3 text-[24px]">{p.work}</h2>
            <p className="m-0 text-muted">{p.name}</p>
          </div>
          <button
            className="icon-btn"
            onClick={() => setEditing(true)}
            aria-label="編輯商品"
          >
            <Pencil size={18} />
          </button>
        </div>
        <div className="mx-7 my-6 grid grid-cols-2 rounded-lg border border-line bg-white max-sm:grid-cols-1">
          <Spec className="border-b border-r max-sm:border-r-0" k="商品類型" v={p.category} />
          <Spec className="border-b" k="國家 / 來源" v={`${p.country} · ${p.source}`} />
          <Spec className="border-b border-r max-sm:border-r-0" k="版本 / 影廳" v={p.format || "—"} />
          <Spec className="border-b" k="尺寸" v={p.size || "—"} />
          <Spec className="border-r max-sm:border-b max-sm:border-r-0" k="工藝" v={p.crafts?.join(" ＋ ") || "—"} />
          <Spec k="庫存數量" v={`${p.stock} 件`} />
        </div>
        <div className="mx-7 my-4 rounded-lg bg-primary-soft p-3">
          <small className="mb-1 block text-[11px] text-muted">辨識特徵</small>
          <p className="m-0">{p.feature || "尚未填寫"}</p>
        </div>
        <div className="mx-7 my-4 flex items-center gap-3 rounded-lg border border-line bg-white p-3">
          <MapPin />
          <div className="flex-1">
            <small className="mb-1 block text-[11px] text-muted">目前庫位</small>
            <strong className="font-mono text-[17px] font-medium">{p.location}</strong>
          </div>
          <button className="border-0 bg-transparent text-rust">移動庫位</button>
        </div>
        {p.dbId && <QrLabels productId={p.dbId} sku={p.id} />}
        {isAdmin && (
          <div className="mx-7 my-4 flex items-center gap-2 text-[11px] text-[#6e716b]">
            <ShieldCheck size={18} />
            成本 NT$ {p.cost.toLocaleString()} 僅管理員可見
          </div>
        )}
        {isAdmin && (
          <button
            type="button"
            className="outline danger mx-6 mt-3 flex w-[calc(100%-48px)] items-center justify-center gap-2"
            onClick={() => void deleteProduct()}
            disabled={deleting}
          >
            {deleting ? (
              <LoaderCircle className="spin" />
            ) : (
              <Trash2 size={17} />
            )}
            {deleting ? "刪除中…" : "刪除商品"}
          </button>
        )}
      </aside>
      {preview && p.image && (
        <ImageLightbox
          src={p.image}
          alt={`${p.work} 商品圖片`}
          label={`${p.id} · ${p.name}`}
          onClose={() => setPreview(false)}
        />
      )}
      {editing && (
        <EditProduct
          product={p}
          isAdmin={isAdmin}
          onClose={() => setEditing(false)}
          onUpdated={async () => {
            await onUpdated();
            onClose();
          }}
        />
      )}
    </>
  );
}

function QrLabels({ productId, sku }: { productId: string; sku: string }) {
  const [labels, setLabels] = useState<
    { token: string; batch_code: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [publicOrigin, setPublicOrigin] = useState("");
  useEffect(() => {
    void (async () => {
      setPublicOrigin(window.location.origin);
      setLoading(true);
      const { data } = await createClient()
        .from("product_qr_labels")
        .select("token,batch_code")
        .eq("product_id", productId)
        .eq("status", "active")
        .order("created_at");
      setLabels(data || []);
      setLoading(false);
    })();
  }, [productId]);
  return (
    <DataState
      loading={loading}
      isEmpty={labels.length === 0}
      loadingText="正在讀取 QR Code…"
      className="mx-7 my-4"
      emptyContent={
      <div className="qr-card mx-7 my-4 flex items-center gap-5 rounded-lg border border-line bg-white p-5 max-sm:items-start">
        <div>
          <small className="mb-1 block text-[11px] text-muted">商品 QR Code</small>
          <strong className="block font-mono text-[18px] font-medium">尚無可用標籤</strong>
          <p className="mb-3 mt-1 text-[11px] text-muted">請先執行 QR token migration。</p>
        </div>
      </div>
      }
    >
      <div>
      {labels?.map((label, index) => (
        <div
          className="qr-card mx-7 my-4 flex items-center gap-5 rounded-lg border border-line bg-white p-5 max-sm:items-start"
          key={label.token}
        >
          <QRCodeSVG
            className="max-sm:h-[90px] max-sm:w-[90px]"
            value={
              publicOrigin
                ? buildPublicQrUrl(label.token, publicOrigin)
                : `AS1:${label.token}`
            }
            size={112}
            level="M"
          />
          <div>
            <small className="mb-1 block text-[11px] text-muted">商品 QR Code · 第 {index + 1} 件</small>
            <strong className="block font-mono text-[18px] font-medium">{sku}</strong>
            <p className="mb-3 mt-1 text-[11px] text-muted">
              批次 {label.batch_code || "未指定"} · 使用後顯示購買通路
            </p>
            <button className="outline" onClick={() => window.print()}>
              <Printer size={16} />
              列印標籤
            </button>
          </div>
        </div>
      ))}
      </div>
    </DataState>
  );
}

function ProductImage({ src, alt }: { src: string; alt: string }) {
  /* eslint-disable-next-line @next/next/no-img-element */
  return (
    <img
      className="block h-full w-full bg-light object-contain"
      src={src}
      alt={alt}
      decoding="async"
    />
  );
}

function Spec({ k, v, className = "" }: { k: string; v: string; className?: string }) {
  return (
    <div className={`border-line p-3 ${className}`}>
      <small className="mb-1 block text-[11px] text-muted">{k}</small>
      <b>{v}</b>
    </div>
  );
}
