import type { Metadata } from "next";
import {
  IconCheck,
  IconExternalLink,
  IconMessageCircle,
  IconQrcode,
  IconShieldX,
  IconShoppingBag,
} from "@tabler/icons-react";
import { BrandLogo } from "@/components/BrandLogo";
import { PublicRecommendationGrid } from "@/components/PublicRecommendationGrid";
import { ORDER_STATUS_LABELS } from "@/constants";
import {
  fetchPublicQrLanding,
  type PublicQrLanding,
} from "@/lib/api/public-qr";
import {
  PUBLIC_PURCHASE_LINKS,
  resolvePublicPurchaseChannel,
} from "@/lib/public-qr";

export const metadata: Metadata = {
  title: "QR Code 狀態｜庫藏 Archive Stock",
  description: "查看商品 QR Code 與訂單出貨狀態。",
  robots: { index: false, follow: false },
};

const ICON_STROKE = 1.7;

export default async function PublicQrPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ channel?: string | string[] }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const queryChannel = Array.isArray(query.channel)
    ? query.channel[0]
    : query.channel;
  const isPreview = token === "preview";

  let landing: PublicQrLanding | null = isPreview
    ? {
        orderNo: "ORDER-000128",
        qrStatus: "used",
        orderStatus: "packed",
        salesChannel: queryChannel === "line" ? "line" : "shopee",
        recommendations: [
          { sku: "A000021", name: "電影原版收藏海報" },
          { sku: "A000047", name: "限定版藝術卡組" },
          { sku: "A000083", name: "影展紀念明信片" },
          { sku: "A000105", name: "電影角色壓克力吊飾" },
        ],
      }
    : null;
  let loadFailed = false;
  if (!isPreview) {
    try {
      landing = await fetchPublicQrLanding(token, queryChannel);
    } catch {
      loadFailed = true;
    }
  }

  const channel = resolvePublicPurchaseChannel(
    landing?.salesChannel || queryChannel,
  );
  const isShopee = channel === "shopee";
  const purchaseUrl = PUBLIC_PURCHASE_LINKS[channel];
  const isUsed = landing?.qrStatus === "used";
  const isCompletedPurchase = Boolean(isUsed && landing?.orderNo);
  const orderStatus = landing?.orderStatus
    ? ORDER_STATUS_LABELS[landing.orderStatus] || landing.orderStatus
    : "尚未完成出貨核對";
  const statusText = isShopee ? "蝦皮出貨" : "私下出貨";
  const recommendations = landing?.recommendations;

  return (
    <main className="min-h-screen bg-white pb-9 text-main md:pb-12 xl:pb-14">
        <header className="mb-7 flex justify-center md:mb-9">
          <BrandLogo className="justify-center" preload size="small" />
        </header>

      <div className="mx-auto w-full max-w-[375px] px-4 md:max-w-[768px] md:px-5 xl:max-w-[800px]">
       
        <section className="rounded-[16px] border-[0.5px] border-[#d6d9de] px-5 py-7 text-center md:px-8 md:py-9">
          {isPreview && (
            <span className="mb-4 inline-flex rounded-full bg-[#f1f5f9] px-3 py-1 text-[11px] font-semibold text-muted">
              頁面預覽
            </span>
          )}
          <span
            className={`mx-auto mb-4 grid size-12 place-items-center ${isCompletedPurchase && !loadFailed ? "text-[#15803d]" : "text-[#c4382b]"}`}
          >
            {isCompletedPurchase && !loadFailed ? (
              <IconCheck size={42} stroke={ICON_STROKE} aria-hidden="true" />
            ) : (
              <IconShieldX size={40} stroke={ICON_STROKE} aria-hidden="true" />
            )}
          </span>
          <h1 className="m-0 text-[20px] font-bold md:text-[24px]">
            {loadFailed
              ? "目前無法讀取 QR Code"
              : isCompletedPurchase
                ? "感謝您的購買"
                : landing
                  ? "這張 QR Code 尚未完成出貨核對"
                : "這不是有效的商品 QR Code"}
          </h1>
          <p className="mx-auto mt-3 max-w-[440px] text-[14px] leading-6 text-muted md:text-[16px]">
            {loadFailed
              ? "請稍後重新掃描；若持續發生，請透過原購買通路與我們聯繫。"
              : isCompletedPurchase
                ? "商品已完成出貨核對，此連結目前已完成任務並失效。"
                : landing
                  ? "商品完成包裝核對後，這裡才會顯示對應的訂單與購買入口。"
                : "請確認掃描的是庫藏 Archive Stock 商品外包裝上的 QR Code。"}
          </p>

          <div className="mt-6 flex items-center gap-3 rounded-[16px] border-[0.5px] border-[#d6d9de] px-4 py-4 text-left md:px-5">
            <span
              className={`grid size-10 shrink-0 place-items-center ${isCompletedPurchase ? "text-[#15803d]" : "text-[#c4382b]"}`}
            >
              <IconQrcode size={25} stroke={ICON_STROKE} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <strong className="block text-[14px] md:text-[16px]">
                {isUsed
                  ? "此 QR Code 已失效"
                  : landing
                    ? "此 QR Code 尚未使用"
                    : "此 QR Code 無效"}
              </strong>
              <span className="mt-1 block truncate text-[12px] text-muted md:text-[14px]">
                {landing?.orderNo
                  ? `訂單 ${landing.orderNo} ・ ${statusText}`
                  : orderStatus}
              </span>
            </div>
          </div>
        </section>

        {landing && (
          <section className="mt-9 md:mt-11">
            <div className="mb-5 text-center">
              <h2 className="m-0 text-[18px] md:text-[20px]">
                猜你喜歡
              </h2>
              <p className="mb-0 mt-1 text-[14px] text-muted">
                為你隨機挑選目前仍有庫存的商品
              </p>
            </div>
            {(recommendations?.length ?? 0) > 0 ? (
              <PublicRecommendationGrid recommendations={recommendations ?? []} />
            ) : (
              <div className="rounded-[16px] border-[0.5px] border-[#d6d9de] p-6 text-center text-[14px] text-muted">
                目前沒有其他在庫推薦商品。
              </div>
            )}
          </section>
        )}

        <section
          className="mt-9 rounded-[16px] border-[0.5px] border-[#d6d9de] px-5 py-7 text-center md:mt-11 md:px-8 md:py-9"
        >
          <span
            className={`mx-auto grid size-12 place-items-center ${isShopee ? "text-[#ee4d2d]" : "text-[#06a947]"}`}
          >
            {isShopee ? (
              <IconShoppingBag size={34} stroke={ICON_STROKE} aria-hidden="true" />
            ) : (
              <IconMessageCircle size={34} stroke={ICON_STROKE} aria-hidden="true" />
            )}
          </span>
          <h2 className="mb-0 mt-3 text-[18px]">
            {isShopee ? "前往蝦皮賣場" : "官方 LINE 詢問"}
          </h2>
          <p className="mx-auto mb-0 mt-2 max-w-[480px] text-[14px] leading-6 text-muted">
            {isShopee
              ? "直接到蝦皮賣場逛逛，下單、金流與出貨一次完成。"
              : "加入官方 LINE，直接詢問庫存與最新到貨。"}
          </p>
          {purchaseUrl ? (
            <a
              className={`mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[16px] px-5 font-semibold text-white no-underline transition-[transform,background-color] duration-200 hover:-translate-y-[2px] focus-visible:outline-2 focus-visible:outline-offset-3 active:translate-y-0 md:mx-auto md:max-w-[360px] ${isShopee ? "bg-[#ee4d2d] hover:bg-[#d94326] focus-visible:outline-[#ee4d2d]" : "bg-[#06a947] hover:bg-[#058c3c] focus-visible:outline-[#06a947]"}`}
              href={purchaseUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {isShopee ? "前往蝦皮賣場" : "加官方 LINE"}
              <IconExternalLink size={18} stroke={ICON_STROKE} aria-hidden="true" />
            </a>
          ) : (
            <span className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-[16px] border-[0.5px] border-[#d6d9de] px-5 font-semibold text-muted md:max-w-[360px]">
              購買入口設定中
            </span>
          )}
        </section>

        <footer className="pt-8 text-center text-[11px] text-[#9ba0a8] md:pt-10">
          © {new Date().getFullYear()} 庫藏 Archive Stock. All rights reserved.
        </footer>
      </div>
    </main>
  );
}
