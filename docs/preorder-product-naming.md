# 預購商品命名

在訂購商品設定新增預購商品時，填寫作品名稱、自由輸入品項名稱，並選擇國家。作品名稱會先沿用現有品項的作品，或由表單標題提供可修改的建議。

名稱格式為「國旗 作品名稱 品項名稱」。品項可填 A款、B款、全員款、肖像款或其他名稱。單品的品項名稱可留空；多品表單中的新制商品需要填寫品項名稱。不同國家或款式各自保有商品編號、圖片、價格與尺寸。

新增預購維持庫存 0。到貨後編輯同一筆商品的庫存數量，沿用商品編號與預購關聯；不會因為加入訂購表單而占用現貨。

新制商品可從訂購商品清單的鉛筆入口或庫存商品編輯視窗修改作品、品項與國家。名稱由系統組合，訂購清單沿用庫存名稱。修改會更新尚未送出的訂購頁，已送出訂單的商品名稱快照維持原樣。修改表單標題不會改名商品。

資料庫 `products.preorder_item_name` 為 NULL 時沿用舊制公開名稱；空字串代表新制單品，不進行舊資料改名或自動合併商品。`save_named_inventory_product` 使用現有 RLS 與庫存函式，在同一交易完成商品、品項資料、入庫及 QR 調整。匿名不可呼叫，庫藏使用者不可管理其他庫藏。

先套用 `20261019003454_add_preorder_product_naming.sql`，再部署應用程式。驗證包括：

- `supabase/tests/preorder_product_naming.test.sql`：在交易內驗證命名、庫藏權限、入庫、訂購名稱同步與訂單快照，最後回滾測試資料。
- `node --experimental-strip-types --test tests/preorder-product-name.test.mts`
- `npm run build` 後執行 `node tests/browser/preorder-naming.browser.mjs`
