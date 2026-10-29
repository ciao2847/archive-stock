// Run after npm run build: node tests/browser/stall-checkout.browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import { chromium } from "playwright";
const ownerId = "00000000-0000-4000-8000-000000000001";
const bundle = await build({
  outfile: "/tmp/poster-stall-browser.js",
  plugins: [
    {
      name: "styles",
      setup(builder) {
        builder.onLoad({ filter: /\.module\.scss$/ }, (args) => ({
          contents: compile(args.path).css,
          loader: "local-css",
          resolveDir: resolve(args.path, ".."),
        }));
      },
    },
  ],
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  alias: { "@": resolve("src") },
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {StallCheckout} from './src/components/checkout/StallCheckout';createRoot(document.getElementById('root')).render(<StallCheckout ownerId='${ownerId}' onCompleted={()=>{window.completed=true;}} onBack={()=>{}}/>);`,
  },
});
const css =
  (
    await Promise.all(
      (await readdir(".next/static/chunks"))
        .filter((name) => name.endsWith(".css"))
        .map((name) => readFile(`.next/static/chunks/${name}`, "utf8")),
    )
  ).join("\n") +
  "\n" +
  bundle.outputFiles
    .filter((file) => file.path.endsWith(".css"))
    .map((file) => file.text)
    .join("\n");
const server = createServer((request, response) => {
  if (request.url === "/app.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(
      bundle.outputFiles.find((file) => file.path.endsWith(".js")).text,
    );
  } else if (request.url === "/app.css") {
    response.setHeader("Content-Type", "text/css");
    response.end(css);
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>#root{padding:24px}@media(max-width:991.98px){#root{padding:16px}}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    );
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({
  executablePath: existsSync(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  )
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const token1 = "00000000-0000-4000-8000-000000000011";
const token2 = "00000000-0000-4000-8000-000000000012";
let scans = 0;
let checkoutPayload;
let rejectCheckout = true;
await page.route("**/api/checkout**", async (route) => {
  const request = route.request();
  if (new URL(request.url()).pathname === "/api/checkout/summary") {
    await route.fulfill({
      json: {
        success: true,
        data: {
          date: "2026-10-14",
          revenue: checkoutPayload && !rejectCheckout ? 700 : 0,
          orderCount: checkoutPayload && !rejectCheckout ? 1 : 0,
          itemCount: checkoutPayload && !rejectCheckout ? 2 : 0,
        },
      },
    });
    return;
  }
  if (new URL(request.url()).pathname === "/api/checkout/orders") {
    await route.fulfill({
      json: {
        success: true,
        data: { orders: [], total: 0, page: 1, pageSize: 20 },
      },
    });
    return;
  }
  if (request.method() === "GET") {
    scans++;
    const params = new URL(request.url()).searchParams;
    const value = params.get("value");
    const excluded = params.getAll("excludeToken");
    const token = /^A\d{6}$/i.test(value)
      ? [token1, token2].find((token) => !excluded.includes(token))
      : value.includes(token1)
        ? token1
        : token2;
    if (!token) {
      await route.fulfill({
        status: 409,
        json: {
          success: false,
          error: "此商品沒有其他可加入的商品碼，請核對購物車件數與庫存。",
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        success: true,
        data: {
          token,
          productId: "poster",
          sku: "A000001",
          name: "測試海報",
          listPrice: 350,
          stock: 2,
        },
      },
    });
  } else {
    checkoutPayload = request.postDataJSON();
    await route.fulfill(
      rejectCheckout
        ? {
            status: 409,
            json: { success: false, error: "商品庫存已變動，請重新掃描商品。" },
          }
        : {
            json: {
              success: true,
              data: { orderId: "sale", orderNo: "ORDER-000001", total: 700 },
            },
          },
    );
  }
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("heading", { name: "攤位結帳", exact: true }).waitFor();
  await page.setViewportSize({ width: 1280, height: 900 });
  const scanPanel = page.getByRole("region", { name: "商品掃碼區" });
  const cartPanel = page.getByRole("region", { name: "購物車與結帳" });
  const desktopScan = await scanPanel.boundingBox();
  const desktopCart = await cartPanel.boundingBox();
  assert.ok(desktopCart.x > desktopScan.x + desktopScan.width);
  assert.ok(Math.abs(desktopCart.y - desktopScan.y) < 2);
  await page.screenshot({
    path: "/tmp/poster-stall-checkout-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("heading", { name: "攤位結帳", exact: true }).waitFor();
  const mobileScan = await scanPanel.boundingBox();
  const mobileCart = await cartPanel.boundingBox();
  assert.ok(mobileCart.y >= mobileScan.y + mobileScan.height);
  await page.screenshot({
    path: "/tmp/poster-stall-checkout-mobile-layout.png",
    fullPage: true,
  });
  const input = page.getByRole("textbox", { name: "手動輸入商品編號" });
  const add = page.getByRole("button", { name: "加入商品", exact: true });
  const checkout = page.getByRole("button", { name: /確認已收款並結帳/ });
  assert.equal(await checkout.isDisabled(), true);
  await input.fill("a000001");
  await input.press("Enter");
  await page.getByText("定價 NT$ 350", { exact: true }).waitFor();
  await input.fill(`AS1:${token1}`);
  await add.click();
  await page.getByRole("alert").filter({ hasText: "已在購物車" }).waitFor();
  assert.equal(scans, 1);
  await input.fill("A000001");
  await add.click();
  await page.getByText("共 2 件 · 應收總額", { exact: true }).waitFor();
  await input.fill("A000001");
  await add.click();
  await page.getByRole("alert").filter({ hasText: "沒有其他可加入" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "移除 A000001" }).count(),
    2,
  );
  const cash = page.getByLabel("現金實收（選填，用於計算找零）");
  await cash.fill("600");
  await page.getByText("實收金額不足", { exact: true }).waitFor();
  assert.equal(await checkout.isDisabled(), true);
  await cash.fill("1000");
  await page.getByText("找零 NT$ 300", { exact: true }).waitFor();
  await checkout.click();
  await page.getByRole("alert").filter({ hasText: "商品庫存已變動" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "移除 A000001" }).count(),
    2,
  );
  rejectCheckout = false;
  await checkout.click();
  await page.getByText("結帳完成 · ORDER-000001", { exact: true }).waitFor();
  assert.deepEqual(checkoutPayload, {
    ownerId,
    tokens: [token1, token2],
    expectedTotal: 700,
  });
  assert.equal(await page.evaluate(() => window.completed), true);
  assert.equal(
    await page.getByRole("region", { name: "今日攤位營收" }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "移除 A000001" }).count(),
    0,
  );
  await input.fill(`https://example.com/qr/${token1}`);
  await add.click();
  await page.getByText("共 1 件 · 應收總額", { exact: true }).waitFor();
  await input.fill(`AS1:${token2}`);
  await add.click();
  await page.getByText("共 2 件 · 應收總額", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "/tmp/poster-stall-checkout-mobile.png",
    fullPage: true,
  });
  console.log(
    "Checkout browser passed: manual SKU via Enter/button, repeated SKU with distinct units, exhausted stock, QR URL/legacy scan, duplicate prevention, cash change, failure preservation and paid receipt on mobile.",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
