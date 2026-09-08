import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/constants";
import type { Order } from "@/lib/types";
import type { OrderRow } from "@/lib/api/archive";

const firstRelation = <T>(relation: T | T[] | null): T | null =>
  Array.isArray(relation) ? (relation[0] ?? null) : relation;

/** 將原始訂單 API 列資料正規化為 UI 可直接使用的模型 */
export const adaptOrder = (row: OrderRow): Order => {
  const customer = firstRelation(row.customers);
  const items = row.order_items || [];

  return {
    dbId: row.id,
    id: row.order_no,
    ownerId: row.owner_id,
    customer: customer?.nickname || customer?.name || "未填寫客人",
    createdAt: row.created_at
      ? new Date(row.created_at).toLocaleDateString("zh-TW")
      : "",
    status: ORDER_STATUS_LABELS[row.status] || row.status,
    payment: PAYMENT_STATUS_LABELS[row.payment_status] || row.payment_status,
    itemIds: items.flatMap((item) => {
      const sku = firstRelation(item.products)?.sku;
      return sku ? Array.from({ length: item.quantity }, () => sku) : [];
    }),
    packedIds: items.flatMap((item) => {
      const sku = firstRelation(item.products)?.sku;
      return item.scanned_quantity >= item.quantity && sku ? [sku] : [];
    }),
  };
};

/** 將訂單列表整批轉換 */
export const adaptOrders = (rows: OrderRow[]): Order[] => {
  if (!Array.isArray(rows)) return [];
  return rows.map(adaptOrder);
};
