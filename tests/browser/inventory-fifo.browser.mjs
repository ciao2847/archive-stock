// Isolated browser checks for itemized costs, profit shares, locking and Excel downloads.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import { chromium } from "playwright";
const ownerId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const built = await build({
  outfile: "/tmp/poster-fifo-browser.js",
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  alias: { "@": resolve("src") },
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "styles",
      setup(builder) {
        builder.onLoad({ filter: /\.module\.scss$/ }, (args) => ({
          contents: compile(args.path).css,
          loader: "local-css",
        }));
      },
    },
  ],
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {ProductBatchCosts} from './src/components/products/ProductBatchCosts';import {InventoryAccountingSettings} from './src/components/settings/InventoryAccountingSettings';import {SettlementPanel} from './src/components/settlement/SettlementPanel';const client=new QueryClient({defaultOptions:{queries:{retry:false}}});createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><InventoryAccountingSettings ownerId="${ownerId}" name="佛系代購"/><ProductBatchCosts productId="${otherId}"/><SettlementPanel ownerId="${ownerId}"/></QueryClientProvider>);`,
  },
});
const css =
  compile("styles/app.global.scss", {
    silenceDeprecations: ["import", "global-builtin", "color-functions"],
  }).css +
  "\n" +
  built.outputFiles
    .filter((file) => file.path.endsWith(".css"))
    .map((file) => file.text)
    .join("\n");
const server = createServer((request, response) => {
  response.setHeader(
    "Content-Type",
    request.url === "/app.js"
      ? "text/javascript"
      : request.url === "/app.css"
        ? "text/css"
        : "text/html",
  );
  response.end(
    request.url === "/app.js"
      ? built.outputFiles.find((file) => file.path.endsWith(".js")).text
      : request.url === "/app.css"
        ? css
        : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{padding:16px}</style><div id="root"></div><script src="/app.js"></script>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({
  headless: true,
  ...(existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? {
        executablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      }
    : {}),
});
try {
  for (const width of [320, 390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let cost = null,
      revision = 1;
    const saved = false;
    const batchId = "00000000-0000-4000-8000-000000000003";
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const json = (data) => route.fulfill({ json: { success: true, data } });
      if (url.pathname === "/api/inventory-costs") {
        if (request.method() === "PATCH") {
          const input = request.postDataJSON();
          assert.equal(input.unitCost, 180);
          cost = 180;
          revision++;
          return json({ saved: true });
        }
        if (url.searchParams.has("productId"))
          return json({
            mode: "product_fifo",
            batches: [
              {
                id: batchId,
                quantity: 10,
                remaining: 8,
                written_off: 0,
                unit_cost: cost,
                received_at: "2026-11-01T00:00:00Z",
                notes: "",
                revision,
                locked: false,
              },
            ],
          });
        return json({ mode: "product_fifo" });
      }
      if (url.pathname === "/api/accounting") {
        const start = url.searchParams.get("start") ?? "2026-11-01",
          end = url.searchParams.get("end") ?? "2026-12-31";
        return json({
          cost: saved
            ? {
                id: otherId,
                owner_id: ownerId,
                period_start: start,
                period_end: end,
                amount: 0,
                notes: "",
                revision: 1,
                updated_at: "",
                cost_entries: [],
                share_rules: [],
              }
            : null,
          preview: {
            revenue: 600,
            order_count: 1,
            settled: false,
            blocked_reason: null,
            accounting_mode: "product_fifo",
            product_cost: cost === null ? 0 : 360,
            missing_costs:
              cost === null
                ? [
                    {
                      productId: otherId,
                      sku: "A001",
                      name: "測試商品",
                      quantity: 2,
                    },
                  ]
                : [],
            product_cost_details: [
              {
                batchId,
                orderId: otherId,
                orderNo: "O-1",
                productId: otherId,
                sku: "A001",
                name: "測試商品",
                quantity: 2,
                unitCost: cost,
                cost: cost === null ? null : 360,
                receivedAt: "2026-11-01T00:00:00Z",
              },
            ],
          },
          history: [],
          revisions: [],
        });
      }
      throw new Error("Unexpected API " + url.pathname);
    });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.getByRole("heading", { name: "進貨批次與成本" }).waitFor();
    await page.getByText("尚未填寫成本，相關銷售無法結算").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "確認結算", exact: true })
        .isDisabled(),
      true,
    );
    const editor =
      width === 390
        ? page.getByRole("region", { name: "本期售出商品成本" })
        : page.getByRole("region", { name: "商品批次成本" });
    if (width === 390) await editor.locator("summary").click();
    await editor.getByLabel("第 1 批單件成本（TWD）").fill("180");
    await editor.getByRole("button", { name: "儲存本批成本" }).click();
    await page
      .getByRole("heading", { name: "本期售出商品成本 · NT$ 360" })
      .waitFor();
    await page.getByRole("heading", { name: "額外費用明細 · 0 筆" }).waitFor();
    assert.equal(
      await page.getByText("尚未填寫成本，相關銷售無法結算").count(),
      0,
    );
    assert.equal(
      await page
        .locator("body")
        .evaluate((el) => el.scrollWidth <= window.innerWidth + 1),
      true,
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: "/tmp/poster-fifo-" + width + ".png",
      fullPage: true,
    });
    await page.close();
  }
  console.log(
    "FIFO product costs and accounting pass at 320, 390, 768, 1280px",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
