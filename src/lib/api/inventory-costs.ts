import { readApiResponse } from "./http-client";
import type { AccountingMode, ProductBatchCosts } from "@/lib/inventory-costs";
export function getProductBatchCosts(productId: string, signal?: AbortSignal) {
  return fetch(`/api/inventory-costs?${new URLSearchParams({ productId })}`, {
    signal,
    cache: "no-store",
  }).then(readApiResponse<ProductBatchCosts>);
}
export function getInventoryAccountingMode(
  ownerId: string,
  signal?: AbortSignal,
) {
  return fetch(`/api/inventory-costs?${new URLSearchParams({ ownerId })}`, {
    signal,
    cache: "no-store",
  }).then(readApiResponse<{ mode: AccountingMode }>);
}
export function saveBatchCost(input: {
  batchId: string;
  unitCost: number;
  notes: string;
  expectedRevision: number;
}) {
  return fetch("/api/inventory-costs", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then(readApiResponse<{ saved: boolean }>);
}
export function setInventoryAccountingMode(
  ownerId: string,
  mode: AccountingMode,
) {
  return fetch("/api/inventory-costs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId, mode }),
  }).then(readApiResponse<{ saved: boolean }>);
}
