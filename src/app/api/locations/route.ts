import { z } from "zod";

import { LOCATION_CODE_PATTERN } from "@/constants";
import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";

const locationSchema = z.object({
  code: z.string().regex(LOCATION_CODE_PATTERN),
  description: z.string().max(500).optional().default(""),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = locationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return apiFailure("庫位資料格式不正確", 400);

  const code = parsed.data.code.toUpperCase();
  const [cabinet, shelf, bin] = code.split("-");
  const { data, error } = await auth.supabase
    .from("locations")
    .insert({
      code,
      cabinet,
      shelf: Number(shelf),
      bin: Number(bin),
      description: parsed.data.description.trim() || null,
    })
    .select("id,code")
    .single();

  if (error) {
    return apiFailure(
      error.code === "23505" ? "這個庫位已經存在" : error.message,
      error.code === "23505" ? 409 : 400,
      error.code,
    );
  }
  return apiSuccess(data, 201);
}
