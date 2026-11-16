"use client";

import { useId, type ReactNode } from "react";
import { parseFanmadeCraftText } from "@/lib/fanmade/craft-text";
import styles from "../../../styles/components/fanmade/FanmadeImageCrafts.module.scss";

export function FanmadeImageCrafts({
  imageNumber,
  title,
  preview,
  crafts,
  text,
  defaultStock,
  totalCount,
  disabled,
  dirty,
  onTextChange,
  onApply,
  children,
}: {
  imageNumber: number;
  title: string;
  preview: string;
  crafts: Array<{ key: string; craft: string; stock: string }>;
  text: string;
  defaultStock: string;
  totalCount: number;
  disabled: boolean;
  dirty: boolean;
  onTextChange: (text: string) => void;
  onApply: () => void;
  children: ReactNode;
}) {
  const helpId = useId();
  const errorsId = useId();
  const parsed = parseFanmadeCraftText(text, defaultStock, {
    stockDefaults: Object.fromEntries(
      crafts.map((craft) => [craft.craft.trim(), craft.stock]),
    ),
  });
  const nextTotal = totalCount - crafts.length + parsed.items.length;
  const overLimit = nextTotal > 50;
  const invalid = parsed.errors.length > 0 || parsed.items.length === 0;

  return (
    <section className={styles.image} aria-label={`${title}圖片工藝設定`}>
      <div className={styles.header}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt={`${title}圖片`} width={72} height={90} />
        <div>
          <span className="eyebrow">圖{imageNumber}</span>
          <h3>{title}</h3>
          <p>目前 {crafts.length} 種工藝，各自管理庫存與影片。</p>
        </div>
      </div>

      <div className={styles.editor}>
        <label>
          本圖工藝（文字批量）
          <textarea
            aria-label={`${title}圖片工藝文字`}
            aria-describedby={`${helpId} ${errorsId}`}
            aria-invalid={invalid || overLimit}
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            disabled={disabled}
            rows={3}
            maxLength={15000}
            placeholder={"亮銀龍｜10\n水波紋｜6\n雷射｜3"}
          />
        </label>
        <p id={helpId} className={styles.help}>
          一行一種工藝，可填「工藝｜庫存」。只填名稱會沿用本圖該工藝庫存，新工藝使用預設庫存；套用只會修改這張圖片，其他圖片保留。編輯工藝文字後，請先套用或還原，再調整下方庫存與影片。
        </p>
        <div id={errorsId} className={styles.feedback}>
          {parsed.errors.map((error) => (
            <p key={error} className={styles.error} role="alert">
              {error}
            </p>
          ))}
          {overLimit && (
            <p className={styles.error} role="alert">
              套用後本批將有 {nextTotal} 件商品，超過每批 50 件上限。
            </p>
          )}
          {parsed.warnings.map((warning) => (
            <p key={warning} className={styles.help}>
              {warning}
            </p>
          ))}
        </div>
        <div className={styles.actions}>
          <p className={styles.help} role="status">
            {dirty
              ? "本圖工藝文字已變更，請套用後再核對下方商品列。"
              : `已套用 ${crafts.length} 種工藝。`}
            {!invalid &&
              ` 套用後本圖 ${parsed.items.length} 種，本批共 ${nextTotal} 件商品。`}
          </p>
          {dirty && (
            <button
              type="button"
              className="outline"
              disabled={disabled}
              onClick={() =>
                onTextChange(
                  crafts
                    .map((craft) => `${craft.craft}｜${craft.stock}`)
                    .join("\n"),
                )
              }
            >
              還原本圖工藝
            </button>
          )}
          <button
            type="button"
            className="outline"
            aria-label={`套用${title}圖片工藝`}
            disabled={disabled || !dirty || invalid || overLimit}
            onClick={onApply}
          >
            套用這張圖片工藝
          </button>
        </div>
      </div>

      <div className={styles.rows}>{children}</div>
    </section>
  );
}
