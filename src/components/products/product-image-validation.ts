import { IMAGE_UPLOAD } from "@/constants";

export function validateProductImage(
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
