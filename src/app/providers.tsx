"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { makeStore, type AppStore } from "@/store";
import { createClient } from "@/utils/supabase/client";

function AuthQueryCacheGuard({ queryClient }: { queryClient: QueryClient }) {
  const router = useRouter();
  const userId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user.id ?? null;

      if (event === "INITIAL_SESSION" && userId.current === undefined) {
        userId.current = nextUserId;
        return;
      }
      if (userId.current === nextUserId) return;

      userId.current = nextUserId;
      queryClient.clear();
      window.localStorage.removeItem("archive-stock-owner-id");

      if (event === "SIGNED_OUT") router.replace("/login");
      router.refresh();
    });

    return () => subscription.unsubscribe();
  }, [queryClient, router]);

  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [store] = useState<AppStore>(() => makeStore());
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5,
            gcTime: 1000 * 60 * 30,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthQueryCacheGuard queryClient={queryClient} />
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
}

export const StoreProvider = AppProviders;
