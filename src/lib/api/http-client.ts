type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export async function readApiResponse<T>(response: Response): Promise<T> {
  const body = (await response
    .json()
    .catch(() => null)) as ApiResponse<T> | null;

  if (!body) throw new Error("伺服器沒有正確回傳資料");
  if (!response.ok || !body.success) {
    throw new Error(!body.success ? body.error : "伺服器請求失敗，請稍後再試");
  }
  return body.data;
}
