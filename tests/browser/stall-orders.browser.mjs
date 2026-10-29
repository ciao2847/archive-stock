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
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {StallOrderHistory} from './src/components/checkout/StallOrderHistory';createRoot(document.getElementById('root')).render(<StallOrderHistory ownerId='${ownerId}' refreshKey={0} onChanged={()=>{window.changed=(window.changed??0)+1;}}/>);`,
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
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.confirm = () => window.acceptConfirmation ?? true;
    });
    const product1 = "00000000-0000-4000-8000-000000000031";
    const product2 = "00000000-0000-4000-8000-000000000032";
    let order = {
      id: "00000000-0000-4000-8000-000000000041",
      orderNo: "STALL-000041",
      createdAt: "2026-10-16T03:00:00Z",
      status: "packed",
      revision: 0,
      note: "",
      settled: false,
      total: 700,
      items: [
        {
          id: "item1",
          productId: product1,
          sku: "A000038",
          name: "測試海報",
          quantity: 2,
          unitPrice: 350,
          stock: 5,
        },
      ],
    };
    let rejectEdit = true,
      rejectCancel = true,
      cancelCalls = 0,
      lastSearch;
    await page.route("**/api/checkout**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.pathname === "/api/checkout/orders") {
        lastSearch = Object.fromEntries(url.searchParams);
        const orders =
          (lastSearch.status === "cancelled" && order.status !== "cancelled") ||
          (lastSearch.status === "completed" && order.status === "cancelled")
            ? []
            : [order];
        return route.fulfill({
          json: {
            success: true,
            data: { orders, total: orders.length, page: 1, pageSize: 20 },
          },
        });
      }
      if (url.pathname === "/api/checkout")
        return route.fulfill({
          json: {
            success: true,
            data: {
              productId: product2,
              sku: "A000039",
              name: "新加入海報",
              listPrice: 200,
              stock: 2,
            },
          },
        });
      const body = request.postDataJSON();
      assert.equal(body.ownerId, ownerId);
      if (request.method() === "PATCH") {
        if (rejectEdit) {
          rejectEdit = false;
          return route.fulfill({
            status: 409,
            json: { success: false, error: "測試：庫存已變動" },
          });
        }
        assert.equal(body.revision, 0);
        order = {
          ...order,
          revision: 1,
          note: body.note,
          items: body.items.map((item) => ({
            ...item,
            id: item.productId,
            sku: item.productId === product1 ? "A000038" : "A000039",
            name: "測試海報",
            stock: 5,
          })),
        };
        order.total = order.items.reduce(
          (sum, item) => sum + item.quantity * item.unitPrice,
          0,
        );
      } else {
        cancelCalls++;
        if (rejectCancel) {
          rejectCancel = false;
          return route.fulfill({
            status: 409,
            json: { success: false, error: "測試：請重新查找" },
          });
        }
        assert.equal(body.revision, 1);
        order = { ...order, revision: 2, status: "cancelled" };
      }
      return route.fulfill({
        json: { success: true, data: { orderId: order.id } },
      });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const row = page.getByRole("article", { name: "攤位訂單 STALL-000041" });
    await row.getByRole("button", { name: "編輯訂單" }).waitFor();
    const search = page.getByRole("searchbox", { name: "訂單或商品" });
    let searched = page.waitForResponse(
      (response) =>
        new URL(response.url()).searchParams.get("query") === "A000038",
    );
    await search.fill("A000038");
    await searched;
    searched = page.waitForResponse(
      (response) => new URL(response.url()).searchParams.get("query") === "",
    );
    await page.getByRole("button", { name: "清除搜尋", exact: true }).click();
    await searched;
    assert.equal(await search.inputValue(), "");
    assert.equal(
      await search.evaluate((input) => input === document.activeElement),
      true,
    );
    await search.fill("A000038");
    await search.press("Escape");
    assert.equal(await search.inputValue(), "");
    await search.press("Escape");
    await page.keyboard.press("Control+k");
    assert.equal(
      await search.evaluate((input) => input === document.activeElement),
      true,
    );
    await search.fill(" A000038 ");
    await page.getByLabel("開始日期").fill("2026-10-16");
    await page.getByLabel("結束日期").fill("2026-10-16");
    await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/checkout/orders" &&
          url.searchParams.get("query") === "A000038" &&
          url.searchParams.get("start") === "2026-10-16" &&
          url.searchParams.get("end") === "2026-10-16"
        );
      }),
      page.getByRole("button", { name: "查找訂單" }).click(),
    ]);
    assert.equal(lastSearch.start, "2026-10-16");
    assert.equal(lastSearch.end, "2026-10-16");
    await row.getByRole("button", { name: "編輯訂單" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("數量 A000038").fill("1");
    await dialog.getByLabel("單價 A000038").fill("300");
    await dialog.getByLabel("加入商品編號").fill("A000039");
    await dialog.getByRole("button", { name: "加入", exact: true }).click();
    await dialog.getByLabel("數量 A000039").waitFor();
    await dialog.getByRole("button", { name: "移除 A000039" }).click();
    await dialog.getByLabel("加入商品編號").fill("A000039");
    await dialog.getByLabel("加入商品編號").press("Enter");
    await dialog.getByLabel("數量 A000039").waitFor();
    await dialog.getByLabel("訂單備註").fill("修正商品與金額");
    await dialog.getByRole("button", { name: "儲存修改" }).click();
    await dialog.getByRole("alert").filter({ hasText: "庫存已變動" }).waitFor();
    assert.equal(await dialog.getByLabel("單價 A000038").inputValue(), "300");
    await page.screenshot({
      path: `/tmp/poster-stall-order-editor-${width}.png`,
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "儲存修改" }).click();
    await page.getByRole("status").filter({ hasText: "訂單已更新" }).waitFor();
    await row.getByText("訂單金額 NT$ 500", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.changed), 1);
    await page.evaluate(() => {
      window.acceptConfirmation = false;
    });
    await row.getByRole("button", { name: "撤銷並復原" }).click();
    assert.equal(cancelCalls, 0);
    await page.evaluate(() => {
      window.acceptConfirmation = true;
    });
    await row.getByRole("button", { name: "撤銷並復原" }).click();
    await page.getByRole("alert").filter({ hasText: "請重新查找" }).waitFor();
    await row.getByRole("button", { name: "撤銷並復原" }).click();
    await row.getByText("已撤銷", { exact: true }).waitFor();
    assert.equal(
      await row.getByRole("button", { name: "編輯訂單" }).count(),
      0,
    );
    assert.equal(await page.evaluate(() => window.changed), 2);
    await page.getByLabel("訂單狀態").selectOption("completed");
    await page.getByRole("button", { name: "查找訂單" }).click();
    await page.getByText("找不到符合條件的攤位訂單", { exact: true }).waitFor();
    await page.getByLabel("訂單狀態").selectOption("cancelled");
    await page.getByRole("button", { name: "查找訂單" }).click();
    await row.getByText("已撤銷", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `/tmp/poster-stall-order-history-${width}.png`,
      fullPage: true,
    });
    console.log(
      `PASS stall order management ${width}px: scoped filters, edit/add/remove, price/quantity/note, failure retention, revision, cancel confirmation/retry and retained history`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
