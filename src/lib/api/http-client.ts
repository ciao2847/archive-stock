type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export async function readApiResponse<T>(response: Response): Promise<T> {
  const body = (await response
    .json()
    .catch(() => null)) as ApiResponse<T> | null;

  if (!body || typeof body !== "object" || typeof body.success !== "boolean") {
    if (
      response.status === 401 ||
      (response.redirected && new URL(response.url).pathname === "/login")
    ) {
      throw new Error("登入已失效，請重新登入後再試");
    }
    const requestId = response.headers.get("x-vercel-id");
    throw new Error(
      `伺服器沒有正確回傳資料（HTTP ${response.status}${requestId ? `，追蹤碼：${requestId}` : ""}）。請先重新整理確認是否已儲存，再重試`,
    );
  }
  if (!response.ok || !body.success) {
    throw new Error(!body.success ? body.error : "伺服器請求失敗，請稍後再試");
  }
  return body.data;
}
