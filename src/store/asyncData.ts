export type RequestStatus = "idle" | "loading" | "succeeded" | "failed";

export type AsyncDataState<T> = {
  data: T | null;
  status: RequestStatus;
  error: string | null;
};

export const createAsyncDataState = <T>(): AsyncDataState<T> => ({
  data: null,
  status: "idle",
  error: null,
});

export const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "資料讀取失敗，請稍後再試。";
