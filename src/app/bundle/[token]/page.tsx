import type { Metadata } from "next";
import { AlertCircle } from "lucide-react";
import { cache } from "react";

import { PublicBundleClaimView } from "@/components/bundle-claims/PublicBundleClaimView";
import { fetchPublicBundleClaim } from "@/lib/api/public-bundle-claims";
import { getTurnstileSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

type BundlePageProps = {
  params: Promise<{ token: string }>;
};

const loadBundleClaim = cache(async (token: string) => {
  try {
    return { claim: await fetchPublicBundleClaim(token), loadFailed: false };
  } catch {
    return { claim: null, loadFailed: true };
  }
});

export async function generateMetadata({
  params,
}: BundlePageProps): Promise<Metadata> {
  const { token } = await params;
  const { claim } = await loadBundleClaim(token);
  return {
    title: {
      absolute: claim?.storeName
        ? `單張大禮包喊單｜${claim.storeName}`
        : "單張大禮包喊單｜庫藏 Archive Stock",
    },
    description: "核對管理者整理的商品截圖與固定總額，並完成喊單確認。",
    robots: { index: false, follow: false },
  };
}

function Unavailable({ loadFailed }: { loadFailed: boolean }) {
  return (
    <main className="min-h-screen bg-[#f3f7fb] px-4 py-8 text-dark md:py-12">
      <section className="mx-auto max-w-[560px] rounded-[12px] border border-black/5 bg-white px-6 py-14 text-center md:px-10">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-danger-soft text-danger">
          <AlertCircle size={28} />
        </span>
        <h1 className="mb-0 mt-5 text-[23px]">目前無法開啟這份喊單</h1>
        <p className="mx-auto mb-0 mt-3 max-w-[420px] text-[14px] leading-7 text-muted">
          {loadFailed
            ? "系統暫時無法讀取資料，請稍後重新整理；若持續發生，請聯絡管理者。"
            : "連結可能尚未開放、已過期或已撤銷，請向管理者確認最新連結。"}
        </p>
      </section>
    </main>
  );
}

export default async function BundlePage({ params }: BundlePageProps) {
  const { token } = await params;
  const { claim, loadFailed } = await loadBundleClaim(token);
  if (!claim) return <Unavailable loadFailed={loadFailed} />;
  return (
    <PublicBundleClaimView
      claim={claim}
      token={token}
      turnstileSiteKey={getTurnstileSiteKey()}
    />
  );
}
