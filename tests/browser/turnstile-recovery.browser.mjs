// Exercise the real script loader and widget without creating customer orders.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, webkit } from "playwright";
const bundle = await build({
  outfile: "/tmp/poster-turnstile-browser.js",
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
import React,{useState,StrictMode}from'react';import{createRoot}from'react-dom/client';import{TurnstileWidget}from'./src/components/claims/TurnstileWidget';
function App(){const[token,setToken]=useState('');const[reset,setReset]=useState(0);const[mount,setMount]=useState(true);return <form onSubmit={e=>{e.preventDefault();window.submissions=(window.submissions||0)+1}}><label>群組暱稱<input defaultValue='Kathy'/></label><label>手機號碼<input defaultValue='0912345678'/></label><label>備註<textarea aria-label='備註' defaultValue='保留資料'/></label><label>商品數量<input type='number' defaultValue='2'/></label><label>同意<input type='checkbox' defaultChecked/></label>{mount&&<TurnstileWidget siteKey='test-site-key' resetSignal={reset} onTokenChange={setToken}/>}<button type='submit' disabled={!token}>確認訂購</button><button type='button' onClick={()=>setReset(x=>x+1)}>模擬送出失敗重設</button><button type='button' onClick={()=>setMount(x=>!x)}>切換表單</button><output aria-label='驗證 token'>{token}</output></form>}createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);`,
  },
});
const css = (
  await Promise.all(
    (await readdir(".next/static/chunks"))
      .filter((n) => n.endsWith(".css"))
      .map((n) => readFile(".next/static/chunks/" + n, "utf8")),
  )
).join("\n");
const server = createServer((req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    return res.end(bundle.outputFiles[0].text);
  }
  if (req.url === "/app.css") {
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    return res.end(css);
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root" style="padding:16px"></div><script src="/app.js"></script></body></html>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const sdk = `window.turnstile={render:(element,options)=>{window.renderCount=(window.renderCount||0)+1;window.widgetOptions=options;element.textContent='安全驗證測試元件';return 'widget-'+window.renderCount},remove:id=>{window.removed=(window.removed||0)+1;document.querySelector('[aria-label="Cloudflare 人機安全驗證"]').textContent=''},reset:id=>{window.resets=(window.resets||0)+1}};`;
const browsers = [
  [
    "Chrome",
    await chromium.launch({
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
    }),
  ],
];
try {
  if (process.env.POSTER_TEST_WEBKIT === "1") {
    browsers.push(["WebKit", await webkit.launch({ headless: true, timeout: 15_000 })]);
  }
  for (const [name, browser] of browsers) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let requests = 0,
      allow = false;
    await page.route("https://challenges.cloudflare.com/**", (route) => {
      requests++;
      return allow
        ? route.fulfill({
            contentType: "text/javascript; charset=utf-8",
            body: sdk,
          })
        : route.abort("failed");
    });
    await page.goto(url);
    await page.getByRole("button", { name: "重新驗證", exact: true }).waitFor();
    assert.equal(
      requests,
      2,
      "one automatic retry after the initial SDK failure",
    );
    await page.waitForFunction(
      () => document.querySelector('button[type="submit"]').disabled,
    );
    assert.equal(
      await page.getByRole("button", { name: "確認訂購" }).isDisabled(),
      true,
    );
    allow = true;
    await page.getByRole("button", { name: "重新驗證", exact: true }).click();
    await page.waitForFunction(() => Boolean(window.widgetOptions));
    assert.equal(requests, 3);
    assert.equal(
      await page.locator("script#cloudflare-turnstile-script").count(),
      1,
    );
    await page.evaluate(() => window.widgetOptions.callback("token-1"));
    await page
      .getByLabel("驗證 token")
      .filter({ hasText: "token-1" })
      .waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    // A challenge failure clears the old token, then a successful automatic retry
    // must clear the error message too, without discarding any contact fields.
    await page.evaluate(() => window.widgetOptions["error-callback"]("200500"));
    await page.getByRole("alert").waitFor();
    await page.waitForFunction(
      () => document.querySelector('button[type="submit"]').disabled,
    );
    assert.equal(
      await page.getByRole("button", { name: "確認訂購" }).isDisabled(),
      true,
    );
    await page.evaluate(() => window.widgetOptions.callback("token-2"));
    await page.getByRole("alert").waitFor({ state: "hidden" });
    assert.equal(
      await page.getByRole("button", { name: "確認訂購" }).isEnabled(),
      true,
    );
    await page.evaluate(() => window.widgetOptions["expired-callback"]());
    await page.waitForFunction(
      () => document.querySelector('button[type="submit"]').disabled,
    );
    assert.equal(
      await page.getByRole("button", { name: "確認訂購" }).isDisabled(),
      true,
    );
    await page.evaluate(() => window.widgetOptions.callback("token-3"));
    await page.getByRole("button", { name: "模擬送出失敗重設" }).click();
    await page.waitForFunction(() => window.resets === 1);
    await page.waitForFunction(
      () => document.querySelector('button[type="submit"]').disabled,
    );
    assert.equal(
      await page.getByRole("button", { name: "確認訂購" }).isDisabled(),
      true,
    );
    // Network restoration and Safari back/forward cache restoration recreate the
    // challenge without a full document reload or a stale verified token.
    await page.evaluate(() => {
      window.widgetOptions["error-callback"]("200500");
      window.dispatchEvent(new Event("online"));
    });
    await page.waitForFunction(() => window.renderCount >= 2);
    await page.evaluate(() => window.widgetOptions.callback("token-4"));
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    );
    await page.waitForFunction(() => window.renderCount >= 3);
    await page.waitForFunction(
      () => document.querySelector('button[type="submit"]').disabled,
    );
    assert.equal(
      await page.getByRole("button", { name: "確認訂購" }).isDisabled(),
      true,
    );
    await page.evaluate(() => window.widgetOptions["error-callback"]("110200"));
    await page.getByRole("alert").filter({ hasText: "設定異常" }).waitFor();
    await page.screenshot({
      path: "/tmp/poster-turnstile-recovery-" + name + ".png",
    });
    for (const [label, value] of [
      ["群組暱稱", "Kathy"],
      ["手機號碼", "0912345678"],
      ["備註", "保留資料"],
      ["商品數量", "2"],
    ])
      assert.equal(
        await page.getByLabel(label, { exact: true }).inputValue(),
        value,
      );
    assert.equal(
      await page.getByLabel("同意", { exact: true }).isChecked(),
      true,
    );
    assert.equal(await page.evaluate(() => window.submissions || 0), 0);
    // Unmounted callbacks are ignored and the already loaded SDK is shared.
    await page.evaluate(() => {
      window.oldOptions = window.widgetOptions;
    });
    await page.getByRole("button", { name: "切換表單", exact: true }).click();
    await page.evaluate(() => window.oldOptions.callback("stale-token"));
    assert.equal(await page.getByLabel("驗證 token").textContent(), "");
    await page.getByRole("button", { name: "切換表單", exact: true }).click();
    await page.waitForFunction(() => window.renderCount >= 4);
    assert.equal(requests, 3);
    assert.deepEqual(errors, []);
    await page.close();
    const hanging = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await hanging.clock.install();
    let pendingRequests = 0;
    await hanging.route("https://challenges.cloudflare.com/**", () => {
      pendingRequests++;
    });
    await hanging.goto(url, { waitUntil: "domcontentloaded" });
    await hanging.waitForFunction(() =>
      Boolean(document.querySelector("script#cloudflare-turnstile-script")),
    );
    await hanging.clock.runFor(15_010);
    await hanging.clock.runFor(1_510);
    await hanging.clock.runFor(15_010);
    await hanging
      .getByRole("button", { name: "重新驗證", exact: true })
      .waitFor();
    // Browsers may coalesce the second identical URL with the still-pending request.
    assert.ok(pendingRequests >= 1 && pendingRequests <= 2);
    assert.equal(
      await hanging.getByLabel("群組暱稱", { exact: true }).inputValue(),
      "Kathy",
    );
    await hanging.close();
    console.log(
      name +
        ": SDK failures, fresh retries, successful recovery, expiry, reset, online, BFCache and retained form data passed",
    );
  }
} finally {
  for (const [, browser] of browsers) await browser.close();
  await new Promise((done) => server.close(done));
}
