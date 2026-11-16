import type { Metadata } from "next";
import { cache } from "react";
import { fetchFanmadeHeader } from "@/lib/fanmade/server";
import { FanmadePublicForm } from "@/components/fanmade/FanmadePublicForm";
import { getTurnstileSiteKey } from "@/lib/turnstile";
export const dynamic = "force-dynamic";
type FanmadePageProps = {
  params: Promise<{ token: string }>;
};

const loadFanmadeHeader = cache((token: string) =>
  fetchFanmadeHeader(token).catch(() => null),
);

export async function generateMetadata({
  params,
}: FanmadePageProps): Promise<Metadata> {
  const { token } = await params;
  const header = await loadFanmadeHeader(token);
  const communityName = header?.storeName.trim();
  return {
    title: {
      absolute: `飯制海報訂購｜${communityName || "庫藏 Archive Stock"}`,
    },
    robots: { index: false, follow: false },
  };
}

export default async function FanmadeFormPage({ params }: FanmadePageProps) {
  const { token } = await params;
  const header = await loadFanmadeHeader(token);
  if (!header)
    return (
      <main className="mx-auto max-w-[720px] p-6">
        <h1>目前無法開啟飯製訂購頁</h1>
        <p>連結可能已失效，或服務暫時無法讀取。請稍後重新整理或聯繫管理者。</p>
      </main>
    );
  return (
    <FanmadePublicForm
      key={token}
      header={header}
      token={token}
      turnstileSiteKey={getTurnstileSiteKey()}
    />
  );
}
