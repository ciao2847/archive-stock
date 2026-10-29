import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  getLineChannels,
  resolveLineChannel,
} from "../src/lib/line-channels.ts";
const first = {
  inventoryId: "00000000-0000-4000-8000-000000000001",
  channelSecret: "first-secret",
  channelAccessToken: "first-token",
};
const second = {
  inventoryId: "00000000-0000-4000-8000-000000000002",
  channelSecret: "second-secret",
  channelAccessToken: "second-token",
};
const legacy = {
  LINE_INVENTORY_ID: first.inventoryId,
  LINE_CHANNEL_SECRET: first.channelSecret,
  LINE_CHANNEL_ACCESS_TOKEN: first.channelAccessToken,
};
const body = '{"events":[],"text":"查詢訂單\\n香港"}';
function signature(secret: string, text = body) {
  return createHmac("sha256", secret).update(text).digest("base64");
}
test("existing channel remains available and optional second account is isolated", () => {
  assert.deepEqual(getLineChannels(legacy), [first]);
  const channels = getLineChannels({
    ...legacy,
    LINE_SECOND_INVENTORY_ID: second.inventoryId,
    LINE_SECOND_CHANNEL_SECRET: second.channelSecret,
    LINE_SECOND_CHANNEL_ACCESS_TOKEN: second.channelAccessToken,
  });
  assert.deepEqual(
    resolveLineChannel(body, signature(first.channelSecret), channels),
    first,
  );
  assert.deepEqual(
    resolveLineChannel(body, signature(second.channelSecret), channels),
    second,
  );
});
test("multi-account list replaces legacy mapping and uses each channel's own token", () => {
  const channels = getLineChannels({
    ...legacy,
    LINE_CHANNELS: JSON.stringify([second, first]),
  });
  assert.equal(
    resolveLineChannel(body, signature(second.channelSecret), channels)
      ?.channelAccessToken,
    second.channelAccessToken,
  );
});
test("missing, forged, malformed and modified-body signatures are rejected", () => {
  for (const supplied of [null, "", "garbage", signature("unknown")])
    assert.equal(
      resolveLineChannel(body, supplied, [first, second]),
      undefined,
    );
  assert.equal(
    resolveLineChannel(body + " ", signature(first.channelSecret), [first]),
    undefined,
  );
});
test("invalid and ambiguous configuration fails without leaking credentials", () => {
  for (const env of [
    {},
    { ...legacy, LINE_CHANNEL_SECRET: "" },
    { ...legacy, LINE_SECOND_INVENTORY_ID: second.inventoryId },
    { ...legacy, LINE_CHANNELS: "secret-invalid-json" },
    { LINE_CHANNELS: "[]" },
    { LINE_CHANNELS: JSON.stringify([{ ...first, inventoryId: "bad" }]) },
    ...["inventoryId", "channelSecret", "channelAccessToken"].map((key) => ({
      LINE_CHANNELS: JSON.stringify([
        first,
        { ...second, [key]: first[key as keyof typeof first] },
      ]),
    })),
  ]) {
    assert.throws(
      () => getLineChannels(env),
      (error: Error) =>
        !error.message.includes("first-secret") &&
        !error.message.includes("first-token") &&
        !error.message.includes("secret-invalid-json"),
    );
  }
});
