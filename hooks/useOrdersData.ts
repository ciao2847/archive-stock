"use client";

import { useCallback, useEffect } from "react";
import { shallowEqual } from "react-redux";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchOrdersData } from "@/store/slices/ordersSlice";

export function useOrdersData() {
  const dispatch = useAppDispatch();
  const data = useAppSelector((state) => state.ordersData.data, shallowEqual);
  const status = useAppSelector((state) => state.ordersData.status);
  const error = useAppSelector((state) => state.ordersData.error);

  useEffect(() => {
    if (data === null && status === "idle") {
      void dispatch(fetchOrdersData());
    }
  }, [data, dispatch, status]);

  const refresh = useCallback(() => dispatch(fetchOrdersData()).unwrap(), [dispatch]);

  return {
    data,
    error,
    loading: status === "idle" || (status === "loading" && data === null),
    refreshing: status === "loading" && data !== null,
    refresh,
  };
}
