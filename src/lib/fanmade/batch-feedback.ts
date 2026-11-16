import { fanmadeBatchSchema } from "./validation";

export type FanmadeBatchDraftRow = {
  key: string;
  imageKey: string;
  ip: string;
  title: string;
  craft: string;
  stock: string;
  paths?: readonly [string, string];
};

export type FanmadeBatchFeedback = {
  message: string;
  rowKey?: string;
  imageKey?: string;
  field?: "ip" | "title" | "craft" | "stock" | "imagePaths";
};

// Only validate drafts here. These placeholders never leave this function.
const VALIDATION_UUID = "00000000-0000-4000-8000-000000000000";
const VALIDATION_PATHS = [
  `${VALIDATION_UUID}/main.webp`,
  `${VALIDATION_UUID}/thumb.webp`,
] as const;

function shortName(value: string, maximum: number) {
  const text = value.trim().replace(/\s+/gu, " ");
  const characters = [...text];
  return characters.length > maximum
    ? `${characters.slice(0, maximum).join("")}…`
    : text;
}

/** Validate everything before compression/upload without modifying draft rows. */
export function validateFanmadeBatchDraft(
  rows: readonly FanmadeBatchDraftRow[],
): FanmadeBatchFeedback | null {
  const result = fanmadeBatchSchema.safeParse({
    action: "batch",
    requestId: VALIDATION_UUID,
    items: rows.map((row) => ({
      ip: row.ip,
      title: row.title,
      craft: row.craft,
      stock: row.stock.trim() === "" ? Number.NaN : Number(row.stock),
      imagePaths: row.paths ?? VALIDATION_PATHS,
    })),
  });
  if (result.success) return null;

  const issue =
    result.error.issues.find(
      (item) => item.path.length === 1 && item.path[0] === "items",
    ) ?? result.error.issues[0];

  if (issue.path.length === 1 && issue.path[0] === "items") {
    if (issue.code === "too_small")
      return { message: "請先加入至少一張海報圖片，再建立本批商品。" };
    if (issue.code === "too_big")
      return {
        message: `本批最多 ${issue.maximum} 件工藝商品，目前有 ${rows.length} 件，請分批建立。`,
      };
  }

  const rowIndex = issue.path[0] === "items" ? issue.path[1] : undefined;
  const row = typeof rowIndex === "number" ? rows[rowIndex] : undefined;
  if (!row) return { message: "本批商品資料未完成，請檢查後再建立。" };

  const imageNumber =
    [...new Set(rows.map((item) => item.imageKey))].indexOf(row.imageKey) + 1;
  const title = shortName(row.title, 24) || `圖${imageNumber}（未填海報名稱）`;
  const craft = shortName(row.craft, 16) || "未填工藝";
  const location = `「${title}／${craft}」：`;
  const field = issue.path[2];
  let feedback: Pick<FanmadeBatchFeedback, "field" | "message">;

  switch (field) {
    case "ip":
      feedback = {
        field,
        message:
          issue.code === "too_big"
            ? "IP 最多 200 字，請縮短後再建立。"
            : "尚未填寫 IP，請補填上方批次 IP 或本工藝的個別 IP。",
      };
      break;
    case "title":
      feedback = {
        field,
        message:
          issue.code === "too_big"
            ? "海報名稱最多 200 字，請縮短名稱後再建立。"
            : "尚未填寫海報名稱，請填寫這張海報的名稱。",
      };
      break;
    case "craft":
      feedback = {
        field,
        message:
          issue.code === "too_big"
            ? "工藝名稱最多 100 字，請縮短後再建立。"
            : "尚未填寫工藝名稱，請填妥本圖工藝。",
      };
      break;
    case "stock":
      feedback = {
        field,
        message: "現貨庫存必須為 0 至 1000 的整數，不能留白。",
      };
      break;
    case "imagePaths":
      feedback = {
        field,
        message: "圖片上傳資料不完整或格式不正確，請重新選擇這張圖片後再試。",
      };
      break;
    default:
      feedback =
        issue.message === "圖片組不一致"
          ? {
              field: "imagePaths",
              message: "圖片與縮圖資料不一致，請重新選擇這張圖片後再試。",
            }
          : {
              field: "title",
              message:
                "IP、海報名稱及工藝合計最多 300 字，請縮短內容後再建立。",
            };
  }

  return {
    ...feedback,
    message: location + feedback.message,
    rowKey: row.key,
    imageKey: row.imageKey,
  };
}
