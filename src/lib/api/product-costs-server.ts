import { apiFailure } from "@/lib/api/server-auth";
export function productCostFailure(error: { message: string; code?: string }) {
  const messages: Record<string, string> = {
    "invalid cost batches": "請確認每批張數、總成本及進貨日期",
    "invalid batch total": "請輸入有效的整批總成本，最多兩位小數",
    "cost batch list changed; reload": "進貨批次已有變更，請重新載入後再儲存",
    "inventory changed; reload": "庫存已變更，請重新載入後再儲存",
    "split quantity mismatch": "拆分後的張數合計必須等於原批次張數",
    "existing batch identity cannot change":
      "既有批次的張數與日期不可直接修改，請使用拆分批次或新增進貨",
    "invalid product unit cost": "請輸入有效的每張成本，最多兩位小數",
    "inventory uses period costs": "此庫藏採用帳期成本，無需填寫商品成本",
    "cost batch not found": "找不到這張海報的進貨批次，請重新載入",
    "cost batch changed; reload": "成本已被更新，請重新載入商品後再試",
    "settled batch cost is locked":
      "此批次已結算，請保留原成本，或新增進貨批次",
    "receipt cost cannot change previous batch":
      "新增庫存時，成本僅能套用本次進貨",
    "owner access required": "無法修改其他庫藏的商品成本",
    "product already merged": "商品已合併，請重新整理後編輯庫存商品",
  };
  if (error.code === "PGRST202")
    return apiFailure("商品批次成本暫時無法使用，請稍後再試", 503, error.code);
  return apiFailure(
    messages[error.message] ?? error.message,
    error.message.includes("access") ? 403 : 409,
    error.code,
  );
}
