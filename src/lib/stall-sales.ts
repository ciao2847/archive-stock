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
};
export function sumStallSales(
  orders: Array<{
    order_items: Array<{ quantity: number; unit_price: number }>;
  }>,
) {
  let cents = 0;
  let itemCount = 0;
  for (const order of orders)
    for (const item of order.order_items) {
      cents += Math.round(Number(item.unit_price) * 100) * item.quantity;
      itemCount += item.quantity;
    }
  return { revenue: cents / 100, orderCount: orders.length, itemCount };
}
