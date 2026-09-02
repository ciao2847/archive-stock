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
    const supabase = createClient();
    const { data, error } = await supabase.rpc("delete_inventory_product", {
      p_product_id: p.dbId,
    });

    if (error) {
      setDeleting(false);
      const message = error.message;
      window.alert(
        error.code === "PGRST202"
          ? "刪除功能尚未安裝，請先執行 delete-product-migration.sql。"
          : message.includes("product has order history")
            ? "此商品已有訂單紀錄，為保留出貨歷史不能刪除。"
            : message.includes("product has packing history")
              ? "此商品已有包貨掃描紀錄，為保留核對歷史不能刪除。"
              : message.includes("product has settlement history")
                ? "此商品已列入財務結算，不能刪除。"
                : `刪除失敗：${message}`,
      );
      return;
    }

    const imagePaths = Array.isArray(data)
      ? data.filter((path): path is string => typeof path === "string")
      : undefined;
    const storageResult = imagePaths?.length
      ? await supabase.storage.from("product-images").remove(imagePaths)
      : undefined;

    await onUpdated();
    onClose();
    window.alert(
      storageResult?.error
        ? `${p.id} 已刪除，但原圖片清除失敗：${storageResult.error.message}`
        : `${p.id} 已成功刪除。`,
    );
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
          className={`relative m-[22px] grid h-[185px] w-[calc(100%-44px)] place-items-center rounded-[9px] border-0 text-[30px] tracking-[0.15em] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1875)] ${p.image ? "cursor-zoom-in overflow-hidden p-0" : ""}`}
          style={{ background: `linear-gradient(145deg,${p.accent},#1C2A3A)` }}
          onClick={() => p.image && setPreview(true)}
        >
          {p.image ? (
            <>
              <ProductImage src={p.image} alt={`${p.work} 商品主圖`} />
              <span className="absolute bottom-3 right-3 flex items-center gap-[6px] rounded-full bg-black/65 px-3 py-[6px] text-[12px] tracking-normal text-white">
                <ZoomIn size={15} />
                點擊放大
              </span>
            </>
          ) : (
            <span>{p.work}</span>
          )}
        </button>
        <div className="flex items-start justify-between px-[26px] [&_h2]:my-[10px_3px] [&_h2]:text-[24px] [&_p]:m-0 [&_p]:text-[var(--color-muted)]">
          <div>
            <span className="pill green">{p.status}</span>
            <h2>{p.work}</h2>
            <p>{p.name}</p>
          </div>
          <button
            className="icon-btn"
            onClick={() => setEditing(true)}
            aria-label="編輯商品"
          >
            <Pencil size={18} />
          </button>
        </div>
        <div className="mx-[26px] my-[22px] grid grid-cols-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-white)] max-sm:grid-cols-1 [&>div]:border-b [&>div]:border-[var(--color-line)] [&>div]:p-3 [&>div:nth-child(odd)]:border-r max-sm:[&>div:nth-child(odd)]:border-r-0 [&>div:nth-last-child(-n+2)]:border-b-0 [&_small]:mb-[5px] [&_small]:block [&_small]:text-[11px] [&_small]:text-[var(--color-muted)]">
          <Spec k="商品類型" v={p.category} />
          <Spec k="國家 / 來源" v={`${p.country} · ${p.source}`} />
          <Spec k="版本 / 影廳" v={p.format || "—"} />
          <Spec k="尺寸" v={p.size || "—"} />
          <Spec k="工藝" v={p.crafts?.join(" ＋ ") || "—"} />
          <Spec k="庫存數量" v={`${p.stock} 件`} />
        </div>
        <div className="mx-[26px] my-[14px] rounded-lg bg-[var(--color-primary-soft)] p-3 [&_p]:m-0 [&_small]:mb-[5px] [&_small]:block [&_small]:text-[11px] [&_small]:text-[var(--color-muted)]">
          <small>辨識特徵</small>
          <p>{p.feature || "尚未填寫"}</p>
        </div>
        <div className="mx-[26px] my-[14px] flex items-center gap-[13px] rounded-lg border border-[var(--color-line)] bg-[var(--color-white)] p-3 [&>div]:flex-1 [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-[var(--color-rust)] [&_small]:mb-[5px] [&_small]:block [&_small]:text-[11px] [&_small]:text-[var(--color-muted)] [&_strong]:font-mono [&_strong]:text-[17px] [&_strong]:font-medium">
          <MapPin />
          <div>
            <small>目前庫位</small>
            <strong>{p.location}</strong>
          </div>
          <button>移動庫位</button>
        </div>
        {p.dbId && <QrLabels productId={p.dbId} sku={p.id} />}
        {isAdmin && (
          <div className="mx-[26px] my-[14px] flex items-center gap-[7px] text-[11px] text-[#6e716b]">
            <ShieldCheck size={18} />
            成本 NT$ {p.cost.toLocaleString()} 僅管理員可見
          </div>
        )}
        {isAdmin && (
          <button
            type="button"
            className="outline danger mx-[22px] mt-3 flex w-[calc(100%-44px)] items-center justify-center gap-2"
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
      className="mx-[26px] my-[14px]"
      emptyContent={
      <div className="qr-card mx-[26px] my-[14px] flex items-center gap-5 rounded-lg border border-[var(--color-line)] bg-[var(--color-white)] p-[18px] max-sm:items-start max-sm:[&_svg]:h-[90px] max-sm:[&_svg]:w-[90px] [&_p]:my-1 [&_p]:mb-[10px] [&_p]:text-[11px] [&_p]:text-[var(--color-muted)] [&_small]:mb-[5px] [&_small]:block [&_small]:text-[11px] [&_small]:text-[var(--color-muted)] [&_strong]:font-mono [&_strong]:text-[18px] [&_strong]:font-medium">
        <div>
          <small>商品 QR Code</small>
          <strong>尚無可用標籤</strong>
          <p>請先執行 QR token migration。</p>
        </div>
      </div>
      }
    >
      <div>
      {labels.map((label, index) => (
        <div
          className="qr-card mx-[26px] my-[14px] flex items-center gap-5 rounded-lg border border-[var(--color-line)] bg-[var(--color-white)] p-[18px] max-sm:items-start max-sm:[&_svg]:h-[90px] max-sm:[&_svg]:w-[90px] [&_p]:my-1 [&_p]:mb-[10px] [&_p]:text-[11px] [&_p]:text-[var(--color-muted)] [&_small]:mb-[5px] [&_small]:block [&_small]:text-[11px] [&_small]:text-[var(--color-muted)] [&_strong]:font-mono [&_strong]:text-[18px] [&_strong]:font-medium"
          key={label.token}
        >
          <QRCodeSVG
            value={
              publicOrigin
                ? buildPublicQrUrl(label.token, publicOrigin)
                : `AS1:${label.token}`
            }
            size={112}
            level="M"
          />
          <div>
            <small>商品 QR Code · 第 {index + 1} 件</small>
            <strong>{sku}</strong>
            <p>
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
      className="block h-full w-full bg-[var(--color-light)] object-contain"
      src={src}
      alt={alt}
      decoding="async"
    />
  );
}

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <small>{k}</small>
      <b>{v}</b>
    </div>
  );
}
