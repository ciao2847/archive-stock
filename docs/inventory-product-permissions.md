# 庫藏成員的商品權限

一般管理者（staff）可以編輯、減少庫存與刪除其 `inventory_owner_id` 所屬庫藏的商品；超級管理者（admin）保留跨庫藏管理能力。不需要將庫藏成員升級為超級管理者。

商品詳細頁對已載入的庫藏商品提供刪除按鈕；DELETE API 使用與 PATCH 相同的 admin／staff 登入要求。最後的商品範圍由現有 `delete_inventory_product`（SECURITY INVOKER）及資料庫 RLS 檢查，不能刪改其他庫藏商品。庫存調整沿用既有 RPC，同步維護商品碼。

刪除仍需確認，沿用既有商品與交易歷史的刪除流程。不存在或其他庫藏的商品回傳 404；缺少資料庫權限回傳 403，不會假報刪除成功。

驗證：

- `node --experimental-strip-types --test tests/product-delete-api.test.mts`
- `node tests/browser/product-member-access.browser.mjs`
- `supabase/tests/inventory_member_product_access.test.sql`（交易內建立測試商品，結束時全部回復）
- 既有 `supabase/tests/delete_inventory_products.test.sql` 測試含訂單、包貨、QR 與結算紀錄的刪除。

這次修復網站按鈕與 API 的舊版 admin 限制；資料庫的庫藏成員權限已安裝，不新增寬鬆 RLS 或服務金鑰繞過權限。
