// node tests/browser/shared-image-options.browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

const bundle = await build({
  outfile: "/tmp/archive-shared-options-browser.js",
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
        builder.onResolve({ filter: /lib\/api\/products$/ }, () => ({
          path: "uploads",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `export async function createProduct(){throw new Error("not used")};export async function updateProduct(){throw new Error("not used")};export async function removeProductImages(){return {removed:true}};export async function uploadProductImages(){window.uploadCount=(window.uploadCount||0)+1;return {paths:['00000000-0000-4000-8000-000000000003/main.webp','00000000-0000-4000-8000-000000000003/thumb.webp']}}`,
        }));
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
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{ClaimProductSettings}from'./src/components/claims/ClaimProductSettings';
    import{ClaimProductSelection}from'./src/components/claims/public-form/ClaimProductSelection';
    function App(){const[quantities,setQuantities]=useState({}),[open,setOpen]=useState(true);
      const original={dbId:'00000000-0000-4000-8000-000000000010',id:'SINGLE',name:'原本單品',work:'角色海報系列',category:'海報',country:'韓國',stock:0,price:350,ownerId:'00000000-0000-4000-8000-000000000001'};
      const[adminProducts,setAdminProducts]=useState([original]),[selected,setSelected]=useState(new Set([original.dbId])),[drafts,setDrafts]=useState({});
      const products=Array.from({length:6},(_,i)=>({id:String(i+1),name:'第'+(i+1)+'款',work:'角色海報系列',category:'海報',price:location.search.includes('different-prices')&&i===1?400:350,maxQuantity:i===0?2:20,isEnabled:i!==5,imageUrl:'/fixture/thumb.webp',crafts:[],sku:String(i),publishedAt:'2026-11-11'}));
      const selectedProducts=products.filter(p=>p.isEnabled&&(quantities[p.id]||0)>0).map(product=>({product,quantity:quantities[product.id]}));
      return location.pathname==='/admin'?<><output aria-label='已選商品數'>{selected.size}</output><ClaimProductSettings ownerId='00000000-0000-4000-8000-000000000001' inventoryName='預覽庫藏' products={adminProducts} form={null} title='角色海報系列' setTitle={()=>{}} description='' setDescription={()=>{}} isOpen={true} setIsOpen={()=>{}} closesAt='' setClosesAt={()=>{}} selectedIds={selected} setSelectedIds={setSelected} productDrafts={drafts} setProductDrafts={setDrafts} saving={false} error='' savedMessage='' publicPath='' onSave={async()=>{window.savedIds=Array.from(selected)}} onReloadProducts={async()=>{setAdminProducts([original,...(window.createdItems||[]).map((item,i)=>({...original,dbId:window.createdIds[i],id:'OPTION-'+i,name:item.itemName,work:item.work,preorderItemName:item.itemName,price:item.price}))])}}/></>:<main style={{maxWidth:900,margin:'auto',padding:16,'--claim-border':'#d8e3ec','--claim-surface':'#fff','--claim-surface-text':'#172433','--claim-surface-muted':'#64748b','--claim-primary':'#5a87b1','--claim-soft':'#eef5fa'}}><ClaimProductSelection form={{products,isOpen:open,theme:{surfaceColor:'#FFFFFF'}}} quantities={quantities} selectedProducts={selectedProducts} availableProductCount={5} itemCount={selectedProducts.reduce((sum,p)=>sum+p.quantity,0)} subtotal={selectedProducts.reduce((sum,p)=>sum+p.product.price*p.quantity,0)} submitting={false} onQuantityChange={(id,value)=>setQuantities(q=>({...q,[id]:value}))}/><button onClick={()=>setOpen(false)}>截止訂購</button><button onClick={()=>{window.orderItems=selectedProducts.map(({product,quantity})=>({productId:product.id,quantity}))}}>送出測試訂單</button></main>;
    }createRoot(document.getElementById('root')).render(<App/>);`,
  },
});
const tailwindCss = (
  await postcss([tailwind()]).process(
    await readFile("styles/tailwind.css", "utf8"),
    { from: resolve("styles/tailwind.css") },
  )
).css;
const css =
  tailwindCss +
  compile("styles/app.global.scss").css +
  bundle.outputFiles
    .filter((file) => file.path.endsWith(".css"))
    .map((file) => file.text)
    .join("\n");
const server = createServer((req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(
      bundle.outputFiles.find((file) => file.path.endsWith(".js")).text,
    );
  }
  if (req.url === "/app.css") {
    res.setHeader("Content-Type", "text/css");
    return res.end(css);
  }
  if (req.url.startsWith("/fixture/")) {
    res.setHeader("Content-Type", "image/svg+xml");
    return res.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1147" height="398"><rect width="1147" height="398" fill="#15181d"/>${Array.from({ length: 6 }, (_, index) => `<rect x="${30 + index * 182}" y="55" width="166" height="280" fill="${["#a9644d", "#5b6596", "#ae5960", "#48545b", "#a2678d", "#8e4343"][index]}"/><text x="${113 + index * 182}" y="210" text-anchor="middle" font-size="38" fill="white">${index + 1}</text>`).join("")}</svg>`,
    );
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    '<!doctype html><html lang="zh-Hant"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    const errors = [];
    page.on("pageerror", (cause) => errors.push(cause.message));
    await page.goto(`${base}/public`);
    await page.getByLabel("第1款數量", { exact: true }).fill("2");
    await page.getByLabel("第2款數量", { exact: true }).fill("3");
    assert.equal(await page.getByRole("img").count(), 1);
    assert.match(
      await page.getByLabel("款式統一單價", { exact: true }).innerText(),
      /350/,
    );
    const group = page.getByRole("article", { name: "角色海報系列 款式選擇" });
    assert.equal(
      await group.locator("strong").count(),
      1,
      "same-price options display a single shared price",
    );
    assert.match(
      await page.getByLabel("訂購總額", { exact: true }).innerText(),
      /共 5 件[\s\S]*1,750/,
    );
    assert.equal(
      await page.getByRole("button", { name: "增加 第1款 數量" }).isDisabled(),
      true,
    );
    assert.equal(
      await page.getByLabel("第6款數量", { exact: true }).count(),
      0,
    );
    await page.getByRole("button", { name: "送出測試訂單" }).click();
    assert.deepEqual(await page.evaluate(() => window.orderItems), [
      { productId: "1", quantity: 2 },
      { productId: "2", quantity: 3 },
    ]);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const image = await page.getByRole("img").boundingBox();
    assert.ok(
      image.width / image.height > 2.8,
      "the complete six-style image must keep its wide aspect ratio",
    );
    await page.screenshot({
      path: `/tmp/archive-stock-options-public-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "截止訂購" }).click();
    assert.equal(
      await page.getByLabel("第2款數量", { exact: true }).isDisabled(),
      true,
    );
    await page.goto(`${base}/public?different-prices`);
    const mixedGroup = page.getByRole("article", {
      name: "角色海報系列 款式選擇",
    });
    assert.equal(
      await page.getByLabel("款式統一單價", { exact: true }).count(),
      0,
    );
    assert.equal(
      await mixedGroup.locator("strong").count(),
      6,
      "existing differently priced options keep their actual prices",
    );
    await page.getByLabel("第1款數量", { exact: true }).fill("2");
    await page.getByLabel("第2款數量", { exact: true }).fill("3");
    assert.match(
      await page.getByLabel("訂購總額", { exact: true }).innerText(),
      /共 5 件[\s\S]*1,900/,
    );
    await page.goto(`${base}/admin`);
    assert.equal(
      await page.getByLabel("已選商品數", { exact: true }).innerText(),
      "1",
    );
    await page
      .getByRole("button", {
        name: /新增預購商品/,
      })
      .click();
    await page
      .getByRole("heading", { name: "新增訂購預購商品", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "關閉新增商品", exact: true })
      .click();
    await page
      .getByRole("button", { name: "整圖多款上架", exact: true })
      .click();
    await page.getByLabel("上傳商品圖片").setInputFiles({
      name: "options.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page.getByLabel("國家版本", { exact: false }).selectOption("韓國");
    await page.getByLabel("統一會員價", { exact: false }).fill("350");
    await page.getByRole("button", { name: "帶入第1款至第6款" }).click();
    await page.screenshot({
      path: `/tmp/archive-stock-options-admin-${width}.png`,
      fullPage: true,
    });
    let attempts = 0;
    const requests = [];
    await page.route("**/api/products/preorder-batch", async (route) => {
      attempts++;
      requests.push(route.request().postDataJSON());
      if (attempts === 1) return route.abort("failed");
      await page.evaluate((items) => {
        window.createdItems = items;
        window.createdIds = items.map(
          (_, i) =>
            "00000000-0000-4000-8000-" + String(i + 100).padStart(12, "0"),
        );
      }, requests[0].items);
      return route.fulfill({
        json: {
          success: true,
          data: {
            batchId: requests[0].requestId,
            productIds: Array.from(
              { length: 6 },
              (_, i) =>
                "00000000-0000-4000-8000-" + String(i + 100).padStart(12, "0"),
            ),
          },
        },
      });
    });
    await page.getByRole("button", { name: "建立 6 款並加入訂購頁" }).click();
    await page.getByRole("button", { name: "重試確認這一批" }).waitFor();
    assert.equal(await page.evaluate(() => window.uploadCount), 1);
    // Restore a lost-response receipt after closing/reloading the dialog.
    await page.reload();
    await page
      .getByRole("button", { name: "整圖多款上架", exact: true })
      .click();
    await page.getByRole("button", { name: "重試確認這一批" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "已建立並加入 6 個共用圖片的款式" })
      .waitFor();
    assert.equal(
      await page.getByLabel("已選商品數", { exact: true }).innerText(),
      "7",
      "new options retain the existing single product",
    );
    await page
      .getByRole("button", { name: "發佈訂購頁", exact: true })
      .first()
      .click();
    assert.equal(
      (await page.evaluate(() => window.savedIds)).length,
      7,
      "single and multi-option products share the same form save",
    );
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(requests[0].items.length, 6);
    assert.equal(requests[0].sharedImagePaths.length, 2);
    assert.equal(
      await page.evaluate(() => window.uploadCount || 0),
      0,
      "retry after reload reuses uploaded images",
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Shared-image admin/retry and public multi-quantity flows passed at 375/768/1440px.",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
