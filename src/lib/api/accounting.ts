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

export async function savePeriodDetails(
  input: import("@/lib/accounting-details").PeriodDetailsInput,
) {
  return readApiResponse<{ cost: PeriodCost }>(
    await fetch("/api/accounting", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}
export async function downloadAccountingExcel(
  input: PeriodInput & { scope?: "period" | "all" },
) {
  const response = await fetch(
    `/api/accounting/export?${new URLSearchParams(input)}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    await readApiResponse(response);
    return;
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download =
    input.scope === "all"
      ? "全部帳期帳目.xlsx"
      : `帳目_${input.start}_${input.end}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
