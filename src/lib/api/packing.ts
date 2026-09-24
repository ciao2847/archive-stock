import { API_ROUTES } from "@/constants";

export type PackingPackageItem = {
  orderItemId: string;
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  packedQuantity: number;
  scannedQuantity: number;
  packageQuantity: number;
};

export type PackingPackageOrder = {
  orderId: string;
  orderNo: string;
  status: string;
  createdAt: string;
  items: PackingPackageItem[];
};

export type PackingPackage = {
  id: string;
  packageNo: string;
  ownerId: string;
  customerKey: string;
  customerName: string;
  status: "packing" | "packed" | "shipped" | "cancelled";
  createdAt: string;
  orders: PackingPackageOrder[];
  scannedCount: number;
  orderCount: number;
};

export type PackingScanResult = {
  valid: boolean;
  reason: string;
  sku: string | null;
  orderId: string | null;
  orderNo: string | null;
  orderItemId: string | null;
};

export type PackingCompletion = {
  completed: boolean;
  packageNo: string;
  itemCount: number;
  orderCount: number;
  fullyPackedOrderCount: number;
};

type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };

async function readApiResponse<T>(response: Response): Promise<T> {
  const body = (await response
    .json()
    .catch(() => null)) as ApiResponse<T> | null;

  if (!body) throw new Error("伺服器沒有正確回傳資料");
  if (!response.ok || !body.success) {
    throw new Error(!body.success ? body.error : "伺服器請求失敗，請稍後再試");
  }
  return body.data;
}

export async function startPackingPackage(
  ownerId: string,
  customerKey: string,
) {
  const response = await fetch(API_ROUTES.getPacking, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start", ownerId, customerKey }),
  });
  return readApiResponse<PackingPackage>(response);
}

export async function fetchPackingPackage(packageId: string) {
  const response = await fetch(
    `${API_ROUTES.getPacking}?packageId=${encodeURIComponent(packageId)}`,
    { cache: "no-store" },
  );
  return readApiResponse<PackingPackage>(response);
}

export async function scanPackingPackage(packageId: string, value: string) {
  const response = await fetch(API_ROUTES.getPacking, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "scan", packageId, value }),
  });
  return readApiResponse<{
    result: PackingScanResult;
    method: "manual_sku" | "qr";
  }>(response);
}

export async function completePackingPackage(packageId: string) {
  const response = await fetch(API_ROUTES.getPacking, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete", packageId }),
  });
  return readApiResponse<PackingCompletion>(response);
}
