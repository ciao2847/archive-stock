# 庫藏 Archive Stock

收藏品／代購商品的庫存、QR 標籤與掃碼出貨系統。正式資料由 Supabase 提供，Next.js 使用 Redux Toolkit 管理跨頁共用資料。

```bash
npm install
cp .env.example .env.local
npm run dev
```

瀏覽 `http://localhost:3000`。Supabase 專案建立後，先在 SQL Editor 執行 `supabase/schema.sql` 與需要的 migration，再填入 `.env.local`。

主要流程：商品建檔 → 永久 ID → QR 標籤 → 建立訂單 → 掃碼核對 → 完成包裝。

## 資料流程

共用資料採用以下固定流程：

```text
頁面／自訂 Hook
  → dispatch(createAsyncThunk)
  → src/lib/api 呼叫 Supabase 並轉換資料
  → dispatch(changeData)
  → Slice 依語系快取
  → useSelector 取得資料
```

主要目錄：

- `src/app/`：Next.js App Router 的頁面、版型與 API Route
- `src/components/`：共用 UI 元件與頁面組合元件
- `src/hooks/`：檢查語系快取，只有沒有資料時才發送請求
- `src/store/`：Store、`combineReducers`、Slice 與型別化 Redux hooks
- `src/lib/api/`：Supabase 查詢與回傳資料轉換
- `src/utils/`：Supabase 的 client、server 與 proxy 共用工具
- `styles/`：全域、元件、版型與頁面 SCSS，以及 Tailwind 入口
- `public/`：品牌圖檔與 PWA manifest 等靜態資源
- `supabase/`：資料庫 schema 與 migrations

專案使用 Next.js 16，因此路由入口採 `src/app/page.tsx` 與巢狀的
`page.tsx`／`route.ts`，分別取代表格式中的 `index.js`、`Routes.js` 與
集中式 API 路由。設定檔、`public/`、`styles/` 和資料庫腳本保留在根目錄，
應用程式碼則集中於 `src/`。

每份共用資料在 store 中只保留單一快取；自訂 Hook 只會在尚未載入資料時發送請求，也可透過 `refresh` 主動重新載入。

## 公開 QR 失效頁

先在 Supabase SQL Editor 執行 `supabase/public-qr-landing-migration.sql`，再於本機 `.env.local` 與 Vercel Environment Variables 設定：

```bash
NEXT_PUBLIC_SHOPEE_STORE_URL=https://shopee.tw/你的賣場
NEXT_PUBLIC_OFFICIAL_LINE_URL=https://lin.ee/你的官方帳號
```

新列印的商品 QR 會使用 `/qr/{token}`。完成包貨後，頁面依訂單 `sales_channel` 顯示蝦皮或官方 LINE 入口；舊的 `AS1:{token}` QR 仍可由內部掃碼器核對。
