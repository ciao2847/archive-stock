export function getTaipeiDay(now = new Date()) {
  const offset = 8 * 60 * 60 * 1000;
  const date = new Date(now.getTime() + offset).toISOString().slice(0, 10);
  const start = new Date(`${date}T00:00:00+08:00`);
  return {
    date,
    start: start.toISOString(),
    end: new Date(start.getTime() + 86400000).toISOString(),
  };
}

export type StallSales = {
  date: string;
  revenue: number;
  orderCount: number;
  itemCount: number;
  discount: number;
  payments: Record<string, { revenue: number; orderCount: number }>;
};
export function sumStallSales(
  orders: Array<{
    discount?: number | null;
    stall_payment_method?: string;
    order_items: Array<{ quantity: number; unit_price: number }>;
  }>,
) {
  let cents = 0;
  let itemCount = 0;
  let discount = 0;
  const payments: StallSales["payments"] = {};
  for (const order of orders) {
    let subtotal = 0;
    for (const item of order.order_items) {
      subtotal += Math.round(Number(item.unit_price) * 100) * item.quantity;
      itemCount += item.quantity;
    }
    const reduction = Math.round(Number(order.discount ?? 0) * 100);
    discount += reduction;
    cents += subtotal - reduction;
    const method = order.stall_payment_method || "unspecified";
    const payment = payments[method] ?? { revenue: 0, orderCount: 0 };
    payment.revenue =
      Math.round(payment.revenue * 100 + subtotal - reduction) / 100;
    payment.orderCount++;
    payments[method] = payment;
  }
  return {
    revenue: cents / 100,
    orderCount: orders.length,
    itemCount,
    discount: discount / 100,
    payments,
  };
}
