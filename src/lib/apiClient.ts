import swal from "sweetalert";

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const apiClient = async <T = any>(
  endpoint: string,
  options: RequestInit & { silent?: boolean } = {},
): Promise<T> => {
  const { silent = false, headers = {}, ...customConfig } = options;

  const config: RequestInit = {
    method: customConfig.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...headers,
    },
    ...customConfig,
  };

  try {
    const response = await fetch(endpoint, config);
    const data = await response.json().catch(() => null);

    // 原生 fetch 對 4xx/5xx 不會自動 reject，必須手動檢查 response.ok
    if (!response.ok) {
      const message =
        (data && typeof data === "object" && "message" in data && typeof data.message === "string" && data.message) ||
        (data && typeof data === "object" && "error" in data && typeof data.error === "string" && data.error) ||
        data?.toString() ||
        `HTTP ${response.status} Error`;
      throw new ApiError(response.status, message, data);
    }
    return data as T;
  } catch (error: any) {
    if (!silent && typeof window !== "undefined") {
      void swal({
        title: "網路通訊錯誤",
        text: error?.message || "請檢查網路連線或稍後再試",
        icon: "error",
      });
    }
    throw error;
  }
};
