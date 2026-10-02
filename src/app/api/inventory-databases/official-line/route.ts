import { z } from "zod";

import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";
import { OFFICIAL_LINE_ID_PATTERN } from "@/lib/claims";

const updateClaimCheckoutSchema = z
  .object({
    id: z.string().uuid(),
    officialLineId: z
      .string()
      .trim()
      .max(100)
      .transform((value) =>
        !value || value.startsWith("@") ? value : `@${value}`,
      )
      .refine(
        (value) => !value || OFFICIAL_LINE_ID_PATTERN.test(value),
        "官方 LINE ID 格式錯誤",
      ),
    claimCompletionMessage: z.string().trim().max(1000),
    claimTransferEnabled: z.boolean().optional(),
    claimBankCode: z
      .string()
      .trim()
      .max(3)
      .refine((value) => !value || /^\d{3}$/.test(value))
      .optional(),
    claimBankName: z.string().trim().max(80).optional(),
    claimBankBranch: z.string().trim().max(100).optional(),
    claimBankAccount: z
      .string()
      .trim()
      .max(20)
      .refine((value) => !value || /^\d{5,20}$/.test(value))
      .optional(),
    claimBankAccountName: z.string().trim().max(100).optional(),
  })
  .superRefine((value, context) => {
    if (
      value.claimTransferEnabled &&
      (!value.claimBankCode ||
        !value.claimBankName ||
        !value.claimBankAccount ||
        !value.claimBankAccountName)
    ) {
      context.addIssue({
        code: "custom",
        message: "匯款帳號資料不完整",
        path: ["claimTransferEnabled"],
      });
    }
  });

export async function PUT(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = updateClaimCheckoutSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiFailure(
      parsed.error.issues[0]?.message || "喊單完成設定格式錯誤",
      400,
    );
  }
  if (auth.role !== "admin" && parsed.data.id !== auth.inventoryOwnerId) {
    return apiFailure("只能修改自己所屬庫藏的官方 LINE", 403);
  }

  const { data, error } =
    parsed.data.claimTransferEnabled === undefined
      ? await auth.supabase.rpc("update_inventory_claim_checkout_settings", {
          p_inventory_id: parsed.data.id,
          p_official_line_id: parsed.data.officialLineId,
          p_completion_message: parsed.data.claimCompletionMessage,
        })
      : await auth.supabase.rpc("update_inventory_claim_payment_settings", {
          p_inventory_id: parsed.data.id,
          p_official_line_id: parsed.data.officialLineId,
          p_completion_message: parsed.data.claimCompletionMessage,
          p_transfer_enabled: parsed.data.claimTransferEnabled,
          p_bank_code: parsed.data.claimBankCode ?? "",
          p_bank_name: parsed.data.claimBankName ?? "",
          p_bank_branch: parsed.data.claimBankBranch ?? "",
          p_bank_account: parsed.data.claimBankAccount ?? "",
          p_bank_account_name: parsed.data.claimBankAccountName ?? "",
        });
  if (error) {
    const messages: Record<string, string> = {
      "invalid official LINE ID": "請輸入正確的官方 LINE ID，例如 @youraccount",
      "claim completion message is too long":
        "喊單完成提醒不可超過 1000 個字。",
      "invalid bank code": "銀行代碼請輸入 3 位數字。",
      "invalid bank name": "銀行名稱格式錯誤。",
      "invalid bank branch": "分行名稱格式錯誤。",
      "invalid bank account": "匯款帳號請輸入 5～20 位數字。",
      "invalid bank account name": "戶名格式錯誤。",
      "incomplete bank account": "請填寫完整的銀行代碼、銀行名稱、帳號與戶名。",
    };
    const message = messages[error.message] || error.message;
    return apiFailure(message, 400, error.code);
  }

  return apiSuccess({
    id: data,
    officialLineId: parsed.data.officialLineId,
    claimCompletionMessage: parsed.data.claimCompletionMessage,
    ...(parsed.data.claimTransferEnabled === undefined
      ? {}
      : {
          claimTransferEnabled: parsed.data.claimTransferEnabled,
          claimBankCode: parsed.data.claimBankCode ?? "",
          claimBankName: parsed.data.claimBankName ?? "",
          claimBankBranch: parsed.data.claimBankBranch ?? "",
          claimBankAccount: parsed.data.claimBankAccount ?? "",
          claimBankAccountName: parsed.data.claimBankAccountName ?? "",
        }),
  });
}
