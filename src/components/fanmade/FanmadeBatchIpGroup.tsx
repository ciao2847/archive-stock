"use client";

import type { ReactNode } from "react";
import { FolderOpen, ImagePlus } from "lucide-react";
import styles from "../../../styles/components/fanmade/FanmadeBatchIpGroup.module.scss";

export function FanmadeBatchIpGroup({
  ip,
  imageCount,
  variantCount,
  customIpCount,
  busy,
  onAddImages,
  children,
}: {
  ip: string;
  imageCount: number;
  variantCount: number;
  customIpCount: number;
  busy: boolean;
  onAddImages: () => void;
  children: ReactNode;
}) {
  return (
    <section className={styles.group} aria-label="本批IP與海報">
      <div className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.icon}>
            <FolderOpen size={21} aria-hidden="true" />
          </span>
          <div>
            <span className="eyebrow">IP → 海報 → 工藝影片</span>
            <h3>{ip.trim() || "尚未填寫IP"}</h3>
            <p>
              {imageCount} 張海報圖片 · {variantCount} 件工藝商品
            </p>
          </div>
        </div>
        <button
          type="button"
          className="outline"
          disabled={busy}
          onClick={onAddImages}
        >
          <ImagePlus size={16} aria-hidden="true" />
          繼續加入圖片
        </button>
        <p className={styles.help}>
          IP 只填一次，每張海報可有自己的工藝及專屬影片。
        </p>
      </div>
      {customIpCount > 0 && (
        <p className={styles.notice}>
          {customIpCount} 件工藝另有個別IP設定，會沿用原設定。
        </p>
      )}
      <div className={styles.images}>{children}</div>
    </section>
  );
}
