import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { adaptOrders } from "@/adapters/orderAdapter";
import { API_ROUTES } from "@/constants";
import type { Order } from "@/lib/types";
import type { OrderRow } from "@/lib/api/archive";

export const useOrdersQuery = (options: { enabled?: boolean } = {}) =>
  useQuery<Order[]>({
    queryKey: ["orders"],
    queryFn: async () => {
      const rows = await apiClient<OrderRow[]>(API_ROUTES.getOrders);
      return adaptOrders(rows);
    },
    staleTime: 1000 * 60 * 5,
    ...options,
  });
