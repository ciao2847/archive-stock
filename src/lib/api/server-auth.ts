import "server-only";

import { createClient } from "@/utils/supabase/server";

export type UserRole = "admin" | "staff";

type AuthenticatedApiContext = {
  ok: true;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
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

  return { ok: true, supabase, userId: user.id, role };
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
