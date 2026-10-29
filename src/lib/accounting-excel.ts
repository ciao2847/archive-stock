import ExcelJS from "exceljs";
import { allocateProfit, type AccountingReport } from "./accounting-details";

export async function buildAccountingWorkbook(report: AccountingReport) {
  if (!report.cost) throw new Error("請先儲存本期成本再匯出");
  const { cost, preview, orders } = report;
  const profit = Math.round((preview.revenue - cost.amount) * 100) / 100;
  const shares = allocateProfit(profit, cost.share_rules ?? []);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ARCHIVE STOCK";
  workbook.created = new Date();
  const summary = workbook.addWorksheet("收支總覽");
  summary.columns = [
    { header: "項目", key: "label", width: 30 },
    { header: "內容", key: "value", width: 48 },
  ];
  summary.addRows([
    ["帳期", `${report.period.start} ～ ${report.period.end}`],
    ["狀態", preview.settled ? "已結算" : "未結算預覽"],
    ["結算編號", report.settlementNo ?? ""],
    ["成本版本", cost.revision],
    ["營收（不含買家運費）", preview.revenue],
    ["成本總額", cost.amount],
    ["本期盈虧", profit],
    ["可分配盈虧", profit],
    [
      "已分配盈虧",
      shares.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100,
    ],
    ["未分配盈虧", shares.length ? 0 : profit],
    ["訂單數", preview.order_count],
    ["分帳方式", "扣除成本後的盈餘按比例分配，虧損也按相同比例分攤"],
    ["備註", cost.notes],
  ]);
  for (let row = 6; row <= 11; row++)
    summary.getCell(row, 2).numFmt = "#,##0.00";
  const orderSheet = workbook.addWorksheet("訂單明細");
  orderSheet.columns = [
    { header: "訂單編號", width: 24 },
    { header: "歸帳日期", width: 14 },
    { header: "顧客", width: 22 },
    { header: "狀態", width: 14 },
    { header: "商品編號", width: 18 },
    { header: "商品名稱", width: 40 },
    { header: "數量", width: 10 },
    { header: "單價", width: 16 },
    { header: "商品小計", width: 16 },
    { header: "訂單折扣", width: 16 },
    { header: "訂單營收（每單列一次）", width: 28 },
  ];
  for (const order of orders) {
    const items = order.items.length
      ? order.items
      : [{ sku: "", name: "", quantity: 0, unitPrice: 0 }];
    items.forEach((item, index) =>
      orderSheet.addRow([
        order.orderNo,
        order.date,
        order.customer,
        ({ packed: "已包裝", shipped: "已出貨" } as Record<string, string>)[
          order.status
        ] ?? order.status,
        item.sku,
        item.name,
        item.quantity,
        item.unitPrice,
        Math.round(item.quantity * item.unitPrice * 100) / 100,
        index === 0 ? order.discount : 0,
        index === 0 ? order.revenue : 0,
      ]),
    );
  }
  [8, 9, 10, 11].forEach(
    (column) => (orderSheet.getColumn(column).numFmt = "#,##0.00"),
  );
  const costSheet = workbook.addWorksheet("成本明細");
  costSheet.columns = [
    { header: "日期", width: 14 },
    { header: "分類", width: 16 },
    { header: "成本項目", width: 36 },
    { header: "金額（TWD）", width: 20 },
    { header: "備註", width: 48 },
  ];
  const entries = cost.cost_entries?.length
    ? cost.cost_entries
    : cost.amount > 0
      ? [
          {
            date: report.period.start,
            category: "其他",
            name: "歷史成本總額",
            amount: cost.amount,
            notes: cost.notes,
          },
        ]
      : [];
  entries.forEach((entry) =>
    costSheet.addRow([
      entry.date,
      entry.category,
      entry.name,
      entry.amount,
      entry.notes,
    ]),
  );
  costSheet.addRow(["", "", "合計", cost.amount, ""]);
  costSheet.getColumn(4).numFmt = "#,##0.00";
  const shareSheet = workbook.addWorksheet("分帳結果");
  shareSheet.columns = [
    { header: "對象", width: 28 },
    { header: "分帳比例", width: 18 },
    { header: "分配／分攤金額（TWD）", width: 24 },
  ];
  shares.forEach((share) =>
    shareSheet.addRow([share.name, share.basisPoints / 10000, share.amount]),
  );
  if (!shares.length) shareSheet.addRow(["尚未設定分帳", 0, 0]);
  shareSheet.addRow([
    "合計",
    shares.length ? 1 : 0,
    shares.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100,
  ]);
  shareSheet.getColumn(2).numFmt = "0.00%";
  shareSheet.getColumn(3).numFmt = "#,##0.00";
  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sheet.rowCount, column: sheet.columnCount },
    };
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).height = 26;
    sheet.getRow(1).eachCell(
      (cell) =>
        (cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF5A87B1" },
        }),
    );
    sheet.eachRow((row) =>
      row.eachCell(
        (cell) => (cell.alignment = { vertical: "top", wrapText: true }),
      ),
    );
  }
  return workbook;
}

export async function buildCombinedAccountingWorkbook(
  reports: AccountingReport[],
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ARCHIVE STOCK";
  const summary = workbook.addWorksheet("收支總覽");
  summary.columns = [
    { header: "帳期", width: 28 },
    { header: "狀態", width: 18 },
    { header: "營收（TWD）", width: 20 },
    { header: "成本（TWD）", width: 20 },
    { header: "盈虧（TWD）", width: 20 },
    { header: "已分配／分攤", width: 20 },
    { header: "未分配／分攤", width: 20 },
    { header: "成本版本", width: 12 },
    { header: "結算編號", width: 24 },
    { header: "備註", width: 40 },
  ];
  const names = ["訂單明細", "成本明細", "分帳結果"];
  const sheets = names.map((name) => workbook.addWorksheet(name));
  for (const report of reports) {
    if (!report.cost) continue;
    const period = `${report.period.start} ～ ${report.period.end}`;
    const profit =
      Math.round((report.preview.revenue - report.cost.amount) * 100) / 100;
    const allocated =
      allocateProfit(profit, report.cost.share_rules ?? []).reduce(
        (sum, row) => sum + Math.round(row.amount * 100),
        0,
      ) / 100;
    summary.addRow([
      period,
      report.preview.settled ? "已結算" : "未結算預覽",
      report.preview.revenue,
      report.cost.amount,
      profit,
      allocated,
      Math.round((profit - allocated) * 100) / 100,
      report.cost.revision,
      report.settlementNo ?? "",
      report.cost.notes,
    ]);
    const current = await buildAccountingWorkbook(report);
    sheets.forEach((sheet, index) => {
      const source = current.getWorksheet(names[index])!;
      if (!sheet.columns?.length) {
        sheet.columns = [
          { header: "帳期", width: 28 },
          ...source.columns.map((column) => ({
            header: column.header,
            width: column.width,
          })),
        ];
      }
      source.eachRow((row, rowNumber) => {
        if (rowNumber > 1)
          sheet.addRow([
            period,
            ...(row.values as ExcelJS.CellValue[]).slice(1),
          ]);
      });
    });
  }
  const total = (column: number) =>
    reports.reduce(
      (sum, report) =>
        sum +
        Math.round(
          (column === 3
            ? report.preview.revenue
            : column === 4
              ? (report.cost?.amount ?? 0)
              : report.preview.revenue - (report.cost?.amount ?? 0)) * 100,
        ),
      0,
    ) / 100;
  summary.addRow(["合計", "", total(3), total(4), total(5)]);
  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sheet.rowCount, column: sheet.columnCount },
    };
    sheet.getRow(1).height = 26;
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).eachCell(
      (cell) =>
        (cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF5A87B1" },
        }),
    );
    sheet.eachRow((row) =>
      row.eachCell(
        (cell) => (cell.alignment = { vertical: "top", wrapText: true }),
      ),
    );
  }
  [3, 4, 5, 6, 7].forEach(
    (column) => (summary.getColumn(column).numFmt = "#,##0.00"),
  );
  [9, 10, 11, 12].forEach(
    (column) => (sheets[0].getColumn(column).numFmt = "#,##0.00"),
  );
  sheets[1].getColumn(5).numFmt = "#,##0.00";
  sheets[2].getColumn(3).numFmt = "0.00%";
  sheets[2].getColumn(4).numFmt = "#,##0.00";
  return workbook;
}
