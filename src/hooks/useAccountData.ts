"use client";

import { useCallback } from "react";
import { useAccountQuery } from "@/api/accountQueries";

export function useAccountData() {
  const { data, error, isLoading, isFetching, refetch } = useAccountQuery();

  const refresh = useCallback(async () => {
    const result = await refetch();
    return result.data ?? null;
  }, [refetch]);

  return {
    data: data ?? null,
    error: error ? (error as Error).message || "讀取帳號資料失敗" : null,
    loading: isLoading,
    refreshing: isFetching && !isLoading,
    refresh,
  };
}
