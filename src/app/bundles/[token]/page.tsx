import type { Metadata } from "next";
import { cache } from "react";
import { PublicBundleMenuView } from "@/components/bundle-claims/PublicBundleMenuView";
import { fetchPublicBundleMenu } from "@/lib/api/public-bundle-menu";
import { getTurnstileSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ token: string }> };
const load = cache(async (token: string) => {
  try {
    return { menu: await fetchPublicBundleMenu(token), failed: false };
  } catch {
    return { menu: null, failed: true };
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { menu } = await load((await params).token);
  return {
    title: {
      absolute: menu ? `配單確認｜${menu.storeName}` : "配單確認",
    },
    description: "選自己的專屬配單，核對截圖與固定總額後確認訂購。",
    robots: { index: false, follow: false },
  };
}

export default async function BundleMenuPage({ params }: Props) {
  const { token } = await params;
  const { menu, failed } = await load(token);
  if (!menu)
    return (
      <main className="min-h-screen bg-[#f3f7fb] px-4 py-12 text-dark">
        <section className="mx-auto max-w-[560px] rounded-[12px] bg-white p-8 text-center">
          <h1 className="text-[23px]">目前無法開啟共同選單</h1>
          <p className="text-[14px] leading-7 text-muted">
            {failed
              ? "系統暫時無法讀取，請稍後再試。"
              : "選單尚未開放或已暫停，請向管理者確認最新連結。"}
          </p>
        </section>
      </main>
    );
  return (
    <PublicBundleMenuView
      menu={menu}
      token={token}
      turnstileSiteKey={getTurnstileSiteKey()}
    />
  );
}
