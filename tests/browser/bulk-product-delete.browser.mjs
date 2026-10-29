// Bulk deletion safety: review, explicit confirmation, scope, concurrency and limits.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import { chromium } from "playwright";
const bundle = await build({
  outfile: "/tmp/poster-bulk-delete-browser.js",
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  alias: { "@": resolve("src") },
  define: { "process.env.NODE_ENV": '"development"' },
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
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ProductInventoryTable}from'./src/components/products/ProductInventoryTable';
const make=(i,owner='a')=>({dbId:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),id:'A'+String(i+1).padStart(6,'0'),name:'商品 '+(i+1),work:'作品',ownerId:owner,ownerName:owner==='a'?'目前庫藏':'其他庫藏',stock:2,category:'海報',country:'韓國',source:'',location:'未指定',price:250,status:'在庫',accent:'#5a87b1'});
function App(){const[items,setItems]=useState(()=>[...Array.from({length:location.search.includes('many')?55:2},(_,i)=>make(i)),make(99,'b')]);const[scope,setScope]=useState('a');const[query,setQuery]=useState('');const[print,setPrint]=useState(false);const[prints,setPrints]=useState(new Set());const[notice,setNotice]=useState('');const selectionScope=JSON.stringify([scope,query,print]);const[selection,setSelection]=useState({scope:selectionScope,active:false});if(selection.scope!==selectionScope)setSelection({scope:selectionScope,active:false});const selecting=selection.scope===selectionScope&&selection.active;const visible=items.filter(p=>p.ownerId===scope&&p.name.includes(query));return <><label>搜尋商品<input value={query} onChange={e=>setQuery(e.target.value)}/></label><label>庫藏<select aria-label='庫藏' value={scope} onChange={e=>setScope(e.target.value)}><option value='a'>目前庫藏</option><option value='b'>其他庫藏</option></select></label><button onClick={()=>setPrint(x=>!x)}>{print?'取消批量列印':'批量列印'}</button>{!print&&<div style={{display:'flex',gap:8}}><button>新增商品</button><button onClick={()=>setSelection({scope:selectionScope,active:!selecting})}>{selecting?'取消批量刪除':'批量刪除'}</button></div>}<p role='status'>{notice}</p><ProductInventoryTable key={selectionScope+':'+selecting} selecting={selecting} onSelectingChange={active=>setSelection({scope:selectionScope,active})} items={visible} onSelect={()=>{window.opened=(window.opened||0)+1}} printSelectionMode={print} printSelectedIds={prints} onPrintToggle={id=>setPrints(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next})} onDeleted={result=>{window.result=result;setNotice('已刪除 '+result.deletedProductIds.length+' 項商品')}} onChanged={async()=>{window.reloads=(window.reloads||0)+1;setItems(current=>current.filter(p=>!(window.deletedIds||[]).includes(p.dbId)));}}/></>};createRoot(document.getElementById('root')).render(<App/>);`,
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
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const requests = [];
    let release;
    let arrivedResolve;
    const arrived = new Promise((done) => {
      arrivedResolve = done;
    });
    await page.route("**/api/products/batch-delete", async (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      if (requests.length === 1) {
        await new Promise((done) => {
          release = done;
          arrivedResolve();
        });
        return route.fulfill({
          status: 400,
          json: { success: false, error: "批量刪除未完成，這一批尚未刪除。" },
        });
      }
      await page.evaluate((ids) => {
        window.deletedIds = ids;
      }, input.productIds);
      return route.fulfill({
        json: { success: true, data: { deletedProductIds: input.productIds } },
      });
    });
    await page.goto(url);
    const addBox = await page
      .getByRole("button", { name: "新增商品", exact: true })
      .boundingBox();
    const deleteBox = await page
      .getByRole("button", { name: "批量刪除", exact: true })
      .boundingBox();
    assert.ok(
      deleteBox.x >= addBox.x + addBox.width &&
        Math.abs(deleteBox.y - addBox.y) < 2,
    );
    await page.getByRole("button", { name: "批量刪除", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "選擇 A000001 批量刪除", exact: true })
      .check();
    await page
      .getByRole("button", { name: "取消批量刪除", exact: true })
      .click();
    assert.equal(await page.getByRole("checkbox").count(), 0);
    await page.getByRole("button", { name: "批量刪除", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "刪除所選 0 項", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("checkbox", { name: "選擇 A000001 批量刪除", exact: true })
      .check();
    await page.getByLabel("搜尋商品", { exact: true }).fill("商品 2");
    await page.getByRole("button", { name: "批量刪除", exact: true }).waitFor();
    assert.equal(await page.getByRole("checkbox").count(), 0);
    await page.getByLabel("搜尋商品", { exact: true }).fill("");
    await page.getByRole("button", { name: "批量刪除", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "選擇 A000001 批量刪除", exact: true })
      .check();
    await page.getByLabel("庫藏", { exact: true }).selectOption("b");
    await page.getByRole("button", { name: "批量刪除", exact: true }).waitFor();
    assert.equal(await page.getByRole("checkbox").count(), 0);
    await page.getByLabel("庫藏", { exact: true }).selectOption("a");
    await page.getByRole("button", { name: "批量刪除", exact: true }).click();
    await page
      .getByRole("button", { name: "全選目前結果", exact: true })
      .click();
    await page.getByRole("button", { name: "批量列印", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "選擇 A000001 批量列印", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "取消批量刪除", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("checkbox", { name: "選擇 A000001 批量列印", exact: true })
        .isChecked(),
      false,
    );
    await page
      .getByRole("button", { name: "取消批量列印", exact: true })
      .click();
    await page.getByRole("button", { name: "批量刪除", exact: true }).click();
    await page
      .getByRole("button", { name: "全選目前結果", exact: true })
      .click();
    await page
      .getByRole("button", { name: "刪除所選 2 項", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "確認批量刪除 2 項商品",
      exact: true,
    });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("listitem").count(), 2);
    assert.match(await dialog.textContent(), /無法復原/);
    const confirm = dialog.getByRole("button", {
      name: "永久刪除 2 項",
      exact: true,
    });
    assert.equal(await confirm.isDisabled(), true);
    await dialog
      .getByLabel("請輸入「刪除」確認", { exact: true })
      .fill("delete");
    assert.equal(await confirm.isDisabled(), true);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(requests.length, 0);
    await page
      .getByRole("button", { name: "刪除所選 2 項", exact: true })
      .click();
    assert.equal(
      await dialog
        .getByLabel("請輸入「刪除」確認", { exact: true })
        .inputValue(),
      "",
    );
    await dialog.getByLabel("請輸入「刪除」確認", { exact: true }).fill("刪除");
    await page.screenshot({
      path: `/tmp/poster-bulk-delete-${width}.png`,
      fullPage: true,
    });
    assert.ok(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 2));
    await confirm.click();
    await arrived;
    await dialog
      .getByRole("button", { name: "刪除中…", exact: true })
      .waitFor();
    assert.equal(
      await dialog
        .getByRole("button", { name: "關閉批量刪除", exact: true })
        .isDisabled(),
      true,
    );
    await dialog
      .getByRole("button", { name: "刪除中…", exact: true })
      .evaluate((e) => {
        e.click();
        e.click();
      });
    assert.equal(requests.length, 1);
    release();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await confirm.isDisabled(), true);
    assert.equal(await page.evaluate(() => window.reloads || 0), 0);
    assert.equal(
      await dialog
        .getByLabel("請輸入「刪除」確認", { exact: true })
        .inputValue(),
      "",
    );
    await dialog.getByLabel("請輸入「刪除」確認", { exact: true }).fill("刪除");
    await confirm.click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], requests[0]);
    assert.equal(requests[1].productIds.length, 2);
    await page
      .getByRole("status")
      .filter({ hasText: "已刪除 2 項商品" })
      .waitFor();
    await page.getByLabel("庫藏", { exact: true }).selectOption("b");
    await page.getByText(/商品 100$/).waitFor();
    assert.deepEqual(errors, []);
    await page.goto(url + "/?many=1");
    await page.getByRole("button", { name: "批量刪除", exact: true }).click();
    await page
      .getByRole("button", { name: "選取前 50 項", exact: true })
      .click();
    await page
      .getByRole("button", { name: "刪除所選 50 項", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("checkbox")
        .evaluateAll((nodes) => nodes.filter((n) => n.checked).length),
      20,
    );
    await page.getByRole("button", { name: "下一頁", exact: true }).click();
    assert.equal(
      await page
        .getByRole("checkbox")
        .evaluateAll((nodes) => nodes.filter((n) => n.checked).length),
      20,
    );
    await page.getByRole("button", { name: "下一頁", exact: true }).click();
    await page.getByText("共 55 筆 · 第 3 / 3 頁", { exact: true }).waitFor();
    assert.equal(await page.getByRole("checkbox").count(), 15);
    assert.equal(
      await page
        .getByRole("checkbox")
        .evaluateAll((nodes) => nodes.filter((n) => n.checked).length),
      10,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "下一頁", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("checkbox", { name: "選擇 A000051 批量刪除", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByLabel("搜尋商品", { exact: true }).fill("商品 55");
    await page.getByText("共 1 筆 · 第 1 / 1 頁", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "上一頁", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "下一頁", exact: true })
        .isDisabled(),
      true,
    );
    await page.close();
    console.log(
      width +
        "px: review, typed confirmation, cancellation, scope/search/print reset, 50-item limit, duplicate-submit guard and atomic error handling passed",
    );
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
