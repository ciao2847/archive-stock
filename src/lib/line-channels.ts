import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const channelSchema = z.object({
  inventoryId: z.string().uuid(),
  channelSecret: z.string().trim().min(1),
  channelAccessToken: z.string().trim().min(1),
});
export type LineChannel = z.infer<typeof channelSchema>;

/** Server-only credentials: never expose these through the account API. */
export function getLineChannels(
  env: NodeJS.ProcessEnv = process.env,
): LineChannel[] {
  let channels: LineChannel[];
  if (env.LINE_CHANNELS?.trim()) {
    // An explicit list replaces the legacy configuration atomically. Never
    // fall back to another inventory when the multi-channel config is invalid.
    try {
      channels = z
        .array(channelSchema)
        .min(1)
        .max(20)
        .parse(JSON.parse(env.LINE_CHANNELS));
    } catch {
      throw new Error("Invalid LINE_CHANNELS configuration");
    }
  } else {
    const legacy = channelSchema.safeParse({
      inventoryId: env.LINE_INVENTORY_ID?.trim(),
      channelSecret: env.LINE_CHANNEL_SECRET,
      channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
    });
    if (!legacy.success)
      throw new Error(
        `Primary LINE configuration invalid: ${legacy.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
      );
    channels = [legacy.data];
    const secondValues = [
      env.LINE_SECOND_INVENTORY_ID,
      env.LINE_SECOND_CHANNEL_SECRET,
      env.LINE_SECOND_CHANNEL_ACCESS_TOKEN,
    ];
    if (secondValues.some((value) => value?.trim())) {
      const second = channelSchema.safeParse({
        inventoryId: env.LINE_SECOND_INVENTORY_ID?.trim(),
        channelSecret: env.LINE_SECOND_CHANNEL_SECRET,
        channelAccessToken: env.LINE_SECOND_CHANNEL_ACCESS_TOKEN,
      });
      if (!second.success)
        throw new Error(
          `Second LINE configuration invalid: ${second.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
        );
      channels.push(second.data);
    }
  }

  // A channel must resolve to exactly one inventory and one reply token.
  for (const field of [
    "inventoryId",
    "channelSecret",
    "channelAccessToken",
  ] as const) {
    if (
      new Set(channels.map((channel) => channel[field])).size !==
      channels.length
    ) {
      throw new Error(`Duplicate LINE channel mapping: ${field}`);
    }
  }
  return channels;
}

/** Authenticate the original request bytes before choosing an inventory. */
export function resolveLineChannel(
  rawBody: string,
  signature: string | null,
  channels: LineChannel[],
): LineChannel | undefined {
  if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return undefined;
  const supplied = Buffer.from(signature, "base64");
  return channels.find((channel) => {
    const expected = createHmac("sha256", channel.channelSecret)
      .update(rawBody)
      .digest();
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  });
}
