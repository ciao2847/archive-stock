import { API_ROUTES } from "@/constants";
import { readApiResponse } from "@/lib/api/http-client";

export type CreateOrderInput = {
  customerName: string;
  customerNickname: string;
  customerContact: string;
  paymentStatus: string;
  notes: string;
  salesChannel: string;
  discount: number;
  shippingIncome: number;
  platformFee: number;
  sellerShippingCost: number;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
  }>;
};

export type UpdateOrderInput = {
  customerName: string;
  customerNickname: string;
  customerContact: string;
  paymentStatus: string;
  notes: string;
  salesChannel: string;
  discount: number;
  shippingIncome: number;
  platformFee: number;
  sellerShippingCost: number;
  items: Array<{ id: string; unitPrice: number }>;
};

export async function createOrder(input: CreateOrderInput) {
  const response = await fetch(API_ROUTES.createOrder, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ orderId: string }>(response);
}

export async function archiveOrder(orderId: string) {
  const response = await fetch(API_ROUTES.order(orderId), {
    method: "DELETE",
  });
  return readApiResponse<{ archived: boolean }>(response);
}

export async function updateOrder(orderId: string, input: UpdateOrderInput) {
  const response = await fetch(API_ROUTES.order(orderId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ updated: boolean }>(response);
}
