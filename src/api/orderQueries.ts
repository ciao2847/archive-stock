import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { adaptOrders } from "@/adapters/orderAdapter";
import { API_ROUTES } from "@/constants";
import type { Order } from "@/lib/types";
import type { OrderRow } from "@/lib/api/archive";

export const ordersQueryKey = (authScope: string) =>
  ["orders", authScope] as const;

export const useOrdersQuery = (
  authScope: string,
  options: { enabled?: boolean } = {},
) => {
  const { enabled = true } = options;

  return useQuery<Order[]>({
    queryKey: ordersQueryKey(authScope),
    queryFn: async () => {
      const rows = await apiClient<OrderRow[]>(API_ROUTES.getOrders);
      return adaptOrders(rows);
    },
    enabled: Boolean(authScope) && enabled,
    staleTime: 1000 * 60 * 5,
  });
};
