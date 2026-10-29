# 各庫藏串接不同官方 LINE

同一網站可同時處理多個官方 LINE 的自動回覆。每個帳號只能查詢設定中綁定的庫藏，
不會依照客人輸入的庫藏 ID 或手機號碼切換庫藏。不同庫藏即使有同一手機號碼，也各自回覆自己的資料。

## 1. 取得庫藏 ID 與設定顧客入口

在「系統設定 → 訂購完成設定」為每個庫藏填寫自己的官方 LINE ID、匯款帳號及結帳提醒。
這些是對客人顯示的資料；填入 `@帳號` 本身不會啟用機器人。

庫藏 UUID 可在登入網站後開啟瀏覽器開發者工具，查看 `/api/account` 回應中的
`inventoryDatabases[].id` 與 `name`，或由管理者在資料庫的 `inventory_databases` 確認。

## 2. 設定伺服器環境變數

小天地已使用原本的 `LINE_INVENTORY_ID`、`LINE_CHANNEL_SECRET`、
`LINE_CHANNEL_ACCESS_TOKEN`；保留這三個設定。

第二個官方帳號在 LINE Official Account Manager 的「設定 → Messaging API」啟用
Messaging API，接著在 LINE Developers 選擇該頻道：

- **Basic settings → Channel secret**：取得 Secret。
- **Messaging API → Channel access token**：取得或簽發 Token。

在 Vercel 的 `ciao2847s-projects / poster` 專案，進入
**Settings → Environment Variables**，為 **Production** 新增以下三項：

| 變數名稱                           | 值                                                       |
| ---------------------------------- | -------------------------------------------------------- |
| `LINE_SECOND_INVENTORY_ID`         | `1e404a76-ba40-4cd8-bb5a-dd87236121b1`（NN佛系海報代購） |
| `LINE_SECOND_CHANNEL_SECRET`       | 第二個官方帳號的 Channel Secret                          |
| `LINE_SECOND_CHANNEL_ACCESS_TOKEN` | 第二個官方帳號的 Channel Access Token                    |

兩個憑證標記為 Sensitive。請一次填齊三項，再從 **Deployments** 對最新正式部署
選擇 **Redeploy**。三項缺一不會啟用不完整的串接。
不要將第一個帳號的 Secret 或 Token 複製給第二個帳號。

不要加 `NEXT_PUBLIC_` 前綴，也不要將實際憑證提交到 Git、貼到聊天或放進前端設定。
`NEXT_PUBLIC_SUPABASE_URL` 及伺服器端 `SUPABASE_SECRET_KEY` 也需存在。

### 超過兩個官方帳號

可改用伺服器端 `LINE_CHANNELS` JSON 陣列：

```json
[
  {
    "inventoryId": "00000000-0000-4000-8000-000000000001",
    "channelSecret": "第一個帳號的 Channel Secret",
    "channelAccessToken": "第一個帳號的 Channel Access Token"
  },
  {
    "inventoryId": "00000000-0000-4000-8000-000000000002",
    "channelSecret": "第二個帳號的 Channel Secret",
    "channelAccessToken": "第二個帳號的 Channel Access Token"
  }
]
```

此變數非空時完整取代原有單帳號及第二帳號設定；請一次列入所有要啟用的帳號。
每個庫藏、Secret、Token 都不可重複。最多 20 個帳號，修改後需重新部署。

## 3. 設定兩個帳號的 Webhook

兩個頻道都使用相同網址：

```text
https://archive-stock.vercel.app/api/line/webhook
```

在 LINE Developers 的 Messaging API 頁面按 **Verify**，成功後開啟 **Use webhook**。
網站會用各頻道的 Secret 驗證原始訊息簽章，通過後選擇對應庫藏及該帳號自己的 Token 回覆。
查詢明細只會讀取既有 `query_customer_claims_summary` RPC 中該庫藏的訂購及配單紀錄。
建議關閉官方帳號後台會與機器人重複回覆的自動回應。

## 4. 驗收

1. 在兩個官方 LINE 分別輸入「結帳與查詢」，確認收到輸入手機號碼的提示。
2. 使用同一組測試手機號碼，在兩個庫藏分別建立內容不同的測試訂購。
3. 分別查詢，確認品項、金額、銀行帳號與結帳提醒都屬於正確庫藏。
4. 傳送「已匯款」或末五碼，確認提醒仍由管理者核對，不能因此自動改成已付款。

自動結帳在此指整理待付明細、加總金額及提供匯款資料；尚未串接金流或銀行自動對帳。
目前手機查詢沿用原有流程，不代表已驗證手機持有人身分。

## 文件

- [接收 Webhook](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [驗證 Webhook 簽章](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)

訂單查詢支援已結帳、未結帳與全部訂單分類；電話提示、分頁與匯款回報邏輯見
[LINE 訂單查詢文字流程](line-order-queries.md)。
