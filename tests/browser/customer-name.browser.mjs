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
    contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {OrderContactDetails} from './src/components/order-management/OrderContactDetails';import {CustomerNameEditor} from './src/components/order-management/CustomerNameEditor';function App(){const [name,setName]=useState('Original');return <OrderContactDetails name={name} phone="0912345678" metadata={<p>Test</p>} nameActions={<CustomerNameEditor key={name} name={name} ownerId="00000000-0000-4000-8000-000000000001" source="bundle" recordId={1} onSaved={()=>setName(window.nextName)}/>}/>};createRoot(document.getElementById('root')).render(<App/>);`,
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

let rejectSave = true;
let payload;
await page.route("**/api/customer-name", async (route) => {
  payload = route.request().postDataJSON();
  await page.evaluate((name) => (window.nextName = name), payload.name);
  await route.fulfill(
    rejectSave
      ? {
          status: 409,
          json: { success: false, error: "名稱已被更新，請重新整理。" },
        }
      : { json: { success: true, data: { updated: true } } },
  );
});
try {
  for (const width of [390, 1280]) {
    rejectSave = true;
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const pencil = page.getByRole("button", { name: "修改名稱", exact: true });
    await pencil.click();
    const modal = page.getByRole("dialog", { name: "修改顧客名稱" });
    await modal.waitFor();
    const input = page.getByRole("textbox", { name: "顧客名稱", exact: true });
    assert.equal(await input.inputValue(), "Original");
    assert.equal(
      await input.evaluate((el) => el === document.activeElement),
      true,
    );
    await input.fill("  ");
    assert.equal(
      await page
        .getByRole("button", { name: "儲存名稱", exact: true })
        .isDisabled(),
      true,
    );
    await input.fill("Correct");
    await page.getByRole("button", { name: "儲存名稱", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "名稱已被更新" }).waitFor();
    assert.equal(await input.inputValue(), "Correct");
    rejectSave = false;
    await page.getByRole("button", { name: "儲存名稱", exact: true }).click();
    await page.getByText("Correct", { exact: true }).waitFor();
    assert.equal(await modal.count(), 0);
    assert.equal(payload.expectedName, "Original");
    assert.equal(payload.name, "Correct");
    assert.equal(payload.source, "bundle");
    await page.getByRole("link", { name: "0912345678", exact: true }).waitFor();
    await pencil.click();
    await input.fill("Cancelled");
    await page.keyboard.press("Escape");
    assert.equal(await modal.count(), 0);
    await pencil.click();
    assert.equal(await input.inputValue(), "Correct");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `/tmp/poster-name-editor-${width}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    "Name editor passed on mobile and desktop: blank validation, conflict recovery, saved refresh, cancellation and unchanged phone.",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
