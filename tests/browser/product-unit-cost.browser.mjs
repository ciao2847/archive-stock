import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import { chromium } from "playwright";
const owner = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000010";
const batchId = "00000000-0000-4000-8000-000000000020";
const built = await build({
  outfile: "/tmp/poster-direct-cost-browser.js",
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  alias: { "@": resolve("src") },
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "fixtures",
      setup(builder) {
        builder.onLoad({ filter: /\.module\.scss$/ }, (args) => ({
          contents: compile(args.path).css,
          loader: "local-css",
          resolveDir: resolve(args.path, ".."),
        }));
        builder.onResolve({ filter: /lib\/api\/products$/ }, () => ({
          path: "products",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `export const createProduct=async(input)=>{window.savedProduct=input;return{productId:'${productId}'}};export const updateProduct=async(id,input)=>{window.savedProduct={id,...input};return{updated:true}};export const uploadProductImages=async()=>({paths:['main.webp','thumb.webp']});export const removeProductImages=async()=>({});`,
        }));
      },
    },
  ],
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{NewProduct}from'./src/components/products/NewProduct';import{EditProduct}from'./src/components/products/EditProduct';const product={dbId:'${productId}',id:'A001',ownerId:'${owner}',ownerName:'NN佛系海報代購',name:'🇰🇷 海報',work:'作品',category:'海報',country:'韓國',source:'',location:'未指定',stock:10,price:300,status:'在庫',accent:'#aabbcc'};createRoot(document.getElementById('root')).render(location.pathname==='/new'?<NewProduct ownerId='${owner}' preorderOnly initialWorkName='作品' onClose={()=>{}}/>:<EditProduct product={product} onUpdated={()=>{}} onClose={()=>{}}/>);`,
  },
});
const css =
  compile("styles/app.global.scss", {
    silenceDeprecations: ["import", "global-builtin", "color-functions"],
  }).css +
  "\n" +
  built.outputFiles
    .filter((f) => f.path.endsWith(".css"))
    .map((f) => f.text)
    .join("\n");
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/app.js"
      ? "text/javascript"
      : req.url === "/app.css"
        ? "text/css"
        : "text/html",
  );
  res.end(
    req.url === "/app.js"
      ? built.outputFiles.find((f) => f.path.endsWith(".js")).text
      : req.url === "/app.css"
        ? css
        : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
  for (const width of [390, 1280])
    for (const scenario of ["new", "edit", "receive", "manual"]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/locations**", (r) =>
        r.fulfill({
          json: { success: true, data: { slots: [], cabinets: [] } },
        }),
      );
      await page.route("**/api/inventory-costs**", (r) =>
        r.fulfill({
          json: {
            success: true,
            data: {
              mode: scenario === "manual" ? "period_total" : "product_fifo",
              unitCost: null,
              batches:
                scenario === "new"
                  ? []
                  : [
                      {
                        id: batchId,
                        quantity: 10,
                        remaining: 10,
                        written_off: 0,
                        unit_cost: null,
                        received_at: "2026-11-12T00:00:00Z",
                        notes: "",
                        revision: 1,
                        locked: false,
                      },
                    ],
            },
          },
        }),
      );
      await page.goto(
        "http://127.0.0.1:" +
          server.address().port +
          (scenario === "new" ? "/new" : "/edit"),
      );
      await page.getByText("正在載入成本設定…").waitFor({ state: "hidden" });
      if (scenario === "manual")
        assert.equal(await page.getByLabel("每張成本（TWD）").count(), 0);
      else {
        await page.getByLabel("每張成本（TWD）").waitFor();
        if (scenario === "receive") {
          await page.getByLabel("庫存數量", { exact: true }).fill("15");
          await page.getByLabel("本次進貨每張成本（TWD）").fill("200");
        } else
          await page
            .getByLabel("每張成本（TWD）")
            .fill(scenario === "new" ? "0" : "180");
      }
      if (scenario === "new") {
        await page
          .getByRole("combobox", { name: "國家版本", exact: true })
          .selectOption("韓國");
        await page.getByRole("spinbutton", { name: /會員價/ }).fill("300");
      }
      await page.screenshot({
        path: "/tmp/poster-direct-cost-" + scenario + "-" + width + ".png",
        fullPage: true,
      });
      await page
        .getByRole("button", {
          name: scenario === "new" ? "建立預購商品" : "儲存修改",
          exact: true,
        })
        .click();
      await page.waitForFunction(() => Boolean(window.savedProduct));
      const saved = await page.evaluate(() => window.savedProduct);
      assert.equal(
        saved.unitCost,
        scenario === "manual"
          ? undefined
          : scenario === "new"
            ? 0
            : scenario === "receive"
              ? 200
              : 180,
      );
      if (scenario === "edit") {
        assert.equal(saved.costBatchId, batchId);
        assert.equal(saved.expectedCostRevision, 1);
      } else assert.equal("costBatchId" in saved, false);
      assert.equal(
        saved.stock,
        scenario === "new" ? 0 : scenario === "receive" ? 15 : 10,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
  console.log(
    "Direct poster costs pass create/edit/receipts/manual at 390 and 1280px",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
