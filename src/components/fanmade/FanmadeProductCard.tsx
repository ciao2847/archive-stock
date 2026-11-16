"use client";

/* eslint-disable @next/next/no-img-element -- Only compressed static covers are rendered; playback is requested after a click. */
import { useState, type CSSProperties } from "react";
import { Play, Video } from "lucide-react";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { fanmadeMediaUrl } from "@/lib/fanmade/media";
import type { FanmadePublicProduct } from "@/lib/fanmade/types";
import styles from "../../../styles/components/fanmade/FanmadeProductCard.module.scss";

const quantityStyle = {
  width: "100%",
  "--quantity-border": "var(--claim-border)",
  "--quantity-background": "transparent",
  "--quantity-color": "var(--claim-surface-text)",
  "--quantity-primary": "var(--claim-primary)",
  "--quantity-soft": "var(--claim-soft)",
} as CSSProperties;

export function FanmadeProductCard({
  products,
  quantities,
  isOpen,
  submitting,
  onQuantityChange,
  onWatch,
}: {
  products: FanmadePublicProduct[];
  quantities: Record<string, number>;
  isOpen: boolean;
  submitting: boolean;
  onQuantityChange: (productId: string, value: number, maximum: number) => void;
  onWatch: (product: FanmadePublicProduct) => void;
}) {
  const [previewId, setPreviewId] = useState<string>();
  const preview =
    products.find((product) => product.id === previewId) ??
    products.find((product) => product.videoAvailable) ??
    products[0];
  if (!preview) return null;
  const title = products[0].title;
  const cover =
    (preview.videoAvailable &&
      fanmadeMediaUrl("fanmade-video-playback", preview.posterPath)) ||
    preview.imageUrl;
  const coverContent = (
    <>
      {cover ? (
        <img
          src={cover}
          alt={title}
          loading="lazy"
          decoding="async"
          width={480}
          height={480}
        />
      ) : (
        <Video size={36} aria-hidden="true" className={styles.placeholder} />
      )}
      <span className={styles.coverOverlay}>
        <span className={styles.playIcon}>
          {preview.videoAvailable ? (
            <Play size={26} aria-hidden="true" />
          ) : (
            <Video size={26} aria-hidden="true" />
          )}
        </span>
        <span>
          {preview.videoAvailable
            ? `觀看${preview.craft}實拍`
            : "實拍影片準備中"}
        </span>
      </span>
      <span className={styles.coverCraft}>{preview.craft}</span>
    </>
  );

  return (
    <article className={styles.card} aria-label={`${title} 工藝選擇`}>
      <div className={styles.heading}>
        <h3>{title}</h3>
        <span>{products.length} 種工藝</span>
      </div>
      {products.length > 1 && (
        <label className={styles.previewPicker}>
          <span>選擇實拍工藝</span>
          <select
            aria-label={`${title}實拍工藝`}
            value={preview.id}
            onChange={(event) => setPreviewId(event.target.value)}
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.craft}
                {product.videoAvailable ? "" : " · 尚未提供實拍"}
              </option>
            ))}
          </select>
        </label>
      )}
      {preview.videoAvailable ? (
        <button
          type="button"
          className={styles.cover}
          aria-label={`${title} ${preview.craft}觀看實拍影片`}
          onClick={() => onWatch(preview)}
        >
          {coverContent}
        </button>
      ) : (
        <div
          className={`${styles.cover} ${styles.unavailable}`}
          aria-label={`${title} ${preview.craft}實拍影片準備中`}
        >
          {coverContent}
        </div>
      )}
      <p className={styles.hint}>各工藝數量分開選，可同時訂購多種工藝。</p>
      <div className={styles.variants}>
        {products.map((product) => (
          <section
            key={product.id}
            className={styles.variant}
            aria-label={`${product.title} ${product.craft}`}
          >
            <div className={styles.variantInfo}>
              <h4>{product.craft}</h4>
              <span>
                {!product.isEnabled
                  ? "已停止訂購"
                  : product.available <= 0
                    ? "已售完"
                    : `可售 ${product.available} 張`}
              </span>
            </div>
            <QuantityStepper
              value={product.isEnabled ? (quantities[product.id] ?? 0) : 0}
              min={0}
              max={product.maxQuantity}
              label={`${product.name}數量`}
              itemName={product.name}
              disabled={
                !isOpen ||
                submitting ||
                !product.isEnabled ||
                product.available <= 0 ||
                product.maxQuantity <= 0
              }
              onChange={(value) =>
                onQuantityChange(product.id, value, product.maxQuantity)
              }
              style={quantityStyle}
            />
          </section>
        ))}
      </div>
    </article>
  );
}
