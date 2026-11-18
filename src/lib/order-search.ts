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

export type ClaimProductOrderFilter = {
  formId: string;
  productId: string;
  sku: string;
  name: string;
  payment: string;
};

export function filterClaimProductOrders(
  rows: ClaimSubmission[],
  filter: ClaimProductOrderFilter,
) {
  return rows.filter(
    (row) =>
      row.source === "claim" &&
      String(row.formId) === filter.formId &&
      (filter.payment === "paid"
        ? row.paymentStatus === "paid"
        : filter.payment === "unpaid"
          ? row.paymentStatus !== "paid"
          : true) &&
      row.items.some((item) =>
        filter.productId
          ? item.productId === filter.productId
          : item.sku === filter.sku && item.name === filter.name,
      ),
  );
}
