export type PackingScanResult = {
  valid: boolean;
  reason: string;
  sku: string | null;
};

type PackingScanResponse = {
  result: PackingScanResult;
  method: "manual_sku" | "qr";
};

type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };

async function readApiResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!body) throw new Error("伺服器沒有正確回傳資料");
  if (!response.ok || !body.success) {
    throw new Error(
      !body.success ? body.error : "伺服器請求失敗，請稍後再試",
    );
  }
  return body.data;
}

export async function fetchPackingProgress(orderId: string) {
  const response = await fetch(
    `/api/packing?orderId=${encodeURIComponent(orderId)}`,
    { cache: "no-store" },
  );
  return readApiResponse<string[]>(response);
}

export async function scanPackingItem(orderId: string, value: string) {
  const response = await fetch("/api/packing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "scan", orderId, value }),
  });
  return readApiResponse<PackingScanResponse>(response);
}

export async function completePackingOrder(orderId: string) {
  const response = await fetch("/api/packing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete", orderId }),
  });
  const body = await readApiResponse<{ completed: boolean }>(response);
  return body.completed;
}
