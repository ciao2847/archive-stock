"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ClipboardList,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  X,
} from "lucide-react";

import {
  deleteClaimSubmission,
  fetchClaimFormManagement,
  removeClaimFormBanner,
  saveClaimForm,
  uploadClaimFormBanner,
} from "@/lib/api/claims";
import { createClaimFormBannerImage } from "@/lib/claim-form-assets";
import {
  DEFAULT_CLAIM_FORM_BANNER_POSITION,
  getDefaultClaimFormTheme,
  type ClaimFormBannerPosition,
  type ClaimFormTheme,
} from "@/lib/claim-form-theme";
import {
  sanitizeTaiwanMobilePhoneInput,
  TAIWAN_MOBILE_PHONE_ERROR,
  TAIWAN_MOBILE_PHONE_HTML_PATTERN,
  TAIWAN_MOBILE_PHONE_PATTERN,
  type ClaimFormManagement,
} from "@/lib/claims";
import type { Order, Product } from "@/lib/types";
import {
  ClaimProductSettings,
  defaultProductDraft,
  type ProductDraft,
} from "./ClaimProductSettings";
import { ClaimSubmissionsView } from "./ClaimSubmissionsView";

function toLocalDateTimeInput(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function csvCell(value: string | number) {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export type ClaimTab = "submissions" | "settings";

export function ClaimFormPanel({
  ownerId,
  inventoryName,
  products,
  orders,
  onReloadProducts,
  initialTab = "submissions",
}: {
  ownerId: string;
  inventoryName: string;
  products: Product[];
  orders: Order[];
  onReloadProducts?: () => Promise<void>;
  initialTab?: ClaimTab;
}) {
  const [activeTab, setActiveTab] = useState<ClaimTab>(initialTab);
  const [data, setData] = useState<ClaimFormManagement | null>(null);
  const [creatingForm, setCreatingForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneSearchError, setPhoneSearchError] = useState("");
  const [searchingCustomer, setSearchingCustomer] = useState(false);
  const [headerSearchTarget, setHeaderSearchTarget] =
    useState<HTMLElement | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [closesAt, setClosesAt] = useState("");
  const [bannerImagePath, setBannerImagePath] = useState("");
  const [bannerImageUrl, setBannerImageUrl] = useState("");
  const [bannerImageFile, setBannerImageFile] = useState<File | null>(null);
  const [bannerImageRemoved, setBannerImageRemoved] = useState(false);
  const [bannerPosition, setBannerPosition] = useState<ClaimFormBannerPosition>(
    DEFAULT_CLAIM_FORM_BANNER_POSITION,
  );
  const [theme, setTheme] = useState<ClaimFormTheme>(() =>
    getDefaultClaimFormTheme(inventoryName),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [productDrafts, setProductDrafts] = useState<
    Record<string, ProductDraft>
  >({});

  const load = useCallback(
    async (
      page = 1,
      updateDraft = page === 1,
      formId?: number,
      searchPhone?: string,
    ) => {
      if (!ownerId) return;
      if (updateDraft) {
        setData(null);
        setSelectedIds(new Set());
        setProductDrafts({});
      }
      setLoading(true);
      setError("");
      try {
        const next = await fetchClaimFormManagement(
          ownerId,
          formId,
          page,
          searchPhone,
        );
        setData(next);
        if (updateDraft) {
          setCreatingForm(!next.form);
          setTitle(next.form?.title ?? "");
          setDescription(next.form?.description ?? "");
          setIsOpen(next.form?.isOpen ?? false);
          setClosesAt(toLocalDateTimeInput(next.form?.closesAt));
          setBannerImagePath(next.form?.bannerImagePath ?? "");
          setBannerImageUrl(next.form?.bannerImageUrl ?? "");
          setBannerImageFile(null);
          setBannerImageRemoved(false);
          setBannerPosition(
            next.form?.bannerPosition ?? DEFAULT_CLAIM_FORM_BANNER_POSITION,
          );
          setTheme(next.form?.theme ?? getDefaultClaimFormTheme(inventoryName));
          setSelectedIds(
            new Set(next.form?.products.map((product) => product.productId)),
          );
          setProductDrafts(
            Object.fromEntries(
              (next.form?.products ?? []).map((product) => [
                product.productId,
                {
                  name: product.name,
                  price: String(product.price),
                  maxQuantity: String(product.maxQuantity),
                },
              ]),
            ),
          );
          if (!next.form) setActiveTab("settings");
        }
        return true;
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "喊單資料載入失敗",
        );
        return false;
      } finally {
        setLoading(false);
      }
    },
    [inventoryName, ownerId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setHeaderSearchTarget(
      document.getElementById("claim-customer-search-slot"),
    );
  }, []);

  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) {
      if (p.dbId) map.set(p.dbId, p);
    }
    return map;
  }, [products]);

  const selectedClaimProducts = useMemo(
    () =>
      Array.from(selectedIds).flatMap((productId) => {
        const product = productMap.get(productId);
        const draft =
          productDrafts[productId] ??
          (product ? defaultProductDraft(product) : undefined);
        if (!draft) return [];
        return [
          {
            productId,
            name: draft.name.trim(),
            price: draft.price.trim() === "" ? Number.NaN : Number(draft.price),
            maxQuantity:
              draft.maxQuantity.trim() === ""
                ? Number.NaN
                : Number(draft.maxQuantity),
          },
        ];
      }),
    [productDrafts, productMap, selectedIds],
  );

  const hasInvalidProductSettings = selectedClaimProducts.some(
    (product) =>
      !product.name ||
      product.name.length > 300 ||
      !Number.isFinite(product.price) ||
      product.price < 0 ||
      product.price > 9_999_999_999.99 ||
      Math.abs(product.price * 100 - Math.round(product.price * 100)) >= 1e-7 ||
      !Number.isInteger(product.maxQuantity) ||
      product.maxQuantity < 1 ||
      product.maxQuantity > 99,
  );

  const currentForm = creatingForm ? null : (data?.form ?? null);
  const publicPath = currentForm?.publicToken
    ? `/claim/${currentForm.publicToken}`
    : "";

  async function removeSubmission(submissionId: number, formId: number) {
    await deleteClaimSubmission({
      ownerId,
      formId,
      submissionId,
    });
  }

  async function searchCustomerByPhone(phone: string) {
    if (!currentForm) return;
    const loaded = await load(1, false, currentForm.id, phone || undefined);
    if (!loaded) throw new Error("顧客紀錄查詢失敗，請稍後再試。");
    setCustomerPhone(phone);
  }

  async function submitCustomerSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!TAIWAN_MOBILE_PHONE_PATTERN.test(phoneInput)) {
      setPhoneSearchError(TAIWAN_MOBILE_PHONE_ERROR);
      return;
    }

    setPhoneSearchError("");
    setSearchingCustomer(true);
    try {
      await searchCustomerByPhone(phoneInput);
      setActiveTab("submissions");
    } catch (searchError) {
      setPhoneSearchError(
        searchError instanceof Error
          ? searchError.message
          : "顧客紀錄查詢失敗，請稍後再試。",
      );
    } finally {
      setSearchingCustomer(false);
    }
  }

  async function clearCustomerSearch() {
    setPhoneInput("");
    setPhoneSearchError("");
    if (!customerPhone || !currentForm) return;

    setSearchingCustomer(true);
    try {
      await searchCustomerByPhone("");
    } catch (searchError) {
      setPhoneSearchError(
        searchError instanceof Error
          ? searchError.message
          : "顧客紀錄讀取失敗，請稍後再試。",
      );
    } finally {
      setSearchingCustomer(false);
    }
  }

  function startNewForm() {
    setCreatingForm(true);
    setActiveTab("settings");
    setCustomerPhone("");
    setPhoneInput("");
    setPhoneSearchError("");
    setError("");
    setSavedMessage("");
    setTitle("");
    setDescription("");
    setIsOpen(false);
    setClosesAt("");
    setBannerImagePath("");
    setBannerImageUrl("");
    setBannerImageFile(null);
    setBannerImageRemoved(false);
    setBannerPosition(DEFAULT_CLAIM_FORM_BANNER_POSITION);
    setTheme(getDefaultClaimFormTheme(inventoryName));
    setSelectedIds(new Set());
    setProductDrafts({});
  }

  function selectForm(formId: number) {
    if (currentForm?.id === formId) return;
    setCreatingForm(false);
    setCustomerPhone("");
    setPhoneInput("");
    setPhoneSearchError("");
    setSavedMessage("");
    void load(1, true, formId);
  }

  async function save(customIsOpen?: boolean) {
    if (hasInvalidProductSettings) {
      setError("請確認公開商品的名稱、金額與單次數量上限。");
      return;
    }
    setSaving(true);
    setError("");
    setSavedMessage("");
    const nextIsOpen = customIsOpen !== undefined ? customIsOpen : isOpen;
    let uploadedBannerPath = "";
    try {
      let nextBannerPath = bannerImageRemoved ? "" : bannerImagePath;
      if (bannerImageFile) {
        const bannerImage = await createClaimFormBannerImage(bannerImageFile);
        uploadedBannerPath = await uploadClaimFormBanner(bannerImage, ownerId);
        nextBannerPath = uploadedBannerPath;
      }

      const saved = await saveClaimForm({
        formId: currentForm?.id,
        ownerId,
        title,
        description,
        isOpen: nextIsOpen,
        closesAt: closesAt ? new Date(closesAt).toISOString() : undefined,
        bannerImagePath: nextBannerPath,
        bannerPosition,
        theme,
        products: selectedClaimProducts,
      });
      if (bannerImagePath && bannerImagePath !== nextBannerPath) {
        await removeClaimFormBanner(bannerImagePath).catch(() => undefined);
      }
      setCreatingForm(false);
      await load(1, true, saved.formId, customerPhone || undefined);
      setSavedMessage(
        nextIsOpen ? "設定已儲存，公開頁目前可接受喊單。" : "設定已儲存。",
      );
    } catch (saveError) {
      if (uploadedBannerPath) {
        await removeClaimFormBanner(uploadedBannerPath).catch(() => undefined);
      }
      setError(
        saveError instanceof Error ? saveError.message : "喊單設定儲存失敗",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleOpenState() {
    const nextState = !isOpen;
    setIsOpen(nextState);
    await save(nextState);
  }

  function downloadSummary() {
    if (!data) return;
    const rows = [
      ["商品 ID", "商品名稱", "喊單總數", "喊單人數"],
      ...data.productTotals.map((product) => [
        product.sku,
        product.name,
        product.quantity,
        product.customerCount,
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${currentForm?.title || "喊單"}-採購統計-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (loading && !data) {
    return (
      <div className="grid min-h-[320px] place-items-center rounded-[8px] border border-line bg-white">
        <span className="flex items-center gap-2 text-muted">
          <LoaderCircle className="animate-spin" size={19} />
          正在讀取喊單資料…
        </span>
      </div>
    );
  }

  if (!data && error) {
    return (
      <div className="rounded-[8px] border border-danger/20 bg-white px-6 py-10 text-center">
        <p className="m-0 text-[14px] text-danger">{error}</p>
        <button
          type="button"
          className="outline mt-5"
          onClick={() => void load()}
        >
          <RefreshCw size={16} />
          重新讀取
        </button>
      </div>
    );
  }

  return (
    <>
      {headerSearchTarget &&
        currentForm &&
        createPortal(
          <form
            className="search"
            role="search"
            onSubmit={(event) => void submitCustomerSearch(event)}
          >
            <Search className="shrink-0" size={18} aria-hidden="true" />
            <input
              type="tel"
              inputMode="numeric"
              value={phoneInput}
              onChange={(event) => {
                setPhoneInput(
                  sanitizeTaiwanMobilePhoneInput(event.target.value),
                );
                event.currentTarget.setCustomValidity("");
                setPhoneSearchError("");
              }}
              onInvalid={(event) =>
                event.currentTarget.setCustomValidity(TAIWAN_MOBILE_PHONE_ERROR)
              }
              minLength={10}
              maxLength={10}
              pattern={TAIWAN_MOBILE_PHONE_HTML_PATTERN}
              placeholder="輸入電話，查詢顧客的喊單與訂單"
              aria-label="查詢顧客的喊單與訂單"
              aria-invalid={Boolean(phoneSearchError)}
              aria-describedby={
                phoneSearchError ? "claim-header-phone-error" : undefined
              }
              autoComplete="off"
              required
            />
            {phoneInput && (
              <button
                type="button"
                className="search-clear"
                onClick={() => void clearCustomerSearch()}
                aria-label="清除電話查詢"
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
            <button
              type="submit"
              className="search-submit"
              disabled={loading || searchingCustomer}
              aria-label={searchingCustomer ? "查詢中" : "查詢"}
            >
              {searchingCustomer ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Search size={14} />
              )}
              <span>{searchingCustomer ? "查詢中" : "查詢"}</span>
            </button>
          </form>,
          headerSearchTarget,
        )}

      <div className="claim-management min-w-0 space-y-5">
        {phoneSearchError && (
          <div
            id="claim-header-phone-error"
            className="rounded-[8px] bg-danger-soft px-4 py-3 text-[13px] text-danger"
            role="alert"
          >
            {phoneSearchError}
          </div>
        )}
        <div className="flex flex-wrap items-stretch justify-between gap-4 rounded-[8px] border border-line bg-white p-4 shadow-sm md:items-center md:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-primary-soft text-primary">
              <Link2 size={19} />
            </span>
            <div className="min-w-0">
              <span className="eyebrow">一個 IP，一個專屬連結</span>
              <h2 className="mb-0 mt-0.5 text-[18px] font-bold text-dark">
                IP 喊單連結
              </h2>
              <p className="mb-0 mt-1 text-[12px] text-muted">
                每個 IP 的商品、顧客喊單與分享網址都會分開統計。
              </p>
            </div>
          </div>

          <div className="flex w-full min-w-0 flex-col items-stretch gap-2 md:w-auto md:min-w-[280px] md:flex-1 md:flex-row md:items-center md:justify-end lg:flex-initial">
            <select
              className="min-h-10 w-full min-w-0 rounded-[8px] border border-line bg-white px-3 text-[13px] font-semibold text-dark md:min-w-[210px] md:flex-1 lg:flex-initial"
              aria-label="選擇 IP 喊單連結"
              value={
                creatingForm ? "new" : currentForm ? String(currentForm.id) : ""
              }
              onChange={(event) => {
                if (event.target.value === "new") return;
                selectForm(Number(event.target.value));
              }}
              disabled={loading || saving}
            >
              {!currentForm && !creatingForm && (
                <option value="">尚未建立 IP 喊單</option>
              )}
              {creatingForm && <option value="new">新增 IP（尚未發佈）</option>}
              {data?.forms.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.title} · {form.isOpen ? "接單中" : "已暫停"}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="primary w-full justify-center whitespace-nowrap text-[13px] md:w-auto"
              onClick={startNewForm}
              disabled={creatingForm || saving}
            >
              <Plus size={16} />
              新增 IP 喊單
            </button>
          </div>
        </div>

        {/* Top Tab Navigation */}
        <div className="flex flex-col items-stretch gap-3 border-b border-line pb-3 md:flex-row md:items-center md:justify-between">
          <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:items-center">
            <button
              type="button"
              className={`flex min-h-12 min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-[8px] px-2 py-2.5 text-[13px] font-semibold transition md:gap-2 md:px-4 md:text-[14px] ${
                activeTab === "submissions"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted hover:bg-light hover:text-dark"
              }`}
              onClick={() => currentForm && setActiveTab("submissions")}
              disabled={!currentForm}
            >
              <ClipboardList className="shrink-0" size={17} />
              <span className="min-w-0 text-center leading-tight">
                <span className="md:hidden">喊單明細</span>
                <span className="hidden md:inline">喊單明細與採購</span>
              </span>
              {currentForm && data?.summary.customerCount ? (
                <span
                  className={`shrink-0 whitespace-nowrap rounded-[8px] px-1.5 py-0.5 text-[10px] font-bold md:px-2 md:text-[11px] ${activeTab === "submissions" ? "bg-white/25 text-white" : "bg-light text-muted"}`}
                >
                  {data.summary.customerCount}
                  <span className="hidden sm:inline"> 人</span>
                </span>
              ) : null}
            </button>

            <button
              type="button"
              className={`flex min-h-12 min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-[8px] px-2 py-2.5 text-[13px] font-semibold transition md:gap-2 md:px-4 md:text-[14px] ${
                activeTab === "settings"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted hover:bg-light hover:text-dark"
              }`}
              onClick={() => setActiveTab("settings")}
            >
              <Settings2 className="shrink-0" size={17} />
              <span className="min-w-0 text-center leading-tight">
                <span className="md:hidden">商品設定</span>
                <span className="hidden md:inline">喊單商品設定頁（專用）</span>
              </span>
              {selectedIds.size > 0 && (
                <span
                  className={`shrink-0 whitespace-nowrap rounded-[8px] px-1.5 py-0.5 text-[10px] font-bold md:px-2 md:text-[11px] ${activeTab === "settings" ? "bg-white/25 text-white" : "bg-light text-muted"}`}
                >
                  {selectedIds.size}
                  <span className="hidden sm:inline"> 項</span>
                </span>
              )}
            </button>
          </div>

          {currentForm?.publicToken && (
            <span className="w-full text-[12px] text-muted md:w-auto md:text-right">
              表單狀態：
              <b
                className={isOpen ? "text-success font-semibold" : "text-muted"}
              >
                {isOpen ? " 開放接單中" : " 已停止接單"}
              </b>
            </span>
          )}
        </div>

        {/* Tab Content */}
        {activeTab === "submissions" && data && currentForm && (
          <ClaimSubmissionsView
            data={data}
            loading={loading}
            orders={orders}
            customerPhone={customerPhone}
            publicPath={publicPath}
            isOpen={isOpen}
            onToggleOpen={toggleOpenState}
            onNavigateToSettings={() => setActiveTab("settings")}
            onClearCustomerSearch={clearCustomerSearch}
            onReload={async (page) => {
              await load(
                page ?? 1,
                false,
                currentForm.id,
                customerPhone || undefined,
              );
            }}
            onDeleteSubmission={removeSubmission}
            onDownloadSummary={downloadSummary}
          />
        )}

        {activeTab === "settings" && (
          <ClaimProductSettings
            ownerId={ownerId}
            inventoryName={inventoryName}
            products={products}
            form={currentForm}
            title={title}
            setTitle={setTitle}
            description={description}
            setDescription={setDescription}
            isOpen={isOpen}
            setIsOpen={setIsOpen}
            closesAt={closesAt}
            setClosesAt={setClosesAt}
            bannerImageUrl={bannerImageUrl}
            bannerImageFile={bannerImageFile}
            bannerImageRemoved={bannerImageRemoved}
            bannerPosition={bannerPosition}
            onSelectBannerImage={(file) => {
              setBannerImageFile(file);
              setBannerImageRemoved(false);
              setBannerPosition(DEFAULT_CLAIM_FORM_BANNER_POSITION);
            }}
            onRemoveBannerImage={() => {
              setBannerImageFile(null);
              setBannerImageRemoved(true);
              setBannerPosition(DEFAULT_CLAIM_FORM_BANNER_POSITION);
            }}
            onBannerPositionChange={setBannerPosition}
            theme={theme}
            setTheme={setTheme}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            productDrafts={productDrafts}
            setProductDrafts={setProductDrafts}
            saving={saving}
            error={error}
            savedMessage={savedMessage}
            onSave={() => save()}
            publicPath={publicPath}
            onReloadProducts={onReloadProducts}
            onNavigateToSubmissions={
              currentForm ? () => setActiveTab("submissions") : undefined
            }
          />
        )}
      </div>
    </>
  );
}
