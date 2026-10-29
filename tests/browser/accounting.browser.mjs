// Isolated browser checks for itemized costs, profit shares, locking and Excel downloads.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "sass";
import { chromium } from "playwright";
const ownerId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const built = await build({
  outfile: "/tmp/poster-accounting-browser.js",
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  alias: { "@": resolve("src") },
  define: { "process.env.NODE_ENV": '"development"' },
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
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {SettlementPanel} from './src/components/settlement/SettlementPanel';const client=new QueryClient({defaultOptions:{queries:{retry:false}}});function App(){const[owner,setOwner]=useState('${ownerId}');window.changeOwner=setOwner;return <QueryClientProvider client={client}><SettlementPanel ownerId={owner}/></QueryClientProvider>}createRoot(document.getElementById('root')).render(<App/>);`,
  },
});
const css =
  compile("styles/app.global.scss", {
    silenceDeprecations: ["import", "global-builtin", "color-functions"],
  }).css +
  "\n" +
  built.outputFiles
    .filter((file) => file.path.endsWith(".css"))
    .map((file) => file.text)
    .join("\n");
const server = createServer((request, response) => {
  response.setHeader(
    "Content-Type",
    request.url === "/app.js"
      ? "text/javascript"
      : request.url === "/app.css"
        ? "text/css"
        : "text/html",
  );
  response.end(
    request.url === "/app.js"
      ? built.outputFiles.find((file) => file.path.endsWith(".js")).text
      : request.url === "/app.css"
        ? css
        : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{padding:16px}</style><div id="root"></div><script src="/app.js"></script>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({
  headless: true,
  ...(existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? {
        executablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      }
    : {}),
});
try {
  for (const width of [320, 390, 768, 1024, 1280, 1600]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    const costs = new Map();
    const snapshots = [];
    const revisions = [];
    let lastSave, exportQuery;
    const json = (route, data) =>
      route.fulfill({ json: { success: true, data } });
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.pathname === "/api/accounting/export") {
        exportQuery = Object.fromEntries(url.searchParams);
        return route.fulfill({
          body: "PK-EXCEL-FIXTURE",
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": 'attachment; filename="accounting.xlsx"',
          },
        });
      }
      if (url.pathname === "/api/accounting" && request.method() === "PUT") {
        const body = request.postDataJSON();
        lastSave = body;
        const cost = {
          id: "00000000-0000-4000-8000-000000000003",
          owner_id: body.ownerId,
          period_start: body.start,
          period_end: body.end,
          amount:
            body.entries.reduce(
              (sum, row) => sum + Math.round(row.amount * 100),
              0,
            ) / 100,
          notes: body.notes,
          revision: (costs.get(body.ownerId + body.start)?.revision ?? 0) + 1,
          updated_at: "2026-10-21T01:00:00Z",
          cost_entries: body.entries,
          share_rules: body.shares,
        };
        costs.set(body.ownerId + body.start, cost);
        revisions.push({
          revision: cost.revision,
          amount: cost.amount,
          notes: cost.notes,
          changed_at: cost.updated_at,
          cost_entries: cost.cost_entries,
          share_rules: cost.share_rules,
        });
        return json(route, { cost });
      }
      if (url.pathname === "/api/settlements") {
        const body = request.postDataJSON(),
          cost = costs.get(body.ownerId + body.start);
        const settlement = {
          id: "settled",
          settlement_no: "S-1",
          period_start: body.start,
          period_end: body.end,
          revenue: 10000.01,
          cost: cost.amount,
          profit: 10000.01 - cost.amount,
          created_at: "2026-10-21T01:00:00Z",
          cost_source: "period_total",
          owner_id: body.ownerId,
        };
        snapshots.push(settlement);
        return json(route, { settlement });
      }
      if (url.pathname === "/api/accounting") {
        const owner = url.searchParams.get("ownerId"),
          start = url.searchParams.get("start");
        return json(route, {
          cost: costs.get(owner + start) ?? null,
          preview: {
            revenue: owner === ownerId ? 10000.01 : 0,
            order_count: 1,
            settled: snapshots.some(
              (row) => row.owner_id === owner && row.period_start === start,
            ),
            blocked_reason: null,
          },
          history: snapshots.filter((row) => row.owner_id === owner),
          revisions: revisions,
        });
      }
      return json(route, {});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page
      .getByRole("heading", { name: "成本與盈餘分帳", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "新增成本", exact: true }).click();
    await page
      .getByLabel("成本分類 1", { exact: true })
      .selectOption("商品購入");
    await page.getByLabel("成本項目 1", { exact: true }).fill("韓國海報購入");
    await page.getByLabel("成本金額 1", { exact: true }).fill("3000");
    const categoryBox = await page
      .getByLabel("成本分類 1", { exact: true })
      .boundingBox();
    const amountBox = await page
      .getByLabel("成本金額 1", { exact: true })
      .boundingBox();
    const notesBox = await page
      .getByLabel("成本備註 1", { exact: true })
      .boundingBox();
    const removeCostBox = await page
      .getByRole("button", { name: "移除成本 1", exact: true })
      .boundingBox();
    assert.ok(
      Math.abs(categoryBox.y - amountBox.y) < 1,
      "成本分類與金額應在同一排",
    );
    assert.ok(amountBox.x > categoryBox.x, "金額應位於分類右側");
    assert.ok(
      removeCostBox.x >= notesBox.x + notesBox.width,
      "刪除應位於備註右側",
    );
    assert.ok(
      Math.abs(
        notesBox.y + notesBox.height - removeCostBox.y - removeCostBox.height,
      ) < 1,
      "備註與刪除應底部對齊",
    );

    await page.getByRole("button", { name: "新增成本", exact: true }).click();
    await page
      .getByLabel("成本分類 2", { exact: true })
      .selectOption("國際運費");
    await page.getByLabel("成本金額 2", { exact: true }).fill("1000");
    await page.getByRole("button", { name: "新增對象", exact: true }).click();
    await page.getByLabel("分帳對象 1", { exact: true }).fill("甲");
    await page.getByLabel("分帳比例 1", { exact: true }).fill("60");
    await page.getByRole("button", { name: "新增對象", exact: true }).click();
    await page.getByLabel("分帳對象 2", { exact: true }).fill("乙");
    await page.getByLabel("分帳比例 2", { exact: true }).fill("30");
    await page
      .getByRole("checkbox", { name: "已核對成本明細與分帳比例" })
      .check();
    assert.equal(
      await page
        .getByRole("button", { name: "儲存成本與分帳", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByLabel("分帳比例 2", { exact: true }).fill("40");
    await page
      .getByRole("checkbox", { name: "已核對成本明細與分帳比例" })
      .check();
    await page
      .getByRole("button", { name: "儲存成本與分帳", exact: true })
      .click();
    await page
      .getByRole("button", { name: "確認結算", exact: true })
      .waitFor({ state: "visible" });
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("button")).find((button) =>
          button.textContent.includes("匯出 Excel"),
        )?.disabled,
    );
    assert.equal(lastSave.entries.length, 2);
    assert.equal(lastSave.entries[1].category, "國際運費");
    assert.deepEqual(
      lastSave.shares.map((row) => row.basisPoints),
      [6000, 4000],
    );
    await page.getByText("NT$ 3,600.01", { exact: true }).waitFor();
    await page.getByText("NT$ 2,400", { exact: true }).waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "no horizontal overflow",
    );
    const yearBox = await page
      .getByLabel("年份", { exact: true })
      .boundingBox();
    const monthBox = await page
      .getByLabel("雙月帳期", { exact: true })
      .boundingBox();
    const reloadBox = await page
      .getByRole("button", { name: "重新載入", exact: true })
      .boundingBox();
    assert.ok(
      Math.abs(yearBox.y + yearBox.height - monthBox.y - monthBox.height) < 1,
      "year and period align",
    );
    assert.ok(
      Math.abs(reloadBox.y + reloadBox.height - monthBox.y - monthBox.height) <
        1,
      "reload aligns on same row",
    );
    assert.ok(reloadBox.x > monthBox.x, "reload is to right of period");
    if (width < 768)
      assert.ok(
        monthBox.width > yearBox.width,
        "mobile period is wider than year",
      );
    const costsPanel = await page
      .getByRole("region", { name: "帳期成本與分帳", exact: true })
      .boundingBox();
    const settlementPanel = await page
      .getByRole("region", { name: "本期結算", exact: true })
      .boundingBox();
    const cards = await page.locator("[data-tone]").evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, right: r.right };
      }),
    );
    if (width >= 768) {
      assert.ok(
        Math.abs(costsPanel.x - cards[0].x) < 1,
        "details align with revenue left edge",
      );
      assert.ok(
        Math.abs(costsPanel.x + costsPanel.width - cards[1].right) < 1,
        "details right edge aligns with cost total",
      );
      assert.ok(
        Math.abs(settlementPanel.x - cards[2].x) < 1,
        "settlement left aligns with profit",
      );
      assert.ok(
        Math.abs(settlementPanel.width - cards[2].width) < 1,
        "settlement width equals profit",
      );
      assert.ok(
        Math.abs(settlementPanel.y - costsPanel.y) < 1,
        "panels share top edge",
      );
    } else {
      assert.ok(
        Math.abs(settlementPanel.width - costsPanel.width) < 1,
        "mobile cards have full equal width",
      );
      assert.ok(
        settlementPanel.y >= costsPanel.y + costsPanel.height,
        "mobile settlement is below details",
      );
    }
    await page.screenshot({
      path: `/tmp/poster-itemized-accounting-${width}.png`,
      fullPage: true,
    });
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "匯出 Excel", exact: true }).click();
    await download;
    assert.equal(exportQuery.ownerId, ownerId);
    await page.getByRole("button", { name: "確認結算", exact: true }).click();
    await page
      .getByText("已結算，成本與分帳比例已鎖定", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("成本金額 1", { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await page.getByLabel("分帳比例 1", { exact: true }).isDisabled(),
      true,
    );
    await page.evaluate((id) => window.changeOwner(id), otherId);
    await page.getByRole("button", { name: "新增成本", exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("成本項目 1", { exact: true }).count(),
      0,
    );
    await page
      .getByRole("checkbox", { name: "已核對成本明細與分帳比例" })
      .check();
    await page
      .getByRole("button", { name: "儲存成本與分帳", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("button")).find((button) =>
          button.textContent.includes("匯出 Excel"),
        )?.disabled,
    );
    assert.equal(lastSave.entries.length, 0);
    assert.equal(lastSave.shares.length, 0);
    assert.equal(lastSave.ownerId, otherId);
    await page.getByRole("button", { name: "新增成本", exact: true }).click();
    await page
      .getByLabel("成本分類 1", { exact: true })
      .selectOption("國際運費");
    await page.getByLabel("成本金額 1", { exact: true }).fill("1000");
    await page.getByRole("button", { name: "新增對象", exact: true }).click();
    await page.getByLabel("分帳對象 1", { exact: true }).fill("甲");
    await page.getByLabel("分帳比例 1", { exact: true }).fill("60");
    await page.getByRole("button", { name: "新增對象", exact: true }).click();
    await page.getByLabel("分帳對象 2", { exact: true }).fill("乙");
    await page.getByLabel("分帳比例 2", { exact: true }).fill("40");
    await page.getByText("NT$ -600", { exact: true }).waitFor();
    await page.getByText("NT$ -400", { exact: true }).waitFor();
    await page
      .getByText("本期虧損 NT$ 1,000，依設定比例分攤。", { exact: true })
      .waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "loss form has no horizontal overflow",
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS accounting ${width}px: itemized costs, international freight, exact profit shares, ratio validation, export, locked history and zero-cost inventory`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
