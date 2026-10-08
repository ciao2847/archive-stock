// Runs the real accounting component against isolated API/Storage fixtures.
// Run after npm run build: node tests/browser/accounting.browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
const ownerId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
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
    contents: `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import {QueryClient,QueryClientProvider} from '@tanstack/react-query'; import {SettlementPanel} from './src/components/settlement/SettlementPanel'; const client=new QueryClient({defaultOptions:{queries:{retry:false}}}); function App(){const[owner,setOwner]=useState('${ownerId}');window.changeOwner=setOwner;return <QueryClientProvider client={client}><SettlementPanel ownerId={owner}/></QueryClientProvider>} createRoot(document.getElementById('root')).render(<App/>);`,
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
const costs = new Map();
const snapshots = [];
const saves = [];
let recognitions = 0;
const json = (route, data) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data }),
  });
await page.route("**/api/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname === "/api/accounting/recognize") {
    recognitions++;
    return json(route, {
      candidates: [
        { amount: 100290, kind: "cost", label: "成本" },
        { amount: 137925, kind: "revenue", label: "營收" },
      ],
      warning: "請選取本期成本",
    });
  }
  if (url.pathname === "/api/accounting" && request.method() === "PUT") {
    const input = request.postDataJSON();
    saves.push(input);
    const cost = {
      id: `cost-${input.start}`,
      owner_id: input.ownerId,
      period_start: input.start,
      period_end: input.end,
      amount: input.amount,
      notes: input.notes,
      revision: input.expectedRevision + 1,
      updated_at: new Date().toISOString(),
    };
    costs.set(`${input.ownerId}:${input.start}`, cost);
    return json(route, { cost });
  }
  if (url.pathname === "/api/settlements") {
    const input = request.postDataJSON();
    const cost = costs.get(`${input.ownerId}:${input.start}`);
    const snapshot = {
      id: "settlement",
      settlement_no: "SETTLE-TEST",
      owner_id: input.ownerId,
      period_start: input.start,
      period_end: input.end,
      revenue: 137925,
      cost: cost.amount,
      profit: 137925 - cost.amount,
      cost_source: "period_total",
      created_at: new Date().toISOString(),
    };
    snapshots.push(snapshot);
    return json(route, { settlement: snapshot });
  }
  if (url.pathname === "/api/accounting") {
    const owner = url.searchParams.get("ownerId");
    const start = url.searchParams.get("start");
    const cost = costs.get(`${owner}:${start}`) ?? null;
    const settled = snapshots.some(
      (row) => row.owner_id === owner && row.period_start === start,
    );
    return json(route, {
      cost,
      preview: {
        revenue: 137925,
        order_count: 3,
        settled,
        blocked_reason: null,
      },
      history: snapshots.filter((row) => row.owner_id === owner),
      revisions: cost
        ? [
            {
              revision: cost.revision,
              amount: cost.amount,
              notes: cost.notes,
              changed_at: cost.updated_at,
            },
          ]
        : [],
    });
  }
  return json(route, {});
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByText("本期成本總額（台幣）", { exact: true }).waitFor();
  await page.getByLabel("雙月帳期").selectOption("7");
  await page.screenshot({
    path: "/tmp/poster-accounting-layout-mobile.png",
    fullPage: true,
  });
  assert.equal(await page.locator('input[type="file"]').count(), 0);
  await page.getByLabel("本期成本總額（台幣）").fill("100290");
  assert.equal(
    await page.getByRole("button", { name: "確認並儲存成本" }).isDisabled(),
    true,
  );
  await page.getByRole("checkbox", { name: /我已核對金額/ }).check();
  await page.getByRole("button", { name: "確認並儲存成本" }).click();
  await page.getByText(/已保存第 1 版/).waitFor();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].amount, 100290);
  assert.equal("evidencePaths" in saves[0], false);
  assert.equal("calculatorPath" in saves[0], false);
  assert.equal(saves[0].confirmed, true);
  await page.getByLabel("本期成本總額（台幣）").fill("110000");
  assert.equal(
    await page.getByRole("button", { name: "確認結算" }).isDisabled(),
    true,
  );
  await page.getByRole("checkbox", { name: /我已核對金額/ }).check();
  await page.getByRole("button", { name: "確認並儲存成本" }).click();
  await page.getByText(/已保存第 2 版/).waitFor();
  assert.equal(saves.length, 2);
  assert.equal(saves[1].amount, 110000);
  assert.equal(saves[1].expectedRevision, 1);
  assert.equal(
    await page.getByRole("checkbox", { name: /我已核對營收與成本/ }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "確認結算", exact: true })
      .isEnabled(),
    true,
  );
  await page.getByRole("button", { name: "確認結算" }).click();
  await page.getByText("本期結餘（已結算）", { exact: true }).waitFor();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].profit, 27925);
  assert.equal(
    await page.getByLabel("本期成本總額（台幣）").isDisabled(),
    true,
  );
  assert.equal(await page.getByRole("button", { name: "確認結算" }).count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "確認並儲存成本" }).count(),
    0,
  );
  await page.screenshot({
    path: "/tmp/poster-accounting-mobile.png",
    fullPage: true,
  });
  await page.evaluate((id) => window.changeOwner(id), otherId);
  await page.waitForFunction(
    () =>
      document.querySelector('input[placeholder="手動填入這兩個月的成本總額"]')
        ?.value === "",
  );
  assert.equal(await page.getByLabel("本期成本總額（台幣）").inputValue(), "");
  await page.getByLabel("本期成本總額（台幣）").fill("0");
  await page.getByRole("checkbox", { name: /我已核對金額/ }).check();
  assert.equal(
    await page.getByRole("button", { name: "確認並儲存成本" }).isEnabled(),
    true,
  );
  await page.getByRole("button", { name: "確認並儲存成本" }).click();
  await page.getByText(/已保存第 1 版/).waitFor();
  assert.equal(saves.at(-1).amount, 0);
  assert.equal(recognitions, 0, "Manual accounting never calls AI recognition");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(overflow, false, "Accounting page fits a mobile viewport");
  assert.deepEqual(errors, []);
  console.log(
    "Accounting browser checks passed: manual entry, no image uploads or AI calls, confirmation, corrections, locking, owner switching, zero cost and mobile layout",
  );
} catch (error) {
  console.error(await page.locator("body").innerText());
  await page.screenshot({
    path: "/tmp/poster-accounting-browser-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
