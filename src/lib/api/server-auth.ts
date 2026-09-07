import "server-only";

import { createClient } from "@/utils/supabase/server";

export type UserRole = "admin" | "staff";

type AuthenticatedApiContext = {
  ok: true;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  inventoryOwnerId: string;
  role: UserRole;
};

type RejectedApiContext = {
  ok: false;
  response: Response;
};

export async function requireApiUser(
  allowedRoles: readonly UserRole[] = ["admin", "staff"],
): Promise<AuthenticatedApiContext | RejectedApiContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      ok: false,
      response: apiFailure("請先登入", 401),
    };
  }

  const { data, error: roleError } = await supabase.rpc("my_role");
  const role = data === "admin" || data === "staff" ? data : null;
  if (roleError || !role || !allowedRoles.includes(role)) {
    return {
      ok: false,
      response: apiFailure("權限不足", 403),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("inventory_owner_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile?.inventory_owner_id) {
    return {
      ok: false,
      response: apiFailure("帳號尚未綁定庫藏", 403, profileError?.code),
    };
  }

  return {
    ok: true,
    supabase,
    userId: user.id,
    inventoryOwnerId: profile.inventory_owner_id,
    role,
  };
}

export function apiSuccess<T>(data: T, status = 200) {
  return Response.json(
    { success: true, data },
    {
      status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    },
  );
}

export function apiFailure(error: string, status: number, code?: string) {
  return Response.json(
    { success: false, error, ...(code ? { code } : {}) },
    {
      status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    },
  );
}

/** Keep unexpected server failures in the same JSON contract as API errors. */
export async function withApiErrorHandling(
  operation: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.error("API request failed", { operation, requestId, error });
    return apiFailure(
      `伺服器處理失敗（追蹤碼：${requestId}）。請先重新整理確認是否已儲存，再重試`,
      500,
      "INTERNAL_ERROR",
    );
  }
}
