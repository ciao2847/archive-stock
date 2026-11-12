// Run after npm run build: node tests/browser/stall-checkout.browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import { chromium } from "playwright";
const bundle = await build({
  outfile: "/tmp/poster-stall-browser.js",
  plugins: [
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
    contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {OrderContactDetails} from './src/components/order-management/OrderContactDetails';import {BundlePhoneEditor} from './src/components/bundle-claims/BundlePhoneEditor';function App(){const [phone,setPhone]=useState('0912345678');return <OrderContactDetails name="測試顧客" phone={phone} metadata={<p>測試配單</p>} phoneActions={<BundlePhoneEditor key={phone} phone={phone} disabled={false} onSave={async value=>{window.phoneCalls=(window.phoneCalls||0)+1;await new Promise(r=>setTimeout(r,200));if(window.phoneFail)return false;setPhone(value);return true;}}/>}/>};createRoot(document.getElementById('root')).render(<App/>);`,
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const pencil = page.getByRole("button", { name: "修改電話", exact: true });
    const phone = page.getByRole("link", { name: "0912345678", exact: true });
    await phone.waitFor();
    const boxes = await Promise.all([
      phone.boundingBox(),
      pencil.boundingBox(),
    ]);
    assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 15);
    assert.ok(boxes[1].x > boxes[0].x);
    await pencil.click();
    const modal = page.getByRole("dialog", { name: "修改顧客電話" });
    await modal.waitFor();
    const bounds = await modal.boundingBox();
    assert.ok(bounds.x >= 12 && bounds.y > 100);
    const input = page.getByLabel("顧客手機號碼");
    assert.equal(
      await input.evaluate((el) => document.activeElement === el),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "儲存電話", exact: true })
        .isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await modal.count(), 0);
    assert.equal(
      await pencil.evaluate((el) => document.activeElement === el),
      true,
    );
    await pencil.click();
    await input.fill("123");
    await page.getByRole("button", { name: "儲存電話", exact: true }).click();
    assert.equal(await page.evaluate(() => window.phoneCalls || 0), 0);
    await input.fill("0987654321");
    await page.evaluate(() => (window.phoneFail = true));
    await page.getByRole("button", { name: "儲存電話", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "取消", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole("alert").filter({ hasText: "電話未能更新" }).waitFor();
    assert.equal(await input.inputValue(), "0987654321");
    await page.evaluate(() => (window.phoneFail = false));
    await page.getByRole("button", { name: "儲存電話", exact: true }).click();
    await page.getByRole("link", { name: "0987654321", exact: true }).waitFor();
    assert.equal(await modal.count(), 0);
    await pencil.click();
    await input.fill("0911111111");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("link", { name: "0987654321", exact: true }).waitFor();
    await pencil.click();
    assert.equal(await input.inputValue(), "0987654321");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `/tmp/poster-phone-editor-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "關閉電話編輯" }).click();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Phone dialog passed on mobile and desktop: adjacent pencil, focus, Escape, validation, pending lock, failed save, successful save and cancel.",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
