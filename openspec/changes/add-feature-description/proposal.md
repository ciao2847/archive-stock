## Why

目前系統在商品管理中僅提供「辨識特徵」（identifying_features，主要用於海報特定防偽或實體特徵，如燙金、Logo 標記），缺乏專門的「功能描述」（feature description / 商品功能與內容描述）欄位。使用者在建立或編輯商品時，無法完整記錄該收藏品或海報的詳細功能介紹、內容特色及故事背景，在商品檢視面板（ProductPanel）與公開展示頁面亦缺乏相應展示區塊。新增「功能描述」欄位能補足商品資訊完整度，讓倉管人員、藏家與消費者能更清晰地查閱商品的詳細內容與特性。

## What Changes

- **資料模型擴充**：在前端商品型別（`Product`）及驗證綱要（Zod schema）中新增 `description`（功能描述）欄位。
- **資料庫與 API 支援**：在後端商品資料表與 API 路由（`/api/products`、`/api/products/[id]`）中納入功能描述的讀取、建立與更新支援。
- **表單介面升級**：
  - 在「新增商品」（`NewProduct`）表單中新增「功能描述」多行文字輸入框（支援字數限制與提示）。
  - 在「編輯商品」（`EditProduct`）表單中同步加入「功能描述」編輯欄位。
- **商品展示優化**：
  - 在商品詳細抽屜面板（`ProductPanel`）中新增「功能描述」區塊，結構化呈現商品詳細說明。
  - 在商品公開或分享展示相關介面（如 QR 頁面或公開推薦清單）適當呈現功能描述。

## Capabilities

### New Capabilities

- `products/feature-description`: 定義商品「功能描述」在資料模型、建立/編輯表單驗證、API 讀寫以及商品詳情面板呈現的行為規格。

### Modified Capabilities

(None)

## Impact

- **型別定義**：`src/lib/types.ts`、`src/types/database.types.ts`
- **資料驗證**：`src/lib/validation/products.ts`
- **後端 API**：`src/app/api/products/route.ts`、`src/app/api/products/[id]/route.ts`
- **前端元件**：
  - `src/components/products/NewProduct.tsx`
  - `src/components/products/EditProduct.tsx`
  - `src/components/products/ProductPanel.tsx`
- **資料庫遷移（如需新欄位）**：`supabase/migrations/`（視需要增加 `description` 欄位或擴充 RPC 傳參）
