import { z } from "zod";
import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";

const requestSchema = z.object({ labelId: z.string().uuid() });

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return apiFailure("QR Code 資料格式不正確", 400);

  const { data, error } = await auth.supabase.rpc(
    "mark_product_qr_labels_printed",
    { p_label_ids: [parsed.data.labelId] },
  );
  if (error || data !== true) {
    return apiFailure(
      "這張 QR Code 已列印或已失效，不能再次列印。",
      409,
      error?.code,
    );
  }

  return apiSuccess({ printed: true });
}
