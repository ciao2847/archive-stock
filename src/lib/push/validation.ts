import { z } from "zod";

export function isPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      [
        "fcm.googleapis.com",
        "android.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
const base64Key = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+={0,2}$/)
    .refine((value) => Buffer.from(value, "base64url").length === bytes);
export const subscriptionSchema = z.object({
  endpoint: z.string().min(10).max(2048).refine(isPushEndpoint),
  keys: z.object({
    p256dh: base64Key(65).refine(
      (value) => Buffer.from(value, "base64url")[0] === 4,
    ),
    auth: base64Key(16),
  }),
  inventoryIds: z
    .array(z.string().uuid())
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const endpointSchema = z.object({
  endpoint: z.string().max(2048).refine(isPushEndpoint),
});
export function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}
export function canReceiveInventory(
  role: string,
  ownInventory: string,
  ids: string[],
) {
  return (
    role === "admin" ||
    (role === "staff" && ids.every((id) => id === ownInventory))
  );
}
