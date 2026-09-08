"use client";

import { useCallback } from "react";
import { useProductsQuery } from "@/api/productQueries";

export function useProductsData() {
  const { data, error, isLoading, isFetching, refetch } = useProductsQuery();

  const refresh = useCallback(async () => {
    const result = await refetch();
    return result.data ?? [];
  }, [refetch]);

  return {
    data: data ?? null,
    error: error ? (error as Error).message || "讀取商品失敗" : null,
    loading: isLoading,
    refreshing: isFetching && !isLoading,
    refresh,
  };
}
