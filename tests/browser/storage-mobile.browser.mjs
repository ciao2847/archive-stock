// Runs the location workspace against isolated API fixtures.
// Run: node tests/browser/storage-mobile.browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import { chromium } from "playwright";
const ownerId = "00000000-0000-4000-8000-000000000001";
const bundle = await build({
  outfile: "/tmp/poster-storage-fixture.js",
  plugins: [
    {
      name: "styles",
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
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {QueryClient,QueryClientProvider} from '@tanstack/react-query'; import {LocationManager} from './src/components/locations/LocationManager'; const client=new QueryClient({defaultOptions:{queries:{retry:false}}}); createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><LocationManager ownerId='${ownerId}'/></QueryClientProvider>);`,
  },
});
const css = compile("styles/app.global.scss", {
  silenceDeprecations: ["import", "global-builtin", "color-functions"],
}).css;
const server = createServer((request, response) => {
  if (request.url === "/app.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(
      bundle.outputFiles.find((file) => file.path.endsWith(".js")).text,
    );
  } else if (request.url === "/app.css") {
    response.setHeader("Content-Type", "text/css");
    response.end(
      css +
        "\n" +
        bundle.outputFiles
          .filter((file) => file.path.endsWith(".css"))
          .map((file) => file.text)
          .join("\n"),
    );
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cabinet = {
  id: uid(100),
  name: "海報櫃",
  code: "A",
  rows: 3,
  columns: 5,
};
const slots = Array.from({ length: 15 }, (_, i) => ({
  id: uid(200 + i),
  code: `A-${String(Math.floor(i / 5) + 1).padStart(2, "0")}-${String((i % 5) + 1).padStart(2, "0")}`,
  cabinet_id: cabinet.id,
  display_name:
    [
      "韓國海報",
      "日本海報",
      "台灣海報",
      "空格",
      "IMAX",
      "Dolby",
      "特殊工藝",
      "大尺寸",
      "待整理",
      "預留商品",
      "包裝區",
      "其他",
    ][i] ?? "新庫位",
  shelf: Math.floor(i / 5) + 1,
  bin: (i % 5) + 1,
}));
const otherCabinets = [
  { id: uid(101), name: "日本櫃", code: "B", rows: 2, columns: 3 },
  { id: uid(102), name: "小櫃", code: "C", rows: 1, columns: 1 },
];
const otherSlots = otherCabinets.flatMap((c, ci) =>
  Array.from({ length: c.rows * c.columns }, (_, i) => ({
    id: uid(300 + ci * 50 + i),
    cabinet_id: c.id,
    code: `${c.code}-${String(Math.floor(i / c.columns) + 1).padStart(2, "0")}-${String((i % c.columns) + 1).padStart(2, "0")}`,
    display_name: `${c.code} 格 ${i + 1}`,
    shelf: Math.floor(i / c.columns) + 1,
    bin: (i % c.columns) + 1,
  })),
);
const products = [
  {
    id: uid(500),
    sku: "A000038",
    name: "待整理海報",
    country: "韓國",
    price: 700,
    stock: 5,
    allocations: [],
  },
  {
    id: uid(501),
    name: "已入庫海報",
    country: "日本",
    price: 550,
    stock: 2,
    allocations: [{ location_id: slots[0].id, quantity: 2 }],
  },
];
products.push(
  ...Array.from({ length: 40 }, (_, index) => ({
    id: uid(600 + index),
    sku: `B${String(index).padStart(6, "0")}`,
    name: `測試商品${index}`,
    country: "台灣",
    price: 100,
    stock: 5,
    allocations: [],
  })),
);
const actions = [];
await page.route("**/api/locations**", async (route) => {
  const request = route.request();
  if (request.method() === "PATCH") {
    const input = request.postDataJSON();
    actions.push(input);
    if (input.action === "putaway")
      for (const item of input.items) {
        const p = products.find((p) => p.id === item.productId);
        if (item.fromLocationId) {
          const from = p.allocations.find(
            (a) => a.location_id === item.fromLocationId,
          );
          from.quantity -= item.quantity;
          p.allocations = p.allocations.filter((a) => a.quantity > 0);
        }
        const existing = p.allocations.find(
          (a) => a.location_id === input.locationId,
        );
        if (existing) existing.quantity += item.quantity;
        else
          p.allocations.push({
            location_id: input.locationId,
            quantity: item.quantity,
          });
      }
    if (input.action === "rename_slot")
      [...slots, ...otherSlots].find((s) => s.id === input.id).display_name =
        input.name;
    if (input.action === "create_cabinet") {
      const created = {
        id: uid(103),
        code: "D",
        name: input.name,
        rows: input.rows,
        columns: input.columns,
      };
      otherCabinets.push(created);
      otherSlots.push(
        ...Array.from({ length: created.rows * created.columns }, (_, i) => ({
          id: uid(400 + i),
          cabinet_id: created.id,
          code: `D-${String(Math.floor(i / created.columns) + 1).padStart(2, "0")}-${String((i % created.columns) + 1).padStart(2, "0")}`,
          display_name: "新庫位",
          shelf: Math.floor(i / created.columns) + 1,
          bin: (i % created.columns) + 1,
        })),
      );
    }
    if (input.action === "quick_add")
      products.push({
        id: uid(600 + actions.length),
        name: input.name,
        country: input.country,
        price: input.price,
        stock: input.quantity,
        allocations: input.locationId
          ? [{ location_id: input.locationId, quantity: input.quantity }]
          : [],
      });
    return route.fulfill({ json: { success: true, data: { updated: true } } });
  }
  return route.fulfill({
    json: {
      success: true,
      data: {
        cabinets: [cabinet, ...otherCabinets],
        slots: [...slots, ...otherSlots],
        products,
      },
    },
  });
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "庫位", exact: true }).waitFor();
  assert.equal(await page.locator(".storage-pending").isVisible(), false);
  await page.getByRole("button", { name: /^待整理（/ }).click();
  assert.equal(
    await page.locator(".storage-location-picker").isVisible(),
    false,
  );
  assert.equal(
    await page.locator(".storage-location-details").isVisible(),
    false,
  );
  const search = page.getByRole("searchbox", { name: "搜尋待整理海報" });
  await search.fill("a000038");
  assert.equal(
    await page.locator(".storage-pending .storage-product-row").count(),
    1,
  );
  await page
    .locator(".storage-pending")
    .getByRole("button", { name: "放入庫位", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const quantity = dialog.getByRole("spinbutton", {
    name: "待整理海報 放入數量",
  });
  assert.equal(
    await dialog
      .getByRole("button", {
        name: "減少 待整理海報 數量",
        includeHidden: true,
      })
      .isVisible(),
    true,
  );
  assert.equal(
    await dialog
      .getByRole("button", { name: "取消", exact: true, includeHidden: true })
      .isVisible(),
    false,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await dialog.getByRole("button", { name: "減少 待整理海報 數量" }).click();
  assert.equal(await quantity.inputValue(), "4");
  await dialog.getByRole("button", { name: "增加 待整理海報 數量" }).click();
  assert.equal(await quantity.inputValue(), "5");
  assert.equal(
    await dialog
      .getByRole("button", { name: "增加 待整理海報 數量" })
      .isDisabled(),
    true,
  );
  await quantity.fill("1");
  assert.equal(
    await dialog
      .getByRole("button", { name: "減少 待整理海報 數量" })
      .isDisabled(),
    true,
  );
  await quantity.press("ArrowUp");
  assert.equal(await quantity.inputValue(), "2");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
    "mobile dialog has no horizontal overflow",
  );
  await page.screenshot({ path: "/tmp/poster-putaway-mobile.png" });
  await dialog.locator("summary").click();
  assert.equal(
    await dialog.getByRole("radio").count(),
    slots.length + otherSlots.length,
  );
  await page.screenshot({ path: "/tmp/poster-destination-menu.png" });
  await dialog
    .getByRole("radio", { name: "日本櫃／B 格 1（B-01-01）", exact: true })
    .check();
  await dialog
    .getByRole("spinbutton", { name: "待整理海報 放入數量" })
    .fill("2");
  await dialog
    .getByRole("button", { name: "確認放入庫位", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(actions.at(-1).locationId, otherSlots[0].id);
  assert.equal(actions.at(-1).items[0].quantity, 2);
  assert.equal(await search.inputValue(), "a000038");
  assert.equal(
    await page
      .getByRole("button", { name: /^待整理（/ })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "庫位", exact: true }).click();
  await page.getByRole("button", { name: /^待整理（/ }).click();
  assert.equal(await search.inputValue(), "a000038");
  await search.fill("沒有此商品");
  await page.getByText("找不到符合的海報", { exact: true }).waitFor();
  await search.fill("待整理海報");
  assert.equal(
    await page.locator(".storage-pending .storage-product-row").count(),
    1,
  );
  await search.fill("");
  const farRow = page
    .locator(".storage-pending .storage-product-row")
    .filter({ hasText: "測試商品30" });
  await farRow.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await farRow.getByRole("button", { name: "放入庫位", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("spinbutton", { name: "測試商品30 放入數量" })
    .fill("1");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "確認放入庫位", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.ok(
    Math.abs((await page.evaluate(() => scrollY)) - before) < 3,
    "putaway preserves list scroll",
  );
  await page
    .getByRole("button", { name: "庫位", exact: true })
    .evaluate((e) => e.click());
  await page
    .getByRole("button", { name: /^待整理（/ })
    .evaluate((e) => e.click());
  assert.ok(
    Math.abs((await page.evaluate(() => scrollY)) - before) < 3,
    "tab switch preserves list scroll",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await page.locator(".storage-mobile-tabs").isVisible(), false);
  assert.equal(
    await page.locator(".storage-location-picker").isVisible(),
    true,
  );
  assert.equal(
    await page.locator(".storage-location-details").isVisible(),
    true,
  );
  assert.equal(await page.locator(".storage-pending").isVisible(), true);
  await page
    .locator(".storage-pending .storage-product-row")
    .first()
    .getByRole("button", { name: "放入庫位", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  assert.ok(
    await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
    "desktop dialog has no horizontal overflow",
  );
  await page.screenshot({ path: "/tmp/poster-putaway-desktop.png" });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "關閉", exact: true })
    .click();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: mobile tabs, SKU/name search, cross-cabinet putaway and quantity, preserved filter, desktop layout",
  );
} catch (error) {
  console.error(await page.locator("body").innerText());
  await page.screenshot({
    path: "/tmp/poster-storage-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
