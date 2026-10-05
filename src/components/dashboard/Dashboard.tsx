"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import swal from "sweetalert";
import {
  Boxes,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  Images,
  Megaphone,
  Menu,
  Plus,
  Printer,
  QrCode,
  Search,
  Settings,
  Warehouse,
  WalletCards,
  X,
} from "lucide-react";
import { DashboardView, Order, Product } from "@/lib/types";
import { ProductPanel } from "@/components/products/ProductPanel";
import { PackingPanel } from "@/components/packing/PackingPanel";
import { NewProduct } from "@/components/products/NewProduct";
import { LocationManager } from "@/components/locations/LocationManager";
import { SystemSettings } from "@/components/settings/SystemSettings";
import { NewOrder } from "@/components/orders/NewOrder";
import { SettlementPanel } from "@/components/settlement/SettlementPanel";
import { EditOrderAmount } from "@/components/orders/EditOrderAmount";
import { DataState } from "@/components/ui/DataState";
import { useProductsData } from "@/hooks/useProductsData";
import { useOrdersData } from "@/hooks/useOrdersData";
import { useAccountData } from "@/hooks/useAccountData";
import { useAppDispatch } from "@/store/hooks";
import { archiveOrder } from "@/store/slices/ordersSlice";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { OrderTable } from "@/components/orders/OrderTable";
import { ProductTable } from "@/components/products/ProductTable";
import { Overview } from "./Overview";
import {
  groupOrdersByCustomer,
  PackingQueue,
  type PackingCustomer,
} from "@/components/packing/PackingQueue";
import { downloadPrintLabels } from "@/lib/api/print-labels";
import { ClaimFormPanel } from "@/components/claims/ClaimFormPanel";
import { BundleClaimPanel } from "@/components/bundle-claims/BundleClaimPanel";
import type { ClaimTab } from "@/components/claims/ClaimFormPanel";

type View = DashboardView;

type SearchValue = string | number | null | undefined | readonly SearchValue[];

const HEADER_SEARCH_CONFIG: Partial<
  Record<View, { label: string; placeholder: string }>
> = {
  products: {
    label: "搜尋商品庫存",
    placeholder: "搜尋作品、商品 ID、版本、庫位…",
  },
  orders: {
    label: "搜尋訂單",
    placeholder: "搜尋訂單編號、客戶、電話、商品…",
  },
  packing: {
    label: "搜尋待包貨客人",
    placeholder: "搜尋客戶、電話、訂單或商品…",
  },
  locations: {
    label: "搜尋庫位",
    placeholder: "搜尋庫位代碼或說明…",
  },
};

function searchValueToText(value: SearchValue): string {
  if (Array.isArray(value)) return value.map(searchValueToText).join(" ");
  return value == null ? "" : String(value);
}

function matchesSearch(query: string, values: readonly SearchValue[]) {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");
  if (!normalizedQuery) return true;
  return values
    .map(searchValueToText)
    .join(" ")
    .toLocaleLowerCase("zh-TW")
    .includes(normalizedQuery);
}

const EMPTY_PRODUCTS: Product[] = [];
const EMPTY_ORDERS: Order[] = [];
const EMPTY_OWNERS: Array<{ id: string; name: string }> = [];

export function Dashboard({ authScope }: { authScope: string }) {
  const dispatch = useAppDispatch();
  const {
    data: productsData,
    error: productsError,
    loading,
    refresh: reloadProducts,
  } = useProductsData(authScope);
  const {
    data: ordersData,
    error: ordersError,
    loading: ordersLoading,
    refresh: reloadOrders,
  } = useOrdersData(authScope);
  const {
    data: accountData,
    error: accountError,
    loading: accountLoading,
    refresh: reloadAccount,
  } = useAccountData(authScope);
  const products = productsData ?? EMPTY_PRODUCTS;
  const orders = ordersData ?? EMPTY_ORDERS;
  const isAdmin = accountData?.isAdmin ?? false;
  const canManageOrders = Boolean(accountData);
  const roleLoaded = !accountLoading;
  const userName = accountData?.userName ?? "使用者";
  const availableOwners = accountData?.availableOwners ?? EMPTY_OWNERS;
  const loadError = [productsError, ordersError, accountError]
    .filter((message): message is string => Boolean(message))
    .join("；");

  const loadProducts = useCallback(async () => {
    await Promise.allSettled([reloadProducts(), reloadAccount()]);
  }, [reloadAccount, reloadProducts]);
  const loadOrders = useCallback(async () => {
    await Promise.allSettled([reloadOrders(), reloadAccount()]);
  }, [reloadAccount, reloadOrders]);
  const loadAllData = useCallback(async () => {
    await Promise.allSettled([
      reloadProducts(),
      reloadOrders(),
      reloadAccount(),
    ]);
  }, [reloadAccount, reloadOrders, reloadProducts]);

  const [view, setView] = useState<View>("dashboard");
  const [claimInitialTab, setClaimInitialTab] =
    useState<ClaimTab>("submissions");
  const [searchQueries, setSearchQueries] = useState<
    Partial<Record<View, string>>
  >({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [selectedCustomer, setSelectedCustomer] =
    useState<PackingCustomer | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [greeting, setGreeting] = useState("您好");
  const [todayLabel, setTodayLabel] = useState("");
  const [selectedOwnerId, setSelectedOwnerId] = useState("");
  const [printSelectionMode, setPrintSelectionMode] = useState(false);
  const [printProductIds, setPrintProductIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [preparingPrint, setPreparingPrint] = useState(false);
  const query = searchQueries[view] ?? "";
  const searchConfig =
    view === "packing" && selectedCustomer
      ? undefined
      : HEADER_SEARCH_CONFIG[view];
  const setQuery = useCallback(
    (value: string) => {
      setSearchQueries((current) => ({ ...current, [view]: value }));
    },
    [view],
  );
  const activeInventoryName =
    availableOwners.find((owner) => owner.id === selectedOwnerId)?.name ??
    "目前庫藏";
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        searchConfig &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [searchConfig]);
  useEffect(() => {
    const updateGreeting = () => {
      const now = new Date();
      const hour = Number(
        new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          hourCycle: "h23",
          timeZone: "Asia/Taipei",
        }).format(now),
      );
      setGreeting(
        hour >= 5 && hour < 12 ? "早安" : hour < 18 ? "午安" : "晚安",
      );
      setTodayLabel(
        new Intl.DateTimeFormat("zh-TW", {
          year: "numeric",
          month: "long",
          day: "numeric",
          weekday: "long",
          timeZone: "Asia/Taipei",
        })
          .format(now)
          .replace(/(日)(?=星期)/, "$1 · "),
      );
    };
    updateGreeting();
    const timer = window.setInterval(updateGreeting, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!accountData) return;
    if (!accountData.isAdmin) {
      setSelectedOwnerId(accountData.inventoryOwnerId);
      return;
    }
    setSelectedOwnerId((current) => {
      if (availableOwners.some((owner) => owner.id === current)) return current;
      const saved = window.localStorage.getItem("archive-stock-owner-id");
      if (saved && availableOwners.some((owner) => owner.id === saved)) {
        return saved;
      }
      return accountData.inventoryOwnerId || availableOwners[0]?.id || "";
    });
  }, [accountData, availableOwners]);
  const scopedProducts = useMemo(
    () =>
      selectedOwnerId
        ? products.filter((product) => product.ownerId === selectedOwnerId)
        : EMPTY_PRODUCTS,
    [products, selectedOwnerId],
  );
  const scopedOrders = useMemo(
    () =>
      selectedOwnerId
        ? orders.filter((order) => order.ownerId === selectedOwnerId)
        : EMPTY_ORDERS,
    [orders, selectedOwnerId],
  );
  const finance = selectedOwnerId
    ? (accountData?.financeByOwner[selectedOwnerId] ?? null)
    : null;
  const filteredProducts = useMemo(
    () =>
      scopedProducts.filter((product) =>
        matchesSearch(query, [
          product.id,
          product.dbId,
          product.name,
          product.ownerName,
          product.work,
          product.category,
          product.country,
          product.source,
          product.format,
          product.size,
          product.crafts,
          product.location,
          product.status,
          product.feature,
          product.description,
          product.stock,
          product.price,
        ]),
      ),
    [query, scopedProducts],
  );
  const filteredOrders = useMemo(
    () =>
      scopedOrders.filter((order) =>
        matchesSearch(query, [
          order.id,
          order.customer,
          order.customerNickname,
          order.customerContact,
          order.createdAt,
          order.status,
          order.payment,
          order.itemIds,
          order.total,
          order.items.flatMap((item) => [item.sku, item.name]),
        ]),
      ),
    [query, scopedOrders],
  );
  const packingCount = groupOrdersByCustomer(scopedOrders).length;
  const selectCustomerForOrder = useCallback(
    (order: Order) => {
      const customer = groupOrdersByCustomer(scopedOrders).find(
        (candidate) => candidate.key === order.customerKey,
      );
      setSelectedCustomer(customer ?? null);
      setView("packing");
    },
    [scopedOrders],
  );
  const nav = [
    { id: "dashboard", label: "總覽", icon: LayoutDashboard },
    { id: "products", label: "商品庫存", icon: Boxes },
    { id: "claims", label: "喊單管理", icon: Megaphone },
    { id: "bundle-claims", label: "單張大禮包喊單系統", icon: Images },
    { id: "orders", label: "訂單管理", icon: ClipboardList },
    { id: "packing", label: "掃碼出貨", icon: QrCode },
  ] as const;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <div className="brand">
          <BrandLogo inverse preload size="small" />
          <button
            className="icon-btn close-mobile"
            onClick={() => setMobile(false)}
          >
            <X />
          </button>
        </div>
        <nav>
          {nav?.map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "active" : ""}
              onClick={() => {
                if (n.id === "claims") setClaimInitialTab("submissions");
                setView(n.id);
                setMobile(false);
              }}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === "packing" && packingCount > 0 && (
                <em>{packingCount}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="side-section">
          <span>管理</span>
          <button
            className={view === "locations" ? "active" : ""}
            onClick={() => {
              setView("locations");
              setMobile(false);
            }}
          >
            <Warehouse size={18} />
            庫位管理
          </button>
          <button
            className={view === "settlement" ? "active" : ""}
            onClick={() => {
              setView("settlement");
              setMobile(false);
            }}
          >
            <WalletCards size={18} />
            財務結算
          </button>
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => {
              setView("settings");
              setMobile(false);
            }}
          >
            <Settings size={18} />
            系統設定
          </button>
        </div>
        <button
          type="button"
          className="profile"
          onClick={() => {
            setView("settings");
            setMobile(false);
          }}
          aria-label="開啟系統設定"
        >
          <div className="avatar">{userName.slice(0, 1).toUpperCase()}</div>
          <div>
            <b>{userName}</b>
            <small>{isAdmin ? "超級管理員" : "個別使用者"}</small>
          </div>
          <ChevronRight size={17} />
        </button>
      </aside>
      <main>
        <header>
          <button
            className="icon-btn menu"
            onClick={() => setMobile(true)}
            aria-label="開啟導覽選單"
            aria-expanded={mobile}
          >
            <Menu />
          </button>
          {view === "claims" ? (
            <div
              id="claim-customer-search-slot"
              className="min-w-0 flex-1"
              aria-live="polite"
            />
          ) : searchConfig ? (
            <form
              className="search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                searchInputRef.current?.blur();
              }}
            >
              <Search className="shrink-0" size={18} aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  if (query) setQuery("");
                  else event.currentTarget.blur();
                }}
                placeholder={searchConfig.placeholder}
                aria-label={searchConfig.label}
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => {
                    setQuery("");
                    searchInputRef.current?.focus();
                  }}
                  aria-label="清除搜尋"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              )}
              <button type="submit" className="search-submit" aria-label="查詢">
                <Search size={14} aria-hidden="true" />
                <span>查詢</span>
              </button>
            </form>
          ) : null}
        </header>
        <div className="content">
          {view === "packing" ? (
            selectedCustomer ? (
              <PackingPanel
                customer={selectedCustomer}
                products={scopedProducts}
                onBack={() => {
                  setSelectedCustomer(null);
                  setView("orders");
                }}
                onCompleted={() => {
                  void loadAllData();
                }}
                packerName={userName}
              />
            ) : (
              <DataState
                loading={ordersLoading}
                isEmpty={packingCount === 0}
                loadingText="正在讀取待包貨訂單…"
                emptyText="目前沒有待包貨訂單"
              >
                <PackingQueue
                  orders={scopedOrders}
                  query={query}
                  onPack={(customer) => setSelectedCustomer(customer)}
                />
              </DataState>
            )
          ) : (
            <>
              <div className="page-title">
                <div>
                  <span className="eyebrow">{todayLabel || "日期載入中…"}</span>
                  <h1>
                    {view === "products"
                      ? "商品庫存"
                      : view === "claims"
                        ? "喊單管理"
                        : view === "bundle-claims"
                          ? "單張大禮包喊單系統"
                          : view === "orders"
                            ? "訂單管理"
                            : view === "locations"
                              ? "庫位管理"
                              : view === "settlement"
                                ? "財務結算"
                                : view === "settings"
                                  ? "系統設定"
                                  : `${greeting}，${userName}`}
                  </h1>
                  <p>
                    {view === "dashboard"
                      ? activeInventoryName
                      : view === "claims"
                        ? "管理公開商品、顧客喊單與採購數量。"
                        : view === "bundle-claims"
                          ? "將討論串確認好的截圖與固定總額整理成顧客確認連結。"
                          : view === "locations"
                            ? "建立並查看收藏品的實際存放位置。"
                            : view === "settlement"
                              ? "彙整銷售收入、批次成本與目前淨利。"
                              : view === "settings"
                                ? "管理帳號與系統連線資訊。"
                                : "快速找到每一件收藏品，減少人工核對。"}
                  </p>
                </div>
                {view === "orders" ? (
                  <button
                    className="primary"
                    onClick={() => setCreatingOrder(true)}
                  >
                    <Plus size={18} />
                    新增訂單
                  </button>
                ) : view === "products" ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={`${printSelectionMode ? "outline" : "primary"} page-title-action`}
                      onClick={() => {
                        setPrintSelectionMode((current) => !current);
                        setPrintProductIds(new Set());
                      }}
                    >
                      <Printer size={18} />
                      {printSelectionMode ? "取消批量列印" : "批量列印"}
                    </button>
                    {!printSelectionMode && (
                      <button
                        className="primary"
                        onClick={() => setCreating(true)}
                      >
                        <Plus size={18} />
                        新增商品
                      </button>
                    )}
                  </div>
                ) : (
                  view !== "settings" &&
                  view !== "locations" &&
                  view !== "settlement" &&
                  view !== "claims" &&
                  view !== "bundle-claims" && (
                    <button
                      className="primary"
                      onClick={() => setCreating(true)}
                    >
                      <Plus size={18} />
                      新增商品
                    </button>
                  )
                )}
              </div>
              {loadError && (
                <div className="data-error">資料載入失敗：{loadError}</div>
              )}
              {view === "dashboard" && (
                <DataState
                  loading={loading || ordersLoading}
                  isEmpty={
                    scopedProducts.length === 0 && scopedOrders.length === 0
                  }
                  loadingText="正在讀取總覽資料…"
                  emptyText="目前沒有商品或訂單資料"
                >
                  <Overview
                    onNavigate={setView}
                    products={scopedProducts}
                    orders={scopedOrders}
                    finance={finance}
                    isAdmin={isAdmin}
                    roleLoaded={roleLoaded}
                    onPack={(order) => {
                      selectCustomerForOrder(order);
                    }}
                    onSelectProduct={setSelected}
                  />
                </DataState>
              )}
              {view === "products" && (
                <DataState
                  loading={loading}
                  isEmpty={filteredProducts.length === 0}
                  loadingText="正在讀取商品…"
                  emptyText={
                    query.trim()
                      ? `找不到符合「${query.trim()}」的商品`
                      : "目前沒有商品"
                  }
                >
                  {printSelectionMode && (
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-3">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          className="outline"
                          onClick={() => {
                            const ids = filteredProducts
                              .map((product) => product.dbId)
                              .filter((id): id is string => Boolean(id));
                            const allSelected = ids.every((id) =>
                              printProductIds.has(id),
                            );
                            setPrintProductIds(
                              allSelected ? new Set() : new Set(ids),
                            );
                          }}
                        >
                          全選／取消全選
                        </button>
                        <span className="text-[12px] text-muted">
                          已選擇 {printProductIds.size} 項
                        </span>
                      </div>
                      <button
                        type="button"
                        className="primary"
                        disabled={printProductIds.size === 0 || preparingPrint}
                        onClick={async () => {
                          setPreparingPrint(true);
                          try {
                            await downloadPrintLabels([...printProductIds]);
                          } catch (error) {
                            void swal({
                              title: "列印失敗",
                              text:
                                error instanceof Error
                                  ? error.message
                                  : "列印檔案產生失敗",
                              type: "error",
                            });
                          } finally {
                            setPreparingPrint(false);
                          }
                        }}
                      >
                        <Printer size={17} />
                        {preparingPrint
                          ? "產生中…"
                          : "下載批量列印檔（含 QR 圖片）"}
                      </button>
                    </div>
                  )}
                  <ProductTable
                    items={filteredProducts}
                    onSelect={printSelectionMode ? undefined : setSelected}
                    selectionMode={printSelectionMode}
                    selectedIds={printProductIds}
                    onToggle={(productId) =>
                      setPrintProductIds((current) => {
                        const next = new Set(current);
                        if (next.has(productId)) next.delete(productId);
                        else next.add(productId);
                        return next;
                      })
                    }
                  />
                </DataState>
              )}
              {view === "orders" && (
                <DataState
                  loading={ordersLoading}
                  isEmpty={filteredOrders.length === 0}
                  loadingText="正在讀取訂單…"
                  emptyText={
                    query.trim()
                      ? `找不到符合「${query.trim()}」的訂單`
                      : "目前沒有正式訂單"
                  }
                >
                  <OrderTable
                    orders={filteredOrders}
                    onEditAmount={canManageOrders ? setEditingOrder : undefined}
                    onDelete={
                      canManageOrders
                        ? async (order) => {
                            if (
                              !window.confirm(
                                `確定永久刪除訂單 ${order.id}？\n\n相關包貨、掃描與結算紀錄會一併刪除，已扣除的商品庫存會恢復。此操作無法復原。`,
                              )
                            )
                              return;
                            try {
                              await dispatch(
                                archiveOrder({ orderId: order.dbId }),
                              ).unwrap();
                              await loadAllData();
                            } catch (error) {
                              const message =
                                typeof error === "string"
                                  ? error
                                  : error instanceof Error
                                    ? error.message
                                    : "未知錯誤";
                              window.alert(`刪除失敗：${message}`);
                            }
                          }
                        : undefined
                    }
                    onPack={(order) => {
                      selectCustomerForOrder(order);
                    }}
                  />
                </DataState>
              )}
              {view === "claims" && selectedOwnerId && (
                <ClaimFormPanel
                  key={`${selectedOwnerId}-${claimInitialTab}`}
                  ownerId={selectedOwnerId}
                  inventoryName={activeInventoryName}
                  products={scopedProducts}
                  orders={scopedOrders}
                  onReloadProducts={loadProducts}
                  initialTab={claimInitialTab}
                />
              )}
              {view === "bundle-claims" && selectedOwnerId && (
                <BundleClaimPanel
                  ownerId={selectedOwnerId}
                  inventoryName={activeInventoryName}
                  onOpenAppearance={() => {
                    setClaimInitialTab("appearance");
                    setView("claims");
                  }}
                />
              )}
              {view === "locations" && selectedOwnerId && (
                <LocationManager ownerId={selectedOwnerId} query={query} />
              )}
              {view === "settlement" && selectedOwnerId && (
                <SettlementPanel ownerId={selectedOwnerId} />
              )}
              {view === "settings" && (
                <SystemSettings
                  isAdmin={isAdmin}
                  inventories={availableOwners}
                  inventoryDatabases={accountData?.inventoryDatabases ?? []}
                  availableUsers={accountData?.availableUsers ?? []}
                  selectedInventoryId={selectedOwnerId}
                  onInventoryChange={(inventoryId) => {
                    setSelectedOwnerId(inventoryId);
                    window.localStorage.setItem(
                      "archive-stock-owner-id",
                      inventoryId,
                    );
                    setSelected(null);
                    setSelectedCustomer(null);
                    setPrintSelectionMode(false);
                    setPrintProductIds(new Set());
                  }}
                  onInventoryDatabaseUpdated={reloadAccount}
                />
              )}
            </>
          )}
        </div>
      </main>
      {selected && (
        <ProductPanel
          product={selected}
          onClose={() => setSelected(null)}
          onUpdated={loadAllData}
        />
      )}{" "}
      {creating && (
        <NewProduct
          ownerId={selectedOwnerId}
          onClose={() => setCreating(false)}
          onCreated={loadProducts}
        />
      )}{" "}
      {creatingOrder && (
        <NewOrder
          products={scopedProducts}
          productsLoading={loading}
          onClose={() => setCreatingOrder(false)}
          onCreated={() => {
            void loadAllData();
          }}
        />
      )}{" "}
      {editingOrder && (
        <EditOrderAmount
          orderId={editingOrder.dbId}
          orderNo={editingOrder.id}
          onClose={() => setEditingOrder(null)}
          onUpdated={loadOrders}
        />
      )}{" "}
      {mobile && (
        <div
          className="overlay nav-overlay"
          onClick={() => setMobile(false)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
