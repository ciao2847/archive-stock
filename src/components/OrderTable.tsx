"use client";

import { useEffect, useState } from "react";
import {
  Boxes,
  MoreHorizontal,
  PackageCheck,
  QrCode,
  Trash2,
  WalletCards,
} from "lucide-react";

import { isOrderPackable } from "@/constants";
import type { Order } from "@/lib/types";
import { ResponsiveTable, type TableColumn } from "./ResponsiveTable";

const ORDER_COLUMNS: TableColumn[] = [
  { key: "order", label: "訂單" },
  { key: "customer", label: "客人" },
  { key: "date", label: "日期" },
  { key: "items", label: "商品數" },
  { key: "payment", label: "付款" },
  { key: "status", label: "狀態" },
  { key: "action", label: "操作", className: "w-[132px] text-center" },
];

export function OrderTable({
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
          <td className="max-md:hidden">{order.itemIds.length} 件</td>
          <td className="max-md:hidden">
            <span
              className={`pill ${order.payment === "已付款" ? "green" : "amber"}`}
            >
              {order.payment}
            </span>
          </td>
          <td className="max-md:hidden">{order.status}</td>
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
