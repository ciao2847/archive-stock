"use client";

import { pushDashboardPath } from "@/lib/dashboard-navigation";
import type { ReactNode } from "react";
import { Download, Info, ShoppingCart } from "lucide-react";
import type { ClaimProductTotal } from "@/lib/claims";

export type ClaimProductTotalsProduct = Omit<ClaimProductTotal, "productId"> & {
  productId?: string | null;
  ip?: string;
  craft?: string;
};

export type ClaimProductTotalsProps = {
  products: ClaimProductTotalsProduct[];
  heading?: string;
  description?: string;
  hint?: string;
  emptyMessage?: string;
  downloadLabel?: string;
  onDownload?: () => void;
  loading?: boolean;
  getOrdersPath?: (
    product: ClaimProductTotalsProduct,
    payment: "all" | "unpaid" | "paid",
  ) => string;
};

export function ClaimProductTotals({
  products,
  heading = "各商品訂購合計",
  description = "總訂購數量供掌握需求，實際叫貨以已全額付款數量為準。",
  hint = "已付款數量僅計入全額付款；未付款與付一半皆列入未結清。採購 CSV 僅匯出已付款商品與數量。",
  emptyMessage = "目前尚無預購訂購。",
  downloadLabel = "下載採購 CSV",
  onDownload,
  loading = false,
  getOrdersPath,
}: ClaimProductTotalsProps) {
  function metric(
    product: ClaimProductTotalsProduct,
    payment: "all" | "unpaid" | "paid",
    children: ReactNode,
  ) {
    if (!getOrdersPath) return children;
    const href = getOrdersPath(product, payment);
    return (
      <a
        href={href}
        className="text-inherit underline decoration-dotted underline-offset-4 hover:decoration-solid"
        aria-label={`查看 ${product.name} 的${payment === "paid" ? "已付款訂購人" : payment === "unpaid" ? "未結清訂購人" : "訂購人"}`}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          pushDashboardPath(href);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <section
      aria-label={heading}
      aria-busy={loading}
      className="min-w-0 rounded-[8px] border border-line bg-white p-4 shadow-sm sm:p-5 xl:p-6"
    >
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <span className="eyebrow inline-flex items-center gap-1.5">
            <ShoppingCart size={12} aria-hidden="true" />
            採購依據
          </span>
          <h3 className="mb-0 mt-1.5 text-[19px] font-bold tracking-[-0.02em] text-dark">
            {heading}
          </h3>
          {description && (
            <p className="mb-0 mt-1 text-[12px] leading-5 text-muted">
              {description}
            </p>
          )}
        </div>
        {onDownload && (
          <button
            type="button"
            className="outline min-h-10 w-full whitespace-nowrap px-4 text-[12px] lg:w-auto"
            disabled={
              loading || !products.some((product) => product.paidQuantity > 0)
            }
            onClick={onDownload}
          >
            <Download size={15} />
            {downloadLabel}
          </button>
        )}
      </div>

      {hint && (
        <div className="mt-4 flex items-start gap-2.5 rounded-[8px] border border-primary/20 bg-primary-soft px-3.5 py-3 text-[12px] leading-5 text-primary-strong sm:px-4">
          <Info
            size={16}
            className="mt-0.5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span>{hint}</span>
        </div>
      )}

      {products.length ? (
        <div className="mt-4 grid min-w-0 gap-3">
          {products.map((product) => (
            <article
              key={`${product.productId || product.sku}-${product.name}-${product.ip || ""}-${product.craft || ""}`}
              aria-label={`${product.name}${product.craft ? ` · ${product.craft}` : ""}訂購統計`}
              className="min-w-0 rounded-[8px] border border-line bg-white p-4 transition-colors hover:border-primary/40 sm:p-5"
            >
              <div className="min-w-0">
                <b className="block break-words text-[15px] leading-5 text-dark">
                  {product.name}
                </b>
                {(product.ip || product.craft) && (
                  <span className="mt-1 block break-words text-[12px] leading-5 text-muted">
                    {[product.ip, product.craft].filter(Boolean).join(" · ")}
                  </span>
                )}
                <small className="mt-1 block break-all font-mono text-[11px] text-muted">
                  {product.sku}
                </small>
              </div>

              <dl className="m-0 mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="min-w-0 rounded-[8px] bg-light/70 px-3 py-3 sm:px-4">
                  <dt className="text-[10px] font-medium tracking-[0.04em] text-muted">
                    訂購人數
                  </dt>
                  <dd className="m-0 mt-1 text-[16px] font-bold text-dark">
                    {metric(product, "all", `${product.customerCount} 人`)}
                  </dd>
                </div>
                <div className="min-w-0 rounded-[8px] bg-light/70 px-3 py-3 sm:px-4">
                  <dt className="text-[10px] font-medium tracking-[0.04em] text-muted">
                    總訂購數量
                  </dt>
                  <dd className="m-0 mt-1 text-[16px] font-bold text-dark">
                    {product.quantity} 件
                  </dd>
                </div>
                <div className="min-w-0 rounded-[8px] bg-light/70 px-3 py-3 sm:px-4">
                  <dt className="text-[10px] font-medium tracking-[0.04em] text-muted">
                    未結清數量
                  </dt>
                  <dd className="m-0 mt-1 text-[16px] font-bold text-dark">
                    {metric(
                      product,
                      "unpaid",
                      `${product.quantity - product.paidQuantity} 件`,
                    )}
                  </dd>
                </div>
                <div className="min-w-0 rounded-[8px] bg-accent-soft px-3 py-3 sm:px-4">
                  <dt className="text-[10px] font-semibold tracking-[0.04em] text-accent-strong">
                    已付款數量（叫貨依據）
                  </dt>
                  <dd className="m-0 mt-1 text-[16px] font-bold text-accent-strong">
                    {metric(product, "paid", `${product.paidQuantity} 件`)}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <div
          role={loading ? "status" : undefined}
          className="mb-0 mt-5 rounded-[8px] bg-light px-4 py-10 text-center text-[13px] text-muted"
        >
          {loading ? "正在載入訂購統計…" : emptyMessage}
        </div>
      )}
    </section>
  );
}
