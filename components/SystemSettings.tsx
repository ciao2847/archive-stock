"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Database, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { DataState } from "./DataState";

/** 系統設定面板。 */
export function SystemSettings() {
  const router = useRouter();
  const [email, setEmail] = useState("載入中…");
  const [name, setName] = useState("—");
  const [role, setRole] = useState("staff");
  const [loading, setLoading] = useState(true);
  const [hasAccount, setHasAccount] = useState(false);
  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setEmail(user.email || "—");
      const { data } = await supabase
        .from("profiles")
        .select("display_name,role")
        .eq("id", user.id)
        .maybeSingle();
      setName(data?.display_name || user.email?.split("@")[0] || "使用者");
      setRole(data?.role || "staff");
      setHasAccount(true);
      setLoading(false);
    })();
  }, []);
  async function logout() { await createClient().auth.signOut(); router.replace("/login"); router.refresh(); }
  const cardClass = "card flex gap-[18px] p-6 [&>div:last-child]:min-w-0 [&_h2]:mb-[2px] [&_h2]:mt-[7px] [&_p]:mb-3 [&_p]:mt-0 [&_p]:text-[var(--color-muted)] max-lg:[&_p]:[overflow-wrap:anywhere] [&_.pill]:inline-flex [&_.pill]:items-center [&_.pill]:gap-[5px]";
  const iconClass = "grid h-12 w-12 shrink-0 place-items-center rounded-[9px] bg-[var(--color-accent-soft)] text-[var(--color-rust)]";
  return <DataState loading={loading} isEmpty={!hasAccount} loadingText="正在讀取帳號資料…" emptyText="找不到帳號資料"><div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1"><section className={cardClass}><div className={iconClass}><UserRound /></div><div><span className="eyebrow">目前帳號</span><h2>{name}</h2><p>{email}</p><span className="pill green"><ShieldCheck size={13} />{role === "admin" ? "管理員" : "工作人員"}</span></div></section><section className={cardClass}><div className={`${iconClass} bg-[var(--color-secondary-soft)] text-[var(--color-green)]`}><Database /></div><div><span className="eyebrow">資料庫連線</span><h2>Supabase</h2><p>quhwzldmtmynahvcdfrj.supabase.co</p><span className="flex items-center gap-[5px] text-[11px] text-[var(--color-green)] [&_svg]:w-[15px]"><CheckCircle2 />連線正常</span></div></section><section className="card col-[1/-1] flex items-center justify-between p-[22px] max-lg:col-auto max-lg:flex-col max-lg:items-start max-lg:gap-[18px] [&_h2]:mb-[5px] [&_h2]:mt-0 [&_p]:m-0 [&_p]:text-[var(--color-muted)]"><div><h2>帳號操作</h2><p>在共用手機或電腦使用完畢後，請記得登出。</p></div><button className="outline danger" onClick={logout}><LogOut />登出目前帳號</button></section></div></DataState>;
}
