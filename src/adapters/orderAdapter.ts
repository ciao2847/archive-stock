import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/constants";
import type { Order, OrderItem } from "@/lib/types";
import type { OrderRow } from "@/lib/api/archive";

const firstRelation = <T>(relation: T | T[] | null): T | null =>
  Array.isArray(relation) ? (relation[0] ?? null) : relation;

export const customerIdentityKey = (
  name: string | null | undefined,
  nickname: string | null | undefined,
  contact: string | null | undefined,
) => {
  const normalizedContact = contact?.trim().toLowerCase() ?? "";
  if (normalizedContact) return `contact:${normalizedContact}`;
  return `name:${(name ?? "").trim().toLowerCase()}`;
};

/** 將原始訂單 API 列資料正規化為 UI 可直接使用的模型 */
export const adaptOrder = (row: OrderRow): Order => {
  const customer = firstRelation(row.customers);
  const items = row.order_items || [];
  const adaptedItems: OrderItem[] = items.flatMap((item) => {
    const product = firstRelation(item.products);
    if (!product?.id || !product.sku) return [];
    return [
      {
        orderItemId: item.id,
        productId: product.id,
        sku: product.sku,
        name: product.name ?? "",
        quantity: item.quantity,
        packedQuantity: item.packed_quantity ?? 0,
        scannedQuantity: item.scanned_quantity ?? 0,
        unitPrice: item.unit_price ?? 0,
      },
    ];
  });
  const customerName = customer?.name ?? "";
  const customerNickname = customer?.nickname ?? "";
  const customerContact = customer?.contact ?? "";

  return {
    dbId: row.id,
    id: row.order_no,
    ownerId: row.owner_id,
    customer: customer?.nickname || customer?.name || "未填寫客人",
    customerKey: customerIdentityKey(
      customerName,
      customerNickname,
      customerContact,
    ),
    customerNickname,
    customerContact,
    createdAt: row.created_at
      ? new Date(row.created_at).toLocaleDateString("zh-TW")
      : "",
    status: ORDER_STATUS_LABELS[row.status] || row.status,
    payment: PAYMENT_STATUS_LABELS[row.payment_status] || row.payment_status,
    itemIds: adaptedItems.flatMap((item) =>
      Array.from({ length: item.quantity }, () => item.sku),
    ),
    packedIds: adaptedItems.flatMap((item) =>
      item.packedQuantity >= item.quantity
        ? Array.from({ length: item.quantity }, () => item.sku)
        : [],
    ),
    items: adaptedItems,
  };
};

/** 將訂單列表整批轉換 */
export const adaptOrders = (rows: OrderRow[]): Order[] => {
  if (!Array.isArray(rows)) return [];
  return rows.map(adaptOrder);
};
