// Run after npm run build. Optional POSTER_PLAYWRIGHT_MODULE points to Playwright
// when it is provided externally instead of installed in this repository.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const { chromium } = await import(
  process.env.POSTER_PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.POSTER_PLAYWRIGHT_MODULE).href
    : "playwright"
);
const theme = {
  primaryColor: "#15344c",
  backgroundColor: "#f3f7fb",
  surfaceColor: "#ffffff",
  headerTextColor: "#ffffff",
};
const image = {
  id: 1,
  sortOrder: 0,
  mediaType: "image/png",
  originalFilename: "商品圖片 1",
  productName: "天空之城",
  productAmount: 499,
  byteSize: 100,
  url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='120'%3E%3Crect width='100' height='120' fill='%23D6A84B'/%3E%3C/svg%3E",
};
const menu = {
  storeName: "測試庫藏",
  officialLineId: "@testbundle",
  campaignTitle: "10月第一批大禮包",
  campaignDescription: "第一批共同選單",
  completionMessage: "請聯絡管理者完成匯款",
  bannerPosition: { x: 50, y: 50 },
  theme,
  options: [
    {
      id: 1,
      label: "james",
      title: "james 專屬大禮包",
      description: "依截圖為準",
      totalAmount: 1399,
      state: "open",
      images: [
        image,
        {
          ...image,
          id: 2,
          sortOrder: 1,
          productName: "龍貓",
          productAmount: 450,
        },
        {
          ...image,
          id: 4,
          sortOrder: 2,
          productName: "神隱少女",
          productAmount: 450,
        },
      ],
    },
    {
      id: 2,
      label: "Irene",
      title: "Irene 專屬大禮包",
      description: "兩張海報",
      totalAmount: 800,
      state: "open",
      images: [],
    },
    {
      id: 3,
      label: "Yoyo",
      title: "Yoyo 專屬大禮包",
      totalAmount: 900,
      state: "confirmed",
      images: [],
    },
  ],
};
const orderForm = {
  storeName: "測試庫藏",
  officialLineId: "@testbundle",
  completionMessage: "請聯絡管理者完成匯款",
  title: "十月商品訂購",
  description: "商品自行選購",
  isOpen: true,
  bannerPosition: { x: 50, y: 50 },
  theme,
  products: [
    {
      id: "product-a",
      name: "天空之城",
      sku: "A",
      work: "天空之城",
      category: "海報",
      price: 499,
      isEnabled: true,
      maxQuantity: 2,
      crafts: [],
      imageUrl: image.url,
    },
    {
      id: "product-b",
      name: "龍貓",
      sku: "B",
      work: "龍貓",
      category: "海報",
      price: 450,
      isEnabled: true,
      maxQuantity: 3,
      crafts: [],
      imageUrl: image.url,
    },
    {
      id: "product-c",
      name: "暫停商品",
      sku: "C",
      work: "暫停商品",
      category: "海報",
      price: 300,
      isEnabled: false,
      maxQuantity: 1,
      crafts: [],
    },
  ],
};
const adminSubmissions = [
  {
    source: "claim",
    id: 1,
    formId: 11,
    formTitle: "商品訂購活動",
    confirmationCode: "HD-CLAIM-1",
    nickname: "james",
    phone: "0912345678",
    notes: "需要核對",
    paymentStatus: "pending",
    createdAt: "2026-10-07T00:00:00Z",
    items: [{ id: 1, sku: "A", name: "天空之城", quantity: 2, unitPrice: 500 }],
    payments: [],
  },
  {
    source: "bundle",
    id: 1,
    formId: 0,
    formTitle: "配單活動",
    confirmationCode: "HD-BUNDLE-1",
    nickname: "Irene",
    phone: "0912345678",
    paymentStatus: "pending",
    createdAt: "2026-10-07T00:00:00Z",
    items: [
      { id: 2, sku: "B", name: "龍貓配單", quantity: 1, unitPrice: 1399 },
    ],
    payments: [],
  },
  {
    source: "claim",
    id: 2,
    formId: 11,
    formTitle: "商品訂購活動",
    confirmationCode: "HD-CLAIM-2",
    nickname: "Yoyo",
    phone: "0999999999",
    paymentStatus: "pending",
    createdAt: "2026-10-07T00:00:00Z",
    items: [{ id: 3, sku: "C", name: "神隱少女", quantity: 1, unitPrice: 450 }],
    payments: [],
  },
];
const adminFixtureCode = `
import {ClaimSubmissionsView} from './src/components/claims/ClaimSubmissionsView';
import {ClaimCustomersView} from './src/components/claims/ClaimCustomersView';
function SharedAdminFixture() {
 const [isOpen,setIsOpen]=React.useState(true);
 const [records,setRecords] = React.useState(${JSON.stringify(adminSubmissions)});
 const [page,setPage]=React.useState(1);const [formId,setFormId]=React.useState(11);
 const rows=page===1?records.filter(record=>record.id===1):records.filter(record=>record.id===2);
 async function recordPayment(input) {
  window.testPaymentCalls ??= []; window.testPaymentCalls.push(input);
  if(window.testRejectPayment) {window.testRejectPayment=false;throw new Error('測試匯款儲存失敗');}
  setRecords(current=>current.map(record=>record.id===input.submissionId && record.source===input.source ? {...record,payments:[...record.payments,{id:9,amount:input.amount,transferredAt:input.transferredAt,payerAccountLastFive:input.payerAccountLastFive,note:input.note}],paymentStatus:input.amount>=record.items.reduce((sum,item)=>sum+item.unitPrice*item.quantity,0)?'paid':'half_paid'}:record));
 }
 return <div className='p-4'>
 <button type='button' onClick={()=>setFormId(12)}>測試切換活動</button><button type='button' onClick={()=>setRecords(current=>current.map(record=>record.source==='bundle'?{...record,receivingCheckedAt:record.receivingCheckedAt?undefined:'2026-10-07T00:00:00Z'}:record))}>測試入庫核對</button>
 {location.pathname === '/settlement' ? <ClaimCustomersView submissions={records} loading={false} inventoryName='測試庫藏' onRecordPayment={recordPayment} onDeletePayment={async()=>{}} onDeleteSubmission={async(id,formId,source)=>{window.testDeleteCalls??=[];window.testDeleteCalls.push({id,formId,source});setRecords(current=>current.filter(record=>!(record.id===id&&record.source===source)));}} onReload={async()=>{}}/> :
 <ClaimSubmissionsView data={{forms:[],form:{id:formId,title:'商品訂購活動'}, summary:{},productTotals:[{sku:'A',name:'天空之城',quantity:2,customerCount:1}],submissions:rows,pagination:{page,pageSize:2,total:records.length,totalPages:2}}} loading={false} orders={[]} customerPhone='' publicPath='/form/test' isOpen={isOpen} onToggleOpen={async()=>{window.testToggleCalls=(window.testToggleCalls??0)+1; await new Promise(resolve=>setTimeout(resolve,120));setIsOpen(current=>!current);}} onNavigateToSettings={()=>{}} onClearCustomerSearch={async()=>{}} onReload={async next=>setPage(next??page)} onDeleteSubmission={async(id,formId,source)=>{window.testDeleteCalls??=[];window.testDeleteCalls.push({id,formId,source});if(window.testRejectDelete){window.testRejectDelete=false;throw new Error('測試移除失敗');}setRecords(current=>current.filter(record=>!(record.id===id&&record.source===source)));}} onUpdatePaymentStatus={async(id,_formId,status)=>{window.testStatusCall={id,status};setRecords(current=>current.map(record=>record.id===id&&record.source==='claim'?{...record,paymentStatus:status}:record));}} onDownloadSummary={()=>{window.testDownload=true;}} onNavigateToCustomerCheckout={phone=>{window.testCheckoutPhone=phone;}} onRecordPayment={recordPayment}/>}</div>;
}
`;
const token = "00000000-0000-4000-8000-000000000001";
const result = await build({
  write: false,
  bundle: true,
  format: "iife",
  jsx: "automatic",
  alias: { "@": resolve("src") },
  plugins: [
    {
      name: "mock-browser-storage",
      setup(build) {
        build.onResolve({ filter: /utils\/supabase\/client$/ }, () => ({
          path: "mock-storage",
          namespace: "fixture",
        }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export function createClient() { return { storage: { from() { return { upload: async () => ({ error: null }), remove: async () => ({ error: null }) } } } } }",
          loader: "js",
        }));
      },
    },
  ],
  define: { "process.env.NODE_ENV": '"development"' },
  stdin: {
    contents: `import React from 'react'; ${adminFixtureCode} import {createRoot} from 'react-dom/client'; import {PublicBundleMenuView} from './src/components/bundle-claims/PublicBundleMenuView'; import {BundleClaimPanel} from './src/components/bundle-claims/BundleClaimPanel'; import {ClaimFormPanel} from './src/components/claims/ClaimFormPanel'; import {PublicClaimFormView} from './src/components/claims/PublicClaimFormView'; createRoot(document.getElementById('root')).render(['/management','/settlement'].includes(location.pathname) ? <SharedAdminFixture/> : location.pathname === '/search-management' ? <ClaimFormPanel ownerId='00000000-0000-4000-8000-000000000003' inventoryName='測試庫藏' products={[]} orders={[]}/> : location.pathname === '/admin' ? <BundleClaimPanel ownerId='00000000-0000-4000-8000-000000000003' inventoryName='測試庫藏' onOpenAppearance={() => {}}/> : location.pathname.startsWith('/order') ? <PublicClaimFormView form={{...${JSON.stringify(orderForm)}, isOpen: location.pathname !== '/order-closed'}} token='${token}' turnstileSiteKey='test-site-key'/> : <PublicBundleMenuView menu={${JSON.stringify(menu)}} token='${token}' turnstileSiteKey='test-site-key'/>);`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
});
const cssFiles = (await readdir(".next/static/chunks")).filter((file) =>
  file.endsWith(".css"),
);
const css = (
  await Promise.all(
    cssFiles.map((file) => readFile(`.next/static/chunks/${file}`, "utf8")),
  )
).join("\n");
const server = createServer((request, response) => {
  if (request.url === "/app.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(result.outputFiles[0].text);
  } else if (request.url === "/app.css") {
    response.setHeader("Content-Type", "text/css");
    response.end(css);
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    );
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const chromePath =
  process.env.POSTER_CHROME_PATH ??
  (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined);
const browser = await chromium.launch(
  chromePath ? { executablePath: chromePath } : {},
);
try {
  for (const width of [375, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const calls = [];
    let rejectSearch = false;
    let slowSearch = false;
    await page.route("**/api/claim-forms**", async (route) => {
      const url = new URL(route.request().url());
      const query = url.searchParams.get("customerSearch");
      calls.push(query);
      if (slowSearch && query === "james")
        await new Promise((resolve) => setTimeout(resolve, 800));
      if (query && rejectSearch) {
        rejectSearch = false;
        return route.fulfill({
          status: 500,
          json: { success: false, error: "測試搜尋失敗" },
        });
      }
      const records = adminSubmissions.filter(
        (record) =>
          !query ||
          [record.nickname, record.phone, record.confirmationCode].some(
            (value) => value.toLowerCase().includes(query.toLowerCase()),
          ),
      );
      const form = {
        id: 11,
        title: "十月天空之城與神隱少女現貨預購商品訂購活動超長標題測試",
        publicToken: "test",
        description: "",
        isOpen: true,
        products: [],
      };
      return route.fulfill({
        json: {
          success: true,
          data: {
            forms: [form],
            form,
            summary: {
              submissionCount: records.length,
              customerCount: records.length,
              itemCount: 0,
              estimatedTotal: 0,
            },
            productTotals: [],
            submissions: records,
            pagination: {
              page: 1,
              pageSize: 50,
              total: records.length,
              totalPages: 1,
            },
          },
        },
      });
    });
    await page.addInitScript(() => {
      window.confirm = () => false;
    });
    await page.goto(origin + "/search-management");
    const search = page.getByRole("searchbox", {
      name: "搜尋顧客暱稱、電話或確認編號",
    });
    await search.waitFor();
    assert.equal(await page.locator("#claim-customer-search-slot").count(), 0);
    const searchRegion = page.getByRole("region", { name: "訂購搜尋" });
    assert.equal(await searchRegion.getByRole("searchbox").count(), 1);
    const searchBox = await searchRegion.boundingBox();
    const listBox = await page
      .getByRole("region", { name: "訂購顧客清單" })
      .boundingBox();
    assert.ok(searchBox && listBox && searchBox.y < listBox.y);
    await search.fill("Irene");
    await page.getByRole("heading", { name: "Irene 的訂購與訂單" }).waitFor();
    assert.equal(calls.at(-1), "Irene");
    assert.equal(
      await page
        .getByRole("button", { name: "查看 james 的明細", exact: true })
        .count(),
      0,
    );
    await search.fill("0933");
    await page.getByRole("button", { name: "查詢", exact: true }).click();
    await page.getByRole("heading", { name: "0933 的訂購與訂單" }).waitFor();
    assert.equal(calls.at(-1), "0933");
    await search.fill(" HD-BUNDLE-1 ");
    await search.press("Enter");
    await page
      .getByRole("heading", { name: "HD-BUNDLE-1 的訂購與訂單" })
      .waitFor();
    assert.equal(calls.at(-1), "HD-BUNDLE-1");
    rejectSearch = true;
    await search.fill("james");
    await search.press("Enter");
    await page
      .getByText("顧客紀錄查詢失敗，請稍後再試。", { exact: true })
      .waitFor();
    assert.equal(await search.inputValue(), "james");
    await search.press("Enter");
    await page.getByRole("heading", { name: "james 的訂購與訂單" }).waitFor();
    await page.getByRole("button", { name: "清除顧客搜尋" }).click();
    await page
      .getByRole("button", { name: "查看 Irene 的明細", exact: true })
      .waitFor();
    assert.equal(calls.at(-1), null);
    assert.equal(await search.inputValue(), "");
    slowSearch = true;
    const pending = page.waitForRequest(
      (request) =>
        new URL(request.url()).searchParams.get("customerSearch") === "james",
    );
    await search.fill("james");
    await pending;
    assert.equal(await search.isEnabled(), true);
    await search.fill("Yoyo");
    await page.getByRole("heading", { name: "Yoyo 的訂購與訂單" }).waitFor();
    await page.waitForTimeout(850);
    assert.equal(
      await page
        .getByRole("heading", { name: "Yoyo 的訂購與訂單" })
        .isVisible(),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "查看 james 的明細", exact: true })
        .count(),
      0,
    );
    slowSearch = false;
    await page.screenshot({
      path: `/tmp/poster-inline-order-search-${width}.png`,
      fullPage: true,
    });
    await search.fill("不存在的客人");
    await search.press("Enter");
    await page
      .getByRole("heading", { name: "不存在的客人 的訂購與訂單" })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: /查看 .* 的明細/ }).count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    for (const label of ["新增 IP 訂購", "移除 IP"]) {
      const button = page.getByRole("button", { name: label, exact: true });
      const box = await button.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width);
    }
    await page.getByRole("button", { name: "移除 IP", exact: true }).click();
    await page
      .getByRole("button", { name: "新增 IP 訂購", exact: true })
      .click();
    await page
      .getByRole("button", { name: "取消新增", exact: true })
      .first()
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page
      .getByRole("button", { name: "取消新增", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "新增 IP 訂購", exact: true })
      .waitFor();
    await page.screenshot({
      path: `/tmp/poster-management-header-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.close();
    console.log(
      `PASS ordering search ${width}px: inline automatic nickname/partial phone/code, Enter/button, error retry, clear, rapid typing/stale response and empty results`,
    );
  }
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.confirm = (message) => {
        window.testConfirmations ??= [];
        window.testConfirmations.push(message);
        return window.testAcceptConfirmation ?? true;
      };
    });
    await page.goto(origin + "/management");
    const availability = page.getByRole("switch", { name: "接收訂購" });
    await page.evaluate(() => {
      window.testAcceptConfirmation = false;
    });
    await availability.click();
    assert.equal(await availability.getAttribute("aria-checked"), "true");
    assert.equal(await page.evaluate(() => window.testToggleCalls ?? 0), 0);
    await page.evaluate(() => {
      window.testAcceptConfirmation = true;
    });
    await availability.click();
    await page
      .getByRole("switch", { name: "接收訂購", checked: false })
      .waitFor();
    const confirmationCount = await page.evaluate(
      () => window.testConfirmations.length,
    );
    await availability.click();
    await page
      .getByRole("switch", { name: "接收訂購", checked: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.testConfirmations.length),
      confirmationCount,
    );

    const detail = page.getByRole("region", { name: "訂購明細", exact: true });
    await detail.getByText("天空之城", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "各商品訂購合計" }).count(),
      0,
    );
    assert.equal(
      await detail.getByText("HD-CLAIM-1", { exact: false }).isVisible(),
      false,
    );
    await page
      .getByRole("button", { name: "查看 Irene 的明細", exact: true })
      .click();
    await detail.getByText("龍貓配單", { exact: true }).waitFor();
    assert.equal(
      await detail.getByText("天空之城", { exact: true }).count(),
      0,
    );
    await detail.getByRole("button", { name: "登記匯款", exact: true }).click();
    const editor = detail.getByRole("form", { name: "匯款紀錄表單" });
    assert.equal(
      await editor
        .getByRole("spinbutton", { name: "匯款金額" })
        .getAttribute("readonly"),
      "",
    );
    assert.equal(
      await editor.getByRole("spinbutton", { name: "匯款金額" }).inputValue(),
      "1399",
    );
    assert.equal(
      await editor.getByRole("button", { name: "剩餘一半" }).count(),
      0,
    );
    await page
      .getByRole("button", { name: "查看 james 的明細", exact: true })
      .click();
    assert.equal(await editor.count(), 0);
    await detail.getByRole("button", { name: "登記匯款", exact: true }).click();
    assert.equal(
      await editor
        .getByRole("spinbutton", { name: "匯款金額" })
        .getAttribute("readonly"),
      null,
    );
    await editor.getByRole("spinbutton", { name: "匯款金額" }).fill("1001");
    await editor
      .getByRole("button", { name: "儲存匯款紀錄", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => window.testPaymentCalls?.length ?? 0),
      0,
    );
    await editor.getByRole("spinbutton", { name: "匯款金額" }).fill("250");
    await editor.getByRole("textbox", { name: "匯款帳號末五碼" }).fill("12345");
    await editor.getByRole("textbox", { name: "備註" }).fill("先付部分");
    await page.evaluate(() => {
      window.testRejectPayment = true;
    });
    await editor
      .getByRole("button", { name: "儲存匯款紀錄", exact: true })
      .click();
    await detail
      .getByRole("alert")
      .filter({ hasText: "測試匯款儲存失敗" })
      .waitFor();
    assert.equal(
      await editor.getByRole("spinbutton", { name: "匯款金額" }).inputValue(),
      "250",
    );
    assert.equal(
      await editor.getByRole("textbox", { name: "備註" }).inputValue(),
      "先付部分",
    );
    await editor
      .getByRole("button", { name: "儲存匯款紀錄", exact: true })
      .click();
    await detail
      .getByRole("status")
      .filter({ hasText: "匯款紀錄已儲存" })
      .waitFor();
    assert.deepEqual(
      await page.evaluate(() => window.testPaymentCalls[0]),
      await page.evaluate(() => window.testPaymentCalls[1]),
    );
    assert.equal(
      await page.evaluate(() => window.testPaymentCalls[1].source),
      "claim",
    );
    assert.match(
      await detail.getByRole("region", { name: "付款操作" }).innerText(),
      /已付 \$250 · 待付 \$750/,
    );
    assert.equal(
      await detail
        .getByRole("button", { name: "已付全額", exact: true })
        .count(),
      0,
    );
    await detail.getByRole("button", { name: "跨表單對帳" }).click();
    assert.equal(
      await page.evaluate(() => window.testCheckoutPhone),
      "0912345678",
    );
    await detail.getByRole("button", { name: "登記匯款", exact: true }).click();
    await page.getByRole("button", { name: "測試切換活動" }).click();
    assert.equal(await editor.count(), 0);
    await page.getByRole("button", { name: "下一頁" }).click();
    await detail.getByText("神隱少女", { exact: true }).waitFor();
    assert.equal(
      await detail.getByText("天空之城", { exact: true }).count(),
      0,
    );
    await detail.getByRole("button", { name: "已付一半", exact: true }).click();
    await page.waitForFunction(() => window.testStatusCall?.id === 2);
    await page.evaluate(() => {
      window.testAcceptConfirmation = false;
    });
    await detail.getByRole("button", { name: "移除 Yoyo 的訂購明細" }).click();
    assert.equal(
      await page.evaluate(() => window.testDeleteCalls?.length ?? 0),
      0,
    );
    const confirmation = await page.evaluate(() =>
      window.testConfirmations.at(-1),
    );
    assert.match(confirmation, /Yoyo/);
    assert.match(confirmation, /HD-CLAIM-2/);
    assert.match(confirmation, /\$450/);
    assert.match(confirmation, /無法復原/);
    await page.evaluate(() => {
      window.testAcceptConfirmation = true;
      window.testRejectDelete = true;
    });
    await detail.getByRole("button", { name: "移除 Yoyo 的訂購明細" }).click();
    await detail
      .getByRole("alert")
      .filter({ hasText: "測試移除失敗" })
      .waitFor();
    assert.equal(
      await detail.getByText("神隱少女", { exact: true }).count(),
      1,
    );
    await detail.getByRole("button", { name: "移除 Yoyo 的訂購明細" }).click();
    await detail.getByText("天空之城", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "採購統計" }).click();
    await page.getByRole("heading", { name: "各商品訂購合計" }).waitFor();
    await page.getByRole("button", { name: "下載採購 CSV" }).click();
    assert.equal(await page.evaluate(() => window.testDownload), true);
    await page.getByRole("tab", { name: "顧客清單" }).click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `/tmp/poster-order-management-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      await detail
        .getByRole("button", { name: "移除 james 的訂購明細" })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("button", { name: "查看 Irene 的明細", exact: true })
      .click();
    await page.getByRole("button", { name: "測試入庫核對" }).click();
    assert.equal(
      await detail
        .getByRole("button", { name: "移除 Irene 的配單" })
        .isDisabled(),
      true,
    );
    await detail
      .getByText("請先至配單管理撤銷入出庫核對，再移除。", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "測試入庫核對" }).click();
    await detail.getByRole("button", { name: "移除 Irene 的配單" }).click();
    await detail.getByText("天空之城", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => window.testDeleteCalls.at(-1).source),
      "bundle",
    );
    assert.deepEqual(errors, []);
    await page.goto(origin + "/settlement");
    await page
      .getByRole("button", { name: "登記匯款", exact: true })
      .first()
      .click();
    const settlementEditor = page.getByRole("form", { name: "匯款紀錄表單" });
    await settlementEditor
      .getByRole("button", { name: "剩餘一半", exact: true })
      .click();
    assert.equal(
      await settlementEditor
        .getByRole("spinbutton", { name: "匯款金額" })
        .inputValue(),
      "500",
    );
    await settlementEditor
      .getByRole("button", { name: "關閉匯款紀錄表單", exact: true })
      .click();
    await page
      .getByRole("button", { name: "登記匯款", exact: true })
      .nth(1)
      .click();
    assert.equal(
      await settlementEditor
        .getByRole("spinbutton", { name: "匯款金額" })
        .getAttribute("readonly"),
      "",
    );
    assert.equal(
      await settlementEditor
        .getByRole("button", { name: "剩餘一半", exact: true })
        .count(),
      0,
    );
    await settlementEditor
      .getByRole("button", { name: "儲存匯款紀錄", exact: true })
      .click();
    await page.waitForFunction(() => window.testPaymentCalls?.length === 1);
    assert.equal(
      await page.evaluate(() => window.testPaymentCalls[0].source),
      "bundle",
    );
    assert.equal(
      await page.evaluate(() => window.testPaymentCalls[0].amount),
      1399,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    await page.goto(origin + "/settlement");
    await page.getByRole("button", { name: "移除 Irene 的配單" }).click();
    await page.waitForFunction(() => window.testDeleteCalls?.length === 1);
    assert.equal(
      await page.evaluate(() => window.testDeleteCalls[0].source),
      "bundle",
    );
    console.log(
      `PASS shared management ${width}px: source-safe selection, procurement tab, partial/full payment, retry, activity/page reconciliation, deletion, settlement editor`,
    );
    await page.close();
  }
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    const submissions = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.confirm = (message) => {
        window.testConfirmations ??= [];
        window.testConfirmations.push(message);
        return window.testAcceptConfirmation ?? true;
      };
      window.turnstile = {
        render: (_element, options) => {
          window.testTurnstileOptions = options;
          queueMicrotask(() => options.callback("test-challenge"));
          return "fixture-widget";
        },
        remove: () => {},
        reset: () =>
          queueMicrotask(() =>
            window.testTurnstileOptions.callback("test-challenge"),
          ),
      };
    });
    await page.route("https://challenges.cloudflare.com/**", (route) =>
      route.fulfill({ contentType: "application/javascript", body: "" }),
    );
    await page.route("**/api/public/claim-forms/**", async (route) => {
      submissions.push(route.request().postDataJSON());
      if (submissions.length === 1)
        return route.fulfill({
          status: 503,
          json: { success: false, error: "測試重試：暫時無法送出" },
        });
      return route.fulfill({
        status: 201,
        json: {
          success: true,
          data: {
            confirmationCode: "HD-ORDER-TEST",
            submittedAt: "2026-10-07T00:00:00Z",
          },
        },
      });
    });
    await page.goto(`${origin}/order`);
    await page.getByRole("heading", { name: "確認聯絡資料" }).waitFor();
    const submit = page.getByRole("button", { name: "確認訂購", exact: true });
    assert.equal(await submit.isDisabled(), true);
    assert.equal(
      await page.getByText("已停止訂購", { exact: true }).count(),
      1,
    );
    await page.getByRole("spinbutton", { name: "天空之城數量" }).fill("99");
    assert.equal(
      await page.getByRole("spinbutton", { name: "天空之城數量" }).inputValue(),
      "2",
    );
    assert.equal(
      await page.getByRole("button", { name: "增加天空之城數量" }).isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "減少天空之城數量" }).click();
    await page.getByRole("button", { name: "增加龍貓數量" }).click();
    assert.match(
      await page.getByRole("region", { name: "訂購總額" }).innerText(),
      /共 2 件[\s\S]*\$949/,
    );
    await page.getByRole("textbox", { name: "群組暱稱" }).fill("james");
    await page.getByRole("textbox", { name: "手機號碼" }).fill("0812345678");
    await page.getByRole("textbox", { name: "備註" }).fill("請協助核對");
    await page.getByRole("checkbox").check();
    await submit.click();
    assert.equal(submissions.length, 0);
    await page.getByRole("textbox", { name: "手機號碼" }).fill("0912345678");
    const products = await page
      .getByRole("region", { name: "商品與訂購總額" })
      .boundingBox();
    const contacts = await page
      .getByRole("region", { name: "訂購聯絡資料" })
      .boundingBox();
    assert.equal(
      width >= 1024
        ? contacts.x > products.x + products.width
        : contacts.y >= products.y + products.height,
      true,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `/tmp/poster-order-${width}.png`,
      fullPage: true,
    });
    await submit.click();
    await page.getByText("測試重試：暫時無法送出", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("textbox", { name: "群組暱稱" }).inputValue(),
      "james",
    );
    assert.equal(
      await page.getByRole("textbox", { name: "手機號碼" }).inputValue(),
      "0912345678",
    );
    assert.equal(
      await page.getByRole("textbox", { name: "備註" }).inputValue(),
      "請協助核對",
    );
    await submit.click();
    await page.getByText("HD-ORDER-TEST", { exact: true }).waitFor();
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[0], submissions[1]);
    assert.deepEqual(submissions[1].items, [
      { productId: "product-a", quantity: 1 },
      { productId: "product-b", quantity: 1 },
    ]);
    assert.equal("totalAmount" in submissions[1], false);
    assert.equal(
      await page.getByRole("heading", { name: "確認聯絡資料" }).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("heading", { name: "十月商品訂購", exact: true })
        .count(),
      0,
    );
    assert.equal(await page.getByRole("spinbutton").count(), 0);
    await page.goto(`${origin}/order-closed`);
    await page.getByText("這次訂購已經截止", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox").count(), 0);
    for (const control of await page.getByRole("spinbutton").all())
      assert.equal(await control.isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log(
      `PASS ordering ${width}px: same-page contact, limits, totals, phone validation, retained retry/idempotency and independent receipt`,
    );
    await page.close();
  }
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const workingMenu = structuredClone(menu);
    let submitted;
    let conflict = false;
    await page.addInitScript(() => {
      window.confirm = (message) => {
        window.testConfirmations ??= [];
        window.testConfirmations.push(message);
        return window.testAcceptConfirmation ?? true;
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            window.testCopiedText = value;
          },
        },
      });
      window.turnstile = {
        render: (_element, options) => {
          window.testTurnstileOptions = options;
          queueMicrotask(() => options.callback("test-challenge"));
          return "fixture-widget";
        },
        remove: () => {},
        reset: () => {
          queueMicrotask(() =>
            window.testTurnstileOptions.callback("test-challenge"),
          );
        },
      };
    });
    await page.route("https://challenges.cloudflare.com/**", (route) =>
      route.fulfill({ contentType: "application/javascript", body: "" }),
    );
    await page.route("**/api/public/bundle-menus/**", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: { success: true, data: workingMenu } });
      submitted = route.request().postDataJSON();
      workingMenu.options.find(
        (option) => option.id === submitted.orderId,
      ).state = "confirmed";
      if (conflict)
        return route.fulfill({
          status: 409,
          json: {
            success: false,
            error: "這份大禮包已被確認，請重新選擇或聯絡管理者。",
          },
        });
      const option = workingMenu.options.find(
        (candidate) => candidate.id === submitted.orderId,
      );
      return route.fulfill({
        status: 201,
        json: {
          success: true,
          data: {
            ...menu,
            ...option,
            state: "confirmed",
            confirmation: {
              confirmationCode: "HD-TEST",
              submittedAt: "2026-10-06T00:00:00Z",
            },
          },
        },
      });
    });
    await page.goto(origin);
    await page
      .getByRole("heading", { name: "第一步：選自己的群組暱稱" })
      .waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "確認聯絡資料" }).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("region", { name: "共同選單介紹" })
        .evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return [...element.querySelectorAll("h1,p,span")].every((child) => {
            const rect = child.getBoundingClientRect();
            return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
          });
        }),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Yoyo", exact: true })
        .evaluate((element) => element.disabled),
      true,
    );
    assert.equal(await page.getByRole("combobox").count(), 0);
    await page.getByRole("button", { name: "james", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "james", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("heading", { name: "確認聯絡資料" }).waitFor();
    assert.equal(
      await page.getByRole("textbox", { name: "群組暱稱" }).inputValue(),
      "james",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "確認配單" })
        .evaluate((element) => element.disabled),
      true,
    );
    await page
      .getByRole("heading", { name: "核對商品", exact: true })
      .waitFor();
    for (const name of ["天空之城", "龍貓", "神隱少女"]) {
      assert.equal(await page.getByText(name, { exact: true }).count(), 1);
    }
    assert.equal(await page.getByText("$499", { exact: true }).count(), 1);
    assert.equal(await page.getByText("$450", { exact: true }).count(), 2);
    assert.match(
      await page.locator('[aria-label="配單總額"]').innerText(),
      /james[\s\S]*共 3 件[\s\S]*\$1,399/,
    );
    assert.equal(
      await page.getByText("查看所有人的大禮包內容", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("heading", { name: "10月第一批大禮包", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page
        .getByRole("list", { name: "配單流程" })
        .getByRole("listitem")
        .count(),
      3,
    );
    const gold = await page
      .locator('strong[class*="text-[21px]"]')
      .evaluate((element) => getComputedStyle(element).color);
    assert.equal(gold, "rgb(214, 168, 75)");
    await page.waitForFunction(() => {
      const button = document.querySelector('button[data-bundle-order-id="1"]');
      return (
        button &&
        getComputedStyle(button).backgroundColor === "rgb(21, 52, 76)" &&
        getComputedStyle(button).color === "rgb(255, 255, 255)"
      );
    });
    await page.screenshot({
      path: `/tmp/poster-bundle-menu-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("textbox", { name: "手機號碼" }).fill("0912345678");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Irene", exact: true }).click();
    assert.equal(
      await page.getByRole("textbox", { name: "群組暱稱" }).inputValue(),
      "Irene",
    );
    assert.equal(
      await page.getByRole("textbox", { name: "手機號碼" }).inputValue(),
      "",
    );
    assert.equal(await page.getByRole("checkbox").isChecked(), false);
    await page.getByRole("button", { name: "james", exact: true }).click();
    await page.getByRole("textbox", { name: "手機號碼" }).fill("0912345678");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "確認配單" }).click();
    await page.getByText("HD-TEST", { exact: true }).waitFor();
    assert.equal(submitted.orderId, 1);
    assert.equal(submitted.phone, "0912345678");
    assert.equal("totalAmount" in submitted, false);
    const contactMessage =
      "您好，我已完成「james 專屬大禮包」配單確認，確認編號：HD-TEST，請協助核對，謝謝。";
    assert.equal(
      await page
        .getByRole("link", { name: "前往官方 LINE 查看明細與結帳" })
        .getAttribute("href"),
      "https://line.me/R/oaMessage/%40testbundle/?" +
        encodeURIComponent(contactMessage),
    );
    const qr = page.getByRole("img", { name: "LINE 聯絡 QR Code" });
    await qr.waitFor();
    assert.equal((await qr.locator("path").count()) > 0, true);
    await page
      .getByRole("button", { name: "複製核對訊息", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => window.testCopiedText),
      contactMessage,
    );
    await page.getByText("核對訊息已複製", { exact: true }).waitFor();
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error("Clipboard blocked");
      };
      window.prompt = (_label, value) => {
        window.testFallbackCopy = value;
        return null;
      };
    });
    await page
      .getByRole("button", { name: "複製核對訊息", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => window.testFallbackCopy),
      contactMessage,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `/tmp/poster-bundle-receipt-${width}.png`,
      fullPage: true,
    });

    assert.equal(await page.locator('[aria-label="共同選單介紹"]').count(), 0);
    assert.equal(
      await page
        .getByRole("heading", { name: "第一步：選自己的群組暱稱", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByRole("group", { name: "姓名選項" }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "返回共同選單" }).count(),
      0,
    );
    await page.reload();
    await page.getByRole("group", { name: "姓名選項" }).waitFor();
    await page.getByRole("button", { name: "更新選單", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('button[data-bundle-order-id="1"]')?.disabled ===
        true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "james", exact: true })
        .evaluate((element) => element.disabled),
      true,
    );
    await page.getByRole("button", { name: "Irene", exact: true }).click();
    conflict = true;
    await page.getByRole("textbox", { name: "手機號碼" }).fill("0912345678");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "確認配單" }).click();
    await page.waitForFunction(() => {
      const button = document.querySelector('button[data-bundle-order-id="2"]');
      return button?.disabled === true && button.textContent.includes("已確認");
    });
    assert.equal(
      await page.getByRole("heading", { name: "確認聯絡資料" }).count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${width}px: selection, prefill/reset, consent, gold, submission, receipt, confirmed disabling, stale conflict, no overflow`,
    );
    await page.close();
  }
  for (const width of [375, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.addInitScript(() => {
      window.confirm = (message) => {
        window.testConfirmations ??= [];
        window.testConfirmations.push(message);
        return window.testAcceptConfirmation ?? true;
      };
    });
    const ownerId = "00000000-0000-4000-8000-000000000003";
    const campaigns = [
      {
        id: 11,
        ownerId,
        title: "第一批",
        description: "第一批说明",
        publicToken: token,
        enabled: true,
        orderCount: 1,
      },
      {
        id: 12,
        ownerId,
        title: "第二批",
        description: "",
        publicToken: "00000000-0000-4000-8000-000000000002",
        enabled: false,
        orderCount: 1,
      },
    ];
    const orders = [
      {
        ...structuredClone(menu.options[0]),
        ownerId,
        publicToken: token,
        confirmationCode: "HD-DRAFT",
        status: "draft",
        campaignId: 11,
        createdAt: "2026-10-06T00:00:00Z",
        updatedAt: "2026-10-06T00:00:00Z",
      },
      {
        ...structuredClone(menu.options[1]),
        ownerId,
        publicToken: token,
        confirmationCode: "HD-OTHER",
        status: "draft",
        campaignId: 12,
        createdAt: "2026-10-06T00:00:00Z",
        updatedAt: "2026-10-06T00:00:00Z",
      },
    ];
    const writes = [];
    let rejectSave = true;
    let rejectProducts = true;
    let rejectPayment = true;
    let rejectDelete = true;
    let rejectAvailability = true;
    await page.route("**/api/bundle-campaigns**", (route) => {
      const method = route.request().method();
      if (method === "GET")
        return route.fulfill({
          json: {
            success: true,
            data: {
              campaigns: campaigns.map((campaign) => ({
                ...campaign,
                orderCount: orders.filter(
                  (order) => order.campaignId === campaign.id,
                ).length,
              })),
            },
          },
        });
      const input = route.request().postDataJSON();
      if (
        input.enabled !== undefined &&
        method !== "POST" &&
        rejectAvailability
      ) {
        rejectAvailability = false;
        return route.fulfill({
          status: 500,
          json: { success: false, error: "測試活動開關儲存失敗" },
        });
      }
      let campaign;
      if (method === "POST") {
        campaign = {
          ...input,
          id: 13,
          publicToken: "00000000-0000-4000-8000-000000000013",
          orderCount: 0,
        };
        campaigns.push(campaign);
      } else {
        campaign = campaigns.find((item) => item.id === input.id);
        Object.assign(campaign, input);
      }
      return route.fulfill({
        json: {
          success: true,
          data: { campaign: { ...campaign, orderCount: undefined } },
        },
      });
    });
    await page.route("**/api/bundle-claims**", (route) => {
      const method = route.request().method();
      const url = new URL(route.request().url());
      if (method === "GET") {
        const id = url.searchParams.get("campaignId");
        const result = orders.filter(
          (order) => !id || order.campaignId === Number(id),
        );
        return route.fulfill({
          json: {
            success: true,
            data: { orders: result, total: result.length },
          },
        });
      }
      const input = route.request().postDataJSON();
      writes.push({ method, input });
      if (method === "DELETE" && !url.pathname.endsWith("/images")) {
        if (rejectDelete) {
          rejectDelete = false;
          return route.fulfill({
            status: 409,
            json: { success: false, error: "測試配單移除失敗" },
          });
        }
        const index = orders.findIndex((order) => order.id === input.orderId);
        orders.splice(index, 1);
        return route.fulfill({
          json: {
            success: true,
            data: { deleted: true, orderId: input.orderId },
          },
        });
      }
      if (url.pathname.endsWith("/images")) {
        const order = orders.find(
          (order) => order.id === Number(url.pathname.split("/").at(-2)),
        );
        const uploaded = {
          ...image,
          id: 3,
          productName: undefined,
          productAmount: undefined,
          originalFilename: input.originalFilename,
        };
        order.images.push(uploaded);
        return route.fulfill({
          status: 201,
          json: { success: true, data: uploaded },
        });
      }
      if (method === "PUT") {
        if (rejectSave) {
          rejectSave = false;
          return route.fulfill({
            status: 400,
            json: { success: false, error: "測試草稿儲存失敗" },
          });
        }
        Object.assign(
          orders.find((order) => order.id === input.orderId),
          input,
        );
      } else if (method === "POST") {
        orders.push({
          ...input,
          id: 3,
          status: "draft",
          publicToken: token,
          confirmationCode: "HD-NEW",
          images: [],
          createdAt: "2026-10-06T00:00:00Z",
          updatedAt: "2026-10-06T00:00:00Z",
        });
        return route.fulfill({
          status: 201,
          json: { success: true, data: { orderId: 3, publicToken: token } },
        });
      } else if (input.action === "set_products") {
        if (input.orderId === 3 && rejectProducts) {
          rejectProducts = false;
          return route.fulfill({
            status: 400,
            json: { success: false, error: "測試品項儲存失敗" },
          });
        }
        const order = orders.find((order) => order.id === input.orderId);
        for (const product of input.products)
          Object.assign(
            order.images.find((image) => image.id === product.id),
            { productName: product.name.trim(), productAmount: product.amount },
          );
        order.totalAmount =
          input.products.reduce(
            (sum, product) => sum + Math.round(product.amount * 100),
            0,
          ) / 100;
      } else if (input.action === "open")
        orders.find((order) => order.id === input.orderId).status = "open";
      if (input.action === "record_payment") {
        if (rejectPayment) {
          rejectPayment = false;
          return route.fulfill({
            status: 503,
            json: { success: false, error: "測試配單匯款失敗" },
          });
        }
        orders.find((order) => order.id === input.orderId).payment = {
          id: 1,
          amount: orders.find((order) => order.id === input.orderId)
            .totalAmount,
          transferredAt: input.transferredAt,
          payerAccountLastFive: input.payerAccountLastFive,
          note: input.note,
        };
      }
      if (input.action === "reverse_payment")
        orders.find((order) => order.id === input.orderId).payment = undefined;
      if (input.action === "set_receiving") {
        const order = orders.find((order) => order.id === input.orderId);
        order.receivingCheckedAt = input.checked
          ? "2026-10-07T00:00:00Z"
          : undefined;
        if (!input.checked) order.outboundCheckedAt = undefined;
      }
      if (input.action === "set_outbound")
        orders.find((order) => order.id === input.orderId).outboundCheckedAt =
          input.checked ? "2026-10-07T00:00:00Z" : undefined;
      return route.fulfill({
        json: {
          success: true,
          data: { orderId: input.orderId ?? 1, updated: true },
        },
      });
    });
    await page.goto(origin + "/admin");
    const selector = page.getByRole("combobox", {
      name: "配單活動",
      exact: true,
    });
    await page.getByRole("heading", { name: "第一批", exact: true }).waitFor();
    assert.equal(await selector.inputValue(), "11");
    await page.screenshot({
      path: `/tmp/poster-bundle-layout-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      await page
        .getByRole("link", { name: "預覽活動選單" })
        .getAttribute("href"),
      `/bundles/${token}`,
    );
    await page.getByRole("button", { name: "編輯草稿", exact: true }).click();
    assert.equal(
      await page.getByRole("textbox", { name: /品項名稱/ }).count(),
      0,
    );
    const nickname = page.getByRole("textbox", { name: /顧客群組暱稱/ });
    assert.equal(await nickname.getAttribute("required"), "");
    await nickname.fill("james");
    const total = page.getByRole("spinbutton", { name: /加總金額/ });
    assert.equal(await total.getAttribute("readonly"), "");
    await page
      .getByRole("textbox", { name: "商品名稱 1", exact: true })
      .fill("天空之城");
    await page.getByRole("spinbutton", { name: /商品金額 1/ }).fill("0.10");
    await page.getByRole("spinbutton", { name: /商品金額 2/ }).fill("0.20");
    await page.getByRole("spinbutton", { name: /商品金額 3/ }).fill("0.30");
    assert.equal(await total.inputValue(), "0.6");
    await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await page.getByText("測試草稿儲存失敗", { exact: true }).waitFor();
    assert.equal(await nickname.inputValue(), "james");
    assert.equal(await total.inputValue(), "0.6");
    await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await page.getByText("草稿已儲存。", { exact: true }).waitFor();
    assert.equal(orders[0].totalAmount, 0.6);
    assert.equal(orders[0].title, "第一批");
    assert.equal(orders[0].customerHint, "james");
    assert.equal(
      writes.findLast((write) => write.method === "PUT").input.campaignId,
      11,
    );
    await selector.selectOption("12");
    await page.getByRole("heading", { name: "第二批", exact: true }).waitFor();
    await page.getByRole("button", { name: "編輯草稿", exact: true }).click();
    assert.equal(
      await page.getByRole("textbox", { name: /品項名稱/ }).count(),
      0,
    );
    await selector.selectOption("11");
    await page.getByRole("heading", { name: "第一批", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "儲存草稿", exact: true }).count(),
      0,
    );
    await page
      .getByRole("button", { name: "建立新配單活動", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: /活動名稱/ }).fill("第三批");
    await dialog
      .getByRole("textbox", { name: /活動說明/ })
      .fill("第三批注意事項");
    await dialog.getByRole("button", { name: "建立活動", exact: true }).click();
    await page.getByRole("heading", { name: "第三批", exact: true }).waitFor();
    assert.equal(await selector.inputValue(), "13");
    assert.equal(campaigns.at(-1).enabled, false);
    await page
      .getByRole("button", { name: "新增姓名選項", exact: true })
      .click();
    assert.equal(await total.inputValue(), "0");
    await nickname.fill("Irene");
    await page.locator('input[type="file"]').setInputFiles({
      name: "商品.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page
      .getByRole("textbox", { name: "商品名稱 1", exact: true })
      .fill("第三批海報");
    await page.getByRole("spinbutton", { name: /商品金額 1/ }).fill("1888.25");
    assert.equal(await total.inputValue(), "1888.25");
    await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await page.getByText("測試品項儲存失敗", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("textbox", { name: "商品名稱 1", exact: true })
        .inputValue(),
      "第三批海報",
    );
    assert.equal(await total.inputValue(), "1888.25");
    assert.equal(
      await page
        .getByRole("button", { name: "開放這份配單", exact: true })
        .isEnabled(),
      false,
    );
    await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await page.getByText("草稿已儲存。", { exact: true }).waitFor();
    assert.equal(
      writes.filter(
        (write) =>
          write.method === "POST" &&
          write.input.originalFilename === "商品.png",
      ).length,
      1,
    );
    assert.equal(orders.at(-1).images[0].productName, "第三批海報");
    assert.equal(orders.at(-1).campaignId, 13);
    assert.equal(orders.at(-1).title, "第三批");
    assert.equal(orders.at(-1).customerHint, "Irene");
    assert.equal(orders.at(-1).totalAmount, 1888.25);
    await page.waitForFunction(() =>
      document
        .querySelector('select option[value="13"]')
        ?.textContent.includes("1 份"),
    );
    assert.equal(
      writes.some((write) => write.input.action === "set_products"),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "開放這份配單", exact: true })
        .isEnabled(),
      true,
    );
    await page
      .getByRole("button", { name: "開放這份配單", exact: true })
      .click();
    await page
      .getByRole("switch", { name: "公開配單選單", checked: false })
      .click();
    await page
      .getByRole("alert")
      .getByText("測試活動開關儲存失敗", { exact: true })
      .waitFor();
    assert.equal(campaigns.at(-1).enabled, false);
    assert.equal(
      await page
        .getByRole("switch", { name: "公開配單選單" })
        .getAttribute("aria-checked"),
      "false",
    );
    await page
      .getByRole("switch", { name: "公開配單選單", checked: false })
      .click();
    await page
      .getByRole("switch", { name: "公開配單選單", checked: true })
      .waitFor();
    assert.equal(campaigns.at(-1).enabled, true);
    assert.equal(
      await page
        .getByRole("link", { name: "預覽活動選單" })
        .getAttribute("href"),
      "/bundles/00000000-0000-4000-8000-000000000013",
    );
    await page.getByRole("button", { name: "編輯活動", exact: true }).click();
    await dialog.getByRole("textbox", { name: /活動名稱/ }).fill("第三批更新");
    await dialog.getByRole("button", { name: "儲存修改", exact: true }).click();
    await page
      .getByRole("heading", { name: "第三批更新", exact: true })
      .waitFor();
    await page
      .getByRole("switch", { name: "公開配單選單", checked: true })
      .click();
    await page
      .getByRole("switch", { name: "公開配單選單", checked: false })
      .waitFor();
    assert.equal(campaigns.at(-1).enabled, false);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `/tmp/poster-bundle-admin-${width}.png`,
      fullPage: true,
    });
    const confirmed = orders.find((order) => order.id === 3);
    Object.assign(confirmed, {
      status: "confirmed",
      customerNickname: "Irene",
      customerPhone: "0912345678",
      confirmedAt: "2026-10-07T00:00:00Z",
    });
    await page.getByRole("button", { name: "重新整理", exact: true }).click();
    await page
      .getByRole("button", { name: "登記全額付款", exact: true })
      .waitFor();
    const checks = page.getByRole("region", { name: "入出庫核對" });
    assert.equal(
      await checks
        .getByRole("button", { name: "完成核對", exact: true })
        .nth(1)
        .isDisabled(),
      true,
    );
    await page
      .getByRole("button", { name: "登記全額付款", exact: true })
      .click();
    const editor = page.getByRole("form", { name: "匯款紀錄表單" });
    assert.equal(
      await editor.getByRole("spinbutton", { name: "匯款金額" }).inputValue(),
      "1888.25",
    );
    assert.equal(
      await editor
        .getByRole("spinbutton", { name: "匯款金額" })
        .getAttribute("readonly"),
      "",
    );
    await editor.getByRole("textbox", { name: "匯款帳號末五碼" }).fill("54321");
    await editor.getByRole("textbox", { name: "備註" }).fill("全額已核對");
    await editor
      .getByRole("button", { name: "儲存匯款紀錄", exact: true })
      .click();
    await page.getByText("測試配單匯款失敗", { exact: true }).waitFor();
    assert.equal(
      await editor.getByRole("textbox", { name: "備註" }).inputValue(),
      "全額已核對",
    );
    await editor
      .getByRole("button", { name: "儲存匯款紀錄", exact: true })
      .click();
    await page.getByText("已登記全額付款。", { exact: true }).waitFor();
    assert.equal(await editor.count(), 0);
    const paymentCall = writes.findLast(
      (write) => write.input.action === "record_payment",
    ).input;
    assert.equal(paymentCall.orderId, 3);
    assert.equal(paymentCall.payerAccountLastFive, "54321");
    assert.equal(paymentCall.note, "全額已核對");
    assert.equal("amount" in paymentCall, false);
    await checks
      .getByRole("button", { name: "完成核對", exact: true })
      .first()
      .click();
    await page.getByText("已完成入庫核對。", { exact: true }).waitFor();
    await checks.getByRole("button", { name: "完成核對", exact: true }).click();
    await page.getByText("已完成出貨核對。", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "移除 Irene 的配單" })
        .isDisabled(),
      true,
    );
    assert.ok(confirmed.receivingCheckedAt);
    assert.ok(confirmed.outboundCheckedAt);
    await page.screenshot({
      path: `/tmp/poster-bundle-management-${width}.png`,
      fullPage: true,
    });
    await checks
      .getByRole("button", { name: "撤銷", exact: true })
      .first()
      .click();
    await page
      .getByText("已撤銷入庫核對，出貨核對也已清除。", { exact: true })
      .waitFor();
    assert.equal(confirmed.receivingCheckedAt, undefined);
    assert.equal(confirmed.outboundCheckedAt, undefined);
    assert.equal(
      await checks
        .getByRole("button", { name: "完成核對", exact: true })
        .nth(1)
        .isDisabled(),
      true,
    );
    await page
      .getByRole("region", { name: "付款操作" })
      .getByText("更多操作", { exact: true })
      .click();
    await page.getByRole("button", { name: "撤銷付款", exact: true }).click();
    await page
      .getByRole("button", { name: "登記全額付款", exact: true })
      .waitFor();
    assert.equal(confirmed.payment, undefined);
    await page.evaluate(() => {
      window.testAcceptConfirmation = false;
    });
    await page.getByRole("button", { name: "移除 Irene 的配單" }).click();
    assert.equal(writes.filter((write) => write.method === "DELETE").length, 0);
    const removalConfirmation = await page.evaluate(() =>
      window.testConfirmations.at(-1),
    );
    assert.match(removalConfirmation, /Irene/);
    assert.match(removalConfirmation, /HD-NEW/);
    assert.match(removalConfirmation, /1,888.25/);
    await page.evaluate(() => {
      window.testAcceptConfirmation = true;
    });
    await page.getByRole("button", { name: "移除 Irene 的配單" }).click();
    await page.getByText("測試配單移除失敗", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "查看 Irene 的明細" }).count(),
      1,
    );
    await page.getByRole("button", { name: "移除 Irene 的配單" }).click();
    await page.getByText("配單已移除。", { exact: true }).waitFor();
    assert.equal(
      writes.findLast((write) => write.method === "DELETE").input.orderId,
      3,
    );
    assert.equal(
      writes.findLast((write) => write.method === "DELETE").input
        .expectedUpdatedAt,
      confirmed.updatedAt,
    );
    assert.equal(
      orders.some((order) => order.id === 3),
      false,
    );
    orders.push({
      ...structuredClone(confirmed),
      id: 99,
      status: "cancelled",
      customerNickname: "已撤銷顧客",
    });
    await page.getByRole("button", { name: "重新整理", exact: true }).click();
    await page.getByText("查看已撤銷／過期（1）", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "查看 已撤銷顧客 的明細" })
        .count(),
      0,
    );
    await page.getByText("查看已撤銷／過期（1）", { exact: true }).click();
    await page.getByRole("button", { name: "查看 已撤銷顧客 的明細" }).click();
    assert.equal(
      await page.getByRole("region", { name: "付款操作" }).count(),
      0,
    );
    await page.getByRole("button", { name: "移除 已撤銷顧客 的配單" }).click();
    await page.waitForFunction(
      () => !document.body.textContent.includes("已撤銷顧客"),
    );
    assert.equal(
      orders.some((order) => order.id === 99),
      false,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    console.log(
      `PASS admin ${width}px: campaign switch/create/edit/toggle/links, itemized prices, exact sums, retry, upload/publish, full payment retry/reversal and receiving/outbound prerequisites`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
