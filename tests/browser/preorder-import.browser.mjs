// node tests/browser/preorder-import.browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import { chromium } from "playwright";
const owner = "00000000-0000-4000-8000-000000000001";
const bundle = await build({
  outfile: "/tmp/poster-preorder-import-browser.js",
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  alias: { "@": resolve("src") },
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  plugins: [
    {
      name: "scss",
      setup(builder) {
        builder.onLoad({ filter: /\.module\.scss$/ }, (args) => ({
          contents: compile(args.path).css,
          loader: "local-css",
          resolveDir: resolve(args.path, ".."),
        }));
      },
    },
  ],
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ClaimProductSettings}from'./src/components/claims/ClaimProductSettings';
function App(){const[products,setProducts]=useState([]);const[selected,setSelected]=useState(new Set());const[drafts,setDrafts]=useState({});const[title,setTitle]=useState('蜘蛛人預購');return <><output aria-label="selected">{selected.size}</output><ClaimProductSettings ownerId='${owner}' inventoryName='海報小天地' products={products} form={null} title={title} setTitle={setTitle} description='' setDescription={()=>{}} isOpen={true} setIsOpen={()=>{}} closesAt='' setClosesAt={()=>{}} selectedIds={selected} setSelectedIds={setSelected} productDrafts={drafts} setProductDrafts={setDrafts} saving={false} error='' savedMessage='' publicPath='' onSave={async()=>{window.formSaved=true}} onReloadProducts={async()=>{window.reloadCount=(window.reloadCount||0)+1;setProducts((window.createdItems||[]).map((p,i)=>({...p,dbId:window.createdIds[i],id:'A'+i,name:p.work+' '+p.itemName,preorderItemName:p.itemName,stock:0,category:'海報',ownerId:'${owner}'})));}}/></>};createRoot(document.getElementById('root')).render(<App/>);`,
  },
});
const css =
  (
    await Promise.all(
      (await readdir(".next/static/chunks"))
        .filter((n) => n.endsWith(".css"))
        .map((n) => readFile(".next/static/chunks/" + n, "utf8")),
    )
  ).join("\n") +
  bundle.outputFiles
    .filter((f) => f.path.endsWith(".css"))
    .map((f) => f.text)
    .join("\n");
const server = createServer((req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    return res.end(bundle.outputFiles.find((f) => f.path.endsWith(".js")).text);
  }
  if (req.url === "/app.css") {
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    return res.end(css);
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root" style="padding:16px"></div><script src="/app.js"></script></body></html>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  for (const width of [390, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(8000);
    await page.addInitScript(() => {
      window.confirm = () => true;
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const calls = [];
    let fail = true;
    await page.route("**/api/products/preorder-batch", async (route) => {
      const input = route.request().postDataJSON();
      calls.push(input);
      await page.evaluate((input) => {
        window.createdItems = input.items;
        window.createdIds = input.items.map(
          (_, i) =>
            "00000000-0000-4000-8000-" + String(i + 100).padStart(12, "0"),
        );
      }, input);
      if (fail) {
        await route.abort("failed");
        return;
      }
      await route.fulfill({
        json: {
          success: true,
          data: {
            batchId: input.requestId,
            productIds: input.items.map(
              (_, i) =>
                "00000000-0000-4000-8000-" + String(i + 100).padStart(12, "0"),
            ),
          },
        },
      });
    });
    await page.goto(url);
    await page
      .getByRole("button", { name: "文字批量上架", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "文字批量上架" });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "帶入範例" }).click();
    await dialog.getByRole("button", { name: "辨識商品", exact: true }).click();
    await dialog
      .getByRole("region", { name: "預購商品第 5 項", exact: true })
      .waitFor();
    assert.equal(
      await dialog.getByRole("region", { name: /預購商品第/ }).count(),
      5,
    );
    assert.equal(calls.length, 0);
    const row = dialog.getByRole("region", {
      name: "預購商品第 1 項",
      exact: true,
    });
    await row.getByLabel("品項名稱", { exact: true }).fill("IMAX A款");
    await row.getByLabel("售價 NT$", { exact: true }).fill("375");
    assert.match(await row.textContent(), /🇰🇷 蜘蛛人 IMAX A款/);
    await dialog.getByRole("button", { name: "移除第 5 項商品" }).click();
    assert.equal(
      await dialog.getByRole("region", { name: /預購商品第/ }).count(),
      4,
    );
    await page.screenshot({
      path: `/tmp/poster-preorder-import-${width}.png`,
      fullPage: true,
    });
    assert.equal(await dialog.getByRole("button", { name: /返回/ }).count(), 0);
    assert.ok(
      await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 2),
      "dialog horizontal overflow",
    );
    await dialog.getByRole("button", { name: "建立並加入 4 項" }).click();
    await dialog.getByRole("button", { name: "重試確認這一批" }).waitFor();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].items[0].price, 375);
    assert.equal(calls[0].items[0].itemName, "IMAX A款");
    assert.equal(
      await row.getByLabel("品項名稱", { exact: true }).isDisabled(),
      true,
    );
    // A lost response can be recovered even after reloading/reopening the form.
    await page.reload();
    await page
      .getByRole("button", { name: "文字批量上架", exact: true })
      .click();
    await dialog.getByRole("button", { name: "重試確認這一批" }).waitFor();
    fail = false;
    await dialog.getByRole("button", { name: "重試確認這一批" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], calls[0]);
    assert.equal(await page.getByLabel("selected").textContent(), "4");
    assert.equal(await page.evaluate(() => Boolean(window.formSaved)), false);
    assert.match(
      await page.getByRole("status").last().textContent(),
      /請儲存商品設定|發佈訂購頁/,
    );
    assert.equal(
      await page.evaluate(() =>
        Object.keys(sessionStorage).some((k) =>
          k.startsWith("archive-preorder-batch:"),
        ),
      ),
      false,
    );
    await page
      .getByRole("button", { name: "文字批量上架", exact: true })
      .click();
    await dialog
      .getByLabel("貼上商品文字", { exact: true })
      .fill("韓版A/B/C 350");
    await dialog.getByRole("button", { name: "辨識商品", exact: true }).click();
    assert.equal(
      await dialog
        .getByRole("button", { name: "建立並加入 3 項" })
        .isDisabled(),
      true,
    );
    for (const row of await dialog
      .getByRole("region", { name: /預購商品第/ })
      .all())
      await row.getByLabel("售價 NT$", { exact: true }).fill("350");
    assert.equal(
      await dialog.getByRole("button", { name: "建立並加入 3 項" }).isEnabled(),
      true,
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log("Preorder import flow passed at " + width + "px");
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
