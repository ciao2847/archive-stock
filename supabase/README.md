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
