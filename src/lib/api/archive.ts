import { API_ROUTES } from "@/constants";
import { readApiResponse } from "@/lib/api/http-client";
import { archiveOrder } from "@/lib/api/orders";
import type { AccountData, Product } from "@/lib/types";

export type OrderItemRow = {
  id: string;
  quantity: number;
  scanned_quantity: number;
  packed_quantity: number;
  unit_price: number;
  products:
    | { id: string; sku: string | null; name: string | null }
    | { id: string; sku: string | null; name: string | null }[]
    | null;
};

export type OrderRow = {
  id: string;
  owner_id: string;
  order_no: string;
  payment_status: string;
  status: string;
  created_at: string;
  customers:
    | {
        name: string | null;
        nickname: string | null;
        contact: string | null;
      }
    | {
        name: string | null;
        nickname: string | null;
        contact: string | null;
      }[]
    | null;
  order_items: OrderItemRow[] | null;
};

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  return readApiResponse<T>(response);
}

export const fetchProductsApi = () => get<Product[]>(API_ROUTES.getProducts);
export const fetchOrdersApi = () => get<OrderRow[]>(API_ROUTES.getOrders);
export const fetchAccountApi = () => get<AccountData>(API_ROUTES.getAccount);

export async function archiveOrderApi(orderId: string): Promise<void> {
  await archiveOrder(orderId);
}
