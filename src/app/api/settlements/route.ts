import { z } from "zod";

import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";

const dateValue = z.union([z.iso.date(), z.literal("")]).optional();
const settlementSchema = z.object({
  ownerId: z.string().uuid(),
  start: dateValue,
  end: dateValue,
});

export async function POST(request: Request) {
  const auth = await requireApiUser(["admin"]);
  if (!auth.ok) return auth.response;

  const parsed = settlementSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return apiFailure("結算日期格式不正確", 400);
  if (
    parsed.data.start &&
    parsed.data.end &&
    parsed.data.start > parsed.data.end
  ) {
    return apiFailure("結束日期不可早於開始日期", 400);
  }

  const { data, error } = await auth.supabase.rpc(
    "create_financial_settlement",
    {
      p_owner_id: parsed.data.ownerId,
      p_start: parsed.data.start || undefined,
      p_end: parsed.data.end || undefined,
    },
  );
  if (error) {
    return apiFailure(
      error.message === "no unsettled financial data"
        ? "目前沒有尚未結算的收入或成本。"
        : error.message,
      400,
      error.code,
    );
  }
  return apiSuccess({ settlement: data }, 201);
}
