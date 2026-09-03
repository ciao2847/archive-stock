import { API_ROUTES } from "@/constants";
import { readApiResponse } from "@/lib/api/http-client";
import { archiveOrder } from "@/lib/api/orders";
import type { AccountData, Product } from "@/lib/types";

export type OrderItemRow = {
  quantity: number;
  scanned_quantity: number;
  products: { sku: string | null } | { sku: string | null }[] | null;
};

export type OrderRow = {
  id: string;
  order_no: string;
  payment_status: string;
  status: string;
  created_at: string;
  customers:
    | { name: string | null; nickname: string | null }
    | { name: string | null; nickname: string | null }[]
    | null;
  order_items: OrderItemRow[] | null;
};

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  return readApiResponse<T>(response);
}

export const fetchProductsApi = () => get<Product[]>(API_ROUTES.products);
export const fetchOrdersApi = () => get<OrderRow[]>(API_ROUTES.createOrder);
export const fetchAccountApi = () => get<AccountData>(API_ROUTES.account);

export async function archiveOrderApi(orderId: string): Promise<void> {
  await archiveOrder(orderId);
}
