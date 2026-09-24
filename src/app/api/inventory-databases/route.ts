import { z } from "zod";
import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";

const qrDestinationUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  })
  .optional();

const updateInventoryDatabaseSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  ownerIds: z.array(z.string().uuid()).min(1),
  qrDestinationUrl: qrDestinationUrlSchema,
});

const createInventoryDatabaseSchema = updateInventoryDatabaseSchema.omit({
  id: true,
});

async function updateInventoryDatabase(
  request: Request,
  inventoryId: string | null,
) {
  const auth = await requireApiUser(["admin"]);
  if (!auth.ok) return auth.response;

  const schema = inventoryId
    ? updateInventoryDatabaseSchema
    : createInventoryDatabaseSchema;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure("請輸入資料庫名稱，並至少選擇一位擁有者", 400);
  }

  const { data, error } = await auth.supabase.rpc(
    "update_inventory_database_access",
    {
      p_inventory_id: inventoryId,
      p_name: parsed.data.name,
      p_owner_ids: [...new Set(parsed.data.ownerIds)],
      ...(parsed.data.qrDestinationUrl === undefined
        ? {}
        : { p_qr_destination_url: parsed.data.qrDestinationUrl }),
    },
  );
  if (error) return apiFailure(error.message, 400, error.code);

  return apiSuccess({ id: data }, inventoryId ? 200 : 201);
}

export async function POST(request: Request) {
  return updateInventoryDatabase(request, null);
}

export async function PATCH(request: Request) {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  const inventoryId =
    body &&
    typeof body === "object" &&
    "id" in body &&
    typeof body.id === "string"
      ? body.id
      : null;
  if (!inventoryId) return apiFailure("資料庫 ID 無效", 400);
  return updateInventoryDatabase(request, inventoryId);
}
