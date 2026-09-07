## Context

系統目前商品資料儲存於 Supabase `products` 資料表，並透過資料庫 RPC（`create_inventory_product` 與 `update_inventory_product`）以及 Next.js 伺服端 API Route（`src/app/api/products/route.ts` 和 `src/app/api/products/[id]/route.ts`）執行驗證與寫入。
目前商品資料模型中僅有辨識特徵（`identifying_features` / 前端映射為 `feature`），主要用於海報防偽或印製細節。系統缺少獨立且結構化的「功能描述（description）」欄位來記錄商品內容故事、詳細功能介紹或特殊備註說明。
詳見 `proposal.md`。

## Goals / Non-Goals

**Goals:**
- 在商品資料表新增專屬 `description` 欄位，並於前後端型別系統與 API 路由中提供完整的讀寫支援。
- 更新資料庫 RPC 函式（`create_inventory_product` 與 `update_inventory_product`），納入可選參數 `p_description text DEFAULT NULL`。
- 在 `NewProduct` 與 `EditProduct` 表單中提供清晰易用的「功能描述」多行文字編輯區，支援最大 2,000 字元長度限制與防呆驗證。
- 在 `ProductPanel` 商品詳情抽屜中新增「功能描述」展示區塊，保有空值友善提示（如「尚未填寫」）。
- 確保現有商品資料相容性，未填寫功能描述的舊商品正常運作。

**Non-Goals:**
- 富文字編輯器（WYSIWYG）或 Markdown 即時預覽支援（維持系統簡潔設計，支援純文字換行保留即可）。
- 取代或合併現有的「辨識特徵（feature）」欄位；「功能描述」著重商品內容與特性介紹，「辨識特徵」專注於實體印刷或版本鑑定。

## Decisions

### 1. 資料庫欄位設計與 RPC 參數相容性
- **決策**：在 `public.products` 資料表透過 Supabase Migration 新增 `description text` 欄位，並更新 `create_inventory_product` 與 `update_inventory_product` 函式簽章，加入 `p_description text DEFAULT NULL`。
- **替代方案評估**：
  - *重用現有 `notes` 欄位*：`notes` 語意多偏向內部後台操作備忘，若用於面向展示的功能描述會導致語意混淆與未來擴充困難，故予以否決。
  - *以獨立子表關聯*：一對一功能描述抽成獨立表過度設計，增加 join 成本，故直接擴充欄位於 `products`。

### 2. 前後端命名一致性
- **決策**：前端型別 `Product` 中新增 `description?: string;`，API 驗證（`src/lib/validation/products.ts`）中加入 `description: z.string().max(2000).optional().default("")`。
- **理由**：與 Location、Order 等其他模組的描述欄位保持相同的命名慣例 `description`，降低維護心智負擔。

### 3. 表單與詳情介面排版佈局
- **決策**：
  - 在 `NewProduct.tsx` 和 `EditProduct.tsx` 中，將「功能描述」配置為全寬（`wide`）的 `textarea` 輸入框，置於商品規格後、操作按鈕前。
  - 在 `ProductPanel.tsx` 中，在現有「辨識特徵」卡片旁或緊鄰下方配置「功能描述」卡片區塊，採用統一的卡片圓角與背景樣式（`bg-primary-soft`）。
- **理由**：維持既有設計系統一致性，並提供藏家與工作人員直觀的閱讀階層。

## Risks / Trade-offs

- **[Risk] PostgREST RPC 函式簽章重載衝突**
  → **緩解措施**：在 Supabase Migration 中，使用 `drop function if exists` 卸載舊簽章，再以包含 `p_description` 的新簽章建立，並重新配置 `grant execute`，避免 PostgREST 出現 ambiguous function 錯誤。
- **[Risk] 舊版本客戶端或暫存缺少該欄位**
  → **緩解措施**：後端 RPC 與 Zod 驗證皆將 `description` 設為 nullable / optional，查詢時 `coalesce` 或空值安全防護，保證向後相容。
