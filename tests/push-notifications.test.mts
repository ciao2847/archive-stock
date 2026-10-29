import assert from "node:assert/strict";
import { test } from "node:test";
import { createECDH, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import {
  canReceiveInventory,
  isPushEndpoint,
  subscriptionSchema,
} from "../src/lib/push/validation.ts";
const owner = "00000000-0000-4000-8000-000000000001";
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const valid = {
  endpoint: "https://web.push.apple.com/test",
  keys: {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  },
  inventoryIds: [owner],
};
test("push endpoint validation rejects SSRF and subscriptions require valid keys and scope", () => {
  for (const endpoint of [
    "http://web.push.apple.com/x",
    "https://127.0.0.1/x",
    "https://web.push.apple.com.attacker.test/x",
    "https://web.push.apple.com:444/x",
    "https://user:pass@web.push.apple.com/x",
    "https://metadata.google.internal/x",
  ])
    assert.equal(isPushEndpoint(endpoint), false);
  assert.equal(subscriptionSchema.safeParse(valid).success, true);
  assert.equal(
    subscriptionSchema.safeParse({
      ...valid,
      keys: { auth: "abc", p256dh: "abc" },
    }).success,
    false,
  );
  assert.equal(
    subscriptionSchema.safeParse({ ...valid, inventoryIds: [] }).success,
    false,
  );
  assert.equal(canReceiveInventory("staff", owner, [owner]), true);
  assert.equal(canReceiveInventory("staff", owner, ["other"]), false);
  assert.equal(canReceiveInventory("admin", owner, ["other"]), true);
});
test("service worker displays private-safe payload and notification click remains on-site", async () => {
  const source = await readFile("public/sw.js", "utf8");
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: Array<{
    title: string;
    options: { data: { url: string }; tag: string };
  }> = [];
  let opened = "";
  const self = {
    addEventListener: (name: string, fn: (event: unknown) => void) => {
      listeners[name] = fn;
    },
    skipWaiting: () => {},
    location: { origin: "https://archive-stock.vercel.app" },
    registration: {
      showNotification: async (title: string, options: unknown) => {
        shown.push({
          title,
          options: options as (typeof shown)[number]["options"],
        });
      },
    },
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      openWindow: async (url: string) => {
        opened = url;
      },
    },
  };
  vm.runInNewContext(source, { self, URL });
  let task: Promise<unknown> | undefined;
  listeners.push({
    data: {
      json: () => ({
        title: "新訂購",
        body: "共3件",
        url: "https://attacker.test",
        tag: "event-1",
      }),
    },
    waitUntil: (p: Promise<unknown>) => {
      task = p;
    },
  });
  await task;
  assert.equal(shown[0].options.data.url, "/");
  assert.equal(shown[0].options.tag, "event-1");
  listeners.push({
    data: { json: () => ({ url: `/notifications/${owner}`, tag: "event-1" }) },
    waitUntil: (p: Promise<unknown>) => {
      task = p;
    },
  });
  await task;
  listeners.notificationclick({
    notification: { close() {}, data: shown[1].options.data },
    waitUntil: (p: Promise<unknown>) => {
      task = p;
    },
  });
  await task;
  assert.equal(
    opened,
    `https://archive-stock.vercel.app/notifications/${owner}`,
  );
});
const bundle = await build({
  entryPoints: ["src/lib/push/server.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "push-fixtures",
      setup(b) {
        b.onResolve({ filter: /^server-only$/ }, () => ({
          path: "empty",
          namespace: "fixture",
        }));
        b.onResolve({ filter: /^web-push$/ }, () => ({
          path: "push",
          namespace: "fixture",
        }));
        b.onResolve({ filter: /utils\/supabase\/service$/ }, () => ({
          path: "db",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents:
            args.path === "empty"
              ? ""
              : args.path === "push"
                ? "export default {sendNotification:(...args)=>globalThis.pushSend(...args)};"
                : "export const createServiceClient=()=>globalThis.pushDatabase;",
        }));
      },
    },
  ],
});
const { dispatchOrderPushes, authorizedDispatcher } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const fixtures = globalThis as typeof globalThis & {
  pushSend: unknown;
  pushDatabase: unknown;
};
test("worker isolates per-device failures, removes stale endpoints and acknowledges only its lease", async () => {
  const originals = {
    public: process.env.VAPID_PUBLIC_KEY,
    private: process.env.VAPID_PRIVATE_KEY,
    cron: process.env.PUSH_CRON_SECRET,
  };
  process.env.VAPID_PUBLIC_KEY = "test-public";
  process.env.VAPID_PRIVATE_KEY = "test-private";
  process.env.PUSH_CRON_SECRET = "cron-secret";
  const acks: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  const payloads: string[] = [];
  fixtures.pushSend = async (
    subscription: { endpoint: string },
    payload: string,
  ) => {
    payloads.push(payload);
    if (subscription.endpoint.endsWith("expired")) throw { statusCode: 410 };
    if (subscription.endpoint.endsWith("retry")) throw { statusCode: 503 };
  };
  fixtures.pushDatabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_order_push_deliveries")
        return {
          data: ["success", "expired", "retry"].map((suffix) => ({
            delivery_id: suffix,
            lease_token: "lease-" + suffix,
            event_id: owner,
            inventory_id: owner,
            kind: "bundle",
            source_id: 1,
            endpoint: "https://web.push.apple.com/" + suffix,
            p256dh: valid.keys.p256dh,
            auth_key: valid.keys.auth,
          })),
          error: null,
        };
      acks.push(args);
      return { error: null };
    },
    from: (table: string) => {
      let deletion = false;
      const query = {
        select() {
          return query;
        },
        eq(_key: string, value: unknown) {
          if (deletion) deleted.push(String(value));
          return query;
        },
        delete() {
          deletion = true;
          return query;
        },
        maybeSingle: async () => ({
          error: null,
          data:
            table === "inventory_databases"
              ? { name: "海報小天地" }
              : {
                  title: "配單",
                  customer_nickname: "private customer",
                  confirmation_code: "C1",
                  confirmed_at: "2026-10-15",
                  total_amount: 1250,
                  status: "confirmed",
                },
        }),
        then: (resolve: (value: unknown) => void) => resolve({ error: null }),
      };
      return query;
    },
  };
  try {
    assert.equal(
      authorizedDispatcher(
        new Request("https://example.com", {
          headers: { authorization: "Bearer wrong" },
        }),
      ),
      false,
    );
    assert.equal(
      authorizedDispatcher(
        new Request("https://example.com", {
          headers: { authorization: "Bearer cron-secret" },
        }),
      ),
      true,
    );
    assert.deepEqual(await dispatchOrderPushes(), {
      processed: 3,
      delivered: 1,
    });
    assert.equal(acks.find((x) => x.p_id === "success")?.p_result, "sent");
    assert.equal(acks.find((x) => x.p_id === "retry")?.p_result, "retry");
    assert.equal(acks.find((x) => x.p_id === "expired")?.p_result, "skipped");
    assert.ok(acks.every((x) => x.p_lease === "lease-" + x.p_id));
    assert.deepEqual(deleted, ["https://web.push.apple.com/expired"]);
    assert.ok(payloads.every((text) => !text.includes("private customer")));
    assert.match(payloads[0], /notifications/);
  } finally {
    for (const [name, value] of Object.entries({
      VAPID_PUBLIC_KEY: originals.public,
      VAPID_PRIVATE_KEY: originals.private,
      PUSH_CRON_SECRET: originals.cron,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    delete (globalThis as Record<string, unknown>).pushSend;
    delete (globalThis as Record<string, unknown>).pushDatabase;
  }
});
