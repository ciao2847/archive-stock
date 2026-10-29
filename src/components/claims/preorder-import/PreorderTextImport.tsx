"use client";

import { CloseButton } from "@/components/ui/CloseButton";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { Spinner } from "@/components/ui/Spinner";

import { useEffect, useId, useRef, useState } from "react";
import { Plus, ScanText, Trash2 } from "lucide-react";
import {
  countryLabel,
  COUNTRIES,
  POSTER_FORMATS,
  POSTER_SIZES,
} from "@/constants";
import { useDirtyBack } from "@/components/navigation/BackNavigation";
import { buildPreorderProductName } from "@/lib/preorder-product-name";
import {
  MAX_PREORDER_BATCH,
  MAX_PREORDER_TEXT,
  parsePreorderText,
  preorderRowErrors,
  preorderRowKey,
  PREORDER_IMPORT_EXAMPLE,
  type PreorderImportRow,
} from "@/lib/preorder-import";
import {
  preorderBatchSchema,
  type PreorderBatchInput,
} from "@/lib/validation/preorder-batch";
import {
  createPreorderBatch,
  PreorderBatchError,
} from "@/lib/api/preorder-batch";
import styles from "../../../../styles/components/claims/preorder-import/PreorderTextImport.module.scss";

function readPending(key: string) {
  try {
    const parsed = preorderBatchSchema.safeParse(
      JSON.parse(sessionStorage.getItem(key) || "null"),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function persist(key: string, input: PreorderBatchInput | null) {
  try {
    if (input) sessionStorage.setItem(key, JSON.stringify(input));
    else sessionStorage.removeItem(key);
  } catch {
    /* The mounted dialog still retains the request ID for retries. */
  }
}
export function PreorderTextImport({
  ownerId,
  contextKey,
  initialWorkName,
  existingItemCount,
  onClose,
  onCreated,
}: {
  ownerId: string;
  contextKey: string;
  initialWorkName: string;
  existingItemCount: number;
  onClose: () => void;
  onCreated: (ids: string[]) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    headingId = useId(),
    sizesId = useId();
  const storageKey = `archive-preorder-batch:${ownerId}:${contextKey}`;
  const [pending, setPending] = useState<PreorderBatchInput | null>(() =>
    readPending(storageKey),
  );
  const [text, setText] = useState(""),
    [parsedText, setParsedText] = useState("");
  const [defaults, setDefaults] = useState({
    work: initialWorkName,
    country: "",
    size: "",
    format: "",
  });
  const [rows, setRows] = useState<PreorderImportRow[]>(
    () =>
      pending?.items.map((item, index) => ({
        id: `saved-${index}`,
        source: "上次待確認的批次",
        ...item,
        price: String(item.price),
        notes: [],
      })) ?? [],
  );
  const [warnings, setWarnings] = useState<string[]>([]),
    [limitExceeded, setLimitExceeded] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  const { requestBack } = useDirtyBack({
    onBack: onClose,
    busy,
    dirty: Boolean(text.trim() || rows.length),
    hideButton: true,
  });
  const repeated = new Map<string, number>();
  for (const row of rows) {
    const key = preorderRowKey(row);
    repeated.set(key, (repeated.get(key) ?? 0) + 1);
  }
  const errors = rows.map((row) => [
    ...preorderRowErrors(row, existingItemCount + rows.length > 1),
    ...(repeated.get(preorderRowKey(row))! > 1
      ? ["同批次有重複商品與規格，請移除重複列"]
      : []),
  ]);
  const changedText = text !== parsedText && !pending;
  const invalid =
    rows.length === 0 ||
    rows.length > MAX_PREORDER_BATCH ||
    limitExceeded ||
    errors.some((list) => list.length > 0) ||
    changedText;
  const locked = busy || Boolean(pending);
  function parse() {
    const result = parsePreorderText(text, defaults);
    setRows(result.rows);
    setWarnings(result.warnings);
    setLimitExceeded(result.limitExceeded);
    setParsedText(text);
    setError(
      result.rows.length
        ? ""
        : "沒有辨識到商品，請補上國家與售價，或手動新增一列。",
    );
  }
  function updateRow(
    id: string,
    field: keyof PreorderImportRow,
    value: string,
  ) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  }
  async function submit() {
    if (busy || (!pending && invalid)) return;
    const input = pending ?? {
      ownerId,
      requestId: crypto.randomUUID(),
      items: rows.map(({ work, country, itemName, price, size, format }) => ({
        work,
        country,
        itemName,
        price: Number(price),
        size,
        format,
      })),
    };
    const checked = preorderBatchSchema.safeParse(input);
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? "請確認商品資料");
      return;
    }
    setBusy(true);
    setError("");
    setPending(checked.data);
    persist(storageKey, checked.data);
    let created = false;
    try {
      const result = await createPreorderBatch(checked.data);
      created = true;
      await onCreated(result.productIds);
      persist(storageKey, null);
      onClose();
    } catch (cause) {
      setError(
        created
          ? "本批商品已建立，但清單重新載入失敗。請重試確認，同一批不會重複建立。"
          : cause instanceof PreorderBatchError
            ? cause.message
            : "目前無法確認結果，請重試確認這一批；同一批不會重複建立商品。",
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
      <header className={styles.header}>
        <div>
          <span className="eyebrow">預購商品 · 測試版</span>
          <h2 id={headingId}>文字批量上架</h2>
        </div>
        <CloseButton
          aria-label="關閉文字批量上架"
          onClick={requestBack}
          disabled={busy}
          size={20}
        />
      </header>
      <div className={styles.body}>
        {pending && (
          <p className={styles.notice} role="status">
            這一批的結果尚待確認，已保留原批次。請按「重試確認這一批」，不會重複建立商品。
          </p>
        )}
        <div className={styles.defaults}>
          <label className={styles.field}>
            預設作品名稱
            <input
              value={defaults.work}
              onChange={(e) =>
                setDefaults({ ...defaults, work: e.target.value })
              }
              disabled={locked}
              maxLength={200}
            />
          </label>
          <label className={styles.field}>
            預設國家
            <select
              value={defaults.country}
              onChange={(e) =>
                setDefaults({ ...defaults, country: e.target.value })
              }
              disabled={locked}
            >
              <option value="">依文字辨識</option>
              {COUNTRIES.map((country) => (
                <option key={country} value={country}>
                  {countryLabel(country)}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            預設尺寸（選填）
            <input
              value={defaults.size}
              onChange={(e) =>
                setDefaults({ ...defaults, size: e.target.value })
              }
              disabled={locked}
              list={sizesId}
              maxLength={100}
            />
          </label>
          <label className={styles.field}>
            預設版本（選填）
            <select
              value={defaults.format}
              onChange={(e) =>
                setDefaults({ ...defaults, format: e.target.value })
              }
              disabled={locked}
            >
              <option value="">依文字辨識</option>
              {POSTER_FORMATS.map((format) => (
                <option key={format}>{format}</option>
              ))}
            </select>
          </label>
        </div>
        <datalist id={sizesId}>
          {POSTER_SIZES.map((size) => (
            <option key={size} value={size} />
          ))}
        </datalist>
        <label className={styles.field}>
          貼上商品文字
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={locked}
            maxLength={MAX_PREORDER_TEXT}
            placeholder={PREORDER_IMPORT_EXAMPLE}
          />
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            className="primary"
            onClick={parse}
            disabled={locked || !text.trim()}
          >
            <ScanText size={16} />
            辨識商品
          </button>
          <button
            type="button"
            className="outline"
            disabled={locked}
            onClick={() => setText(PREORDER_IMPORT_EXAMPLE)}
          >
            帶入範例
          </button>
          <span className={styles.intro}>
            未註明幣別時以 NT$
            為準；「各350」才會套用到每款。重新辨識會取代下方草稿。
          </span>
        </div>
        {warnings.length > 0 && (
          <ul className={styles.notes}>
            {warnings.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        {limitExceeded && (
          <ErrorMessage className={`${styles.notice} ${styles.errors}`}>
            一次最多 {MAX_PREORDER_BATCH} 項，請減少原文並重新辨識。
          </ErrorMessage>
        )}
        {changedText && rows.length > 0 && (
          <p className={styles.notice}>文字已變更，請重新辨識後再確認建立。</p>
        )}
        <div className={styles.actions}>
          <strong>商品預覽 · 共 {rows.length} 項</strong>
          <button
            type="button"
            className="outline"
            disabled={locked || rows.length >= MAX_PREORDER_BATCH}
            onClick={() =>
              setRows((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  source: "手動新增",
                  ...defaults,
                  itemName: "",
                  price: "",
                  notes: [],
                },
              ])
            }
          >
            <Plus size={15} />
            手動新增一列
          </button>
        </div>
        <div className={styles.rows}>
          {rows.map((row, index) => (
            <section
              key={row.id}
              className={styles.row}
              aria-label={`預購商品第 ${index + 1} 項`}
            >
              <div className={styles.rowHead}>
                <strong>
                  {index + 1}.{" "}
                  {buildPreorderProductName(
                    row.country,
                    row.work,
                    row.itemName,
                  ) || "待填商品"}
                </strong>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`移除第 ${index + 1} 項商品`}
                  disabled={locked}
                  onClick={() =>
                    setRows((current) =>
                      current.filter((item) => item.id !== row.id),
                    )
                  }
                >
                  <Trash2 size={17} />
                </button>
              </div>
              <div className={styles.fields}>
                <label className={styles.field}>
                  作品名稱
                  <input
                    value={row.work}
                    onChange={(e) => updateRow(row.id, "work", e.target.value)}
                    disabled={locked}
                    maxLength={200}
                  />
                </label>
                <label className={styles.field}>
                  國家版本
                  <select
                    value={row.country}
                    onChange={(e) =>
                      updateRow(row.id, "country", e.target.value)
                    }
                    disabled={locked}
                  >
                    <option value="">請選擇國家</option>
                    {COUNTRIES.map((country) => (
                      <option key={country} value={country}>
                        {countryLabel(country)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  品項名稱
                  <input
                    value={row.itemName}
                    onChange={(e) =>
                      updateRow(row.id, "itemName", e.target.value)
                    }
                    disabled={locked}
                    maxLength={200}
                    placeholder="A款、全員款、肖像款"
                  />
                </label>
                <label className={styles.field}>
                  售價 NT$
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.price}
                    onChange={(e) => updateRow(row.id, "price", e.target.value)}
                    disabled={locked}
                  />
                </label>
                <label className={styles.field}>
                  尺寸
                  <input
                    value={row.size}
                    onChange={(e) => updateRow(row.id, "size", e.target.value)}
                    list={sizesId}
                    disabled={locked}
                    maxLength={100}
                  />
                </label>
                <label className={styles.field}>
                  版本／影廳
                  <select
                    value={row.format}
                    onChange={(e) =>
                      updateRow(row.id, "format", e.target.value)
                    }
                    disabled={locked}
                  >
                    <option value="">未指定</option>
                    {POSTER_FORMATS.map((format) => (
                      <option key={format}>{format}</option>
                    ))}
                  </select>
                </label>
              </div>
              {row.notes.length > 0 && (
                <ul className={styles.notes}>
                  {row.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
              {errors[index].length > 0 && (
                <ErrorMessage
                  as="ul"
                  className={`${styles.notes} ${styles.errors}`}
                >
                  {errors[index].map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ErrorMessage>
              )}
              <details className={styles.source}>
                <summary>查看原文</summary>
                <p>{row.source}</p>
              </details>
            </section>
          ))}
        </div>
        {error && (
          <ErrorMessage className={`${styles.notice} ${styles.errors}`}>
            {error}
          </ErrorMessage>
        )}
      </div>
      <footer className={styles.footer}>
        <p>預購庫存維持 0；每批最多 {MAX_PREORDER_BATCH} 項。</p>
        <div className={styles.actions}>
          <button
            type="button"
            className="outline"
            onClick={requestBack}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={busy || (!pending && invalid)}
          >
            {busy ? (
              <>
                <Spinner size={16} />
                建立中…
              </>
            ) : pending ? (
              "重試確認這一批"
            ) : (
              `建立並加入 ${rows.length} 項`
            )}
          </button>
        </div>
      </footer>
    </dialog>
  );
}
