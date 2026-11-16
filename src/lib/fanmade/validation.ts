import { z } from "zod";
const uuid = z.string().uuid();
const money = z
  .number()
  .finite()
  .min(0)
  .max(9999999999.99)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6,
    "金額最多兩位小數",
  );
const item = z
  .object({
    ip: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    craft: z.string().trim().min(1).max(100),
    stock: z.number().int().min(0).max(1000),
    imagePaths: z.tuple([
      z.string().regex(/^[0-9a-f-]{36}\/main\.webp$/),
      z.string().regex(/^[0-9a-f-]{36}\/thumb\.webp$/),
    ]),
  })
  .refine(
    (x) =>
      x.imagePaths[1] === x.imagePaths[0].replace("/main.webp", "/thumb.webp"),
    "圖片組不一致",
  )
  .refine(
    (x) => [...`🎨 ${x.ip}／${x.title}｜${x.craft}`].length <= 300,
    "IP、商品名稱及工藝合計最多 300 字",
  );
const revision = {
  productId: uuid,
  updatedAt: z.string().datetime({ offset: true }),
};
export const fanmadeActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("price"), price: money }),
  z.object({
    action: z.literal("create_form"),
    title: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("form"),
    formId: z.number().int().positive(),
    title: z.string().trim().min(1).max(120),
    isOpen: z.boolean(),
  }),
  z.object({
    action: z.literal("batch"),
    requestId: uuid,
    items: z.array(item).min(1).max(50),
  }),
  z.object({
    action: z.literal("stock"),
    ...revision,
    stock: z.number().int().min(0).max(1000),
    reason: z.string().trim().min(1).max(200),
  }),
  z.object({ action: z.literal("active"), ...revision, active: z.boolean() }),
  z.object({
    action: z.literal("edit"),
    ...revision,
    title: z.string().trim().min(1).max(200),
    craft: z.string().trim().min(1).max(100),
  }),
  z.object({
    action: z.literal("migrate"),
    productId: uuid,
    craft: z.string().trim().min(1).max(100),
  }),
  z.object({ action: z.literal("retry_video"), ...revision }),
  z.object({
    action: z.literal("video"),
    ...revision,
    sourcePath: z
      .string()
      .max(400)
      .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/source\.(mp4|mov|webm)$/),
  }),
  z.object({
    action: z.literal("publish_ip"),
    formId: z.number().int().positive(),
    ipId: uuid,
    remove: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("publish"),
    formId: z.number().int().positive(),
    productIds: z
      .array(uuid)
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    remove: z.boolean().optional(),
  }),
]);
export type FanmadeAction = z.infer<typeof fanmadeActionSchema>;
export type FanmadeBatchItem = z.infer<typeof item>;
export const fanmadeBatchSchema = fanmadeActionSchema.options[3];
export const publicFanmadePageSchema = z.object({
  ip: uuid,
  page: z.coerce.number().int().min(1).max(10000).default(1),
  query: z.string().max(100).default(""),
});
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export function validateFanmadeVideo(file: Pick<File, "size" | "type">) {
  if (!["video/mp4", "video/quicktime", "video/webm"].includes(file.type))
    return "影片請使用 MP4、MOV 或 WebM";
  if (file.size === 0 || file.size > MAX_VIDEO_BYTES)
    return "影片最多 100MB，建議 60 秒內";
}
