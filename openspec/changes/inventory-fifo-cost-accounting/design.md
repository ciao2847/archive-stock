## Context
現有會計使用雙月成本明細與不可變結算；多種出貨入口共用 products.stock 與 order_items.packed_quantity。

## Goals / Non-Goals
Goals: 每個庫藏獨立模式，FIFO 分配、成本補登、額外費用、結算快照與匯出一致。
Non-Goals: 外幣換算、法定財務報表、已結算歷史重算。

## Decisions
- 使用資料庫延遲觸發器觀察交易最終庫存與已包裝數量，避免攤位修改／取消先回補庫存時誤建新批次。
- 批次記錄數量、單件成本（nullable）、日期與報損數量，銷售分配保存各訂單項目的使用量；依批次建立時間 FIFO。
- 增量調整分配，減量由該訂單最後分配批次退回，已結算分配不可改。
- 新庫存自動建立待補成本批次；現有庫存與未結算銷售建立期初批次，舊結算不回算。
- 結算沿用 period_total 身份與帳期鎖，額外欄位保存模式、商品成本總額與 JSON 明細快照；原 amount 仍代表額外費用。
- 模式一經啟用且有成本記錄後不可切回，避免失去帳務連續性。
- 權限沿用庫藏成員與 admin，批次表僅授予讀取，寫入走檢查過的 private RPC。

## Risks / Trade-offs
- 舊庫存成本不明 → 明確顯示缺漏並阻擋結算，允許人工確認平均成本。
- 手動調低庫存 → 自動記錄未售出減量，不列入銷售成本。
- 部分包裝 → 先保留批次，整單包裝完成後才依原會計規則歸帳。

## Migration Plan
先套用新 migration，再部署程式。原始遷移以簡稱「佛系代購」初始化；後續修復遷移依使用者確認的完整名稱「NN佛系海報代購」定位唯一庫藏，再使用既有啟用流程建立期初批次。修復使用資料庫擁有者執行，交易內採用現有管理員身分並立即恢復，不變更任何 RLS 或授權。海報小天地維持帳期成本。修復可重複執行而不重建批次或覆蓋成本。先備份後回滾，已有結算時不移除帳務資料。

## Direct poster cost input
Add products.purchase_unit_cost as a nullable default for each poster, including zero-stock preorders. New receipts inherit this default, while previously received lots remain independent. The existing product-cost read RPC returns this default alongside batches. A checked private wrapper with an invoker public entry point saves ordinary or named product metadata, stock, the per-poster default, and any selected batch cost in one transaction. Existing product RPCs remain available for manual inventories and clients that omit cost. A new receipt's price never overwrites old batches; edits to existing batches require their revision and reject locked settled lots. Product forms load accounting mode and costs without requiring an additional query provider, show a direct unit-cost field beside price, and allow an explicit batch choice when several editable lots exist.

## Batch total correction
Replace the product form's single unit-cost control with a list of receipt rows. Store total_cost as authoritative money, show a computed average, and record cost_amount on allocations plus written_off_cost on receipt adjustments. Consume an exact rounded share of the remaining monetary balance, assigning the remaining balance when the final units leave; partial returns restore a rounded portion of the original allocation. This preserves previously settled allocations and reconciles each whole batch exactly. Legacy per-unit APIs remain compatible by deriving a batch total. Product batch saves validate an optimistic snapshot, add new receipts, update unsettled total costs and optionally split an unsettled source while preserving quantity and order references. Existing batch quantities/dates cannot silently change; splitting is explicit and locked sources are rejected. All metadata and batch operations share one transaction. Product stock is derived from remaining existing batches plus new receipts rather than edited twice.

Split children retain the source FIFO position and an ordered integer path. This preserves equal-timestamp receipt ordering across repeated splits; legacy timestamp/UUID ordering is retained during migration.

## Public order trigger correction
Public submission RPCs validate the form token and create pending fulfillment rows through private triggers. Deferred FIFO triggers must skip zero-packed item changes without allocations and unrelated order updates; they reconcile orders only for packed or allocated items. This keeps the manager-only reconciliation function and existing RLS/grants intact, while allowing anonymous and unrelated authenticated customers to submit pending orders. Test the complete public-submit → fulfillment → deferred-trigger chain with actual production function definitions and force deferred constraints before asserting success.
