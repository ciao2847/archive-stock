export type OrderSourceFilter =
  | "all"
  | "general"
  | "stall"
  | "claim"
  | "bundle";

export function getOrderSourceFilter(value: string | null): OrderSourceFilter {
  return value === "general" ||
    value === "stall" ||
    value === "claim" ||
    value === "bundle"
    ? value
    : "all";
}

export function getOrdersPath(source: OrderSourceFilter, orderNo?: string) {
  const params = new URLSearchParams();
  if (source !== "all") params.set("source", source);
  if (source === "stall" && orderNo) params.set("order", orderNo);
  const query = params.toString();
  return `/orders${query ? `?${query}` : ""}`;
}

export function getOrderSource(notes: string | null | undefined) {
  return notes === "攤位掃碼結帳" ? "stall" : "general";
}
