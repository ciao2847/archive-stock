// Browser contract for an inventory member editing stock and deleting products.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import { chromium } from "playwright";
const id = "00000000-0000-4000-8000-000000000002";
const bundle = await build({
  outfile: "/tmp/poster-product-member-browser.js",
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  alias: { "@": resolve("src") },
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  plugins: [
    {
      name: "fixtures",
      setup(builder) {
        builder.onLoad({ filter: /\.module\.scss$/ }, (args) => ({
          contents: compile(args.path).css,
          loader: "local-css",
          resolveDir: resolve(args.path, ".."),
        }));
        builder.onResolve({ filter: /utils\/supabase\/client$/ }, () => ({
          path: "supabase",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `export function createClient(){return{auth:{getUser:async()=>({data:{user:{id:'staff-user'}}})},from:()=>{const query={select:()=>query,eq:()=>query,order:async()=>({data:[]}),maybeSingle:async()=>({data:{role:'staff'}})};return query;}}}`,
        }));
      },
    },
  ],
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ProductPanel}from'./src/components/products/ProductPanel';
function App(){const[show,setShow]=useState(true);const[product,setProduct]=useState({dbId:'${id}',id:'A000038',name:'庫藏權限測試商品',work:'測試作品',category:'海報',country:'韓國',source:'',stock:3,price:250,location:'未指定',ownerId:'00000000-0000-4000-8000-000000000001',ownerName:'測試庫藏',status:'在庫',accent:'#5a87b1'});return show?<ProductPanel product={product} onClose={()=>setShow(false)} onUpdated={async()=>{window.reloads=(window.reloads||0)+1;if(window.latestPatch)setProduct(p=>({...p,...window.latestPatch}));}}/>:<div><p>商品清單</p><button type="button" onClick={()=>setShow(true)}>開啟商品</button></div>}createRoot(document.getElementById('root')).render(<App/>);`,
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
    .filter((x) => x.path.endsWith(".css"))
    .map((x) => x.text)
    .join("\n");
const server = createServer((req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    return res.end(bundle.outputFiles.find((x) => x.path.endsWith(".js")).text);
  }
  if (req.url === "/app.css") {
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    return res.end(css);
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
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
    await page.addInitScript(() => {
      window.acceptDelete = false;
      window.confirm = () => window.acceptDelete;
      window.alert = (message) => {
        window.alerts ??= [];
        window.alerts.push(message);
      };
    });
    let deletes = 0;
    await page.route("**/api/products/" + id, async (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        await page.evaluate((body) => {
          window.latestPatch = body;
        }, body);
        return route.fulfill({
          json: { success: true, data: { updated: true } },
        });
      }
      deletes++;
      return deletes === 1
        ? route.fulfill({
            status: 404,
            json: { success: false, error: "商品不存在或不屬於目前庫藏" },
          })
        : route.fulfill({ json: { success: true, data: { deleted: true } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const button = page.getByRole("button", { name: "刪除商品", exact: true });
    await button.waitFor();
    await page.getByRole("button", { name: "編輯商品", exact: true }).click();
    await page.getByLabel("庫存數量", { exact: true }).fill("2");
    await page.getByRole("button", { name: "儲存修改", exact: false }).click();
    await page.waitForFunction(() => window.reloads === 1);
    assert.equal(await page.evaluate(() => window.latestPatch.stock), 2);
    await page.getByRole("button", { name: "開啟商品", exact: true }).click();
    await button.click();
    assert.equal(deletes, 0);
    await page.evaluate(() => {
      window.acceptDelete = true;
    });
    await button.click();
    await page.waitForFunction(() => window.alerts?.length === 1);
    assert.match(await page.evaluate(() => window.alerts[0]), /目前庫藏/);
    assert.equal(await button.isEnabled(), true);
    await page.screenshot({
      path: `/tmp/poster-product-member-${width}.png`,
      fullPage: true,
    });
    await button.click();
    await page.getByText("商品清單", { exact: true }).waitFor();
    assert.equal(deletes, 2);
    assert.equal(await page.evaluate(() => window.reloads), 2);
    assert.match(await page.evaluate(() => window.alerts.at(-1)), /已成功刪除/);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      width +
        "px: staff stock editing, delete visibility, cancellation, scoped errors and successful deletion passed",
    );
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
