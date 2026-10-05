import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serviceClient: SupabaseClient | undefined;

export function createServiceClient() {
  if (serviceClient) return serviceClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) {
    throw new Error("Supabase service credentials are not configured");
  }

  serviceClient = createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: { "X-Client-Info": "archive-stock-server" },
    },
  });
  return serviceClient;
}
