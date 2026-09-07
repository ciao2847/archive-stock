"use client";

import type { Order } from "@/lib/types";
import { isOrderPackable } from "@/constants";
import { OrderTable } from "@/components/orders/OrderTable";

export interface PackingQueueProps {
  orders: Order[];
  onPack: (order: Order) => void;
}

export function PackingQueue({ orders, onPack }: PackingQueueProps) {
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
