// Run after npm run build: node tests/browser/product-merge.browser.mjs
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
  outfile: "/tmp/poster-merge-browser.js",
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
    contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {ClaimProductSettings} from './src/components/claims/ClaimProductSettings';
const ownerId='00000000-0000-4000-8000-000000000001';
const base={ownerId,ownerName:'Owner',work:'Movie',category:'海報',country:'日本',source:'Official',location:'未指定',price:250,status:'在庫',accent:'#abc'};
const source={...base,id:'A000010',dbId:'00000000-0000-4000-8000-000000000010',name:'預售商品',stock:0,preorderItemName:'A'};
const target={...base,id:'A000011',dbId:'00000000-0000-4000-8000-000000000011',name:'已入庫商品',stock:5,hasInventoryHistory:true,location:'A-01-01'};
const sold={...base,id:'A000012',dbId:'00000000-0000-4000-8000-000000000012',name:'已售完的入庫商品',stock:0,hasInventoryHistory:true};
const other={...base,id:'A000013',dbId:'00000000-0000-4000-8000-000000000013',name:'其他預售',stock:0};
const foreign={...target,ownerId:'00000000-0000-4000-8000-000000000002',id:'FOREIGN',dbId:'00000000-0000-4000-8000-000000000014',name:'別人庫藏'};
function App(){const [merged,setMerged]=useState(false);const [ids,setIds]=useState(new Set([source.dbId]));const [drafts,setDrafts]=useState({[source.dbId]:{name:source.name,price:'250',maxQuantity:'20',isEnabled:true}});
const [title,setTitle]=useState('活動');const [desc,setDesc]=useState('');const [open,setOpen]=useState(true);const [closes,setCloses]=useState('');
return <ClaimProductSettings ownerId={ownerId} inventoryName='Test' products={merged?[target,sold,other,foreign]:[source,target,sold,other,foreign]} form={{id:1,title:'活動',products:[{productId:merged?target.dbId:source.dbId,name:source.name,price:250,maxQuantity:20,isEnabled:true}]}} title={title} setTitle={setTitle} description={desc} setDescription={setDesc} isOpen={open} setIsOpen={setOpen} closesAt={closes} setClosesAt={setCloses} selectedIds={ids} setSelectedIds={setIds} productDrafts={drafts} setProductDrafts={setDrafts} saving={false} error='' savedMessage='' onSave={async()=>{}} publicPath='' onReloadProducts={async()=>{}} onProductsMerged={async()=>{if(window.refreshFails)throw new Error('refresh');setMerged(true)}}/>;};createRoot(document.getElementById('root')).render(<App/>);`,
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
const token = "a".repeat(32);
let mode = "ok";
let commits = 0;
let previews = 0;
await page.route("**/api/products/merge", async (route) => {
  const input = route.request().postDataJSON();
  assert.equal(input.ownerId, ownerId);
  assert.equal(input.sourceId, "00000000-0000-4000-8000-000000000010");
  assert.equal(input.targetId, "00000000-0000-4000-8000-000000000011");
  if (input.token) {
    commits++;
    assert.equal(input.token, token);
    if (mode === "network") {
      await route.abort("failed");
      return;
    }
    if (mode === "stale") {
      await route.fulfill({
        status: 409,
        json: { success: false, error: "資料已更新，請重新預覽合併內容再確認" },
      });
      return;
    }
  } else previews++;
  await route.fulfill({
    json: {
      success: true,
      data: {
        source: {
          id: input.sourceId,
          sku: "A000010",
          name: "預售商品",
          stock: 0,
        },
        target: {
          id: input.targetId,
          sku: "A000011",
          name: "已入庫商品",
          stock: 5,
        },
        forms: [
          {
            id: 1,
            title: "活動",
            targetAlreadyListed: false,
            listing: {
              name: "預售商品",
              price: 250,
              maxQuantity: 20,
              isEnabled: true,
            },
          },
          {
            id: 2,
            title: "另一活動",
            targetAlreadyListed: true,
            listing: {
              name: "Keep",
              price: 400,
              maxQuantity: 2,
              isEnabled: false,
            },
          },
        ],
        submissionCount: 2,
        fulfillmentCount: 2,
        token,
        merged: Boolean(input.token),
        conflicts:
          mode === "conflict" ? [{ kind: "claim", code: "PRE-CONFLICT" }] : [],
      },
    },
  });
});
const url = `http://127.0.0.1:${server.address().port}`;
async function openDialog() {
  await page
    .getByRole("button", { name: "將 預售商品 合併至庫存商品", exact: true })
    .click();
  await page.getByRole("dialog", { name: "合併至庫存商品" }).waitFor();
}
async function choose() {
  await page.getByRole("radio", { name: /A000011/ }).check();
  await page.getByRole("button", { name: "預覽合併", exact: true }).click();
  await page.getByRole("heading", { name: "確認合併內容" }).waitFor();
}
try {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(url);
    mode = "ok";
    // Unsaved listing edits must not be overwritten by a global merge.
    const name = page.getByRole("textbox", {
      name: "預售商品公開商品名稱",
      exact: true,
    });
    await name.fill("Changed");
    assert.equal(
      await page
        .getByRole("button", {
          name: "將 預售商品 合併至庫存商品",
          exact: true,
        })
        .isDisabled(),
      true,
    );
    await name.fill("預售商品");
    await openDialog();
    assert.equal(await page.getByRole("radio").count(), 2);
    assert.equal(
      await page
        .getByRole("button", { name: "預覽合併", exact: true })
        .isDisabled(),
      true,
    );
    const search = page.getByRole("searchbox", { name: "搜尋已入庫商品" });
    await search.fill("不存在");
    await page.getByText("沒有符合的已入庫商品，請調整搜尋條件。").waitFor();
    await search.fill("");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    await openDialog();
    await choose();
    await page.getByText(/已包含庫存商品，保留該商品原有/).waitFor();
    assert.equal(commits, width === 390 ? 0 : 1);
    const modal = page.getByRole("dialog");
    assert.equal(
      await modal.evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    );
    await page.screenshot({
      path: `/tmp/poster-product-merge-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "確認合併", exact: true }).click();
    await page
      .getByText("已將 A000010 合併至 A000011，庫存數量不變。")
      .waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0);
  }
  mode = "conflict";
  await page.goto(url);
  await openDialog();
  await choose();
  await page.getByText("PRE-CONFLICT", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "確認合併", exact: true })
      .isDisabled(),
    true,
  );
  mode = "stale";
  await page.goto(url);
  await openDialog();
  await choose();
  await page.getByRole("button", { name: "確認合併", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "資料已更新" }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "預覽合併", exact: true })
      .isVisible(),
    true,
  );
  mode = "network";
  await page.goto(url);
  await openDialog();
  await choose();
  await page.getByRole("button", { name: "確認合併", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "未能確認合併結果" })
    .waitFor();
  mode = "ok";
  await page.goto(url);
  await page.evaluate(() => (window.refreshFails = true));
  await openDialog();
  await choose();
  const before = commits;
  await page.getByRole("button", { name: "確認合併", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "合併已完成，但重新載入失敗" })
    .waitFor();
  assert.equal(commits, before + 1);
  assert.equal(
    await page.getByRole("button", { name: "確認合併", exact: true }).count(),
    0,
  );
  await page.evaluate(() => (window.refreshFails = false));
  await page.getByRole("button", { name: "重新載入", exact: true }).click();
  await page.getByText("已將 A000010 合併至 A000011，庫存數量不變。").waitFor();
  assert.equal(commits, before + 1);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    `Product merge passed on mobile/desktop: saved-setting guard, search, received-only candidates, cancellation, preview, confirmation, conflicts, stale data, and refresh recovery (${previews} previews, ${commits} commits).`,
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
