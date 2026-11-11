"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CloseButton } from "@/components/ui/CloseButton";
import { ProductImageUpload } from "./ProductImageUpload";
import { validateProductImage } from "./product-image-validation";
import { createProductImageVariants } from "@/lib/product-images";
import { uploadProductImages } from "@/lib/api/products";
import {
  createPreorderBatch,
  PreorderBatchError,
} from "@/lib/api/preorder-batch";
import {
  preorderBatchSchema,
  type PreorderBatchInput,
} from "@/lib/validation/preorder-batch";
import { parseOptionNames } from "@/lib/shared-image-options";
import { countryLabel, COUNTRIES, POSTER_SIZES } from "@/constants";
import { useDirtyBack } from "@/components/navigation/BackNavigation";
import styles from "../../../styles/components/products/SharedImageOptions.module.scss";

function readPending(key: string) {
  try {
    const result = preorderBatchSchema.safeParse(
      JSON.parse(sessionStorage.getItem(key) || "null"),
    );
    return result.success && result.data.sharedImagePaths ? result.data : null;
  } catch {
    return null;
  }
}
function persist(key: string, input: PreorderBatchInput | null) {
  try {
    if (input) sessionStorage.setItem(key, JSON.stringify(input));
    else sessionStorage.removeItem(key);
  } catch {
    /* The mounted dialog still retains its retry receipt. */
  }
}

export function SharedImageOptions({
  ownerId,
  contextKey,
  initialWorkName,
  onClose,
  onCreated,
}: {
  ownerId: string;
  contextKey: string;
  initialWorkName: string;
  onClose: () => void;
  onCreated: (ids: string[]) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const storageKey = `archive-shared-options:${ownerId}:${contextKey}`;
  const [pending, setPending] = useState(() => readPending(storageKey));
  const [work, setWork] = useState(pending?.items[0].work ?? initialWorkName);
  const [country, setCountry] = useState(pending?.items[0].country ?? "");
  const [price, setPrice] = useState(
    pending ? String(pending.items[0].price) : "",
  );
  const [size, setSize] = useState(pending?.items[0].size ?? "");
  const [names, setNames] = useState(
    pending?.items.map((item) => item.itemName).join("\n") ?? "",
  );
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>();
  const [imageError, setImageError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState<{
    file: File;
    paths: [string, string];
  } | null>(null);
  const optionNames = parseOptionNames(names);
  const locked = busy || Boolean(pending);
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  useEffect(() => {
    if (!image) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  const { requestBack, markChanged } = useDirtyBack({
    onBack: onClose,
    busy,
    dirty: Boolean(image || names.trim() || pending),
    hideButton: true,
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    let input = pending;
    if (!input) {
      if (!image) {
        setImageError("請上傳所有款式共用的完整圖片");
        return;
      }
      if (optionNames.length < 2 || optionNames.length > 50) {
        setError("請輸入 2 至 50 個款式，每行一款");
        return;
      }
      if (new Set(optionNames).size !== optionNames.length) {
        setError("款式名稱不可重複");
        return;
      }
      const checked = preorderBatchSchema.safeParse({
        ownerId,
        requestId: crypto.randomUUID(),
        items: optionNames.map((itemName) => ({
          work,
          country,
          itemName,
          price: price.trim() ? Number(price) : NaN,
          size,
          format: "",
        })),
      });
      if (!checked.success) {
        setError(checked.error.issues[0]?.message ?? "請確認款式資料");
        return;
      }
      input = checked.data;
    }
    setBusy(true);
    let created = false;
    try {
      if (!input.sharedImagePaths) {
        let paths = uploaded?.file === image ? uploaded.paths : undefined;
        if (!paths) {
          const variants = await createProductImageVariants(image!);
          const result = await uploadProductImages(
            variants.main,
            variants.thumbnail,
          );
          paths = result.paths as [string, string];
          setUploaded({ file: image!, paths });
        }
        input = { ...input, sharedImagePaths: paths };
        setPending(input);
        persist(storageKey, input);
      }
      const result = await createPreorderBatch(input);
      created = true;
      await onCreated(result.productIds);
      persist(storageKey, null);
      onClose();
    } catch (cause) {
      setError(
        created
          ? "款式已建立，但清單載入失敗。請重試確認，不會重複建立。"
          : cause instanceof Error
            ? cause.message
            : "建立失敗，請重試確認這一批",
      );
      if (
        !created &&
        cause instanceof PreorderBatchError &&
        cause.status === 400
      ) {
        setPending(null);
        persist(storageKey, null);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        requestBack();
      }}
    >
      <div className={styles.header}>
        <div>
          <span className="eyebrow">預購訂購商品</span>
          <h2 id={headingId}>整圖多款上架</h2>
        </div>
        <CloseButton
          aria-label="關閉整圖多款上架"
          onClick={requestBack}
          disabled={busy}
        />
      </div>
      <form
        onChangeCapture={markChanged}
        onSubmit={(event) => void submit(event)}
      >
        <div className={styles.body}>
          <p className={styles.intro}>
            整張圖片只上傳一次，不用逐款截圖。客人可在圖片下方分別選擇各款數量，一次送出。
          </p>
          <ProductImageUpload
            required
            preorder
            src={preview}
            file={image}
            disabled={locked}
            error={imageError}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const message = validateProductImage(file);
              setImageError(message ?? "");
              if (!message) {
                setImage(file);
                setUploaded(null);
              }
              event.target.value = "";
            }}
            onRemove={() => {
              setImage(null);
              setUploaded(null);
              setImageError("");
            }}
          />
          <fieldset disabled={locked} className={styles.fields}>
            <label>
              商品／作品名稱
              <input
                value={work}
                maxLength={200}
                onChange={(event) => setWork(event.target.value)}
                required
                placeholder="例：角色海報系列"
              />
            </label>
            <label>
              國家版本
              <select
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                required
              >
                <option value="">請選擇國家版本</option>
                {COUNTRIES.map((value) => (
                  <option key={value} value={value}>
                    {countryLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              統一會員價（NT$，定價另加 150）
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                required
                placeholder="填寫一次，所有款式共用此價格"
              />
            </label>
            <label>
              尺寸（選填）
              <select
                value={size}
                onChange={(event) => setSize(event.target.value)}
              >
                <option value="">不指定</option>
                {POSTER_SIZES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.wide}>
              款式名稱（每行一款，也可用逗號分隔）
              <textarea
                value={names}
                onChange={(event) => setNames(event.target.value)}
                maxLength={10000}
                rows={6}
                required
                placeholder={"第1款\n第2款\n第3款\n第4款\n第5款\n第6款"}
              />
            </label>
            <div className={styles.wide}>
              <button
                type="button"
                className="outline"
                onClick={() =>
                  setNames(
                    Array.from(
                      { length: 6 },
                      (_, index) => `第${index + 1}款`,
                    ).join("\n"),
                  )
                }
              >
                帶入第1款至第6款
              </button>
            </div>
          </fieldset>
          <p className={styles.intro}>
            共 {optionNames.length} 款 ·
            請依圖片由左至右命名，也可直接填角色名稱。各款會分別統計訂購數量，預購不先扣庫存。
          </p>
          {pending && (
            <p role="status" className={styles.notice}>
              圖片已上傳，本批款式待確認。重試會沿用同一批資料，不會重複上傳或建立。
            </p>
          )}
          {error && (
            <p role="alert" className="upload-error">
              {error}
            </p>
          )}
        </div>
        <div className={styles.footer}>
          <button
            type="button"
            className="outline"
            disabled={busy}
            onClick={requestBack}
          >
            關閉
          </button>
          <button className="primary" disabled={busy}>
            {busy
              ? "建立中…"
              : pending
                ? "重試確認這一批"
                : `建立 ${optionNames.length} 款並加入訂購頁`}
          </button>
        </div>
      </form>
    </dialog>
  );
}
