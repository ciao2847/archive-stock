/** Existing product prices are member prices, in NT dollars. */
export const LIST_PRICE_MARKUP = 150;

export function getListPrice(memberPrice: number) {
  return Math.round((memberPrice + LIST_PRICE_MARKUP) * 100) / 100;
}
