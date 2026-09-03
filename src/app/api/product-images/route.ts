import { IMAGE_UPLOAD } from "@/constants";
import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";
import { PRODUCT_IMAGE_BUCKET } from "@/lib/product-images";

function isValidImage(file: FormDataEntryValue | null): file is File {
  return (
    file instanceof File &&
    IMAGE_UPLOAD.acceptedTypes.includes(
      file.type as (typeof IMAGE_UPLOAD.acceptedTypes)[number],
    ) &&
    file.size <= IMAGE_UPLOAD.maxBytes
  );
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const form = await request.formData().catch(() => null);
  const main = form?.get("main") ?? null;
  const thumbnail = form?.get("thumbnail") ?? null;
  if (!isValidImage(main) || !isValidImage(thumbnail)) {
    return apiFailure("圖片格式不正確或檔案過大", 400);
  }

  const directory = crypto.randomUUID();
  const mainPath = `${directory}/main.webp`;
  const thumbnailPath = `${directory}/thumb.webp`;
  const mainUpload = await auth.supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(mainPath, main, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false,
    });
  if (mainUpload.error) return apiFailure(mainUpload.error.message, 400);

  const thumbnailUpload = await auth.supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(thumbnailPath, thumbnail, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false,
    });
  if (thumbnailUpload.error) {
    await auth.supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([mainPath]);
    return apiFailure(thumbnailUpload.error.message, 400);
  }

  return apiSuccess(
    { paths: [mainUpload.data.path, thumbnailUpload.data.path] },
    201,
  );
}

export async function DELETE(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    paths?: unknown;
  } | null;
  if (
    !Array.isArray(body?.paths) ||
    body.paths.length > 2 ||
    !body.paths.every((path) => typeof path === "string" && path.length < 1000)
  ) {
    return apiFailure("圖片路徑格式不正確", 400);
  }
  const { error } = await auth.supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .remove(body.paths as string[]);
  if (error) return apiFailure(error.message, 400);
  return apiSuccess({ removed: true });
}
