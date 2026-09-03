"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Database,
  LogOut,
  ShieldCheck,
  UserRound,
} from "lucide-react";
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
  async function logout() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  const cardClass = "card flex gap-5 p-6";
  const iconClass =
    "grid h-12 w-12 shrink-0 place-items-center rounded-[9px] bg-accent-soft text-rust";
  return (
    <DataState
      loading={loading}
      isEmpty={!hasAccount}
      loadingText="正在讀取帳號資料…"
      emptyText="找不到帳號資料"
    >
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <section className={cardClass}>
          <div className={iconClass}>
            <UserRound />
          </div>
          <SettingsCardContent
            eyebrow="目前帳號"
            title={name}
            description={email}
          >
            <span className="pill green inline-flex items-center gap-1">
              <ShieldCheck size={13} />
              {role === "admin" ? "管理員" : "工作人員"}
            </span>
          </SettingsCardContent>
        </section>
        <section className={cardClass}>
          <div className={`${iconClass} bg-secondary-soft text-green`}>
            <Database />
          </div>
          <SettingsCardContent
            eyebrow="資料庫連線"
            title="Supabase"
            description="quhwzldmtmynahvcdfrj.supabase.co"
          >
            <span className="flex items-center gap-1 text-[11px] text-green">
              <CheckCircle2 className="w-[15px]" />
              連線正常
            </span>
          </SettingsCardContent>
        </section>
        <section className="card col-[1/-1] flex items-center justify-between p-6 max-lg:col-auto max-lg:flex-col max-lg:items-start max-lg:gap-5">
          <div>
            <h2 className="mb-1 mt-0">帳號操作</h2>
            <p className="m-0 text-muted">
              在共用手機或電腦使用完畢後，請記得登出。
            </p>
          </div>
          <button className="outline danger" onClick={logout}>
            <LogOut />
            登出目前帳號
          </button>
        </section>
      </div>
    </DataState>
  );
}

function SettingsCardContent({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="mb-1 mt-2">{title}</h2>
      <p className="mb-3 mt-0 text-muted max-lg:[overflow-wrap:anywhere]">
        {description}
      </p>
      {children}
    </div>
  );
}
