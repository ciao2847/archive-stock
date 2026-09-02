"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  PackageCheck,
  Plus,
  QrCode,
  Search,
  Settings,
  Trash2,
  Warehouse,
  WalletCards,
  X,
} from "lucide-react";
import { Order, Product } from "@/lib/types";
import { ProductPanel } from "./ProductPanel";
import { PackingPanel } from "./PackingPanel";
import { NewProduct } from "./NewProduct";
import { LocationManager } from "./LocationManager";
import { SystemSettings } from "./SystemSettings";
import { NewOrder } from "./NewOrder";
import { SettlementPanel } from "./SettlementPanel";
import { EditOrderAmount } from "./EditOrderAmount";
import {
  PACKING_ORDER_STATUSES,
  isOrderPackable,
} from "@/constants";
import { ResponsiveTable, type TableColumn } from "./ResponsiveTable";
import { DataState } from "./DataState";
import { useProductsData } from "@/hooks/useProductsData";
import { useOrdersData } from "@/hooks/useOrdersData";
import { useAccountData } from "@/hooks/useAccountData";
import { useAppDispatch } from "@/store/hooks";
import { archiveOrder } from "@/store/slices/ordersSlice";
import { BrandLogo } from "./BrandLogo";

type View =
  | "dashboard"
  | "products"
  | "orders"
  | "packing"
  | "locations"
  | "settlement"
  | "settings";

const PRODUCT_COLUMNS: TableColumn[] = [
  { key: "product", label: "商品", className: "sm:max-lg:!pl-4" },
  { key: "id", label: "商品 ID" },
  { key: "type", label: "類型 / 規格" },
  { key: "location", label: "庫位" },
  { key: "stock", label: "庫存" },
  { key: "status", label: "狀態" },
  {
    key: "action",
    label: "操作",
    className: "sticky right-0 z-10 bg-light",
  },
];

const ORDER_COLUMNS: TableColumn[] = [
  { key: "order", label: "訂單" },
  { key: "customer", label: "客人" },
  { key: "date", label: "日期" },
  { key: "items", label: "商品數" },
  { key: "payment", label: "付款" },
  { key: "status", label: "狀態" },
  { key: "action", label: "操作", className: "w-[132px] text-center" },
];

const EMPTY_PRODUCTS: Product[] = [];
const EMPTY_ORDERS: Order[] = [];

export function Dashboard() {
  const dispatch = useAppDispatch();
  const {
    data: productsData,
    error: productsError,
    loading,
    refresh: reloadProducts,
  } = useProductsData();
  const {
    data: ordersData,
    error: ordersError,
    loading: ordersLoading,
    refresh: reloadOrders,
  } = useOrdersData();
  const {
    data: accountData,
    error: accountError,
    loading: accountLoading,
    refresh: reloadAccount,
  } = useAccountData();
  const products = productsData ?? EMPTY_PRODUCTS;
  const orders = ordersData ?? EMPTY_ORDERS;
  const finance = accountData?.finance ?? null;
  const isAdmin = accountData?.isAdmin ?? false;
  const roleLoaded = !accountLoading;
  const userName = accountData?.userName ?? "使用者";
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
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [greeting, setGreeting] = useState("您好");
  const [todayLabel, setTodayLabel] = useState("");
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
  const filtered = useMemo(
    () =>
      products.filter((p) =>
        Object.values(p)
          .flat()
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [products, query],
  );
  const packingCount = orders.filter((order) =>
    PACKING_ORDER_STATUSES.has(order.status),
  ).length;
  const nav = [
    { id: "dashboard", label: "總覽", icon: LayoutDashboard },
    { id: "products", label: "商品庫存", icon: Boxes },
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
            <small>{isAdmin ? "管理員" : "工作人員"}</small>
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
          <div className="search">
            <Search size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋作品、商品 ID、版本、庫位…"
            />
            <kbd>⌘ K</kbd>
          </div>
        </header>
        <div className="content">
          {view === "packing" ? (
            selectedOrder ? (
              <PackingPanel
                order={selectedOrder}
                products={products.filter((product) =>
                  selectedOrder.itemIds.includes(product.id),
                )}
                onBack={() => {
                  setSelectedOrder(null);
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
                  orders={orders}
                  onPack={(order) => setSelectedOrder(order)}
                  onBack={() => setView("dashboard")}
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
                      ? `今天有 ${orders.filter((order) => isOrderPackable(order.status)).length} 筆訂單等待處理。`
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
                ) : (
                  view !== "settings" &&
                  view !== "locations" &&
                  view !== "settlement" && (
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
                  isEmpty={products.length === 0 && orders.length === 0}
                  loadingText="正在讀取總覽資料…"
                  emptyText="目前沒有商品或訂單資料"
                >
                  <Overview
                    onNavigate={setView}
                    products={products}
                    orders={orders}
                    finance={finance}
                    isAdmin={isAdmin}
                    roleLoaded={roleLoaded}
                    onPack={(order) => {
                      setSelectedOrder(order);
                      setView("packing");
                    }}
                    onSelectProduct={setSelected}
                  />
                </DataState>
              )}
              {view === "products" && (
                <DataState
                  loading={loading}
                  isEmpty={filtered.length === 0}
                  loadingText="正在讀取商品…"
                  emptyText={query ? `找不到符合「${query}」的商品` : "目前沒有商品"}
                >
                  <ProductTable items={filtered} onSelect={setSelected} />
                </DataState>
              )}
              {view === "orders" && (
                <DataState
                  loading={ordersLoading}
                  isEmpty={orders.length === 0}
                  loadingText="正在讀取訂單…"
                  emptyText="目前沒有正式訂單"
                >
                  <OrderTable
                  orders={orders}
                  onEditAmount={isAdmin ? setEditingOrder : undefined}
                  onDelete={
                    isAdmin
                      ? async (order) => {
                          if (
                            !window.confirm(
                              `確定刪除訂單 ${order.id}？商品會恢復為在庫。`,
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
                    setSelectedOrder(order);
                    setView("packing");
                  }}
                  />
                </DataState>
              )}
              {view === "locations" && <LocationManager />}
              {view === "settlement" && <SettlementPanel />}
              {view === "settings" && <SystemSettings />}
            </>
          )}
        </div>
      </main>
      {selected && (
        <ProductPanel
          product={selected}
          onClose={() => setSelected(null)}
          onUpdated={loadProducts}
        />
      )}{" "}
      {creating && (
        <NewProduct
          onClose={() => setCreating(false)}
          onCreated={loadProducts}
        />
      )}{" "}
      {creatingOrder && (
        <NewOrder
          products={products}
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

function Overview({
  onNavigate,
  products,
  orders,
  finance,
  isAdmin,
  roleLoaded,
  onPack,
  onSelectProduct,
}: {
  onNavigate: (v: View) => void;
  products: Product[];
  orders: Order[];
  finance: { revenue: number; cost: number; profit: number } | null;
  isAdmin: boolean;
  roleLoaded: boolean;
  onPack: (order: Order) => void;
  onSelectProduct: (product: Product) => void;
}) {
  const waiting = orders.filter((order) => isOrderPackable(order.status));
  return (
    <>
      <section className="stats">
        <article>
          <span className="stat-icon rust">
            <Boxes />
          </span>
          <div>
            <small>在庫商品</small>
            <strong>
              {products
                .filter((p) => p.status === "在庫")
                .reduce((sum, p) => sum + p.stock, 0)}
            </strong>
            <em>共 {new Set(products?.map((p) => p.category)).size} 種分類</em>
          </div>
        </article>
        <article>
          <span className="stat-icon gold">
            <ClipboardList />
          </span>
          <div>
            <small>待處理訂單</small>
            <strong>{waiting.length}</strong>
            <em>
              {waiting.filter((order) => order.status === "待包貨").length}{" "}
              筆等待包貨
            </em>
          </div>
        </article>
        <article>
          <span className="stat-icon green">
            <PackageCheck />
          </span>
          <div>
            <small>已出貨訂單</small>
            <strong>
              {orders.filter((order) => order.status === "已出貨").length}
            </strong>
            <em>正式資料</em>
          </div>
        </article>
        <article>
          <span className="stat-icon blue">
            <Warehouse />
          </span>
          <div>
            <small>低庫存商品</small>
            <strong>{products.filter((p) => p.stock <= 1).length}</strong>
            <em>需要留意</em>
          </div>
        </article>
      </section>
      <div className="grid-main">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>等待包貨</h2>
              <p>Supabase 中尚未完成的訂單</p>
            </div>
            <button onClick={() => onNavigate("orders")}>
              查看全部 <ChevronRight size={16} />
            </button>
          </div>
          <div className="order-list">
            {waiting.length === 0 ? (
              <div className="empty compact-empty">目前沒有等待包貨的訂單</div>
            ) : (
              waiting?.slice(0, 2)?.map((order, index) => (
                <div className="order-row" key={order.dbId}>
                  <span className="order-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <b>{order.id}</b>
                    <small>
                      {order.customer} · {order.itemIds.length} 件商品
                    </small>
                  </div>
                  <span className="pill amber">{order.status}</span>
                  <button className="outline" onClick={() => onPack(order)}>
                    <QrCode size={16} />
                    開始包貨
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
        <section className="card activity">
          <div className="card-head">
            <div>
              <h2>
                {!roleLoaded ? "載入中…" : isAdmin ? "財務概況" : "資料狀態"}
              </h2>
              <p>
                {!roleLoaded
                  ? "正在確認帳號權限"
                  : isAdmin
                    ? "僅管理員可見"
                    : "目前 Supabase 正式資料"}
              </p>
            </div>
          </div>
          {finance ? (
            <>
              <div className="activity-row">
                <i className="green" />
                <div>
                  <b>NT$ {finance.revenue.toLocaleString()}</b>
                  <small>已完成銷售總額</small>
                </div>
              </div>
              <div className="activity-row">
                <i className="rust" />
                <div>
                  <b>NT$ {finance.cost.toLocaleString()}</b>
                  <small>累計批次成本總額</small>
                </div>
              </div>
              <div className="activity-row">
                <i className="blue" />
                <div>
                  <b
                    className={
                      finance.profit < 0
                        ? "text-red-700"
                        : "text-secondary-strong"
                    }
                  >
                    NT$ {finance.profit.toLocaleString()}
                  </b>
                  <small>目前淨利</small>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="activity-row">
                <i className="green" />
                <div>
                  <b>{products.length} 項商品</b>
                  <small>已載入商品資料庫</small>
                </div>
              </div>
              <div className="activity-row">
                <i className="blue" />
                <div>
                  <b>{orders.length} 筆訂單</b>
                  <small>已載入訂單資料庫</small>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>近期新增商品</h2>
            <p>最新建立的收藏品資料</p>
          </div>
          <button onClick={() => onNavigate("products")}>
            查看庫存 <ChevronRight size={16} />
          </button>
        </div>
        <ProductTable
          items={products.slice(0, 4)}
          onSelect={onSelectProduct}
          compact
        />
      </section>
    </>
  );
}
function ProductTable({
  items,
  onSelect,
  compact,
}: {
  items: Product[];
  onSelect?: (p: Product) => void;
  compact?: boolean;
}) {
  return (
    <ResponsiveTable
      columns={PRODUCT_COLUMNS}
      compact={compact}
      hideHeaderOnMobile
      wrapperClassName="max-lg:!mx-0 max-md:!mb-0 max-md:!overflow-hidden"
      tableClassName={`product-table max-md:!min-w-0 ${
          compact
            ? "[&_thead_tr]:border-t [&_thead_tr]:border-t-line [&_thead_th:first-child]:!rounded-tl-none [&_thead_th:last-child]:!rounded-tr-none"
            : ""
        }`}
      tbodyClassName="max-md:[&>tr:first-child]:!border-t-0"
      colGroup={
        <colgroup>
          <col className="product-column" />
          <col className="id-column" />
          <col className="type-column" />
          <col className="location-column" />
          <col className="stock-column" />
          <col className="status-column" />
          <col className="action-column" />
        </colgroup>
      }
      empty={
        items.length === 0 ? (
          <div className="empty">找不到符合「搜尋條件」的商品</div>
        ) : undefined
      }
    >
          {items?.map((p) => (
            <tr
              className={`${onSelect ? "cursor-pointer" : ""} max-md:relative max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto_18px] max-md:gap-x-3 max-md:border-t max-md:border-line max-md:px-4 max-md:py-3`}
              key={p.id}
              onClick={() => onSelect?.(p)}
            >
              <td className="md:max-lg:!pl-4 max-md:col-start-1 max-md:row-start-1 max-md:!min-w-0 max-md:!border-0 max-md:!p-0">
                <div className="product-cell max-md:!min-w-0 max-md:!pr-0 [&>div]:min-w-0">
                  <span
                    className="thumb overflow-hidden"
                    style={{ background: p.accent }}
                  >
                    {p.thumbnail ? (
                      <ProductImage src={p.thumbnail} alt={`${p.work} 商品圖`} />
                    ) : (
                      p.work.slice(0, 1)
                    )}
                  </span>
                  <div>
                    <b className="max-md:block max-md:max-w-full max-md:truncate">
                      {p.work}
                    </b>
                    <small className="max-md:hidden">{p.name}</small>
                    <div className="mt-2 hidden items-center gap-2 max-md:flex">
                      <code>{p.id}</code>
                      <span className="location">{p.location}</span>
                    </div>
                  </div>
                </div>
              </td>
              <td className="max-md:hidden">
                <code>{p.id}</code>
              </td>
              <td className="max-md:hidden">
                <b className="plain">{p.category}</b>
                <small>
                  {[p.format, p.size].filter(Boolean).join(" · ") || p.source}
                </small>
              </td>
              <td className="max-md:hidden">
                <span className="location">{p.location}</span>
              </td>
              <td className="max-md:hidden">{p.stock}</td>
              <td className="max-md:col-start-2 max-md:row-start-1 max-md:self-center max-md:!border-0 max-md:!p-0">
                <span
                  className={`pill ${p.status === "在庫" ? "green" : "amber"}`}
                >
                  {p.status}
                </span>
              </td>
              <td className="max-md:col-start-3 max-md:row-start-1 max-md:self-center max-md:!border-0 max-md:!p-0 max-md:text-muted">
                <ChevronRight size={17} />
              </td>
            </tr>
          ))}
    </ResponsiveTable>
  );
}
function ProductImage({ src, alt }: { src: string; alt: string }) {
  /* eslint-disable-next-line @next/next/no-img-element */ return (
    <img
      className="block h-full w-full object-cover"
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
    />
  );
}
function OrderTable({
  orders,
  onPack,
  onEditAmount,
  onDelete,
}: {
  orders: Order[];
  onPack: (order: Order) => void;
  onEditAmount?: (order: Order) => void;
  onDelete?: (order: Order) => void | Promise<void>;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const canOperate = (order: Order) => {
    if (isOrderPackable(order.status)) return true;
    window.alert("此訂單已完成或已鎖定，不能再編輯、刪除或包貨。");
    return false;
  };

  useEffect(() => {
    if (!openMenuId || !window.matchMedia("(min-width: 601px)").matches) return;

    const closeMenu = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-order-menu]")) {
        setOpenMenuId(null);
      }
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenuId(null);
    };

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [openMenuId]);

  return (
    <ResponsiveTable
      columns={ORDER_COLUMNS}
      wrapperClassName="!overflow-visible max-md:!mx-0 max-md:!rounded-[10px]"
      tableClassName="max-md:!min-w-0"
      theadClassName="max-md:hidden"
      tbodyClassName="max-md:[&>tr:first-child]:!border-t-0"
      empty={
        orders.length === 0 ? (
          <div className="empty">目前沒有正式訂單</div>
        ) : undefined
      }
    >
          {orders?.map((order) => (
            <tr
              className="hover:!bg-transparent max-md:relative max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto_auto_44px] max-md:gap-x-2 max-md:gap-y-3 max-md:border-t max-md:border-line max-md:px-4 max-md:py-4"
              key={order.dbId}
            >
              <td className="max-md:hidden">
                <code>{order.id}</code>
              </td>
              <td className="max-md:col-start-1 max-md:col-end-4 max-md:row-start-1 max-md:min-w-0 max-md:self-center max-md:!border-0 max-md:!p-0">
                <b className="max-md:block max-md:truncate max-md:text-[15px]">
                  {order.customer}
                </b>
                <code className="mt-1 hidden text-[10px] text-muted max-md:block">
                  {order.id}
                </code>
              </td>
              <td className="max-md:hidden">{order.createdAt}</td>
              <td className="hidden max-md:col-start-1 max-md:col-end-5 max-md:row-start-2 max-md:flex max-md:min-w-0 max-md:items-center max-md:gap-2 max-md:!border-0 max-md:!p-0">
                <span className="inline-flex items-center gap-1 rounded-full bg-light px-2 py-1 text-[11px] text-default">
                  <Boxes className="hidden max-md:block" size={13} />
                  {order.itemIds.length} 件
                </span>
                <span
                  className={`pill ml-auto inline-flex items-center gap-1 ${order.payment === "已付款" ? "green" : "amber"}`}
                >
                  <WalletCards size={13} />
                  {order.payment}
                </span>
                <span
                  className={`pill inline-flex items-center gap-1 ${order.status === "已包裝" ? "blue" : "amber"}`}
                >
                  <PackageCheck size={13} />
                  {order.status}
                </span>
              </td>
              <td className="max-md:hidden">
                {order.itemIds.length} 件
              </td>
              <td className="max-md:hidden">
                <span
                  className={`pill ${order.payment === "已付款" ? "green" : "amber"}`}
                >
                  {order.payment}
                </span>
              </td>
              <td className="max-md:hidden">
                {order.status}
              </td>
              <td
                className={`${openMenuId === order.dbId ? "z-30" : "z-10"} relative w-[132px] bg-white text-center max-md:col-start-4 max-md:row-start-1 max-md:w-auto max-md:self-start max-md:text-right max-md:!border-0 max-md:!p-0`}
              >
                <div
                  className="relative"
                  data-order-menu
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="outline min-h-10 px-3 py-2 max-md:min-h-11"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenMenuId((current) =>
                        current === order.dbId ? null : order.dbId,
                      );
                    }}
                  >
                    <MoreHorizontal size={17} />
                    {/* 操作 */}
                  </button>
                  {openMenuId === order.dbId && (
                    <div className="absolute top-full right-0 z-30 mt-1 min-w-36 overflow-hidden rounded-lg border border-line bg-white p-1 text-left shadow-xl">
                      {onEditAmount && (
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-3 py-3 text-left hover:bg-light"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenMenuId(null);
                            if (canOperate(order)) onEditAmount(order);
                          }}
                        >
                          <WalletCards size={15} />
                          編輯訂單
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-3 py-3 text-left text-red-700 hover:bg-red-50"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenMenuId(null);
                            if (canOperate(order)) void onDelete(order);
                          }}
                        >
                          <Trash2 size={15} />
                          刪除訂單
                        </button>
                      )}
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-3 py-3 text-left hover:bg-light"
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenMenuId(null);
                          if (canOperate(order)) onPack(order);
                        }}
                      >
                        <QrCode size={15} />
                        開始包貨
                      </button>
                    </div>
                  )}
                </div>
              </td>
            </tr>
          ))}
    </ResponsiveTable>
  );
}
function PackingQueue({
  orders,
  onPack,
  onBack,
}: {
  orders: Order[];
  onPack: (order: Order) => void;
  onBack: () => void;
}) {
  const waiting = orders.filter((order) => isOrderPackable(order.status));
  return (
    <div>
      <div className="page-title">
        <div className="packing-queue-heading">
          {/* <button className="icon-btn" onClick={onBack} aria-label="返回總覽">
              <ChevronRight className="back-chevron" />
            </button> */}
          <div>
            <span className="eyebrow">掃碼出貨</span>
            <h1>選擇包貨訂單</h1>
            <p>選擇等待處理的訂單，開始逐件掃描商品。</p>
          </div>
        </div>
      </div>
      <OrderTable orders={waiting} onPack={onPack} />
    </div>
  );
}
