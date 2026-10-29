import { API_ROUTES } from "@/constants";
import type { PreorderBatchInput } from "@/lib/validation/preorder-batch";

export class PreorderBatchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function createPreorderBatch(input: PreorderBatchInput) {
  const response = await fetch(API_ROUTES.createPreorderBatch, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = (await response.json().catch(() => null)) as {
    success?: boolean;
    error?: string;
    data?: { batchId: string; productIds: string[] };
  } | null;
  if (!response.ok || !result?.success || !result.data)
    throw new PreorderBatchError(
      result?.error || "無法確認批次結果，請重試；相同批次不會重複建立",
      response.status,
    );
  return result.data;
}
