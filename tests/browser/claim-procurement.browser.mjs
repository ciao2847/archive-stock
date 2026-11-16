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
const owner = id(1),
  first = id(10),
  second = id(11),
  other = id(20),
  old = id(9);
const line = (quantity, craft = "亮銀龍") => ({
  productId: id(quantity + 100),
  sku: `SKU-${quantity}`,
  name: "夜景海報",
  ip: "蜘蛛人",
  craft,
  quantity,
  customerCount: 1,
  amount: quantity * 350,
});
const snapshot = {
  id: first,
  number: 1,
  status: "closed",
  createdAt: "2026-11-15T00:00:00Z",
  closedAt: "2026-11-15T01:00:00Z",
  submissionCount: 1,
  customerCount: 1,
  itemCount: 5,
  totalAmount: 1750,
  lines: [line(2), line(3, "水波紋")],
};
const history = {
  id: first,
  number: 1,
  closedAt: snapshot.closedAt,
  submissionCount: 1,
  itemCount: 5,
  totalAmount: 1750,
};
const bundle = await build({
  outfile: "/tmp/archive-procurement-browser.js",
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  alias: { "@": resolve("src") },
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  plugins: [
    {
      name: "scss",
      setup(b) {
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
    contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ClaimProcurementPanel}from'./src/components/claims/ClaimProcurementPanel';function App(){const[id,setId]=useState(1),[reload,setReload]=useState(0);return <div style={{maxWidth:1100,padding:16,margin:'auto'}}><button onClick={()=>setId(id===1?2:1)}>切換表單</button><output aria-label='父層重新載入次數'>{reload}</output><ClaimProcurementPanel ownerId='${owner}' formId={id} formTitle={id===1?'飯製訂購':'另一份預購'} onClosed={()=>{setReload(n=>n+1)}}/></div>}createRoot(document.getElementById('root')).render(<App/>);`,
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
    const page = await browser.newPage({
        viewport: { width, height: 950 },
        acceptDownloads: true,
      }),
      errors = [],
      posts = [],
      reads = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    let closed = false,
      newPaid = false;
    await page.route("**/api/claim-procurement**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (request.method() === "POST") {
        const payload = request.postDataJSON();
        posts.push(payload);
        closed = true;
        if (posts.length === 1) return route.abort("failed");
        return route.fulfill({
          json: {
            success: true,
            data: { closedRoundId: first, nextRoundId: second },
          },
        });
      }
      reads.push(Object.fromEntries(url.searchParams));
      const form = Number(url.searchParams.get("formId")),
        selected = url.searchParams.get("roundId"),
        historyPage = Number(url.searchParams.get("historyPage"));
      const current =
        form === 2
          ? {
              id: other,
              number: 1,
              submissionCount: 2,
              paidSubmissionCount: 1,
              unpaidSubmissionCount: 1,
              itemCount: 4,
              totalAmount: 1400,
            }
          : {
              id: closed ? second : first,
              number: closed ? 2 : 1,
              submissionCount: closed && !newPaid ? 1 : 2,
              paidSubmissionCount: closed && !newPaid ? 0 : 1,
              unpaidSubmissionCount: 1,
              itemCount: closed ? (newPaid ? 10 : 0) : 5,
              totalAmount: closed ? (newPaid ? 3500 : 0) : 1750,
            };
      const currentSelected = {
        id: current.id,
        number: current.number,
        status: "open",
        createdAt: "2026-11-15T01:00:00Z",
        closedAt: null,
        submissionCount: current.paidSubmissionCount,
        customerCount: current.paidSubmissionCount,
        itemCount: current.itemCount,
        totalAmount: current.totalAmount,
        lines: current.itemCount
          ? closed && newPaid
            ? [line(10)]
            : form === 2
              ? [line(4)]
              : snapshot.lines
          : [],
      };
      return route.fulfill({
        json: {
          success: true,
          data: {
            current,
            selected:
              form === 1 && selected === first && closed
                ? snapshot
                : currentSelected,
            history:
              form === 2
                ? []
                : closed
                  ? historyPage === 2
                    ? [{ ...history, id: old, number: 0 }]
                    : [history]
                  : [],
            historyHasMore: form === 1 && closed && historyPage === 1,
          },
        },
      });
    });
    await page.goto(base);
    await page
      .getByRole("button", { name: "結單並產生叫貨單", exact: true })
      .waitFor();
    const current = page.getByLabel("目前進行中的結單批次");
    assert.match(await current.innerText(), /第 1 批[\s\S]*5 件/);
    await page
      .getByRole("button", { name: "結單並產生叫貨單", exact: true })
      .click();
    await page
      .getByRole("button", { name: "重試確認本次結單", exact: true })
      .waitFor();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].roundId, first);
    await page.getByRole("button", { name: "切換表單" }).click();
    await page
      .getByRole("region", { name: "另一份預購本次結單與叫貨" })
      .waitFor();
    await page
      .getByRole("button", { name: "結單並產生叫貨單", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "重試確認本次結單", exact: true })
        .count(),
      0,
    );
    await page.getByRole("button", { name: "切換表單" }).click();
    await page
      .getByRole("button", { name: "重試確認本次結單", exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByRole("button", { name: "重試確認本次結單", exact: true })
      .waitFor();
    assert.equal(reads.at(-1).roundId, first);
    assert.match(await current.innerText(), /第 2 批[\s\S]*0 件/);
    await page
      .getByRole("button", { name: "重試確認本次結單", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "本次已結單並保存叫貨明細" })
      .waitFor();
    assert.deepEqual(posts[0], posts[1]);
    assert.equal(await page.getByLabel("父層重新載入次數").innerText(), "1");
    assert.equal(
      await page.getByLabel("查看叫貨批次").inputValue(),
      first,
      "parent refresh must preserve closed selection",
    );
    assert.match(
      await page.locator("body").innerText(),
      /第 1 批 · 已結單叫貨明細/,
    );
    newPaid = true;
    await page.getByRole("button", { name: "重新載入結單資料" }).click();
    await page
      .getByLabel("目前進行中的結單批次")
      .getByText("10 件", { exact: true })
      .waitFor();
    assert.equal(await page.getByLabel("查看叫貨批次").inputValue(), first);
    await page.getByLabel("查看叫貨批次").selectOption("");
    await page
      .getByRole("heading", { name: "第 2 批 · 已付款叫貨預覽", exact: true })
      .waitFor();
    assert.equal(await page.getByRole("article").count(), 1);
    await page.getByLabel("查看叫貨批次").selectOption(first);
    await page
      .getByRole("heading", { name: "第 1 批 · 已結單叫貨明細", exact: true })
      .waitFor();
    assert.equal(await page.getByRole("article").count(), 2);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "下載本批叫貨 CSV", exact: true })
      .click();
    assert.match(
      (await download).suggestedFilename(),
      /第1批-結單叫貨單\.csv$/,
    );
    await page
      .getByRole("button", { name: "載入較早結單", exact: true })
      .click();
    await page
      .getByRole("option", { name: /第 0 批/ })
      .waitFor({ state: "attached" });
    assert.equal(reads.at(-1).historyPage, "2");
    const description = await page
      .getByText(
        "只統計已付款訂單。每次結單保存明細，未付款或部分付款留到下一批，訂單與付款紀錄持續保留。",
        { exact: true },
      )
      .boundingBox();
    const notice = await page
      .getByRole("status")
      .filter({ hasText: "本次已結單並保存叫貨明細" })
      .boundingBox();
    assert.ok(
      description.y + description.height <= notice.y,
      "header text must not overlap the result notice",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: `/tmp/archive-procurement-${width}.png`,
      fullPage: true,
    });
    await page.close();
    console.log(
      `結單 UI ${width}px：已付款叫貨、固定批次重試、重載還原、表單隔離、下批重新統計、歷史及CSV通過`,
    );
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
