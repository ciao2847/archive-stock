import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { API_ROUTES } from "@/constants";
import type { AccountData } from "@/lib/types";

export const useAccountQuery = (options: { enabled?: boolean } = {}) =>
  useQuery<AccountData>({
    queryKey: ["account"],
    queryFn: async () => {
      return apiClient<AccountData>(API_ROUTES.getAccount);
    },
    staleTime: 1000 * 60 * 5,
    ...options,
  });
