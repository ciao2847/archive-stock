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
      name: "next-navigation-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: "navigation",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `import {useSyncExternalStore} from 'react';export function usePathname(){return location.pathname;}export function useSearchParams(){const value=useSyncExternalStore(callback=>{window.addEventListener('popstate',callback);return()=>window.removeEventListener('popstate',callback);},()=>location.search,()=> '');return new URLSearchParams(value);}`,
          resolveDir: process.cwd(),
        }));
      },
    },
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
    contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {OrdersWorkspace} from './src/components/orders/OrdersWorkspace';import {NewOrder} from './src/components/orders/NewOrder';import {ClaimFormPanel} from './src/components/claims/ClaimFormPanel';
const item={orderItemId:'item-1',productId:'00000000-0000-4000-8000-000000000031',sku:'A000038',name:'測試海報',quantity:1,unitPrice:350,packedQuantity:1,scannedQuantity:0};
const common={ownerId:'${ownerId}',customer:'測試客人',customerKey:'test',customerNickname:'',customerContact:'',createdAt:'2026/10/16',payment:'已付款',items:[item],itemIds:['A000038'],packedIds:[]};
const rows=[{...common,dbId:'general-id',id:'ORDER-GENERAL',status:'待包貨',source:'general'},{...common,dbId:'00000000-0000-4000-8000-000000000041',id:'STALL-000041',status:'已包裝',source:'stall'},{...common,dbId:'cancelled-id',id:'STALL-CANCELLED',status:'已取消',source:'stall'}];
function Harness(){const [query,setQuery]=useState('');const [fulfillmentOrders,setFulfillmentOrders]=useState(()=>location.search.includes('fixture=management') ? [{...common,dbId:'00000000-0000-4000-8000-000000000080',id:'PREORDER-0001',claimSubmissionId:1,source:'claim',status:'待包貨',items:[{...item,quantity:2,unitPrice:300,packedQuantity:0}]}] : []);const orders=rows.filter(row=>JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));return <OrdersWorkspace renderClaimManagement={location.search.includes('management') ? (submissions,onReload)=><ClaimFormPanel ownerId='${ownerId}' inventoryName='測試庫藏' products={products} orders={fulfillmentOrders} onPackOrder={order=>{window.packingOrder=order;}} managementSubmissions={submissions} managementQuery={query} onManagementReload={onReload}/> : undefined} customerReconciliation={<section aria-label='顧客對帳測試'>跨活動顧客帳務</section>} ownerId='${ownerId}' orders={orders} query={query} onQueryChange={setQuery} loading={false} onChanged={()=>{window.changed=(window.changed??0)+1;if(window.fulfillmentOrders)setFulfillmentOrders(window.fulfillmentOrders);}} onEditAmount={()=>{window.generalEdit=true;}} onDelete={()=>{window.generalDelete=true;}} onPack={()=>{window.generalPack=true;}}/>};
const original=history.pushState.bind(history);history.pushState=(...args)=>{original(...args);dispatchEvent(new PopStateEvent('popstate'));};const products=[{ownerId:'${ownerId}',dbId:'00000000-0000-4000-8000-000000000031',id:'A000038',name:'測試海報',image:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',work:'天空之城',price:350,stock:2,status:'在庫',location:'A-01-01',accent:'#f3f7fb'}];createRoot(document.getElementById('root')).render(location.pathname==='/claims' ? <ClaimFormPanel ownerId='${ownerId}' inventoryName='測試庫藏' products={[]} orders={[]}/> : location.pathname==='/new-order' ? <NewOrder products={products} onCreated={()=>{window.orderCreated=true;}} onClose={()=>{window.orderClosed=true;}}/> : <Harness/>);`,
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
    const submissions = Array.from({ length: 51 }, (_, index) => ({
      source: "claim",
      id: index + 1,
      formId: 3,
      formTitle: "活動 A",
      confirmationCode: `PRE-${index + 1}`,
      nickname: `顧客${index + 1}`,
      phone: "0912345678",
      paymentStatus: "pending",
      createdAt: "2026-10-20T00:00:00Z",
      items: [
        {
          id: index + 1,
          name: "測試海報",
          sku: "A000038",
          quantity: 1,
          unitPrice: 300,
        },
      ],
      payments: [],
    }));
    await page.route("**/api/claim-forms?**", (route) =>
      route.fulfill({
        json: {
          success: true,
          data:
            new URL(route.request().url()).searchParams.get("scope") === "all"
              ? { submissions }
              : {
                  forms: [],
                  form: null,
                  submissions: [],
                  productTotals: [],
                  summary: {
                    submissionCount: 0,
                    customerCount: 0,
                    itemCount: 0,
                    estimatedTotal: 0,
                  },
                  pagination: {
                    page: 1,
                    pageSize: 10,
                    total: 0,
                    totalPages: 1,
                  },
                },
        },
      }),
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/orders?fixture=management`,
    );
    const list = page.getByRole("group", { name: "顧客清單" });
    await list.getByRole("button").first().waitFor();
    assert.equal(await list.getByRole("button").count(), 10);
    await page.getByText("共 51 筆 · 第 1 / 6 頁", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "上一頁", exact: true })
        .isDisabled(),
      true,
    );
    for (let i = 0; i < 5; i++)
      await page.getByRole("button", { name: "下一頁", exact: true }).click();
    assert.equal(await list.getByRole("button").count(), 1);
    await page
      .getByRole("button", { name: "查看 顧客51 的明細", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "下一頁", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("searchbox", { name: "搜尋訂單", exact: true })
      .fill("顧客2");
    assert.equal(await list.getByRole("button").count(), 10);
    await page.getByText("共 11 筆 · 第 1 / 2 頁", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${width}px: 51 orders, 10 per page, sixth page, boundaries and search reset`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
