import { redirect } from "next/navigation";
import { Dashboard } from "@/components";
import { createClient } from "@/utils/supabase/server";

export default async function Page() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const authScope =
    typeof data?.claims?.sub === "string" ? data.claims.sub : "";

  if (!authScope) redirect("/login");

  return <Dashboard key={authScope} authScope={authScope} />;
}
