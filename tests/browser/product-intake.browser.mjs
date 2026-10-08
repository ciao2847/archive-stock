// Run after npm run build: node tests/browser/product-intake.browser.mjs
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
  plugins: [
    {
      name: "product-api-fixture",
      setup(builder) {
        builder.onResolve({ filter: /lib\/api\/products$/ }, () => ({
          path: "products",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          loader: "js",
          contents: `export const uploadProductImages=async()=>({paths:['main.webp','thumb.webp']}); export const removeProductImages=async()=>({}); export const createProduct=async(input)=>{window.savedProduct=input;return {productId:'new-product'};};`,
        }));
      },
    },
  ],
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {NewProduct} from './src/components/products/NewProduct';createRoot(document.getElementById('root')).render(<NewProduct ownerId='${ownerId}' onClose={()=>{}}/>);`,
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
await page.route("**/api/locations**", (route) =>
  route.fulfill({
    json: {
      success: true,
      data: {
        cabinets: [
          { id: "cabinet", name: "海報櫃", code: "A", rows: 1, columns: 1 },
        ],
        slots: [
          {
            id: "slot",
            cabinet_id: "cabinet",
            code: "A-01-01",
            display_name: "韓國海報",
            shelf: 1,
            bin: 1,
          },
        ],
        products: [],
      },
    },
  }),
);
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(await page.getByText("作品名稱", { exact: true }).count(), 0);
  await page.getByLabel("名稱（必填）").fill("測試海報");
  await page.getByLabel("國家版本（必填）").selectOption("韓國");
  await page.getByLabel("販售金額（必填）").fill("1200");
  await page.getByRole("button", { name: "儲存商品", exact: true }).click();
  await page.getByText("請上傳商品圖片", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.savedProduct), undefined);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "poster.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAAQUlEQVR4nO3OMQEAIAzAsPk3DRJ25ICjUZA5n5vXgU1BVVAVVAVVQVVQFVQFVUFVUBVUBVVBVVAVVAVVQVVQFVQXAJzoabnNs3sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await page.getByLabel("存放格位（選填）").selectOption("A-01-01");
  await page.getByRole("button", { name: "儲存商品", exact: true }).click();
  await page.waitForFunction(() => Boolean(window.savedProduct));
  const saved = await page.evaluate(() => window.savedProduct);
  assert.equal(saved.name, "測試海報");
  assert.equal(saved.price, 1200);
  assert.equal(saved.country, "韓國");
  assert.equal(saved.location, "A-01-01");
  assert.equal(saved.stock, 1);
  assert.equal(saved.imagePaths.length, 2);
  assert.equal("work" in saved, false);
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: "/tmp/poster-product-intake-mobile.png",
    fullPage: true,
  });
  console.log(
    "Intake browser passed: four required fields, image requirement, no work requirement, cabinet slot selection and default stock",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
