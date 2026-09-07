import { API_ROUTES } from "@/constants";
import { readApiResponse } from "@/lib/api/http-client";

export async function downloadPrintLabels(
  productIds: string[],
  batchCreatedAtByProduct?: Record<string, string>,
) {
  const response = await fetch(API_ROUTES.getPrintLabels, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds, batchCreatedAtByProduct }),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(result?.error || "列印檔案產生失敗");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "archive-stock-niimbot-labels.xlsx";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function markPrintLabel(labelId: string) {
  const response = await fetch(API_ROUTES.getMarkPrintLabel, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ labelId }),
  });
  return readApiResponse<{ printed: boolean }>(response);
}
