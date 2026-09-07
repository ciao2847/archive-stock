import { isProductAvailable, toNumber } from "@/constants";
import type { Product } from "@/lib/types";

export function searchAvailableProducts(products: Product[], query: string) {
  const search = query.toLowerCase();
  return products.filter(
    (product) =>
      isProductAvailable(product.status, product.stock) &&
      Object.values(product).flat().join(" ").toLowerCase().includes(search),
  );
}

export function calculateOrderTotals(
  products: Product[],
  prices: Record<string, string>,
  amounts: {
    shippingIncome: string;
    discount: string;
    platformFee: string;
    sellerShippingCost: string;
  },
) {
  const subtotal = products.reduce(
    (sum, product) =>
      sum + toNumber(prices[product.dbId || ""] ?? product.price),
    0,
  );
  const orderTotal =
    subtotal + toNumber(amounts.shippingIncome) - toNumber(amounts.discount);
  const netRevenue =
    orderTotal -
    toNumber(amounts.platformFee) -
    toNumber(amounts.sellerShippingCost);
  return { subtotal, orderTotal, netRevenue };
}
