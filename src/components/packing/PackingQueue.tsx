"use client";

import { ChevronRight, PackageCheck, QrCode } from "lucide-react";
import type { Order } from "@/lib/types";
import { isOrderPackable } from "@/constants";

export type PackingCustomer = {
  key: string;
  ownerId: string;
  name: string;
  contact: string;
  orders: Order[];
  totalItems: number;
  packedItems: number;
  waitingItems: number;
};

export function groupOrdersByCustomer(orders: Order[]): PackingCustomer[] {
  const groups = new Map<string, PackingCustomer>();

  orders
    .filter((order) => isOrderPackable(order.status))
    .forEach((order) => {
      const key = order.customerKey || `order:${order.dbId}`;
      const existing = groups.get(key);
      const totalItems = order.items.length
        ? order.items.reduce((sum, item) => sum + item.quantity, 0)
        : order.itemIds.length;
      const packedItems = order.items.length
        ? order.items.reduce(
            (sum, item) => sum + Math.min(item.packedQuantity, item.quantity),
            0,
          )
        : order.packedIds.length;

      if (existing) {
        existing.orders.push(order);
        existing.totalItems += totalItems;
        existing.packedItems += packedItems;
        existing.waitingItems = existing.totalItems - existing.packedItems;
        if (!existing.contact && order.customerContact) {
          existing.contact = order.customerContact;
        }
        return;
      }

      groups.set(key, {
        key,
        ownerId: order.ownerId,
        name: order.customer,
        contact: order.customerContact,
        orders: [order],
        totalItems,
        packedItems,
        waitingItems: totalItems - packedItems,
      });
    });

  return [...groups.values()].sort((a, b) => {
    const aDate = a.orders[0]?.createdAt ?? "";
    const bDate = b.orders[0]?.createdAt ?? "";
    return bDate.localeCompare(aDate) || a.name.localeCompare(b.name, "zh-TW");
  });
}

export interface PackingQueueProps {
  orders: Order[];
  query?: string;
  onPack: (customer: PackingCustomer) => void;
}

export function PackingQueue({
  orders,
  query = "",
  onPack,
}: PackingQueueProps) {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");
  const customers = groupOrdersByCustomer(orders).filter((customer) => {
    if (!normalizedQuery) return true;
    const searchableText = [
      customer.name,
      customer.contact,
      ...customer.orders.flatMap((order) => [
        order.id,
        order.customerNickname,
        order.customerContact,
        ...order.items.flatMap((item) => [item.sku, item.name]),
      ]),
    ]
      .join(" ")
      .toLocaleLowerCase("zh-TW");
    return searchableText.includes(normalizedQuery);
  });
  return (
    <div>
      <div className="page-title">
        <div className="packing-queue-heading">
          <div>
            <span className="eyebrow">掃碼出貨</span>
            <h1>依客人選擇包貨</h1>
            <p>同一位客人的多筆訂單可以合併，先到貨的商品可先寄出。</p>
          </div>
        </div>
      </div>
      <div className="packing-customer-list">
        {customers.length === 0 ? (
          <div className="empty">
            {normalizedQuery
              ? `找不到符合「${query.trim()}」的待包貨資料`
              : "目前沒有待出貨商品"}
          </div>
        ) : (
          customers.map((customer) => (
            <article className="packing-customer-card" key={customer.key}>
              <div className="packing-customer-main">
                <span className="packing-customer-icon">
                  <PackageCheck size={20} />
                </span>
                <div>
                  <h2>{customer.name}</h2>
                  <p>
                    {customer.contact || "未填寫聯絡方式"} ·{" "}
                    {customer.orders.length} 筆訂單
                  </p>
                </div>
              </div>
              <div className="packing-customer-progress">
                <strong>{customer.waitingItems} 件待出貨</strong>
                <small>
                  已完成 {customer.packedItems} / {customer.totalItems} 件
                </small>
              </div>
              <button className="primary" onClick={() => onPack(customer)}>
                <QrCode size={17} />
                開始包貨
                <ChevronRight size={16} />
              </button>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
