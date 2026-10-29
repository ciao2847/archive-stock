"use client";

import { ErrorMessage } from "@/components/ui/ErrorMessage";

import type { ChangeEvent } from "react";
import { CheckCircle2, ImagePlus, Trash2 } from "lucide-react";
import { IMAGE_UPLOAD } from "@/constants";
import styles from "../../../styles/components/products/ProductImageUpload.module.scss";

/** Shared image picker for new products and preorder product editing. */
export function ProductImageUpload({
  src,
  file,
  required = false,
  preorder = false,
  disabled = false,
  error,
  onChange,
  onRemove,
  onPreview,
}: {
  src?: string | null;
  file?: File | null;
  required?: boolean;
  preorder?: boolean;
  disabled?: boolean;
  error?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  onPreview?: () => void;
}) {
  const input = (
    <input
      type="file"
      aria-label="上傳商品圖片"
      accept={IMAGE_UPLOAD.acceptedTypes.join(",")}
      onChange={onChange}
      disabled={disabled}
      hidden
    />
  );
  // Blob URLs are only used for the selected local image preview.
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img src={src || undefined} alt="商品主圖預覽" />;
  return (
    <>
      {src ? (
        <div className="upload-preview">
          {onPreview ? (
            <button
              type="button"
              className={styles.preview}
              onClick={onPreview}
              disabled={disabled}
              aria-label="查看完整商品圖片"
            >
              {image}
            </button>
          ) : (
            image
          )}
          <div className="upload-preview-info">
            <span className="upload-success">
              <CheckCircle2 size={16} />
              {file ? "圖片已選擇" : "目前商品圖片"}
            </span>
            <b title={file?.name}>{file?.name || "已上傳的商品圖片"}</b>
            <small>
              {file
                ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                : "點擊圖片可查看完整圖片"}
            </small>
            <div>
              <label className="outline image-change">
                更換圖片
                {input}
              </label>
              <button
                type="button"
                className="image-remove"
                onClick={onRemove}
                disabled={disabled}
                aria-label="移除圖片"
              >
                <Trash2 size={15} />
                移除
              </button>
            </div>
          </div>
        </div>
      ) : (
        <label className="upload">
          <ImagePlus />
          <b>上傳商品圖片（{required ? "必填" : "選填"}）</b>
          <span>JPG、PNG、WebP，最多 {IMAGE_UPLOAD.maxMegabytes}MB</span>
          {preorder && <span>上傳後會顯示在客人的訂購頁面</span>}
          {input}
        </label>
      )}
      {error && <ErrorMessage className="upload-error">{error}</ErrorMessage>}
    </>
  );
}
