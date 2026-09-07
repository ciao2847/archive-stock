"use client";

import {
  Boxes,
  ChevronRight,
  ClipboardList,
  PackageCheck,
  QrCode,
  Warehouse,
} from "lucide-react";
import type {
  DashboardView,
  FinanceOverview,
  Order,
  Product,
} from "@/lib/types";
import { isOrderPackable } from "@/constants";
import { ProductTable } from "@/components/products/ProductTable";

export interface OverviewProps {
  onNavigate: (view: DashboardView) => void;
  products: Product[];
  orders: Order[];
  finance: FinanceOverview | null;
  isAdmin: boolean;
  roleLoaded: boolean;
  onPack: (order: Order) => void;
  onSelectProduct: (product: Product) => void;
}

export function Overview({
  onNavigate,
  products,
  orders,
  finance,
  isAdmin,
  roleLoaded,
  onPack,
  onSelectProduct,
}: OverviewProps) {
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
                        ? "text-danger-strong"
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
