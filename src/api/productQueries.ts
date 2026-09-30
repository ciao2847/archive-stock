import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { adaptProducts } from "@/adapters/productAdapter";
import { API_ROUTES } from "@/constants";
import type { Product } from "@/lib/types";

export const productsQueryKey = (authScope: string) =>
  ["products", authScope] as const;

export const useProductsQuery = (
  authScope: string,
  options: { enabled?: boolean } = {},
) => {
  const { enabled = true } = options;

  return useQuery<Product[]>({
    queryKey: productsQueryKey(authScope),
    queryFn: async () => {
      const raw = await apiClient<Product[]>(API_ROUTES.getProducts);
      return adaptProducts(raw);
    },
    enabled: Boolean(authScope) && enabled,
    staleTime: 1000 * 60 * 5,
  });
};
