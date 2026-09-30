import { permanentRedirect } from "next/navigation";

type LegacyClaimPageProps = {
  params: Promise<{ token: string }>;
};

export default async function LegacyClaimPage({
  params,
}: LegacyClaimPageProps) {
  const { token } = await params;
  permanentRedirect(`/form/${encodeURIComponent(token)}`);
}
