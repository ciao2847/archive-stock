// Runs the location workspace against isolated API fixtures.
// Run after npm run build: node tests/browser/location-storage.browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
const ownerId = "00000000-0000-4000-8000-000000000001";
const bundle = await build({
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
const css = (
  await Promise.all(
    (await readdir(".next/static/chunks"))
      .filter((name) => name.endsWith(".css"))
      .map((name) => readFile(`.next/static/chunks/${name}`, "utf8")),
  )
).join("\n");
const server = createServer((request, response) => {
  if (request.url === "/app.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(bundle.outputFiles[0].text);
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
  await page.getByRole("button", { name: /韓國海報.*2 張/ }).waitFor();
  await page.getByRole("button", { name: "批次放入海報", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "選擇 待整理海報" }).check();
  await dialog.getByRole("button", { name: "減少 待整理海報 數量" }).click();
  assert.equal(
    await dialog
      .getByRole("spinbutton", { name: "待整理海報 放入數量" })
      .inputValue(),
    "4",
  );
  await dialog
    .getByRole("button", { name: "確認放入庫位", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(products[0].stock, 5);
  assert.equal(products[0].allocations[0].quantity, 4);
  await page.getByRole("button", { name: /日本海報.*可用/ }).click();
  assert.equal(
    await page.getByLabel("存放庫位").inputValue(),
    slots[0].id,
    "Quick-add remains pinned to the locked slot",
  );
  await page.getByLabel("名稱 *", { exact: true }).fill("快速建檔海報");
  await page.getByLabel("販售金額 NT$ *", { exact: true }).fill("500");
  await page.getByLabel("到貨數量 *", { exact: true }).fill("3");
  await page.getByRole("button", { name: /儲存並建立下一筆/ }).click();
  await page.waitForFunction(
    () => document.querySelector(".storage-quick-form input")?.value === "",
  );
  const quick = actions.find((a) => a.action === "quick_add");
  assert.equal(quick.quantity, 3);
  assert.equal(quick.locationId, slots[0].id);
  await page
    .getByRole("button", { name: "編輯 日本海報", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "編輯格位名稱" });
  await dialog.getByLabel("名稱", { exact: true }).fill("日本版本");
  await dialog.getByRole("button", { name: "儲存名稱" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: /^韓國海報.*張$/ }).click();
  const row = page
    .locator(".storage-main > div:nth-child(2) .storage-product-row")
    .filter({ hasText: "待整理海報" });
  await row.getByRole("button", { name: "搬移", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("搬移至").selectOption(slots[2].id);
  await dialog.getByLabel("搬移至").selectOption(slots[1].id);
  await dialog
    .getByRole("spinbutton", { name: "待整理海報 放入數量" })
    .fill("1");
  await dialog.getByRole("button", { name: "確認搬移", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(products[0].stock, 5);
  assert.equal(
    actions.filter((a) => a.action === "putaway").at(-1).locationId,
    slots[1].id,
  );
  assert.equal(
    products[0].allocations.reduce((s, a) => s + a.quantity, 0),
    4,
  );
  // Viewing another slot must have a distinct selected outline while quick-add stays locked.
  await page.getByRole("button", { name: /日本版本.*1 張/ }).click();
  assert.equal(await page.locator(".storage-slot.is-selected").count(), 1);
  assert.equal(await page.locator(".storage-slot.is-locked").count(), 1);
  assert.equal(
    await page.locator(".storage-slot.is-selected.is-locked").count(),
    0,
  );
  assert.equal(await page.locator(".storage-slot.is-available").count(), 13);
  for (const width of [320, 390, 531, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const cabinetLayout = await page
      .locator(".storage-cabinet")
      .evaluate((card) => {
        const area = card.querySelector(".storage-cabinet-board");
        const cells = [...card.querySelectorAll(".storage-slot")].map(
          (cell) => {
            const rect = cell.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            };
          },
        );
        return { cells, clipped: area.scrollWidth > area.clientWidth };
      });
    assert.equal(
      cabinetLayout.clipped,
      false,
      "All five columns fit the cabinet",
    );
    assert.equal(cabinetLayout.cells.length, 15);
    for (let i = 0; i < 15; i++) {
      assert.equal(
        cabinetLayout.cells[i].y,
        cabinetLayout.cells[Math.floor(i / 5) * 5].y,
      );
      assert.equal(cabinetLayout.cells[i].x, cabinetLayout.cells[i % 5].x);
    }
    await page.screenshot({
      path: `/tmp/poster-storage-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByLabel("名稱 *", { exact: true }).fill("跨櫃新海報");
  await page.getByRole("tab", { name: "B 櫃", exact: true }).click();
  assert.equal(
    await page
      .getByRole("tab", { name: "B 櫃", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await page.locator(".storage-cabinet").count(), 1);
  assert.equal(await page.locator(".storage-slot").count(), 6);
  assert.equal(
    await page.getByLabel("存放庫位").inputValue(),
    otherSlots[0].id,
  );
  assert.equal(
    await page.getByRole("checkbox", { name: "鎖定建檔庫位" }).isChecked(),
    false,
  );
  assert.equal(
    await page.getByLabel("名稱 *", { exact: true }).inputValue(),
    "跨櫃新海報",
  );
  await page.getByRole("button", { name: /儲存並建立下一筆/ }).click();
  await page.waitForFunction(
    () => document.querySelector(".storage-quick-form input")?.value === "",
  );
  assert.equal(
    actions.filter((a) => a.action === "quick_add").at(-1).locationId,
    otherSlots[0].id,
  );
  await page.getByRole("tab", { name: "B 櫃", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page
      .getByRole("tab", { name: "C 櫃", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await page.getByLabel("存放庫位").inputValue(),
    otherSlots.at(-1).id,
  );
  await page.getByRole("button", { name: "新增櫃子", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "新增櫃子" });
  await dialog.getByLabel("櫃子名稱").fill("新到貨櫃");
  await dialog.getByLabel("排數", { exact: true }).fill("1");
  await dialog.getByLabel("每排格數").fill("2");
  await dialog.getByRole("button", { name: "儲存櫃子" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("tab", { name: "D 櫃", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await page.locator(".storage-cabinet").count(), 1);
  assert.equal(await page.locator(".storage-slot").count(), 2);
  assert.equal(await page.getByLabel("存放庫位").inputValue(), uid(400));
  await page.getByRole("tab", { name: "A 櫃", exact: true }).click();

  // An eleven-column grid displays all 33 slots, at equal width and height, without horizontal scrolling.
  cabinet.columns = 11;
  const known = new Map(slots.map((s) => [`${s.shelf}-${s.bin}`, s]));
  slots.splice(
    0,
    slots.length,
    ...Array.from({ length: 33 }, (_, i) => {
      const row = Math.floor(i / 11) + 1,
        column = (i % 11) + 1;
      return (
        known.get(`${row}-${column}`) ?? {
          id: uid(800 + i),
          cabinet_id: cabinet.id,
          code: `A-${String(row).padStart(2, "0")}-${String(column).padStart(2, "0")}`,
          display_name: "新庫位",
          shelf: row,
          bin: column,
        }
      );
    }),
  );
  await page.reload();
  await page.getByText("3 排 × 11 格 · 共 33 個庫位").waitFor();
  for (const width of [320, 390, 657, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await page.locator(".storage-cabinet").evaluate((card) => {
      const board = card.querySelector(".storage-cabinet-board");
      const cells = [...card.querySelectorAll(".storage-slot")].map((cell) =>
        cell.getBoundingClientRect(),
      );
      return {
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        boardOverflow: board.scrollWidth > board.clientWidth,
        widths: cells.map((c) => c.width),
        heights: cells.map((c) => c.height),
        lastRight: cells.at(-1).right,
        boardRight: board.getBoundingClientRect().right,
      };
    });
    assert.equal(layout.pageOverflow, false);
    assert.equal(layout.boardOverflow, false);
    assert.equal(layout.widths.length, 33);
    assert.ok(Math.max(...layout.widths) - Math.min(...layout.widths) < 1);
    assert.ok(Math.max(...layout.heights) - Math.min(...layout.heights) < 1);
    assert.ok(layout.lastRight <= layout.boardRight + 1);
    await page
      .getByRole("button", { name: /新庫位 可用/ })
      .last()
      .click();
    assert.equal(await page.locator(".storage-slot.is-selected").count(), 1);
    await page.screenshot({
      path: `/tmp/poster-storage-equal-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    "Storage browser passed: cabinet tabs and keyboard navigation, new cabinet auto-selection, safe cross-cabinet quick-add, batch/stepper, movement and equal 3x11 grid without scrolling",
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
