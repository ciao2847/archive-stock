# 訂購安全驗證的恢復流程

一般訂購、配單及配單選單共用 `TurnstileWidget`。驗證由 Cloudflare 完成，伺服器仍會檢查 token、hostname 與 action，前端錯誤不會略過驗證。

驗證 SDK 下載失敗或超過 15 秒未完成時，會重新載入一次；再次失敗會顯示「重新驗證」。重試只重建驗證元件，不重載表單，保留暱稱、電話、備註、勾選與商品數量。使用共用的載入 Promise 避免多個元件同時下載 SDK，失敗後清除 Promise 與失敗的 script，使下一次可以真正重新請求同一個官方網址。

驗證成功會清除先前錯誤；失敗、過期或重設會立即清空 token。網路恢復、錯誤後回到頁面及 Safari 從上一頁快取恢復時，也可重新建立驗證。已移除元件的舊回呼不能重新寫入有效 token。設定錯誤顯示 Cloudflare 錯誤碼，供管理者確認網域或 site key；前端無法修復服務供應商的設定或持續遭阻擋的外部連線。

參考：[Cloudflare 錯誤處理](https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/)、[錯誤碼](https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/)。本機 Next.js 的 `next/script` 會快取失敗的 SDK 請求，因此此處使用可以清除失敗狀態的載入器。

驗證：`node tests/browser/turnstile-recovery.browser.mjs`，模擬腳本下載失敗、掛起逾時、手動重試、驗證恢復、過期、網路恢復、BFCache 恢復與保留表單資料。另以既有 `POSTER_BROWSER_SUITE=ordering node tests/browser/bundle-menu.browser.mjs` 檢查實際訂購流程。
