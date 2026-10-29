import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import { chromium } from "playwright";

const inventoryId = "00000000-0000-4000-8000-000000000001";
const bundle = await build({
  outfile: "/tmp/poster-print-reset-fixture.js",
  plugins: [
    {
      name: "scss",
      setup(builder) {
        builder.onLoad({ filter: /\.module\.scss$/ }, (args) => ({
          contents: compile(args.path).css,
          loader: "local-css",
        }));
      },
    },
  ],
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  alias: { "@": resolve("src") },
  define: { "process.env.NODE_ENV": '"development"' },
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{PrintLabelResetPanel}from'./src/components/products/PrintLabelResetPanel';
const items=Array.from({length:45},(_,i)=>({dbId:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),id:'A'+String(i+1).padStart(6,'0'),name:'海報 '+(i+1),country:'日本',category:'海報',stock:2,status:'在庫',location:'A櫃',accent:'#eee'}));
function App(){const[query,setQuery]=useState('');const[owner,setOwner]=useState('${inventoryId}');return <><label>搜尋商品<input value={query} onChange={e=>setQuery(e.target.value)}/></label><button onClick={()=>setOwner(owner==='${inventoryId}'?'00000000-0000-4000-8000-999999999999':'${inventoryId}')}>切換庫藏</button><PrintLabelResetPanel key={owner+':'+query} items={items.filter(p=>p.name.includes(query))} inventoryId={owner} inventoryName='測試庫藏'/></>};createRoot(document.getElementById('root')).render(<App/>);`,
  },
});
const css = compile("styles/app.global.scss", {
  silenceDeprecations: ["import", "global-builtin", "color-functions"],
}).css;
const server = createServer((req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(
      bundle.outputFiles.find((file) => file.path.endsWith(".js")).text,
    );
  }
  if (req.url === "/app.css") {
    res.setHeader("Content-Type", "text/css");
    return res.end(
      css +
        bundle.outputFiles
          .filter((file) => file.path.endsWith(".css"))
          .map((file) => file.text)
          .join("\n"),
    );
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root" style="padding:16px"></div><script src="/app.js"></script></body></html>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const requests = [];
    let reply = { success: true, data: { resetCount: 3, productCount: 2 } };
    let release;
    let hold = false;
    await page.route("**/api/print-labels/reset", async (route) => {
      requests.push(route.request().postDataJSON());
      if (hold)
        await new Promise((done) => {
          release = done;
        });
      await route.fulfill({ status: reply.success ? 200 : 503, json: reply });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const button = page.getByRole("button", { name: /^還原所選/ });
    assert.equal(await button.isDisabled(), true);
    assert.equal(await page.getByRole("checkbox").count(), 20);
    await page
      .getByRole("checkbox", {
        name: "選擇 A000001 還原已列印標籤",
        exact: true,
      })
      .check();
    await page.getByRole("button", { name: "下一頁", exact: true }).click();
    await page.getByRole("button", { name: "下一頁", exact: true }).click();
    await page
      .getByRole("checkbox", {
        name: "選擇 A000041 還原已列印標籤",
        exact: true,
      })
      .check();
    await page.getByRole("status").filter({ hasText: "已選擇 2 項" }).waitFor();
    hold = true;
    await button.click();
    await page.getByRole("button", { name: "還原中…", exact: true }).waitFor();
    await page.waitForFunction(
      () => document.querySelector("input[type=checkbox]")?.disabled,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "上一頁", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      inventoryId,
      productIds: [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000041",
      ],
    });
    hold = false;
    release();
    await page
      .getByRole("status")
      .filter({ hasText: "已還原 2 項商品的 3 張標籤" })
      .waitFor();
    assert.equal(await button.isDisabled(), true);
    assert.equal(
      await page
        .getByRole("checkbox")
        .evaluateAll((nodes) => nodes.some((node) => node.checked)),
      false,
    );
    await page
      .getByRole("button", { name: "全選目前結果", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "已選擇 45 項" })
      .waitFor();
    reply = { success: false, error: "還原失敗，請稍後再試" };
    await button.click();
    await page.getByRole("alert").filter({ hasText: "還原失敗" }).waitFor();
    assert.equal(requests[1].productIds.length, 45);
    await page
      .getByRole("status")
      .filter({ hasText: "已選擇 45 項" })
      .waitFor();
    assert.equal(await button.isDisabled(), false);
    reply = { success: true, data: { resetCount: 0, productCount: 45 } };
    await button.click();
    await page.getByRole("status").filter({ hasText: "沒有可還原" }).waitFor();
    await page.getByRole("checkbox").first().check();
    await page.getByLabel("搜尋商品", { exact: true }).fill("海報 1");
    await page.getByRole("status").filter({ hasText: "已選擇 0 項" }).waitFor();
    await page.getByText("共 11 筆 · 第 1 / 1 頁", { exact: true }).waitFor();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "切換庫藏", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "已選擇 0 項" }).waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS: ${width}px bulk selection across pages, single request, select-all, pending guard, error retention and scope resets`,
    );
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
