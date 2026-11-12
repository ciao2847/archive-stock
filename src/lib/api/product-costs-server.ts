import { apiFailure } from "@/lib/api/server-auth";
export function productCostFailure(error: { message: string; code?: string }) {
  const messages: Record<string, string> = {
    "invalid product unit cost": "請輸入有效的每張成本，最多兩位小數",
    "inventory uses period costs": "此庫藏採用帳期成本，無需填寫商品成本",
    "cost batch not found": "找不到這張海報的進貨批次，請重新載入",
    "cost batch changed; reload": "成本已被更新，請重新載入商品後再試",
    "settled batch cost is locked":
      "此批次已結算，請選擇其他批次或僅設定後續進貨成本",
    "receipt cost cannot change previous batch":
      "新增庫存時，成本僅能套用本次進貨",
    "owner access required": "無法修改其他庫藏的商品成本",
    "product already merged": "商品已合併，請重新整理後編輯庫存商品",
  };
  if (error.code === "PGRST202")
    return apiFailure(
      "商品成本欄位尚未安裝，請先執行 product_unit_cost_entry 資料庫遷移",
      503,
      error.code,
    );
  return apiFailure(
    messages[error.message] ?? error.message,
    error.message.includes("access") ? 403 : 409,
    error.code,
  );
}
