import type { ClaimSubmission } from "./claims";
import type { OrderSourceFilter } from "./order-source";

export function filterClaimOrders(
  rows: ClaimSubmission[],
  source: OrderSourceFilter,
  query: string,
) {
  const search = query.trim().toLocaleLowerCase();
  return rows
    .filter(
      (row) =>
        (source === "all" || source === row.source) &&
        (!search ||
          [
            row.confirmationCode,
            row.nickname,
            row.phone,
            row.formTitle,
            row.notes,
            ...row.items.flatMap((item) => [item.name, item.sku]),
          ].some((value) => value?.toLocaleLowerCase().includes(search))),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
