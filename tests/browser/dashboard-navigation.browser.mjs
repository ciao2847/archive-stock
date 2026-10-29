// Exercise the actual Next.js router with the production navigation hook.
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
await mkdir("test-results", { recursive: true });
const fixture = await mkdtemp(resolve("test-results/navigation-"));
let server, browser;
let logs = "";
try {
  for (const dir of ["app/[view]", "src/hooks", "src/lib"])
    await mkdir(join(fixture, dir), { recursive: true });
  for (const file of [
    "src/hooks/useDashboardNavigation.ts",
    "src/lib/dashboard-navigation.ts",
    "src/lib/types.ts",
    "src/lib/order-source.ts",
    "src/components/navigation/BackNavigation.tsx",
    "styles/components/navigation/BackNavigation.module.scss",
    "src/components/ui/SearchField.tsx",
    "styles/layout/_header.scss",
    "styles/utilities/_variables.scss",
  ]) {
    await mkdir(join(fixture, file, ".."), { recursive: true });
    await writeFile(join(fixture, file), await readFile(file));
  }
  await writeFile(
    join(fixture, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2017",
        lib: ["dom", "dom.iterable", "esnext"],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        module: "esnext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        baseUrl: ".",
        paths: { "@/*": ["./src/*"] },
      },
      include: ["**/*.tsx", "**/*.ts"],
    }),
  );
  await symlink(resolve("node_modules"), join(fixture, "node_modules"), "dir");
  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify({
      name: "navigation-browser-fixture",
      private: true,
      dependencies: { next: "16.3.2", react: "19.2.8", "react-dom": "19.2.8" },
    }),
  );
  await writeFile(
    join(fixture, "next.config.mjs"),
    `export default {devIndicators:false,allowedDevOrigins:["127.0.0.1"]};`,
  );
  await writeFile(
    join(fixture, "app/layout.tsx"),
    `import '../styles/layout/_header.scss';import type {ReactNode} from 'react';import Harness from './Harness';export default function Layout({children}:{children:ReactNode}){return <html><body><Harness/>{children}</body></html>}`,
  );
  await writeFile(
    join(fixture, "app/Harness.tsx"),
    `'use client';
import {useState} from 'react';
import {useDashboardNavigation} from '../src/hooks/useDashboardNavigation';
import {useSearchParams} from 'next/navigation';
import {getOrdersPath} from '../src/lib/order-source';
import {DASHBOARD_PATHS,pushDashboardPath} from '../src/lib/dashboard-navigation';
import {BackNavigationProvider,BackButton,useBackNavigation,useBackAction,useDirtyBack,useNavigationState} from '../src/components/navigation/BackNavigation';
import {SearchField} from '../src/components/ui/SearchField';
import type {DashboardView} from '../src/lib/types';
function Filters(){const [query,setQuery]=useNavigationState('fixture:orders:query','');const [page,setPage]=useNavigationState('fixture:orders:page',1);return <section><input aria-label='cached-filter' value={query} onChange={e=>setQuery(e.target.value)}/><p data-testid='page'>{page}</p><button onClick={()=>setPage(2)}>second-page</button></section>}
function Workspace(){
 const {view,setView}=useBackNavigation();const params=useSearchParams();const [draft,setDraft]=useState('');const [detail,setDetail]=useState(false);const [editing,setEditing]=useState(false);const [busy,setBusy]=useState(false);const [search,setSearch]=useState('');
 useBackAction({enabled:detail,priority:10,onBack:()=>setDetail(false)});
 const {markChanged}=useDirtyBack({enabled:editing,busy,onBack:()=>setEditing(false)});
 return <main style={{minHeight:2400}}>
 <header className='dashboard-header' data-testid='header'><BackButton/><button aria-label='開啟導覽選單'>☰</button><SearchField label='搜尋商品庫存' placeholder='搜尋作品、商品 ID、版本、庫位…' value={search} onChange={setSearch}/></header>
 <div style={{padding:16}}><h1>{view}</h1><p data-testid='source'>{params.get('source')??'all'}</p><button onClick={()=>pushDashboardPath(getOrdersPath('stall'))}>manage-stall-orders</button><button onClick={()=>pushDashboardPath(getOrdersPath('general'))}>general-orders</button><input aria-label='draft' value={draft} onChange={e=>setDraft(e.target.value)}/><nav style={{display:'flex',flexWrap:'wrap',gap:8}}>{Object.keys(DASHBOARD_PATHS).map(v=><button key={v} onClick={()=>setView(v as DashboardView)}>{v}</button>)}</nav>
 {view==='orders'&&<Filters/>}<button onClick={()=>setDetail(true)}>open-detail</button>{detail&&<section aria-label='detail'>detail</section>}
 <button onClick={()=>setEditing(true)}>open-editor</button>{editing&&<section aria-label='editor'><form onChangeCapture={markChanged}><input aria-label='edit-value'/><label><input type='checkbox' checked={busy} onChange={e=>setBusy(e.target.checked)}/>busy</label></form></section>}
 </div></main>
}
export default function Harness(){const navigation=useDashboardNavigation();return <BackNavigationProvider navigation={navigation}><Workspace/></BackNavigationProvider>}`,
  );
  await writeFile(
    join(fixture, "app/page.tsx"),
    `export default function Page(){return null}`,
  );
  await writeFile(
    join(fixture, "app/[view]/page.tsx"),
    `import {notFound} from 'next/navigation';import {getDashboardView} from '../../src/lib/dashboard-navigation';export default async function Page({params}:{params:Promise<{view:string}>}){const {view}=await params;if(!getDashboardView('/'+view))notFound();return null}`,
  );
  const listener = createServer();
  await new Promise((r) => listener.listen(0, "127.0.0.1", r));
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  server = spawn(
    process.execPath,
    [
      resolve("node_modules/next/dist/bin/next"),
      "dev",
      "--webpack",
      "--port",
      String(port),
    ],
    { cwd: fixture, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (data) => (logs += data));
  server.stderr.on("data", (data) => (logs += data));
  await new Promise((done, reject) => {
    const deadline = setTimeout(() => {
      clearInterval(timer);
      reject(new Error(logs));
    }, 30000);
    const timer = setInterval(() => {
      if (logs.includes("Ready in")) {
        clearInterval(timer);
        clearTimeout(deadline);
        done();
      }
    }, 100);
  });
  browser = await chromium.launch({
    headless: true,
    executablePath: existsSync(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    )
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByRole("heading", { name: "dashboard", exact: true }).waitFor();
  await page.getByLabel("draft").fill("preserved across navigation");
  const views = [
    "products",
    "claims",
    "bundle-claims",
    "orders",
    "packing",
    "checkout",
    "stall-sales",
    "locations",
    "settlement",
    "settings",
  ];
  for (const view of views) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await page.getByRole("heading", { name: view, exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/" + view);
    assert.equal(
      await page.getByLabel("draft").inputValue(),
      "preserved across navigation",
    );
  }
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole("button", { name: "settings", exact: true }).click();
  assert.equal(await page.evaluate(() => history.length), historyLength);
  for (const view of [...views.slice(0, -1)].reverse().concat("dashboard")) {
    await page.goBack();
    await page.getByRole("heading", { name: view, exact: true }).waitFor();
  }
  for (const view of views) {
    await page.goForward();
    await page.getByRole("heading", { name: view, exact: true }).waitFor();
  }
  await page.reload();
  await page.getByRole("heading", { name: "settings", exact: true }).waitFor();
  for (const view of ["checkout", "stall-sales", "products"]) {
    await page.goto(`http://127.0.0.1:${port}/${view}`);
    await page.getByRole("heading", { name: view, exact: true }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: view, exact: true }).waitFor();
  }
  await page
    .getByRole("button", { name: "manage-stall-orders", exact: true })
    .click();
  await page.getByRole("heading", { name: "orders", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="source"]').textContent === "stall",
  );
  assert.equal(new URL(page.url()).searchParams.get("source"), "stall");
  await page
    .getByRole("button", { name: "general-orders", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="source"]').textContent ===
      "general",
  );
  await page.goBack();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="source"]').textContent === "stall",
  );
  await page.goForward();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="source"]').textContent ===
      "general",
  );
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="source"]').textContent ===
      "general",
  );

  // Use the visible control, including direct URLs with unrelated browser history.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/orders?source=stall`);
  const back = page
    .getByTestId("header")
    .getByRole("button", { name: "返回", exact: true });
  const directLength = await page.evaluate(() => history.length);
  await back.click();
  await page.getByRole("heading", { name: "dashboard", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => history.length), directLength);
  assert.equal(await back.count(), 0);
  await page.getByRole("button", { name: "orders", exact: true }).click();
  await page.getByLabel("cached-filter").fill("A000038");
  await page.getByRole("button", { name: "second-page", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 620));
  await page.evaluate(() =>
    [...document.querySelectorAll("nav button")]
      .find((button) => button.textContent === "products")
      .click(),
  );
  await page.getByRole("heading", { name: "products", exact: true }).waitFor();
  await back.click();
  await page.getByRole("heading", { name: "orders", exact: true }).waitFor();
  await page.waitForFunction(() => Math.abs(scrollY - 620) < 4);
  assert.equal(await page.getByLabel("cached-filter").inputValue(), "A000038");
  assert.equal(await page.getByTestId("page").textContent(), "2");
  await page.getByRole("button", { name: "open-detail", exact: true }).click();
  await page.getByRole("button", { name: "open-editor", exact: true }).click();
  await page.getByLabel("edit-value").fill("未儲存");
  await page.evaluate(() => {
    window.confirm = () => false;
  });
  await back.click();
  assert.equal(
    await page.getByRole("region", { name: "editor", exact: true }).count(),
    1,
  );
  await page.getByLabel("busy", { exact: true }).check();
  await page.waitForFunction(
    () =>
      document.querySelector('header button[aria-label="返回"]')?.disabled ===
      true,
  );
  assert.equal(await back.isDisabled(), true);
  await page.getByLabel("busy", { exact: true }).uncheck();
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await back.click();
  assert.equal(
    await page.getByRole("region", { name: "editor", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("region", { name: "detail", exact: true }).count(),
    1,
  );
  await back.click();
  assert.equal(
    await page.getByRole("region", { name: "detail", exact: true }).count(),
    0,
  );
  assert.equal(new URL(page.url()).pathname, "/orders");
  for (const width of [320, 390, 768, 1024, 1194, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await back.isVisible(), width < 1280);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page
      .getByTestId("header")
      .screenshot({ path: `/tmp/poster-back-header-${width}.png` });
  }
  const touch = await browser.newPage({
    viewport: { width: 1366, height: 1024 },
    hasTouch: true,
  });
  await touch.goto(`http://127.0.0.1:${port}/products`);
  await touch.getByRole("heading", { name: "products", exact: true }).waitFor();
  assert.equal(
    await touch.getByRole("button", { name: "返回", exact: true }).isVisible(),
    true,
  );
  await touch.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: actual Next.js navigation, all views, Back/Forward, duplicate prevention, preserved mounted state, direct URLs, refresh, mobile/tablet Back, safe home fallback, filter/page/scroll restoration, nested detail/editor priority and dirty/busy protection.",
  );
} catch (error) {
  console.error(logs.slice(-3000));
  throw error;
} finally {
  await browser?.close();
  if (server) {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
  await rm(fixture, { recursive: true, force: true });
}
