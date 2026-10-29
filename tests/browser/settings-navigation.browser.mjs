// Run after npm run build: node tests/browser/settings-navigation.browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import { chromium } from "playwright";
const inventories = [
  { id: "00000000-0000-4000-8000-000000000001", name: "海報小天地" },
  { id: "00000000-0000-4000-8000-000000000002", name: "NN佛系海報代購" },
].map((item) => ({
  ...item,
  ownerIds: ["user"],
  qrShopeeDestinationUrl: "",
  qrOtherDestinationUrl: "",
  officialLineId: "@example",
  claimCompletionMessage: "",
  claimTransferEnabled: false,
  claimBankCode: "",
  claimBankName: "",
  claimBankBranch: "",
  claimBankAccount: "",
  claimBankAccountName: "",
}));
const bundle = await build({
  outfile: "/tmp/poster-settings-navigation-browser.js",
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
        builder.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: "navigation",
          namespace: "fixture",
        }));
        builder.onResolve({ filter: /utils\/supabase\/client$/ }, () => ({
          path: "supabase",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          resolveDir: process.cwd(),
          contents:
            path === "navigation"
              ? `export const useRouter=()=>({replace(){},refresh(){}});`
              : `export const createClient=()=>({auth:{getUser:async()=>({data:{user:{id:'user',email:'test@example.com'}}}),signOut:async()=>({})},from:()=>{const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{display_name:'測試管理者'}})};return query;}});`,
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
    loader: "tsx",
    resolveDir: process.cwd(),
    contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{SystemSettings}from'./src/components/settings/SystemSettings';import{BackNavigationProvider,BackButton}from'./src/components/navigation/BackNavigation';import{ImageLightbox}from'./src/components/ui/ImageLightbox';import{StallCheckout}from'./src/components/checkout/StallCheckout';
const inventories=${JSON.stringify(inventories)};const client=new QueryClient();
function Settings(){const [admin,setAdmin]=useState(location.search.includes('admin'));const [selected,setSelected]=useState(inventories[0].id);const allowed=admin?inventories:inventories.slice(0,1);return <><button onClick={()=>{setAdmin(false);setSelected(inventories[0].id);}}>fixture revoke</button><SystemSettings isAdmin={admin} inventories={allowed} inventoryDatabases={allowed} availableUsers={admin?[{id:'user',name:'擁有者'}]:[]} selectedInventoryId={selected} onInventoryChange={setSelected} onInventoryDatabaseUpdated={async()=>{window.saved=(window.saved??0)+1;}}/></>}
function Overlay(){const[open,setOpen]=useState(false);return <BackNavigationProvider navigation={{view:'products',setView:()=>{},goBack:()=>{window.back=true;}}}><header><BackButton/></header><button onClick={()=>setOpen(true)}>open lightbox</button>{open&&<ImageLightbox src='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/%3E' alt='測試圖片' onClose={()=>setOpen(false)}/>}</BackNavigationProvider>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}>{location.pathname==='/overlay'?<Overlay/>:location.pathname==='/checkout'?<StallCheckout ownerId={inventories[0].id} onCompleted={()=>{}} onBack={()=>{window.back=true;}}/>:<Settings/>}</QueryClientProvider>);`,
  },
});
const css =
  (
    await Promise.all(
      (await readdir(".next/static/chunks"))
        .filter((x) => x.endsWith(".css"))
        .map((x) => readFile(".next/static/chunks/" + x, "utf8")),
    )
  ).join("\n") +
  "\n" +
  bundle.outputFiles
    .filter((x) => x.path.endsWith(".css"))
    .map((x) => x.text)
    .join("\n");
const server = createServer((req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(bundle.outputFiles.find((x) => x.path.endsWith(".js")).text);
  }
  if (req.url === "/app.css") {
    res.setHeader("Content-Type", "text/css");
    return res.end(css);
  }
  res.setHeader("Content-Type", "text/html");
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
const url = `http://127.0.0.1:${server.address().port}`;
try {
  for (const width of [390, 1024, 1440]) {
    for (const admin of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [],
        writes = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/push/subscriptions", (route) =>
        route.fulfill({
          json: {
            success: true,
            data: { configured: false, publicKey: null, subscriptions: [] },
          },
        }),
      );
      await page.route("**/api/inventory-databases**", (route) => {
        writes.push(route.request().postDataJSON());
        return route.fulfill({
          json: { success: true, data: { id: inventories[0].id } },
        });
      });
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "serviceWorker", {
          value: {
            register: async () => ({
              pushManager: { getSubscription: async () => null },
            }),
          },
        });
      });
      await page.goto(url + (admin ? "/?admin" : "/"));
      await page.getByRole("tab", { name: "一般管理", exact: true }).waitFor();
      const general = page.getByRole("tabpanel", {
        name: "一般管理",
        exact: true,
      });
      assert.equal(await general.isVisible(), true);
      for (const title of ["包裝完成 QR Code", "訂購／配單完成聯繫"])
        assert.equal(
          await general
            .locator("section")
            .filter({ has: page.getByText(title, { exact: true }) })
            .locator("svg")
            .count(),
          0,
        );
      await page.getByLabel("蝦皮訂單入口").fill("https://example.com/shop");
      await page.getByLabel("訂購完成提醒").fill("測試提醒草稿");
      if (admin) {
        await page.getByRole("tab", { name: "超級管理", exact: true }).click();
        assert.equal(await general.isVisible(), false);
        await page
          .getByRole("button", { name: "新增資料庫", exact: true })
          .waitFor();
        assert.equal(await page.getByLabel("蝦皮訂單入口").isVisible(), false);
        await page
          .getByRole("tab", { name: "超級管理", exact: true })
          .press("ArrowLeft");
        assert.equal(
          await page.getByLabel("蝦皮訂單入口").inputValue(),
          "https://example.com/shop",
        );
        assert.equal(
          await page.getByLabel("訂購完成提醒").inputValue(),
          "測試提醒草稿",
        );
      } else {
        assert.equal(
          await page
            .getByRole("tab", { name: "超級管理", exact: true })
            .count(),
          0,
        );
        assert.equal(
          await page
            .getByRole("button", { name: "新增資料庫", exact: true })
            .count(),
          0,
        );
        assert.equal(await page.getByLabel("資料庫名稱").count(), 0);
        assert.equal(await page.getByLabel("選擇庫藏資料庫").count(), 0);
      }
      await page
        .getByRole("button", { name: "儲存購買入口", exact: true })
        .click();
      await page.getByText("QR 購買入口已更新", { exact: true }).waitFor();
      assert.equal(writes.at(-1).id, inventories[0].id);
      await page
        .getByRole("button", { name: "儲存訂購／配單完成設定", exact: true })
        .click();
      await page.waitForFunction(() => window.saved === 2);
      assert.equal(writes.at(-1).id, inventories[0].id);
      assert.equal(writes.at(-1).claimCompletionMessage, "測試提醒草稿");
      if (admin) {
        await page.getByRole("tab", { name: "超級管理", exact: true }).click();
        await page.getByLabel("選擇庫藏資料庫").selectOption(inventories[1].id);
        await page.getByRole("tab", { name: "一般管理", exact: true }).click();
        await page
          .getByRole("heading", {
            name: inventories[1].name + " 的購買入口",
            exact: true,
          })
          .waitFor();
        await page
          .getByLabel("蝦皮訂單入口")
          .fill("https://example.com/second");
        await page
          .getByRole("button", { name: "儲存購買入口", exact: true })
          .click();
        await page.waitForFunction(() => window.saved === 3);
        assert.equal(writes.at(-1).id, inventories[1].id);
        await page.screenshot({
          path: `/tmp/poster-settings-general-admin-${width}.png`,
          fullPage: true,
        });
        await page.getByRole("tab", { name: "超級管理", exact: true }).click();
        await page.screenshot({
          path: `/tmp/poster-settings-super-admin-${width}.png`,
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "fixture revoke", exact: true })
          .click();
        assert.equal(
          await page
            .getByRole("tab", { name: "超級管理", exact: true })
            .count(),
          0,
        );
        assert.equal(await general.isVisible(), true);
        assert.equal(
          await page
            .getByRole("button", { name: "新增資料庫", exact: true })
            .count(),
          0,
        );
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: `/tmp/poster-settings-${admin ? "admin" : "staff"}-${width}.png`,
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(url + "/overlay");
    const back = page.getByRole("button", { name: "返回", exact: true });
    if (width < 1280) await back.waitFor({ state: "visible" });
    await page
      .getByRole("button", { name: "open lightbox", exact: true })
      .click();
    await page.getByRole("dialog", { name: "商品圖片預覽" }).waitFor();
    await back.waitFor({ state: "detached" });
    assert.equal(await back.count(), 0);
    await page.getByRole("button", { name: "關閉圖片", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(await page.getByRole("dialog").count(), 0);
    if (width < 1280) await back.waitFor({ state: "visible" });
    await page
      .getByRole("button", { name: "open lightbox", exact: true })
      .click();
    await page.getByRole("button", { name: "關閉圖片" }).press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.goto(url + "/checkout");
    await page
      .getByRole("heading", { name: "攤位結帳", exact: true })
      .waitFor();
    assert.equal(await page.getByRole("button", { name: /返回/ }).count(), 0);
    await page.close();
    console.log(
      `PASS ${width}px: settings roles, retained drafts, scoped saves, role revocation, single lightbox close, checkout without back`,
    );
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
