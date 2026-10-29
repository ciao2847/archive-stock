// Run after npm run build: node tests/browser/preorder-naming.browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import { chromium } from "playwright";
const id = "00000000-0000-4000-8000-000000000031",
  owner = "00000000-0000-4000-8000-000000000001";
const bundle = await build({
  outfile: "/tmp/poster-preorder-naming-browser.js",
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
        builder.onResolve({ filter: /lib\/api\/products$/ }, () => ({
          path: "products",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `export const createProduct=async(input)=>{window.savedProduct=input;return{productId:'${id}'}};export const updateProduct=async(id,input)=>{window.updatedProduct={id,...input};return{updated:true}};export const uploadProductImages=async()=>({paths:['replacement.webp','replacement-thumb.webp']});export const removeProductImages=async()=>({});`,
        }));
      },
    },
  ],
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{NewProduct}from'./src/components/products/NewProduct';import{EditProduct}from'./src/components/products/EditProduct';import{ClaimProductSettings,defaultProductDraft}from'./src/components/claims/ClaimProductSettings';import{PublicClaimFormView}from'./src/components/claims/PublicClaimFormView';import{getDefaultClaimFormTheme}from'./src/lib/claim-form-theme';
const product={dbId:'${id}',id:'A000038',name:'🇰🇷 蜘蛛人 全員款',work:'蜘蛛人',preorderItemName:'全員款',category:'海報',country:'韓國',source:'',stock:0,price:250,size:'A3',location:'未指定',ownerId:'${owner}',ownerName:'海報小天地',status:'售罄',accent:'#aabbcc'};
const second={...product,dbId:'00000000-0000-4000-8000-000000000032',id:'A000039',name:'🇯🇵 蜘蛛人 肖像款',country:'日本',preorderItemName:'肖像款'};
function Management(){const[products,setProducts]=useState([product,second]);const[selected,setSelected]=useState(new Set(products.map(p=>p.dbId)));const[drafts,setDrafts]=useState(Object.fromEntries(products.map(p=>[p.dbId,defaultProductDraft(p)])));const[title,setTitle]=useState('蜘蛛人預購');return <ClaimProductSettings ownerId='${owner}' inventoryName='海報小天地' products={products} form={null} title={title} setTitle={setTitle} description='' setDescription={()=>{}} isOpen={true} setIsOpen={()=>{}} closesAt='' setClosesAt={()=>{}} selectedIds={selected} setSelectedIds={setSelected} productDrafts={drafts} setProductDrafts={setDrafts} saving={false} error='' savedMessage='' publicPath='' onSave={async()=>{window.formSaved=true}} onReloadProducts={async()=>{if(window.updatedProduct)setProducts(items=>items.map(p=>p.dbId===window.updatedProduct.id?{...p,...window.updatedProduct,preorderItemName:window.updatedProduct.preorderItemName}:p));}}/>}
function Public(){const form={title:'蜘蛛人預購',storeName:'海報小天地',completionMessage:'',bannerPosition:{x:50,y:50},isOpen:true,theme:getDefaultClaimFormTheme('海報小天地'),products:[product,second].map(p=>({...p,id:p.dbId,isEnabled:true,crafts:[],maxQuantity:20,publishedAt:'2026-10-19T00:00:00Z'}))};return <PublicClaimFormView form={form} token='public-fixture-token' turnstileSiteKey={null}/>}
createRoot(document.getElementById('root')).render(location.pathname==='/edit'?<EditProduct product={location.search.includes('image')?{...product,image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAAQUlEQVR4nO3OMQEAIAzAsPk3DRJ25ICjUZA5n5vXgU1BVVAVVAVVQVVQFVQFVUFVUBVUBVVBVVAVVAVVQVVQFVQXAJzoabnNs3sAAAAASUVORK5CYII='}:product} onClose={()=>{window.closed=true}} onUpdated={()=>{window.finished=true}}/>:location.pathname==='/management'?<Management/>:location.pathname==='/public'?<Public/>:<NewProduct ownerId='${owner}' preorderOnly initialWorkName='蜘蛛人' requireItemName={location.search.includes('multi')} onClose={()=>{window.closed=true}}/>);
`,
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
  "\n" +
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
    await page.addInitScript(() => {
      window.confirm = () => true;
    });
    await page.goto(url);
    await page
      .getByRole("button", { name: "建立預購商品", exact: true })
      .waitFor();
    await page
      .getByRole("combobox", { name: "國家版本", exact: true })
      .selectOption("韓國");
    await page.getByRole("spinbutton", { name: /會員價|販售金額/ }).fill("250");
    let preview = page.getByRole("status", { name: "商品名稱預覽" });
    assert.match(await preview.textContent(), /🇰🇷 蜘蛛人/);
    await page
      .getByRole("button", { name: "建立預購商品", exact: true })
      .click();
    await page.waitForFunction(() => Boolean(window.savedProduct));
    let saved = await page.evaluate(() => window.savedProduct);
    assert.equal(saved.name, "🇰🇷 蜘蛛人");
    assert.equal(saved.work, "蜘蛛人");
    assert.equal(saved.preorderItemName, "");
    assert.equal(saved.stock, 0);
    await page.goto(url + "/?multi");
    await page
      .getByRole("combobox", { name: "國家版本", exact: true })
      .selectOption("日本");
    await page.getByRole("spinbutton", { name: /會員價|販售金額/ }).fill("350");
    await page
      .getByRole("button", { name: "建立預購商品", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => Boolean(window.savedProduct)),
      false,
    );
    const item = page.getByLabel("品項名稱（必填）", { exact: false });
    for (const name of ["A款", "B款", "全員款", "肖像款", "月光下的約定"]) {
      await item.fill(name);
      assert.match(
        await preview.textContent(),
        new RegExp("🇯🇵 蜘蛛人 " + name),
      );
    }
    await page
      .getByRole("combobox", { name: "國家版本", exact: true })
      .selectOption("馬來西亞");
    assert.match(await preview.textContent(), /🇲🇾 蜘蛛人 月光下的約定/);
    await page
      .getByRole("combobox", { name: "國家版本", exact: true })
      .selectOption("北美");
    assert.match(await preview.textContent(), /🇺🇸 蜘蛛人 月光下的約定/);
    await page
      .getByRole("combobox", { name: "國家版本", exact: true })
      .selectOption("香港");
    await page.screenshot({
      path: `/tmp/poster-preorder-new-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "建立預購商品", exact: true })
      .click();
    await page.waitForFunction(() => Boolean(window.savedProduct));
    saved = await page.evaluate(() => window.savedProduct);
    assert.equal(saved.name, "🇭🇰 蜘蛛人 月光下的約定");
    assert.equal(saved.preorderItemName, "月光下的約定");
    assert.equal(saved.country, "香港");
    await page.goto(url + "/edit");
    await page.getByText("上傳商品圖片（選填）", { exact: true }).waitFor();
    assert.equal(await page.locator(".upload").count(), 1);
    await page.getByLabel("上傳商品圖片", { exact: true }).setInputFiles({
      name: "wrong.gif",
      mimeType: "image/gif",
      buffer: Buffer.from("invalid"),
    });
    await page
      .getByRole("alert")
      .filter({ hasText: "請選擇 JPG、PNG 或 WebP 圖片" })
      .waitFor();
    await page.getByLabel("上傳商品圖片", { exact: true }).setInputFiles({
      name: "poster.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAAQUlEQVR4nO3OMQEAIAzAsPk3DRJ25ICjUZA5n5vXgU1BVVAVVAVVQVVQFVQFVUFVUBVUBVVBVVAVVAVVQVVQFVQXAJzoabnNs3sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page.getByText("poster.png", { exact: true }).waitFor();
    await page.getByRole("button", { name: "查看完整商品圖片" }).click();
    await page
      .getByRole("dialog", { name: "商品圖片預覽", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "關閉圖片", exact: true }).click();
    await page.screenshot({
      path: `/tmp/poster-preorder-edit-upload-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("combobox", { name: "國家版本", exact: true })
      .selectOption("日本");
    await page
      .getByLabel("品項名稱（選填）", { exact: false })
      .fill("IMAX B款");
    await page.getByLabel("庫存數量", { exact: true }).fill("2");
    await page
      .getByRole("combobox", { name: "版本 / 影廳", exact: true })
      .selectOption("特別場");
    await page.getByRole("button", { name: "儲存修改", exact: false }).click();
    await page.waitForFunction(() => Boolean(window.updatedProduct));
    const updated = await page.evaluate(() => window.updatedProduct);
    assert.equal(updated.id, id);
    assert.equal(updated.name, "🇯🇵 蜘蛛人 IMAX B款");
    assert.equal(updated.stock, 2);
    assert.equal(updated.format, "特別場");
    assert.deepEqual(updated.imagePaths, [
      "replacement.webp",
      "replacement-thumb.webp",
    ]);
    await page.goto(url + "/edit?image");
    await page.getByRole("button", { name: "查看完整商品圖片" }).waitFor();
    await page.getByRole("button", { name: "移除圖片", exact: true }).click();
    await page.getByText("上傳商品圖片（選填）", { exact: true }).waitFor();
    await page.getByRole("button", { name: "儲存修改", exact: false }).click();
    await page.waitForFunction(() => Boolean(window.updatedProduct));
    assert.deepEqual(
      await page.evaluate(() => window.updatedProduct.imagePaths),
      [],
    );
    await page.goto(url + "/management");
    const publicName = page.getByLabel("🇰🇷 蜘蛛人 全員款公開商品名稱", {
      exact: true,
    });
    assert.equal(await publicName.isEditable(), true);
    await publicName.fill("測試自訂公開商品名稱");
    assert.equal(await publicName.inputValue(), "測試自訂公開商品名稱");
    await publicName.fill("🇰🇷 蜘蛛人 全員款");
    await page
      .getByRole("button", {
        name: "編輯 🇰🇷 蜘蛛人 全員款 的品項與國家",
        exact: true,
      })
      .click();
    await page.getByLabel("品項名稱（選填）", { exact: false }).fill("A款");
    await page
      .getByRole("combobox", { name: "國家版本", exact: true })
      .selectOption("日本");
    await page.getByRole("button", { name: "儲存修改", exact: false }).click();
    await page
      .getByLabel("🇯🇵 蜘蛛人 A款公開商品名稱", { exact: true })
      .waitFor();
    await page.screenshot({
      path: `/tmp/poster-preorder-management-${width}.png`,
      fullPage: true,
    });
    await page.goto(url + "/public");
    await page
      .getByRole("heading", { name: "🇰🇷 蜘蛛人 全員款", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "增加 🇰🇷 蜘蛛人 全員款 數量", exact: true })
      .click();
    await page
      .getByRole("button", { name: "增加 🇯🇵 蜘蛛人 肖像款 數量", exact: true })
      .click();
    assert.equal(
      await page
        .getByLabel("🇰🇷 蜘蛛人 全員款數量", { exact: true })
        .inputValue(),
      "1",
    );
    assert.equal(
      await page
        .getByLabel("🇯🇵 蜘蛛人 肖像款數量", { exact: true })
        .inputValue(),
      "1",
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS ${width}px: single-item default, required multi-item name, free names, country flags, inventory arrival editing, management names and public country variants`,
    );
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
