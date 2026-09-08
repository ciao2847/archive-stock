"use client";

import { useCallback } from "react";
import { useOrdersQuery } from "@/api/orderQueries";

export function useOrdersData() {
  const { data, error, isLoading, isFetching, refetch } = useOrdersQuery();

  const refresh = useCallback(async () => {
    const result = await refetch();
    return result.data ?? [];
  }, [refetch]);

  return {
    data: data ?? null,
    error: error ? (error as Error).message || "讀取訂單失敗" : null,
    loading: isLoading,
    refreshing: isFetching && !isLoading,
    refresh,
  };
}
