"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Clipboard,
  ClipboardList,
  ExternalLink,
  Link2,
  ImagePlus,
  Plus,
  RefreshCw,
  Save,
  ScanText,
  Settings2,
  X,
  Upload,
} from "lucide-react";
import { getFanmade, manageFanmade } from "@/lib/fanmade/api";
import {
  fanmadeBatchSchema,
  validateFanmadeVideo,
  type FanmadeAction,
} from "@/lib/fanmade/validation";
import type {
  FanmadeManagement as ManagementData,
  FanmadeProduct,
} from "@/lib/fanmade/types";
import { fanmadeMediaUrl } from "@/lib/fanmade/media";
import { uploadFanmadeVideo } from "@/lib/fanmade/upload";
import { createProductImageVariants } from "@/lib/product-images";
import { uploadProductImages } from "@/lib/api/products";
import { validateProductImage } from "@/components/products/product-image-validation";
import { useDirtyBack } from "@/components/navigation/BackNavigation";
import { SearchField } from "@/components/ui/SearchField";
import { LoadingState } from "@/components/ui/LoadingState";
import {
  matchesFanmadeCraftText,
  parseFanmadeCraftText,
} from "@/lib/fanmade/craft-text";
import {
  validateFanmadeBatchDraft,
  type FanmadeBatchFeedback,
} from "@/lib/fanmade/batch-feedback";
import { ClaimProcurementPanel } from "@/components/claims/ClaimProcurementPanel";
import { FanmadeBatchDialog } from "./FanmadeBatchDialog";
import { FanmadeBatchIpGroup } from "./FanmadeBatchIpGroup";
import { FanmadeImageCrafts } from "./FanmadeImageCrafts";
import styles from "../../../styles/components/fanmade/Fanmade.module.scss";
import managementStyles from "../../../styles/components/fanmade/FanmadeManagement.module.scss";
import formStyles from "../../../styles/components/claims/ClaimFormPanel.module.scss";

type Pending = Extract<FanmadeAction, { action: "batch" }>;
type Row = {
  key: string;
  imageKey: string;
  file: File;
  preview: string;
  ip: string;
  title: string;
  craft: string;
  stock: string;
  paths?: [string, string];
  video?: File;
  videoPath?: string;
  queued?: boolean;
  progress: string;
  error: string;
};
async function eachLimit<T>(
  items: T[],
  work: (item: T, index: number) => Promise<void>,
) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await work(items[index], index);
      }
    }),
  );
}
function readPending(key: string) {
  try {
    const result = fanmadeBatchSchema.safeParse(
      JSON.parse(sessionStorage.getItem(key) || "null"),
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
function persist(key: string, input: Pending | null) {
  try {
    if (input) sessionStorage.setItem(key, JSON.stringify(input));
    else sessionStorage.removeItem(key);
  } catch {
    /* in-memory receipt remains available */
  }
}
const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : "操作失敗，請重試";
function groupCatalogProducts(products: FanmadeProduct[]) {
  const groups = new Map<string, FanmadeProduct[]>();
  for (const product of products) {
    const key = product.catalogGroupId || product.id;
    groups.set(key, [...(groups.get(key) || []), product]);
  }
  return [...groups.entries()];
}
function formatImageCrafts(rows: Row[]) {
  return rows.map((row) => `${row.craft}｜${row.stock}`).join("\n");
}

export function FanmadeManagement({
  ownerId,
  onChanged,
}: {
  ownerId: string;
  onChanged?: () => Promise<void>;
}) {
  const [data, setData] = useState<ManagementData | null>(null),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [formId, setFormId] = useState<number>();
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [price, setPrice] = useState(""),
    [formTitle, setFormTitle] = useState("飯製海報現貨訂購"),
    [rows, setRows] = useState<Row[]>([]),
    [defaults, setDefaults] = useState({ ip: "", craft: "亮銀龍", stock: "0" });
  const [batchOpen, setBatchOpen] = useState(false);
  const [draggingImages, setDraggingImages] = useState(false);
  const [batchIssue, setBatchIssue] = useState<FanmadeBatchFeedback | null>(
    null,
  );
  const [imageCraftDrafts, setImageCraftDrafts] = useState<
    Record<string, string>
  >({});
  const [activeTab, setActiveTab] = useState<"submissions" | "settings">(
    "submissions",
  );
  const [creatingForm, setCreatingForm] = useState(false);
  const [formDraft, setFormDraft] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const [craftMode, setCraftMode] = useState<"per_image" | "in_order">(
    "per_image",
  );
  const craftText = useMemo(
    () =>
      parseFanmadeCraftText(defaults.craft, defaults.stock, {
        preserveDuplicates: craftMode === "in_order",
      }),
    [defaults.craft, defaults.stock, craftMode],
  );
  const craftConfig = JSON.stringify([
    defaults.craft,
    defaults.stock,
    craftMode,
  ]);
  const [appliedCraftConfig, setAppliedCraftConfig] = useState<string | null>(
    null,
  );
  const defaultsChanged = rows.length > 0 && appliedCraftConfig !== craftConfig;
  const [open, setOpen] = useState(new Set<string>()),
    [selected, setSelected] = useState(new Set<string>()),
    [legacyCraft, setLegacyCraft] = useState("");
  const storageKey = `archive-fanmade-batch:${ownerId}`;
  const [pending, setPending] = useState<Pending | null>(() =>
    readPending(storageKey),
  );
  const urls = useRef(new Set<string>()),
    sequence = useRef(0),
    fileInput = useRef<HTMLInputElement>(null);
  const mutationBusy = useRef(false);
  const imageUploads = useRef(new Map<string, Promise<[string, string]>>());
  const imageGroups = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const row of rows)
      groups.set(row.imageKey, [...(groups.get(row.imageKey) || []), row]);
    return [...groups.entries()];
  }, [rows]);
  const dirtyImageKeys = new Set(
    imageGroups
      .filter(
        ([key, items]) =>
          imageCraftDrafts[key] !== undefined &&
          !matchesFanmadeCraftText(
            imageCraftDrafts[key],
            defaults.stock,
            items,
          ),
      )
      .map(([key]) => key),
  );
  const dirtyImageNames = imageGroups
    .filter(([key]) => dirtyImageKeys.has(key))
    .slice(0, 2)
    .map(([, items]) =>
      [...(items[0].title || "未命名圖片")].slice(0, 20).join(""),
    )
    .join("、");
  const imageCount = imageGroups.length;
  const plannedCount =
    craftMode === "per_image"
      ? imageCount * craftText.items.length
      : imageCount;
  const selectedForm = data?.forms.find((f) => f.id === formId);
  const isCreatingForm = creatingForm || data?.forms.length === 0;
  const visibleTab = isCreatingForm || !selectedForm ? "settings" : activeTab;
  const selectedTitle =
    formDraft?.id === selectedForm?.id
      ? (formDraft?.title ?? "")
      : (selectedForm?.title ?? "");
  const locked = busy || Boolean(pending);
  const canApplyCrafts =
    rows.length > 0 &&
    craftText.errors.length === 0 &&
    craftText.items.length > 0 &&
    plannedCount <= 50 &&
    (craftMode !== "in_order" || imageCount === craftText.items.length);
  const batchBlockedReason = busy
    ? "正在處理本批商品，請稍候…"
    : data?.price == null
      ? loading
        ? "正在讀取飯製統一售價，請稍候。"
        : "尚未儲存飯製統一售價，請返回飯製管理設定後再建立。"
      : !pending && rows.length === 0
        ? "請先選取商品圖片，產生下方商品預覽後才能建立。"
        : !pending && dirtyImageKeys.size > 0
          ? `有 ${dirtyImageKeys.size} 張圖片（${dirtyImageNames}${dirtyImageKeys.size > 2 ? "等" : ""}）的工藝尚未套用，請先套用該圖片的工藝或還原修改。`
          : "";
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const ticket = ++sequence.current;
      setLoading(true);
      try {
        const result = await getFanmade(ownerId, page, query, formId, signal);
        if (ticket === sequence.current && !signal?.aborted) {
          setData(result);
          setPrice(result.price === null ? "" : String(result.price));
          if (!formId && result.forms[0]) setFormId(result.forms[0].id);
        }
      } catch (cause) {
        if (!signal?.aborted && ticket === sequence.current)
          setError(errorText(cause));
      } finally {
        if (ticket === sequence.current) setLoading(false);
      }
    },
    [ownerId, page, query, formId],
  );
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);
  useEffect(() => {
    const current = urls.current;
    return () => current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  const { markChanged } = useDirtyBack({
    onBack: () => {},
    enabled: false,
    dirty: rows.length > 0 || Boolean(pending),
    busy,
  });
  useEffect(() => {
    if (!rows.length && !pending) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [rows.length, pending]);
  function change(key: string, values: Partial<Row>) {
    if (
      batchIssue?.rowKey === key &&
      batchIssue.field &&
      batchIssue.field in values
    ) {
      setBatchIssue(null);
      setError("");
    }
    setRows((old) =>
      old.map((row) => (row.key === key ? { ...row, ...values } : row)),
    );
  }
  function changeBatchIp(value: string) {
    if (batchIssue?.field === "ip") {
      setBatchIssue(null);
      setError("");
    }
    const previousIp = defaults.ip.trim();
    setDefaults((current) => ({ ...current, ip: value }));
    setRows((current) =>
      current.map((row) =>
        !row.ip.trim() || row.ip.trim() === previousIp
          ? { ...row, ip: value }
          : row,
      ),
    );
  }
  async function action(input: FanmadeAction, success = "設定已儲存") {
    if (mutationBusy.current) return;
    mutationBusy.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await manageFanmade(ownerId, input);
      if (result.formId) setFormId(result.formId);
      await load();
      await onChanged?.();
      setMessage(success);
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    } finally {
      setBusy(false);
      mutationBusy.current = false;
    }
  }
  function changeImageCraftText(imageKey: string, text: string) {
    setBatchIssue(null);
    setError("");
    const source = rows.filter((row) => row.imageKey === imageKey);
    setImageCraftDrafts((current) => {
      const next = { ...current };
      if (text === formatImageCrafts(source)) delete next[imageKey];
      else next[imageKey] = text;
      return next;
    });
  }
  function finishImageCraftText(imageKey: string) {
    const source = rows.filter((row) => row.imageKey === imageKey);
    setImageCraftDrafts((current) => {
      const text = current[imageKey];
      if (
        text === undefined ||
        !matchesFanmadeCraftText(text, defaults.stock, source)
      )
        return current;
      const next = { ...current };
      delete next[imageKey];
      return next;
    });
  }
  function focusImageCrafts(imageKey: string) {
    const source = rows.find((row) => row.imageKey === imageKey);
    const element =
      source &&
      document
        .getElementById(`fanmade-batch-row-${source.key}`)
        ?.closest("section");
    const input = element?.querySelector("textarea");
    input?.focus({ preventScroll: true });
    (input || element)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function focusBatchIssue() {
    if (!batchIssue?.rowKey) return;
    const element = document.getElementById(
      `fanmade-batch-row-${batchIssue.rowKey}`,
    );
    if (!element) return;
    element.querySelectorAll("details").forEach((details) => {
      details.open = true;
    });
    const issueRow = rows.find((row) => row.key === batchIssue.rowKey);
    const sharedTitle =
      batchIssue.field === "title" &&
      issueRow &&
      rows
        .filter((row) => row.imageKey === issueRow.imageKey)
        .every((row) => row.title === issueRow.title);
    const commonTitle = sharedTitle
      ? element
          .closest("section")
          ?.querySelector<HTMLInputElement>("[data-fanmade-image-title]")
      : null;
    const input =
      commonTitle ||
      element.querySelector<HTMLInputElement>(
        `[data-fanmade-field="${batchIssue.field}"]`,
      ) ||
      element.querySelector("input");
    input?.focus({ preventScroll: true });
    (input || element).scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function changeImageTitle(imageKey: string, title: string) {
    if (locked || dirtyImageKeys.has(imageKey)) return;
    if (batchIssue?.imageKey === imageKey && batchIssue.field === "title") {
      setBatchIssue(null);
      setError("");
    }
    setRows((current) =>
      current.map((row) =>
        row.imageKey === imageKey ? { ...row, title } : row,
      ),
    );
  }
  function applyImageCrafts(imageKey: string) {
    if (locked) return;
    const source = rows.filter((row) => row.imageKey === imageKey);
    if (!source.length) return;
    const parsed = parseFanmadeCraftText(
      imageCraftDrafts[imageKey] ?? formatImageCrafts(source),
      defaults.stock,
      {
        stockDefaults: Object.fromEntries(
          source.map((row) => [row.craft.trim(), row.stock]),
        ),
      },
    );
    if (parsed.errors.length || !parsed.items.length) {
      setError(parsed.errors[0] || "請為這張圖片填寫至少一種工藝");
      return;
    }
    if (rows.length - source.length + parsed.items.length > 50) {
      setError("本批最多 50 件工藝商品，請減少這張圖片的工藝或分批上架");
      return;
    }
    const next = parsed.items.map(({ craft, stock }): Row => {
      const existing = source.find((row) => row.craft.trim() === craft);
      if (existing) return { ...existing, craft, stock: String(stock) };
      const base = source[0];
      return {
        key: crypto.randomUUID(),
        imageKey,
        file: base.file,
        preview: base.preview,
        ip: base.ip,
        title: base.title,
        craft,
        stock: String(stock),
        paths: base.paths,
        progress: base.paths ? "圖片已上傳" : "待上傳",
        error: "",
      };
    });
    const kept = new Set(next.map((row) => row.key));
    const removedVideos = source.filter(
      (row) => !kept.has(row.key) && (row.video || row.videoPath),
    );
    if (
      removedVideos.length &&
      !window.confirm(
        `這張圖片將移除 ${removedVideos.length} 種已選擇實拍影片的工藝，對應的影片草稿也會移除。其他圖片不受影響，確定套用？`,
      )
    )
      return;
    setRows((current) =>
      current.flatMap((row) =>
        row.imageKey !== imageKey
          ? [row]
          : row.key === source[0].key
            ? next
            : [],
      ),
    );
    setImageCraftDrafts((current) => {
      const drafts = { ...current };
      delete drafts[imageKey];
      return drafts;
    });
    setError("");
    setBatchIssue(null);
    setMessage(
      `已套用「${source[0].title}」的 ${next.length} 種工藝，其他圖片保留原設定。`,
    );
  }
  function selectImages(files: FileList | null) {
    if (!files || locked) return;
    const list = Array.from(files);
    if (fileInput.current) fileInput.current.value = "";
    if (craftText.errors.length || !craftText.items.length) {
      setError(craftText.errors[0] || "請先填寫至少一種預設工藝");
      return;
    }
    const count = craftMode === "per_image" ? craftText.items.length : 1;
    if (rows.length + list.length * count > 50) {
      setError("依工藝展開後每批最多 50 件商品，請減少圖片或工藝");
      return;
    }
    if (
      craftMode === "in_order" &&
      imageCount + list.length !== craftText.items.length
    ) {
      setError("依序配對時，圖片總數必須和工藝文字列數相同；請一次選齊圖片");
      return;
    }
    const invalid = list
      .map((file) => validateProductImage(file))
      .find(Boolean);
    if (invalid) {
      setError(invalid);
      return;
    }
    setRows((old) => [
      ...old,
      ...list.flatMap((file, index) => {
        const preview = URL.createObjectURL(file);
        urls.current.add(preview);
        const imageKey = crypto.randomUUID();
        const crafts =
          craftMode === "per_image"
            ? craftText.items
            : [craftText.items[imageCount + index]];
        return crafts.map(({ craft, stock }) => ({
          key: crypto.randomUUID(),
          imageKey,
          file,
          preview,
          ip: defaults.ip,
          title: file.name.replace(/\.[^.]+$/, ""),
          craft,
          stock: String(stock),
          progress: "待上傳",
          error: "",
        }));
      }),
    ]);
    if (!rows.length) setAppliedCraftConfig(craftConfig);
    setError("");
    setBatchIssue(null);
  }
  function applyCraftDefaults() {
    if (locked) return;
    if (craftText.errors.length || !craftText.items.length) {
      setError(craftText.errors[0] || "請先填寫至少一種工藝");
      return;
    }
    const sources = new Map<string, Row[]>();
    for (const row of rows)
      sources.set(row.imageKey, [...(sources.get(row.imageKey) || []), row]);
    if (craftMode === "in_order" && sources.size !== craftText.items.length) {
      setError("依序配對時，圖片總數必須和工藝文字列數相同");
      return;
    }
    if (plannedCount > 50) {
      setError("依工藝展開後每批最多 50 件商品，請減少圖片或工藝");
      return;
    }
    const next = [...sources.values()].flatMap((source, index) => {
      const crafts =
        craftMode === "per_image" ? craftText.items : [craftText.items[index]];
      return crafts.map(({ craft, stock }): Row => {
        const existing = source.find((row) => row.craft.trim() === craft);
        const base = existing || source[0];
        return {
          key: existing?.key || crypto.randomUUID(),
          imageKey: base.imageKey,
          file: base.file,
          preview: base.preview,
          title: base.title,
          ip: existing?.ip ?? (defaults.ip.trim() || base.ip),
          craft,
          stock: String(stock),
          paths: base.paths,
          progress: base.paths ? "圖片已上傳" : "待上傳",
          error: "",
          video: existing?.video,
          videoPath: existing?.videoPath,
          queued: existing?.queued,
        };
      });
    });
    const kept = new Set(next.map((row) => row.key));
    const removed = rows.filter((row) => !kept.has(row.key));
    if (
      (removed.length || dirtyImageKeys.size > 0) &&
      !window.confirm(
        `將把預設工藝套用到全部 ${sources.size} 張圖片，共 ${next.length} 件商品，並移除 ${removed.length} 列未包含的工藝及影片草稿。逐圖尚未套用的文字修改也會被取代。確定套用全部圖片？`,
      )
    )
      return;
    setRows(next);
    setImageCraftDrafts({});
    setAppliedCraftConfig(craftConfig);
    setError("");
    setMessage(
      `已預覽 ${next.length} 件商品，各工藝分開計算庫存；請核對後按「建立本批飯製商品」。`,
    );
  }
  function removeRow(row: Row) {
    if (locked || dirtyImageKeys.has(row.imageKey)) return;
    if (batchIssue?.rowKey === row.key) {
      setBatchIssue(null);
      setError("");
    }
    if (
      rows.every(
        (other) => other.key === row.key || other.imageKey !== row.imageKey,
      )
    ) {
      URL.revokeObjectURL(row.preview);
      urls.current.delete(row.preview);
      imageUploads.current.delete(row.imageKey);
      setImageCraftDrafts((current) => {
        const next = { ...current };
        delete next[row.imageKey];
        return next;
      });
    }
    setRows((old) => old.filter((other) => other.key !== row.key));
  }
  function fillBatchExample() {
    if (locked) return;
    if (
      rows.length > 0 &&
      !window.confirm(
        "帶入範例會更新新增圖片使用的預設 IP、工藝與數量；現有圖片及商品草稿會保留。確定帶入？",
      )
    )
      return;
    setDefaults({
      ip: "蜘蛛人",
      craft: "亮銀龍｜10\n水波紋｜6\n雷射｜3",
      stock: "0",
    });
    setCraftMode("per_image");
    if (rows.length > 0) setAppliedCraftConfig(null);
    setError("");
    setMessage("");
  }
  async function createBatch() {
    if (mutationBusy.current) return;
    if (!data || data.price === null) {
      setError("請先儲存飯製統一價格");
      return;
    }
    if (!pending && dirtyImageKeys.size > 0) {
      setError("請先套用或還原各圖片尚未完成的工藝文字，再建立本批商品。");
      return;
    }
    if (!pending) {
      const feedback = validateFanmadeBatchDraft(rows);
      if (feedback) {
        setBatchIssue(feedback);
        setError(feedback.message);
        return;
      }
    }
    setBatchIssue(null);
    mutationBusy.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    let input = pending;
    try {
      if (!input) {
        let failed = false;
        await eachLimit(rows, async (row) => {
          if (row.paths) return;
          change(row.key, { progress: "圖片壓縮／上傳中", error: "" });
          try {
            let upload = imageUploads.current.get(row.imageKey);
            if (!upload) {
              upload = (async () => {
                const image = await createProductImageVariants(row.file);
                const uploaded = await uploadProductImages(
                  image.main,
                  image.thumbnail,
                );
                return uploaded.paths as [string, string];
              })();
              imageUploads.current.set(row.imageKey, upload);
              void upload.catch(() =>
                imageUploads.current.delete(row.imageKey),
              );
            }
            row.paths = await upload;
            change(row.key, { paths: row.paths, progress: "圖片已上傳" });
          } catch (cause) {
            failed = true;
            change(row.key, {
              error: errorText(cause),
              progress: "圖片上傳失敗",
            });
          }
        });
        if (failed)
          throw new Error("部分圖片上傳失敗，請重試；已成功的圖片會沿用");
        input = fanmadeBatchSchema.parse({
          action: "batch",
          requestId: crypto.randomUUID(),
          items: rows.map((r) => ({
            ip: r.ip,
            title: r.title,
            craft: r.craft,
            stock: Number(r.stock),
            imagePaths: r.paths,
          })),
        });
        setPending(input);
        persist(storageKey, input);
      }
      const result = await manageFanmade(ownerId, input);
      const ids = result.productIds;
      if (!ids || ids.length !== input.items.length)
        throw new Error("批次結果待確認，請使用同一批重試");
      if (formId)
        await manageFanmade(ownerId, {
          action: "publish",
          formId,
          productIds: ids,
        });
      let videoFailed = false;
      await eachLimit(rows, async (row, index) => {
        if (!row.video || row.queued) return;
        try {
          change(row.key, { progress: "影片上傳中", error: "" });
          const path =
            row.videoPath ??
            (await uploadFanmadeVideo(ownerId, row.video, (percent) =>
              change(row.key, { progress: `影片上傳 ${percent}%` }),
            ));
          row.videoPath = path;
          change(row.key, { videoPath: path });
          const updatedAt = result.versions?.[ids[index]];
          if (!updatedAt) throw new Error("商品已建立，請在商品清單補上影片");
          await manageFanmade(ownerId, {
            action: "video",
            productId: ids[index],
            updatedAt,
            sourcePath: path,
          });
          row.queued = true;
          change(row.key, { queued: true, progress: "影片已排入背景轉檔" });
        } catch (cause) {
          videoFailed = true;
          change(row.key, { error: errorText(cause), progress: "影片待重試" });
        }
      });
      await load();
      await onChanged?.();
      if (videoFailed)
        throw new Error(
          "商品與圖片已建立，部分影片尚未完成；可重試本批未完成項目",
        );
      persist(storageKey, null);
      setPending(null);
      rows.forEach((r) => {
        URL.revokeObjectURL(r.preview);
        urls.current.delete(r.preview);
      });
      setRows([]);
      setImageCraftDrafts({});
      imageUploads.current.clear();
      setMessage(
        `已建立 ${ids.length} 件獨立飯製商品${formId ? "並加入所選訂購頁" : ""}；實拍影片將在背景轉檔完成後顯示。`,
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      mutationBusy.current = false;
    }
  }
  const ipGroups = useMemo(() => {
    const map = new Map<string, FanmadeProduct[]>();
    for (const p of data?.products ?? []) {
      const list = map.get(p.ip) || [];
      list.push(p);
      map.set(p.ip, list);
    }
    return [...map];
  }, [data]);
  async function uploadExisting(product: FanmadeProduct, file: File) {
    const invalid = validateFanmadeVideo(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (mutationBusy.current) return;
    mutationBusy.current = true;
    setBusy(true);
    setError("");
    try {
      const sourcePath = await uploadFanmadeVideo(ownerId, file, (percent) =>
        setMessage(`實拍影片上傳 ${percent}%`),
      );
      await manageFanmade(ownerId, {
        action: "video",
        productId: product.id,
        updatedAt: product.updatedAt,
        sourcePath,
      });
      setMessage("影片已排入背景轉檔，完成後才會出現在公開頁。");
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      mutationBusy.current = false;
      setBusy(false);
    }
  }
  if (!data) {
    if (loading) return <LoadingState text="正在讀取飯製資料…" />;
    return (
      <section className={styles.box}>
        <p className={styles.error} role="alert">
          {error || "無法讀取飯製資料"}
        </p>
        <button type="button" className="outline" onClick={() => void load()}>
          <RefreshCw size={15} />
          重新讀取
        </button>
      </section>
    );
  }
  return (
    <div className={styles.panel} onChangeCapture={markChanged}>
      {error && !batchOpen && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {message && !batchOpen && (
        <p className={styles.notice} role="status">
          {message}
        </p>
      )}
      <div className={managementStyles.managementHeader}>
        <div className={managementStyles.managementHeading}>
          <span className={managementStyles.headingIcon}>
            <Link2 size={19} aria-hidden="true" />
          </span>
          <div>
            <span className="eyebrow">多個 IP，一份飯製訂購連結</span>
            <h2>飯製訂購連結</h2>
          </div>
        </div>
        <div className={managementStyles.formPicker}>
          <select
            className={formStyles.selector}
            aria-label="飯製訂購表單"
            value={isCreatingForm ? "new" : (formId ?? "")}
            disabled={busy || loading || isCreatingForm || !data?.forms.length}
            onChange={(event) => {
              setFormId(Number(event.target.value) || undefined);
              setSelected(new Set());
              setFormDraft(null);
            }}
          >
            {!selectedForm && !isCreatingForm && (
              <option value="">尚未建立飯製表單</option>
            )}
            {isCreatingForm && (
              <option value="new">新增飯製表單（尚未發佈）</option>
            )}
            {data?.forms.map((form) => (
              <option key={form.id} value={form.id}>
                {form.title} · {form.isOpen ? "接單中" : "已暫停"}
              </option>
            ))}
          </select>
          {isCreatingForm ? (
            !!data?.forms.length && (
              <button
                type="button"
                className="outline"
                disabled={busy}
                onClick={() => setCreatingForm(false)}
              >
                <X size={16} />
                取消新增
              </button>
            )
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy || loading}
              onClick={() => {
                setCreatingForm(true);
                setActiveTab("settings");
                setError("");
                setMessage("");
              }}
            >
              <Plus size={16} />
              新增飯製表單
            </button>
          )}
        </div>
      </div>
      <div className={managementStyles.navigation}>
        <div
          className={managementStyles.tabs}
          role="tablist"
          aria-label="飯製管理分頁"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            const tabs = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]:not(:disabled)',
              ),
            );
            const current = tabs.indexOf(event.target as HTMLButtonElement);
            if (current < 0 || !tabs.length) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (current +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      tabs.length) %
                    tabs.length;
            tabs[next].focus();
            tabs[next].click();
          }}
        >
          <button
            type="button"
            role="tab"
            id="fanmade-procurement-tab"
            aria-selected={visibleTab === "submissions"}
            tabIndex={visibleTab === "submissions" ? 0 : -1}
            aria-controls="fanmade-procurement-panel"
            className={
              visibleTab === "submissions"
                ? managementStyles.activeTab
                : undefined
            }
            disabled={!selectedForm || isCreatingForm}
            onClick={() => setActiveTab("submissions")}
          >
            <ClipboardList size={17} aria-hidden="true" />
            採購統計
          </button>
          <button
            type="button"
            role="tab"
            id="fanmade-settings-tab"
            aria-selected={visibleTab === "settings"}
            tabIndex={visibleTab === "settings" ? 0 : -1}
            aria-controls="fanmade-settings-panel"
            className={
              visibleTab === "settings" ? managementStyles.activeTab : undefined
            }
            onClick={() => setActiveTab("settings")}
          >
            <Settings2 size={17} aria-hidden="true" />
            表單與商品設定
            {selected.size > 0 && (
              <span className={managementStyles.tabCount} aria-hidden="true">
                {selected.size} 項
              </span>
            )}
          </button>
        </div>
        {selectedForm && !isCreatingForm && (
          <span className={managementStyles.formStatus}>
            表單狀態：
            <b className={selectedForm.isOpen ? "text-success" : undefined}>
              {selectedForm.isOpen ? " 開放接單中" : " 已停止接單"}
            </b>
          </span>
        )}
      </div>
      {selectedForm && !isCreatingForm && (
        <section
          className={managementStyles.formSummary}
          aria-label="飯製表單快捷操作"
        >
          <div>
            <span className="eyebrow">
              {visibleTab === "submissions"
                ? "本批商品統計與結單"
                : "訂購頁專用商品設定"}
            </span>
            <h2>{selectedForm.title}</h2>
            <p>
              {data?.price == null
                ? "尚未設定統一售價"
                : `統一售價 NT$ ${data.price.toLocaleString("zh-TW")}`}{" "}
              · 各工藝獨立庫存
            </p>
          </div>
          <div className={managementStyles.summaryActions}>
            <button
              type="button"
              className="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(
                    `${window.location.origin}/fanmade/${selectedForm.token}`,
                  )
                  .then(() => setMessage("已複製飯製訂購連結"))
                  .catch(() =>
                    window.prompt(
                      "複製訂購連結",
                      `${window.location.origin}/fanmade/${selectedForm.token}`,
                    ),
                  )
              }
            >
              <Clipboard size={15} />
              複製連結
            </button>
            <a
              className="outline"
              href={`/fanmade/${selectedForm.token}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={15} />
              預覽訂購頁
            </a>
            <button
              type="button"
              className="outline"
              disabled={busy || loading}
              onClick={() => void load()}
            >
              <RefreshCw size={15} />
              重新載入
            </button>
          </div>
        </section>
      )}
      <div
        id="fanmade-procurement-panel"
        role="tabpanel"
        aria-labelledby="fanmade-procurement-tab"
        hidden={visibleTab !== "submissions"}
      >
        {selectedForm && (
          <ClaimProcurementPanel
            key={`${ownerId}:${selectedForm.id}`}
            ownerId={ownerId}
            formId={selectedForm.id}
            formTitle={selectedForm.title}
            showProductTotals
            onClosed={async () => {
              await load();
            }}
          />
        )}
      </div>
      <div
        id="fanmade-settings-panel"
        role="tabpanel"
        aria-labelledby="fanmade-settings-tab"
        hidden={visibleTab !== "settings"}
      >
        <div className={styles.panel}>
          <section className={managementStyles.workflow}>
            <div className={managementStyles.managementHeading}>
              <span className={managementStyles.headingIcon}>
                <ImagePlus size={20} aria-hidden="true" />
              </span>
              <div>
                <h3>飯製海報，一張圖片管理多種工藝</h3>
              </div>
            </div>
            <ol>
              {[
                "設定統一售價",
                "批量上架圖片與工藝",
                "加入表單開放訂購",
                "已付款訂單分批結單",
              ].map((step, index) => (
                <li key={step}>
                  <span>{index + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
            <p>每種工藝分開庫存與實拍影片；下單先預留，出貨時才扣實際庫存。</p>
          </section>
          <section className={styles.box}>
            <details className={managementStyles.basicSettings} open>
              <summary>
                表單基本設定
                <ChevronDown size={17} aria-hidden="true" />
              </summary>
              <div className={managementStyles.settingsGrid}>
                <div className={managementStyles.settingBlock}>
                  <h3>統一售價</h3>
                  <p>所有飯製商品使用相同價格，已成立訂單保留原成交價。</p>
                  <div className={styles.fields}>
                    <label>
                      飯製統一售價（NT$）
                      <input
                        aria-label="飯製統一售價"
                        type="number"
                        min="0"
                        step="0.01"
                        value={price}
                        onChange={(event) => setPrice(event.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || price.trim() === ""}
                      onClick={() =>
                        void action({ action: "price", price: Number(price) })
                      }
                    >
                      儲存統一價格
                    </button>
                  </div>
                </div>
                <div className={managementStyles.settingBlock}>
                  <h3>{isCreatingForm ? "建立飯製表單" : "表單資訊"}</h3>
                  <p>
                    一份表單可加入多個 IP，客人展開 IP 後即可選擇各工藝與數量。
                  </p>
                  <div className={styles.fields}>
                    <label>
                      {isCreatingForm ? "新表單名稱" : "表單名稱"}
                      <input
                        maxLength={120}
                        disabled={busy}
                        value={isCreatingForm ? formTitle : selectedTitle}
                        onChange={(event) =>
                          isCreatingForm
                            ? setFormTitle(event.target.value)
                            : selectedForm &&
                              setFormDraft({
                                id: selectedForm.id,
                                title: event.target.value,
                              })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="primary"
                      disabled={
                        busy ||
                        (isCreatingForm
                          ? !formTitle.trim() || data?.price == null
                          : !selectedTitle.trim())
                      }
                      onClick={async () => {
                        if (isCreatingForm) {
                          if (
                            await action({
                              action: "create_form",
                              title: formTitle,
                            })
                          )
                            setCreatingForm(false);
                        } else if (selectedForm) {
                          if (
                            await action({
                              action: "form",
                              formId: selectedForm.id,
                              title: selectedTitle,
                              isOpen: selectedForm.isOpen,
                            })
                          )
                            setFormDraft(null);
                        }
                      }}
                    >
                      {isCreatingForm ? <Plus size={15} /> : <Save size={15} />}
                      {isCreatingForm ? "建立飯製表單" : "儲存表單設定"}
                    </button>
                  </div>
                  {isCreatingForm && data?.price == null && (
                    <p>請先儲存統一售價，再建立表單。</p>
                  )}
                  {selectedForm && !isCreatingForm && (
                    <div className={managementStyles.availability}>
                      <span>
                        {selectedForm.isOpen ? "開放接單中" : "已停止接單"}
                      </span>
                      <button
                        type="button"
                        className="outline"
                        disabled={busy}
                        onClick={() => {
                          if (
                            selectedForm.isOpen &&
                            !window.confirm(
                              "確定暫停這份飯製表單？已成立訂單不受影響。",
                            )
                          )
                            return;
                          void action({
                            action: "form",
                            formId: selectedForm.id,
                            title: selectedForm.title,
                            isOpen: !selectedForm.isOpen,
                          });
                        }}
                      >
                        {selectedForm.isOpen ? "暫停接單" : "開放接單"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </details>
          </section>

          <section className={styles.box}>
            <div className={managementStyles.catalogHeader}>
              <div>
                <span className="eyebrow">商品、工藝與實拍影片</span>
                <h2>飯製庫存與上架商品</h2>
              </div>
              <button
                type="button"
                className="primary"
                disabled={busy || (isCreatingForm && Boolean(selectedForm))}
                onClick={() => setBatchOpen(true)}
              >
                <ScanText size={16} />
                文字批量上架
              </button>
            </div>
            <p className={managementStyles.catalogHelp}>
              批量選取圖片、貼上工藝文字即可上架；展開 IP
              後，可調整各工藝庫存及上傳專屬實拍影片。
            </p>
            {pending ? (
              <p className={styles.notice}>
                有 {pending.items.length}{" "}
                件商品等待確認，可開啟批量上架視窗重試。
              </p>
            ) : rows.length > 0 ? (
              <p className={styles.notice}>
                已保留 {rows.length} 件商品草稿，可開啟批量上架視窗繼續編輯。
              </p>
            ) : null}
            {isCreatingForm && (
              <p className={styles.notice}>
                {selectedForm
                  ? "請先完成或取消新增表單，再將商品加入表單。"
                  : "尚未建立表單，也可以先批量上架至飯製庫存，之後再加入表單。"}
              </p>
            )}
            {data?.products.some(
              (product) =>
                product.videoStatus === "pending" ||
                product.videoStatus === "processing",
            ) && (
              <p
                className={styles.notice}
                role="status"
                aria-label="影片尚未公開提醒"
              >
                本頁有實拍影片正在排隊或處理中，目前客人還看不到觀看按鈕。影片處理完成後，已加入表單並開放的工藝商品才會顯示實拍；若一直停在排隊中，請確認影片處理服務已啟動，再按「重新載入」。
              </p>
            )}
            <div className={styles.toolbar}>
              <SearchField
                value={query}
                onChange={(value) => {
                  setQuery(value);
                  setPage(1);
                }}
                label="搜尋飯製 IP、名稱或工藝"
                placeholder="搜尋 IP、名稱或工藝…"
              />
              <button
                className="outline"
                disabled={
                  busy || isCreatingForm || !formId || selected.size === 0
                }
                onClick={() =>
                  void action({
                    action: "publish",
                    formId: formId!,
                    productIds: [...selected],
                  })
                }
              >
                選取商品加入表單（{selected.size}）
              </button>
              <button
                className="outline"
                disabled={
                  busy || isCreatingForm || !formId || selected.size === 0
                }
                onClick={() =>
                  void action({
                    action: "publish",
                    formId: formId!,
                    productIds: [...selected],
                    remove: true,
                  })
                }
              >
                從表單移出所選商品
              </button>
            </div>
            {loading && <p role="status">正在讀取飯製商品…</p>}
            {ipGroups.map(([ip, items]) => (
              <section
                className={styles.group}
                key={ip}
                style={
                  {
                    "--claim-border": "var(--color-line)",
                    "--claim-surface": "var(--color-white)",
                    "--claim-surface-text": "var(--color-dark)",
                    "--claim-surface-muted": "var(--color-muted)",
                  } as React.CSSProperties
                }
              >
                <button
                  className={styles.groupToggle}
                  aria-expanded={open.has(ip)}
                  onClick={() =>
                    setOpen((old) => {
                      const next = new Set(old);
                      if (next.has(ip)) next.delete(ip);
                      else next.add(ip);
                      return next;
                    })
                  }
                >
                  <span>
                    <b>{ip}</b>
                    <small>
                      本頁 {groupCatalogProducts(items).length} 件商品 ·{" "}
                      {items.length} 種工藝
                    </small>
                  </span>
                  <ChevronDown size={18} />
                </button>
                {open.has(ip) && (
                  <div className={styles.groupBody}>
                    <div className={styles.toolbar}>
                      <button
                        className="outline"
                        disabled={busy || isCreatingForm || !formId}
                        onClick={() =>
                          void action({
                            action: "publish_ip",
                            formId: formId!,
                            ipId: items[0].ipId,
                          })
                        }
                      >
                        整個 IP 加入表單
                      </button>
                      <button
                        className="outline"
                        disabled={busy || isCreatingForm || !formId}
                        onClick={() =>
                          void action({
                            action: "publish_ip",
                            formId: formId!,
                            ipId: items[0].ipId,
                            remove: true,
                          })
                        }
                      >
                        整個 IP 移出表單
                      </button>
                    </div>
                    <div className={styles.adminGrid}>
                      {groupCatalogProducts(items).map(
                        ([catalogId, variants]) => (
                          <section
                            className={styles.adminDesign}
                            key={catalogId}
                            aria-label={`${variants[0].title} 工藝與庫存`}
                          >
                            <div className={styles.productHeading}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={fanmadeMediaUrl(
                                  "product-images",
                                  variants[0].imagePaths?.[1] ||
                                    variants[0].imagePaths?.[0],
                                )}
                                alt={variants[0].title}
                                loading="lazy"
                              />
                              <div>
                                <h3>{variants[0].title}</h3>
                                <p>
                                  {variants.length} 種工藝 · 實際共{" "}
                                  {variants.reduce(
                                    (sum, p) => sum + p.stock,
                                    0,
                                  )}{" "}
                                  張 · 預留{" "}
                                  {variants.reduce(
                                    (sum, p) => sum + p.reserved,
                                    0,
                                  )}{" "}
                                  張
                                </p>
                                <label>
                                  <input
                                    type="checkbox"
                                    aria-label={`選取 ${variants[0].title} 全部工藝`}
                                    checked={variants.every((p) =>
                                      selected.has(p.id),
                                    )}
                                    disabled={busy}
                                    onChange={() =>
                                      setSelected((old) => {
                                        const next = new Set(old);
                                        const all = variants.every((p) =>
                                          next.has(p.id),
                                        );
                                        for (const p of variants) {
                                          if (all) next.delete(p.id);
                                          else next.add(p.id);
                                        }
                                        return next;
                                      })
                                    }
                                  />{" "}
                                  選取全部工藝
                                </label>
                              </div>
                            </div>
                            {variants.map((product) => (
                              <AdminProduct
                                key={product.id}
                                product={product}
                                selected={selected.has(product.id)}
                                busy={busy}
                                onSelect={() =>
                                  setSelected((old) => {
                                    const next = new Set(old);
                                    if (next.has(product.id))
                                      next.delete(product.id);
                                    else next.add(product.id);
                                    return next;
                                  })
                                }
                                onAction={(input) => action(input)}
                                onVideo={(file) =>
                                  uploadExisting(product, file)
                                }
                              />
                            ))}
                          </section>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </section>
            ))}
            {!loading && data?.products.length === 0 && (
              <p>目前沒有符合條件的飯製商品。</p>
            )}
            <div className={styles.toolbar}>
              <button
                className="outline"
                disabled={page <= 1 || loading}
                onClick={() => {
                  setPage(page - 1);
                  setSelected(new Set());
                }}
              >
                上一頁
              </button>
              <span>
                第 {page} 頁 · 共 {data?.total ?? 0} 件商品
              </span>
              <button
                className="outline"
                disabled={loading || page * 24 >= (data?.total ?? 0)}
                onClick={() => {
                  setPage(page + 1);
                  setSelected(new Set());
                }}
              >
                下一頁
              </button>
            </div>
          </section>
          {!!data?.legacy.length && (
            <section className={styles.box}>
              <h2>核對舊飯製資料後轉入</h2>
              <p>
                轉入會保留整筆原有數量，並從一般訂購表單移出，既有訂單保留。若舊商品包含多工藝，請先盤點各工藝數量；不會自動複製成多份庫存。
              </p>
              <label className={styles.fields}>
                確認轉入的單一工藝
                <input
                  value={legacyCraft}
                  onChange={(e) => setLegacyCraft(e.target.value)}
                  list="fanmade-crafts"
                />
              </label>
              {data.legacy.map((p) => (
                <div key={p.id} className={styles.toolbar}>
                  <span>
                    {p.name} · {p.stock} 張 · {(p.crafts ?? []).join("／")}
                  </span>
                  <button
                    className="outline"
                    disabled={
                      busy || !legacyCraft.trim() || data.price === null
                    }
                    onClick={() => {
                      if (
                        window.confirm(
                          `確認將「${p.name}」原有 ${p.stock} 張全部轉為「${legacyCraft}」獨立飯製商品，並從一般訂購表單移出（既有訂單保留）？`,
                        )
                      )
                        void action({
                          action: "migrate",
                          productId: p.id,
                          craft: legacyCraft,
                        });
                    }}
                  >
                    確認整筆轉入
                  </button>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
      <FanmadeBatchDialog
        open={batchOpen}
        busy={busy}
        onClose={() => setBatchOpen(false)}
        status={
          <>
            {error && (
              <p id="fanmade-batch-error" role="alert" data-state="error">
                {error}
              </p>
            )}
            <p
              id="fanmade-batch-help"
              role="status"
              data-state={
                busy ? "busy" : batchBlockedReason ? "blocked" : "ready"
              }
            >
              {batchBlockedReason ||
                (error
                  ? pending
                    ? "上次結果尚未確認，重試原批次不會重複建立商品。"
                    : "請修正上方提示的資料，再建立本批商品。"
                  : pending
                    ? "已保留原批次，重試不會重複建立商品。"
                    : `已預覽 ${rows.length} 件商品，請核對明細後建立。`)}
            </p>
            {!busy && !pending && data?.price == null && (
              <button
                type="button"
                className="outline"
                onClick={() => {
                  setBatchOpen(false);
                  setActiveTab("settings");
                  setMessage(
                    "本批圖片與影片草稿已保留，請先儲存飯製統一售價，再開啟批量上架繼續。",
                  );
                }}
              >
                前往設定統一售價
              </button>
            )}
            {!busy && !pending && dirtyImageKeys.size > 0 && (
              <button
                type="button"
                className="outline"
                onClick={() => {
                  const imageKey = dirtyImageKeys.values().next().value;
                  if (imageKey) focusImageCrafts(imageKey);
                }}
              >
                前往未套用的圖片
              </button>
            )}
            {!busy && error && batchIssue?.rowKey && (
              <button
                type="button"
                className="outline"
                onClick={focusBatchIssue}
              >
                查看問題欄位
              </button>
            )}
          </>
        }
        footer={
          <button
            className="primary"
            aria-describedby={
              error
                ? "fanmade-batch-error fanmade-batch-help"
                : "fanmade-batch-help"
            }
            disabled={
              busy ||
              (!pending && (!rows.length || dirtyImageKeys.size > 0)) ||
              data?.price == null
            }
            onClick={() => void createBatch()}
          >
            <Upload size={16} />
            {busy
              ? "處理中…"
              : pending
                ? "重試本批未完成項目"
                : "建立本批飯製商品"}
          </button>
        }
      >
        {error && <p className={styles.error}>{error}</p>}
        {message && (
          <p className={styles.notice} role="status">
            {message}
          </p>
        )}
        <p className={styles.notice}>
          {data?.price == null
            ? "請先在飯製管理主頁儲存統一價格，再建立商品。"
            : `飯製統一售價 NT$ ${data.price.toLocaleString("zh-TW")}，不用逐列填價。`}
          {selectedForm
            ? ` 本批商品會加入「${selectedForm.title}」。`
            : " 本批商品先存入飯製庫存，之後可選擇加入表單。"}
        </p>
        <p>
          一次選取圖片並貼上多種工藝，展開後最多 50
          件商品。每張圖片可各自增減工藝，例如圖一三種、圖二兩種。同一張圖片只上傳一次，各工藝分開管理庫存與影片。
        </p>
        <div className={styles.toolbar}>
          <button
            type="button"
            className="outline"
            disabled={locked}
            onClick={fillBatchExample}
          >
            帶入範例
          </button>
          <small>
            先填預設工藝並選圖，下方可逐張圖片修改工藝清單，再填各工藝庫存與影片。
          </small>
        </div>
        <fieldset className={styles.fields} disabled={locked}>
          <label>
            批次 IP
            <input
              aria-label="批次 IP"
              aria-describedby="fanmade-batch-ip-help"
              value={defaults.ip}
              onChange={(e) => changeBatchIp(e.target.value)}
              maxLength={200}
            />
            <small id="fanmade-batch-ip-help">
              例如「蜘蛛人」，只填一次，會自動帶入圖片。
            </small>
          </label>
          <label>
            預設工藝（文字批量）
            <textarea
              aria-label="預設工藝文字批量"
              value={defaults.craft}
              onChange={(e) =>
                setDefaults({ ...defaults, craft: e.target.value })
              }
              placeholder={"亮銀龍｜10\n水波紋｜6\n雷射｜3"}
              rows={4}
              maxLength={15000}
              aria-describedby="fanmade-craft-help"
            />
          </label>
          <label>
            預設庫存
            <input
              type="number"
              min="0"
              max="1000"
              step="1"
              value={defaults.stock}
              onChange={(e) =>
                setDefaults({ ...defaults, stock: e.target.value })
              }
            />
          </label>
          <label>
            工藝套用方式
            <select
              aria-label="工藝套用方式"
              value={craftMode}
              onChange={(e) => setCraftMode(e.target.value as typeof craftMode)}
            >
              <option value="per_image">
                新圖片先帶入預設工藝，再逐圖調整
              </option>
              <option value="in_order">依圖片順序，一張配一種工藝</option>
            </select>
          </label>
          <div className={styles.craftDefaults}>
            <p id="fanmade-craft-help">
              這裡只設定新加入圖片使用的工藝預設，不會改動現有圖片。每張圖可在下方貼上自己的工藝清單。填「工藝｜庫存」可指定數量，只填名稱則使用預設庫存。
            </p>
            {craftText.items.length > 0 && (
              <ul aria-label="工藝文字預覽" className={styles.craftPreview}>
                {craftText.items.map((item, index) => (
                  <li key={`${index}:${item.craft}`}>
                    {item.craft}
                    <b>{item.stock} 張</b>
                  </li>
                ))}
              </ul>
            )}
            {craftText.errors.map((error) => (
              <p key={error} className={styles.error} role="alert">
                {error}
              </p>
            ))}
            {craftText.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            {rows.length > 0 && (
              <p role="status">
                {imageCount} 張圖片 · 目前共 {rows.length} 件工藝商品
              </p>
            )}
            {plannedCount > 50 && (
              <p role="alert" className={styles.error}>
                若將預設套用到全部圖片，會超過每批 50
                件上限；現有逐圖預覽不受影響。
              </p>
            )}
            {defaultsChanged && (
              <p className={styles.notice}>
                工藝預設已更新，僅用於之後新增的圖片。現有圖片保留各自設定，可直接依下方預覽建立。
              </p>
            )}
            <button
              className="outline"
              type="button"
              onClick={applyCraftDefaults}
              disabled={locked || !canApplyCrafts}
              title="將預設工藝與庫存套用至全部圖片，取代原本的逐圖設定"
            >
              辨識並套用到本批圖片
            </button>
          </div>
        </fieldset>
        <datalist id="fanmade-crafts">
          <option value="亮銀龍" />
          <option value="水波紋" />
          <option value="雷射" />
          <option value="燙金" />
          <option value="霧面" />
        </datalist>
        <div
          className={`${styles.imageDropZone} ${draggingImages ? styles.imageDragOver : ""}`}
          role="group"
          aria-label="IP海報批量選圖"
          aria-disabled={locked}
          onDragOver={(event) => {
            event.preventDefault();
            if (!locked) setDraggingImages(true);
          }}
          onDragLeave={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            )
              setDraggingImages(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDraggingImages(false);
            selectImages(event.dataTransfer.files);
          }}
        >
          <div>
            <b>
              {defaults.ip.trim()
                ? `加入「${defaults.ip.trim()}」的海報圖片`
                : "一次加入多張海報圖片"}
            </b>
            <p>可多選、拖曳，或分次追加圖片；每張圖再各自設定工藝及影片。</p>
          </div>
          <button
            className="primary"
            type="button"
            disabled={locked}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus size={16} />
            一次選擇多張圖片
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            aria-label="批次上傳飯製圖片"
            disabled={locked}
            onChange={(e) => selectImages(e.target.files)}
            hidden
          />
          <span aria-label="本批商品數">
            {pending ? pending.items.length : rows.length} 件商品
          </span>
        </div>
        {pending && (
          <p className={styles.notice}>
            本批已送出或待確認，重試會沿用同一批次，不重複建檔。若重新整理後影片尚未補齊，可在商品清單另外上傳。
          </p>
        )}
        <FanmadeBatchIpGroup
          ip={
            defaults.ip ||
            (pending &&
            pending.items.every((item) => item.ip === pending.items[0].ip)
              ? pending.items[0].ip
              : pending
                ? "多IP待確認批次"
                : "")
          }
          imageCount={
            imageCount ||
            (pending
              ? new Set(pending.items.map((item) => item.imagePaths[0])).size
              : 0)
          }
          variantCount={pending?.items.length ?? rows.length}
          customIpCount={
            rows.filter(
              (row) => row.ip.trim() && row.ip.trim() !== defaults.ip.trim(),
            ).length
          }
          busy={locked}
          onAddImages={() => fileInput.current?.click()}
        >
          {imageGroups.map(([imageKey, source], imageIndex) => (
            <FanmadeImageCrafts
              key={imageKey}
              imageNumber={imageIndex + 1}
              title={source[0].title}
              preview={source[0].preview}
              crafts={source}
              text={imageCraftDrafts[imageKey] ?? formatImageCrafts(source)}
              defaultStock={defaults.stock}
              totalCount={rows.length}
              disabled={locked}
              dirty={dirtyImageKeys.has(imageKey)}
              onTitleChange={(title) => changeImageTitle(imageKey, title)}
              onTextChange={(text) => changeImageCraftText(imageKey, text)}
              onTextBlur={() => finishImageCraftText(imageKey)}
              onApply={() => applyImageCrafts(imageKey)}
            >
              {source.map((row) => (
                <div
                  className={styles.batchRow}
                  id={`fanmade-batch-row-${row.key}`}
                  key={row.key}
                  role="group"
                  aria-label={`${row.title}｜${row.craft}上架資料`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={row.preview} alt={`${row.title}上架預覽`} />
                  <div className={styles.batchMeta}>
                    <div className={styles.batchVariantHeading}>
                      <b>{row.craft || "尚未填寫工藝"}</b>
                      <span>本圖工藝專屬庫存與影片</span>
                    </div>
                    <fieldset
                      className={styles.fields}
                      disabled={locked || dirtyImageKeys.has(row.imageKey)}
                    >
                      <details className={styles.batchAdvanced}>
                        <summary>個別修改IP、名稱或工藝</summary>
                        <div className={styles.fields}>
                          <label>
                            IP
                            <input
                              data-fanmade-field="ip"
                              aria-invalid={
                                batchIssue?.rowKey === row.key &&
                                batchIssue.field === "ip"
                              }
                              value={row.ip}
                              onChange={(e) =>
                                change(row.key, { ip: e.target.value })
                              }
                              maxLength={200}
                            />
                          </label>
                          <label>
                            商品名稱
                            <input
                              data-fanmade-field="title"
                              aria-invalid={
                                batchIssue?.rowKey === row.key &&
                                batchIssue.field === "title"
                              }
                              value={row.title}
                              onChange={(e) =>
                                change(row.key, { title: e.target.value })
                              }
                              maxLength={200}
                            />
                          </label>
                          <label>
                            工藝
                            <input
                              data-fanmade-field="craft"
                              aria-invalid={
                                batchIssue?.rowKey === row.key &&
                                batchIssue.field === "craft"
                              }
                              value={row.craft}
                              list="fanmade-crafts"
                              onChange={(e) =>
                                change(row.key, { craft: e.target.value })
                              }
                              maxLength={100}
                            />
                          </label>
                        </div>
                      </details>
                      <label>
                        現貨庫存
                        <input
                          data-fanmade-field="stock"
                          aria-invalid={
                            batchIssue?.rowKey === row.key &&
                            batchIssue.field === "stock"
                          }
                          type="number"
                          min="0"
                          max="1000"
                          step="1"
                          value={row.stock}
                          onChange={(e) =>
                            change(row.key, { stock: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        {row.craft || "本工藝"}實拍影片（選填，最多100MB）
                        <input
                          type="file"
                          accept="video/mp4,video/quicktime,video/webm"
                          aria-label={`${row.title} ${row.craft}實拍影片`}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const invalid = validateFanmadeVideo(file);
                              if (invalid) setError(invalid);
                              else
                                change(row.key, {
                                  video: file,
                                  videoPath: undefined,
                                  queued: false,
                                });
                            }
                          }}
                        />
                      </label>
                      <button
                        className="outline"
                        type="button"
                        onClick={() => removeRow(row)}
                      >
                        移除此列
                      </button>
                    </fieldset>
                    <small>
                      {row.progress}
                      {row.video ? ` · ${row.video.name}` : ""}
                    </small>
                    {row.error && (
                      <p role="alert" className={styles.error}>
                        {row.error}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </FanmadeImageCrafts>
          ))}
        </FanmadeBatchIpGroup>
      </FanmadeBatchDialog>
    </div>
  );
}
function AdminProduct({
  product,
  selected,
  busy,
  onSelect,
  onAction,
  onVideo,
}: {
  product: FanmadeProduct;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onAction: (input: FanmadeAction) => Promise<boolean | undefined>;
  onVideo: (file: File) => Promise<void>;
}) {
  const [stock, setStock] = useState(String(product.stock)),
    [reason, setReason] = useState(""),
    [title, setTitle] = useState(product.title),
    [craft, setCraft] = useState(product.craft);
  useEffect(() => {
    setStock(String(product.stock));
    setTitle(product.title);
    setCraft(product.craft);
  }, [product.stock, product.title, product.craft]);
  return (
    <article
      className={styles.adminProduct}
      aria-label={`${product.title} ${product.craft}庫存`}
    >
      <div className={styles.productHeading}>
        <div>
          <label>
            <input
              type="checkbox"
              checked={selected}
              onChange={onSelect}
              disabled={busy}
              aria-label={`選取 ${product.title} ${product.craft}`}
            />{" "}
            {product.listed ? "已加入目前表單" : "未加入目前表單"}
          </label>
          <h3>{product.craft}</h3>
          <small>{product.sku}</small>
          <p>
            實際 {product.stock} · 已預留 {product.reserved} · 可售{" "}
            {Math.max(0, product.stock - product.reserved)}
          </p>
        </div>
      </div>
      <details>
        <summary>編輯商品與盤點</summary>
        <fieldset className={styles.fields} disabled={busy}>
          <label>
            商品名稱
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </label>
          <label>
            工藝
            <input
              value={craft}
              onChange={(e) => setCraft(e.target.value)}
              maxLength={100}
            />
          </label>
          <button
            type="button"
            className="outline"
            onClick={() =>
              void onAction({
                action: "edit",
                productId: product.id,
                updatedAt: product.updatedAt,
                title,
                craft,
              })
            }
          >
            儲存商品資料
          </button>
          <label>
            盤點後實際庫存
            <input
              type="number"
              min={product.reserved}
              max="1000"
              step="1"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
            />
          </label>
          <label>
            調整原因
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="補貨、盤點差異…"
            />
          </label>
          <button
            type="button"
            className="outline"
            disabled={!reason.trim() || stock.trim() === ""}
            onClick={() =>
              void onAction({
                action: "stock",
                productId: product.id,
                updatedAt: product.updatedAt,
                stock: Number(stock),
                reason,
              })
            }
          >
            更新實際庫存
          </button>
        </fieldset>
      </details>
      <div className={styles.toolbar}>
        <button
          className="outline"
          disabled={busy}
          onClick={() => {
            if (
              product.active &&
              !window.confirm("確定暫停此商品訂購？已成立訂單不受影響。")
            )
              return;
            void onAction({
              action: "active",
              productId: product.id,
              updatedAt: product.updatedAt,
              active: !product.active,
            });
          }}
        >
          {product.active ? "暫停商品" : "重新開放"}
        </button>
        <label className="outline">
          {product.videoStatus ? "更換／重試實拍" : "上傳商品實拍"}
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            hidden
            aria-label={`${product.title} ${product.craft}商品實拍`}
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onVideo(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {product.videoStatus === "failed" && (
        <button
          className="outline"
          disabled={busy}
          onClick={() =>
            void onAction({
              action: "retry_video",
              productId: product.id,
              updatedAt: product.updatedAt,
            })
          }
        >
          重試影片轉檔
        </button>
      )}
      <p>
        影片：
        {(
          {
            pending: "已上傳，等待轉檔；目前尚未對客人公開",
            processing: "背景轉檔中，完成後才會出現觀看按鈕",
            ready: product.active
              ? product.listed
                ? "已轉檔，可在目前表單觀看"
                : "已轉檔，請先加入目前表單"
              : "已轉檔，商品目前暫停中",
            failed: "處理失敗，可重試轉檔或重新選擇影片",
          } as const
        )[product.videoStatus!] || "尚未上傳"}
      </p>
      {product.videoError && (
        <p className={styles.error}>{product.videoError}</p>
      )}
    </article>
  );
}
