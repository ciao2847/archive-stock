import "server-only";
import { apiFailure } from "./server-auth";

export function accountingFailure(message: string, code?: string) {
  const messages: Record<string, string> = {
    "invalid financial details": "成本明細格式不正確，請確認日期、項目與金額",
    "cost detail total mismatch": "成本明細合計與總額不一致",
    "invalid profit shares": "請確認分帳對象與比例",
    "profit shares must total 100 percent": "分帳比例合計須為 100%",
    "owner access required": "無法存取其他庫藏的結算資料",
    "period already settled":
      "這個帳期已結算或與歷史結算重疊，不能再修改或重複結算",
    "settled period cannot be changed": "已結算的帳期不能修改",
    "confirm period cost first": "請先確認並儲存這個帳期的成本總額",
    "period cost was changed; reload":
      "其他人已更新成本，請重新載入後確認最新金額",
    "invalid period dates": "請選擇完整的雙月帳期",
    "invalid finance image": "圖片不存在或不屬於目前庫藏，請重新上傳",
    "duplicate finance image": "同一張圖片不可重複加入",
    "invalid period amount": "請輸入有效的成本金額，最多兩位小數",
  };
  if (["PGRST202", "42P01", "42703", "PGRST205"].includes(code ?? "")) {
    return apiFailure(
      "帳期成本功能尚未安裝，請執行 calculator_period_accounting 資料庫遷移",
      503,
      code,
    );
  }
  return apiFailure(
    messages[message] ?? "結算資料處理失敗，請重新載入後再試",
    message.includes("access") ? 403 : 409,
    code,
  );
}
