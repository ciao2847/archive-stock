# 庫藏成員的 PWA 新訂購通知

收件人是已登入並在該裝置開啟通知的庫藏成員。客人不需要安裝 PWA。

## 手機操作

1. iPhone／iPad：以 Safari 開啟網站，分享 → 加入主畫面，再從主畫面圖示開啟。
2. 登入後進入「系統設定 → 手機通知」，按「開啟手機通知」，允許系統通知。
3. 超級管理員可勾選接收哪些庫藏；一般使用者只訂閱自己所屬的庫藏。
4. 按「傳送測試通知」，確認通知中心收到提醒。
5. 通知點擊後開啟受登入與庫藏權限保護的訂購明細。未登入時會先登入並返回明細。

Android 可使用支援 Web Push 的 Chrome／Firefox，建議加入主畫面。
每台裝置各自開關，不會影響同帳號其他裝置。登出時會取消該裝置的訂閱。
通知顯示仍受手機權限、專注／勿擾模式及網路狀態影響；不能代替訂購紀錄本身。

## 事件與可靠性

- 預購訂購：`claim_submissions` 新增成功後建立事件。
- 配單：`bundle_claim_orders` 首次變成 `confirmed` 時建立事件，涵蓋單份與共同選單。
- 事件及每裝置投遞都有唯一鍵，避免客人重試或重複更新建立重複通知。
- 事件與訂購同一個交易寫入；`pg_net` 在交易提交後喚醒派送 API，不等待推播供應商。
- `pg_cron` 每分鐘重新喚醒尚有待送工作的派送器，並以租約及 `SKIP LOCKED` 避免並行工作重複處理。
- 暫時錯誤使用遞增延遲，最多嘗試 6 次；404／410 移除失效裝置。通知使用同事件的 tag。
  推播供應商已接受、但確認寫回失敗的極少數情況可能重送，tag 可替換同一張通知。
- 派送前再次核對成員資格及裝置選擇；離開庫藏就不再派送該庫藏的佇列。
- 鎖定畫面只顯示庫藏、件數、金額，不顯示客人姓名或電話。
- Service Worker 不快取登入頁面或 API 資料，不提供離線交易。

## 部署

資料庫 migration：

- `20261015083525_add_inventory_order_push.sql`
- `20261015084455_declare_push_worker_policy.sql`

Vercel Production 伺服器環境變數：

- `VAPID_PUBLIC_KEY`：`web-push.generateVAPIDKeys()` 產生的公開金鑰。
- `VAPID_PRIVATE_KEY`：同一組私密金鑰；以 Sensitive 保存。
- `PUSH_CRON_SECRET`：隨機高強度憑證，以 Sensitive 保存。
- `VAPID_SUBJECT`：選填，預設 `https://archive-stock.vercel.app`。
- 沿用現有 `SUPABASE_SECRET_KEY`，僅限伺服器。

公開金鑰由登入後的通知 API 回傳，無須 `NEXT_PUBLIC_` 編譯時設定。
不要重新產生已啟用裝置使用的 VAPID 金鑰；若必須輪替，裝置需要關閉後重新開啟通知。

Supabase Vault 需有：

- `order_push_cron_secret`：與 `PUSH_CRON_SECRET` 相同。
- `order_push_worker_url`：`https://archive-stock.vercel.app/api/push/dispatch`。

Cron 的工作名稱為 `archive-order-push-retry`，只在有到期的待派送工作時發出 HTTP 請求。
派送 API 不使用瀏覽器登入，改以 Bearer secret 驗證；其他通知 API 都要求登入及同源請求。

正式環境的金鑰、Vault 與排程已由本次部署配置。任何憑證都不可提交到 Git 或列印在記錄中。

## 驗證

```sh
npm test
npm run typecheck
node tests/browser/push-notifications.browser.mjs
```

`supabase/tests/order_push.test.sql` 驗證資料庫成員隔離、重複事件、退出庫藏與投遞租約，
測試全部回滾。瀏覽器測試使用假的推播供應商，不會向真實裝置發通知。
真實 iPhone／Android 的通知授權與系統顯示，需由持有手機的使用者按測試通知確認。
