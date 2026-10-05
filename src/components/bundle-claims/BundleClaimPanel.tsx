"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  ExternalLink,
  ImagePlus,
  Images,
  Landmark,
  Link2,
  LoaderCircle,
  PackageCheck,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Undo2,
  UserRound,
  X,
} from "lucide-react";

import { ImageLightbox } from "@/components/ui/ImageLightbox";
import {
  createBundleClaimDraft,
  deleteBundleClaimDraft,
  fetchBundleClaims,
  performBundleClaimAction,
  removeBundleClaimImage,
  updateBundleClaimDraft,
  uploadBundleClaimImage,
} from "@/lib/api/bundle-claims";
import {
  BUNDLE_CLAIM_IMAGE,
  BUNDLE_CLAIM_STATUS_LABELS,
  bundleClaimDraftSchema,
  formatBundleClaimMoney,
  validateBundleClaimImage,
  type BundleClaimFilter,
  type BundleClaimImage,
  type BundleClaimOrder,
} from "@/lib/bundle-claims";
import { formatTaipeiDateTime } from "@/lib/claims";

const FILTERS: Array<{ value: BundleClaimFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "open", label: "等待確認" },
  { value: "confirmed_unpaid", label: "已確認待付款" },
  { value: "confirmed_paid", label: "已付款" },
  { value: "receiving_pending", label: "待入庫核對" },
  { value: "outbound_pending", label: "待出貨核對" },
  { value: "complete", label: "全部完成" },
  { value: "unavailable", label: "已撤銷／過期" },
];

function toLocalDateTimeInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function statusClasses(order: BundleClaimOrder) {
  if (order.status === "confirmed" && order.payment) {
    return "bg-success-soft text-success-strong";
  }
  if (order.status === "confirmed") return "bg-accent-soft text-accent-strong";
  if (order.status === "open") return "bg-primary-soft text-primary-strong";
  if (order.status === "draft") return "bg-light text-muted";
  return "bg-danger-soft text-danger-strong";
}

function statusLabel(order: BundleClaimOrder) {
  if (order.status === "confirmed") {
    return order.payment ? "已確認 · 已付款" : "已確認 · 待付款";
  }
  return BUNDLE_CLAIM_STATUS_LABELS[order.status];
}

function PendingImage({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={file.name} className="h-full w-full object-cover" />
  ) : null;
}

export function BundleClaimPanel({
  ownerId,
  inventoryName,
  onOpenAppearance,
}: {
  ownerId: string;
  inventoryName: string;
  onOpenAppearance: () => void;
}) {
  const ownerRef = useRef(ownerId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [orders, setOrders] = useState<BundleClaimOrder[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<BundleClaimFilter>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorOrderId, setEditorOrderId] = useState<number | null>(null);
  const [title, setTitle] = useState("單張大禮包");
  const [description, setDescription] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [customerHint, setCustomerHint] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [lightboxImage, setLightboxImage] = useState<{
    src: string;
    alt: string;
    label?: string;
  } | null>(null);

  const selected = useMemo(
    () => orders.find((order) => order.id === selectedId) ?? orders[0],
    [orders, selectedId],
  );
  const editorOrder = useMemo(
    () => orders.find((order) => order.id === editorOrderId),
    [editorOrderId, orders],
  );

  const load = useCallback(
    async (preferredId?: number | null, signal?: AbortSignal) => {
      const requestedOwner = ownerId;
      try {
        const result = await fetchBundleClaims({
          ownerId: requestedOwner,
          search,
          filter,
          signal,
        });
        if (ownerRef.current !== requestedOwner) return;
        setOrders(result.orders);
        setSelectedId((current) => {
          const candidate = preferredId ?? current;
          return result.orders.some((order) => order.id === candidate)
            ? candidate
            : (result.orders[0]?.id ?? null);
        });
        setError("");
      } catch (loadError) {
        if (signal?.aborted || ownerRef.current !== requestedOwner) return;
        setOrders([]);
        setSelectedId(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "單張大禮包喊單讀取失敗",
        );
      } finally {
        if (!signal?.aborted && ownerRef.current === requestedOwner) {
          setLoading(false);
        }
      }
    },
    [filter, ownerId, search],
  );

  useEffect(() => {
    ownerRef.current = ownerId;
    setOrders([]);
    setSelectedId(null);
    setEditorOpen(false);
    setEditorOrderId(null);
    setPendingFiles([]);
    setSearch("");
    setFilter("all");
    setError("");
    setMessage("");
    setLoading(true);
  }, [ownerId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      void load(undefined, controller.signal);
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  function resetEditor() {
    setEditorOrderId(null);
    setTitle("單張大禮包");
    setDescription("");
    setTotalAmount("");
    setCustomerHint("");
    setExpiresAt("");
    setPendingFiles([]);
    setError("");
  }

  function startCreate() {
    resetEditor();
    setSearch("");
    setFilter("all");
    setEditorOpen(true);
    setMessage("");
  }

  function startEdit(order: BundleClaimOrder) {
    setEditorOrderId(order.id);
    setTitle(order.title);
    setDescription(order.description ?? "");
    setTotalAmount(String(order.totalAmount));
    setCustomerHint(order.customerHint ?? "");
    setExpiresAt(toLocalDateTimeInput(order.expiresAt));
    setPendingFiles([]);
    setEditorOpen(true);
    setError("");
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const incoming = [...(event.target.files ?? [])];
    event.target.value = "";
    const existingCount = editorOrder?.images.length ?? 0;
    const available = Math.max(
      0,
      BUNDLE_CLAIM_IMAGE.maxCount - existingCount - pendingFiles.length,
    );
    if (incoming.length > available) {
      setError(`每筆喊單最多 ${BUNDLE_CLAIM_IMAGE.maxCount} 張截圖。`);
      return;
    }
    const invalid = incoming
      .map((file) => ({ file, error: validateBundleClaimImage(file) }))
      .find((item) => item.error);
    if (invalid) {
      setError(`${invalid.file.name}：${invalid.error}`);
      return;
    }
    setPendingFiles((current) => [...current, ...incoming]);
    setError("");
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(totalAmount);
    const parsed = bundleClaimDraftSchema.safeParse({
      ownerId,
      orderId: editorOrderId ?? undefined,
      title,
      description,
      totalAmount: amount,
      customerHint,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "請確認草稿內容");
      return;
    }
    const existingCount = editorOrder?.images.length ?? 0;
    if (existingCount + pendingFiles.length > BUNDLE_CLAIM_IMAGE.maxCount) {
      setError(`每筆喊單最多 ${BUNDLE_CLAIM_IMAGE.maxCount} 張截圖。`);
      return;
    }

    setWorking(true);
    setError("");
    setMessage("");
    let savedOrderId = editorOrderId;
    try {
      const saved = editorOrderId
        ? await updateBundleClaimDraft({
            ...parsed.data,
            orderId: editorOrderId,
          }).then(() => ({ orderId: editorOrderId }))
        : await createBundleClaimDraft(parsed.data);
      savedOrderId = saved.orderId;
      if (!editorOrderId) setEditorOrderId(saved.orderId);

      for (const file of pendingFiles) {
        await uploadBundleClaimImage({ ownerId, orderId: saved.orderId, file });
        setPendingFiles((current) =>
          current.filter((candidate) => candidate !== file),
        );
      }

      setEditorOpen(false);
      setEditorOrderId(null);
      setPendingFiles([]);
      setMessage(
        pendingFiles.length > 0
          ? "草稿與核對截圖已儲存。確認內容後即可開放顧客連結。"
          : "草稿已儲存。",
      );
      await load(saved.orderId);
    } catch (saveError) {
      if (savedOrderId) await load(savedOrderId).catch(() => undefined);
      setError(saveError instanceof Error ? saveError.message : "草稿儲存失敗");
    } finally {
      setWorking(false);
    }
  }

  async function runAction(
    input: Record<string, unknown>,
    successMessage: string,
    preferredId = selected?.id,
  ) {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await performBundleClaimAction({ ownerId, ...input });
      setMessage(successMessage);
      await load(preferredId);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "操作失敗");
    } finally {
      setWorking(false);
    }
  }

  function publicUrl(order: BundleClaimOrder) {
    if (typeof window === "undefined") return `/bundle/${order.publicToken}`;
    return `${window.location.origin}/bundle/${order.publicToken}`;
  }

  async function copyLink(order: BundleClaimOrder) {
    const url = publicUrl(order);
    try {
      await navigator.clipboard.writeText(url);
      setMessage("顧客喊單連結已複製。");
    } catch {
      window.prompt("複製顧客喊單連結", url);
    }
  }

  async function removeImage(image: BundleClaimImage) {
    if (
      !editorOrderId ||
      !window.confirm(`確定移除「${image.originalFilename}」？`)
    ) {
      return;
    }
    setWorking(true);
    try {
      await removeBundleClaimImage({
        ownerId,
        orderId: editorOrderId,
        imageId: image.id,
      });
      await load(editorOrderId);
      setMessage("截圖已移除。");
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : "截圖移除失敗",
      );
    } finally {
      setWorking(false);
    }
  }

  async function moveImage(index: number, direction: -1 | 1) {
    if (!editorOrder) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= editorOrder.images.length) return;
    const images = [...editorOrder.images];
    [images[index], images[nextIndex]] = [images[nextIndex], images[index]];
    await runAction(
      {
        action: "reorder_images",
        orderId: editorOrder.id,
        imageIds: images.map((image) => image.id),
      },
      "截圖順序已更新。",
      editorOrder.id,
    );
  }

  async function deleteDraft(order: BundleClaimOrder) {
    if (!window.confirm(`確定刪除草稿「${order.title}」？此操作無法復原。`)) {
      return;
    }
    setWorking(true);
    try {
      await deleteBundleClaimDraft({ ownerId, orderId: order.id });
      setMessage("草稿已刪除。");
      setEditorOpen(false);
      setEditorOrderId(null);
      await load(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "草稿刪除失敗",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="min-w-0 space-y-5 pb-8">
      <section className="min-w-0 rounded-[12px] border border-line bg-white p-4 md:p-5">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <span className="text-[11px] font-bold tracking-[0.12em] text-primary">
              截圖核對 · 固定總額 · 全額付款
            </span>
            <h2 className="mb-0 mt-1 text-[20px] text-dark md:text-[23px]">
              單張大禮包喊單系統
            </h2>
            <p className="mb-0 mt-1.5 max-w-[680px] text-[13px] leading-6 text-muted">
              討論串確認品項與報價後，在這裡保留截圖、填入顧客固定總額，再分享一次性確認連結。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              className="outline"
              onClick={onOpenAppearance}
            >
              <Palette size={16} />
              表單外觀
            </button>
            <button type="button" className="primary" onClick={startCreate}>
              <Plus size={17} />
              新增喊單
            </button>
          </div>
        </div>
      </section>

      {message && (
        <div className="flex items-start gap-2 rounded-[8px] border border-success/25 bg-success-soft px-4 py-3 text-[13px] text-success-strong">
          <CheckCircle2 className="mt-0.5 shrink-0" size={17} />
          {message}
        </div>
      )}
      {error && (
        <div
          className="rounded-[8px] border border-danger/20 bg-danger-soft px-4 py-3 text-[13px] leading-6 text-danger"
          role="alert"
        >
          {error}
        </div>
      )}

      {editorOpen && (
        <section className="min-w-0 rounded-[12px] border border-primary/35 bg-white p-4 md:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-[11px] font-bold text-primary">
                {editorOrderId ? "編輯草稿" : "建立新草稿"}
              </span>
              <h3 className="mb-0 mt-1 text-[18px] text-dark">
                整理顧客已確認的內容
              </h3>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setEditorOpen(false)}
              aria-label="關閉草稿編輯"
            >
              <X size={19} />
            </button>
          </div>

          <form className="mt-5" onSubmit={saveDraft}>
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <label className="block min-w-0">
                <span className="mb-2 block text-[13px] font-semibold text-dark">
                  顧客看到的名稱 <em className="not-italic text-danger">*</em>
                </span>
                <input
                  className="min-h-12 w-full min-w-0 rounded-[8px] border border-line px-4 text-[15px]"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                  required
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-2 block text-[13px] font-semibold text-dark">
                  固定總額（TWD） <em className="not-italic text-danger">*</em>
                </span>
                <input
                  className="min-h-12 w-full min-w-0 rounded-[8px] border border-line px-4 text-[15px]"
                  value={totalAmount}
                  onChange={(event) => setTotalAmount(event.target.value)}
                  type="number"
                  min="0.01"
                  max="9999999999.99"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="例：1200"
                  required
                />
              </label>
              <label className="block min-w-0 md:col-span-2">
                <span className="mb-2 block text-[13px] font-semibold text-dark">
                  品項說明（選填）
                </span>
                <textarea
                  className="min-h-24 w-full min-w-0 resize-y rounded-[8px] border border-line px-4 py-3 text-[14px]"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={2000}
                  placeholder="例如：依討論串分配的 3 張單張海報，請以截圖為準。"
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-2 block text-[13px] font-semibold text-dark">
                  顧客提示（選填）
                </span>
                <input
                  className="min-h-12 w-full min-w-0 rounded-[8px] border border-line px-4 text-[14px]"
                  value={customerHint}
                  onChange={(event) => setCustomerHint(event.target.value)}
                  maxLength={100}
                  placeholder="例如：請用討論串相同暱稱"
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-2 block text-[13px] font-semibold text-dark">
                  連結到期時間（選填）
                </span>
                <input
                  className="min-h-12 w-full min-w-0 rounded-[8px] border border-line px-4 text-[14px]"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  type="datetime-local"
                />
              </label>
            </div>

            <div className="mt-5 rounded-[10px] border border-line bg-light/55 p-3.5 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="m-0 text-[14px] text-dark">核對截圖</h4>
                  <p className="mb-0 mt-1 text-[11px] leading-5 text-muted">
                    JPG、PNG、WebP；每張最多 8MB，最多 10
                    張。開放連結後不可更換。
                  </p>
                </div>
                <button
                  type="button"
                  className="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={working}
                >
                  <ImagePlus size={16} />
                  選擇截圖
                </button>
                <input
                  ref={fileInputRef}
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={selectFiles}
                />
              </div>

              {(editorOrder?.images.length || pendingFiles.length) && (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {editorOrder?.images.map((image, index) => (
                    <div key={image.id} className="min-w-0">
                      <button
                        type="button"
                        className="aspect-[4/5] w-full overflow-hidden rounded-[8px] border border-line bg-white p-0"
                        onClick={() =>
                          setLightboxImage({
                            src: image.url,
                            alt: image.originalFilename,
                            label: `截圖 ${index + 1}`,
                          })
                        }
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image.url}
                          alt={image.originalFilename}
                          className="h-full w-full object-cover"
                        />
                      </button>
                      <div className="mt-1.5 flex items-center justify-center gap-1">
                        <button
                          type="button"
                          className="grid size-8 place-items-center rounded-[8px] border border-line bg-white"
                          disabled={working || index === 0}
                          onClick={() => void moveImage(index, -1)}
                          aria-label="往前移"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          className="grid size-8 place-items-center rounded-[8px] border border-line bg-white"
                          disabled={
                            working || index === editorOrder.images.length - 1
                          }
                          onClick={() => void moveImage(index, 1)}
                          aria-label="往後移"
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          className="grid size-8 place-items-center rounded-[8px] border border-danger/25 bg-white text-danger"
                          disabled={working}
                          onClick={() => void removeImage(image)}
                          aria-label="移除截圖"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {pendingFiles.map((file, index) => (
                    <div
                      key={`${file.name}-${file.lastModified}-${index}`}
                      className="min-w-0"
                    >
                      <div className="relative aspect-[4/5] overflow-hidden rounded-[8px] border border-dashed border-primary bg-white">
                        <PendingImage file={file} />
                        <span className="absolute left-1.5 top-1.5 rounded-[6px] bg-primary px-1.5 py-0.5 text-[9px] font-bold text-white">
                          待上傳
                        </span>
                      </div>
                      <button
                        type="button"
                        className="mt-1.5 min-h-8 w-full rounded-[8px] border border-line bg-white text-[11px] text-danger"
                        onClick={() =>
                          setPendingFiles((current) =>
                            current.filter(
                              (_, fileIndex) => fileIndex !== index,
                            ),
                          )
                        }
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="outline"
                onClick={() => setEditorOpen(false)}
                disabled={working}
              >
                取消
              </button>
              <button type="submit" className="primary" disabled={working}>
                {working ? (
                  <LoaderCircle className="animate-spin" size={17} />
                ) : (
                  <Check size={17} />
                )}
                {working ? "儲存與上傳中…" : "儲存草稿"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="min-w-0 rounded-[12px] border border-line bg-white p-4 md:p-5">
        <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <label className="relative block min-w-0">
            <Search
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
              size={17}
            />
            <input
              className="min-h-11 w-full min-w-0 rounded-[8px] border border-line pl-10 pr-4 text-[14px]"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜尋名稱、確認編號、暱稱或電話"
            />
          </label>
          <select
            className="min-h-11 min-w-0 rounded-[8px] border border-line bg-white px-3 text-[13px] font-semibold text-dark"
            value={filter}
            onChange={(event) =>
              setFilter(event.target.value as BundleClaimFilter)
            }
          >
            {FILTERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="outline min-h-11"
            onClick={() => void load(selectedId)}
            disabled={loading}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} size={16} />
            重新整理
          </button>
        </div>
      </section>

      <div className="grid min-w-0 gap-5 md:grid-cols-2 md:items-start">
        <section className="min-w-0 rounded-[12px] border border-line bg-white p-3.5 md:p-4">
          <div className="flex items-center justify-between gap-3 px-1 pb-3">
            <div>
              <span className="text-[11px] font-bold text-primary">
                喊單清單
              </span>
              <h3 className="mb-0 mt-0.5 text-[17px] text-dark">
                {inventoryName}
              </h3>
            </div>
            <span className="rounded-[8px] bg-light px-2.5 py-1 text-[11px] font-bold text-muted">
              {orders.length} 筆
            </span>
          </div>
          {loading ? (
            <div className="grid min-h-52 place-items-center text-[13px] text-muted">
              <span className="flex items-center gap-2">
                <LoaderCircle className="animate-spin" size={18} />
                讀取中…
              </span>
            </div>
          ) : orders.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-line px-5 py-12 text-center">
              <Images className="mx-auto text-muted" size={28} />
              <p className="mb-0 mt-3 text-[13px] text-muted">
                {search || filter !== "all"
                  ? "沒有符合條件的喊單"
                  : "尚未建立單張大禮包喊單"}
              </p>
            </div>
          ) : (
            <div className="grid gap-2.5">
              {orders.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  className={`min-w-0 rounded-[10px] border p-3.5 text-left transition ${selected?.id === order.id ? "border-primary bg-primary-soft/55" : "border-line bg-white hover:border-primary/50"}`}
                  onClick={() => setSelectedId(order.id)}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate text-[14px] text-dark">
                        {order.title}
                      </strong>
                      <span className="mt-1 block truncate font-mono text-[10px] text-muted">
                        {order.confirmationCode}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 rounded-[7px] px-2 py-1 text-[10px] font-bold ${statusClasses(order)}`}
                    >
                      {statusLabel(order)}
                    </span>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div className="min-w-0 text-[11px] leading-5 text-muted">
                      <span className="block truncate">
                        {order.customerNickname ||
                          order.customerHint ||
                          "尚未指定顧客"}
                      </span>
                      <span>
                        {formatTaipeiDateTime(
                          order.confirmedAt || order.createdAt,
                        )}
                      </span>
                    </div>
                    <strong className="shrink-0 text-[16px] text-[#B7791F]">
                      {formatBundleClaimMoney(order.totalAmount)}
                    </strong>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0 rounded-[12px] border border-line bg-white p-4 md:sticky md:top-4 md:p-5">
          {!selected ? (
            <div className="grid min-h-64 place-items-center text-center text-[13px] text-muted">
              <div>
                <Clipboard className="mx-auto" size={30} />
                <p className="mb-0 mt-3">選擇左側喊單查看內容</p>
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <span
                    className={`inline-flex rounded-[7px] px-2 py-1 text-[10px] font-bold ${statusClasses(selected)}`}
                  >
                    {statusLabel(selected)}
                  </span>
                  <h3 className="mb-0 mt-2 break-words text-[19px] text-dark">
                    {selected.title}
                  </h3>
                  <span className="mt-1 block break-all font-mono text-[11px] text-muted">
                    {selected.confirmationCode}
                  </span>
                </div>
                <strong className="shrink-0 text-[20px] text-[#B7791F]">
                  {formatBundleClaimMoney(selected.totalAmount)}
                </strong>
              </div>

              {selected.description && (
                <p className="mb-0 mt-3 whitespace-pre-wrap break-words rounded-[8px] bg-light/60 px-3 py-2.5 text-[12px] leading-6 text-muted">
                  {selected.description}
                </p>
              )}

              {selected.images.length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {selected.images.map((image, index) => (
                    <button
                      key={image.id}
                      type="button"
                      className="relative aspect-[4/5] min-w-0 overflow-hidden rounded-[8px] border border-line bg-light p-0"
                      onClick={() =>
                        setLightboxImage({
                          src: image.url,
                          alt: image.originalFilename,
                          label: `核對截圖 ${index + 1}／${selected.images.length}`,
                        })
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.url}
                        alt={image.originalFilename}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute bottom-1.5 right-1.5 grid size-5 place-items-center rounded-[6px] bg-black/60 text-[9px] font-bold text-white">
                        {index + 1}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {(selected.status === "open" ||
                selected.status === "confirmed") && (
                <div className="mt-4 min-w-0 rounded-[9px] border border-line bg-light/50 p-3">
                  <span className="text-[10px] font-bold text-muted">
                    顧客連結
                  </span>
                  <code className="mt-1.5 block min-w-0 break-all text-[11px] text-dark">
                    /bundle/{selected.publicToken}
                  </code>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="outline min-w-0"
                      onClick={() => void copyLink(selected)}
                    >
                      <Clipboard size={15} />
                      複製連結
                    </button>
                    <a
                      className="outline min-w-0"
                      href={`/bundle/${selected.publicToken}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={15} />
                      預覽
                    </a>
                  </div>
                </div>
              )}

              {selected.status === "confirmed" && (
                <div className="mt-4 rounded-[9px] border border-line p-3.5">
                  <div className="flex items-center gap-2 text-[12px] font-bold text-primary">
                    <UserRound size={16} />
                    顧客確認資料
                  </div>
                  <dl className="mb-0 mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px]">
                    <dt className="text-muted">暱稱</dt>
                    <dd className="m-0 min-w-0 break-words font-semibold">
                      {selected.customerNickname}
                    </dd>
                    <dt className="text-muted">手機</dt>
                    <dd className="m-0 font-mono font-semibold">
                      {selected.customerPhone}
                    </dd>
                    <dt className="text-muted">時間</dt>
                    <dd className="m-0">
                      {formatTaipeiDateTime(selected.confirmedAt)}
                    </dd>
                    {selected.customerNotes && (
                      <>
                        <dt className="text-muted">備註</dt>
                        <dd className="m-0 min-w-0 whitespace-pre-wrap break-words">
                          {selected.customerNotes}
                        </dd>
                      </>
                    )}
                  </dl>
                </div>
              )}

              {selected.status === "confirmed" && (
                <div className="mt-4 grid gap-2.5">
                  <div className="flex items-center justify-between gap-3 rounded-[9px] border border-line p-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Landmark className="shrink-0 text-primary" size={17} />
                      <div className="min-w-0">
                        <strong className="block text-[12px] text-dark">
                          付款狀態
                        </strong>
                        <span className="text-[11px] text-muted">
                          {selected.payment
                            ? `${formatTaipeiDateTime(selected.payment.transferredAt)} · 全額`
                            : "尚未登記匯款"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={selected.payment ? "outline" : "primary"}
                      disabled={working}
                      onClick={() => {
                        if (selected.payment) {
                          if (!window.confirm("確定撤銷這筆全額付款紀錄？"))
                            return;
                          void runAction(
                            {
                              action: "reverse_payment",
                              orderId: selected.id,
                            },
                            "付款紀錄已撤銷。",
                          );
                          return;
                        }
                        if (
                          !window.confirm(
                            `確定登記已收到全額 ${formatBundleClaimMoney(selected.totalAmount)}？`,
                          )
                        )
                          return;
                        void runAction(
                          {
                            action: "record_payment",
                            orderId: selected.id,
                            transferredAt: new Date().toISOString(),
                            payerAccountLastFive: "",
                            note: "",
                          },
                          "已登記全額付款。",
                        );
                      }}
                    >
                      {selected.payment ? (
                        <Undo2 size={15} />
                      ) : (
                        <Check size={15} />
                      )}
                      {selected.payment ? "撤銷" : "已全額付款"}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-[9px] border border-line p-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <PackageCheck
                        className="shrink-0 text-primary"
                        size={17}
                      />
                      <div className="min-w-0">
                        <strong className="block text-[12px] text-dark">
                          入庫核對
                        </strong>
                        <span className="text-[11px] text-muted">
                          {selected.receivingCheckedAt
                            ? formatTaipeiDateTime(selected.receivingCheckedAt)
                            : "尚未核對"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={
                        selected.receivingCheckedAt ? "outline" : "primary"
                      }
                      disabled={working}
                      onClick={() =>
                        void runAction(
                          {
                            action: "set_receiving",
                            orderId: selected.id,
                            checked: !selected.receivingCheckedAt,
                          },
                          selected.receivingCheckedAt
                            ? "已撤銷入庫核對，出貨核對也已清除。"
                            : "已完成入庫核對。",
                        )
                      }
                    >
                      {selected.receivingCheckedAt ? (
                        <Undo2 size={15} />
                      ) : (
                        <Check size={15} />
                      )}
                      {selected.receivingCheckedAt ? "撤銷" : "完成核對"}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-[9px] border border-line p-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ShieldCheck
                        className="shrink-0 text-primary"
                        size={17}
                      />
                      <div className="min-w-0">
                        <strong className="block text-[12px] text-dark">
                          出貨核對
                        </strong>
                        <span className="text-[11px] text-muted">
                          {selected.outboundCheckedAt
                            ? formatTaipeiDateTime(selected.outboundCheckedAt)
                            : selected.receivingCheckedAt
                              ? "尚未核對"
                              : "需先完成入庫核對"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={
                        selected.outboundCheckedAt ? "outline" : "primary"
                      }
                      disabled={working || !selected.receivingCheckedAt}
                      onClick={() =>
                        void runAction(
                          {
                            action: "set_outbound",
                            orderId: selected.id,
                            checked: !selected.outboundCheckedAt,
                          },
                          selected.outboundCheckedAt
                            ? "已撤銷出貨核對。"
                            : "已完成出貨核對。",
                        )
                      }
                    >
                      {selected.outboundCheckedAt ? (
                        <Undo2 size={15} />
                      ) : (
                        <Check size={15} />
                      )}
                      {selected.outboundCheckedAt ? "撤銷" : "完成核對"}
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
                {selected.status === "draft" && (
                  <>
                    <button
                      type="button"
                      className="outline"
                      onClick={() => startEdit(selected)}
                      disabled={working}
                    >
                      <Pencil size={15} />
                      編輯草稿
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={working || selected.images.length === 0}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `開放後金額與截圖就不能修改。確定產生「${selected.title}」顧客連結？`,
                          )
                        )
                          return;
                        void runAction(
                          { action: "open", orderId: selected.id },
                          "顧客連結已開放，可以複製分享。",
                        );
                      }}
                    >
                      <Send size={15} />
                      開放顧客連結
                    </button>
                    <button
                      type="button"
                      className="outline text-danger"
                      onClick={() => void deleteDraft(selected)}
                      disabled={working}
                    >
                      <Trash2 size={15} />
                      刪除草稿
                    </button>
                  </>
                )}
                {selected.status === "open" && (
                  <>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void copyLink(selected)}
                    >
                      <Link2 size={15} />
                      複製顧客連結
                    </button>
                    <button
                      type="button"
                      className="outline text-danger"
                      disabled={working}
                      onClick={() => {
                        if (
                          !window.confirm(
                            "撤銷後顧客將無法再開啟連結，確定撤銷？",
                          )
                        )
                          return;
                        void runAction(
                          { action: "revoke", orderId: selected.id },
                          "顧客連結已撤銷。",
                        );
                      }}
                    >
                      <X size={15} />
                      撤銷連結
                    </button>
                  </>
                )}
              </div>

              <div className="mt-4 grid gap-1.5 text-[10px] leading-5 text-muted">
                <span className="flex items-center gap-1.5">
                  <Clock3 size={12} /> 建立：
                  {formatTaipeiDateTime(selected.createdAt)}
                </span>
                {selected.expiresAt && (
                  <span>到期：{formatTaipeiDateTime(selected.expiresAt)}</span>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {working && (
        <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit items-center gap-2 rounded-[8px] bg-dark px-4 py-3 text-[12px] font-semibold text-white shadow-lg">
          <LoaderCircle className="animate-spin" size={16} />
          正在處理，請稍候…
        </div>
      )}
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          label={lightboxImage.label}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  );
}
