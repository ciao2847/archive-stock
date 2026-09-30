import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { API_ROUTES } from "@/constants";
import type { AccountData } from "@/lib/types";

export const accountQueryKey = (authScope: string) =>
  ["account", authScope] as const;

export const useAccountQuery = (
  authScope: string,
  options: { enabled?: boolean } = {},
) => {
  const { enabled = true } = options;

  return useQuery<AccountData>({
    queryKey: accountQueryKey(authScope),
    queryFn: async () => {
      return apiClient<AccountData>(API_ROUTES.getAccount);
    },
    enabled: Boolean(authScope) && enabled,
    staleTime: 1000 * 60 * 5,
  });
};
