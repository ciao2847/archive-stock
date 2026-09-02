"use client";

import { useCallback, useEffect } from "react";
import { shallowEqual } from "react-redux";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchProductsData } from "@/store/slices/productsSlice";

export function useProductsData() {
  const dispatch = useAppDispatch();
  const data = useAppSelector((state) => state.productsData.data, shallowEqual);
  const status = useAppSelector((state) => state.productsData.status);
  const error = useAppSelector((state) => state.productsData.error);

  useEffect(() => {
    if (data === null && status === "idle") {
      void dispatch(fetchProductsData());
    }
  }, [data, dispatch, status]);

  const refresh = useCallback(
    () => dispatch(fetchProductsData()).unwrap(),
    [dispatch],
  );

  return {
    data,
    error,
    loading: status === "idle" || (status === "loading" && data === null),
    refreshing: status === "loading" && data !== null,
    refresh,
  };
}
