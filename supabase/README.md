# Supabase database workflow

This project uses timestamped, imperative migrations.

## Source of truth

- `migrations/` contains every new production database change.
- `legacy/` contains historical installation scripts that were applied manually
  before migration tracking was introduced. Do not edit or rerun them blindly.
- `scripts/` contains destructive or one-off maintenance tools. Review and run
  them manually; they are never part of deployment migrations.

## Commands

```bash
npx supabase@2.116.0 migration new descriptive_name
npx supabase@2.116.0 migration list --linked
SUPABASE_PROJECT_ID=your-project-ref npm run db:types
```

Apply migrations to a staging project first. Run database advisors and the test
suite before applying the same migration to production.

## 配單入庫核對

Apply `20261102090000_receive_bundle_products_into_inventory.sql` before deploying
the receiving UI/API. It adds a durable product link to each bundle item image. Completing
入庫核對 creates one inventory product and one QR label per item, copies its name,
price and image, and links it to the original order for packing. Category is 海報,
source is 配單入庫; country/version and storage location remain unspecified because
配單 does not record them. Equal names are not merged automatically.

Existing manually mapped products are reused without increasing stock. Repeated
checks and reversing/rechecking never create or restock products. Reversing a
check only clears checklist status; correcting physical stock remains an inventory
operation. Previously checked orders are not backfilled automatically. Legacy
orders without complete item names/prices must have their item details resolved
before automatic receiving; their total alone is insufficient to create products.

The API prepares copies in `product-images` using stable paths before the database
transaction. Failed attempts keep prepared copies for safe retries, including
concurrent attempts. Product creation, QR labels, fulfillment mapping and check
status all commit or roll back together. Run
`node --experimental-strip-types --test tests/claim-fulfillment-db.test.mts tests/bundle-receiving-api.test.mts`
for local receipt, packing, permission and retry checks. Run
`POSTER_BROWSER_SUITE=receiving node tests/browser/bundle-menu.browser.mjs`
after a build for the mobile and desktop receiving controls.

## Stall checkout

Apply `20261014002007_add_stall_checkout.sql` to staging before deploying the
checkout UI, then run `tests/stall_checkout.test.sql` as the database owner on
a test database with a staff member and two inventories. The test rolls back
its fixtures. Apply the migration to production through the usual release
workflow after validation.

Existing `products.price` values remain member prices. Label exports show
member prices and list prices (member price + NT$150). The authenticated
checkout RPC recalculates list prices, checks the displayed total, records a
paid, packed order, decrements stock and consumes the scanned labels in one
transaction. A retry with the exact original set of sold labels returns the
existing receipt. No payment gateway is involved; staff confirm payment at
the stall.

## Stall discounts and payment reconciliation

Apply `20261105075823_stall_checkout_discounts_and_payments.sql` before deploying
this checkout update. It uses the existing `orders.discount` and adds
`orders.stall_payment_method`. Historical payment methods remain `unspecified`;
new sales record cash, transfer, LINE Pay, card or other. Staff confirm payment
manually; choosing a method does not charge a payment provider.

Discounts are whole-order monetary reductions, at most the item subtotal and
with at most two decimal places. Net receipts, order history and daily totals
subtract the discount. Daily reconciliation groups paid, non-cancelled stall
orders by payment method using Taiwan dates. Existing financial settlement uses
the same order discount. Editing preserves the usual revision and settlement
locks; older clients preserve the recorded discount and method. Checkout replay
returns the original receipt, even if the retry sends different payment fields.

Validate with `node --experimental-strip-types --test tests/stall-payments-db.test.mts tests/stall-checkout-api.test.mts tests/stall-summary-api.test.mts tests/stall-sales.test.mts tests/stall-orders-api.test.mts`
and `node tests/browser/stall-checkout.browser.mjs` after a build.

## Paid procurement quantities

Apply `20261105084433_paid_claim_procurement.sql` before deploying the procurement
summary update. `get_claim_form_summary(bigint)` keeps the full order quantity
and adds `paid_quantity`, counting only submissions with `payment_status=paid`.
Pending and half-paid orders remain visible in total demand and unsettled units.
The calculation covers all submissions in the selected form, independent of list
pagination. Payment corrections are reflected at the next summary refresh.

Procurement CSV exports SKU, product name and fully paid units only, omitting
products with zero paid units. It is disabled when no paid products exist.
Validate with `node --experimental-strip-types --test tests/claim-procurement.test.mts`.

## Customer name corrections

Apply `20261105092535_edit_order_customer_names.sql` before deploying the name
editor. The employee-only `update_order_customer_name` RPC checks inventory,
source and the previously displayed name. It updates the source and linked
contact atomically, including contacts on packed or settled orders. Name-only
changes skip fulfillment item/payment projection; other source updates retain
the existing trigger behavior. General orders with shared customer rows receive
a separate contact so other orders keep their names.

The pencil opens the same editor design as phone corrections. It is available
on confirmed bundles, preorder details, reconciliation line items and general
order rows. Corrections affect only the selected record. Validate with
`node --experimental-strip-types --test tests/customer-name-api.test.mts tests/customer-name-db.test.mts`,
`node tests/browser/customer-name.browser.mjs` and the phone editor browser suite.

### 預售商品合併至已入庫商品

`20261106013840_merge_preorders_into_inventory.sql` 增加預覽／確認合併 RPC，以及合併紀錄與已停用商品的寫入防護。部署順序為先套用此遷移，再部署使用 `merged_into_product_id` 的商品／庫位 API 和合併介面。前置資料結構包含 `20261020033449_connect_claims_to_packing.sql`、庫位分配，以及 `20261102090000_receive_bundle_products_into_inventory.sql`。

操作入口在訂購頁的商品設定，尚未入庫的商品旁有「合併至庫存商品」。先儲存商品設定，選擇同庫藏已入庫商品，預覽所有受影響的訂購頁與訂單，再確認。已下單商品的名稱／SKU 快照、數量、單價、付款、包貨進度保留；庫存、QR 標籤與庫位分配不變。若同一訂單同時含兩個商品，預覽會列出衝突並阻擋確認；不自動合併不同價格的成交明細。相同訂購頁已包含目標商品時，保留目標原有公開設定。

本機驗證：`node --experimental-strip-types --test tests/product-merge-api.test.mts tests/product-merge-db.test.mts`；完成 build 後可執行 `node tests/browser/product-merge.browser.mjs`。資料庫測試使用 PGlite 執行正式交易、參照防護與真實包貨同步觸發器。CLI security advisors 需要可連線的本機 Supabase；此工作區未啟動 54322 服務，無法執行完整 advisors，部署前應在已套用遷移的環境執行。

部署不會自動選配或合併正式資料。已完成的合併不應透過移除合併欄位回滾；若需撤回介面，保留資料庫的合併紀錄與防護。

### 庫藏別結算與 FIFO 批次成本

`20261112013316_inventory_fifo_cost_accounting.sql` 新增庫藏結算模式。部署順序為先執行 migration，再部署應用程式；此 migration 不會重算或改寫任何舊結算。

- 海報小天地及其他庫藏預設維持帳期成本。原始遷移比對簡稱「佛系代購」，實際完整名稱經確認為「NN佛系海報代購」；請接著執行 `20261112021946_correct_nn_inventory_accounting_mode.sql` 修復啟用。也可於新版網站的「設定 → 庫藏結算方式」明確啟用。
- 初次啟用時，現有庫存與未結算的已包裝數量建立期初批次，成本維持「未填」，不會把舊的商品成本或零元當成已確認成本。若舊批次不可區分，可填入已核對的平均單件成本。
- 新增商品、入庫或增加庫存後會自動建立新批次。開啟商品資料的「進貨批次與成本」，逐批填寫 TWD 單件成本與備註。零成本須明確輸入 `0`。
- 批次依建立時間先進先出；部分包裝先保留成本批次，整單已包裝／已出貨才沿用原有雙月歸帳規則。未結算訂單減量或取消時，庫存回補會釋放原批次，不會新增假進貨批次。
- 手動減少庫存會列為批次的庫存調整減量，不計入售出商品成本；需要把報損列入當期費用時，應另以額外費用登錄。
- FIFO 模式的原有帳期成本明細代表「額外費用」。若啟用前已填商品購入總額，請先人工核對並移除與商品批次成本重複的費用。已包含於單件成本的運費不得再次列入額外費用。
- 會計頁顯示每筆售出的訂單、商品、進貨日、數量、單件成本與小計；缺漏可在會計頁展開商品直接補登。缺少成本時可以銷售，但不得結算或匯出可能不完整的報表。
- 結算合計為「售出批次成本＋額外費用」。結算保存成本模式、商品成本與明細快照；已使用於結算的批次成本不可再改，已結算訂單項目也不能修改。剩餘批次數量仍可在後續銷售使用。
- 已建立成本批次後，禁止切回帳期成本模式，避免同一套庫存中斷成本追蹤。
- 新表開啟 RLS，成員僅可讀取自身庫藏；成本與模式寫入走具有庫藏授權檢查的 RPC。authenticated 無直接批次寫入權限，anon 無讀寫權限。

驗證：`node --experimental-strip-types --test tests/inventory-fifo-db.test.mts` 使用 PGlite 執行實際 migration 與 SQL，涵蓋跨批次、部分包裝、庫存調整、訂單回補、缺漏成本、零元、版本衝突、結算鎖定與租戶隔離。`node tests/browser/inventory-fifo.browser.mjs` 驗證手機與桌面成本補登與會計更新。

#### 已執行初始遷移時的名稱修復

若 `20261112013316_inventory_fifo_cost_accounting.sql` 已執行成功，但實際名稱為「NN佛系海報代購」，僅需接著執行 `20261112021946_correct_nn_inventory_accounting_mode.sql`，無需重跑原始遷移。

修復檔可由 Supabase SQL Editor 的 `postgres` 角色完整執行。它會確認名稱唯一，透過現有管理員及已檢查權限的啟用流程建立期初成本批次；沒有管理員、找不到名稱或找到重複名稱會明確報錯。交易後恢復身分設定，不修改 RLS 或任何函式權限。可重複執行，不會覆蓋已填成本或重複建立批次。

執行結果直接列出「NN佛系海報代購」與「海報小天地」的名稱、結算模式及批次數。預期前者為 `product_fifo`，後者維持 `period_total`。這仍屬資料庫更新，網站程式需要另外部署後才有填寫成本的介面。

### 每張海報直接輸入成本

`20261112024350_product_unit_cost_entry.sql` 新增 `products.purchase_unit_cost`，並提供商品資料與成本一次儲存的 RPC。先套用此遷移，再部署表單更新。

NN佛系海報代購的新增／編輯商品會在售價旁顯示「每張成本（TWD）」。新增商品時，成本與商品及初始進貨批次一起儲存；零庫存預購商品也可先記錄成本。增加庫存時，每張成本套用至這次新增的進貨批次，保留舊批次成本。既有單一可編輯批次會自動套用；有多個批次時，可明確選擇要修改哪個批次，或僅設定後續進貨的預設成本。已有結算的批次維持鎖定。海報小天地不顯示商品成本欄位，沿用原本的商品儲存流程。

此遷移不以價格估算任何未知成本，僅從最新已知批次帶出海報的預設成本。庫存由其他入口增加時，會沿用海報的預設每張成本；可再於商品資料中修正新批次的實際成本。成本修訂衝突或鎖定錯誤會回滾整次商品／成本更新。

驗證：`node tests/browser/product-unit-cost.browser.mjs` 測試新增、編輯、新批次成本與手動帳期庫藏在手機及桌面的表單操作。資料庫測試在 `tests/inventory-fifo-db.test.mts` 直接使用正式商品建立、修改與庫存調整函式。
