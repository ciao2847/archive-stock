# 庫藏 Archive Stock

收藏品／代購商品的庫存、QR 標籤與掃碼出貨系統。正式資料由 Supabase 提供，Next.js 使用 Redux Toolkit 管理跨頁共用資料。

```bash
npm install
cp .env.example .env.local
npm run dev
```

瀏覽 `http://localhost:3000`。既有 Supabase 專案以
`supabase/migrations/` 內的時間戳 migration 為正式變更來源；歷史手動安裝腳本已移至
`supabase/legacy/`，請勿在正式環境重複執行。

部署目前版本前，需依序套用安全訂單流程及最新的 RLS／商品交易 migration：

```text
supabase/migrations/20260902070506_secure_order_workflow.sql
supabase/migrations/20260903001511_harden_rls_and_rpc_privileges.sql
```

這份 migration 會新增訂單／客戶的 `created_by`、收緊寫入與刪除 policy，
並建立原子化的 `create_order_with_items` RPC。部署新版前端前應先套用此 migration。

主要流程：商品建檔 → 永久 ID → QR 標籤 → 建立訂單 → 掃碼核對 → 完成包裝。

## 公開喊單頁

登入後從側邊欄進入「喊單管理」，每個 IP（例如蜘蛛人、蝙蝠俠）都能建立一條固定且獨立的 `/form/{token}` 分享連結，並可隨新品釋出持續更新該 IP 頁面的商品。各 IP 的商品、顧客喊單與統計互相分開；管理者可個別自訂公開名稱、喊單金額、單次數量上限、表單說明與截止時間。頂部橫幅背景圖、焦點位置與頁面色系則由庫藏統一設定，該庫藏的所有 IP 喊單頁共用同一組外觀風格。這些自訂內容不會修改庫藏商品主檔。消費者不需登入，可以選擇多項商品與數量，最後填寫電話、群組暱稱後送出；喊單管理頁會依商品彙整採購數量，也可下載 CSV。舊版 `/claim/{token}` 連結會永久轉址到新版網址。

喊單屬於預購需求蒐集，不會預留或扣除現有庫存，也不會直接進入掃碼包貨流程。尚未進貨的商品可先用庫存 `0`、空白庫位建檔；日後補上實際庫存時才會產生 QR 標籤。正式啟用前需套用：

```text
supabase/migrations/20260910073243_add_public_claim_forms.sql
supabase/migrations/20260910083927_customize_claim_form_products.sql
supabase/migrations/20260921035700_fix_claim_form_upsert_ambiguity.sql
supabase/migrations/20260921042929_enable_multiple_claim_forms_per_ip.sql
supabase/migrations/20260921074225_allow_admin_delete_claim_submissions.sql
supabase/migrations/20260921075610_allow_inventory_users_delete_claim_submissions.sql
supabase/migrations/20260929060712_customize_claim_form_appearance.sql
supabase/migrations/20260929062040_merge_claim_form_appearance_into_public_rpc.sql
supabase/migrations/20260929063538_adjust_claim_form_header_and_banner_position.sql
supabase/migrations/20260929064248_lighten_existing_poster_owner_claim_forms.sql
supabase/migrations/20260929085500_allow_delete_claim_forms_and_fix_creation.sql
supabase/migrations/20260929091500_unify_claim_form_appearance_per_inventory.sql
supabase/migrations/20260930001853_harden_inventory_claim_appearance_update.sql
```

橫幅會壓縮成 WebP 後存入公開的 `claim-form-assets` bucket；只有該庫倉成員可上傳或刪除。公開 RPC 只回傳表單外觀與商品展示欄位，電話與暱稱所在資料表不提供匿名角色直接存取，匿名送單統一透過受驗證的原子化 RPC 寫入。

公開喊單送出前會通過 Cloudflare Turnstile Managed 驗證；後端會再次向 Cloudflare 驗證一次性 token、`claim-submit` 動作與送出網域，成功後才呼叫 Supabase RPC。請在 Cloudflare Turnstile 建立 widget，允許正式網域 `archive-stock.vercel.app`，再於本機 `.env.local` 與 Vercel Environment Variables 設定：

```bash
TURNSTILE_SITE_KEY=你的_site_key
TURNSTILE_SECRET_KEY=你的_secret_key
```

`TURNSTILE_SECRET_KEY` 只能存在伺服器環境，不可加上 `NEXT_PUBLIC_` 或傳到瀏覽器。開發環境未設定金鑰時會使用 Cloudflare 官方測試金鑰；production 缺少正式金鑰時採 fail closed，暫停送單而不會繞過驗證。

## 資料流程

共用資料採用以下固定流程：

```text
頁面／自訂 Hook
  → dispatch(createAsyncThunk)
  → src/lib/api 呼叫 Next.js API
  → API Route 驗證使用者與角色後存取 Supabase
  → dispatch(changeData)
  → Slice 依語系快取
  → useSelector 取得資料
```

主要目錄：

- `src/app/`：Next.js App Router 的頁面、版型與 API Route
- `src/components/`：共用 UI 元件與頁面組合元件
- `src/hooks/`：檢查語系快取，只有沒有資料時才發送請求
- `src/store/`：Store、`combineReducers`、Slice 與型別化 Redux hooks
- `src/lib/api/`：前端唯一的 HTTP 資料存取層
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

公開 QR 的歷史安裝腳本位於
`supabase/legacy/public-qr-landing-migration.sql`。新環境應透過 migration 建立 schema，
再於本機 `.env.local` 與 Vercel Environment Variables 設定：

```bash
NEXT_PUBLIC_SHOPEE_STORE_URL=https://shopee.tw/你的賣場
NEXT_PUBLIC_OFFICIAL_LINE_URL=https://lin.ee/你的官方帳號
```

新列印的商品 QR 會使用 `/qr/{token}`。完成包貨後，頁面會依訂單
`sales_channel` 使用該庫藏在「系統設定 → 包裝完成 QR Code」設定的入口：
蝦皮訂單使用「蝦皮訂單入口」，其餘使用「其他通路入口」。庫藏內的登入使用者
都能修改自己庫藏的兩個入口；留空時分別沿用系統預設的蝦皮或官方 LINE 連結。
`NN佛系海報代購` 現有的 7-ELEVEN 賣貨便網址會延續到兩個入口，小天地則維持
蝦皮／LINE 的原本分流。舊的 `AS1:{token}` QR 仍可由內部掃碼器核對。

此功能的 schema 與預設網址由下列 migration 建立：

```text
supabase/migrations/20260921080639_per_inventory_qr_destination_url.sql
supabase/migrations/20260929033706_allow_inventory_users_update_qr_destination.sql
```

## 品質檢查

```bash
npm run lint
npm run typecheck
SUPABASE_PROJECT_ID=your-project-ref npm run db:types
```

`db:types` 另需已登入 Supabase CLI，或提供 `SUPABASE_ACCESS_TOKEN`。產生後應將
`src/types/database.types.ts` 納入版本控制，並把型別傳給 browser/server Supabase client。

## 雙月成本與會計結算

每兩個月手動填寫成本總額，系統計算營收與結餘，確認後鎖定結算。操作與部署步驟見 [雙月手動成本與會計結算](docs/calculator-accounting.md)。

## 簡化商品入庫

一般入庫只需名稱、販售金額、國家版本與圖片；庫存預設 1，庫位及其他資訊可在「更多資訊」選填。庫藏列表與詳情顯示商品名稱，新增與編輯不再填寫作品名稱；舊作品關聯保留。預購入庫仍採原本的名稱、尺寸、金額與庫存 0 流程。

部署前請先套用 `supabase/migrations/20261008020858_simplify_product_intake.sql`，允許不填作品名稱及庫位。可用 `npm run test` 與 `node tests/browser/product-intake.browser.mjs` 驗證（瀏覽器測試需先 build）。

## 櫃子格位管理

庫位頁以 A／B／C 分頁切換櫃子，格位依排數與欄數均分寬高；提供格位改名、批次放入／搬移及拆箱快速建檔。一般入庫直接選格位；批次分配不會增加庫存。本次更新包含所有庫藏位置分配的一次性重設，保留海報與庫存。部署與驗證見 [櫃子與格位管理](docs/cabinet-locations.md)。
