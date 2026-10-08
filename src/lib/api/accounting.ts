import { readApiResponse } from "./http-client";
import {
  type AccountingData,
  type PeriodCost,
  type PeriodCostInput,
} from "@/lib/accounting";

type PeriodInput = { ownerId: string; start: string; end: string };
export async function getAccounting(input: PeriodInput, signal?: AbortSignal) {
  return readApiResponse<AccountingData>(
    await fetch(`/api/accounting?${new URLSearchParams(input)}`, {
      signal,
      cache: "no-store",
    }),
  );
}
export async function savePeriodCost(input: PeriodCostInput) {
  return readApiResponse<{ cost: PeriodCost }>(
    await fetch("/api/accounting", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}
