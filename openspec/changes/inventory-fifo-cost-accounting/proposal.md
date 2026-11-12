## Why
海報小天地使用帳期成本，NN佛系海報代購需要依售出數量與進貨批次核算成本，並逐筆輸入額外費用。

## What Changes
- 每個庫藏設定帳期成本或 FIFO 商品成本模式。
- 自動記錄進貨批次，補登期初／批次單件成本，區分未填與零元。
- 出庫依先進先出分配成本，退回與修改訂單正確回復原批次。
- 結算保存商品成本明細快照，額外費用沿用現有明細與分帳。
- 同步會計總覽與 Excel，提供權限與資料庫測試。

## Capabilities
### New Capabilities
- `inventory-fifo-cost-accounting`: 庫藏結算模式、批次成本與銷售成本快照。
### Modified Capabilities

## Impact
Supabase migration、商品批次成本 UI/API、庫藏設定、會計預覽／結算／匯出／總覽、測試。
