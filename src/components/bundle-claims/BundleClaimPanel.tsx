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
  ImagePlus,
  Images,
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
  X,
} from "lucide-react";

import { RemoveRecordButton } from "@/components/order-management/RemoveRecordButton";
import { CustomerList } from "@/components/order-management/CustomerList";
import { OrderContactDetails } from "@/components/order-management/OrderContactDetails";
import { OrderItems } from "@/components/order-management/OrderItems";
import { PaymentHistory } from "@/components/order-management/PaymentHistory";
import { PaymentSection } from "@/components/order-management/PaymentSection";
import {
  PaymentRecordEditor,
  type PaymentEditorValues,
} from "@/components/order-management/PaymentRecordEditor";
import { BundleMenuControl } from "@/components/bundle-claims/BundleMenuControl";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import {
  createBundleClaimDraft,
  deleteBundleClaimOrder,
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
  bundleProductSchema,
  sumBundleProductAmounts,
  formatBundleClaimMoney,
  validateBundleClaimImage,
  type BundleClaimCampaign,
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
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [paymentEditor, setPaymentEditor] = useState<{
    owner: string;
    orderId: number;
    values: PaymentEditorValues;
  } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<BundleClaimFilter>("all");
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | "all">(
    "all",
  );
  const campaignRef = useRef<number | "all">("all");
  useEffect(() => {
    campaignRef.current = selectedCampaignId;
  }, [selectedCampaignId]);
  const [campaignRefresh, setCampaignRefresh] = useState(0);
  const [campaigns, setCampaigns] = useState<BundleClaimCampaign[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorOrderId, setEditorOrderId] = useState<number | null>(null);
  const [editorCampaignId, setEditorCampaignId] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [productFields, setProductFields] = useState<
    Record<string, { name: string; amount: string }>
  >({});
  const [fileKeys, setFileKeys] = useState(new Map<File, string>());
  function fileKey(file: File) {
    return fileKeys.get(file) ?? "";
  }
  function changeProduct(key: string, field: "name" | "amount", value: string) {
    setProductFields((current) => ({
      ...current,
      [key]: { ...(current[key] ?? { name: "", amount: "" }), [field]: value },
    }));
  }
  function productInputs(key: string, index: number) {
    const value = productFields[key] ?? { name: "", amount: "" };
    return (
      <div className="mt-2 space-y-2">
        <label className="block text-[11px] font-semibold text-dark">
          商品名稱 {index + 1}
          <input
            className="mt-1 min-h-10 w-full min-w-0 rounded-[6px] border border-line bg-white px-2 text-[13px]"
            value={value.name}
            onChange={(event) => changeProduct(key, "name", event.target.value)}
            maxLength={120}
            required
            disabled={working}
          />
        </label>
        <label className="block text-[11px] font-semibold text-dark">
          商品金額 {index + 1}（TWD）
          <input
            className="mt-1 min-h-10 w-full min-w-0 rounded-[6px] border border-line bg-white px-2 text-[13px]"
            type="number"
            min="0.01"
            max="9999999999.99"
            step="0.01"
            inputMode="decimal"
            value={value.amount}
            onChange={(event) =>
              changeProduct(key, "amount", event.target.value)
            }
            required
            disabled={working}
          />
        </label>
      </div>
    );
  }
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

  const totalAmount = sumBundleProductAmounts([
    ...(editorOrder?.images ?? []).map(
      (image) => Number(productFields[`image-${image.id}`]?.amount) || 0,
    ),
    ...pendingFiles.map(
      (file) => Number(productFields[fileKey(file)]?.amount) || 0,
    ),
  ]);

  const load = useCallback(
    async (preferredId?: number | null, signal?: AbortSignal) => {
      const requestedOwner = ownerId;
      const requestedCampaign = selectedCampaignId;
      try {
        const result = await fetchBundleClaims({
          ownerId: requestedOwner,
          search,
          filter,
          campaignId:
            selectedCampaignId === "all" ? undefined : selectedCampaignId,
          signal,
        });
        if (
          signal?.aborted ||
          ownerRef.current !== requestedOwner ||
          campaignRef.current !== requestedCampaign
        )
          return;
        setOrders(result.orders);
        setSelectedId((current) => {
          const candidate = preferredId ?? current;
          return result.orders.some((order) => order.id === candidate)
            ? candidate
            : ((filter === "all"
                ? result.orders.find(
                    (order) =>
                      order.status !== "cancelled" &&
                      order.status !== "expired",
                  )
                : undefined
              )?.id ??
                result.orders[0]?.id ??
                null);
        });
        setError("");
      } catch (loadError) {
        if (
          signal?.aborted ||
          ownerRef.current !== requestedOwner ||
          campaignRef.current !== requestedCampaign
        )
          return;
        setOrders([]);
        setSelectedId(null);
        setError(
          loadError instanceof Error ? loadError.message : "配單確認讀取失敗",
        );
      } finally {
        if (
          !signal?.aborted &&
          ownerRef.current === requestedOwner &&
          campaignRef.current === requestedCampaign
        ) {
          setLoading(false);
        }
      }
    },
    [filter, ownerId, search, selectedCampaignId],
  );

  useEffect(() => {
    ownerRef.current = ownerId;
    setOrders([]);
    setSelectedId(null);
    setEditorOpen(false);
    setEditorOrderId(null);
    setPendingFiles([]);
    setFileKeys(new Map());
    setSearch("");
    setFilter("all");
    setError("");
    setMessage("");
    setLoading(true);
    setSelectedCampaignId("all");
    setCampaigns([]);
    setEditorCampaignId(null);
    setProductFields({});
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

  const selectCampaign = useCallback((id: number | "all") => {
    if (campaignRef.current === id) return;
    campaignRef.current = id;
    setSelectedCampaignId(id);
    setOrders([]);
    setSelectedId(null);
    setEditorOpen(false);
    setEditorOrderId(null);
    setPendingFiles([]);
    setFileKeys(new Map());
    setProductFields({});
    setError("");
    setMessage("");
  }, []);

  function resetEditor() {
    setEditorOrderId(null);
    setDescription("");
    setProductFields({});
    setEditorCampaignId(
      selectedCampaignId !== "all"
        ? selectedCampaignId
        : (campaigns[0]?.id ?? null),
    );
    setCustomerHint("");
    setExpiresAt("");
    setPendingFiles([]);
    setFileKeys(new Map());
    setError("");
  }

  function startCreate() {
    resetEditor();
    setSearch("");
    setFilter("all");
    if (selectedCampaignId === "all" && campaigns[0])
      setSelectedCampaignId(campaigns[0].id);
    setEditorOpen(true);
    setMessage("");
  }

  function startEdit(order: BundleClaimOrder) {
    setEditorOrderId(order.id);
    setDescription(order.description ?? "");
    setProductFields(
      Object.fromEntries(
        order.images.map((image) => [
          `image-${image.id}`,
          {
            name: image.productName ?? "",
            amount:
              image.productAmount === undefined
                ? ""
                : String(image.productAmount),
          },
        ]),
      ),
    );
    setEditorCampaignId(order.campaignId ?? campaigns[0]?.id ?? null);
    setCustomerHint(order.customerHint ?? "");
    setExpiresAt(toLocalDateTimeInput(order.expiresAt));
    setPendingFiles([]);
    setFileKeys(new Map());
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
      setError(`每筆配單最多 ${BUNDLE_CLAIM_IMAGE.maxCount} 張截圖。`);
      return;
    }
    const invalid = incoming
      .map((file) => ({ file, error: validateBundleClaimImage(file) }))
      .find((item) => item.error);
    if (invalid) {
      setError(`${invalid.file.name}：${invalid.error}`);
      return;
    }
    setFileKeys(
      (current) =>
        new Map([
          ...current,
          ...incoming.map((file) => [file, crypto.randomUUID()] as const),
        ]),
    );
    setPendingFiles((current) => [...current, ...incoming]);
    setError("");
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const existingCount = editorOrder?.images.length ?? 0;
    if (existingCount + pendingFiles.length === 0) {
      setError("請先新增至少一張商品圖片");
      return;
    }
    if (!editorCampaignId) {
      setError("請先建立或選擇配單活動");
      return;
    }
    const entries = [
      ...(editorOrder?.images ?? []).map((image) => ({
        id: image.id,
        ...productFields[`image-${image.id}`],
      })),
      ...pendingFiles.map((file) => ({
        id: 1,
        ...productFields[fileKey(file)],
      })),
    ];
    if (
      entries.some(
        (product) =>
          !bundleProductSchema.safeParse({
            ...product,
            amount: Number(product.amount),
          }).success,
      )
    ) {
      setError("請填寫每張商品圖片的品名與有效金額");
      return;
    }
    const amount = totalAmount;
    if (!amount || amount <= 0) {
      setError("總金額必須大於 0");
      return;
    }
    const parsed = bundleClaimDraftSchema.safeParse({
      ownerId,
      orderId: editorOrderId ?? undefined,
      campaignId: editorCampaignId ?? undefined,
      title:
        campaigns.find((campaign) => campaign.id === editorCampaignId)?.title ||
        "配單",
      description,
      totalAmount: amount,
      customerHint,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "請確認草稿內容");
      return;
    }
    if (existingCount + pendingFiles.length > BUNDLE_CLAIM_IMAGE.maxCount) {
      setError(`每筆配單最多 ${BUNDLE_CLAIM_IMAGE.maxCount} 張截圖。`);
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

      const products = (editorOrder?.images ?? []).map((image) => ({
        id: image.id,
        name: productFields[`image-${image.id}`].name,
        amount: Number(productFields[`image-${image.id}`].amount),
      }));
      for (const file of pendingFiles) {
        const details = productFields[fileKey(file)];
        const image = await uploadBundleClaimImage({
          ownerId,
          orderId: saved.orderId,
          file,
        });
        products.push({
          id: image.id,
          name: details.name,
          amount: Number(details.amount),
        });
        setProductFields((current) => ({
          ...current,
          [`image-${image.id}`]: details,
        }));
        setPendingFiles((current) =>
          current.filter((candidate) => candidate !== file),
        );
      }

      await performBundleClaimAction({
        ownerId,
        orderId: saved.orderId,
        action: "set_products",
        products,
      });
      setEditorOpen(false);
      setEditorOrderId(null);
      setPendingFiles([]);
      setFileKeys(new Map());
      setMessage(
        pendingFiles.length > 0
          ? "草稿與商品圖片已儲存。核對內容後，開放這份配單即可加入共同選單。"
          : "草稿已儲存。",
      );
      setCampaignRefresh((current) => current + 1);
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
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "操作失敗");
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function saveBundlePayment() {
    if (
      !selected ||
      !paymentEditor ||
      working ||
      selected.status !== "confirmed" ||
      selected.payment ||
      paymentEditor.owner !== ownerId ||
      paymentEditor.orderId !== selected.id
    )
      return;
    const values = paymentEditor.values;
    const amount = Number(values.amount);
    const transferredAt = new Date(values.transferredAt);
    if (
      amount !== selected.totalAmount ||
      !Number.isFinite(transferredAt.getTime()) ||
      (values.lastFive && !/^\d{5}$/.test(values.lastFive))
    ) {
      setError("請確認全額金額、匯款時間與帳號末五碼。");
      return;
    }
    if (
      !window.confirm(
        `確定登記已收到全額 ${formatBundleClaimMoney(selected.totalAmount)}？`,
      )
    )
      return;
    const saved = await runAction(
      {
        action: "record_payment",
        orderId: selected.id,
        transferredAt: transferredAt.toISOString(),
        payerAccountLastFive: values.lastFive,
        note: values.note.trim(),
      },
      "已登記全額付款。",
    );
    if (saved) setPaymentEditor(null);
  }
  function customerRows(records: BundleClaimOrder[]) {
    return records.map((order) => ({
      key: String(order.id),
      name: order.customerNickname || order.customerHint || "尚未指定顧客",
      amount: formatBundleClaimMoney(order.totalAmount),
      status: statusLabel(order),
      statusClassName: statusClasses(order),
    }));
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

  async function removeOrder(order: BundleClaimOrder) {
    if (working) return;
    if (order.payment || order.receivingCheckedAt || order.outboundCheckedAt) {
      setError("請先撤銷付款與入出庫核對，再移除配單。");
      return;
    }
    const customer =
      order.customerNickname || order.customerHint || "尚未指定顧客";
    if (
      !window.confirm(
        `確定移除「${customer}」的這筆配單嗎？\n\n活動：${order.title}\n確認編號：${order.confirmationCode}\n總額：${formatBundleClaimMoney(order.totalAmount)}\n\n商品與圖片紀錄將一併移除，移除後無法復原。`,
      )
    )
      return;
    setWorking(true);
    setRemovingId(order.id);
    setError("");
    setMessage("");
    try {
      await deleteBundleClaimOrder({
        ownerId,
        orderId: order.id,
        expectedUpdatedAt: order.updatedAt || undefined,
      });
      setCampaignRefresh((current) => current + 1);
      setMessage("配單已移除。");
      setPaymentEditor(null);
      if (editorOrderId === order.id) resetEditor();
      setSelectedId(null);
      await load(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "配單移除失敗，請稍後再試。",
      );
    } finally {
      setWorking(false);
      setRemovingId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-5 pb-8">
      <section className="min-w-0 px-1">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="bundle-management-actions">
            <button
              type="button"
              className="outline"
              onClick={onOpenAppearance}
            >
              <Palette size={16} />
              表單外觀
            </button>
            <button
              type="button"
              className="primary"
              onClick={startCreate}
              disabled={campaigns.length === 0}
            >
              <Plus size={17} />
              新增姓名選項
            </button>
          </div>
        </div>
      </section>

      <BundleMenuControl
        key={ownerId}
        ownerId={ownerId}
        refreshKey={campaignRefresh}
        selectedCampaignId={selectedCampaignId}
        onSelectCampaign={selectCampaign}
        onCampaignsChange={setCampaigns}
      />

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
                  顧客群組暱稱／選項名稱{" "}
                  <em className="not-italic text-danger">*</em>
                </span>
                <input
                  className="min-h-12 w-full min-w-0 rounded-[8px] border border-line px-4 text-[14px]"
                  value={customerHint}
                  onChange={(event) => setCustomerHint(event.target.value)}
                  maxLength={100}
                  placeholder="例如：james（共同選單顯示的暱稱）"
                  required
                />
              </label>

              <label className="block min-w-0">
                <span className="mb-2 block text-[13px] font-semibold text-dark">
                  商品加總金額（TWD）
                </span>
                <input
                  className="min-h-12 w-full min-w-0 rounded-[8px] border border-line px-4 text-[15px]"
                  value={totalAmount}
                  readOnly
                  type="number"
                  min="0.01"
                  max="9999999999.99"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="依商品金額自動加總"
                />
                <span className="mt-1.5 block text-[11px] leading-5 text-muted">
                  依下方商品金額自動加總，無需手動填寫。
                </span>
              </label>
              {campaigns.length > 0 && (
                <label className="block min-w-0">
                  <span className="mb-2 block text-[13px] font-semibold text-dark">
                    歸屬活動
                  </span>
                  <select
                    className="min-h-12 w-full min-w-0 rounded-[8px] border border-line bg-white px-3 text-[14px] text-dark"
                    value={editorCampaignId ?? ""}
                    onChange={(e) =>
                      setEditorCampaignId(
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                  >
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block min-w-0">
                <span className="mb-2 block text-[13px] font-semibold text-dark">
                  姓名選項到期時間（選填）
                </span>
                <input
                  className="min-h-12 w-full min-w-0 rounded-[8px] border border-line px-4 text-[14px]"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  type="datetime-local"
                />
              </label>
              <label className="block min-w-0 md:col-span-2">
                <span className="mb-2 block text-[13px] font-semibold text-dark">
                  配單補充說明（選填）
                </span>
                <textarea
                  className="min-h-20 w-full min-w-0 resize-y rounded-[8px] border border-line px-4 py-3 text-[14px]"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={2000}
                  placeholder="例如：商品狀態或其他需要客人留意的說明。"
                />
              </label>
            </div>

            <div className="mt-5 rounded-[10px] border border-line bg-light/55 p-3.5 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="m-0 text-[14px] text-dark">商品截圖</h4>
                  <p className="mb-0 mt-1 text-[11px] leading-5 text-muted">
                    JPG、PNG、WebP；每張最多 8MB，最多 10
                    張。截圖將作為買家核對的商品憑證。
                  </p>
                </div>
                <button
                  type="button"
                  className="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={working}
                >
                  <ImagePlus size={16} />
                  新增商品圖片
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
                      {productInputs(`image-${image.id}`, index)}
                      <div className="mt-2 flex items-center justify-center gap-1">
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
                      {productInputs(
                        fileKey(file),
                        (editorOrder?.images.length ?? 0) + index,
                      )}
                      <button
                        type="button"
                        disabled={working}
                        className="mt-2 min-h-8 w-full rounded-[8px] border border-line bg-white text-[11px] text-danger"
                        onClick={() => {
                          setPendingFiles((current) =>
                            current.filter((candidate) => candidate !== file),
                          );
                          setFileKeys((current) => {
                            const next = new Map(current);
                            next.delete(file);
                            return next;
                          });
                        }}
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

      <section
        className="min-w-0 rounded-[12px] border border-line bg-white p-4 md:p-5"
        aria-label="配單搜尋"
      >
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            void load(selectedId);
          }}
          className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
        >
          <label className="relative block min-w-0">
            <Search
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
              size={17}
              aria-hidden="true"
            />
            <input
              className="claim-customer-search-input min-h-11 w-full min-w-0 rounded-[8px] border border-line pl-10 pr-11 text-[14px]"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜尋名稱、確認編號、暱稱或電話"
              aria-label="搜尋名稱、確認編號、暱稱或電話"
              maxLength={100}
              autoComplete="off"
            />
            {search && (
              <button
                type="button"
                className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center text-muted"
                onClick={() => setSearch("")}
                aria-label="清除配單搜尋"
              >
                <X size={15} />
              </button>
            )}
          </label>
          <button type="submit" className="outline min-h-11" disabled={loading}>
            {loading ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <Search size={16} />
            )}
            {loading ? "查詢中" : "查詢"}
          </button>
        </form>
        <p className="mb-0 mt-2 text-[11px] text-muted" role="status">
          輸入後自動搜尋，也可以按 Enter 或查詢。
        </p>
        <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3">
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

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)] lg:items-start">
        <section className="min-w-0">
          <div className="flex items-center justify-between gap-3 px-1 pb-3">
            <div>
              <span className="text-[11px] font-bold text-primary">
                配單清單
              </span>
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
                  ? "沒有符合條件的配單"
                  : "尚未建立配單確認"}
              </p>
            </div>
          ) : (
            <>
              <CustomerList
                rows={customerRows(
                  filter === "all"
                    ? orders.filter(
                        (order) =>
                          order.status !== "cancelled" &&
                          order.status !== "expired",
                      )
                    : orders,
                )}
                selectedKey={selected && String(selected.id)}
                disabled={working}
                onSelect={(key) => {
                  setSelectedId(Number(key));
                  setPaymentEditor(null);
                }}
              />
              {filter === "all" &&
                orders.some(
                  (order) =>
                    order.status === "cancelled" || order.status === "expired",
                ) && (
                  <details className="mt-3 rounded-[8px] border border-line p-3 text-[12px] text-muted">
                    <summary className="cursor-pointer">
                      查看已撤銷／過期（
                      {
                        orders.filter(
                          (order) =>
                            order.status === "cancelled" ||
                            order.status === "expired",
                        ).length
                      }
                      ）
                    </summary>
                    <div className="mt-2">
                      <CustomerList
                        rows={customerRows(
                          orders.filter(
                            (order) =>
                              order.status === "cancelled" ||
                              order.status === "expired",
                          ),
                        )}
                        selectedKey={selected && String(selected.id)}
                        disabled={working}
                        onSelect={(key) => {
                          setSelectedId(Number(key));
                          setPaymentEditor(null);
                        }}
                      />
                    </div>
                  </details>
                )}
            </>
          )}
        </section>

        <section className="min-w-0 rounded-[14px] border border-line bg-white p-5 lg:sticky lg:top-4 md:p-6">
          {!selected ? (
            <div className="grid min-h-64 place-items-center text-center text-[13px] text-muted">
              <div>
                <Clipboard className="mx-auto" size={30} />
                <p className="mb-0 mt-3">選擇左側配單查看內容</p>
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <OrderContactDetails
                badge={
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClasses(selected)}`}
                  >
                    {statusLabel(selected)}
                  </span>
                }
                name={
                  selected.customerNickname ||
                  selected.customerHint ||
                  "尚未指定顧客"
                }
                phone={selected.customerPhone}
                notes={selected.customerNotes}
                metadata={
                  <>
                    <p className="m-0">活動：{selected.title}</p>
                    <p className="m-0 font-mono">
                      確認編號：{selected.confirmationCode}
                    </p>
                    <p className="m-0">
                      建立：{formatTaipeiDateTime(selected.createdAt)}
                    </p>
                    {selected.confirmedAt && (
                      <p className="m-0">
                        確認：{formatTaipeiDateTime(selected.confirmedAt)}
                      </p>
                    )}
                    {selected.expiresAt && (
                      <p className="m-0">
                        到期：{formatTaipeiDateTime(selected.expiresAt)}
                      </p>
                    )}
                    {selected.description && (
                      <p className="m-0 whitespace-pre-wrap">
                        說明：{selected.description}
                      </p>
                    )}
                  </>
                }
              />
              <OrderItems
                items={selected.images.map((image, index) => ({
                  key: String(image.id),
                  name:
                    image.productName ||
                    `${selected.title} · 商品 ${index + 1}`,
                  quantity: 1,
                  amount:
                    image.productAmount !== undefined
                      ? formatBundleClaimMoney(image.productAmount)
                      : undefined,
                  imageUrl: image.url,
                }))}
                total={formatBundleClaimMoney(selected.totalAmount)}
                onPreview={(item) =>
                  setLightboxImage({
                    src: item.imageUrl!,
                    alt: item.name,
                    label: item.name,
                  })
                }
              />
              {selected.status === "open" && (
                <p className="mt-4 rounded-[9px] border border-line bg-light/50 p-3 text-[12px] leading-6 text-muted">
                  這個姓名選項已開放。請分享上方的共同連結，讓客人點選自己的姓名、核對品項與截圖，並送出表單留下配單紀錄。
                </p>
              )}

              {selected.status === "confirmed" && (
                <>
                  <PaymentSection
                    summary={
                      selected.payment
                        ? `已付 ${formatBundleClaimMoney(selected.totalAmount)}`
                        : `待付 ${formatBundleClaimMoney(selected.totalAmount)}`
                    }
                    actions={
                      selected.payment ? (
                        <details className="text-[12px]">
                          <summary className="cursor-pointer text-muted">
                            更多操作
                          </summary>
                          <button
                            type="button"
                            className="outline mt-2 text-[12px]"
                            disabled={working}
                            onClick={() => {
                              if (window.confirm("確定撤銷這筆全額付款紀錄？"))
                                void runAction(
                                  {
                                    action: "reverse_payment",
                                    orderId: selected.id,
                                  },
                                  "付款紀錄已撤銷。",
                                );
                            }}
                          >
                            撤銷付款
                          </button>
                        </details>
                      ) : (
                        <button
                          type="button"
                          className="primary min-h-9 text-[12px]"
                          disabled={working}
                          onClick={() => {
                            setPaymentEditor({
                              owner: ownerId,
                              orderId: selected.id,
                              values: {
                                amount: String(selected.totalAmount),
                                transferredAt: toLocalDateTimeInput(
                                  new Date().toISOString(),
                                ),
                                lastFive: "",
                                note: "",
                              },
                            });
                            setError("");
                          }}
                        >
                          登記全額付款
                        </button>
                      )
                    }
                  >
                    <PaymentHistory
                      records={
                        selected.payment
                          ? [
                              {
                                key: String(selected.payment.id),
                                amount: formatBundleClaimMoney(
                                  selected.totalAmount,
                                ),
                                transferredAt: formatTaipeiDateTime(
                                  selected.payment.transferredAt,
                                ),
                                lastFive: selected.payment.payerAccountLastFive,
                                note: selected.payment.note,
                              },
                            ]
                          : []
                      }
                    />
                    {!selected.payment &&
                      paymentEditor?.owner === ownerId &&
                      paymentEditor.orderId === selected.id && (
                        <PaymentRecordEditor
                          values={paymentEditor.values}
                          onChange={(values) =>
                            setPaymentEditor({ ...paymentEditor, values })
                          }
                          amountReadOnly
                          maximumAmount={selected.totalAmount}
                          saving={working}
                          onSubmit={() => void saveBundlePayment()}
                          onCancel={() => setPaymentEditor(null)}
                        />
                      )}
                  </PaymentSection>
                  <section
                    aria-label="入出庫核對"
                    className="mt-4 rounded-[9px] border border-line px-3.5 pt-3.5"
                  >
                    <h4 className="m-0 text-[13px] font-bold text-dark">
                      入出庫核對
                    </h4>
                    <div className="divide-y divide-line">
                      <div className="flex items-center justify-between gap-3 py-3">
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
                                ? formatTaipeiDateTime(
                                    selected.receivingCheckedAt,
                                  )
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

                      <div className="flex items-center justify-between gap-3 py-3">
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
                                ? formatTaipeiDateTime(
                                    selected.outboundCheckedAt,
                                  )
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
                  </section>
                </>
              )}

              {selected.status === "draft" &&
                selected.images.some(
                  (image) => !image.productName || !image.productAmount,
                ) && (
                  <p className="mb-0 mt-4 text-[12px] leading-5 text-muted">
                    請先編輯草稿，填寫每張商品的品名與金額，儲存後再開放。
                  </p>
                )}
              {(selected.status === "draft" || selected.status === "open") && (
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
                        disabled={
                          working ||
                          selected.images.length === 0 ||
                          !selected.totalAmount ||
                          selected.totalAmount <= 0 ||
                          selected.images.some(
                            (image) =>
                              !image.productName || !image.productAmount,
                          ) ||
                          sumBundleProductAmounts(
                            selected.images.map(
                              (image) => image.productAmount ?? 0,
                            ),
                          ) !== selected.totalAmount
                        }
                        onClick={() => {
                          if (
                            !window.confirm(
                              `開放後金額與截圖就不能修改。確定開放「${selected.title}」？共同選單開放時，這份配單也會公開列出。`,
                            )
                          )
                            return;
                          void runAction(
                            { action: "open", orderId: selected.id },
                            "這份配單已開放。可分享上方共同連結，讓顧客選擇自己的那份。",
                          );
                        }}
                      >
                        <Send size={15} />
                        開放這份配單
                      </button>
                    </>
                  )}
                  {selected.status === "open" && (
                    <>
                      <button
                        type="button"
                        className="outline text-danger"
                        disabled={working}
                        onClick={() => {
                          if (
                            !window.confirm(
                              "撤下後，客人將無法再從共同選單選擇這份配單。確定撤下姓名選項？",
                            )
                          )
                            return;
                          void runAction(
                            { action: "revoke", orderId: selected.id },
                            "姓名選項已撤下。",
                          );
                        }}
                      >
                        <X size={15} />
                        撤下姓名選項
                      </button>
                    </>
                  )}
                </div>
              )}
              <div className="mt-4 border-t border-line pt-3">
                <RemoveRecordButton
                  ariaLabel={`移除 ${selected.customerNickname || selected.customerHint || "未指定顧客"} 的配單`}
                  busy={removingId === selected.id}
                  disabled={
                    working ||
                    Boolean(
                      selected.payment ||
                        selected.receivingCheckedAt ||
                        selected.outboundCheckedAt,
                    )
                  }
                  reason={
                    selected.payment
                      ? "請先撤銷付款，再移除這筆配單。"
                      : selected.receivingCheckedAt ||
                          selected.outboundCheckedAt
                        ? "請先撤銷入出庫核對，再移除這筆配單。"
                        : undefined
                  }
                  onClick={() => void removeOrder(selected)}
                />
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
