import type { ClaimProductTotal } from "./claims";

function csvCell(value: string | number) {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildPaidProcurementCsv(products: ClaimProductTotal[]) {
  const rows = [
    ["商品 ID", "商品名稱", "已付款數量"],
    ...products
      .filter((product) => product.paidQuantity > 0)
      .map((product) => [product.sku, product.name, product.paidQuantity]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
