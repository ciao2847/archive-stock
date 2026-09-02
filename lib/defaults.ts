export const DEFAULT_VALUES = {
  amount: 0,
  count: 0,
  productStock: 1,
  amountInput: "0",
} as const;

export function toNumber(
  value: unknown,
  fallback: number = DEFAULT_VALUES.amount,
) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
