"use client";

import { ChevronRight } from "lucide-react";
import type { Product } from "@/lib/types";
import { ResponsiveTable, type TableColumn } from "./ResponsiveTable";

const PRODUCT_COLUMNS: TableColumn[] = [
  { key: "owner", label: "擁有者" },
  { key: "product", label: "商品", className: "sm:max-lg:!pl-4" },
  { key: "id", label: "商品 ID" },
  { key: "type", label: "類型 / 規格" },
  { key: "location", label: "庫位" },
  { key: "stock", label: "庫存" },
  { key: "status", label: "狀態" },
  { key: "action", label: "操作", className: "sticky right-0 z-10 bg-light" },
];

export function ProductTable({
  items,
  onSelect,
  compact,
}: {
  items: Product[];
  onSelect?: (product: Product) => void;
  compact?: boolean;
}) {
  return (
    <ResponsiveTable
      columns={PRODUCT_COLUMNS}
      compact={compact}
      hideHeaderOnMobile
      wrapperClassName="max-lg:!mx-0 max-md:!mb-0 max-md:!overflow-hidden"
      tableClassName={`product-table max-md:!min-w-0 ${compact ? "[&_thead_tr]:border-t [&_thead_tr]:border-t-line [&_thead_th:first-child]:!rounded-tl-none [&_thead_th:last-child]:!rounded-tr-none" : ""}`}
      tbodyClassName="max-md:[&>tr:first-child]:!border-t-0"
      colGroup={
        <colgroup>
          <col className="owner-column" />
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
      {items.map((product) => (
        <tr
          className={`${onSelect ? "cursor-pointer" : ""} max-md:relative max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto_18px] max-md:gap-x-3 max-md:border-t max-md:border-line max-md:px-4 max-md:py-3`}
          key={product.id}
          onClick={() => onSelect?.(product)}
        >
          <td className="max-md:hidden">
            <span className="owner-badge">{product.ownerName}</span>
          </td>
          <td className="md:max-lg:!pl-4 max-md:col-start-1 max-md:row-start-1 max-md:!min-w-0 max-md:!border-0 max-md:!p-0">
            <div className="product-cell max-md:!min-w-0 max-md:!pr-0 [&>div]:min-w-0">
              <span
                className="thumb overflow-hidden"
                style={{ background: product.accent }}
              >
                {product.thumbnail ? (
                  <ProductImage
                    src={product.thumbnail}
                    alt={`${product.work} 商品圖`}
                  />
                ) : (
                  product.work.slice(0, 1)
                )}
              </span>
              <div>
                <span className="owner-badge mb-1 hidden max-md:inline-flex">
                  {product.ownerName}
                </span>
                <b className="max-md:block max-md:max-w-full max-md:truncate">
                  {product.work}
                </b>
                <small className="max-md:hidden">{product.name}</small>
                <div className="mt-2 hidden items-center gap-2 max-md:flex">
                  <code>{product.id}</code>
                  <span className="location">{product.location}</span>
                </div>
              </div>
            </div>
          </td>
          <td className="max-md:hidden">
            <code>{product.id}</code>
          </td>
          <td className="max-md:hidden">
            <b className="plain">{product.category}</b>
            <small>
              {[product.format, product.size].filter(Boolean).join(" · ") ||
                product.source}
            </small>
          </td>
          <td className="max-md:hidden">
            <span className="location">{product.location}</span>
          </td>
          <td className="max-md:hidden">{product.stock}</td>
          <td className="max-md:col-start-2 max-md:row-start-1 max-md:self-center max-md:!border-0 max-md:!p-0">
            <span
              className={`pill ${product.status === "在庫" ? "green" : "amber"}`}
            >
              {product.status}
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
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="block h-full w-full object-cover"
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
    />
  );
}
