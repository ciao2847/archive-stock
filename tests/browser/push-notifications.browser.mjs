import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
const inventories = [
  { id: "00000000-0000-4000-8000-000000000001", name: "海報小天地" },
  { id: "00000000-0000-4000-8000-000000000002", name: "NN佛系海報代購" },
];
const bundle = await build({
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  alias: { "@": resolve("src") },
  define: { "process.env.NODE_ENV": '"development"' },
  stdin: {
    loader: "tsx",
    resolveDir: process.cwd(),
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{PushNotificationSettings}from'./src/components/notifications/PushNotificationSettings';const inventories=${JSON.stringify(inventories)};createRoot(document.getElementById('root')).render(<PushNotificationSettings inventories={inventories} isAdmin/>);`,
  },
});
const css = (
  await Promise.all(
    (await readdir(".next/static/chunks"))
      .filter((x) => x.endsWith(".css"))
      .map((x) => readFile(".next/static/chunks/" + x, "utf8")),
  )
).join("\n");
let devices = [],
  tests = 0;
const server = createServer(async (req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(bundle.outputFiles[0].text);
  }
  if (req.url === "/style.css") {
    res.setHeader("Content-Type", "text/css");
    return res.end(css);
  }
  if (req.url.startsWith("/api/push/")) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url.endsWith("/test")) tests++;
    else if (req.method === "POST")
      devices = [
        {
          id: "device",
          endpoint: body.endpoint,
          inventory_ids: body.inventoryIds,
        },
      ];
    else if (req.method === "DELETE") devices = [];
    res.setHeader("Content-Type", "application/json");
    return res.end(
      JSON.stringify({
        success: true,
        data: {
          configured: true,
          publicKey:
            "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          subscriptions: devices,
          sent: true,
        },
      }),
    );
  }
  res.end(
    '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.permissionRequests = 0;
    window.Notification = class {
      static permission = "default";
      static async requestPermission() {
        window.permissionRequests++;
        this.permission = "granted";
        return "granted";
      }
    };
    window.PushManager = class {};
    let sub = null;
    const manager = {
      getSubscription: async () => sub,
      subscribe: async () => {
        sub = {
          endpoint: "https://web.push.apple.com/device",
          toJSON: () => ({ keys: { p256dh: "key", auth: "auth" } }),
          unsubscribe: async () => {
            sub = null;
            return true;
          },
        };
        return sub;
      },
    };
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        register: async () => ({ pushManager: manager }),
        ready: Promise.resolve({ pushManager: manager }),
      },
    });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  await page
    .getByRole("button", { name: "開啟手機通知", exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => window.permissionRequests), 0);
  await page.getByLabel("NN佛系海報代購").uncheck();
  await page.getByRole("button", { name: "開啟手機通知", exact: true }).click();
  await page.getByText("這台裝置已開啟通知", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.permissionRequests), 1);
  assert.deepEqual(devices[0].inventory_ids, [inventories[0].id]);
  await page.getByRole("button", { name: "傳送測試通知" }).click();
  await page.getByText("測試通知已送出，請查看手機通知中心。").waitFor();
  assert.equal(tests, 1);
  await page.screenshot({
    path: "/tmp/poster-push-settings-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "關閉這台裝置通知" }).click();
  await page.getByText("這台裝置尚未開啟通知", { exact: true }).waitFor();
  assert.equal(devices.length, 0);
  const ios = await browser.newPage({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  });
  await ios.goto(url);
  await ios.getByText(/iPhone／iPad 請先在 Safari/).waitFor();
  assert.equal(
    await ios
      .getByRole("button", { name: "開啟手機通知", exact: true })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: explicit permission gesture, device registration, inventory selection, test, disable and iPhone install guidance",
  );
} finally {
  await browser.close();
  server.close();
}
