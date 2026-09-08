import ExcelJS from "exceljs";
import QRCode from "qrcode";
import { z } from "zod";
import { apiFailure, requireApiUser } from "@/lib/api/server-auth";
import { buildPublicQrUrl } from "@/lib/public-qr";

const QR_IMAGE_SIZE = 256;
const QR_IMAGE_DISPLAY_SIZE = 144;

const requestSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1).max(500),
  batchCreatedAtByProduct: z
    .record(z.string().uuid(), z.iso.datetime())
    .optional(),
});

type PrintProductRow = {
  id: string;
  sku: string;
  name: string;
  product_qr_labels:
    | Array<{
        id: string;
        token: string;
        status: string;
        created_at: string;
        printed_at: string | null;
      }>
    | {
        id: string;
        token: string;
        status: string;
        created_at: string;
        printed_at: string | null;
      }
    | null;
};

type PrintRow = {
  labelId: string;
  qrCode: string;
  productId: string;
  productName: string;
};

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return apiFailure("請至少選擇一項商品", 400);

  const productIds = [...new Set(parsed.data.productIds)];
  const { data, error } = await auth.supabase
    .from("products")
    .select(
      "id,sku,name,product_qr_labels(id,token,status,created_at,printed_at)",
    )
    .in("id", productIds)
    .order("sku");
  if (error) return apiFailure(error.message, 400, error.code);

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const rows = ((data ?? []) as unknown as PrintProductRow[]).flatMap<PrintRow>(
    (product) => {
      const labels = Array.isArray(product.product_qr_labels)
        ? product.product_qr_labels
        : product.product_qr_labels
          ? [product.product_qr_labels]
          : [];
      const printableLabels = labels.filter(
        (label) => label.status === "active" && label.printed_at === null,
      );
      const requestedBatch = parsed.data.batchCreatedAtByProduct?.[product.id];
      const latestBatch =
        requestedBatch ??
        printableLabels.reduce<string | null>(
          (latest, label) =>
            !latest || label.created_at > latest ? label.created_at : latest,
          null,
        );
      return printableLabels
        .filter((label) => label.created_at === latestBatch)
        .map((label) => ({
          labelId: label.id,
          qrCode: buildPublicQrUrl(label.token, origin),
          productId: product.sku,
          productName: product.name,
        }));
    },
  );
  if (rows.length === 0) return apiFailure("所選商品沒有可列印的 QR Code", 400);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Archive Stock";
  const sheet = workbook.addWorksheet("批量列印");
  sheet.columns = [
    { header: "QR Code", key: "qrImage", width: 24 },
    { header: "商品 ID", key: "productId", width: 16 },
    { header: "商品名稱", key: "productName", width: 36 },
  ];
  sheet.addRows(
    rows.map(({ productId, productName }) => ({
      qrImage: "",
      productId,
      productName,
    })),
  );
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const qrImageBuffers = await Promise.all(
    rows.map(({ qrCode }) =>
      QRCode.toBuffer(qrCode, {
        type: "png",
        errorCorrectionLevel: "M",
        margin: 4,
        width: QR_IMAGE_SIZE,
      }),
    ),
  );

  qrImageBuffers.forEach((buffer, index) => {
    const row = sheet.getRow(index + 2);
    row.height = 118;
    row.getCell(1).alignment = {
      horizontal: "center",
      vertical: "middle",
    };

    const imageId = workbook.addImage({
      base64: `data:image/png;base64,${buffer.toString("base64")}`,
      extension: "png",
    });
    sheet.addImage(imageId, {
      tl: { col: 0.05, row: index + 1.05 },
      ext: {
        width: QR_IMAGE_DISPLAY_SIZE,
        height: QR_IMAGE_DISPLAY_SIZE,
      },
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const { data: marked, error: markError } = await auth.supabase.rpc(
    "mark_product_qr_labels_printed",
    { p_label_ids: rows.map((row) => row.labelId) },
  );
  if (markError || marked !== true) {
    return apiFailure(
      "QR Code 已被其他列印作業取得，請重新整理後再試。",
      409,
      markError?.code,
    );
  }

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="archive-stock-niimbot-labels.xlsx"',
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
