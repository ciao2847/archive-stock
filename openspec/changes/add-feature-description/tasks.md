## 1. 資料庫與型別基礎建設

- [x] 1.1 建立 Supabase 資料庫遷移檔案，於 `products` 資料表新增 `description text` 欄位，並更新 `create_inventory_product` 與 `update_inventory_product` RPC 函式以支援 `p_description` 參數；檢查遷移語法確保 SQL 正確無誤。
- [x] 1.2 在 `src/types/database.types.ts` 與 `src/lib/types.ts` 中的 `Product` 型別新增 `description?: string` 欄位；執行型別檢查（`npx tsc --noEmit`）驗證型別定義無衝突。

## 2. 後端 API 與資料驗證

- [x] 2.1 在 `src/lib/validation/products.ts` 中的商品建立與更新 Zod Schema 加入 `description: z.string().max(2000).optional().default("")`；檢查驗證規則確保正確限制 2,000 字元上限。
- [x] 2.2 更新 `src/app/api/products/route.ts`（GET 查詢映射與 POST 建立商品呼叫）以包含 `description`；確認建立與讀取商品時皆正確處理 `description`。
- [x] 2.3 更新 `src/app/api/products/[id]/route.ts`（商品更新 RPC 呼叫）以傳遞 `p_description`；確認更新現有商品能正確將新描述寫入。

## 3. 前端使用者介面

- [x] 3.1 在 `src/components/products/NewProduct.tsx` 表單中新增「功能描述」多行輸入框（textarea），並整合表單狀態與提示；驗證新商品建立時能正常輸入與提交。
- [x] 3.2 在 `src/components/products/EditProduct.tsx` 表單中新增「功能描述」編輯輸入框並預載既有商品描述；驗證編輯儲存後資料能即時更新。
- [x] 3.3 在 `src/components/products/ProductPanel.tsx` 商品詳情面板中新增「功能描述」卡片區塊；驗證有內容時顯示完整說明，無內容時顯示「尚未填寫」佔位文字。

## 4. 整合驗證與全流程測試

- [x] 4.1 執行全專案靜態檢查與型別驗證（`npm run lint` 與 `npx tsc --noEmit`），確保所有受影響檔案無語法或型別錯誤。
- [ ] 4.2 驗證商品完整生命週期端到端行為：新增帶有功能描述的商品、於詳情抽屜檢視、編輯修改內容與清空描述，確認資料呈現完全一致。

## 驗證紀錄（2026-09-07）

- `npm run typecheck`、`npm run lint`、`npm run build` 通過。
- 隔離的 PGlite/Postgres 測試已實際執行新 migration，驗證 RPC 新增、讀取、修改、清空、舊簽章省略可選參數、2,000 字元資料庫限制，以及公開推薦回傳描述。
- 驗證 Zod 2,000/2,001 字元邊界、換行保留、錯誤型別拒絕；React 詳情面板渲染保留換行並跳脫 HTML。
- 原 proposal 所列公開展示已同步更新 QR 推薦查詢與卡片，保留既有 token 與庫存擁有者篩選。
- 4.2 尚待實際登入環境的瀏覽器端到端驗證；隔離測試不代表線上驗收完成。
- 遷移檔尚未套用遠端資料庫。遠端唯讀連線停在 `Initialising login role...` 超過兩分鐘，已終止。
- 部署前須先套用 `20260907064534_add_product_description.sql`，再驗證新增、詳情、編輯及清空描述。
