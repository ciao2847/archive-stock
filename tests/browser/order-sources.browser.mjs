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
function Harness(){const [query,setQuery]=useState('');const [fulfillmentOrders,setFulfillmentOrders]=useState(()=>location.search.includes('fixture=management') ? [{...common,dbId:'00000000-0000-4000-8000-000000000080',id:'PREORDER-0001',claimSubmissionId:1,source:'claim',status:'待包貨',items:[{...item,quantity:2,unitPrice:300,packedQuantity:0}]}] : []);const orders=rows.filter(row=>JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));return <OrdersWorkspace renderClaimManagement={location.search.includes('management') ? (submissions,onReload)=><ClaimFormPanel ownerId='${ownerId}' inventoryName='測試庫藏' products={products} orders={fulfillmentOrders} onPackOrder={order=>{window.packingOrder=order;}} managementSubmissions={submissions} onManagementReload={onReload}/> : undefined} customerReconciliation={<section aria-label='顧客對帳測試'>跨活動顧客帳務</section>} ownerId='${ownerId}' orders={orders} query={query} onQueryChange={setQuery} loading={false} onChanged={()=>{window.changed=(window.changed??0)+1;if(window.fulfillmentOrders)setFulfillmentOrders(window.fulfillmentOrders);}} onEditAmount={()=>{window.generalEdit=true;}} onDelete={()=>{window.generalDelete=true;}} onPack={()=>{window.generalPack=true;}}/>};
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
    await page.addInitScript(() => {
      window.confirm = () => true;
    });
    let lastQuery,
      editPayload,
      cancelled = false;
    const order = {
      id: "00000000-0000-4000-8000-000000000041",
      orderNo: "STALL-000041",
      createdAt: "2026-10-16T01:00:00Z",
      status: "packed",
      revision: 0,
      note: "",
      settled: false,
      total: 350,
      items: [
        {
          id: "item-1",
          productId: "00000000-0000-4000-8000-000000000031",
          sku: "A000038",
          name: "測試海報",
          quantity: 1,
          unitPrice: 350,
          stock: 5,
        },
      ],
    };
    await page.route("**/api/checkout/orders**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (req.method() === "GET") {
        lastQuery = Object.fromEntries(url.searchParams);
        return route.fulfill({
          json: {
            success: true,
            data: {
              orders:
                url.searchParams.get("status") === "completed" && cancelled
                  ? []
                  : [{ ...order, status: cancelled ? "cancelled" : "packed" }],
              page: 1,
              pageSize: 20,
              total:
                url.searchParams.get("status") === "completed" && cancelled
                  ? 0
                  : 1,
            },
          },
        });
      }
      if (req.method() === "PATCH") editPayload = req.postDataJSON();
      else cancelled = true;
      return route.fulfill({
        json: { success: true, data: { orderId: order.id } },
      });
    });
    const submissions = ["claim", "bundle"].map((source, index) => ({
      source,
      id: index + 1,
      formId: 1,
      formTitle: "跨 IP 活動",
      confirmationCode: `${source.toUpperCase()}-001`,
      nickname: "小美",
      phone: "0912345678",
      paymentStatus: "pending",
      createdAt: "2026-10-20T00:00:00Z",
      items: [
        {
          id: 1,
          sku: "PRE-01",
          name: "預售測試海報",
          quantity: 2,
          unitPrice: 300,
        },
      ],
      payments: [],
    }));
    await page.route("**/api/claim-forms?**", (route) =>
      route.fulfill({ json: { success: true, data: { submissions } } }),
    );
    await page.goto(`http://127.0.0.1:${server.address().port}/orders`);
    assert.equal(
      await page.getByRole("button", { name: "訂單明細", exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "顧客對帳", exact: true }).count(),
      0,
    );
    await page
      .getByRole("button", { name: "查看顧客對帳", exact: true })
      .first()
      .click();
    await page.getByRole("region", { name: "顧客對帳測試" }).waitFor();
    await page
      .getByRole("button", { name: "返回訂單管理", exact: true })
      .click();
    await page.getByRole("group", { name: "訂單來源", exact: true }).waitFor();

    const group = page.getByRole("group", { name: "訂單來源" });
    await group
      .getByRole("button", { name: "全部訂單", exact: true })
      .waitFor();
    assert.equal(await page.locator("tbody tr").count(), 3);
    await page.getByText("CLAIM-001", { exact: true }).waitFor();
    await page.getByText("BUNDLE-001", { exact: true }).waitFor();
    await page.getByLabel("搜尋訂單", { exact: true }).fill("CLAIM-001");
    await page.getByText("CLAIM-001", { exact: true }).waitFor();
    assert.equal(
      await page.getByText("BUNDLE-001", { exact: true }).count(),
      0,
    );
    await page.getByText("查看訂購明細", { exact: true }).click();
    await page.getByText("預售測試海報", { exact: true }).waitFor();
    await page.getByRole("button", { name: "清除搜尋", exact: true }).click();
    await group.getByRole("button", { name: "配單", exact: true }).click();
    await page.getByText("BUNDLE-001", { exact: true }).waitFor();
    assert.equal(await page.getByText("CLAIM-001", { exact: true }).count(), 0);
    await page.reload();
    await page.getByText("BUNDLE-001", { exact: true }).waitFor();
    await page
      .getByRole("group", { name: "訂單來源" })
      .getByRole("button", { name: "全部訂單", exact: true })
      .click();
    await page.getByText("CLAIM-001", { exact: true }).waitFor();

    const general = page
      .locator("tbody tr")
      .filter({ hasText: "ORDER-GENERAL" });
    await general
      .getByRole("button", { name: "訂單 ORDER-GENERAL 操作" })
      .click();
    await general
      .getByRole("button", { name: "編輯訂單", exact: true })
      .click();
    assert.equal(await page.evaluate(() => window.generalEdit), true);
    await group.getByRole("button", { name: "一般訂單", exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get("source"), "general");
    assert.equal(await page.locator("tbody tr").count(), 1);
    await page.getByLabel("搜尋訂單").fill("不存在的商品");
    await page
      .getByText("找不到符合「不存在的商品」的訂單", { exact: true })
      .waitFor();
    assert.equal(await group.isVisible(), true);
    const search = page.getByRole("searchbox", { name: "搜尋訂單" });
    await page.getByRole("button", { name: "清除搜尋", exact: true }).click();
    assert.equal(await search.inputValue(), "");
    assert.equal(
      await search.evaluate((input) => input === document.activeElement),
      true,
    );
    assert.equal(await page.locator("tbody tr").count(), 1);
    await search.fill("ORDER-GENERAL");
    await search.press("Escape");
    assert.equal(await search.inputValue(), "");
    await search.press("Escape");
    assert.equal(
      await search.evaluate((input) => input === document.activeElement),
      false,
    );
    await page.keyboard.press("Control+k");
    assert.equal(
      await search.evaluate((input) => input === document.activeElement),
      true,
    );
    await search.fill("ORDER-GENERAL");
    await page.getByRole("button", { name: "查詢", exact: true }).click();
    assert.equal(await page.locator("tbody tr").count(), 1);
    await page.getByRole("button", { name: "清除搜尋", exact: true }).click();
    await group.getByRole("button", { name: "全部訂單", exact: true }).click();
    const stall = page.locator("tbody tr").filter({ hasText: "STALL-000041" });
    await stall.getByRole("button", { name: "訂單 STALL-000041 操作" }).click();
    assert.equal(
      await stall
        .getByRole("button", { name: "刪除訂單", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await stall
        .getByRole("button", { name: "開始包貨", exact: true })
        .count(),
      0,
    );
    await stall
      .getByRole("button", { name: "查看與管理攤位訂單", exact: true })
      .click();
    await page
      .getByRole("region", { name: "攤位訂單查找與管理" })
      .getByRole("button", { name: "編輯訂單", exact: true })
      .waitFor();
    assert.equal(lastQuery.query, "STALL-000041");
    assert.equal(new URL(page.url()).searchParams.get("source"), "stall");
    assert.equal(new URL(page.url()).searchParams.get("order"), "STALL-000041");
    await page.getByRole("button", { name: "編輯訂單", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("單價 A000038").fill("300");
    await dialog.getByRole("button", { name: "儲存修改" }).click();
    await page.getByRole("status").filter({ hasText: "訂單已更新" }).waitFor();
    assert.equal(editPayload.items[0].unitPrice, 300);
    await page.getByRole("button", { name: "撤銷並復原", exact: true }).click();
    await page
      .getByRole("article", { name: "攤位訂單 STALL-000041" })
      .getByText("已撤銷", { exact: true })
      .waitFor();
    assert.equal(await page.evaluate(() => window.changed), 2);
    const length = await page.evaluate(() => history.length);
    await group.getByRole("button", { name: "攤位訂單", exact: true }).click();
    await page.getByLabel("訂單或商品").waitFor();
    assert.equal(new URL(page.url()).searchParams.has("order"), false);
    await page.waitForFunction(
      () =>
        document.querySelector('input[placeholder="訂單編號、商品編號或名稱"]')
          ?.value === "",
    );
    const cleanLength = await page.evaluate(() => history.length);
    await group.getByRole("button", { name: "攤位訂單", exact: true }).click();
    assert.equal(await page.evaluate(() => history.length), cleanLength);
    assert.ok(cleanLength >= length);
    await page.reload();
    await group
      .getByRole("button", { name: "攤位訂單", exact: true })
      .waitFor();
    assert.equal(
      await group
        .getByRole("button", { name: "攤位訂單", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await page.getByRole("table").count(), 0);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const sourceBox = await group.boundingBox();
    const searchBox = await page.getByRole("search").boundingBox();
    if (width > 700) {
      assert.ok(searchBox.x > sourceBox.x + sourceBox.width);
      assert.ok(Math.abs(searchBox.y - sourceBox.y) < 4);
    } else {
      assert.ok(searchBox.y >= sourceBox.y + sourceBox.height);
    }
    await page.getByLabel("訂單狀態").selectOption("completed");
    await page.getByRole("button", { name: "查找訂單" }).click();
    await page.getByText("找不到符合條件的攤位訂單", { exact: true }).waitFor();
    await page
      .getByText("請調整搜尋條件、日期或訂單狀態後再試一次", { exact: true })
      .waitFor();
    await page.screenshot({
      path: `/tmp/poster-order-sources-${width}.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      `PASS order sources ${width}px: source tabs, standard actions, protected stall actions, focused management, edit/cancel reuse, URL persistence and no duplicate navigation`,
    );
    await page.close();
  }
  // Searching inside a creation form must never submit or validate the order.
  for (const width of [390, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    let writes = 0;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/orders", (route) => {
      writes++;
      return route.fulfill({ json: { success: true, data: {} } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/new-order`);
    const search = page.getByRole("searchbox", { name: "搜尋訂購商品" });
    await page.getByPlaceholder("例：王小姐").fill("測試客人");
    await page.locator(".order-product-list button").click();
    await search.fill("不存在的商品");
    await search.press("Enter");
    assert.equal(writes, 0);
    assert.equal(await page.locator(".order-product-list button").count(), 0);
    assert.equal(await page.locator("form form").count(), 0);
    await page.getByRole("button", { name: "清除搜尋", exact: true }).click();
    assert.equal(await page.locator(".order-product-list button").count(), 1);
    await search.fill("A000038");
    await page.getByRole("button", { name: "查詢", exact: true }).click();
    assert.equal(writes, 0);
    assert.equal(await page.locator(".order-product-list button").count(), 1);
    await search.fill("天空");
    await search.press("Escape");
    assert.equal(await search.inputValue(), "");
    assert.equal(
      await page
        .getByRole("heading", { name: "新增訂單", exact: true })
        .isVisible(),
      true,
    );
    assert.equal(
      await page.evaluate(() =>
        Boolean(window.orderCreated || window.orderClosed),
      ),
      false,
    );
    assert.equal(
      await page.getByRole("button", { name: "返回", exact: true }).count(),
      0,
    );
    const close = page.getByRole("button", {
      name: "關閉新增訂單",
      exact: true,
    });
    await page.evaluate(() => {
      window.confirm = () => false;
    });
    await close.click();
    assert.equal(await page.evaluate(() => Boolean(window.orderClosed)), false);
    await page.evaluate(() => {
      window.confirm = () => true;
    });
    await close.click();
    assert.equal(await page.evaluate(() => Boolean(window.orderClosed)), true);
    assert.equal(writes, 0);
    assert.deepEqual(errors, []);
    console.log(
      `PASS order product search ${width}px: filtering, Enter, clear and query preserve selected products without submitting the order`,
    );
    await page.close();
  }
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const submission = {
      source: "claim",
      id: 1,
      formId: 3,
      formTitle: "活動 A",
      confirmationCode: "PREORDER-0001",
      nickname: "小美",
      phone: "0912345678",
      paymentStatus: "pending",
      createdAt: "2026-10-20T00:00:00Z",
      items: [
        {
          id: 1,
          sku: "PRE-01",
          name: "預售測試海報",
          quantity: 2,
          unitPrice: 300,
        },
      ],
      payments: [],
    };
    let paymentPayload;
    await page.route("**/api/claim-forms?**", (route) =>
      route.fulfill({
        json: {
          success: true,
          data:
            new URL(route.request().url()).searchParams.get("scope") === "all"
              ? { submissions: [submission] }
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
                    pageSize: 20,
                    total: 0,
                    totalPages: 1,
                  },
                },
        },
      }),
    );
    await page.route("**/api/claim-payments", async (route) => {
      paymentPayload = route.request().postDataJSON();
      submission.payments = [
        {
          id: 1,
          amount: 600,
          transferredAt: paymentPayload.transferredAt,
          createdAt: paymentPayload.transferredAt,
        },
      ];
      submission.paymentStatus = "paid";
      await route.fulfill({ json: { success: true, data: { paymentId: 1 } } });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/orders?fixture=management`,
    );
    await page
      .getByRole("button", { name: "查看 小美 的明細", exact: true })
      .waitFor();
    const productImage = page.getByRole("button", {
      name: "查看 測試海報 圖片",
      exact: true,
    });
    await productImage.waitFor();
    await productImage.locator("img").evaluate((image) => image.decode());
    await productImage.click();
    const preview = page.getByRole("dialog", { name: "商品圖片預覽" });
    await preview.waitFor();
    assert.match(
      await preview.locator("img").getAttribute("src"),
      /^data:image\/gif/,
    );
    await page.getByRole("button", { name: "關閉圖片", exact: true }).click();
    assert.equal(await preview.count(), 0);
    await page.getByRole("button", { name: "開始包貨", exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.packingOrder.claimSubmissionId),
      1,
    );
    await page.getByRole("button", { name: "登記匯款", exact: true }).click();
    const editor = page.getByRole("form", { name: "匯款紀錄表單" });
    await editor.waitFor();
    assert.equal(
      await editor.getByRole("spinbutton", { name: "匯款金額" }).inputValue(),
      "600",
    );
    await editor
      .getByRole("button", { name: "儲存匯款紀錄", exact: true })
      .click();
    await page.getByText("匯款紀錄已儲存。", { exact: true }).waitFor();
    assert.equal(paymentPayload.submissionId, 1);
    assert.equal(paymentPayload.amount, 600);
    assert.equal(
      await page.getByRole("button", { name: "登記匯款", exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("tablist", { name: "訂購紀錄檢視" }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS moved order management ${width}px: full detail view, payment registration, refreshed paid status and no form controls`,
    );
    await page.route("**/api/claim-forms?**", (route) => {
      const form = {
        id: 3,
        title: "活動 A",
        publicToken: "test-token",
        isOpen: true,
        products: [],
      };
      return route.fulfill({
        json: {
          success: true,
          data: {
            forms: [form],
            form,
            submissions: [submission],
            productTotals: [],
            summary: {
              submissionCount: 1,
              customerCount: 1,
              itemCount: 2,
              estimatedTotal: 600,
            },
            pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
          },
        },
      });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/claims`);
    await page
      .getByRole("heading", { name: "IP 訂購連結", exact: true })
      .waitFor();
    await page.getByRole("button", { name: /^採購統計/ }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "登記匯款", exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("tab", { name: "顧客清單", exact: true }).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "顧客對帳結算", exact: true })
        .count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS form management ${width}px: procurement and form setup remain; order operations are moved out`,
    );

    await page.close();
  }
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const submission = {
      source: "bundle",
      id: 9,
      formId: 0,
      formTitle: "配單活動",
      confirmationCode: "HD-0009",
      nickname: "小美",
      phone: "0912345678",
      paymentStatus: "pending",
      createdAt: "2026-10-20T00:00:00Z",
      items: [
        { id: 9, sku: "BUNDLE", name: "配單", quantity: 1, unitPrice: 600 },
      ],
      payments: [],
    };
    await page.route("**/api/claim-forms?**", (route) =>
      route.fulfill({
        json: {
          success: true,
          data:
            new URL(route.request().url()).searchParams.get("scope") === "all"
              ? { submissions: [submission] }
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
                    pageSize: 20,
                    total: 0,
                    totalPages: 1,
                  },
                },
        },
      }),
    );
    await page.route("**/api/order-fulfillment?**", (route) =>
      route.fulfill({
        json: { success: true, data: { state: "missing_products" } },
      }),
    );
    let saved;
    await page.route("**/api/order-fulfillment", async (route) => {
      saved = route.request().postDataJSON();
      await page.evaluate(
        ({ ownerId, items }) => {
          window.fulfillmentOrders = [
            {
              dbId: "00000000-0000-4000-8000-000000000090",
              id: "HD-0009",
              ownerId,
              source: "bundle",
              bundleClaimOrderId: 9,
              status: "待包貨",
              customer: "小美",
              customerKey: "contact:0912345678",
              items: items.map((item) => ({
                orderItemId: "mapped-item",
                productId: item.productId,
                name: "測試海報",
                sku: "A000038",
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                packedQuantity: 0,
                scannedQuantity: 0,
              })),
            },
          ];
        },
        { ownerId, items: saved.items },
      );
      await route.fulfill({
        json: {
          success: true,
          data: { orderId: "00000000-0000-4000-8000-000000000090" },
        },
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/orders?fixture=bundle-management`,
    );
    await page
      .getByRole("button", { name: "對應出貨商品", exact: true })
      .click();
    const form = page.getByRole("form", { name: "配單出貨商品對應" });
    await form
      .getByLabel("商品 1", { exact: true })
      .selectOption("00000000-0000-4000-8000-000000000031");
    await form.getByLabel("數量 1", { exact: true }).fill("2");
    await form
      .getByRole("button", { name: "儲存商品對應", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "商品合計須等於配單原總額" })
      .waitFor();
    assert.equal(saved, undefined);
    await form.getByLabel("單價 1", { exact: true }).fill("300");
    await form
      .getByRole("button", { name: "儲存商品對應", exact: true })
      .click();
    await page.getByRole("button", { name: "開始包貨", exact: true }).waitFor();
    assert.equal(saved.bundleOrderId, 9);
    assert.equal(saved.items[0].quantity, 2);
    await page.getByRole("button", { name: "開始包貨", exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.packingOrder.bundleClaimOrderId),
      9,
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS bundle packing ${width}px: real product mapping, total validation, source number preservation and existing packing entry`,
    );
    await page.route("**/api/order-fulfillment?**", (route) =>
      route.fulfill({
        json: { success: true, data: { state: "unavailable" } },
      }),
    );
    await page.reload();
    await page
      .getByText("包貨狀態：包貨功能尚未啟用", { exact: false })
      .waitFor();
    await page
      .getByText("目前連線的資料庫尚未安裝訂購包貨功能", { exact: false })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "對應出貨商品", exact: true })
        .count(),
      0,
    );

    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
