import { z } from "zod";

export const CLAIM_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const storagePrefix = "archive-stock:claim-receipt:v1:";

const receiptSchema = z.object({
  version: z.literal(1),
  formToken: z.string().min(1).max(256),
  savedAt: z.number().finite(),
  form: z.object({
    title: z.string(),
    officialLineId: z.string().optional(),
    completionMessage: z.string(),
  }),
  result: z.object({
    confirmationCode: z.string().min(1),
    submittedAt: z.string(),
    transferAccount: z
      .object({
        bankCode: z.string(),
        bankName: z.string(),
        bankBranch: z.string().optional(),
        account: z.string(),
        accountName: z.string(),
      })
      .optional(),
  }),
  phone: z.string().regex(/^09\d{8}$/),
  items: z
    .array(
      z.object({
        product: z.object({
          id: z.string(),
          name: z.string(),
          price: z.number().finite().nonnegative(),
          imageUrl: z.string().optional(),
        }),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

export type ClaimReceipt = z.infer<typeof receiptSchema>;

export function parseClaimReceipt(
  raw: string,
  token: string,
  now = Date.now(),
) {
  try {
    const parsed = receiptSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const receipt = parsed.data;
    if (
      receipt.formToken !== token ||
      receipt.savedAt > now + 60_000 ||
      now - receipt.savedAt >= CLAIM_RECEIPT_RETENTION_MS
    )
      return null;
    return receipt;
  } catch {
    return null;
  }
}

// A successful order must remain successful even when browser storage is blocked.
export function readClaimReceipt(token: string) {
  const receipts: ClaimReceipt[] = [];
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      const storage = window[name];
      const key = storagePrefix + token;
      const raw = storage.getItem(key);
      if (!raw) continue;
      const receipt = parseClaimReceipt(raw, token);
      if (receipt) receipts.push(receipt);
      else storage.removeItem(key);
    } catch {
      /* Storage is optional in private or restricted browsers. */
    }
  }
  return receipts.sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}

export function saveClaimReceipt(receipt: ClaimReceipt) {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      window[name].setItem(
        storagePrefix + receipt.formToken,
        JSON.stringify(receipt),
      );
      return true;
    } catch {
      /* Try the other storage before falling back to the visible receipt. */
    }
  }
  return false;
}

export function clearClaimReceipt(token: string) {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      window[name].removeItem(storagePrefix + token);
    } catch {
      /* Clearing local display must not affect the submitted order. */
    }
  }
}
