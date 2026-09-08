import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 分鐘內視為新鮮，不重複發送請求
      gcTime: 1000 * 60 * 30, // 30 分鐘垃圾回收
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
