import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["src/app/api/line/webhook/route.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "line-fixtures",
      setup(b) {
        b.onResolve({ filter: /^next\/server$/ }, () => ({
          path: "next",
          namespace: "fixture",
        }));
        b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({
          path: "supabase",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents:
            args.path === "next"
              ? "export const NextResponse=Response;"
              : "export const createClient=()=>globalThis.lineDatabase;",
        }));
      },
    },
  ],
});
const { POST } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const channels = [
  {
    inventoryId: "00000000-0000-4000-8000-000000000001",
    channelSecret: "secret-a",
    channelAccessToken: "token-a",
  },
  {
    inventoryId: "00000000-0000-4000-8000-000000000002",
    channelSecret: "secret-b",
    channelAccessToken: "token-b",
  },
];
const globals = globalThis as typeof globalThis & { lineDatabase: unknown };
function request(body: string, secret: string) {
  return new Request("https://example.com/api/line/webhook", {
    method: "POST",
    body,
    headers: {
      "x-line-signature": createHmac("sha256", secret)
        .update(body)
        .digest("base64"),
    },
  });
}
function event(text: string, extra = {}) {
  return JSON.stringify({
    ...extra,
    events: [
      {
        type: "message",
        replyToken: "reply-token",
        source: { type: "user", userId: "user-a" },
        message: { type: "text", text },
      },
    ],
  });
}
test("two accounts query only their bound inventory and reply with their own token", async () => {
  const originals = {
    env: process.env.LINE_CHANNELS,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SECRET_KEY,
    fetch: globalThis.fetch,
  };
  process.env.LINE_CHANNELS = JSON.stringify(channels);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "server-only";
  const queries: unknown[] = [];
  const replies: Array<{
    auth: string;
    text: string;
    payload: {
      messages: Array<{
        text: string;
        quickReply?: {
          items: Array<{ action: { label: string; data: string } }>;
        };
      }>;
    };
  }> = [];
  globals.lineDatabase = {
    async rpc(name: string, args: { p_inventory_id: string; p_phone: string }) {
      queries.push({ name, ...args });
      const isA = args.p_inventory_id === channels[0].inventoryId;
      return {
        data: {
          valid: true,
          found: true,
          all_paid: false,
          nickname: "客人",
          store_name: isA ? "小天地" : "香港代購",
          unsettled_items_count: 1,
          unsettled_amount: isA ? 100 : 200,
          submissions: [
            {
              form_title: isA ? "商品A" : "商品B",
              confirmation_code: "C1",
              payment_status: "pending",
              paid_amount: 0,
              outstanding_amount: isA ? 100 : 200,
              created_at: "2026-10-15T00:00:00Z",
              items: [
                {
                  name: isA ? "海報A" : "海報B",
                  quantity: 1,
                  subtotal: isA ? 100 : 200,
                },
              ],
            },
          ],
          transfer_account: {
            enabled: true,
            bank_code: "004",
            bank_name: "銀行",
            account: isA ? "111111" : "222222",
          },
        },
        error: null,
      };
    },
  };
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body));
    replies.push({
      auth: new Headers(init?.headers).get("Authorization")!,
      text: payload.messages[0].text,
      payload,
    });
    return new Response("{}");
  };
  try {
    for (const channel of channels)
      assert.equal(
        (
          await POST(
            request(
              event("未結帳 0987654321", {
                inventoryId: channels[1].inventoryId,
              }),
              channel.channelSecret,
            ),
          )
        ).status,
        200,
      );
    assert.deepEqual(
      queries,
      channels.map((channel) => ({
        name: "query_customer_claims_summary",
        p_inventory_id: channel.inventoryId,
        p_phone: "0987654321",
      })),
    );
    assert.equal(replies[0].auth, "Bearer token-a");
    assert.match(replies[0].text, /海報A/);
    assert.match(replies[0].text, /111111/);
    assert.doesNotMatch(replies[0].text, /海報B|222222/);
    assert.equal(replies[1].auth, "Bearer token-b");
    assert.match(replies[1].text, /海報B/);
    assert.match(replies[1].text, /222222/);
    assert.doesNotMatch(replies[1].text, /海報A|111111/);
    assert.equal(
      (await POST(request(event("0987654321"), "unknown"))).status,
      401,
    );
    assert.equal(queries.length, 2);
    assert.equal(replies.length, 2);
    assert.equal(
      (
        await POST(
          request(JSON.stringify({ events: [] }), channels[1].channelSecret),
        )
      ).status,
      200,
    );
    assert.equal(
      (await POST(request("null", channels[1].channelSecret))).status,
      400,
    );
    assert.equal(
      (await POST(request('{"events":{}}', channels[1].channelSecret))).status,
      400,
    );
    assert.equal(
      (await POST(request("not-json", channels[1].channelSecret))).status,
      400,
    );
    assert.equal(
      (await POST(request(event("結帳與查詢"), channels[1].channelSecret)))
        .status,
      200,
    );
    assert.match(replies.at(-1)!.text, /10 碼手機號碼/);
    assert.match(replies.at(-1)!.text, /已結帳訂單/);
    const replyCount = replies.length;
    for (const keyword of [
      "結帳",
      "我要結帳",
      "查單",
      "查詢訂單",
      "查詢明細",
      "匯款帳號",
      "銀行",
      "帳號",
      "戶名",
      "已結帳",
      "未結帳",
      "我要結帳與查詢",
      "人工客服",
      "人工",
      "客服",
      "真人",
    ]) {
      await POST(request(event(keyword), channels[1].channelSecret));
      assert.equal(
        replies.length,
        replyCount,
        `${keyword} should not trigger a reply`,
      );
    }
    await POST(request(event("098765432"), channels[1].channelSecret));
    assert.match(replies.at(-1)!.text, /09 開頭/);
    assert.equal(queries.length, 2);
    await POST(request(event("0987654321"), channels[1].channelSecret));
    assert.match(replies.at(-1)!.text, /未結帳：1 筆/);
    const button = replies
      .at(-1)!
      .payload.messages[0].quickReply!.items.find(
        (item) => item.action.label === "已結帳",
      )!;
    function postback(userId: string, secret = channels[1].channelSecret) {
      return request(
        JSON.stringify({
          events: [
            {
              type: "postback",
              replyToken: "reply-token",
              source: { type: "user", userId },
              postback: { data: button.action.data },
            },
          ],
        }),
        secret,
      );
    }
    await POST(postback("user-a"));
    assert.match(replies.at(-1)!.text, /目前沒有已結帳訂單/);
    const before = queries.length;
    await POST(postback("user-b"));
    assert.match(replies.at(-1)!.text, /查詢已逾時或無法使用/);
    assert.equal(queries.length, before);
    await POST(postback("user-a", channels[0].channelSecret));
    assert.match(replies.at(-1)!.text, /查詢已逾時或無法使用/);
    assert.equal(queries.length, before);
    await POST(request(event("已匯款 12345"), channels[1].channelSecret));
    assert.match(replies.at(-1)!.text, /不代表已完成對帳/);
    assert.equal(queries.length, before);
    for (const channel of channels) {
      const confirmation =
        "您好，我已完成訂購，確認編號：HD-5CA5B36734，電話：0987654321，請協助核對，謝謝。";
      await POST(
        request(
          event(`${confirmation}\n我的末五碼：91154`),
          channel.channelSecret,
        ),
      );
      assert.match(replies.at(-1)!.text, /末五碼「91154」/);
      assert.doesNotMatch(replies.at(-1)!.text, /36734/);
      assert.equal(
        replies.at(-1)!.auth,
        `Bearer ${channel.channelAccessToken}`,
      );
      await POST(
        request(event(`${confirmation}\n請填寫末五碼`), channel.channelSecret),
      );
      assert.match(replies.at(-1)!.text, /請回傳匯款帳號的末五碼/);
      assert.doesNotMatch(replies.at(-1)!.text, /36734/);
    }
    assert.equal(queries.length, before);
  } finally {
    globalThis.fetch = originals.fetch;
    for (const [key, value] of Object.entries({
      LINE_CHANNELS: originals.env,
      NEXT_PUBLIC_SUPABASE_URL: originals.url,
      SUPABASE_SECRET_KEY: originals.key,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete (globalThis as Record<string, unknown>).lineDatabase;
  }
});
