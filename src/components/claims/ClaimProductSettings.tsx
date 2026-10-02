"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clipboard,
  ExternalLink,
  Filter,
  ImageIcon,
  Link2,
  LoaderCircle,
  PackagePlus,
  Plus,
  RotateCcw,
  Search,
  Send,
  Trash2,
} from "lucide-react";

import { NewProduct } from "@/components/products/NewProduct";
import type { ClaimFormSettings } from "@/lib/claims";
import type { Product } from "@/lib/types";

const currency = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export type ProductDraft = {
  name: string;
  price: string;
  maxQuantity: string;
  isEnabled: boolean;
};

export function defaultProductDraft(product: Product): ProductDraft {
  return {
    name: product.name,
    price: String(product.price),
    maxQuantity: "20",
    isEnabled: true,
  };
}

export interface ClaimProductSettingsProps {
  ownerId: string;
  inventoryName: string;
  products: Product[];
  form: ClaimFormSettings | null;
  title: string;
  setTitle: (val: string) => void;
  description: string;
  setDescription: (val: string) => void;
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
  closesAt: string;
  setClosesAt: (val: string) => void;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  productDrafts: Record<string, ProductDraft>;
  setProductDrafts: React.Dispatch<
    React.SetStateAction<Record<string, ProductDraft>>
  >;
  saving: boolean;
  error: string;
  savedMessage: string;
  onSave: () => Promise<void>;
  publicPath: string;
  onReloadProducts?: () => Promise<void>;
  onNavigateToSubmissions?: () => void;
  onDeleteForm?: () => void;
  deletingForm?: boolean;
  onCancelNew?: () => void;
}

export function ClaimProductSettings({
  ownerId,
  inventoryName,
  products,
  form,
  title,
  setTitle,
  description,
  setDescription,
  isOpen,
  setIsOpen,
  closesAt,
  setClosesAt,
  selectedIds,
  setSelectedIds,
  productDrafts,
  setProductDrafts,
  saving,
  error,
  savedMessage,
  onSave,
  publicPath,
  onReloadProducts,
  onNavigateToSubmissions,
  onDeleteForm,
  deletingForm = false,
  onCancelNew,
}: ClaimProductSettingsProps) {
  const [showBasicSettings, setShowBasicSettings] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("全部");
  const [scopeFilter, setScopeFilter] = useState<
    "all" | "selected" | "unselected"
  >("all");
  const [creatingPreorder, setCreatingPreorder] = useState(false);
  const [copied, setCopied] = useState(false);

  // Map products by their dbId for quick lookup
  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) {
      if (p.dbId) map.set(p.dbId, p);
    }
    return map;
  }, [products]);

  // Distinct categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.category) set.add(p.category);
    }
    return ["全部", ...Array.from(set)];
  }, [products]);

  // Currently selected products list
  const selectedProductList = useMemo(() => {
    const list: Array<{ product: Product; draft: ProductDraft }> = [];
    for (const id of selectedIds) {
      const product = productMap.get(id);
      if (product) {
        list.push({
          product,
          draft: productDrafts[id] ?? defaultProductDraft(product),
        });
      }
    }
    return list;
  }, [productDrafts, productMap, selectedIds]);

  // Filtered inventory products for the picker
  const filteredInventoryProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (!p.dbId) return false;
      const isSelected = selectedIds.has(p.dbId);

      if (scopeFilter === "selected" && !isSelected) return false;
      if (scopeFilter === "unselected" && isSelected) return false;
      if (categoryFilter !== "全部" && p.category !== categoryFilter)
        return false;

      if (!q) return true;
      const text = [p.name, p.work, p.id, p.category, p.source]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    });
  }, [categoryFilter, products, scopeFilter, searchQuery, selectedIds]);

  // Validation checks
  const invalidProducts = useMemo(() => {
    const invalid: string[] = [];
    for (const { product, draft } of selectedProductList) {
      const nameValid =
        draft.name.trim().length > 0 && draft.name.length <= 300;
      const priceNum =
        draft.price.trim() === "" ? Number.NaN : Number(draft.price);
      const priceValid =
        Number.isFinite(priceNum) &&
        priceNum >= 0 &&
        priceNum <= 9_999_999_999.99 &&
        Math.abs(priceNum * 100 - Math.round(priceNum * 100)) < 1e-7;
      const qtyNum =
        draft.maxQuantity.trim() === ""
          ? Number.NaN
          : Number(draft.maxQuantity);
      const qtyValid = Number.isInteger(qtyNum) && qtyNum >= 1 && qtyNum <= 99;

      if (!nameValid || !priceValid || !qtyValid) {
        invalid.push(product.name);
      }
    }
    return invalid;
  }, [selectedProductList]);

  const hasInvalidProductSettings = invalidProducts.length > 0;

  function updateDraft(
    productId: string,
    field: keyof ProductDraft,
    value: string,
  ) {
    setProductDrafts((prev) => {
      const product = productMap.get(productId);
      const currentDraft =
        prev[productId] ??
        (product
          ? defaultProductDraft(product)
          : {
              name: "",
              price: "0",
              maxQuantity: "20",
              isEnabled: true,
            });
      return {
        ...prev,
        [productId]: {
          ...currentDraft,
          [field]: value,
        },
      };
    });
  }

  function toggleProductAvailability(productId: string) {
    setProductDrafts((prev) => {
      const product = productMap.get(productId);
      const currentDraft =
        prev[productId] ??
        (product
          ? defaultProductDraft(product)
          : {
              name: "",
              price: "0",
              maxQuantity: "20",
              isEnabled: true,
            });
      return {
        ...prev,
        [productId]: {
          ...currentDraft,
          isEnabled: !currentDraft.isEnabled,
        },
      };
    });
  }

  function toggleProduct(productId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
        const product = productMap.get(productId);
        if (product && !productDrafts[productId]) {
          setProductDrafts((curr) => ({
            ...curr,
            [productId]: defaultProductDraft(product),
          }));
        }
      }
      return next;
    });
  }

  function removeSelectedProduct(productId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(productId);
      return next;
    });
  }

  function resetProductDraft(productId: string) {
    const product = productMap.get(productId);
    if (!product) return;
    setProductDrafts((prev) => ({
      ...prev,
      [productId]: defaultProductDraft(product),
    }));
  }

  function addAllFiltered() {
    const toAdd = filteredInventoryProducts.filter(
      (p) => p.dbId && !selectedIds.has(p.dbId),
    );
    if (toAdd.length === 0) return;

    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of toAdd) {
        if (p.dbId) next.add(p.dbId);
      }
      return next;
    });

    setProductDrafts((prev) => {
      const next = { ...prev };
      for (const p of toAdd) {
        if (p.dbId && !next[p.dbId]) {
          next[p.dbId] = defaultProductDraft(p);
        }
      }
      return next;
    });
  }

  function clearAllSelected() {
    if (selectedIds.size === 0) return;
    if (
      window.confirm(
        "確定要清空所有已選入喊單的商品嗎？（既有喊單訂單紀錄不受影響）",
      )
    ) {
      setSelectedIds(new Set());
    }
  }

  async function copyLink() {
    if (!publicPath) return;
    const url = `${window.location.origin}${publicPath}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("複製以下喊單連結", url);
    }
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-6 lg:pb-28">
      {/* Top Banner with Quick Actions */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-[8px] border border-line bg-white p-5 shadow-sm">
        <div className="min-w-0">
          <span className="eyebrow">喊單頁專用商品設定 · {inventoryName}</span>
          <h2 className="mb-0 mt-1 break-words text-[20px] font-bold text-dark">
            {form ? `${form.title}｜公開喊單設定` : "新增 IP 喊單頁"}
          </h2>
          <p className="mb-0 mt-1 text-[13px] text-muted">
            每個 IP 使用獨立連結；喊單只累積需求，不會增加或扣除庫存。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onCancelNew && !form && (
            <button
              type="button"
              className="outline text-[13px]"
              onClick={onCancelNew}
              disabled={saving}
            >
              取消新增
            </button>
          )}
          {onDeleteForm && form && (
            <button
              type="button"
              className="outline text-[13px] text-danger hover:border-danger hover:bg-danger-soft"
              onClick={onDeleteForm}
              disabled={saving || deletingForm}
            >
              {deletingForm ? (
                <LoaderCircle className="animate-spin" size={15} />
              ) : (
                <Trash2 size={15} />
              )}
              移除此 IP
            </button>
          )}
          {publicPath && (
            <>
              <button
                type="button"
                className="outline text-[13px]"
                onClick={() => void copyLink()}
              >
                {copied ? (
                  <Check size={15} className="text-success" />
                ) : (
                  <Clipboard size={15} />
                )}
                {copied ? "已複製連結" : "複製喊單連結"}
              </button>
              <a
                className="outline inline-flex items-center gap-1.5 text-[13px] no-underline"
                href={publicPath}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} />
                預覽公開頁
              </a>
            </>
          )}
          {onNavigateToSubmissions && (
            <button
              type="button"
              className="outline text-[13px]"
              onClick={onNavigateToSubmissions}
            >
              檢視顧客喊單明細
            </button>
          )}
          <button
            type="button"
            className="primary text-[13px]"
            disabled={saving || !title.trim() || hasInvalidProductSettings}
            onClick={() => void onSave()}
          >
            {saving ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <Send size={16} />
            )}
            {saving ? "儲存中…" : form ? "儲存商品設定" : "發佈喊單頁"}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-[8px] bg-danger-soft px-4 py-3 text-[13px] text-danger">
          <AlertCircle size={17} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {savedMessage && (
        <div className="flex items-center gap-2 rounded-[8px] bg-success-soft px-4 py-3 text-[13px] text-success">
          <Check size={17} className="shrink-0" />
          <span>{savedMessage}</span>
        </div>
      )}

      <section className="rounded-[8px] border border-[#cbdde9] bg-[#eef5fa] p-5 md:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-white text-[#5a87b1]">
            <PackagePlus size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="mb-0 text-[16px] font-bold text-[#29485f]">
              預購喊單不用先開庫存
            </h3>
            <p className="mb-0 mt-1 text-[13px] leading-5 text-[#526b80]">
              顧客送出後只會列入需求統計，不會占用現貨。喊單截止後再依彙總數量向車頭採購，到貨後才辦理入庫。
            </p>
          </div>
        </div>
        <ol className="mt-4 grid list-none gap-2 p-0 sm:grid-cols-4">
          {[
            "開放預購喊單",
            "截止並彙總數量",
            "依需求向車頭採購",
            "到貨後再入庫",
          ].map((step, index) => (
            <li
              key={step}
              className="flex items-center gap-2 rounded-[8px] bg-white/80 px-3 py-2 text-[12px] font-semibold text-[#355b79]"
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#5a87b1] text-[10px] text-white">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </section>

      {/* Section 1: 表單基本資訊設定 (可收合/展開) */}
      <section className="rounded-[8px] border border-line bg-white p-4 shadow-sm md:p-6">
        <div className="flex min-w-0 items-start justify-between gap-3 sm:items-center">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-primary-soft text-primary">
              <Link2 size={18} />
            </span>
            <div className="min-w-0">
              <h3 className="mb-0 text-[17px] font-bold text-dark">
                表單資訊與規則
              </h3>
              <p className="mb-0 text-[12px] text-muted">
                買家進入喊單頁看到的標題、說明與截止狀態
              </p>
            </div>
          </div>
          <button
            type="button"
            className="outline size-10 shrink-0 p-0"
            onClick={() => setShowBasicSettings((v) => !v)}
            aria-expanded={showBasicSettings}
            aria-label={showBasicSettings ? "收合表單設定" : "展開表單設定"}
            title={showBasicSettings ? "收合表單設定" : "展開表單設定"}
          >
            <ChevronDown
              size={18}
              className={`transition-transform ${showBasicSettings ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
        </div>

        {showBasicSettings && (
          <div className="mt-5 grid gap-4 border-t border-line/70 pt-5 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="mb-1.5 block text-[13px] font-semibold text-dark">
                IP 名稱／喊單標題 <span className="text-danger">*</span>
              </span>
              <input
                className="min-h-11 w-full rounded-[8px] border border-line px-3 text-[16px] sm:text-[14px]"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="例：蜘蛛人"
              />
              <small className="mt-1 block text-[11px] text-muted">
                同一個 IP 只會建立一條固定喊單連結，之後可持續更新商品。
              </small>
            </label>

            <label className="block md:col-span-2">
              <span className="mb-1.5 block text-[13px] font-semibold text-dark">
                表單說明與購物須知
              </span>
              <textarea
                className="min-h-24 w-full resize-y rounded-[8px] border border-line px-3 py-2 text-[16px] sm:text-[13px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                placeholder="填寫截止日期、付款規則、取貨方式或到貨提醒…"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-dark">
                自動截止時間（選填）
              </span>
              <input
                className="min-h-11 w-full min-w-0 max-w-full rounded-[8px] border border-line px-3 text-[16px] sm:text-[13px]"
                type="datetime-local"
                value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)}
              />
              <small className="mt-1 block text-[11px] text-muted">
                到達指定時間後前台將自動停止接收喊單。
              </small>
            </label>

            <div className="flex items-center">
              <label className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-[8px] bg-light px-4 py-3.5">
                <div>
                  <b className="block text-[13px] text-dark">接受消費者喊單</b>
                  <small className="mt-1 block text-[12px] text-muted">
                    {isOpen
                      ? "公開頁目前正常接收喊單。"
                      : "暫停喊單，前台將顯示截止。"}
                  </small>
                </div>
                <input
                  className="peer sr-only"
                  type="checkbox"
                  role="switch"
                  checked={isOpen}
                  aria-label="接受消費者喊單"
                  onChange={(e) => setIsOpen(e.target.checked)}
                />
                <span
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary ${
                    isOpen ? "bg-success" : "bg-slate-300"
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${
                      isOpen ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </span>
              </label>
            </div>

            {onDeleteForm && form && (
              <div className="flex flex-col gap-2 rounded-[8px] border border-danger/25 bg-danger-soft/40 p-4 sm:flex-row sm:items-center sm:justify-between md:col-span-2">
                <div>
                  <h4 className="mb-0 text-[14px] font-bold text-danger">
                    危險操作：移除此 IP 喊單頁
                  </h4>
                  <p className="mb-0 text-[12px] text-muted">
                    {`移除後將刪除「${form.title}」的商品設定、公開連結與全部顧客喊單紀錄，且無法復原。`}
                  </p>
                </div>
                <button
                  type="button"
                  className="outline shrink-0 text-[13px] text-danger hover:border-danger hover:bg-danger-soft"
                  onClick={onDeleteForm}
                  disabled={saving || deletingForm}
                >
                  {deletingForm ? (
                    <LoaderCircle className="animate-spin" size={15} />
                  ) : (
                    <Trash2 size={15} />
                  )}
                  移除此 IP 喊單頁
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Section 2: 喊單專用商品清單 (已選入的商品與專屬設定) */}
      <section className="rounded-[8px] border border-line bg-white p-4 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 pb-3 md:pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="mb-0 text-[18px] font-bold text-dark">
                預購喊單商品
              </h3>
              <span className="rounded-[8px] bg-primary-soft px-3 py-1 text-[12px] font-bold text-primary">
                已選 {selectedProductList.length} 項
              </span>
            </div>
            <p className="mb-0 mt-1 text-[12px] text-muted">
              在此調整公開名稱、預購金額與每次送出的數量上限；這些數量不會先寫入庫存。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="outline text-[13px]"
              onClick={() => setCreatingPreorder(true)}
            >
              <PackagePlus size={16} className="text-primary" />
              <span className="sm:hidden">新增預購商品</span>
              <span className="hidden sm:inline">
                新增預購商品（不用先開庫存）
              </span>
            </button>
            {selectedProductList.length > 0 && (
              <button
                type="button"
                className="outline text-[13px] text-danger hover:border-danger hover:bg-danger-soft"
                onClick={clearAllSelected}
              >
                <Trash2 size={15} />
                清空已選商品
              </button>
            )}
          </div>
        </div>

        {/* Selected Products Table / Cards */}
        {selectedProductList.length === 0 ? (
          <div className="rounded-[8px] bg-light p-8 text-center text-muted">
            <PackagePlus size={36} className="mx-auto mb-2 text-muted/60" />
            <p className="mb-1 font-semibold text-dark">目前尚未加入公開商品</p>
            <p className="text-[13px]">
              可直接新增尚未進貨的預購商品，或從下方帶入既有商品資料；都不需要先增加庫存。
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-2 md:mt-4 md:space-y-3">
            {selectedProductList.map(({ product, draft }) => {
              const id = product.dbId!;
              const isModified =
                draft.name !== product.name ||
                draft.price !== String(product.price) ||
                draft.maxQuantity !== "20" ||
                !draft.isEnabled;

              return (
                <div
                  key={id}
                  className={`relative rounded-[8px] border p-3 shadow-sm transition md:p-4 ${
                    draft.isEnabled
                      ? "border-primary/40 bg-white hover:border-primary"
                      : "border-line bg-light/60"
                  }`}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 lg:flex lg:items-center lg:justify-between lg:gap-4">
                    {/* Product Master Info */}
                    <div className="flex min-w-0 items-center gap-2.5 lg:w-1/3 lg:gap-3">
                      {product.thumbnail || product.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="size-12 shrink-0 rounded-[8px] border border-line bg-light object-cover md:size-14 lg:size-16"
                          src={product.thumbnail || product.image}
                          alt=""
                        />
                      ) : (
                        <span className="grid size-12 shrink-0 place-items-center rounded-[8px] border border-line bg-light text-muted md:size-14 lg:size-16">
                          <ImageIcon size={22} aria-hidden="true" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-semibold text-muted">
                          {product.id} · {product.work}
                          {product.size ? ` · ${product.size}` : ""}
                        </span>
                        <h4
                          className="mb-0 truncate text-[14px] font-bold text-dark"
                          title={product.name}
                        >
                          {product.name}
                        </h4>
                        <label className="mt-1 inline-flex max-w-full cursor-pointer items-center gap-2 rounded-full bg-light px-2 py-1">
                          <span
                            className={`truncate text-[10px] font-bold ${
                              draft.isEnabled
                                ? "text-success"
                                : "text-slate-600"
                            }`}
                          >
                            {draft.isEnabled ? "開放喊單" : "暫停喊單"}
                          </span>
                          <input
                            className="peer sr-only"
                            type="checkbox"
                            role="switch"
                            checked={draft.isEnabled}
                            aria-label={`${product.name}開放喊單`}
                            onChange={() => toggleProductAvailability(id)}
                          />
                          <span
                            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary ${
                              draft.isEnabled ? "bg-success" : "bg-slate-300"
                            }`}
                            aria-hidden="true"
                          >
                            <span
                              className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform ${
                                draft.isEnabled
                                  ? "translate-x-4"
                                  : "translate-x-0"
                              }`}
                            />
                          </span>
                        </label>
                        <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted sm:mt-1 sm:gap-2 sm:text-[12px]">
                          <span className="shrink-0">
                            原價 {currency.format(product.price)}
                          </span>
                          <span className="shrink-0">·</span>
                          <span
                            className={`min-w-0 truncate font-medium ${
                              product.stock > 0
                                ? "text-success"
                                : "text-amber-600"
                            }`}
                          >
                            <span className="sm:hidden">
                              {product.stock > 0
                                ? `現貨 ${product.stock}`
                                : "預購未入庫"}
                            </span>
                            <span className="hidden sm:inline">
                              {product.stock > 0
                                ? `主檔現貨 ${product.stock} 件（喊單不扣）`
                                : "預購｜尚未入庫"}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions stay beside the product summary on narrow screens. */}
                    <div className="flex shrink-0 items-center gap-1.5 lg:order-3 lg:gap-2">
                      {isModified && (
                        <button
                          type="button"
                          className="outline size-9 p-0"
                          title="還原為庫藏原設定"
                          aria-label={`還原 ${product.name} 為庫藏原設定`}
                          onClick={() => resetProductDraft(id)}
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="outline size-9 p-0 text-danger hover:border-danger hover:bg-danger-soft"
                        title="移出喊單"
                        aria-label={`將 ${product.name} 移出喊單`}
                        onClick={() => removeSelectedProduct(id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    {/* Claim Specific Form Fields */}
                    <div className="col-span-2 grid min-w-0 grid-cols-2 gap-2.5 lg:order-2 lg:w-1/2 lg:flex-1 lg:grid-cols-3 lg:gap-3">
                      <label className="col-span-2 block lg:col-span-1">
                        <span className="mb-1 block text-[11px] font-bold text-dark">
                          公開商品名稱
                        </span>
                        <input
                          className="h-10 w-full min-w-0 rounded-[8px] border border-line bg-white px-3 text-[16px] font-medium lg:text-[13px]"
                          value={draft.name}
                          maxLength={300}
                          onChange={(e) =>
                            updateDraft(id, "name", e.target.value)
                          }
                          placeholder="前台顯示名稱"
                          aria-label={`${product.name}公開商品名稱`}
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-[11px] font-bold text-dark">
                          喊單金額 (TWD)
                        </span>
                        <input
                          className="h-10 w-full min-w-0 rounded-[8px] border border-line bg-white px-3 text-[16px] font-medium lg:text-[13px]"
                          type="number"
                          min="0"
                          max="9999999999.99"
                          step="0.01"
                          value={draft.price}
                          onChange={(e) =>
                            updateDraft(id, "price", e.target.value)
                          }
                          aria-label={`${product.name}喊單金額`}
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-[11px] font-bold text-dark">
                          單次限購數量
                        </span>
                        <input
                          className="h-10 w-full min-w-0 rounded-[8px] border border-line bg-white px-3 text-[16px] font-medium lg:text-[13px]"
                          type="number"
                          min="1"
                          max="99"
                          step="1"
                          value={draft.maxQuantity}
                          onChange={(e) =>
                            updateDraft(id, "maxQuantity", e.target.value)
                          }
                          aria-label={`${product.name}單次數量上限`}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 3: 從既有商品主檔帶入喊單資料 */}
      <section className="rounded-[8px] border border-line bg-white p-4 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="mb-0 text-[18px] font-bold text-dark">
              帶入既有商品資料
            </h3>
            <p className="mb-0 text-[12px] text-muted">
              可沿用圖片與品名快速建立預購項目；帶入後只統計需求，不會保留或扣除主檔現貨。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="outline text-[12px]"
              onClick={addAllFiltered}
              disabled={filteredInventoryProducts.every(
                (p) => p.dbId && selectedIds.has(p.dbId),
              )}
            >
              <Plus size={15} />
              加入所有篩選結果
            </button>
          </div>
        </div>

        {/* Filters Toolbar */}
        <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-3">
          <label className="flex h-11 min-w-0 items-center gap-2 rounded-[8px] border border-line px-3">
            <Search size={16} className="shrink-0 text-muted" />
            <input
              className="h-full min-w-0 flex-1 border-0 bg-transparent text-[16px] outline-none sm:text-[13px]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋品名、作品、SKU 或類別…"
            />
          </label>

          <div className="flex h-11 min-w-0 items-center gap-1 overflow-hidden rounded-[8px] border border-line p-1">
            <button
              type="button"
              className={`h-9 min-w-0 flex-1 rounded-[8px] px-2.5 text-[12px] font-medium transition sm:flex-none ${
                scopeFilter === "all"
                  ? "bg-primary text-white"
                  : "text-muted hover:bg-light"
              }`}
              onClick={() => setScopeFilter("all")}
            >
              全部
            </button>
            <button
              type="button"
              className={`h-9 min-w-0 flex-1 rounded-[8px] px-2.5 text-[12px] font-medium transition sm:flex-none ${
                scopeFilter === "unselected"
                  ? "bg-primary text-white"
                  : "text-muted hover:bg-light"
              }`}
              onClick={() => setScopeFilter("unselected")}
            >
              未加入
            </button>
            <button
              type="button"
              className={`h-9 min-w-0 flex-1 rounded-[8px] px-2.5 text-[12px] font-medium transition sm:flex-none ${
                scopeFilter === "selected"
                  ? "bg-primary text-white"
                  : "text-muted hover:bg-light"
              }`}
              onClick={() => setScopeFilter("selected")}
            >
              已選入
            </button>
          </div>

          {categories.length > 2 && (
            <div className="flex h-11 min-w-0 items-center gap-1 overflow-hidden rounded-[8px] border border-line p-1 sm:max-w-[190px]">
              <Filter size={14} className="ml-1.5 shrink-0 text-muted" />
              <select
                className="h-full min-w-0 flex-1 border-0 bg-transparent pr-2 text-[16px] font-medium text-dark outline-none sm:text-[12px]"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Inventory Products Grid */}
        <div className="mt-4 max-h-[440px] space-y-2 overflow-y-auto pr-1">
          {filteredInventoryProducts.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted">
              沒有符合條件的商品資料
            </p>
          ) : (
            filteredInventoryProducts.map((product) => {
              const id = product.dbId;
              if (!id) return null;
              const isSelected = selectedIds.has(id);

              return (
                <div
                  key={id}
                  className={`flex items-center justify-between gap-3 rounded-[8px] border px-3.5 py-2.5 transition ${
                    isSelected
                      ? "border-primary/50 bg-primary-soft/40"
                      : "border-line bg-white hover:border-primary/60"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {product.thumbnail || product.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="size-11 shrink-0 rounded-[8px] bg-light object-cover border border-line"
                        src={product.thumbnail || product.image}
                        alt=""
                      />
                    ) : (
                      <span className="grid size-11 shrink-0 place-items-center rounded-[8px] bg-light text-muted border border-line">
                        <ImageIcon size={18} aria-hidden="true" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <b className="block truncate text-[13px] text-dark">
                        {product.name}
                      </b>
                      <small className="block truncate text-[11px] text-muted">
                        {product.id} · {product.work} · 原價{" "}
                        {currency.format(product.price)} ·{" "}
                        <span
                          className={
                            product.stock > 0
                              ? "text-success"
                              : "text-amber-600"
                          }
                        >
                          {product.stock > 0
                            ? `主檔庫存 ${product.stock}（喊單不扣）`
                            : "尚未入庫（可預購）"}
                        </span>
                      </small>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {isSelected ? (
                      <button
                        type="button"
                        className="outline text-[12px] text-primary hover:text-danger hover:border-danger hover:bg-danger-soft"
                        onClick={() => toggleProduct(id)}
                      >
                        <Check size={14} className="text-primary" />
                        已在喊單頁
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="outline text-[12px]"
                        onClick={() => toggleProduct(id)}
                      >
                        <Plus size={14} />
                        加入喊單
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Keep actions in normal flow on small screens so they never cover content. */}
      <div className="claim-fixed-actions rounded-[8px] border border-line bg-white lg:rounded-none lg:border-x-0 lg:border-b-0 lg:bg-white/95 lg:backdrop-blur-md">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-9">
          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="text-[13px] font-semibold text-dark">
              已設定 {selectedProductList.length} 項公開商品
            </span>
            {hasInvalidProductSettings && (
              <span className="flex items-center gap-1 text-[12px] font-semibold text-danger">
                <AlertCircle size={15} className="shrink-0" />
                請確認商品名稱、金額與數量上限
              </span>
            )}
          </div>

          <div className="flex w-full items-center gap-2 sm:w-auto">
            {publicPath && (
              <a
                className="outline min-h-10 flex-1 justify-center text-[13px] no-underline sm:flex-none"
                href={publicPath}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} />
                預覽前台
              </a>
            )}
            {onCancelNew && !form && (
              <button
                type="button"
                className="outline min-h-10 flex-1 justify-center text-[13px] sm:flex-none"
                onClick={onCancelNew}
                disabled={saving}
              >
                取消新增
              </button>
            )}
            <button
              type="button"
              className="primary min-h-10 flex-1 justify-center sm:min-w-[150px] sm:flex-none"
              disabled={saving || !title.trim() || hasInvalidProductSettings}
              onClick={() => void onSave()}
            >
              {saving ? (
                <LoaderCircle className="animate-spin" size={17} />
              ) : (
                <Send size={17} />
              )}
              {saving ? "儲存中…" : form ? "儲存商品設定" : "發佈喊單頁"}
            </button>
          </div>
        </div>
      </div>

      {/* New Preorder Product Drawer */}
      {creatingPreorder && (
        <NewProduct
          ownerId={ownerId}
          initialStock={0}
          initialLocation=""
          title="新增喊單預購商品"
          preorderOnly
          onClose={() => setCreatingPreorder(false)}
          onCreated={async (newProductId) => {
            if (onReloadProducts) {
              await onReloadProducts();
            }
            if (newProductId) {
              setSelectedIds((prev) => new Set([...prev, newProductId]));
            }
          }}
        />
      )}
    </div>
  );
}
