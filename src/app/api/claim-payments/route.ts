import { z } from "zod";

import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";

const recordPaymentSchema = z.object({
  ownerId: z.string().uuid(),
  submissionId: z.number().int().positive(),
  amount: z
    .number()
    .finite()
    .positive()
    .max(9_999_999_999.99)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7),
  transferredAt: z.string().datetime({ offset: true }),
  payerAccountLastFive: z
    .string()
    .trim()
    .refine((value) => !value || /^\d{5}$/.test(value))
    .default(""),
  note: z.string().trim().max(1000).default(""),
});

const deletePaymentSchema = z.object({
  ownerId: z.string().uuid(),
  paymentId: z.number().int().positive(),
});

function canAccessOwner(
  role: "admin" | "staff",
  inventoryOwnerId: string,
  ownerId: string,
) {
  return role === "admin" || inventoryOwnerId === ownerId;
}

const PAYMENT_ERROR_MESSAGES: Record<
  string,
  { message: string; status: number }
> = {
  "authentication required": { message: "請先登入。", status: 401 },
  "employee access required": { message: "權限不足。", status: 403 },
  "owner access required": {
    message: "無法管理其他庫藏的匯款紀錄。",
    status: 403,
  },
  "claim submission not found": {
    message: "找不到這筆喊單，請重新整理後再試。",
    status: 404,
  },
  "claim payment not found": {
    message: "找不到這筆匯款紀錄，可能已被刪除。",
    status: 404,
  },
  "invalid claim payment target": {
    message: "匯款紀錄目標格式錯誤。",
    status: 400,
  },
  "invalid claim payment amount": {
    message: "請輸入正確的匯款金額。",
    status: 400,
  },
  "invalid claim payment time": {
    message: "請輸入正確的匯款時間。",
    status: 400,
  },
  "invalid payer account last five": {
    message: "帳號末五碼須為 5 位數字。",
    status: 400,
  },
  "claim payment note is too long": {
    message: "匯款備註不可超過 1000 個字。",
    status: 400,
  },
  "claim payment exceeds outstanding amount": {
    message: "匯款金額不可超過這筆喊單的待付餘額。",
    status: 409,
  },
};

export async function POST(request: Request) {
  return withApiErrorHandling("POST /api/claim-payments", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const parsed = recordPaymentSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return apiFailure(
        parsed.error.issues[0]?.message || "請確認匯款紀錄內容。",
        400,
      );
    }
    if (
      !canAccessOwner(auth.role, auth.inventoryOwnerId, parsed.data.ownerId)
    ) {
      return apiFailure("無法管理其他庫藏的匯款紀錄。", 403);
    }

    const { data, error } = await auth.supabase.rpc(
      "record_claim_submission_payment",
      {
        p_owner_id: parsed.data.ownerId,
        p_submission_id: parsed.data.submissionId,
        p_amount: parsed.data.amount,
        p_transferred_at: parsed.data.transferredAt,
        p_payer_account_last_five: parsed.data.payerAccountLastFive,
        p_note: parsed.data.note,
      },
    );
    if (error) {
      if (error.code === "PGRST202") {
        return apiFailure(
          "匯款紀錄功能尚未安裝，請先執行最新 migration。",
          503,
        );
      }
      const mapped = PAYMENT_ERROR_MESSAGES[error.message];
      return apiFailure(
        mapped?.message || "匯款紀錄新增失敗，請重新整理後再試。",
        mapped?.status || 400,
        error.code,
      );
    }

    const row = data?.[0];
    if (!row) return apiFailure("匯款紀錄未新增，請稍後再試。", 409);
    return apiSuccess(
      {
        paymentId: Number(row.payment_id),
        paymentStatus: row.payment_status,
        totalPaid: Number(row.total_paid),
        outstandingAmount: Number(row.outstanding_amount),
      },
      201,
    );
  });
}

export async function DELETE(request: Request) {
  return withApiErrorHandling("DELETE /api/claim-payments", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const parsed = deletePaymentSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return apiFailure("匯款紀錄刪除格式錯誤。", 400);
    if (
      !canAccessOwner(auth.role, auth.inventoryOwnerId, parsed.data.ownerId)
    ) {
      return apiFailure("無法管理其他庫藏的匯款紀錄。", 403);
    }

    const { data, error } = await auth.supabase.rpc(
      "delete_claim_submission_payment",
      {
        p_owner_id: parsed.data.ownerId,
        p_payment_id: parsed.data.paymentId,
      },
    );
    if (error) {
      if (error.code === "PGRST202") {
        return apiFailure(
          "匯款紀錄功能尚未安裝，請先執行最新 migration。",
          503,
        );
      }
      const mapped = PAYMENT_ERROR_MESSAGES[error.message];
      return apiFailure(
        mapped?.message || "匯款紀錄刪除失敗，請重新整理後再試。",
        mapped?.status || 400,
        error.code,
      );
    }

    const row = data?.[0];
    if (!row) return apiFailure("匯款紀錄未刪除，請稍後再試。", 409);
    return apiSuccess({
      submissionId: Number(row.submission_id),
      paymentStatus: row.payment_status,
      totalPaid: Number(row.total_paid),
      outstandingAmount: Number(row.outstanding_amount),
    });
  });
}
