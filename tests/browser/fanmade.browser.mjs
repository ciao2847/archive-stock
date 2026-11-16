// Component integration: actual UI and API clients, controlled API/storage responses.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const header = {
  title: "飯製海報現貨訂購",
  storeName: "ARCHIVE 庫藏",
  description: "各工藝獨立現貨，請先觀看商品實拍。",
  isOpen: true,
  price: 350,
  officialLineId: "@archive",
  completionMessage: "請聯繫官方 LINE 完成付款",
  bannerPosition: { x: 50, y: 50 },
  theme: {
    primaryColor: "#5A87B1",
    backgroundColor: "#F3F7FB",
    surfaceColor: "#FFFFFF",
    headerTextColor: "#172433",
  },
  groups: [
    { id: id(10), name: "蜘蛛人", count: 13 },
    { id: id(11), name: "另一個 IP", count: 1 },
  ],
};
const makeProduct = (i, variant = 0) => ({
  id: id(100 + i * 2 + variant),
  catalogGroupId: id(500 + i),
  sku: `FM-${i}-${variant}`,
  name: `夜景${i}｜${variant ? "水波紋" : "亮銀龍"}`,
  title: `夜景${i}`,
  work: i === 13 ? "另一個 IP" : "蜘蛛人",
  craft: variant ? "水波紋" : "亮銀龍",
  category: "飯製海報",
  price: 350,
  available: i === 2 && variant === 1 ? 0 : variant ? 6 : 10,
  maxQuantity: i === 2 && variant === 1 ? 0 : variant ? 6 : 10,
  isEnabled: !(i === 3 && variant === 1),
  crafts: [],
  imageUrl: `/fixture/thumb-${i}.webp`,
  thumbnailPath: `${id(100 + i)}/thumb.webp`,
  posterPath: i === 0 ? "fixture/poster.webp" : null,
  videoAvailable: i === 0 || (i === 4 && variant === 1),
});
const bundle = await build({
  outfile: "/tmp/archive-fanmade-browser.js",
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  alias: { "@": resolve("src") },
  define: {
    "process.env.NODE_ENV": '"development"',
    "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://127.0.0.1"',
    "process.env": "{}",
  },
  plugins: [
    {
      name: "fixtures",
      setup(b) {
        const fixtures = [
          [
            /lib\/api\/products$/,
            "uploads",
            `export async function uploadProductImages(){window.imageUploads=(window.imageUploads||0)+1;const id='00000000-0000-4000-8000-'+String(window.imageUploads).padStart(12,'0');return {paths:[id+'/main.webp',id+'/thumb.webp']}}`,
          ],
          [
            /fanmade\/upload$/,
            "video",
            `export async function uploadFanmadeVideo(owner,file,progress){window.videoUploads=(window.videoUploads||0)+1;const path=owner+'/00000000-0000-4000-8000-'+String(9000+window.videoUploads).padStart(12,'0')+'/source.mov';window.uploadedVideoFiles=[...(window.uploadedVideoFiles||[]),{name:file.name,path}];progress(100);return path}`,
          ],
          [
            /claims\/TurnstileWidget$/,
            "turnstile",
            `import{useEffect}from'react';export function TurnstileWidget({onTokenChange}){useEffect(()=>onTokenChange('test-token'),[onTokenChange]);return null}`,
          ],
        ];
        for (const [filter, path, contents] of fixtures) {
          b.onResolve({ filter }, () => ({ path, namespace: "fixture" }));
          b.onLoad(
            { filter: new RegExp(`^${path}$`), namespace: "fixture" },
            () => ({ contents, loader: "tsx", resolveDir: process.cwd() }),
          );
        }
        b.onLoad({ filter: /\.module\.scss$/ }, (args) => ({
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
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{FanmadePublicForm}from'./src/components/fanmade/FanmadePublicForm';import{FanmadeManagement}from'./src/components/fanmade/FanmadeManagement';const header=${JSON.stringify(header)};const params=new URLSearchParams(location.search);if(params.has('closed'))header.isOpen=false;if(params.has('empty'))header.groups=[];if(params.has('dark'))header.theme={primaryColor:'#446D93',backgroundColor:'#111827',surfaceColor:'#1F2937',headerTextColor:'#FFFFFF'};createRoot(document.getElementById('root')).render(location.pathname==='/admin'?<div style={{padding:20,maxWidth:1300,margin:'auto'}}><FanmadeManagement ownerId='${id(1)}'/></div>:<FanmadePublicForm header={header} token='${id(2)}' turnstileSiteKey='test'/>);`,
  },
});
const css =
  (
    await postcss([tailwind()]).process(
      await readFile("styles/tailwind.css", "utf8"),
      { from: resolve("styles/tailwind.css") },
    )
  ).css +
  compile("styles/app.global.scss").css +
  bundle.outputFiles
    .filter((f) => f.path.endsWith(".css"))
    .map((f) => f.text)
    .join("\n");
const server = createServer((req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(bundle.outputFiles.find((f) => f.path.endsWith(".js")).text);
  }
  if (req.url === "/app.css") {
    res.setHeader("Content-Type", "text/css");
    return res.end(css);
  }
  if (req.url.startsWith("/fixture/")) {
    res.setHeader("Content-Type", "image/svg+xml");
    return res.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600"><rect width="480" height="600" fill="#2f4860"/><circle cx="240" cy="230" r="100" fill="#b6cddd"/><text x="240" y="420" fill="white" text-anchor="middle" font-size="32">商品實拍</text></svg>`,
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
      process.env.PLAYWRIGHT_CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } }),
      errors = [],
      calls = [],
      media = [],
      mediaProducts = [],
      confirmations = [];
    let dismissNextConfirm = false;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (dialog) => {
      if (dialog.type() === "confirm") {
        confirmations.push(dialog.message());
        if (dismissNextConfirm) {
          dismissNextConfirm = false;
          return dialog.dismiss();
        }
      }
      return dialog.accept();
    });
    let failNext = true;
    await page.route("**/api/public/fanmade-forms/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/media")) {
        media.push(url.searchParams.get("kind"));
        mediaProducts.push(url.searchParams.get("productId"));
        return route.fulfill({
          json: {
            success: true,
            data: {
              url: `${base}/fixture/${url.searchParams.get("kind") === "video" ? "video.mp4" : "main.webp"}`,
            },
          },
        });
      }
      const ip = url.searchParams.get("ip"),
        n = Number(url.searchParams.get("page"));
      calls.push({ ip, page: n });
      if (n === 2 && failNext) {
        failNext = false;
        return route.fulfill({
          status: 503,
          json: { success: false, error: "暫時無法讀取" },
        });
      }
      const products =
        ip === id(11)
          ? [makeProduct(13)]
          : Array.from({ length: n === 1 ? 12 : 1 }, (_, i) =>
              n === 1 ? i : 12,
            ).flatMap((i) => [makeProduct(i), makeProduct(i, 1)]);
      return route.fulfill({
        json: {
          success: true,
          data: {
            products,
            total: ip === id(11) ? 1 : 13,
            page: n,
            hasMore: ip === id(10) && n === 1,
          },
        },
      });
    });
    await page.route("**/storage/v1/object/public/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="gray"/></svg>',
      }),
    );
    let submitted;
    await page.route("**/api/public/claim-forms/**", (route) => {
      submitted = route.request().postDataJSON();
      return route.fulfill({
        json: {
          success: true,
          data: {
            confirmationCode: "FM-TEST",
            submittedAt: "2026-11-14T10:00:00Z",
          },
        },
      });
    });
    // Closed forms retain browsing/media while preventing order entry.
    await page.goto(`${base}/public?closed`);
    await page.getByText("這次訂購已經截止", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("訂購聯絡資料").count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "確認訂購", exact: true }).count(),
      0,
    );
    assert.equal(calls.length, 0);
    await page.getByRole("button", { name: /蜘蛛人/ }).click();
    await page.getByLabel("夜景0｜亮銀龍數量", { exact: true }).waitFor();
    assert.equal(await page.getByRole("article").count(), 12);
    assert.equal(
      await page
        .getByRole("spinbutton")
        .evaluateAll((inputs) => inputs.every((input) => input.disabled)),
      true,
      "a closed form must disable every craft quantity",
    );
    assert.equal(await page.locator("video").count(), 0);
    assert.equal(media.length, 0);
    await page
      .getByRole("button", { name: "夜景0 亮銀龍觀看實拍影片", exact: true })
      .click();
    await page.locator("video").waitFor();
    assert.deepEqual(mediaProducts, [id(100)]);
    await page.getByRole("button", { name: "關閉媒體" }).click();
    assert.equal(await page.locator("video").count(), 0);
    assert.match(await page.getByLabel("飯製訂購總額").innerText(), /共 0 張/);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    calls.length = media.length = mediaProducts.length = 0;

    // An empty catalog has no contact form and does not request product/media pages.
    await page.goto(`${base}/public?empty`);
    await page.getByText("商品即將上架", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("訂購聯絡資料").count(), 0);
    assert.equal(await page.getByLabel("搜尋 IP", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("article").count(), 0);
    assert.equal(await page.getByRole("spinbutton").count(), 0);
    assert.equal(calls.length, 0);
    assert.equal(media.length, 0);
    assert.equal(await page.locator("video").count(), 0);
    assert.match(await page.getByLabel("飯製訂購總額").innerText(), /共 0 張/);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );

    // Cards, native craft selection, and steppers inherit the shared dark theme.
    await page.goto(`${base}/public?dark`);
    await page.getByRole("button", { name: /蜘蛛人/ }).waitFor();
    assert.equal(calls.length, 0);
    await page.getByRole("button", { name: /蜘蛛人/ }).click();
    const darkDesign = page.getByRole("article", {
      name: "夜景0 工藝選擇",
      exact: true,
    });
    await darkDesign.waitFor();
    assert.deepEqual(
      await page.locator("main").evaluate((element) => {
        const style = getComputedStyle(element);
        return [
          style.getPropertyValue("--claim-background").trim(),
          style.getPropertyValue("--claim-surface").trim(),
          style.getPropertyValue("--claim-surface-text").trim(),
        ];
      }),
      ["#111827", "#1F2937", "#FFFFFF"],
    );
    assert.equal(
      await darkDesign.evaluate((element) => getComputedStyle(element).color),
      "rgb(255, 255, 255)",
    );
    assert.equal(
      await page
        .getByText("飯製海報統一單價", { exact: true })
        .evaluate((element) => getComputedStyle(element).color),
      "rgb(255, 255, 255)",
      "the uniform-price label must remain legible on a dark surface",
    );
    assert.equal(
      await page
        .getByRole("button", { name: /蜘蛛人/ })
        .locator("b")
        .evaluate((element) => getComputedStyle(element).color),
      "rgb(255, 255, 255)",
      "IP accordion names must inherit the configured surface text color",
    );
    assert.equal(
      await darkDesign
        .getByRole("combobox")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      "rgb(31, 41, 55)",
    );
    assert.equal(
      await darkDesign
        .getByLabel("夜景0｜亮銀龍數量", { exact: true })
        .evaluate((element) => getComputedStyle(element).color),
      "rgb(255, 255, 255)",
    );
    assert.equal(media.length, 0);
    assert.equal(await page.locator("video").count(), 0);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `/tmp/archive-fanmade-public-dark-${width}.png`,
      fullPage: false,
      animations: "disabled",
    });
    calls.length = media.length = mediaProducts.length = 0;

    await page.goto(`${base}/public`);
    await page.getByRole("button", { name: /蜘蛛人/ }).waitFor();
    assert.equal(calls.length, 0);
    assert.equal(await page.getByRole("img").count(), 0);
    assert.equal(await page.locator("video").count(), 0);
    await page.screenshot({
      path: `/tmp/archive-fanmade-public-collapsed-${width}.png`,
      fullPage: true,
    });
    assert.match(
      await page.getByLabel("商品與訂購總額").innerText(),
      /共 14 款 · 2 個 IP/,
    );
    await page.getByRole("button", { name: /蜘蛛人/ }).click();
    await page.getByLabel("夜景0｜亮銀龍數量", { exact: true }).waitFor();
    assert.equal(await page.getByRole("article").count(), 12);
    const design = page.getByRole("article", {
      name: "夜景0 工藝選擇",
      exact: true,
    });
    assert.equal(
      await design.getByRole("img", { name: "夜景0", exact: true }).count(),
      1,
    );
    assert.equal(
      await design.getByRole("spinbutton").count(),
      2,
      "one poster card contains both independent crafts",
    );
    assert.equal(media.length, 0);
    assert.equal(await page.locator("video").count(), 0);
    assert.equal(await page.getByRole("button", { name: /^放大 / }).count(), 0);
    const unready = page.getByRole("article", {
      name: "夜景1 工藝選擇",
      exact: true,
    });
    assert.match(await unready.innerText(), /實拍影片準備中/);
    assert.equal(
      await unready.getByRole("button", { name: /觀看實拍影片/ }).count(),
      0,
    );
    await unready.getByLabel("夜景1｜亮銀龍數量", { exact: true }).fill("1");
    assert.match(await page.getByLabel("飯製訂購總額").innerText(), /共 1 張/);
    await unready.getByLabel("夜景1｜亮銀龍數量", { exact: true }).fill("0");
    assert.equal(
      await page.getByLabel("夜景2｜水波紋數量", { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await page.getByLabel("夜景3｜水波紋數量", { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await page.getByLabel("夜景4實拍工藝", { exact: true }).inputValue(),
      id(109),
    );
    await page.getByLabel("搜尋 IP", { exact: true }).fill("沒有這個 IP");
    await page
      .getByText("找不到符合的 IP，請試試其他關鍵字。", { exact: true })
      .waitFor();
    await page.getByLabel("搜尋 IP", { exact: true }).fill("");
    assert.equal(media.length, 0);
    await page.getByLabel("夜景0｜亮銀龍數量", { exact: true }).fill("2");
    await page.getByLabel("夜景0｜水波紋數量", { exact: true }).fill("3");
    assert.match(
      await page.getByLabel("飯製訂購總額").innerText(),
      /共 5 張[\s\S]*1,750/,
    );
    await page.getByRole("button", { name: /載入更多/ }).click();
    await page.getByRole("button", { name: "重試讀取" }).waitFor();
    assert.equal(
      await page.getByLabel("夜景0｜亮銀龍數量", { exact: true }).inputValue(),
      "2",
    );
    await page.getByRole("button", { name: "重試讀取" }).click();
    await page.getByLabel("夜景12｜亮銀龍數量", { exact: true }).waitFor();
    await page.getByLabel("夜景12｜亮銀龍數量", { exact: true }).fill("3");
    await page.getByLabel("夜景0｜水波紋數量", { exact: true }).fill("0");
    await page.getByRole("button", { name: /蜘蛛人/ }).click();
    assert.equal(await page.getByRole("article").count(), 0);
    assert.match(
      await page.getByLabel("飯製訂購總額").innerText(),
      /共 5 張[\s\S]*1,750/,
    );
    const requestCount = calls.length;
    await page.getByRole("button", { name: /蜘蛛人/ }).click();
    assert.equal(calls.length, requestCount);
    assert.equal(
      await page.getByLabel("夜景12｜亮銀龍數量", { exact: true }).inputValue(),
      "3",
    );
    await page.getByRole("button", { name: /另一個 IP/ }).click();
    await page.getByLabel("夜景13｜亮銀龍數量", { exact: true }).waitFor();
    const videoPicker = page.getByLabel("夜景0實拍工藝", { exact: true });
    await videoPicker.selectOption(id(101));
    assert.equal(
      media.length,
      0,
      "switching the craft cover must not request playback",
    );
    await page
      .getByRole("button", { name: "夜景0 水波紋觀看實拍影片", exact: true })
      .click();
    await page.locator("video").waitFor();
    assert.deepEqual(media, ["video"]);
    assert.deepEqual(
      mediaProducts,
      [id(101)],
      "video requests the selected craft SKU",
    );
    assert.equal(await page.locator("video").getAttribute("preload"), "none");
    await page.getByRole("button", { name: "關閉媒體" }).click();
    assert.equal(await page.locator("video").count(), 0);
    await videoPicker.selectOption(id(100));
    assert.equal(media.length, 1);
    await page
      .getByRole("button", { name: "夜景0 亮銀龍觀看實拍影片", exact: true })
      .click();
    await page.locator("video").waitFor();
    assert.deepEqual(mediaProducts, [id(101), id(100)]);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("video").count(), 0);
    assert.equal(
      media.includes("image"),
      false,
      "public covers play video instead of fetching enlarged photos",
    );
    await page.getByLabel("搜尋 IP", { exact: true }).fill("另一個");
    assert.match(
      await page.getByLabel("已選飯製商品").innerText(),
      /蜘蛛人／夜景0/,
    );
    assert.match(
      await page.getByLabel("飯製訂購總額").innerText(),
      /共 5 張[\s\S]*1,750/,
    );
    await page.getByLabel("搜尋 IP", { exact: true }).fill("");
    assert.equal(
      await page.getByLabel("夜景0｜亮銀龍數量", { exact: true }).inputValue(),
      "2",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `/tmp/archive-fanmade-public-${width}.png`,
      fullPage: true,
    });
    await page.getByLabel("群組暱稱").fill("小明");
    await page.getByLabel("手機號碼").fill("0912345678");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "確認訂購", exact: true }).click();
    await page.getByText("FM-TEST", { exact: true }).waitFor();
    assert.equal(submitted.formKind, "fanmade");
    assert.equal(submitted.expectedPrice, 350);
    assert.deepEqual(submitted.items, [
      { productId: id(100), quantity: 2 },
      { productId: id(124), quantity: 3 },
    ]);
    assert.match(await page.locator("body").innerText(), /蜘蛛人／夜景0/);
    await page.reload();
    await page.getByText("FM-TEST", { exact: true }).waitFor();
    // Admin: images only upload once on a lost response, retries retain batch ID and video association.
    let attempts = 0,
      failNextBatch = true,
      releaseBatch;
    let notifyBatchStarted;
    const firstBatchStarted = new Promise((done) => {
      notifyBatchStarted = done;
    });
    const batches = [],
      actions = [];
    const currentRound = {
      id: id(700),
      number: 1,
      submissionCount: 0,
      paidSubmissionCount: 0,
      unpaidSubmissionCount: 0,
      itemCount: 0,
      totalAmount: 0,
    };
    await page.route("**/api/claim-procurement**", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            current: currentRound,
            selected: {
              ...currentRound,
              status: "open",
              createdAt: "2026-11-15T00:00:00Z",
              closedAt: null,
              customerCount: 0,
              lines: [],
            },
            history: [],
            historyHasMore: false,
          },
        },
      }),
    );
    await page.route("**/api/fanmade**", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({
          json: {
            success: true,
            data: {
              price: 350,
              forms: [{ id: 1, title: "飯製表單", token: id(2), isOpen: true }],
              products: [0, 1].map((variant) => ({
                ...makeProduct(0, variant),
                ip: "蜘蛛人",
                ipId: id(10),
                stock: variant ? 6 : 10,
                videoStatus: variant ? "ready" : "pending",
                reserved: variant ? 1 : 2,
                active: true,
                listed: true,
                imagePaths: [`${id(100)}/main.webp`, `${id(100)}/thumb.webp`],
                updatedAt: "2026-11-15T00:00:00Z",
              })),
              total: 1,
              variantTotal: 2,
              legacy: [
                {
                  id: id(900),
                  name: "舊飯製資料",
                  stock: 9,
                  crafts: ["亮銀龍", "水波紋"],
                },
              ],
            },
          },
        });
      const data = route.request().postDataJSON();
      actions.push(data);
      if (data.action === "batch") {
        attempts++;
        batches.push(data);
        if (attempts === 1) {
          await new Promise((done) => {
            releaseBatch = done;
            notifyBatchStarted();
          });
        }
        if (failNextBatch) {
          failNextBatch = false;
          return route.abort("failed");
        }
        const productIds = data.items.map((_, index) => id(200 + index));
        return route.fulfill({
          json: {
            success: true,
            data: {
              productIds,
              versions: Object.fromEntries(
                productIds.map((productId) => [
                  productId,
                  "2026-11-14T10:00:00Z",
                ]),
              ),
            },
          },
        });
      }
      return route.fulfill({ json: { success: true, data: { saved: true } } });
    });
    await page.goto(`${base}/admin`);
    const procurementTab = page.getByRole("tab", {
      name: "採購統計",
      exact: true,
    });
    const settingsTab = page.getByRole("tab", {
      name: "表單與商品設定",
      exact: true,
    });
    const procurementPanel = page.getByRole("region", {
      name: "飯製表單本次結單與叫貨",
      exact: true,
    });
    const uniformPrice = page.getByLabel("飯製統一售價", { exact: true });
    await page.getByRole("tablist", { name: "飯製管理分頁" }).waitFor();
    await procurementPanel.waitFor();
    await procurementPanel
      .getByText("第 1 批 · 進行中", { exact: true })
      .waitFor();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("button")).some(
        (button) =>
          button.textContent.trim() === "重新載入" && !button.disabled,
      ),
    );
    assert.equal(await procurementTab.getAttribute("aria-selected"), "true");
    assert.equal(await uniformPrice.isVisible(), false);
    assert.equal(
      await page
        .getByRole("button", { name: "文字批量上架", exact: true })
        .isVisible(),
      false,
      "procurement displays the round summary separately from product settings",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "procurement layout must fit narrow screens",
    );
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: `/tmp/archive-fanmade-management-procurement-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await procurementTab.focus();
    await page.keyboard.press("End");
    assert.equal(await settingsTab.getAttribute("aria-selected"), "true");
    assert.equal(
      await settingsTab.evaluate((tab) => tab === document.activeElement),
      true,
    );
    await page.keyboard.press("Home");
    assert.equal(await procurementTab.getAttribute("aria-selected"), "true");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await settingsTab.getAttribute("aria-selected"), "true");
    await page.keyboard.press("ArrowRight");
    assert.equal(await procurementTab.getAttribute("aria-selected"), "true");
    await page.keyboard.press("ArrowRight");
    await page.getByLabel("飯製統一售價", { exact: true }).waitFor();
    assert.equal(await settingsTab.getAttribute("aria-selected"), "true");
    assert.equal(await procurementPanel.isVisible(), false);
    await page.getByRole("button", { name: /蜘蛛人.*本頁/ }).click();
    const adminDesign = page.getByRole("region", {
      name: "夜景0 工藝與庫存",
      exact: true,
    });
    assert.equal(await adminDesign.getByRole("img").count(), 1);
    assert.equal(await adminDesign.getByRole("article").count(), 2);
    await page.getByLabel("影片尚未公開提醒", { exact: true }).waitFor();
    assert.match(
      await adminDesign.innerText(),
      /已上傳，等待轉檔；目前尚未對客人公開/,
    );
    assert.match(await adminDesign.innerText(), /已轉檔，可在目前表單觀看/);
    await page.getByLabel("選取 夜景0 全部工藝", { exact: true }).check();
    assert.match(
      await page.getByRole("button", { name: /選取商品加入表單/ }).innerText(),
      /2/,
    );
    const editProduct = adminDesign.getByRole("article", {
      name: "夜景0 亮銀龍庫存",
      exact: true,
    });
    await editProduct.locator("summary").click();
    await editProduct
      .getByLabel("商品名稱", { exact: true })
      .fill("商品名稱草稿");
    await editProduct.getByLabel("盤點後實際庫存", { exact: true }).fill("18");
    await editProduct
      .getByLabel("調整原因", { exact: true })
      .fill("尚未送出的盤點");
    await uniformPrice.fill("420");
    await procurementTab.click();
    await procurementPanel.waitFor();
    assert.equal(await adminDesign.isVisible(), false);
    await settingsTab.click();
    assert.equal(await uniformPrice.inputValue(), "420");
    assert.equal(
      await page.getByLabel("選取 夜景0 全部工藝", { exact: true }).isChecked(),
      true,
      "switching management tabs must retain product selection",
    );
    assert.equal(
      await editProduct.getByLabel("商品名稱", { exact: true }).inputValue(),
      "商品名稱草稿",
    );
    assert.equal(
      await editProduct
        .getByLabel("盤點後實際庫存", { exact: true })
        .inputValue(),
      "18",
    );
    assert.equal(
      await editProduct.getByLabel("調整原因", { exact: true }).inputValue(),
      "尚未送出的盤點",
    );
    await editProduct.getByLabel("商品名稱", { exact: true }).fill("夜景0");
    await editProduct.getByLabel("盤點後實際庫存", { exact: true }).fill("10");
    await editProduct.getByLabel("調整原因", { exact: true }).fill("");
    await editProduct.locator("summary").click();
    await uniformPrice.fill("350");
    await page.getByLabel("選取 夜景0 全部工藝", { exact: true }).uncheck();
    await page
      .getByRole("button", { name: "新增飯製表單", exact: true })
      .click();
    await page.getByLabel("新表單名稱", { exact: true }).fill("新飯製表單草稿");
    await page.getByRole("button", { name: "取消新增", exact: true }).click();
    assert.equal(
      await page.getByLabel("飯製訂購表單", { exact: true }).inputValue(),
      "1",
    );
    assert.equal(
      await page.getByLabel("表單名稱", { exact: true }).inputValue(),
      "飯製表單",
    );
    assert.equal(
      actions.length,
      0,
      "opening and cancelling form creation must not save",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "settings layout must fit narrow screens",
    );
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: `/tmp/archive-fanmade-management-settings-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    const batchDialog = page.getByRole("dialog", {
      name: "飯製文字批量上架",
      exact: true,
    });
    const openBatch = page.getByRole("button", {
      name: "文字批量上架",
      exact: true,
    });
    assert.equal(await batchDialog.isVisible(), false);
    assert.equal(
      await page.getByLabel("批次 IP", { exact: true }).isVisible(),
      false,
      "batch fields are hidden until the dialog is opened",
    );
    await openBatch.click();
    await batchDialog.waitFor();
    const closeBatch = batchDialog.getByRole("button", {
      name: "關閉飯製文字批量上架",
      exact: true,
    });
    const example = batchDialog.getByRole("button", {
      name: "帶入範例",
      exact: true,
    });
    const batchIp = batchDialog.getByLabel("批次 IP", { exact: true });
    const defaultStock = batchDialog.getByLabel("預設庫存", { exact: true });
    const craftText = batchDialog.getByLabel("預設工藝文字批量", {
      exact: true,
    });
    const mode = batchDialog.getByLabel("工藝套用方式", { exact: true });
    const applyCrafts = batchDialog.getByRole("button", {
      name: "辨識並套用到本批圖片",
      exact: true,
    });
    const batchHelp = batchDialog.locator("#fanmade-batch-help");
    const batchError = batchDialog.locator("#fanmade-batch-error");
    const createBatch = batchDialog.getByRole("button", {
      name: "建立本批飯製商品",
      exact: true,
    });
    const retryBatch = batchDialog.getByRole("button", {
      name: "重試本批未完成項目",
      exact: true,
    });
    const batchCount = batchDialog.getByLabel("本批商品數", { exact: true });
    const row = (title, craft) =>
      batchDialog.getByRole("group", {
        name: `${title}｜${craft}上架資料`,
        exact: true,
      });
    assert.equal(
      await createBatch.getAttribute("aria-describedby"),
      "fanmade-batch-help",
    );
    assert.equal(await createBatch.isDisabled(), true);
    assert.equal(await batchHelp.isVisible(), true);
    assert.match(await batchHelp.innerText(), /圖片/);
    await batchIp.fill("測試預設");
    await defaultStock.fill("9");
    await craftText.fill("測試工藝｜1");
    await mode.selectOption("in_order");
    const confirmationsBeforeEmptyExample = confirmations.length;
    await example.click();
    assert.equal(await batchIp.inputValue(), "蜘蛛人");
    assert.equal(
      await craftText.inputValue(),
      "亮銀龍｜10\n水波紋｜6\n雷射｜3",
    );
    assert.equal(await defaultStock.inputValue(), "0");
    assert.equal(await mode.inputValue(), "per_image");
    assert.equal(await batchCount.innerText(), "0 件商品");
    assert.equal(confirmations.length, confirmationsBeforeEmptyExample);
    assert.equal(
      actions.length,
      0,
      "loading the example must not submit API actions",
    );
    assert.equal(await page.evaluate(() => window.imageUploads || 0), 0);
    assert.equal(await page.evaluate(() => window.videoUploads || 0), 0);
    await page.keyboard.press("Escape");
    await batchDialog.waitFor({ state: "hidden" });
    await openBatch.click();
    assert.equal(
      await craftText.inputValue(),
      "亮銀龍｜10\n水波紋｜6\n雷射｜3",
    );
    assert.equal(await batchIp.inputValue(), "蜘蛛人");
    await batchIp.fill("");
    await defaultStock.fill("10");
    await mode.selectOption("per_image");
    await craftText.fill("亮銀龍｜10\n水波紋｜6");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await craftText.fill(
      Array.from({ length: 26 }, (_, i) => `工藝${i}｜1`).join("\n"),
    );
    await page.getByLabel("批次上傳飯製圖片").setInputFiles([
      { name: "超量一.png", mimeType: "image/png", buffer: png },
      { name: "超量二.png", mimeType: "image/png", buffer: png },
    ]);
    await batchError.waitFor();
    assert.match(
      await batchError.innerText(),
      /依工藝展開後每批最多 50 件商品/,
    );
    assert.equal(await batchCount.innerText(), "0 件商品");
    assert.equal(await page.evaluate(() => window.imageUploads || 0), 0);
    await craftText.fill("亮銀龍｜10\n水波紋｜6");
    await page.getByLabel("批次上傳飯製圖片").setInputFiles([
      { name: "夜景.png", mimeType: "image/png", buffer: png },
      { name: "晨光.png", mimeType: "image/png", buffer: png },
    ]);
    assert.equal(await batchCount.innerText(), "4 件商品");
    assert.equal(
      await row("夜景", "亮銀龍")
        .getByLabel("現貨庫存", { exact: true })
        .inputValue(),
      "10",
    );
    assert.equal(
      await row("夜景", "水波紋")
        .getByLabel("現貨庫存", { exact: true })
        .inputValue(),
      "6",
    );
    const customizedRow = row("夜景", "水波紋");
    const customizedStock = customizedRow.getByLabel("現貨庫存", {
      exact: true,
    });
    const customizedIp = customizedRow.getByLabel("IP", { exact: true });
    const customizedVideo = customizedRow.getByLabel("夜景 水波紋實拍影片", {
      exact: true,
    });
    assert.equal(await customizedIp.inputValue(), "");
    await customizedStock.fill("7");
    await customizedRow
      .locator("summary")
      .filter({ hasText: /個別修改.*IP.*名稱.*工藝/ })
      .click();
    await customizedIp.fill("自訂 IP");
    await page
      .getByLabel("夜景 水波紋實拍影片", { exact: true })
      .setInputFiles({
        name: "夜景.mov",
        mimeType: "video/quicktime",
        buffer: Buffer.from("video fixture"),
      });
    const customizedPreview = await customizedRow
      .getByRole("img")
      .getAttribute("src");
    await batchIp.fill("蜘蛛人");
    assert.equal(
      await createBatch.isEnabled(),
      true,
      "filling the batch IP after selecting images must not require rebuilding crafts",
    );
    for (const [title, craft] of [
      ["夜景", "亮銀龍"],
      ["晨光", "亮銀龍"],
      ["晨光", "水波紋"],
    ]) {
      assert.equal(
        await row(title, craft).getByLabel("IP", { exact: true }).inputValue(),
        "蜘蛛人",
        "late batch IP input must fill the existing blank draft IPs",
      );
    }
    assert.equal(await customizedIp.inputValue(), "自訂 IP");
    await batchIp.fill("更新後的批次 IP");
    assert.equal(
      await row("晨光", "亮銀龍")
        .getByLabel("IP", { exact: true })
        .inputValue(),
      "更新後的批次 IP",
      "rows following the previous batch IP must follow its next value",
    );
    await batchIp.fill("蜘蛛人");
    assert.equal(await customizedIp.inputValue(), "自訂 IP");
    assert.equal(await customizedStock.inputValue(), "7");
    assert.equal(
      await customizedVideo.evaluate((input) => input.files[0]?.name),
      "夜景.mov",
      "editing the batch IP must preserve the selected per-row video",
    );
    assert.equal(
      await customizedRow.getByRole("img").getAttribute("src"),
      customizedPreview,
    );
    assert.equal(await batchCount.innerText(), "4 件商品");
    await customizedIp.fill("蜘蛛人");
    await customizedStock.fill("6");
    await defaultStock.fill("11");
    assert.equal(await createBatch.isEnabled(), true);
    assert.equal(await batchHelp.isVisible(), true);
    assert.equal(await customizedStock.inputValue(), "6");
    await defaultStock.fill("10");
    assert.equal(await createBatch.isEnabled(), true);
    const confirmationsBeforeExample = confirmations.length;
    dismissNextConfirm = true;
    await example.click();
    assert.equal(confirmations.length, confirmationsBeforeExample + 1);
    assert.equal(await craftText.inputValue(), "亮銀龍｜10\n水波紋｜6");
    assert.equal(await defaultStock.inputValue(), "10");
    assert.equal(await batchCount.innerText(), "4 件商品");
    await example.click();
    assert.equal(confirmations.length, confirmationsBeforeExample + 2);
    assert.equal(
      await craftText.inputValue(),
      "亮銀龍｜10\n水波紋｜6\n雷射｜3",
    );
    assert.equal(await defaultStock.inputValue(), "0");
    assert.equal(await batchCount.innerText(), "4 件商品");
    assert.equal(
      await row("夜景", "水波紋")
        .getByLabel("現貨庫存", { exact: true })
        .inputValue(),
      "6",
      "loading an example must retain existing draft rows until explicitly applied",
    );
    assert.equal(await createBatch.isEnabled(), true);
    assert.equal(actions.length, 0);
    assert.equal(await page.evaluate(() => window.imageUploads || 0), 0);
    assert.equal(await page.evaluate(() => window.videoUploads || 0), 0);
    await craftText.fill("亮銀龍｜10\n水波紋｜6");
    await defaultStock.fill("10");
    assert.equal(
      await createBatch.isEnabled(),
      true,
      "global defaults must not force existing customized images to be rebuilt",
    );
    assert.equal(await batchHelp.isVisible(), true);
    await closeBatch.click();
    await batchDialog.waitFor({ state: "hidden" });
    await procurementTab.click();
    await procurementPanel.waitFor();
    await settingsTab.click();
    await openBatch.click();
    assert.equal(await craftText.inputValue(), "亮銀龍｜10\n水波紋｜6");
    assert.equal(await batchCount.innerText(), "4 件商品");
    assert.equal(
      await row("夜景", "水波紋")
        .getByLabel("現貨庫存", { exact: true })
        .inputValue(),
      "6",
    );
    assert.equal(
      await customizedVideo.evaluate((input) => input.files[0]?.name),
      "夜景.mov",
      "switching management tabs must retain the selected draft video file",
    );
    await page.keyboard.press("Escape");
    await batchDialog.waitFor({ state: "hidden" });
    await openBatch.click();
    assert.equal(await craftText.inputValue(), "亮銀龍｜10\n水波紋｜6");
    assert.equal(await batchCount.innerText(), "4 件商品");
    await applyCrafts.click();
    assert.equal(
      await createBatch.isEnabled(),
      true,
      "applying global defaults remains an explicit action",
    );
    await applyCrafts.click();
    assert.equal(
      await batchCount.innerText(),
      "4 件商品",
      "reapplying the same craft text cannot multiply drafts",
    );
    const sharedPreview = await row("夜景", "水波紋")
      .getByRole("img")
      .getAttribute("src");
    await row("夜景", "亮銀龍")
      .getByRole("button", { name: "移除此列", exact: true })
      .click();
    assert.equal(await batchCount.innerText(), "3 件商品");
    await row("夜景", "水波紋")
      .getByRole("img")
      .evaluate((img) => img.decode());
    assert.equal(
      await row("夜景", "水波紋").getByRole("img").getAttribute("src"),
      sharedPreview,
    );
    assert.equal(
      await row("夜景", "水波紋")
        .getByRole("img")
        .evaluate((img) => img.naturalWidth > 0),
      true,
      "removing a sibling craft must keep the shared preview alive",
    );
    await applyCrafts.click();
    assert.equal(await batchCount.innerText(), "4 件商品");
    await craftText.fill(
      Array.from({ length: 26 }, (_, i) => `工藝${i}｜1`).join("\n"),
    );
    assert.equal(
      await applyCrafts.isDisabled(),
      true,
      "52 expanded products exceed the 50-item batch limit",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "建立本批飯製商品", exact: true })
        .isEnabled(),
      true,
      "over-limit defaults must not block the existing valid image-specific preview",
    );
    assert.equal(await batchCount.innerText(), "4 件商品");
    assert.equal(
      await page.evaluate(() => window.imageUploads || 0),
      0,
      "over-limit drafts must fail before uploading images",
    );
    assert.equal(batches.length, 0);
    await craftText.fill("亮銀龍｜10\n水波紋｜6");
    await batchDialog.evaluate((dialog) => {
      for (const element of dialog.querySelectorAll("*")) element.scrollTop = 0;
    });
    await batchDialog.screenshot({
      path: `/tmp/archive-fanmade-batch-modal-${width}.png`,
    });
    assert.equal(
      await batchDialog.evaluate((dialog) => {
        const bounds = dialog.getBoundingClientRect();
        return (
          bounds.left >= 0 &&
          bounds.top >= 0 &&
          bounds.right <= innerWidth &&
          bounds.bottom <= innerHeight
        );
      }),
      true,
      "the dialog must fit within the viewport",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await createBatch.click();
    await firstBatchStarted;
    assert.equal(await closeBatch.isDisabled(), true);
    assert.equal(
      await batchDialog
        .getByRole("button", { name: "返回飯製管理", exact: true })
        .isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await batchDialog.isVisible(),
      true,
      "busy batches cannot close on Escape",
    );
    releaseBatch();
    await retryBatch.waitFor();
    await batchError.waitFor();
    assert.equal((await batchError.innerText()).trim().length > 0, true);
    assert.equal(await page.evaluate(() => window.imageUploads), 2);
    assert.equal(await craftText.isDisabled(), true);
    assert.equal(await mode.isDisabled(), true);
    await closeBatch.click();
    await batchDialog.waitFor({ state: "hidden" });
    await openBatch.click();
    await retryBatch.waitFor();
    assert.equal(await craftText.inputValue(), "亮銀龍｜10\n水波紋｜6");
    assert.equal(await batchCount.innerText(), "4 件商品");
    assert.equal(await page.evaluate(() => window.imageUploads), 2);
    await retryBatch.click();
    await page
      .getByRole("status")
      .filter({ hasText: "已建立 4 件獨立飯製商品" })
      .waitFor();
    assert.equal(await page.evaluate(() => window.imageUploads), 2);
    assert.equal(await page.evaluate(() => window.videoUploads), 1);
    assert.equal(await batchDialog.isVisible(), true);
    assert.equal(await batchCount.innerText(), "0 件商品");
    assert.deepEqual(batches[0], batches[1]);
    assert.deepEqual(
      batches[0].items.map(({ ip, craft, stock }) => ({ ip, craft, stock })),
      [
        { ip: "蜘蛛人", craft: "亮銀龍", stock: 10 },
        { ip: "蜘蛛人", craft: "水波紋", stock: 6 },
        { ip: "蜘蛛人", craft: "亮銀龍", stock: 10 },
        { ip: "蜘蛛人", craft: "水波紋", stock: 6 },
      ],
    );
    assert.deepEqual(
      batches[0].items[0].imagePaths,
      batches[0].items[1].imagePaths,
    );
    assert.deepEqual(
      batches[0].items[2].imagePaths,
      batches[0].items[3].imagePaths,
    );
    assert.notDeepEqual(
      batches[0].items[0].imagePaths,
      batches[0].items[2].imagePaths,
    );
    assert.equal(actions.find((a) => a.action === "video").productId, id(201));
    assert.equal(
      actions.filter((a) => a.action === "video").length,
      1,
      "craft expansion cannot copy another craft's actual demonstration video",
    );
    // Different photos can pair to one craft per line, including repeated crafts with independent stock.
    await mode.selectOption("in_order");
    await craftText.fill("亮銀龍｜4\n水波紋｜9");
    await page.getByLabel("批次上傳飯製圖片").setInputFiles([
      { name: "順序一.png", mimeType: "image/png", buffer: png },
      { name: "順序二.png", mimeType: "image/png", buffer: png },
    ]);
    assert.equal(await batchCount.innerText(), "2 件商品");
    assert.equal(
      await row("順序一", "亮銀龍")
        .getByLabel("現貨庫存", { exact: true })
        .inputValue(),
      "4",
    );
    assert.equal(
      await row("順序二", "水波紋")
        .getByLabel("現貨庫存", { exact: true })
        .inputValue(),
      "9",
    );
    await craftText.fill("亮銀龍｜4\n亮銀龍｜9");
    await applyCrafts.click();
    assert.equal(await batchCount.innerText(), "2 件商品");
    assert.equal(
      await row("順序二", "亮銀龍")
        .getByLabel("現貨庫存", { exact: true })
        .inputValue(),
      "9",
    );
    await page
      .getByRole("button", { name: "建立本批飯製商品", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "已建立 2 件獨立飯製商品" })
      .waitFor();
    assert.deepEqual(
      batches[2].items.map(({ title, craft, stock }) => ({
        title,
        craft,
        stock,
      })),
      [
        { title: "順序一", craft: "亮銀龍", stock: 4 },
        { title: "順序二", craft: "亮銀龍", stock: 9 },
      ],
    );
    assert.equal(await page.evaluate(() => window.imageUploads), 4);
    assert.equal(await page.evaluate(() => window.videoUploads), 1);
    // A persisted pending request can be reopened manually and retried after reload.
    await mode.selectOption("per_image");
    await craftText.fill("亮銀龍｜2");
    await batchDialog.getByLabel("批次上傳飯製圖片").setInputFiles({
      name: "重新整理.png",
      mimeType: "image/png",
      buffer: png,
    });
    assert.equal(await batchCount.innerText(), "1 件商品");
    failNextBatch = true;
    await createBatch.click();
    await retryBatch.waitFor();
    assert.equal(await page.evaluate(() => window.imageUploads), 5);
    assert.equal(batches.length, 4);
    await page.reload();
    await settingsTab.click();
    await openBatch.waitFor();
    assert.equal(await batchDialog.isVisible(), false);
    assert.equal(await page.evaluate(() => window.imageUploads || 0), 0);
    await openBatch.click();
    await retryBatch.waitFor();
    assert.equal(await batchCount.innerText(), "1 件商品");
    assert.equal(await craftText.isDisabled(), true);
    await retryBatch.click();
    await batchDialog
      .getByRole("status")
      .filter({ hasText: "已建立 1 件獨立飯製商品" })
      .waitFor();
    assert.equal(await page.evaluate(() => window.imageUploads || 0), 0);
    assert.deepEqual(batches[3], batches[4]);
    assert.equal(await batchCount.innerText(), "0 件商品");
    assert.equal(actions.filter((a) => a.action === "migrate").length, 0);
    await closeBatch.click();
    // Every image owns its craft list; changing one cannot rewrite the other image's stock or video.
    await page.unroute("**/api/fanmade**");
    const ownBatches = [],
      ownActions = [];
    let releaseOwnBatch, notifyOwnBatchStarted;
    const ownBatchStarted = new Promise((done) => {
      notifyOwnBatchStarted = done;
    });
    await page.route("**/api/fanmade**", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({
          json: {
            success: true,
            data: {
              price: 350,
              forms: [{ id: 1, title: "飯製表單", token: id(2), isOpen: true }],
              products: [],
              total: 0,
              variantTotal: 0,
              legacy: [],
            },
          },
        });
      const input = route.request().postDataJSON();
      ownActions.push(input);
      if (input.action === "batch") {
        ownBatches.push(input);
        if (ownBatches.length === 1) {
          await new Promise((done) => {
            releaseOwnBatch = done;
            notifyOwnBatchStarted();
          });
          return route.abort("failed");
        }
        const productIds = input.items.map((_, index) => id(700 + index));
        return route.fulfill({
          json: {
            success: true,
            data: {
              productIds,
              versions: Object.fromEntries(
                productIds.map((productId) => [
                  productId,
                  "2026-11-16T00:00:00Z",
                ]),
              ),
            },
          },
        });
      }
      return route.fulfill({ json: { success: true, data: { saved: true } } });
    });
    await page.goto(`${base}/admin`);
    await procurementPanel.waitFor();
    await settingsTab.click();
    await openBatch.click();
    await batchIp.fill("蜘蛛人");
    await defaultStock.fill("9");
    await craftText.fill("亮銀龍｜10\n水波紋｜6\n雷射｜3");
    await batchDialog.getByLabel("批次上傳飯製圖片").setInputFiles([
      { name: "圖一.png", mimeType: "image/png", buffer: png },
      { name: "圖二.png", mimeType: "image/png", buffer: png },
    ]);
    assert.equal(await batchCount.innerText(), "6 件商品");
    const ownImage = (title) =>
      batchDialog.getByRole("region", {
        name: `${title}圖片工藝設定`,
        exact: true,
      });
    const imageText = (title) =>
      ownImage(title).getByLabel(`${title}圖片工藝文字`, { exact: true });
    const applyImage = (title) =>
      ownImage(title).getByRole("button", {
        name: `套用${title}圖片工藝`,
        exact: true,
      });
    await imageText("圖二").fill("亮銀龍\n水波紋");
    assert.equal(await createBatch.isDisabled(), true);
    assert.match(await batchHelp.innerText(), /1 張圖片.*尚未套用/);
    await applyImage("圖二").click();
    assert.equal(await batchCount.innerText(), "5 件商品");
    assert.equal(
      await ownImage("圖一")
        .getByRole("group", { name: /上架資料$/ })
        .count(),
      3,
    );
    assert.equal(
      await ownImage("圖二")
        .getByRole("group", { name: /上架資料$/ })
        .count(),
      2,
    );
    assert.equal(
      await row("圖二", "水波紋")
        .getByLabel("現貨庫存", { exact: true })
        .inputValue(),
      "6",
      "omitting stock in an image's craft list must retain that craft's current stock",
    );
    await row("圖二", "水波紋")
      .getByLabel("現貨庫存", { exact: true })
      .fill("8");
    const secondVideo = row("圖二", "水波紋").getByLabel(
      "圖二 水波紋實拍影片",
      {
        exact: true,
      },
    );
    await secondVideo.setInputFiles({
      name: "圖二-water.mov",
      mimeType: "video/quicktime",
      buffer: Buffer.from("second image video"),
    });
    const secondPreview = await row("圖二", "水波紋")
      .getByRole("img")
      .getAttribute("src");
    await imageText("圖一").fill("亮銀龍\n水波紋\n雷射\n燙金｜2");
    await applyImage("圖一").click();
    assert.equal(await batchCount.innerText(), "6 件商品");
    assert.equal(
      await row("圖二", "水波紋")
        .getByLabel("現貨庫存", { exact: true })
        .inputValue(),
      "8",
    );
    assert.equal(
      await secondVideo.evaluate((input) => input.files[0]?.name),
      "圖二-water.mov",
    );
    assert.equal(
      await row("圖二", "水波紋").getByRole("img").getAttribute("src"),
      secondPreview,
    );
    assert.equal(
      await row("圖一", "燙金")
        .getByLabel("圖一 燙金實拍影片", { exact: true })
        .evaluate((input) => input.files.length),
      0,
      "a newly added craft must never inherit another craft's video",
    );
    await row("圖一", "雷射")
      .getByLabel("圖一 雷射實拍影片", { exact: true })
      .setInputFiles({
        name: "remove-laser.mov",
        mimeType: "video/quicktime",
        buffer: Buffer.from("removed craft video"),
      });
    await imageText("圖一").fill("亮銀龍\n水波紋\n燙金｜2");
    const beforeOwnRemoval = confirmations.length;
    dismissNextConfirm = true;
    await applyImage("圖一").click();
    assert.equal(confirmations.length, beforeOwnRemoval + 1);
    assert.equal(await batchCount.innerText(), "6 件商品");
    assert.equal(
      await row("圖一", "雷射")
        .getByLabel("圖一 雷射實拍影片", { exact: true })
        .evaluate((input) => input.files[0]?.name),
      "remove-laser.mov",
      "cancelling craft removal must retain its selected video file",
    );
    await applyImage("圖一").click();
    assert.equal(confirmations.length, beforeOwnRemoval + 2);
    assert.equal(await batchCount.innerText(), "5 件商品");
    assert.equal(await row("圖一", "雷射").count(), 0);
    assert.equal(
      await ownImage("圖一")
        .getByRole("group", { name: /上架資料$/ })
        .count(),
      3,
    );
    assert.equal(
      await ownImage("圖二")
        .getByRole("group", { name: /上架資料$/ })
        .count(),
      2,
    );
    await imageText("圖一").fill("亮銀龍｜-1");
    assert.equal(await applyImage("圖一").isDisabled(), true);
    assert.equal(await createBatch.isDisabled(), true);
    assert.equal(await batchCount.innerText(), "5 件商品");
    await imageText("圖一").fill(
      Array.from({ length: 49 }, (_, index) => `獨立工藝${index}｜1`).join(
        "\n",
      ),
    );
    assert.equal(await applyImage("圖一").isDisabled(), true);
    assert.equal(await batchCount.innerText(), "5 件商品");
    assert.match(await ownImage("圖一").innerText(), /50/);
    await imageText("圖一").fill("亮銀龍｜10\n水波紋｜6\n燙金｜2");
    assert.equal(await createBatch.isEnabled(), true);
    await craftText.fill("霧面｜1");
    assert.equal(await createBatch.isEnabled(), true);
    assert.equal(await batchCount.innerText(), "5 件商品");
    assert.equal(
      await ownImage("圖一")
        .getByRole("group", { name: /上架資料$/ })
        .count(),
      3,
    );
    assert.equal(
      await ownImage("圖二")
        .getByRole("group", { name: /上架資料$/ })
        .count(),
      2,
    );
    await batchDialog.getByLabel("批次上傳飯製圖片").setInputFiles({
      name: "新圖.png",
      mimeType: "image/png",
      buffer: png,
    });
    assert.equal(await batchCount.innerText(), "6 件商品");
    assert.equal(
      await ownImage("新圖")
        .getByRole("group", { name: /上架資料$/ })
        .count(),
      1,
    );
    await row("新圖", "霧面")
      .getByRole("button", { name: "移除此列", exact: true })
      .click();
    assert.equal(await batchCount.innerText(), "5 件商品");
    await ownImage("圖二").evaluate((element) =>
      element.scrollIntoView({ block: "start" }),
    );
    assert.equal(
      await batchDialog.evaluate((dialog) => {
        const body = dialog.children[1];
        return body.scrollWidth <= body.clientWidth;
      }),
      true,
      "per-image craft editors must fit the dialog without horizontal scrolling",
    );
    await batchDialog.screenshot({
      path: `/tmp/archive-fanmade-per-image-${width}.png`,
      animations: "disabled",
    });
    assert.equal(await page.evaluate(() => window.imageUploads || 0), 0);
    await createBatch.click();
    await ownBatchStarted;
    assert.equal(await imageText("圖一").isDisabled(), true);
    assert.equal(await imageText("圖二").isDisabled(), true);
    assert.equal(await applyImage("圖一").isDisabled(), true);
    assert.equal(await secondVideo.isDisabled(), true);
    releaseOwnBatch();
    await retryBatch.waitFor();
    assert.equal(await imageText("圖一").isDisabled(), true);
    assert.equal(await page.evaluate(() => window.imageUploads), 2);
    await retryBatch.click();
    await batchDialog
      .getByRole("status")
      .filter({ hasText: "已建立 5 件獨立飯製商品" })
      .waitFor();
    assert.deepEqual(ownBatches[0], ownBatches[1]);
    assert.deepEqual(
      ownBatches[0].items.map(({ title, craft, stock }) => ({
        title,
        craft,
        stock,
      })),
      [
        { title: "圖一", craft: "亮銀龍", stock: 10 },
        { title: "圖一", craft: "水波紋", stock: 6 },
        { title: "圖一", craft: "燙金", stock: 2 },
        { title: "圖二", craft: "亮銀龍", stock: 10 },
        { title: "圖二", craft: "水波紋", stock: 8 },
      ],
    );
    assert.equal(await page.evaluate(() => window.imageUploads), 2);
    assert.equal(await page.evaluate(() => window.videoUploads), 1);
    assert.equal(
      ownActions.filter((input) => input.action === "video").length,
      1,
    );
    assert.equal(
      ownActions.find((input) => input.action === "video").productId,
      id(704),
    );
    assert.equal(await batchCount.innerText(), "0 件商品");
    await closeBatch.click();
    // A single IP owns many images, which can be selected together, appended, or dropped.
    await page.unroute("**/api/fanmade**");
    const ipBatches = [],
      ipActions = [];
    let releaseIpBatch, notifyIpBatchStarted;
    const ipBatchStarted = new Promise((done) => {
      notifyIpBatchStarted = done;
    });
    await page.route("**/api/fanmade**", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({
          json: {
            success: true,
            data: {
              price: 350,
              forms: [{ id: 1, title: "飯製表單", token: id(2), isOpen: true }],
              products: [],
              total: 0,
              variantTotal: 0,
              legacy: [],
            },
          },
        });
      const input = route.request().postDataJSON();
      ipActions.push(input);
      if (input.action === "batch") {
        ipBatches.push(input);
        await new Promise((done) => {
          releaseIpBatch = done;
          notifyIpBatchStarted();
        });
        const productIds = input.items.map((_, index) => id(800 + index));
        return route.fulfill({
          json: {
            success: true,
            data: {
              productIds,
              versions: Object.fromEntries(
                productIds.map((productId) => [
                  productId,
                  "2026-11-16T00:00:00Z",
                ]),
              ),
            },
          },
        });
      }
      return route.fulfill({ json: { success: true, data: { saved: true } } });
    });
    await page.goto(`${base}/admin`);
    await procurementPanel.waitFor();
    await settingsTab.click();
    await openBatch.click();
    await batchIp.fill("");
    await defaultStock.fill("9");
    await craftText.fill("亮銀龍｜10\n水波紋｜6");
    await batchDialog.getByLabel("批次上傳飯製圖片").setInputFiles([
      { name: "蜘蛛夜景.png", mimeType: "image/png", buffer: png },
      { name: "蜘蛛晨光.png", mimeType: "image/png", buffer: png },
    ]);
    const ipGroup = batchDialog.getByRole("region", {
      name: "本批IP與海報",
      exact: true,
    });
    await ipGroup
      .getByRole("heading", { name: "尚未填寫IP", exact: true })
      .waitFor();
    assert.match(await ipGroup.innerText(), /2 張海報圖片.*4 件工藝商品/);
    const firstIpVideo = row("蜘蛛夜景", "水波紋").getByLabel(
      "蜘蛛夜景 水波紋實拍影片",
      { exact: true },
    );
    await row("蜘蛛夜景", "水波紋")
      .getByLabel("現貨庫存", { exact: true })
      .fill("7");
    await firstIpVideo.setInputFiles({
      name: "蜘蛛夜景-water.mov",
      mimeType: "video/quicktime",
      buffer: Buffer.from("night water craft video"),
    });
    const firstIpPreview = await row("蜘蛛夜景", "水波紋")
      .getByRole("img")
      .getAttribute("src");
    await batchIp.fill("蜘蛛人");
    await ipGroup
      .getByRole("heading", { name: "蜘蛛人", exact: true })
      .waitFor();
    assert.equal(
      await firstIpVideo.evaluate((input) => input.files[0]?.name),
      "蜘蛛夜景-water.mov",
      "filling the shared IP must not remount selected video inputs",
    );
    await ownImage("蜘蛛夜景")
      .getByLabel("蜘蛛夜景海報名稱", { exact: true })
      .fill("蜘蛛夜景改名");
    assert.equal(await row("蜘蛛夜景改名", "亮銀龍").count(), 1);
    assert.equal(await row("蜘蛛夜景改名", "水波紋").count(), 1);
    assert.equal(
      await row("蜘蛛夜景改名", "水波紋")
        .getByLabel("蜘蛛夜景改名 水波紋實拍影片", { exact: true })
        .evaluate((input) => input.files[0]?.name),
      "蜘蛛夜景-water.mov",
      "renaming one poster must preserve the selected video for every craft",
    );
    assert.equal(
      await row("蜘蛛夜景改名", "水波紋")
        .getByLabel("現貨庫存", { exact: true })
        .inputValue(),
      "7",
    );
    await ownImage("蜘蛛夜景改名")
      .getByLabel("蜘蛛夜景改名海報名稱", { exact: true })
      .fill("蜘蛛夜景");
    assert.equal(
      await firstIpVideo.evaluate((input) => input.files[0]?.name),
      "蜘蛛夜景-water.mov",
    );
    await imageText("蜘蛛晨光").fill("亮銀龍");
    await applyImage("蜘蛛晨光").click();
    const secondIpVideo = row("蜘蛛晨光", "亮銀龍").getByLabel(
      "蜘蛛晨光 亮銀龍實拍影片",
      { exact: true },
    );
    await secondIpVideo.setInputFiles({
      name: "蜘蛛晨光-bright.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("morning bright craft video"),
    });
    const addIpImages = ipGroup.getByRole("button", {
      name: "繼續加入圖片",
      exact: true,
    });
    const [appendChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      addIpImages.click(),
    ]);
    await appendChooser.setFiles({
      name: "蜘蛛屋頂.png",
      mimeType: "image/png",
      buffer: png,
    });
    assert.equal(await batchCount.innerText(), "5 件商品");
    assert.match(await ipGroup.innerText(), /3 張海報圖片.*5 件工藝商品/);
    for (const [input, filename] of [
      [firstIpVideo, "蜘蛛夜景-water.mov"],
      [secondIpVideo, "蜘蛛晨光-bright.mp4"],
    ])
      assert.equal(
        await input.evaluate((element) => element.files[0]?.name),
        filename,
        "appending more images must preserve existing craft video File objects",
      );
    assert.equal(
      await row("蜘蛛夜景", "水波紋")
        .getByLabel("現貨庫存", { exact: true })
        .inputValue(),
      "7",
    );
    assert.equal(
      await row("蜘蛛夜景", "水波紋").getByRole("img").getAttribute("src"),
      firstIpPreview,
    );
    for (const craft of ["亮銀龍", "水波紋"])
      assert.equal(
        await row("蜘蛛屋頂", craft)
          .getByLabel(`蜘蛛屋頂 ${craft}實拍影片`, { exact: true })
          .evaluate((input) => input.files.length),
        0,
        "new images must not inherit existing craft videos",
      );
    await craftText.fill("雷射｜2");
    const ipDropZone = batchDialog.getByLabel("IP海報批量選圖", {
      exact: true,
    });
    const dropImages = async (names) => {
      const dataTransfer = await page.evaluateHandle(
        ({ bytes, filenames }) => {
          const transfer = new DataTransfer();
          for (const filename of filenames)
            transfer.items.add(
              new File([new Uint8Array(bytes)], filename, {
                type: "image/png",
              }),
            );
          return transfer;
        },
        { bytes: [...png], filenames: names },
      );
      await ipDropZone.dispatchEvent("dragover", { dataTransfer });
      await ipDropZone.dispatchEvent("drop", { dataTransfer });
      await dataTransfer.dispose();
    };
    await dropImages(["蜘蛛街景.png", "蜘蛛天台.png"]);
    assert.equal(await batchCount.innerText(), "7 件商品");
    assert.match(await ipGroup.innerText(), /5 張海報圖片.*7 件工藝商品/);
    assert.equal(
      await firstIpVideo.evaluate((input) => input.files[0]?.name),
      "蜘蛛夜景-water.mov",
    );
    assert.equal(
      await secondIpVideo.evaluate((input) => input.files[0]?.name),
      "蜘蛛晨光-bright.mp4",
    );
    assert.equal(await page.evaluate(() => window.imageUploads || 0), 0);
    assert.equal(await page.evaluate(() => window.videoUploads || 0), 0);
    await ipGroup.evaluate((element) =>
      element.scrollIntoView({ block: "start" }),
    );
    assert.equal(
      await batchDialog.evaluate((dialog) => {
        const body = dialog.children[1];
        return body.scrollWidth <= body.clientWidth;
      }),
      true,
      "the shared IP and multiple images must fit the batch dialog",
    );
    await batchDialog.screenshot({
      path: `/tmp/archive-fanmade-ip-batch-${width}.png`,
      animations: "disabled",
    });
    await createBatch.click();
    await ipBatchStarted;
    assert.equal(await addIpImages.isDisabled(), true);
    await dropImages(["busy-ignored.png"]);
    assert.equal(await batchCount.innerText(), "7 件商品");
    releaseIpBatch();
    await batchDialog
      .getByRole("status")
      .filter({ hasText: "已建立 7 件獨立飯製商品" })
      .waitFor();
    assert.equal(ipBatches.length, 1);
    assert.deepEqual(
      ipBatches[0].items.map(({ ip, title, craft, stock }) => ({
        ip,
        title,
        craft,
        stock,
      })),
      [
        { ip: "蜘蛛人", title: "蜘蛛夜景", craft: "亮銀龍", stock: 10 },
        { ip: "蜘蛛人", title: "蜘蛛夜景", craft: "水波紋", stock: 7 },
        { ip: "蜘蛛人", title: "蜘蛛晨光", craft: "亮銀龍", stock: 10 },
        { ip: "蜘蛛人", title: "蜘蛛屋頂", craft: "亮銀龍", stock: 10 },
        { ip: "蜘蛛人", title: "蜘蛛屋頂", craft: "水波紋", stock: 6 },
        { ip: "蜘蛛人", title: "蜘蛛街景", craft: "雷射", stock: 2 },
        { ip: "蜘蛛人", title: "蜘蛛天台", craft: "雷射", stock: 2 },
      ],
    );
    assert.deepEqual(
      ipBatches[0].items[0].imagePaths,
      ipBatches[0].items[1].imagePaths,
    );
    assert.deepEqual(
      ipBatches[0].items[3].imagePaths,
      ipBatches[0].items[4].imagePaths,
    );
    assert.equal(await page.evaluate(() => window.imageUploads), 5);
    assert.equal(await page.evaluate(() => window.videoUploads), 2);
    const uploadedVideos = await page.evaluate(() => window.uploadedVideoFiles);
    assert.deepEqual(
      ipActions
        .filter((input) => input.action === "video")
        .map(({ productId, sourcePath }) => ({
          productId,
          filename: uploadedVideos.find((file) => file.path === sourcePath)
            ?.name,
        }))
        .sort((a, b) => a.productId.localeCompare(b.productId)),
      [
        { productId: id(801), filename: "蜘蛛夜景-water.mov" },
        { productId: id(802), filename: "蜘蛛晨光-bright.mp4" },
      ],
      "each craft must upload its own selected video and bind it to the correct created SKU",
    );
    assert.equal(await batchCount.innerText(), "0 件商品");
    await closeBatch.click();
    // Equivalent craft text must not make a complete batch look blocked, and real errors stay beside Create.
    await page.unroute("**/api/fanmade**");
    const grayBatches = [],
      grayActions = [];
    await page.route("**/api/fanmade**", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({
          json: {
            success: true,
            data: {
              price: 350,
              forms: [{ id: 1, title: "飯製表單", token: id(2), isOpen: true }],
              products: [],
              total: 0,
              variantTotal: 0,
              legacy: [],
            },
          },
        });
      const input = route.request().postDataJSON();
      grayActions.push(input);
      if (input.action === "batch") {
        grayBatches.push(input);
        const productIds = input.items.map((_, index) => id(1000 + index));
        return route.fulfill({
          json: {
            success: true,
            data: {
              productIds,
              versions: Object.fromEntries(
                productIds.map((productId) => [
                  productId,
                  "2026-11-16T00:00:00Z",
                ]),
              ),
            },
          },
        });
      }
      return route.fulfill({ json: { success: true, data: { saved: true } } });
    });
    await page.goto(`${base}/admin`);
    await procurementPanel.waitFor();
    await settingsTab.click();
    await openBatch.click();
    await batchIp.fill("蜘蛛人");
    await defaultStock.fill("5");
    await craftText.fill("亮銀龍｜10\n水波紋｜6");
    await batchDialog.getByLabel("批次上傳飯製圖片").setInputFiles({
      name: "等效測試.png",
      mimeType: "image/png",
      buffer: png,
    });
    const grayText = imageText("等效測試");
    const grayStock = row("等效測試", "水波紋").getByLabel("現貨庫存", {
      exact: true,
    });
    const grayVideo = row("等效測試", "水波紋").getByLabel(
      "等效測試 水波紋實拍影片",
      { exact: true },
    );
    await grayStock.fill("8");
    await grayVideo.setInputFiles({
      name: "equivalent-water.mov",
      mimeType: "video/quicktime",
      buffer: Buffer.from("equivalent-text video fixture"),
    });
    for (const text of [
      "亮銀龍｜10\n水波紋｜8\n",
      " 亮銀龍 ｜ 10 \n 水波紋 ｜ 8 ",
      "亮銀龍、水波紋",
      "亮銀龍, 水波紋",
      "亮銀龍\t10\n水波紋\t8",
    ]) {
      await grayText.fill(text);
      assert.equal(
        await createBatch.isEnabled(),
        true,
        "whitespace, trailing newlines and equivalent separators must not block a complete batch",
      );
      assert.equal(await grayStock.isEnabled(), true);
      assert.equal(await grayStock.inputValue(), "8");
      assert.equal(
        await grayVideo.evaluate((input) => input.files[0]?.name),
        "equivalent-water.mov",
      );
    }
    await grayText.fill("亮銀龍、水波紋\n");
    await grayText.press("Tab");
    await grayStock.fill("9");
    assert.equal(
      await createBatch.isEnabled(),
      true,
      "after equivalent text loses focus, editing stock must not revive a stale text draft",
    );
    await grayText.fill("亮銀龍｜10\n水波紋｜9");
    await grayText.press("End");
    await grayText.press("Enter");
    assert.equal(await grayText.inputValue(), "亮銀龍｜10\n水波紋｜9\n");
    assert.equal(await createBatch.isEnabled(), true);
    await grayText.pressSequentially("雷射｜2");
    assert.equal(await grayText.inputValue(), "亮銀龍｜10\n水波紋｜9\n雷射｜2");
    assert.equal(await createBatch.isDisabled(), true);
    await batchDialog
      .getByRole("button", { name: "前往未套用的圖片", exact: true })
      .click();
    await page.waitForFunction(
      (element) => element === document.activeElement,
      await grayText.elementHandle(),
    );
    await applyImage("等效測試").click();
    assert.equal(await batchCount.innerText(), "3 件商品");
    assert.equal(await createBatch.isEnabled(), true);
    assert.equal(await grayStock.inputValue(), "9");
    assert.equal(
      await grayVideo.evaluate((input) => input.files[0]?.name),
      "equivalent-water.mov",
    );
    await craftText.fill("霧面｜2\n燙金｜3");
    const longTitle = "長".repeat(201);
    await batchDialog.getByLabel("批次上傳飯製圖片").setInputFiles({
      name: `${longTitle}.png`,
      mimeType: "image/png",
      buffer: png,
    });
    assert.equal(await batchCount.innerText(), "5 件商品");
    await row(longTitle, "霧面")
      .getByLabel(`${longTitle} 霧面實拍影片`, { exact: true })
      .setInputFiles({
        name: "long-name-matte.mov",
        mimeType: "video/quicktime",
        buffer: Buffer.from("retained while fixing the shared poster name"),
      });
    await createBatch.click();
    await batchError.waitFor();
    assert.match(await batchError.innerText(), /名稱/);
    assert.match(await batchError.innerText(), /200/);
    assert.equal(
      await batchError.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.top >= 0 &&
          bounds.bottom <= innerHeight &&
          bounds.left >= 0 &&
          bounds.right <= innerWidth
        );
      }),
      true,
      "validation errors must be visible beside Create without scrolling to the top",
    );
    await batchDialog.screenshot({
      path: `/tmp/archive-fanmade-batch-error-${width}.png`,
      animations: "disabled",
    });
    if (width === 375) {
      await page.setViewportSize({ width, height: 420 });
      for (const control of [
        batchError,
        createBatch,
        batchDialog.getByRole("button", { name: "查看問題欄位", exact: true }),
      ])
        assert.equal(
          await control.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return (
              bounds.top >= 0 &&
              bounds.bottom <= innerHeight &&
              bounds.left >= 0 &&
              bounds.right <= innerWidth
            );
          }),
          true,
          "errors and corrective actions must remain visible with a short mobile viewport",
        );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await batchDialog.screenshot({
        path: "/tmp/archive-fanmade-batch-error-short.png",
        animations: "disabled",
      });
      await page.setViewportSize({ width, height: 950 });
    }
    assert.equal(await page.evaluate(() => window.imageUploads || 0), 0);
    assert.equal(await page.evaluate(() => window.videoUploads || 0), 0);
    assert.equal(grayBatches.length, 0);
    const invalidName = ownImage(longTitle).getByLabel(`${longTitle}海報名稱`, {
      exact: true,
    });
    await batchDialog
      .getByRole("button", { name: "查看問題欄位", exact: true })
      .click();
    await invalidName.waitFor({ state: "visible" });
    await page.waitForFunction(
      (element) => element === document.activeElement,
      await invalidName.elementHandle(),
    );
    assert.equal(
      await row(longTitle, "霧面").locator("details").getAttribute("open"),
      "",
      "the issue action must reveal the advanced field that needs correction",
    );
    await invalidName.fill("修正名稱");
    assert.equal(await row("修正名稱", "霧面").count(), 1);
    assert.equal(await row("修正名稱", "燙金").count(), 1);
    assert.equal(
      await row("修正名稱", "霧面")
        .getByLabel("修正名稱 霧面實拍影片", { exact: true })
        .evaluate((input) => input.files[0]?.name),
      "long-name-matte.mov",
      "fixing a shared long poster name must retain every craft's selected video",
    );
    await createBatch.click();
    await batchDialog
      .getByRole("status")
      .filter({ hasText: "已建立 5 件獨立飯製商品" })
      .waitFor();
    assert.equal(grayBatches.length, 1);
    assert.deepEqual(
      grayBatches[0].items.map(({ title, craft, stock }) => ({
        title,
        craft,
        stock,
      })),
      [
        { title: "等效測試", craft: "亮銀龍", stock: 10 },
        { title: "等效測試", craft: "水波紋", stock: 9 },
        { title: "等效測試", craft: "雷射", stock: 2 },
        { title: "修正名稱", craft: "霧面", stock: 2 },
        { title: "修正名稱", craft: "燙金", stock: 3 },
      ],
    );
    assert.equal(await page.evaluate(() => window.imageUploads), 2);
    assert.equal(await page.evaluate(() => window.videoUploads), 2);
    assert.deepEqual(
      grayActions
        .filter((input) => input.action === "video")
        .map((input) => input.productId)
        .sort(),
      [id(1001), id(1003)],
    );
    assert.equal(await batchError.isVisible(), false);
    await closeBatch.click();
    // A new inventory can upload before creating any form, then save its shared price and first form.
    await page.unroute("**/api/fanmade**");
    let setupPrice = 350;
    let setupForms = [];
    const setupActions = [];
    await page.route("**/api/fanmade**", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          json: {
            success: true,
            data: {
              price: setupPrice,
              forms: setupForms,
              products: [],
              total: 0,
              variantTotal: 0,
              legacy: [],
            },
          },
        });
      }
      const input = route.request().postDataJSON();
      setupActions.push(input);
      if (input.action === "price") setupPrice = input.price;
      if (input.action === "create_form") {
        setupForms = [
          { id: 8, title: input.title, token: id(8), isOpen: true },
        ];
        return route.fulfill({
          json: { success: true, data: { formId: 8, saved: true } },
        });
      }
      if (input.action === "form") {
        setupForms = setupForms.map((form) =>
          form.id === input.formId
            ? { ...form, title: input.title, isOpen: input.isOpen }
            : form,
        );
      }
      return route.fulfill({ json: { success: true, data: { saved: true } } });
    });
    await page.goto(`${base}/admin`);
    await page
      .getByText("目前沒有符合條件的飯製商品。", { exact: true })
      .waitFor();
    assert.equal(await procurementTab.isDisabled(), true);
    assert.equal(await settingsTab.getAttribute("aria-selected"), "true");
    assert.equal(
      await page.getByLabel("新表單名稱", { exact: true }).isVisible(),
      true,
    );
    assert.equal(await openBatch.isEnabled(), true);
    await openBatch.click();
    await batchDialog.waitFor();
    assert.match(await batchDialog.innerText(), /本批商品先存入飯製庫存/);
    await closeBatch.click();
    await page.getByLabel("新表單名稱", { exact: true }).fill("第一份飯製表單");
    await page
      .getByRole("button", { name: "建立飯製表單", exact: true })
      .click();
    await page
      .getByRole("option", { name: "第一份飯製表單 · 接單中", exact: true })
      .waitFor({ state: "attached" });
    assert.equal(
      await page.getByLabel("飯製訂購表單", { exact: true }).inputValue(),
      "8",
    );
    assert.equal(setupActions[0].action, "create_form");
    assert.equal(setupActions[0].title, "第一份飯製表單");
    await settingsTab.click();
    await page.getByLabel("表單名稱", { exact: true }).fill("重新命名飯製表單");
    await page
      .getByRole("button", { name: "儲存表單設定", exact: true })
      .click();
    await page
      .getByRole("option", { name: "重新命名飯製表單 · 接單中", exact: true })
      .waitFor({ state: "attached" });
    assert.deepEqual(
      {
        action: setupActions[1].action,
        formId: setupActions[1].formId,
        title: setupActions[1].title,
        isOpen: setupActions[1].isOpen,
      },
      { action: "form", formId: 8, title: "重新命名飯製表單", isOpen: true },
    );
    setupPrice = null;
    setupForms = [];
    await page.goto(`${base}/admin`);
    await page
      .getByText("請先儲存統一售價，再建立表單。", { exact: true })
      .waitFor();
    assert.equal(await procurementTab.isDisabled(), true);
    assert.equal(await settingsTab.getAttribute("aria-selected"), "true");
    const createFirstForm = page.getByRole("button", {
      name: "建立飯製表單",
      exact: true,
    });
    assert.equal(await createFirstForm.isDisabled(), true);
    await openBatch.click();
    await batchDialog.waitFor();
    assert.match(
      await batchDialog.innerText(),
      /請先在飯製管理主頁儲存統一價格/,
    );
    assert.equal(await createBatch.isDisabled(), true);
    await batchIp.fill("蜘蛛人");
    await batchDialog.getByLabel("批次上傳飯製圖片").setInputFiles({
      name: "待定售價.png",
      mimeType: "image/png",
      buffer: png,
    });
    const priceVideo = row("待定售價", "亮銀龍").getByLabel(
      "待定售價 亮銀龍實拍影片",
      { exact: true },
    );
    await priceVideo.setInputFiles({
      name: "price-pending.mov",
      mimeType: "video/quicktime",
      buffer: Buffer.from("retained while setting unified price"),
    });
    const pricePreview = await row("待定售價", "亮銀龍")
      .getByRole("img")
      .getAttribute("src");
    await batchDialog
      .getByRole("button", { name: "前往設定統一售價", exact: true })
      .click();
    await batchDialog.waitFor({ state: "hidden" });
    assert.equal(await uniformPrice.isVisible(), true);
    await uniformPrice.fill("350");
    await page
      .getByRole("button", { name: "儲存統一價格", exact: true })
      .click();
    await page.getByRole("status").filter({ hasText: "設定已儲存" }).waitFor();
    assert.equal(await createFirstForm.isEnabled(), true);
    assert.equal(
      await page.getByLabel("新表單名稱", { exact: true }).isVisible(),
      true,
    );
    assert.equal(setupActions[2].action, "price");
    assert.equal(setupActions[2].price, 350);
    await openBatch.click();
    assert.equal(await batchCount.innerText(), "1 件商品");
    assert.equal(
      await row("待定售價", "亮銀龍").getByRole("img").getAttribute("src"),
      pricePreview,
    );
    assert.equal(
      await priceVideo.evaluate((input) => input.files[0]?.name),
      "price-pending.mov",
    );
    assert.equal(await createBatch.isEnabled(), true);
    await closeBatch.click();
    assert.equal(errors.length, 0, errors.join("\n"));
    await page.close();
    console.log(
      `飯製 UI ${width}px：管理分頁與草稿保留、按需載入、送單收據、批量對話框與範例、多工藝展開與依序配對、共用圖片、獨立庫存與影片、上限保護及重開／重載重試通過`,
    );
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
