"use client";

import { useCallback, useEffect } from "react";
import { shallowEqual } from "react-redux";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAccountData } from "@/store/slices/accountSlice";

export function useAccountData() {
  const dispatch = useAppDispatch();
  const data = useAppSelector((state) => state.accountData.data, shallowEqual);
  const status = useAppSelector((state) => state.accountData.status);
  const error = useAppSelector((state) => state.accountData.error);

  useEffect(() => {
    if (data === null && status === "idle") {
      void dispatch(fetchAccountData());
    }
  }, [data, dispatch, status]);

  const refresh = useCallback(
    () => dispatch(fetchAccountData()).unwrap(),
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
