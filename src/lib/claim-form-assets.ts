import { IMAGE_UPLOAD } from "@/constants";

export const CLAIM_FORM_ASSET_BUCKET = "claim-form-assets";

export function validateClaimFormBanner(
  file: Pick<File, "type" | "size">,
): string | undefined {
  if (
    !IMAGE_UPLOAD.acceptedTypes.includes(
      file.type as (typeof IMAGE_UPLOAD.acceptedTypes)[number],
    )
  ) {
    return "請選擇 JPG、PNG 或 WebP 圖片";
  }
  if (file.size > IMAGE_UPLOAD.maxBytes) {
    return `圖片不可超過 ${IMAGE_UPLOAD.maxMegabytes}MB`;
  }
}

function canvasToWebp(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("圖片壓縮失敗"))),
      "image/webp",
      0.86,
    );
  });
}

export async function createClaimFormBannerImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const maxDimension = 2400;
  const scale = Math.min(
    1,
    maxDimension / Math.max(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("無法處理圖片");
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvasToWebp(canvas);
}

export function getClaimFormAssetPublicUrl(path?: string | null) {
  if (!path) return undefined;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!supabaseUrl) return undefined;

  const encodedPath = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${supabaseUrl}/storage/v1/object/public/${CLAIM_FORM_ASSET_BUCKET}/${encodedPath}`;
}
