import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { adaptProducts } from "@/adapters/productAdapter";
import { API_ROUTES } from "@/constants";
import type { Product } from "@/lib/types";

export const useProductsQuery = (options: { enabled?: boolean } = {}) =>
  useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: async () => {
      const raw = await apiClient<Product[]>(API_ROUTES.getProducts);
      return adaptProducts(raw);
    },
    staleTime: 1000 * 60 * 5,
    ...options,
  });
