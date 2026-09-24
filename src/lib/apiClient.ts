import swal from "sweetalert";

type ApiClientOptions = RequestInit & { silent?: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(data: unknown, status: number) {
  if (isRecord(data)) {
    if (typeof data.message === "string") return data.message;
    if (typeof data.error === "string") return data.error;
  }
  return typeof data === "string" ? data : `HTTP ${status} Error`;
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const apiClient = async <T>(
  endpoint: string,
  options: ApiClientOptions = {},
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
      throw new ApiError(
        response.status,
        getErrorMessage(data, response.status),
        data,
      );
    }
    if (isRecord(data) && data.success === true && "data" in data) {
      return data.data as T;
    }
    return data as T;
  } catch (error: unknown) {
    if (!silent && typeof window !== "undefined") {
      void swal({
        title: "網路通訊錯誤",
        text:
          error instanceof Error ? error.message : "請檢查網路連線或稍後再試",
        type: "error",
      });
    }
    throw error;
  }
};
