"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  Menu,
  PackageCheck,
  Plus,
  QrCode,
  Search,
  Settings,
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
import { PACKING_ORDER_STATUSES, isOrderPackable } from "@/constants";
import { DataState } from "./DataState";
import { useProductsData } from "@/hooks/useProductsData";
import { useOrdersData } from "@/hooks/useOrdersData";
import { useAccountData } from "@/hooks/useAccountData";
import { useAppDispatch } from "@/store/hooks";
import { archiveOrder } from "@/store/slices/ordersSlice";
import { BrandLogo } from "./BrandLogo";
import { OrderTable } from "./OrderTable";
import { ProductTable } from "./ProductTable";

type View =
  | "dashboard"
  | "products"
  | "orders"
  | "packing"
  | "locations"
  | "settlement"
  | "settings";

const EMPTY_PRODUCTS: Product[] = [];
const EMPTY_ORDERS: Order[] = [];
const EMPTY_OWNERS: Array<{ id: string; name: string }> = [];

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
  const isAdmin = accountData?.isAdmin ?? false;
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
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [greeting, setGreeting] = useState("您好");
  const [todayLabel, setTodayLabel] = useState("");
  const [selectedOwnerId, setSelectedOwnerId] = useState("");
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
      setSelectedOwnerId(accountData.userId);
      return;
    }
    setSelectedOwnerId((current) => {
      if (availableOwners.some((owner) => owner.id === current)) return current;
      const saved = window.localStorage.getItem("archive-stock-owner-id");
      if (saved && availableOwners.some((owner) => owner.id === saved)) {
        return saved;
      }
      return accountData.userId || availableOwners[0]?.id || "";
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
  const filtered = useMemo(
    () =>
      scopedProducts.filter((p) =>
        Object.values(p)
          .flat()
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [query, scopedProducts],
  );
  const packingCount = scopedOrders.filter((order) =>
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
                products={scopedProducts.filter((product) =>
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
                  orders={scopedOrders}
                  onPack={(order) => setSelectedOrder(order)}
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
                      ? `今天有 ${scopedOrders.filter((order) => isOrderPackable(order.status)).length} 筆訂單等待處理。`
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
                  emptyText={
                    query ? `找不到符合「${query}」的商品` : "目前沒有商品"
                  }
                >
                  <ProductTable items={filtered} onSelect={setSelected} />
                </DataState>
              )}
              {view === "orders" && (
                <DataState
                  loading={ordersLoading}
                  isEmpty={scopedOrders.length === 0}
                  loadingText="正在讀取訂單…"
                  emptyText="目前沒有正式訂單"
                >
                  <OrderTable
                    orders={scopedOrders}
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
              {view === "locations" && selectedOwnerId && (
                <LocationManager ownerId={selectedOwnerId} />
              )}
              {view === "settlement" && selectedOwnerId && (
                <SettlementPanel ownerId={selectedOwnerId} />
              )}
              {view === "settings" && (
                <SystemSettings
                  isAdmin={isAdmin}
                  owners={availableOwners}
                  selectedOwnerId={selectedOwnerId}
                  onOwnerChange={(ownerId) => {
                    setSelectedOwnerId(ownerId);
                    window.localStorage.setItem(
                      "archive-stock-owner-id",
                      ownerId,
                    );
                    setSelected(null);
                    setSelectedOrder(null);
                  }}
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
          onUpdated={loadProducts}
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
function PackingQueue({
  orders,
  onPack,
}: {
  orders: Order[];
  onPack: (order: Order) => void;
}) {
  const waiting = orders.filter((order) => isOrderPackable(order.status));
  return (
    <div>
      <div className="page-title">
        <div className="packing-queue-heading">
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
