import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import { chromium } from "playwright";

const inventoryId = "00000000-0000-4000-8000-000000000001";
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
    contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{PrintLabelResetPanel}from'./src/components/products/PrintLabelResetPanel';
createRoot(document.getElementById('root')).render(<PrintLabelResetPanel inventoryId='${inventoryId}' inventoryName='測試庫藏'/>);`,
  },
});
const css = compile("styles/app.global.scss", {
  silenceDeprecations: ["import", "global-builtin", "color-functions"],
}).css;
const server = createServer((req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(bundle.outputFiles[0].text);
  }
  if (req.url === "/app.css") {
    res.setHeader("Content-Type", "text/css");
    return res.end(css);
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
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
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const requests = [];
    let reply = {
      success: true,
      data: { resetCount: 3, sku: "A000038", productName: "測試海報" },
    };
    await page.route("**/api/print-labels/reset", async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ status: reply.success ? 200 : 503, json: reply });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const button = page.getByRole("button", {
      name: "還原為可列印",
      exact: true,
    });
    assert.equal(await button.isDisabled(), true);
    await page.getByLabel("商品 ID", { exact: true }).fill(" A000038 ");
    await button.click();
    await page
      .getByRole("status")
      .filter({ hasText: "已還原 3 張標籤" })
      .waitFor();
    assert.deepEqual(requests, [{ inventoryId, sku: "A000038" }]);
    reply = {
      success: true,
      data: { resetCount: 0, sku: "A000038", productName: "測試海報" },
    };
    await button.click();
    await page.getByRole("status").filter({ hasText: "沒有可還原" }).waitFor();
    reply = { success: false, error: "還原失敗，請稍後再試" };
    await button.click();
    await page.getByRole("alert").filter({ hasText: "還原失敗" }).waitFor();
    assert.equal(await button.isDisabled(), false);
    assert.equal(await page.getByRole("status").count(), 0);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS: ${width}px reset form, trimmed ID, success/empty/error feedback, and no overflow`,
    );
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
