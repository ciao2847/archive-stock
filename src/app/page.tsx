import { redirect } from "next/navigation";
import { Dashboard } from "@/components";
import { createClient } from "@/utils/supabase/server";

export default async function Page() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) redirect("/login");

  return <Dashboard />;
}
