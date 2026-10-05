import { z } from "zod";

import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import { asUntypedSupabase } from "@/lib/api/bundle-claims-server";
import {
  BUNDLE_CLAIM_IMAGE,
  canAccessBundleClaimOwner,
} from "@/lib/bundle-claims";

const pathPattern =
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[1-9][0-9]*\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp)$/;

const registerSchema = z.object({
  ownerId: z.string().uuid(),
  storagePath: z.string().max(600).regex(pathPattern),
  originalFilename: z.string().trim().min(1).max(255),
});

const deleteSchema = z.object({
  ownerId: z.string().uuid(),
  imageId: z.number().int().positive(),
});

function parseOrderId(value: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function metadataOf(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiErrorHandling(
    "POST /api/bundle-claims/[id]/images",
    async () => {
      const auth = await requireApiUser();
      if (!auth.ok) return auth.response;

      const orderId = parseOrderId((await params).id);
      if (!orderId) return apiFailure("喊單編號格式錯誤", 400);
      const parsed = registerSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return apiFailure("截圖資料格式錯誤", 400);
      if (
        !canAccessBundleClaimOwner(
          auth.role,
          auth.inventoryOwnerId,
          parsed.data.ownerId,
        )
      ) {
        return apiFailure("無法操作這個庫藏的截圖", 403);
      }

      const expectedPrefix = `${parsed.data.ownerId}/${orderId}/`;
      if (!parsed.data.storagePath.startsWith(expectedPrefix)) {
        return apiFailure("截圖路徑與訂單不相符", 400);
      }

      const supabase = asUntypedSupabase(auth.supabase);
      const filename = parsed.data.storagePath.slice(expectedPrefix.length);
      const { data: objects, error: listError } = await supabase.storage
        .from(BUNDLE_CLAIM_IMAGE.bucket)
        .list(`${parsed.data.ownerId}/${orderId}`, {
          limit: 2,
          search: filename,
        });
      if (listError) return apiFailure("無法驗證剛上傳的截圖", 400);
      const object = objects?.find((candidate) => candidate.name === filename);
      if (!object) return apiFailure("找不到剛上傳的截圖", 404);

      const metadata = metadataOf(object.metadata);
      const mediaType = String(
        metadata.mimetype ?? metadata.contentType ?? "",
      ).toLowerCase();
      const byteSize = Number(metadata.size ?? 0);
      if (
        !BUNDLE_CLAIM_IMAGE.acceptedTypes.includes(
          mediaType as (typeof BUNDLE_CLAIM_IMAGE.acceptedTypes)[number],
        ) ||
        !Number.isFinite(byteSize) ||
        byteSize <= 0 ||
        byteSize > BUNDLE_CLAIM_IMAGE.maxBytes
      ) {
        await supabase.storage
          .from(BUNDLE_CLAIM_IMAGE.bucket)
          .remove([parsed.data.storagePath]);
        return apiFailure("截圖格式或檔案大小不符合限制", 400);
      }

      const { data, error } = await supabase.rpc(
        "add_bundle_claim_order_image",
        {
          p_owner_id: parsed.data.ownerId,
          p_order_id: orderId,
          p_storage_path: parsed.data.storagePath,
          p_media_type: mediaType,
          p_original_filename: parsed.data.originalFilename,
          p_byte_size: byteSize,
        },
      );
      if (error) {
        await supabase.storage
          .from(BUNDLE_CLAIM_IMAGE.bucket)
          .remove([parsed.data.storagePath]);
        return apiFailure(
          error.message === "bundle claim image limit reached"
            ? "每筆喊單最多 10 張截圖"
            : error.message,
          400,
          error.code,
        );
      }

      const row = Array.isArray(data) ? data[0] : data;
      const { data: signed } = await supabase.storage
        .from(BUNDLE_CLAIM_IMAGE.bucket)
        .createSignedUrl(
          parsed.data.storagePath,
          BUNDLE_CLAIM_IMAGE.signedUrlTtlSeconds,
        );
      return apiSuccess(
        {
          id: Number(row?.image_id),
          sortOrder: Number(row?.sort_order),
          mediaType,
          originalFilename: parsed.data.originalFilename,
          byteSize,
          url: signed?.signedUrl ?? "",
        },
        201,
      );
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiErrorHandling(
    "DELETE /api/bundle-claims/[id]/images",
    async () => {
      const auth = await requireApiUser();
      if (!auth.ok) return auth.response;

      const orderId = parseOrderId((await params).id);
      if (!orderId) return apiFailure("喊單編號格式錯誤", 400);
      const parsed = deleteSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return apiFailure("截圖資料格式錯誤", 400);
      if (
        !canAccessBundleClaimOwner(
          auth.role,
          auth.inventoryOwnerId,
          parsed.data.ownerId,
        )
      ) {
        return apiFailure("無法操作這個庫藏的截圖", 403);
      }

      const supabase = asUntypedSupabase(auth.supabase);
      const { data: image, error: imageError } = await supabase
        .from("bundle_claim_order_images")
        .select("storage_path,bundle_claim_orders!inner(owner_id,status)")
        .eq("id", parsed.data.imageId)
        .eq("order_id", orderId)
        .eq("bundle_claim_orders.owner_id", parsed.data.ownerId)
        .eq("bundle_claim_orders.status", "draft")
        .maybeSingle();
      if (imageError || !image) {
        return apiFailure("找不到可刪除的草稿截圖", 404, imageError?.code);
      }

      const { data: storagePath, error } = await supabase.rpc(
        "delete_bundle_claim_order_image",
        {
          p_owner_id: parsed.data.ownerId,
          p_order_id: orderId,
          p_image_id: parsed.data.imageId,
        },
      );
      if (error) return apiFailure(error.message, 400, error.code);

      const path =
        typeof storagePath === "string"
          ? storagePath
          : String(image.storage_path ?? "");
      if (path) {
        const removal = await supabase.storage
          .from(BUNDLE_CLAIM_IMAGE.bucket)
          .remove([path]);
        if (removal.error) {
          console.error("Bundle claim image object cleanup failed", {
            orderId,
            imageId: parsed.data.imageId,
            code: removal.error.name,
          });
        }
      }

      return apiSuccess({
        deleted: true as const,
        imageId: parsed.data.imageId,
      });
    },
  );
}
