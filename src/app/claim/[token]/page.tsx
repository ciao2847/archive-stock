import type { Metadata } from "next";
import { AlertCircle } from "lucide-react";
import { cache } from "react";

import { PublicClaimFormView } from "@/components/claims/PublicClaimFormView";
import { fetchPublicClaimForm } from "@/lib/api/public-claims";

export const dynamic = "force-dynamic";

type ClaimPageProps = {
  params: Promise<{ token: string }>;
};

const loadPublicClaimForm = cache(async (token: string) => {
  try {
    return {
      form: await fetchPublicClaimForm(token),
      loadFailed: false,
    };
  } catch {
    return { form: null, loadFailed: true };
  }
});

export async function generateMetadata({
  params,
}: ClaimPageProps): Promise<Metadata> {
  const { token } = await params;
  const { form } = await loadPublicClaimForm(token);
  const communityName = form?.storeName.trim();

  return {
    title: {
      absolute: communityName
        ? `商品喊單｜${communityName}`
        : "商品喊單｜庫藏 Archive Stock",
    },
    description: "選擇想要的商品並留下聯絡資料。",
    robots: { index: false, follow: false },
  };
}

function Unavailable({ loadFailed = false }: { loadFailed?: boolean }) {
  return (
    <main className="min-h-screen bg-[#f3f7fb] px-4 py-8 text-dark md:py-12">
      <div className="mx-auto max-w-[720px]">
        <section className="rounded-[8px] border border-black/5 bg-white px-6 py-14 text-center shadow-[0_18px_60px_rgba(28,42,58,0.08)] md:px-12">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-danger-soft text-danger">
            <AlertCircle size={29} aria-hidden="true" />
          </span>
          <h1 className="mb-0 mt-5 text-[24px]">目前無法開啟喊單頁</h1>
          <p className="mx-auto mb-0 mt-3 max-w-[440px] text-[15px] leading-7 text-muted">
            {loadFailed
              ? "系統暫時無法讀取商品，請稍後重新整理；若持續發生，請聯絡表單管理者。"
              : "連結可能不完整或已經失效，請回到群組確認管理者分享的最新連結。"}
          </p>
        </section>
      </div>
    </main>
  );
}

export default async function ClaimPage({ params }: ClaimPageProps) {
  const { token } = await params;
  const { form, loadFailed } = await loadPublicClaimForm(token);
  if (!form) return <Unavailable loadFailed={loadFailed} />;
  return <PublicClaimFormView form={form} token={token} />;
}
